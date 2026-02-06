mod admin;
mod poll;
mod shows;

pub use admin::{get_connected_devices, get_stats, post_reset_connections};
pub use poll::poll;
pub use shows::{get_show, list_shows, put_show};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::RwLock;

use crate::connections::ConnectionRegistry;

/// Shared state for the admin app (registry + show timelines storage path).
#[derive(Clone)]
pub struct AdminAppState {
    pub registry: Arc<RwLock<ConnectionRegistry>>,
    pub show_timelines_path: PathBuf,
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub ok: bool,
}

pub async fn health() -> axum::Json<HealthResponse> {
    axum::Json(HealthResponse { ok: true })
}
