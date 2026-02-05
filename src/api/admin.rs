use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use std::sync::Arc;
use std::sync::RwLock;

use crate::connections::ConnectionRegistry;
use crate::time;

#[derive(Serialize)]
pub struct Stats {
    pub total_connected: u32,
    #[serde(rename = "averagePingMs")]
    pub average_ping_ms: Option<f64>,
}

#[derive(Serialize)]
pub struct DeviceRowResponse {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "connectionStatus")]
    pub connection_status: String,
    #[serde(rename = "firstConnectedAt")]
    pub first_connected_at_ms: u64,
    #[serde(rename = "averagePingMs")]
    pub average_ping_ms: Option<f64>,
    #[serde(rename = "disconnectEvents")]
    pub disconnect_events: u32,
    #[serde(rename = "estimatedUptimeMs")]
    pub estimated_uptime_ms: u64,
    #[serde(rename = "timeSinceLastContactMs")]
    pub time_since_last_contact_ms: u64,
}

#[derive(Serialize)]
pub struct ConnectedDevicesResponse {
    pub stats: Stats,
    pub devices: Vec<DeviceRowResponse>,
}

pub async fn get_connected_devices(
    State(registry): State<Arc<RwLock<ConnectionRegistry>>>,
) -> Result<Json<ConnectedDevicesResponse>, StatusCode> {
    let now_ms = time::unix_now_ms();

    let mut guard = registry
        .write()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    guard.tick_disconnects(now_ms);
    let (total_connected, average_ping_ms, rows) = guard.list_with_stats(now_ms);

    let stats = Stats {
        total_connected,
        average_ping_ms,
    };
    let devices = rows
        .into_iter()
        .map(|r| DeviceRowResponse {
            device_id: r.device_id,
            connection_status: r.connection_status,
            first_connected_at_ms: r.first_connected_at_ms,
            average_ping_ms: r.average_ping_ms,
            disconnect_events: r.disconnect_events,
            estimated_uptime_ms: r.estimated_uptime_ms,
            time_since_last_contact_ms: r.time_since_last_contact_ms,
        })
        .collect();

    Ok(Json(ConnectedDevicesResponse { stats, devices }))
}

pub async fn post_reset_connections(
    State(registry): State<Arc<RwLock<ConnectionRegistry>>>,
) -> Result<StatusCode, StatusCode> {
    let now_ms = time::unix_now_ms();

    registry
        .write()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .remove_disconnected(now_ms);
    Ok(StatusCode::OK)
}
