//! # Broadcast API — Timeline, Play, Pause (show-scoped)
//!
//! All handlers resolve live show bucket; 404 if show not live.

use axum::extract::Path;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::api::admin::resolve_show_bucket;
use crate::api::show_workspaces::merge_requests_gps_into_timeline;
use crate::api::AdminAppState;
use crate::broadcast::BroadcastSnapshot;
use crate::time;
use crate::timeline_validator;

#[derive(Deserialize)]
pub struct PlayBody {
    #[serde(rename = "readheadSec")]
    pub readhead_sec: f64,
}

#[derive(Serialize)]
pub struct PlayResponse {
    #[serde(rename = "playAtMs")]
    pub play_at_ms: u64,
    #[serde(rename = "serverTimeMs")]
    pub server_time_ms: u64,
}

#[derive(Serialize)]
pub struct PauseResponse {
    #[serde(rename = "pauseAtMs")]
    pub pause_at_ms: u64,
    #[serde(rename = "serverTimeMs")]
    pub server_time_ms: u64,
}

#[derive(Deserialize)]
pub struct ReadheadBody {
    #[serde(rename = "readheadSec")]
    pub readhead_sec: f64,
}

#[derive(Serialize)]
pub struct ReadheadResponse {
    #[serde(rename = "readheadSec")]
    pub readhead_sec: f64,
    #[serde(rename = "serverTimeMs")]
    pub server_time_ms: u64,
}

const SCHEDULED_DELAY_MS: u64 = 1000;

pub async fn post_broadcast_timeline(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<StatusCode, StatusCode> {
    let bucket = resolve_show_bucket(&state, &show_id, &headers).await?;
    if timeline_validator::validate_broadcast_timeline(body.as_ref()).is_err() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let json = String::from_utf8(body.to_vec()).map_err(|_| StatusCode::BAD_REQUEST)?;
    let mut parsed: serde_json::Value =
        serde_json::from_str(&json).map_err(|_| StatusCode::BAD_REQUEST)?;
    merge_requests_gps_into_timeline(&state, &show_id, &mut parsed).await;
    let readhead_sec = parsed
        .get("readheadSec")
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite())
        .map(|v| v.max(0.0))
        .unwrap_or(0.0);
    let json_merged = serde_json::to_string(&parsed).unwrap_or(json);
    let next = BroadcastSnapshot {
        timeline_raw: Some(Arc::from(json_merged.into_boxed_str())),
        timeline_parsed: Some(Arc::new(parsed)),
        readhead_sec,
        play_at_ms: None,
        pause_at_ms: None,
    };
    bucket.broadcast.store(Arc::new(next));
    Ok(StatusCode::OK)
}

pub async fn post_broadcast_play(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<PlayBody>,
) -> Result<Json<PlayResponse>, StatusCode> {
    let bucket = resolve_show_bucket(&state, &show_id, &headers).await?;
    let now_ms = time::unix_now_ms();
    let play_at_ms = now_ms + SCHEDULED_DELAY_MS;
    let readhead_sec = body.readhead_sec;
    println!("User hit play from {} (readhead sec).", readhead_sec);
    println!("Planning to start playing timeline at {} (unix ms)", play_at_ms);
    println!("Starting to send json to all clients");
    let current = bucket.broadcast.load_full();
    let next = BroadcastSnapshot {
        timeline_raw: current.timeline_raw.clone(),
        timeline_parsed: current.timeline_parsed.clone(),
        play_at_ms: Some(play_at_ms),
        readhead_sec,
        pause_at_ms: None,
    };
    bucket.broadcast.store(Arc::new(next));
    println!("Finished sending to all clients");
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(SCHEDULED_DELAY_MS)).await;
        println!("All clients should have started playing the timeline now.");
    });

    Ok(Json(PlayResponse {
        play_at_ms,
        server_time_ms: now_ms,
    }))
}

pub async fn post_broadcast_pause(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<PauseResponse>, StatusCode> {
    let bucket = resolve_show_bucket(&state, &show_id, &headers).await?;
    let now_ms = time::unix_now_ms();
    let pause_at_ms = now_ms + SCHEDULED_DELAY_MS;
    println!(
        "User requested a pause. Planning to pause at {} (unix ms)",
        pause_at_ms
    );
    println!(
        "Sending pause instruction to clients to pause at {}",
        pause_at_ms
    );
    let current = bucket.broadcast.load_full();
    let next = BroadcastSnapshot {
        timeline_raw: current.timeline_raw.clone(),
        timeline_parsed: current.timeline_parsed.clone(),
        play_at_ms: current.play_at_ms,
        readhead_sec: current.readhead_sec,
        pause_at_ms: Some(pause_at_ms),
    };
    bucket.broadcast.store(Arc::new(next));
    println!("Finished sending pause request");
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(SCHEDULED_DELAY_MS)).await;
        println!("All clients should be pausing NOW");
    });

    Ok(Json(PauseResponse {
        pause_at_ms,
        server_time_ms: now_ms,
    }))
}

pub async fn post_broadcast_readhead(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ReadheadBody>,
) -> Result<Json<ReadheadResponse>, StatusCode> {
    let bucket = resolve_show_bucket(&state, &show_id, &headers).await?;
    let now_ms = time::unix_now_ms();
    let sec = if body.readhead_sec.is_finite() {
        body.readhead_sec.max(0.0)
    } else {
        0.0
    };
    let current = bucket.broadcast.load_full();
    let next = BroadcastSnapshot {
        timeline_raw: current.timeline_raw.clone(),
        timeline_parsed: current.timeline_parsed.clone(),
        readhead_sec: sec,
        play_at_ms: None,
        pause_at_ms: None,
    };
    bucket.broadcast.store(Arc::new(next));

    Ok(Json(ReadheadResponse {
        readhead_sec: sec,
        server_time_ms: now_ms,
    }))
}
