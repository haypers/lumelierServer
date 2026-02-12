mod distribution;
mod routes;
mod store;

use std::net::SocketAddr;
use std::sync::Arc;

use store::SimulatedStore;

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("SIMULATED_CLIENT_SERVER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3003);

    let store = Arc::new(SimulatedStore::new());
    let app = routes::simulated_app(store);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    println!(
        "Simulated client server listening on http://0.0.0.0:{}",
        port
    );
    axum::serve(listener, app).await.expect("serve failed");
}
