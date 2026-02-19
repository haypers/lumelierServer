//! # Broadcast API — Timeline, Play, Pause
//!
//! POST timeline: validate and store JSON in broadcast state. POST play: set play_at_ms (now + delay), readhead_sec, clear pause.
//! POST pause: set pause_at_ms (now + delay). Clients receive these via poll response and sync playback.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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

const SCHEDULED_DELAY_MS: u64 = 1000;

pub async fn post_broadcast_timeline(
    State(state): State<AdminAppState>,
    body: axum::body::Bytes,
) -> Result<StatusCode, StatusCode> {
    if timeline_validator::validate_broadcast_timeline(body.as_ref()).is_err() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let json = String::from_utf8(body.to_vec()).map_err(|_| StatusCode::BAD_REQUEST)?;
    let parsed: serde_json::Value =
        serde_json::from_str(&json).map_err(|_| StatusCode::BAD_REQUEST)?;

    let current = state.broadcast.load_full();
    let next = BroadcastSnapshot {
        timeline_raw: Some(Arc::from(json.into_boxed_str())),
        timeline_parsed: Some(Arc::new(parsed)),
        play_at_ms: current.play_at_ms,
        readhead_sec: current.readhead_sec,
        pause_at_ms: current.pause_at_ms,
    };
    state.broadcast.store(Arc::new(next));
    Ok(StatusCode::OK)
}

pub async fn post_broadcast_play(
    State(state): State<AdminAppState>,
    Json(body): Json<PlayBody>,
) -> Result<Json<PlayResponse>, StatusCode> {
    let now_ms = time::unix_now_ms();
    let play_at_ms = now_ms + SCHEDULED_DELAY_MS;
    let readhead_sec = body.readhead_sec;

    println!("User hit play from {} (readhead sec).", readhead_sec);
    println!("Planning to start playing timeline at {} (unix ms)", play_at_ms);
    println!("Starting to send json to all clients");
    let current = state.broadcast.load_full();
    let next = BroadcastSnapshot {
        timeline_raw: current.timeline_raw.clone(),
        timeline_parsed: current.timeline_parsed.clone(),
        play_at_ms: Some(play_at_ms),
        readhead_sec,
        pause_at_ms: None,
    };
    state.broadcast.store(Arc::new(next));
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
) -> Result<Json<PauseResponse>, StatusCode> {
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
    let current = state.broadcast.load_full();
    let next = BroadcastSnapshot {
        timeline_raw: current.timeline_raw.clone(),
        timeline_parsed: current.timeline_parsed.clone(),
        play_at_ms: current.play_at_ms,
        readhead_sec: current.readhead_sec,
        pause_at_ms: Some(pause_at_ms),
    };
    state.broadcast.store(Arc::new(next));
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
