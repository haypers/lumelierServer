//! # Lumelier Main Server — Entry Point
//!
//! Runs two HTTP servers: **main** (port 3002) for client poll and static client app, and **admin**
//! (port 3010) for the admin panel and admin API. Also starts the simulated client server as a
//! child process if the binary is found. Shared state: connection registry (device last-seen, ping)
//! and broadcast state (timeline, play/pause). Prints a QR code so phones on the same network can
//! open the client URL.

use axum::extract::DefaultBodyLimit;
use axum::handler::Handler;
use axum::middleware;
use axum::response::IntoResponse;
use axum::routing::{any, get, post};
use axum::Router;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Arc;
use tower_http::services::ServeDir;

mod api;
mod auth;
mod broadcast;
mod connections;
mod live_shows;
mod time;
mod timeline_validator;
pub mod track_splitter_tree;

const PORT: u16 = 3002;
const ADMIN_PORT: u16 = 3010;

/// Detect local network IP by connecting a UDP socket to 8.8.8.8 and reading local_addr. Returns None on failure.
fn local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

/// Base URL for the client app (main server). Used for live-join-url.
fn client_base_url() -> String {
    let host = local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    format!("http://{}:{}", host, PORT)
}

#[tokio::main]
async fn main() {
    let live_shows: Arc<live_shows::LiveShowStore> = Arc::new(live_shows::LiveShowStore::new());

    let shows_path = PathBuf::from("./userData/shows");
    if let Err(e) = std::fs::create_dir_all(&shows_path) {
        eprintln!("could not create shows dir: {}", e);
    }

    let users_path = PathBuf::from("./userData/users");
    if let Err(e) = std::fs::create_dir_all(&users_path) {
        eprintln!("could not create users dir: {}", e);
    }
    let sessions_path = PathBuf::from("./userData/sessions");
    if let Err(e) = std::fs::create_dir_all(&sessions_path) {
        eprintln!("could not create sessions dir: {}", e);
    }

    let auth_state = auth::AuthState {
        users: auth::UserStore::new(users_path.clone()),
        sessions: auth::SessionStore::new(sessions_path.clone()),
    };

    let admin_state = api::AdminAppState {
        live_shows: live_shows.clone(),
        client_base_url: client_base_url(),
        simulated_server_url: std::env::var("SIMULATED_SERVER_URL").unwrap_or_else(|_| "http://127.0.0.1:3003".to_string()),
        shows_path,
        auth: auth_state,
    };

    let simulated_bin = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(format!("lumelier-simulated-server{}", std::env::consts::EXE_SUFFIX))))
        .filter(|p| p.exists())
        .or_else(|| {
            let release = PathBuf::from("./target/release").join(format!("lumelier-simulated-server{}", std::env::consts::EXE_SUFFIX));
            let debug = PathBuf::from("./target/debug").join(format!("lumelier-simulated-server{}", std::env::consts::EXE_SUFFIX));
            if release.exists() {
                Some(release)
            } else if debug.exists() {
                Some(debug)
            } else {
                None
            }
        });

    let mut simulated_client_server_child: Option<Child> = match simulated_bin {
        Some(ref path) => match Command::new(path).spawn() {
            Ok(c) => Some(c),
            Err(e) => {
                eprintln!("warning: could not start simulated client server: {}", e);
                None
            }
        },
        None => {
            eprintln!("warning: lumelier-simulated-server binary not found (build with cargo build -p lumelier-simulated-server)");
            None
        }
    };

    let live_shows_tick = live_shows.clone();
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            interval.tick().await;
            let now_ms = crate::time::unix_now_ms();
            live_shows_tick.tick_all_disconnects(now_ms);
        }
    });

    async fn serve_client_index() -> impl IntoResponse {
        match tokio::fs::read_to_string("dist-client/index.html").await {
            Ok(html) => ([("content-type", "text/html; charset=utf-8")], html).into_response(),
            Err(_) => (axum::http::StatusCode::NOT_FOUND, "client not built").into_response(),
        }
    }

    let app_main = Router::new()
        .route("/api/health", get(api::health))
        .route("/api/poll", get(api::poll))
        .route("/:show_id", get(serve_client_index))
        .route("/:show_id/", get(serve_client_index))
        .with_state(api::MainAppState {
            live_shows: live_shows.clone(),
        })
        .fallback_service(ServeDir::new("dist-client"));

    async fn serve_admin_index() -> impl axum::response::IntoResponse {
        match tokio::fs::read_to_string("dist-admin/index.html").await {
            Ok(html) => ([("content-type", "text/html; charset=utf-8")], html).into_response(),
            Err(_) => (axum::http::StatusCode::NOT_FOUND, "admin not built").into_response(),
        }
    }

    /// Serves the admin SPA for show routes (e.g. /dashboard/:show_id). Always returns the SPA so the
    /// client can load and show a styled 404 when the show does not exist or the user has no access.
    async fn serve_admin_index_if_show_access() -> impl IntoResponse {
        serve_admin_index().await.into_response()
    }

    // Live-show-ids: the simulated client server polls this every 10s to know which shows are live.
    // It has no browser session, so we expose this route without the session layer.
    let admin_live_show_ids = Router::new()
        .route("/live-show-ids", get(api::get_live_show_ids))
        .with_state(admin_state.clone());

    let admin_protected = Router::new()
        .route("/show-workspaces/:show_id/go-live", post(api::post_go_live))
        .route("/show-workspaces/:show_id/end-live", post(api::post_end_live))
        .route("/show-workspaces/:show_id/live-join-url", get(api::get_live_join_url))
        .route("/shows/:show_id/connected-devices", get(api::get_connected_devices))
        .route("/shows/:show_id/connected-devices/page-ids", get(api::get_page_ids))
        .route("/shows/:show_id/connected-devices/by-ids", post(api::post_by_ids))
        .route("/shows/:show_id/stats", get(api::get_stats))
        .route("/shows/:show_id/connections/reset", post(api::post_reset_connections))
        .route("/shows/:show_id/broadcast/timeline", post(api::post_broadcast_timeline))
        .route("/shows/:show_id/broadcast/readhead", post(api::post_broadcast_readhead))
        .route("/shows/:show_id/broadcast/play", post(api::post_broadcast_play))
        .route("/shows/:show_id/broadcast/pause", post(api::post_broadcast_pause))
        .route("/users/check", get(api::get_user_exists))
        .route("/show-workspaces", get(api::get_list_shows).post(api::post_create_show))
        .route(
            "/show-workspaces/:show_id",
            get(api::get_show_by_id).delete(api::delete_show),
        )
        .route(
            "/show-workspaces/:show_id/members",
            get(api::get_show_members).post(api::post_show_member),
        )
        .route("/show-workspaces/:show_id/timeline", get(api::get_timeline).put(api::put_timeline))
        .route(
            "/show-workspaces/:show_id/track-splitter-tree",
            get(api::get_track_splitter_tree).put(api::put_track_splitter_tree),
        )
        .route(
            "/show-workspaces/:show_id/venue-shape",
            get(api::get_venue_shape).put(api::put_venue_shape),
        )
        .route(
            "/show-workspaces/:show_id/map-state",
            get(api::get_map_state_show).post(api::post_map_state_show),
        )
        .route(
            "/show-workspaces/:show_id/timeline-media",
            get(api::get_timeline_media_list)
                .post(api::post_timeline_media_upload.layer(DefaultBodyLimit::max(500 * 1024 * 1024))),
        )
        .route(
            "/show-workspaces/:show_id/timeline-media/:filename",
            get(api::get_timeline_media_file),
        )
        .route(
            "/show-workspaces/:show_id/simulated-client-profiles",
            get(api::list_simulated_client_profiles).post(api::post_save_simulated_client_profile),
        )
        .route(
            "/show-workspaces/:show_id/simulated-client-profiles/:name",
            get(api::get_simulated_client_profile),
        )
        .route_layer(middleware::from_fn_with_state(
            admin_state.clone(),
            auth::require_session::<api::AdminAppState>,
        ))
        .with_state(admin_state.clone());

    let app_admin = Router::new()
        .route("/api/poll", get(api::poll_admin))
        .route("/api/health", get(api::health))
        .route("/api/auth/register", post(auth::post_register::<api::AdminAppState>))
        .route("/api/auth/login", post(auth::post_login::<api::AdminAppState>))
        .route("/api/auth/logout", post(auth::post_logout::<api::AdminAppState>))
        .route("/api/auth/me", get(auth::get_me::<api::AdminAppState>))
        .nest("/api/admin", admin_live_show_ids.merge(admin_protected))
        .route("/", any(serve_admin_index))
        .route("/dashboard/:show_id", any(serve_admin_index_if_show_access))
        .route("/dashboard/:show_id/", any(serve_admin_index_if_show_access))
        .route("/dashboard", any(serve_admin_index))
        .route("/dashboard/", any(serve_admin_index))
        .route("/sessionManager/:show_id", any(serve_admin_index_if_show_access))
        .route("/sessionManager/:show_id/", any(serve_admin_index_if_show_access))
        .route("/sessionManager", any(serve_admin_index))
        .route("/sessionManager/", any(serve_admin_index))
        .route("/timeline/:show_id", any(serve_admin_index_if_show_access))
        .route("/timeline/:show_id/", any(serve_admin_index_if_show_access))
        .route("/timeline", any(serve_admin_index))
        .route("/timeline/", any(serve_admin_index))
        .route("/connectedDevicesList/:show_id", any(serve_admin_index_if_show_access))
        .route("/connectedDevicesList/:show_id/", any(serve_admin_index_if_show_access))
        .route("/connectedDevicesList", any(serve_admin_index))
        .route("/connectedDevicesList/", any(serve_admin_index))
        .route("/venueMap/:show_id", any(serve_admin_index_if_show_access))
        .route("/venueMap/:show_id/", any(serve_admin_index_if_show_access))
        .route("/venueMap", any(serve_admin_index))
        .route("/venueMap/", any(serve_admin_index))
        .route("/simulateDevices/:show_id", any(serve_admin_index_if_show_access))
        .route("/simulateDevices/:show_id/", any(serve_admin_index_if_show_access))
        .route("/simulateDevices", any(serve_admin_index))
        .route("/simulateDevices/", any(serve_admin_index))
        .route("/login", any(serve_admin_index))
        .route("/login/", any(serve_admin_index))
        .route("/register", any(serve_admin_index))
        .route("/register/", any(serve_admin_index))
        .fallback_service(ServeDir::new("dist-admin"))
        .with_state(admin_state);

    let addr_main = SocketAddr::from(([0, 0, 0, 0], PORT));
    let addr_admin = SocketAddr::from(([0, 0, 0, 0], ADMIN_PORT));
    println!("listening on http://0.0.0.0:{}", PORT);
    println!("admin panel on http://0.0.0.0:{}", ADMIN_PORT);
    if let Some(host) = local_ip() {
        println!("admin panel (local): http://{}:{}", host, ADMIN_PORT);
    }

    let listener_main = tokio::net::TcpListener::bind(addr_main).await.unwrap();
    let listener_admin = tokio::net::TcpListener::bind(addr_admin).await.unwrap();

    let serve_main = axum::serve(listener_main, app_main);
    let serve_admin = axum::serve(listener_admin, app_admin);

    let (r1, r2) = tokio::join!(serve_main, serve_admin);
    if let Some(mut child) = simulated_client_server_child.take() {
        let _ = child.kill();
    }
    r1.expect("main server failed");
    r2.expect("admin server failed");
}
