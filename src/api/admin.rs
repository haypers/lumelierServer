//! # Admin API — Connected Devices, Stats, Broadcast, Reset
//!
//! Show-scoped handlers: resolve bucket from live_shows after check_show_access; 404 if show not live.

use axum::extract::Path;
use axum::extract::Query;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde::Serialize;
use std::sync::Arc;

use crate::api::{check_show_access, is_valid_show_id_format, AdminAppState};
use crate::auth;
use crate::live_shows::LiveShowState;
use crate::time;

/// Resolve live show bucket: validate show_id, auth, check_show_access, then get bucket. Returns 404 if not live.
pub async fn resolve_show_bucket(
    state: &AdminAppState,
    show_id: &str,
    headers: &HeaderMap,
) -> Result<Arc<LiveShowState>, StatusCode> {
    if !is_valid_show_id_format(show_id) {
        return Err(StatusCode::NOT_FOUND);
    }
    let session_id = auth::parse_session_cookie(headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(state, &username, show_id).await?;
    state
        .live_shows
        .get(show_id)
        .ok_or(StatusCode::NOT_FOUND)
}

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
    #[serde(rename = "isSendingGps")]
    pub is_sending_gps: bool,
    #[serde(rename = "trackIndex")]
    pub track_index: u32,
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

/// Page sizes allowed for get_page_ids; must match the Connected Devices admin dropdown (10, 20, 50).
const ALLOWED_PAGE_SIZES: &[u32] = &[10, 20, 50];

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
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<StatsResponse>, StatusCode> {
    let bucket = resolve_show_bucket(&state, &show_id, &headers).await?;
    let now_ms = time::unix_now_ms();
    let (total_connected, average_ping_ms) = bucket.registry.list_stats_only(now_ms);
    let stats = Stats {
        total_connected,
        average_ping_ms,
    };
    Ok(Json(StatsResponse {
        server_time_ms: now_ms,
        stats,
    }))
}

/// Full device list (and CSV export in the frontend) is intended for practice runs, not production;
/// the server is often used for practice when export might be used.
pub async fn get_connected_devices(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ConnectedDevicesResponse>, StatusCode> {
    let bucket = resolve_show_bucket(&state, &show_id, &headers).await?;
    let now_ms = time::unix_now_ms();
    let (total_connected, average_ping_ms, rows) = bucket.registry.list_with_stats(now_ms);
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
            is_sending_gps: r.is_sending_gps,
            track_index: r.track_index,
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
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let bucket = resolve_show_bucket(&state, &show_id, &headers).await?;
    let username = state.auth.sessions.get(&session_id).await.unwrap_or_default();
    state.log.log_server_and_show(
        &show_id,
        "ADMIN",
        "ResetConnections",
        &format!("show_id={} username={}", show_id, username),
    );
    let now_ms = time::unix_now_ms();
    bucket.registry.remove_disconnected(now_ms);
    Ok(StatusCode::OK)
}

pub async fn get_page_ids(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    Query(q): Query<PageIdsQuery>,
) -> Result<Json<PageIdsResponse>, StatusCode> {
    let bucket = resolve_show_bucket(&state, &show_id, &headers).await?;
    let now_ms = time::unix_now_ms();
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q
        .page_size
        .unwrap_or(10);
    let page_size = if ALLOWED_PAGE_SIZES.contains(&page_size) {
        page_size
    } else {
        return Err(StatusCode::BAD_REQUEST);
    };
    let connected_only = q.connected_only.map(|v| v == 1).unwrap_or(false);
    let sort_field = q
        .sort_field
        .as_deref()
        .unwrap_or("timeSinceLastContactMs");
    let sort_asc = matches!(q.sort_dir.as_deref(), Some("asc") | None);
    let (total_count, ids) = bucket.registry.list_page_ids(
        now_ms,
        connected_only,
        sort_field,
        sort_asc,
        page,
        page_size,
    );

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
    Path(show_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ByIdsBody>,
) -> Result<Json<ByIdsResponse>, StatusCode> {
    let bucket = resolve_show_bucket(&state, &show_id, &headers).await?;
    let now_ms = time::unix_now_ms();
    let rows = bucket.registry.rows_by_ids(now_ms, &body.ids);
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
            is_sending_gps: r.is_sending_gps,
            track_index: r.track_index,
        })
        .collect();

    Ok(Json(ByIdsResponse {
        server_time_ms: now_ms,
        devices,
    }))
}
