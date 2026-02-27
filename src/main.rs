//! # Lumelier Main Server — Entry Point
//!
//! Runs two HTTP servers: **main** (port 3002) for client poll and static client app, and **admin**
//! (port 3010) for the admin panel and admin API. Also starts the simulated client server as a
//! child process if the binary is found. Shared state: connection registry (device last-seen, ping)
//! and broadcast state (timeline, play/pause). Prints a QR code so phones on the same network can
//! open the client URL.

use axum::extract::{Path, State};
use axum::http::HeaderMap;
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
mod time;
mod timeline_validator;

const PORT: u16 = 3002;
const ADMIN_PORT: u16 = 3010;

/// Base URL for clients; uses local IP so phones can scan QR and connect. Fallback 127.0.0.1.
fn local_url() -> String {
    let host = local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    format!("http://{}:{}", host, PORT)
}

/// Detect local network IP by connecting a UDP socket to 8.8.8.8 and reading local_addr. Returns None on failure.
fn local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

fn print_qr(url: &str) {
    use qrcode::types::Color;
    let code = match qrcode::QrCode::new(url.as_bytes()) {
        Ok(c) => c,
        Err(_) => {
            eprintln!("could not generate QR code for URL");
            return;
        }
    };
    // Compact: two QR rows per terminal line using upper/lower half-blocks (▀ ▄ █)
    let w = code.width();
    let quiet = " ".repeat(w);
    println!("\nScan to join from a phone on the same network:");
    println!("{}", url);
    println!("{}", quiet);
    let mut y = 0;
    while y < w {
        let mut line = String::with_capacity(w);
        for x in 0..w {
            let top = code[(x, y)] == Color::Dark;
            let bot = y + 1 < w && code[(x, y + 1)] == Color::Dark;
            let ch = match (top, bot) {
                (false, false) => ' ',
                (true, false) => '\u{2580}', // ▀ upper half
                (false, true) => '\u{2584}', // ▄ lower half
                (true, true) => '█',
            };
            line.push(ch);
        }
        println!("{}", line);
        y += 2;
    }
}

#[tokio::main]
async fn main() {
    // Shared state: which devices have polled recently and their ping samples.
    let registry: Arc<connections::ConnectionRegistry> =
        Arc::new(connections::ConnectionRegistry::new());
    let broadcast_state: Arc<arc_swap::ArcSwap<broadcast::BroadcastSnapshot>> = Arc::new(
        arc_swap::ArcSwap::from_pointee(broadcast::BroadcastSnapshot::new()),
    );

    let show_timelines_path = PathBuf::from("./userData/showTimelines");
    if let Err(e) = std::fs::create_dir_all(&show_timelines_path) {
        eprintln!("could not create show timelines dir: {}", e);
    }

    let simulated_client_profiles_path = PathBuf::from("./userData/simulatedClientProfiles");
    if let Err(e) = std::fs::create_dir_all(&simulated_client_profiles_path) {
        eprintln!("could not create simulated client profiles dir: {}", e);
    }

    let venue_shapes_path = PathBuf::from("./userData/venueShapes");
    if let Err(e) = std::fs::create_dir_all(&venue_shapes_path) {
        eprintln!("could not create venue shapes dir: {}", e);
    }

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
        registry: registry.clone(),
        show_timelines_path,
        simulated_client_profiles_path,
        venue_shapes_path,
        shows_path,
        map_state: Arc::new(arc_swap::ArcSwap::from_pointee(api::MapState::default())),
        broadcast: broadcast_state.clone(),
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

    let registry_tick = registry.clone();
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            interval.tick().await;
            let now_ms = crate::time::unix_now_ms();
            registry_tick.tick_disconnects(now_ms);
        }
    });

    let app_main = Router::new()
        .route("/api/health", get(api::health))
        .route("/api/poll", get(api::poll))
        .with_state(api::MainAppState {
            registry: registry.clone(),
            broadcast: broadcast_state.clone(),
        })
        .fallback_service(ServeDir::new("dist-client"));

    async fn serve_admin_index() -> impl axum::response::IntoResponse {
        match tokio::fs::read_to_string("dist-admin/index.html").await {
            Ok(html) => ([("content-type", "text/html; charset=utf-8")], html).into_response(),
            Err(_) => (axum::http::StatusCode::NOT_FOUND, "admin not built").into_response(),
        }
    }

    /// Serves the admin SPA only if the user has access to the show. Used for routes like /dashboard/:show_id.
    async fn serve_admin_index_if_show_access(
        Path(show_id): Path<String>,
        State(state): State<api::AdminAppState>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if !api::is_valid_show_id_format(&show_id) {
            return axum::http::StatusCode::NOT_FOUND.into_response();
        }
        let session_id = match auth::parse_session_cookie(&headers) {
            Some(s) => s,
            None => return axum::http::StatusCode::UNAUTHORIZED.into_response(),
        };
        let username = match state.auth.sessions.get(&session_id).await {
            Some(u) => u,
            None => return axum::http::StatusCode::UNAUTHORIZED.into_response(),
        };
        match api::check_show_access(&state, &username, &show_id).await {
            Ok(_) => serve_admin_index().await.into_response(),
            Err(sc) => sc.into_response(),
        }
    }

    let admin_protected = Router::new()
        .route("/connected-devices", get(api::get_connected_devices))
        .route("/connected-devices/page-ids", get(api::get_page_ids))
        .route("/connected-devices/by-ids", post(api::post_by_ids))
        .route("/stats", get(api::get_stats))
        .route("/connections/reset", post(api::post_reset_connections))
        .route("/broadcast/timeline", post(api::post_broadcast_timeline))
        .route("/broadcast/readhead", post(api::post_broadcast_readhead))
        .route("/broadcast/play", post(api::post_broadcast_play))
        .route("/broadcast/pause", post(api::post_broadcast_pause))
        .route("/shows", get(api::list_shows))
        .route("/shows/:name", get(api::get_show).put(api::put_show))
        .route("/venues", get(api::list_venues))
        .route("/venues/:name", get(api::get_venue).put(api::put_venue))
        .route("/map-state", get(api::get_map_state).post(api::post_map_state))
        .route("/map-state/load-venue", post(api::post_load_map_state_venue))
        .route("/map-state/save-venue", post(api::post_save_map_state_venue))
        .route(
            "/simulated-client-profiles",
            get(api::list_simulated_client_profiles).post(api::post_save_simulated_client_profile),
        )
        .route(
            "/simulated-client-profiles/:name",
            get(api::get_simulated_client_profile),
        )
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
            "/show-workspaces/:show_id/venue-shape",
            get(api::get_venue_shape).put(api::put_venue_shape),
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
        .nest("/api/admin", admin_protected)
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
    let url = local_url();
    println!("listening on http://0.0.0.0:{}", PORT);
    println!("admin panel on http://0.0.0.0:{}", ADMIN_PORT);
    if let Some(host) = local_ip() {
        println!("admin panel (local): http://{}:{}", host, ADMIN_PORT);
    }
    print_qr(&url);

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
