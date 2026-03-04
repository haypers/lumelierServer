//! # Simulated Client Server — Entry Point
//!
//! This binary runs a small HTTP server that:
//! 1. **Stores** simulated client configs (distribution curves, device IDs, etc.) in memory.
//! 2. **Runs** a background "runner" that pretends to be many clients: it polls the main server,
//!    applies delays and lag spikes from the distributions, and updates display/clock state.
//! 3. **Exposes HTTP routes** so the admin UI can create clients, get summaries, get full client
//!    details (including runner timers), patch config, and sample from distributions.
//!
//! **Per-show buckets:** We only keep a "bucket" (store + runner state) for shows that are
//! currently live. When a show is no longer live, we drop its bucket to free memory. We learn
//! which shows are live in two ways: (1) the admin server POSTs to us when a show goes live or
//! ends (real-time), and (2) we poll GET /api/admin/live-show-ids every 10 seconds as a fallback.
//!
//! No database: everything is in-memory. Restarting the server clears all simulated clients.

// Declare the other source modules (each is a separate file in this crate).
mod client_sync;
mod distribution;
mod per_show;
mod routes;
mod runner;
mod runner_state;
mod store;

use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use per_show::PerShowSimulatedState;
use runner::{run_runner, RunnerConfig};

/// Response shape from GET /api/admin/live-show-ids (admin server). We poll this every 10s to
/// stay in sync with which shows are live, and we also receive real-time POSTs from the admin
/// when a show goes live or ends.
#[derive(serde::Deserialize)]
struct LiveShowIdsResponse {
    #[serde(rename = "show_ids")]
    show_ids: Vec<String>,
}

/// Program entry point. `#[tokio::main]` turns this into an async runtime and runs it.
#[tokio::main]
async fn main() {
    // --- Configuration from environment ---
    // Port this server listens on (default 3003).
    let port: u16 = std::env::var("SIMULATED_CLIENT_SERVER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3003);

    // URL of the main Lumelier server (port 3002). Simulated clients will poll GET /api/poll?show=:id there.
    let main_server_url: String = std::env::var("MAIN_SERVER_URL")
        .or_else(|_| std::env::var("LUMELIER_POLL_BASE_URL"))
        .unwrap_or_else(|_| "http://127.0.0.1:3002".to_string());

    // URL of the admin server (port 3010). We poll GET /api/admin/live-show-ids here every 10s to know which shows are live.
    // The admin also POSTs to us at /notify/show-live and /notify/show-ended for real-time updates.
    let admin_server_url: String =
        std::env::var("ADMIN_SERVER_URL").unwrap_or_else(|_| "http://127.0.0.1:3010".to_string());

    // --- Per-show state: one bucket per live show ---
    // Each bucket holds the simulated client store and runner state for that show. When a show is
    // no longer live, we remove its entry here so the bucket is dropped and memory is freed.
    let per_show: Arc<DashMap<String, Arc<PerShowSimulatedState>>> = Arc::new(DashMap::new());

    // --- Background task: 10-second poll of admin for live show IDs (fallback / reconciliation) ---
    // We also receive real-time POSTs from the admin when a show goes live or ends (see routes:
    // POST /notify/show-live and POST /notify/show-ended). This poll ensures we stay in sync if
    // a notify was missed or the simulated server was restarted. Every 10 seconds we:
    // 1. GET the admin's list of live show IDs.
    // 2. Remove any bucket for a show_id not in that list (show ended; free memory).
    // 3. Ensure a bucket exists for every show_id in the list (create if missing).
    {
        let per_show_clone = per_show.clone();
        let admin_url = admin_server_url.clone();
        tokio::spawn(async move {
            let client = match reqwest::Client::builder().build() {
                Ok(c) => c,
                Err(_) => return,
            };
            let mut interval = tokio::time::interval(Duration::from_secs(10));
            loop {
                interval.tick().await;
                let url = format!("{}/api/admin/live-show-ids", admin_url.trim_end_matches('/'));
                let res = match client.get(&url).send().await {
                    Ok(r) => r,
                    Err(_) => continue, // e.g. admin down; leave map unchanged
                };
                let body: LiveShowIdsResponse = match res.json().await {
                    Ok(b) => b,
                    Err(_) => continue, // e.g. 401/404 body not JSON; leave map unchanged
                };
                let live_set: HashSet<String> = body.show_ids.into_iter().collect();
                // Drop buckets for shows that are no longer live (frees memory).
                per_show_clone.retain(|show_id, _| live_set.contains(show_id));
                // Ensure a bucket exists for every currently live show.
                for show_id in &live_set {
                    per_show_clone
                        .entry(show_id.clone())
                        .or_insert_with(|| Arc::new(PerShowSimulatedState::new()));
                }
            }
        });
    }

    let config = RunnerConfig {
        main_server_url: main_server_url.clone(),
        per_show: per_show.clone(),
    };
    tokio::spawn(async move {
        run_runner(config).await;
    });

    let app = routes::simulated_app(per_show);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    println!(
        "Simulated client server listening on http://0.0.0.0:{}",
        port
    );
    println!("Runner polling main server at {}", main_server_url);
    println!("Live-show sync polling admin at {}", admin_server_url);
    axum::serve(listener, app).await.expect("serve failed");
}
