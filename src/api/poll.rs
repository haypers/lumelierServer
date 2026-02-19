//! # Poll — GET /api/poll
//!
//! Clients (and simulated clients) call this to get server time, device id echo, and optional broadcast
//! (timeline + play/pause). We read X-Device-ID and X-Ping-Ms from headers, upsert the registry, then
//! return JSON with NTP-style timing fields:
//! - clientSendMsEcho (t0, echoed from request header X-Client-Send-Ms)
//! - serverTimeAtRecv (t1)
//! - serverTimeAtSend (t2)
//! plus deviceId, events (empty), and broadcast if set.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Serialize;
use std::sync::Arc;
use std::sync::RwLock;
use uuid::Uuid;

use crate::api::{AdminAppState, MainAppState};
use crate::connections::{ConnectionRegistry, GeoUpdate};
use crate::time;

const MAX_DEVICE_ID_LEN: usize = 255;

#[derive(Serialize)]
pub struct PollEvent {
    pub t: i64,
    pub color: String,
}

#[derive(Serialize)]
pub struct PollBroadcast {
    pub timeline: serde_json::Value,
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

pub async fn poll(
    State(state): State<MainAppState>,
    headers: HeaderMap,
) -> Result<Json<PollResponse>, StatusCode> {
    poll_impl(state.registry.clone(), state.broadcast.clone(), headers).await
}

pub async fn poll_admin(
    State(state): State<AdminAppState>,
    headers: HeaderMap,
) -> Result<Json<PollResponse>, StatusCode> {
    poll_impl(state.registry.clone(), state.broadcast.clone(), headers).await
}

async fn poll_impl(
    registry: Arc<ConnectionRegistry>,
    broadcast: Arc<RwLock<crate::broadcast::BroadcastState>>,
    headers: HeaderMap,
) -> Result<Json<PollResponse>, StatusCode> {
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

    let broadcast_value = {
        let b = broadcast
            .read()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        b.timeline_json.as_ref().map(|json| {
            let timeline: serde_json::Value =
                serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
            PollBroadcast {
                timeline,
                readhead_sec: b.readhead_sec,
                play_at_ms: b.play_at_ms,
                pause_at_ms: b.pause_at_ms,
            }
        })
    };

    let events: Vec<PollEvent> = vec![];

    // NTP t2: capture server send time right before returning.
    let server_time_at_send = time::unix_now_ms();

    let server_processing_ms = server_time_at_send
        .saturating_sub(server_time_at_recv)
        .min(u64::from(u32::MAX)) as u32;
    registry.upsert(
        device_id.clone(),
        now_ms,
        ping_ms,
        Some(server_processing_ms),
        handshake_returned,
        &geo,
    );

    Ok(Json(PollResponse {
        server_time: now_ms,
        server_time_at_recv,
        server_time_at_send,
        client_send_ms_echo: client_send_ms,
        device_id,
        events,
        broadcast: broadcast_value,
    }))
}
