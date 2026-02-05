use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Serialize;
use std::sync::Arc;
use std::sync::RwLock;
use uuid::Uuid;

use crate::time;

use crate::connections::ConnectionRegistry;

#[derive(Serialize)]
pub struct PollEvent {
    pub t: i64,
    pub color: String,
}

#[derive(Serialize)]
pub struct PollResponse {
    #[serde(rename = "serverTime")]
    pub server_time: u64,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    pub events: Vec<PollEvent>,
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

fn ping_ms_from_headers(headers: &HeaderMap) -> Option<u32> {
    let v = headers.get("x-ping-ms")?;
    let s = v.to_str().ok()?.trim();
    s.parse().ok()
}

pub async fn poll(
    State(registry): State<Arc<RwLock<ConnectionRegistry>>>,
    headers: HeaderMap,
) -> Result<Json<PollResponse>, StatusCode> {
    let now_ms = time::unix_now_ms();

    let (device_id, handshake_returned) = device_id_from_headers(&headers);
    let ping_ms = ping_ms_from_headers(&headers);
    registry
        .write()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .upsert(device_id.clone(), now_ms, ping_ms, handshake_returned);

    let events = vec![PollEvent {
        t: 0,
        color: "#ff0000".to_string(),
    }];

    Ok(Json(PollResponse {
        server_time: now_ms,
        device_id,
        events,
    }))
}
