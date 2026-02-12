use axum::routing::{any, get, post};
use axum::response::IntoResponse;
use axum::Router;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Arc;
use std::sync::RwLock;
use tower_http::services::ServeDir;

mod api;
mod broadcast;
mod connections;
mod time;
mod timeline_validator;

const PORT: u16 = 3002;
const ADMIN_PORT: u16 = 3010;

/// Prefer local network IP for QR (so phones can scan). Fallback to 127.0.0.1.
fn local_url() -> String {
    let host = local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    format!("http://{}:{}", host, PORT)
}

/// Local IP used for outbound traffic (no extra deps; works with older Cargo).
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
    let registry: Arc<connections::ConnectionRegistry> =
        Arc::new(connections::ConnectionRegistry::new());
    let broadcast_state: Arc<RwLock<broadcast::BroadcastState>> =
        Arc::new(RwLock::new(broadcast::BroadcastState::new()));

    let show_timelines_path = PathBuf::from("./userData/showTimelines");
    if let Err(e) = std::fs::create_dir_all(&show_timelines_path) {
        eprintln!("could not create show timelines dir: {}", e);
    }

    let simulated_client_profiles_path = PathBuf::from("./userData/simulatedClientProfiles");
    if let Err(e) = std::fs::create_dir_all(&simulated_client_profiles_path) {
        eprintln!("could not create simulated client profiles dir: {}", e);
    }

    let admin_state = api::AdminAppState {
        registry: registry.clone(),
        show_timelines_path,
        simulated_client_profiles_path,
        broadcast: broadcast_state.clone(),
    };

    let mut simulated_client_server_child: Option<Child> = match Command::new("node")
        .arg("index.js")
        .current_dir("./simulatedClientServer")
        .spawn()
    {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("warning: could not start simulated client server: {}", e);
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
    let app_admin = Router::new()
        .route("/api/poll", get(api::poll_admin))
        .route("/api/health", get(api::health))
        .route("/api/admin/connected-devices", get(api::get_connected_devices))
        .route("/api/admin/stats", get(api::get_stats))
        .route("/api/admin/connections/reset", post(api::post_reset_connections))
        .route("/api/admin/broadcast/timeline", post(api::post_broadcast_timeline))
        .route("/api/admin/broadcast/play", post(api::post_broadcast_play))
        .route("/api/admin/broadcast/pause", post(api::post_broadcast_pause))
        .route("/api/admin/shows", get(api::list_shows))
        .route("/api/admin/shows/:name", get(api::get_show).put(api::put_show))
        .route(
            "/api/admin/simulated-client-profiles",
            get(api::list_simulated_client_profiles).post(api::post_save_simulated_client_profile),
        )
        .route(
            "/api/admin/simulated-client-profiles/:name",
            get(api::get_simulated_client_profile),
        )
        .with_state(admin_state)
        .route("/timeline", any(serve_admin_index))
        .route("/connectedDevicesList", any(serve_admin_index))
        .route("/connectedDevicesMap", any(serve_admin_index))
        .route("/simulateDevices", any(serve_admin_index))
        .fallback_service(ServeDir::new("dist-admin"));

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
