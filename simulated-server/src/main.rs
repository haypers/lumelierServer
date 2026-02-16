//! # Simulated Client Server — Entry Point
//!
//! This binary runs a small HTTP server that:
//! 1. **Stores** simulated client configs (distribution curves, device IDs, etc.) in memory.
//! 2. **Runs** a background "runner" that pretends to be many clients: it polls the main server,
//!    applies delays and lag spikes from the distributions, and updates display/clock state.
//! 3. **Exposes HTTP routes** so the admin UI can create clients, get summaries, get full client
//!    details (including runner timers), patch config, and sample from distributions.
//!
//! No database: everything is in-memory. Restarting the server clears all simulated clients.

// Declare the other source modules (each is a separate file in this crate).
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

/// Program entry point. `#[tokio::main]` turns this into an async runtime and runs it.
#[tokio::main]
async fn main() {
    // Read port from env or default to 3003. `.ok()` turns Result into Option; `.and_then(|s| s.parse().ok())` parses the string to u16.
    let port: u16 = std::env::var("SIMULATED_CLIENT_SERVER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3003);

    // URL of the main Lumelier server that simulated clients will poll (GET /api/poll).
    let main_server_url: String = std::env::var("MAIN_SERVER_URL")
        .or_else(|_| std::env::var("LUMELIER_POLL_BASE_URL"))
        .unwrap_or_else(|_| "http://127.0.0.1:3002".to_string());

    // Arc = atomic reference count. Multiple tasks can share the same store/runner_state; cloning Arc just increments the count.
    let store = Arc::new(SimulatedStore::new());
    let runner_state = Arc::new(RunnerState::new());

    // Build config for the runner (passed into the background task).
    let config = RunnerConfig {
        main_server_url: main_server_url.clone(),
        store: store.clone(),
        runner_state: runner_state.clone(),
    };
    // Spawn the runner as a separate async task. It runs forever, ticking and driving poll/lag/display loops.
    tokio::spawn(async move {
        run_runner(config).await;
    });

    // Build the Axum web app (routes + shared state) and bind to 0.0.0.0 so it's reachable from other machines.
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
