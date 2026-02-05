mod admin;
mod poll;

pub use admin::{get_connected_devices, get_stats, post_reset_connections};
pub use poll::poll;
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    pub ok: bool,
}

pub async fn health() -> axum::Json<HealthResponse> {
    axum::Json(HealthResponse { ok: true })
}
