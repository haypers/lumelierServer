mod admin;
mod broadcast;
mod poll;
mod shows;
mod simulated_profiles;

pub use admin::{
    get_connected_devices, get_stats, post_reset_connections,
    post_start_simulated_client_server,
};
pub use broadcast::{post_broadcast_pause, post_broadcast_play, post_broadcast_timeline};
pub use poll::{poll, poll_admin};
pub use shows::{get_show, list_shows, put_show};
pub use simulated_profiles::{
    get_simulated_client_profile, list_simulated_client_profiles, post_save_simulated_client_profile,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::RwLock;

use crate::connections::ConnectionRegistry;

/// Shared state for the app on port 3002 (poll, health).
#[derive(Clone)]
pub struct MainAppState {
    pub registry: Arc<ConnectionRegistry>,
    pub broadcast: Arc<RwLock<crate::broadcast::BroadcastState>>,
}

/// Shared state for the admin app (registry + show timelines storage path + broadcast + simulated client profiles path).
#[derive(Clone)]
pub struct AdminAppState {
    pub registry: Arc<ConnectionRegistry>,
    pub show_timelines_path: PathBuf,
    pub simulated_client_profiles_path: PathBuf,
    pub broadcast: Arc<RwLock<crate::broadcast::BroadcastState>>,
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub ok: bool,
}

pub async fn health() -> axum::Json<HealthResponse> {
    axum::Json(HealthResponse { ok: true })
}
