//! # Poll — GET /api/poll
//!
//! Clients (and simulated clients) call this to get server time, device id echo, and optional broadcast
//! (timeline + play/pause). We read X-Device-ID and X-Ping-Ms from headers, upsert the registry, then
//! return JSON with NTP-style timing fields:
//! - clientSendMsEcho (t0, echoed from request header X-Client-Send-Ms)
//! - serverTimeAtRecv (t1)
//! - serverTimeAtSend (t2)
//! plus deviceId, events (empty), and broadcast if set.

use axum::extract::{Query, State};
use axum::http::header::HeaderValue;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::api::{is_valid_show_id_format, AdminAppState, MainAppState};
use crate::connections::GeoUpdate;
use crate::live_shows::LiveShowState;
use crate::time;
use crate::track_splitter_tree;

const MAX_DEVICE_ID_LEN: usize = 255;

#[derive(Serialize)]
pub struct PollEvent {
    pub t: i64,
    pub color: String,
}

#[derive(Serialize)]
pub struct PollBroadcast {
    pub timeline: Arc<serde_json::Value>,
    #[serde(rename = "readheadSec")]
    pub readhead_sec: f64,
    #[serde(rename = "playAtMs", skip_serializing_if = "Option::is_none")]
    pub play_at_ms: Option<u64>,
    #[serde(rename = "pauseAtMs", skip_serializing_if = "Option::is_none")]
    pub pause_at_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct PollResponse {
    #[serde(rename = "serverTime")]
    pub server_time: u64,
    /// Server time taken at request receipt (t1).
    #[serde(rename = "serverTimeAtRecv")]
    pub server_time_at_recv: u64,
    /// Server time taken right before sending the response; use with RTT/2 for better sync.
    #[serde(rename = "serverTimeAtSend")]
    pub server_time_at_send: u64,
    /// Echo of X-Client-Send-Ms (t0). Useful for debugging client/server timestamp pairing.
    #[serde(rename = "clientSendMsEcho")]
    pub client_send_ms_echo: u64,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    pub events: Vec<PollEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub broadcast: Option<PollBroadcast>,
}

/// Prefer client-sent X-Device-ID (stable UID per device). Otherwise generate a new UUID.
/// Returns (device_id, handshake_returned).
fn device_id_from_headers(headers: &HeaderMap) -> (String, bool) {
    if let Some(v) = headers.get("x-device-id") {
        if let Ok(s) = v.to_str() {
            let s = s.trim();
            if !s.is_empty() {
                return (s.to_string(), true);
            }
        }
    }
    (Uuid::new_v4().to_string(), false)
}

/// Parse X-Ping-Ms header as u32 (client's last RTT in ms).
fn ping_ms_from_headers(headers: &HeaderMap) -> Option<u32> {
    let v = headers.get("x-ping-ms")?;
    let s = v.to_str().ok()?.trim();
    s.parse().ok()
}

/// Parse X-Client-Send-Ms header as u64 (client timestamp t0 in epoch ms).
fn client_send_ms_from_headers(headers: &HeaderMap) -> Option<u64> {
    let v = headers.get("x-client-send-ms")?;
    let s = v.to_str().ok()?.trim();
    s.parse().ok()
}

fn parse_geo_header(headers: &HeaderMap, name: &str) -> Option<f64> {
    let v = headers.get(name)?;
    let s = v.to_str().ok()?.trim();
    s.parse().ok()
}

/// Build GeoUpdate from X-Geo-* headers (case-insensitive).
fn geo_from_headers(headers: &HeaderMap) -> GeoUpdate {
    GeoUpdate {
        lat: parse_geo_header(headers, "x-geo-lat"),
        lon: parse_geo_header(headers, "x-geo-lon"),
        accuracy: parse_geo_header(headers, "x-geo-accuracy"),
        alt: parse_geo_header(headers, "x-geo-alt"),
        alt_accuracy: parse_geo_header(headers, "x-geo-alt-accuracy"),
    }
}

/// Filter timeline to only the layer and items for the given 1-based track index.
/// If layers are missing/empty or index is out of range, returns the full timeline unchanged.
fn filter_timeline_by_track(timeline: &serde_json::Value, track_index: u32) -> Arc<serde_json::Value> {
    let obj = match timeline.as_object() {
        Some(o) => o,
        None => return Arc::new(timeline.clone()),
    };
    let layers = match obj.get("layers").and_then(|v| v.as_array()) {
        Some(a) if !a.is_empty() => a,
        _ => return Arc::new(timeline.clone()),
    };
    let track_idx = (track_index as usize).saturating_sub(1);
    let layer = match layers.get(track_idx) {
        Some(l) => l,
        None => return Arc::new(timeline.clone()),
    };
    let layer_id = match layer.get("id").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return Arc::new(timeline.clone()),
    };
    let items = match obj.get("items").and_then(|v| v.as_array()) {
        Some(arr) => arr
            .iter()
            .filter(|it| it.get("layerId").and_then(|v| v.as_str()) == Some(layer_id))
            .cloned()
            .collect::<Vec<_>>(),
        None => vec![],
    };
    // Preserve other top-level keys from the original (e.g. version) if any
    let mut out = serde_json::Map::new();
    for (k, v) in obj.iter() {
        if k != "layers" && k != "items" {
            out.insert(k.clone(), v.clone());
        }
    }
    out.insert("layers".to_string(), serde_json::Value::Array(vec![layer.clone()]));
    out.insert("items".to_string(), serde_json::Value::Array(items));
    Arc::new(serde_json::Value::Object(out))
}

#[derive(Deserialize)]
pub struct PollQuery {
    pub show: Option<String>,
}

/// Extract show_id from query ?show= or header X-Show-Id. Returns None if both missing.
fn show_id_from_request(query: &PollQuery, headers: &HeaderMap) -> Option<String> {
    query
        .show
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| {
            headers
                .get("x-show-id")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
}

pub async fn poll(
    State(state): State<MainAppState>,
    Query(query): Query<PollQuery>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let show_id = show_id_from_request(&query, &headers)
        .ok_or(StatusCode::BAD_REQUEST)?;
    if !is_valid_show_id_format(&show_id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let bucket = state
        .live_shows
        .get(&show_id)
        .ok_or(StatusCode::NOT_FOUND)?;
    poll_impl(bucket, headers).await
}

pub async fn poll_admin(
    State(state): State<AdminAppState>,
    Query(query): Query<PollQuery>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let show_id = show_id_from_request(&query, &headers)
        .ok_or(StatusCode::BAD_REQUEST)?;
    if !is_valid_show_id_format(&show_id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let bucket = state
        .live_shows
        .get(&show_id)
        .ok_or(StatusCode::NOT_FOUND)?;
    poll_impl(bucket, headers).await
}

async fn poll_impl(
    bucket: Arc<LiveShowState>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let registry = &bucket.registry;
    let broadcast = &bucket.broadcast;

    // NTP t1: capture server receive time as early as possible.
    let server_time_at_recv = time::unix_now_ms();
    let client_send_ms = client_send_ms_from_headers(&headers).ok_or(StatusCode::BAD_REQUEST)?;
    let now_ms = server_time_at_recv;

    let (device_id, handshake_returned) = device_id_from_headers(&headers);
    if device_id.len() > MAX_DEVICE_ID_LEN {
        return Err(StatusCode::BAD_REQUEST);
    }
    let ping_ms = ping_ms_from_headers(&headers);
    let geo = geo_from_headers(&headers);
    let has_gps_now = geo.lat.is_some() && geo.lon.is_some();

    let had_gps_before = registry.get_is_sending_gps(&device_id);

    let server_processing_ms = {
        let server_time_at_send = time::unix_now_ms();
        server_time_at_send
            .saturating_sub(server_time_at_recv)
            .min(u64::from(u32::MAX)) as u32
    };
    let is_new = registry.upsert(
        device_id.clone(),
        now_ms,
        ping_ms,
        Some(server_processing_ms),
        handshake_returned,
        &geo,
    );

    let should_assign = is_new || (had_gps_before != Some(has_gps_now));
    if should_assign {
        let tree_opt = bucket.track_splitter_tree.load_full();
        let track = if let Some(tree) = tree_opt.as_ref().as_ref() {
            let mut rng = rand::rngs::OsRng;
            track_splitter_tree::evaluate(tree, has_gps_now, &mut rng)
        } else {
            1
        };
        registry.set_track_index(&device_id, track);
    }

    // Device state (including track) comes from the same ConnectionRegistry used by the admin API—single source of truth.
    let track_index = registry.get_track_index(&device_id);

    let snap = broadcast.load_full();
    let broadcast_value = snap.timeline_parsed.as_ref().map(|timeline| {
        let filtered_timeline = filter_timeline_by_track(timeline, track_index);
        PollBroadcast {
            timeline: filtered_timeline,
            readhead_sec: snap.readhead_sec,
            play_at_ms: snap.play_at_ms,
            pause_at_ms: snap.pause_at_ms,
        }
    });

    let events: Vec<PollEvent> = vec![];
    let server_time_at_send = time::unix_now_ms();

    let body = PollResponse {
        server_time: now_ms,
        server_time_at_recv,
        server_time_at_send,
        client_send_ms_echo: client_send_ms,
        device_id,
        events,
        broadcast: broadcast_value,
    };

    let mut response = Json(body).into_response();
    response.headers_mut().insert(
        "X-Track-Id",
        HeaderValue::from_str(&track_index.to_string()).expect("track index is valid header value"),
    );
    Ok(response)
}
