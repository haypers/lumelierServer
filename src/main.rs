use axum::routing::get;
use axum::Router;
use std::net::SocketAddr;
use tower_http::services::ServeDir;

mod api;

const PORT: u16 = 3000;
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
    let code = match qrcode::QrCode::new(url.as_bytes()) {
        Ok(c) => c,
        Err(_) => {
            eprintln!("could not generate QR code for URL");
            return;
        }
    };
    // Terminal-friendly: block chars, one line of quiet zone above/below
    let body = code.to_debug_str('█', ' ');
    let width = body.lines().next().map(str::len).unwrap_or(0);
    let quiet = " ".repeat(width);
    println!("\nScan to join from a phone on the same network:\n");
    println!("{}", quiet);
    println!("{}", body);
    println!("{}", quiet);
    println!("{}\n", url);
}

#[tokio::main]
async fn main() {
    let app_main = Router::new()
        .route("/api/health", get(api::health))
        .route("/api/poll", get(api::poll))
        .fallback_service(ServeDir::new("dist"));

    let app_admin = Router::new().fallback_service(ServeDir::new("dist-admin"));

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
    r1.expect("main server failed");
    r2.expect("admin server failed");
}
