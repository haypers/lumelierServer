//! # Admin API — Connected Devices, Stats, Broadcast, Reset
//!
//! Handlers for admin panel: connected devices list, pagination by page IDs, fetch by IDs, stats,
//! reset connections, and broadcast play/pause/timeline. All use AdminAppState (registry + paths + broadcast).

use axum::extract::Query;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde::Serialize;

use std::cmp::Ordering;

use crate::api::AdminAppState;
use crate::connections::DeviceRow;
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
    #[serde(rename = "lastClientRttMs")]
    pub last_rtt_ms: Option<u32>,
    #[serde(rename = "averageServerProcessingMs")]
    pub average_server_processing_ms: Option<f64>,
    #[serde(rename = "lastServerProcessingMs")]
    pub last_server_processing_ms: Option<u32>,
    #[serde(rename = "disconnectEvents")]
    pub disconnect_events: u32,
    #[serde(rename = "estimatedUptimeMs")]
    pub estimated_uptime_ms: u64,
    #[serde(rename = "timeSinceLastContactMs")]
    pub time_since_last_contact_ms: u64,
    #[serde(rename = "geoLat", skip_serializing_if = "Option::is_none")]
    pub geo_lat: Option<f64>,
    #[serde(rename = "geoLon", skip_serializing_if = "Option::is_none")]
    pub geo_lon: Option<f64>,
    #[serde(rename = "geoAccuracy", skip_serializing_if = "Option::is_none")]
    pub geo_accuracy: Option<f64>,
    #[serde(rename = "geoAlt", skip_serializing_if = "Option::is_none")]
    pub geo_alt: Option<f64>,
    #[serde(rename = "geoAltAccuracy", skip_serializing_if = "Option::is_none")]
    pub geo_alt_accuracy: Option<f64>,
}

#[derive(Serialize)]
pub struct StatsResponse {
    #[serde(rename = "serverTimeMs")]
    pub server_time_ms: u64,
    pub stats: Stats,
}

#[derive(Serialize)]
pub struct ConnectedDevicesResponse {
    #[serde(rename = "serverTimeMs")]
    pub server_time_ms: u64,
    pub stats: Stats,
    pub devices: Vec<DeviceRowResponse>,
}

#[derive(Debug, Deserialize)]
pub struct PageIdsQuery {
    pub page: Option<u32>,
    #[serde(rename = "pageSize")]
    pub page_size: Option<u32>,
    #[serde(rename = "connectedOnly")]
    pub connected_only: Option<u8>,
    #[serde(rename = "sortField")]
    pub sort_field: Option<String>,
    #[serde(rename = "sortDir")]
    pub sort_dir: Option<String>,
}

#[derive(Serialize)]
pub struct PageIdsResponse {
    #[serde(rename = "serverTimeMs")]
    pub server_time_ms: u64,
    pub total_count: u32,
    pub page: u32,
    #[serde(rename = "pageSize")]
    pub page_size: u32,
    pub ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ByIdsBody {
    pub ids: Vec<String>,
}

#[derive(Serialize)]
pub struct ByIdsResponse {
    #[serde(rename = "serverTimeMs")]
    pub server_time_ms: u64,
    pub devices: Vec<DeviceRowResponse>,
}

pub async fn get_stats(
    State(state): State<AdminAppState>,
) -> Result<Json<StatsResponse>, StatusCode> {
    let now_ms = time::unix_now_ms();

    state.registry.tick_disconnects(now_ms);
    let (total_connected, average_ping_ms) = state.registry.list_stats_only(now_ms);

    let stats = Stats {
        total_connected,
        average_ping_ms,
    };

    Ok(Json(StatsResponse {
        server_time_ms: now_ms,
        stats,
    }))
}

pub async fn get_connected_devices(
    State(state): State<AdminAppState>,
) -> Result<Json<ConnectedDevicesResponse>, StatusCode> {
    let now_ms = time::unix_now_ms();

    state.registry.tick_disconnects(now_ms);
    let (total_connected, average_ping_ms, rows) = state.registry.list_with_stats(now_ms);

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
            last_rtt_ms: r.latest_rtt_ms,
            average_server_processing_ms: r.average_server_processing_ms,
            last_server_processing_ms: r.latest_server_processing_ms,
            disconnect_events: r.disconnect_events,
            estimated_uptime_ms: r.estimated_uptime_ms,
            time_since_last_contact_ms: r.time_since_last_contact_ms,
            geo_lat: r.geo_lat,
            geo_lon: r.geo_lon,
            geo_accuracy: r.geo_accuracy,
            geo_alt: r.geo_alt,
            geo_alt_accuracy: r.geo_alt_accuracy,
        })
        .collect();

    Ok(Json(ConnectedDevicesResponse {
        server_time_ms: now_ms,
        stats,
        devices,
    }))
}

pub async fn post_reset_connections(
    State(state): State<AdminAppState>,
) -> Result<StatusCode, StatusCode> {
    let now_ms = time::unix_now_ms();

    state.registry.remove_disconnected(now_ms);
    Ok(StatusCode::OK)
}

fn sort_rows(rows: &mut [DeviceRow], sort_field: &str, sort_asc: bool) {
    rows.sort_by(|a, b| {
        let cmp = match sort_field {
            "deviceId" => a.device_id.cmp(&b.device_id),
            "firstConnectedAt" => a.first_connected_at_ms.cmp(&b.first_connected_at_ms),
            "averagePingMs" => compare_option_f64(a.average_ping_ms, b.average_ping_ms),
            "lastClientRttMs" => compare_option_u32(a.latest_rtt_ms, b.latest_rtt_ms),
            "averageServerProcessingMs" => compare_option_f64(
                a.average_server_processing_ms,
                b.average_server_processing_ms,
            ),
            "lastServerProcessingMs" => compare_option_u32(
                a.latest_server_processing_ms,
                b.latest_server_processing_ms,
            ),
            "timeSinceLastContactMs" => {
                a.time_since_last_contact_ms.cmp(&b.time_since_last_contact_ms)
            }
            "disconnectEvents" => a.disconnect_events.cmp(&b.disconnect_events),
            "estimatedUptimeMs" => a.estimated_uptime_ms.cmp(&b.estimated_uptime_ms),
            "connectionStatus" => a.connection_status.cmp(&b.connection_status),
            "geoLat" => compare_option_f64(a.geo_lat, b.geo_lat),
            "geoLon" => compare_option_f64(a.geo_lon, b.geo_lon),
            "geoAccuracy" => compare_option_f64(a.geo_accuracy, b.geo_accuracy),
            "geoAlt" => compare_option_f64(a.geo_alt, b.geo_alt),
            "geoAltAccuracy" => compare_option_f64(a.geo_alt_accuracy, b.geo_alt_accuracy),
            _ => a.device_id.cmp(&b.device_id),
        };
        if sort_asc {
            cmp
        } else {
            cmp.reverse()
        }
    });
}

fn compare_option_f64(a: Option<f64>, b: Option<f64>) -> Ordering {
    match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(Ordering::Equal),
    }
}

fn compare_option_u32(a: Option<u32>, b: Option<u32>) -> Ordering {
    match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(x), Some(y)) => x.cmp(&y),
    }
}

pub async fn get_page_ids(
    State(state): State<AdminAppState>,
    Query(q): Query<PageIdsQuery>,
) -> Result<Json<PageIdsResponse>, StatusCode> {
    let now_ms = time::unix_now_ms();
    state.registry.tick_disconnects(now_ms);

    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(10);
    let connected_only = q.connected_only.map(|v| v == 1).unwrap_or(false);
    let sort_field = q
        .sort_field
        .as_deref()
        .unwrap_or("timeSinceLastContactMs");
    let sort_asc = matches!(q.sort_dir.as_deref(), Some("asc") | None);

    let mut rows = state.registry.list_rows_filtered(now_ms, connected_only);
    sort_rows(&mut rows, sort_field, sort_asc);

    let total_count = rows.len() as u32;
    let ids: Vec<String> = if page_size == 0 {
        rows.into_iter().map(|r| r.device_id).collect()
    } else {
        let offset = ((page - 1) as usize) * (page_size as usize);
        rows.into_iter()
            .skip(offset)
            .take(page_size as usize)
            .map(|r| r.device_id)
            .collect()
    };

    Ok(Json(PageIdsResponse {
        server_time_ms: now_ms,
        total_count,
        page,
        page_size,
        ids,
    }))
}

pub async fn post_by_ids(
    State(state): State<AdminAppState>,
    Json(body): Json<ByIdsBody>,
) -> Result<Json<ByIdsResponse>, StatusCode> {
    let now_ms = time::unix_now_ms();
    state.registry.tick_disconnects(now_ms);

    let rows = state.registry.rows_by_ids(now_ms, &body.ids);
    let devices = rows
        .into_iter()
        .map(|r| DeviceRowResponse {
            device_id: r.device_id,
            connection_status: r.connection_status,
            first_connected_at_ms: r.first_connected_at_ms,
            average_ping_ms: r.average_ping_ms,
            last_rtt_ms: r.latest_rtt_ms,
            average_server_processing_ms: r.average_server_processing_ms,
            last_server_processing_ms: r.latest_server_processing_ms,
            disconnect_events: r.disconnect_events,
            estimated_uptime_ms: r.estimated_uptime_ms,
            time_since_last_contact_ms: r.time_since_last_contact_ms,
            geo_lat: r.geo_lat,
            geo_lon: r.geo_lon,
            geo_accuracy: r.geo_accuracy,
            geo_alt: r.geo_alt,
            geo_alt_accuracy: r.geo_alt_accuracy,
        })
        .collect();

    Ok(Json(ByIdsResponse {
        server_time_ms: now_ms,
        devices,
    }))
}
