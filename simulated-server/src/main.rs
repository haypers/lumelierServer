mod client_sync;
mod distribution;
mod routes;
mod runner;
mod runner_state;
mod store;

use std::net::SocketAddr;
use std::sync::Arc;

use runner::{run_runner, RunnerConfig};
use runner_state::RunnerState;
use store::SimulatedStore;

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("SIMULATED_CLIENT_SERVER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3003);

    let main_server_url: String = std::env::var("MAIN_SERVER_URL")
        .or_else(|_| std::env::var("LUMELIER_POLL_BASE_URL"))
        .unwrap_or_else(|_| "http://127.0.0.1:3002".to_string());

    let store = Arc::new(SimulatedStore::new());
    let runner_state = Arc::new(RunnerState::new());

    let config = RunnerConfig {
        main_server_url: main_server_url.clone(),
        store: store.clone(),
        runner_state: runner_state.clone(),
    };
    tokio::spawn(async move {
        run_runner(config).await;
    });

    let app = routes::simulated_app(store, runner_state);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    println!(
        "Simulated client server listening on http://0.0.0.0:{}",
        port
    );
    println!("Runner polling main server at {}", main_server_url);
    axum::serve(listener, app).await.expect("serve failed");
}
