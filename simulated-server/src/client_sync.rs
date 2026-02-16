// When we change the real client code, we must update this code to have the same functionality.
//
// This module mirrors the clock sync and broadcast/color logic from client/src/main.ts
// so that simulated clients maintain the same server time estimate and display color.

use serde::Deserialize;
use std::collections::VecDeque;

const EVENT_TYPE_SET_COLOR_BROADCAST: &str = "Set Color Broadcast";
const OFFSET_SAMPLES_MAX: usize = 5;

/// Poll response shape from main server (GET /api/poll). Must match main server's JSON.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct PollResponse {
    pub server_time: u64,
    pub server_time_at_send: Option<u64>,
    pub device_id: String,
    pub events: Vec<PollEvent>,
    pub broadcast: Option<PollBroadcast>,
}

#[derive(Clone, Debug, Deserialize)]
#[allow(dead_code)]
pub struct PollEvent {
    pub t: i64,
    pub color: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollBroadcast {
    pub timeline: BroadcastTimeline,
    pub readhead_sec: f64,
    pub play_at_ms: Option<u64>,
    pub pause_at_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct BroadcastTimeline {
    pub items: Vec<BroadcastTimelineItem>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastTimelineItem {
    pub start_sec: f64,
    pub effect_type: Option<String>,
    pub color: Option<String>,
}

/// Per-client sync state (clock, broadcast cache, last colors). No DOM or timers.
#[derive(Clone, Debug, Default)]
pub struct ClientSyncState {
    pub clock_offset_ms: i64,
    pub offset_samples: VecDeque<f64>,
    pub broadcast_cache: Option<PollBroadcast>,
    pub broadcast_playback_started_at_ms: Option<u64>,
    pub broadcast_paused_at_ms: Option<u64>,
    pub last_applied_broadcast_color: Option<String>,
    pub last_displayed_color: Option<String>,
}

fn median(samples: &VecDeque<f64>) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut sorted: Vec<f64> = samples.iter().copied().collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = sorted.len() / 2;
    if sorted.len() % 2 != 0 {
        sorted[mid]
    } else {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    }
}

fn get_server_time(now_ms: u64, clock_offset_ms: i64) -> i64 {
    now_ms as i64 + clock_offset_ms
}

/// Current playback position in timeline sec, or None if not yet playing or paused. Pub for display sync in runner.
pub(crate) fn get_broadcast_playback_sec(
    state: &ClientSyncState,
    now_ms: u64,
) -> Option<f64> {
    let cache = state.broadcast_cache.as_ref()?;
    let play_at = cache.play_at_ms?;
    let server_time = get_server_time(now_ms, state.clock_offset_ms);
    if state.broadcast_paused_at_ms.is_some()
        && server_time >= state.broadcast_paused_at_ms.unwrap_or(0) as i64
    {
        return None;
    }
    let start_ms = state
        .broadcast_playback_started_at_ms
        .unwrap_or(play_at) as i64;
    if server_time < start_ms {
        return None;
    }
    let elapsed_sec = (server_time - start_ms) as f64 / 1000.0;
    Some((cache.readhead_sec as f64) + elapsed_sec)
}

fn get_color_from_broadcast_timeline(
    timeline: &BroadcastTimeline,
    position_sec: f64,
) -> Option<String> {
    let mut events: Vec<_> = timeline
        .items
        .iter()
        .filter(|it| {
            it.effect_type
                .as_deref()
                .map(|e| e == EVENT_TYPE_SET_COLOR_BROADCAST)
                .unwrap_or(false)
                && it.color.is_some()
        })
        .collect();
    events.sort_by(|a, b| a.start_sec.partial_cmp(&b.start_sec).unwrap_or(std::cmp::Ordering::Equal));
    let mut color = None;
    for ev in events {
        if ev.start_sec <= position_sec {
            color = ev.color.clone();
        }
    }
    color
}

/// Return the timeline position (sec) of the next Set Color Broadcast event strictly after position_sec, or None if none.
pub fn next_color_change_sec(timeline: &BroadcastTimeline, position_sec: f64) -> Option<f64> {
    let mut events: Vec<_> = timeline
        .items
        .iter()
        .filter(|it| {
            it.effect_type
                .as_deref()
                .map(|e| e == EVENT_TYPE_SET_COLOR_BROADCAST)
                .unwrap_or(false)
                && it.color.is_some()
        })
        .collect();
    events.sort_by(|a, b| a.start_sec.partial_cmp(&b.start_sec).unwrap_or(std::cmp::Ordering::Equal));
    events
        .into_iter()
        .find(|ev| ev.start_sec > position_sec)
        .map(|ev| ev.start_sec)
}

fn is_broadcast_timeline_valid(broadcast: &PollBroadcast) -> bool {
    broadcast.timeline.items.is_empty() || true
}

/// Compute current display color from sync state and time. Read-only; does not mutate state.
/// Used by the display tick to advance color at ~60 Hz between poll deliveries.
pub fn get_display_color_at(state: &ClientSyncState, now_ms: u64) -> String {
    if state.broadcast_cache.is_none() {
        return state
            .last_displayed_color
            .clone()
            .unwrap_or_else(|| "#000000".to_string());
    }
    let server_time = get_server_time(now_ms, state.clock_offset_ms);
    let position_sec = get_broadcast_playback_sec(state, now_ms);
    let broadcast_color = position_sec.and_then(|pos| {
        get_color_from_broadcast_timeline(
            &state.broadcast_cache.as_ref().unwrap().timeline,
            pos,
        )
    });
    let broadcast_color = if let Some(c) = broadcast_color {
        Some(c)
    } else if state.broadcast_cache.as_ref().and_then(|b| b.play_at_ms).is_some()
        && state.broadcast_cache.as_ref().and_then(|b| b.pause_at_ms).is_some()
        && server_time >= state.broadcast_paused_at_ms.unwrap_or(0) as i64
    {
        let cache = state.broadcast_cache.as_ref().unwrap();
        let paused_elapsed_ms = state
            .broadcast_paused_at_ms
            .unwrap_or(0)
            .saturating_sub(cache.play_at_ms.unwrap_or(0));
        let paused_pos = cache.readhead_sec + paused_elapsed_ms as f64 / 1000.0;
        get_color_from_broadcast_timeline(&cache.timeline, paused_pos)
    } else {
        None
    };
    broadcast_color
        .or_else(|| state.last_applied_broadcast_color.clone())
        .or_else(|| state.last_displayed_color.clone())
        .unwrap_or_else(|| "#000000".to_string())
}

/// Apply a poll response: update clock sync, broadcast cache, and compute current display color.
/// rtt_ms is the simulated RTT for this round (C2S + S2C). now_ms is current time when we "deliver" the response.
/// Returns (display_color, server_time_estimate).
pub fn apply_poll_response(
    state: &mut ClientSyncState,
    response: &PollResponse,
    rtt_ms: u32,
    now_ms: u64,
) -> (String, i64) {
    let server_ts = response
        .server_time_at_send
        .unwrap_or(response.server_time) as f64;
    let rtt_f = rtt_ms as f64;
    let now_f = now_ms as f64;
    let raw_offset = server_ts + rtt_f / 2.0 - now_f;
    state.offset_samples.push_back(raw_offset);
    if state.offset_samples.len() > OFFSET_SAMPLES_MAX {
        state.offset_samples.pop_front();
    }
    state.clock_offset_ms = median(&state.offset_samples) as i64;

    if let Some(ref broadcast) = response.broadcast {
        if is_broadcast_timeline_valid(broadcast) {
            state.broadcast_cache = Some(broadcast.clone());
            let server_time = get_server_time(now_ms, state.clock_offset_ms) as u64;
            if broadcast.pause_at_ms.map_or(false, |p| server_time >= p) {
                state.broadcast_paused_at_ms = broadcast.pause_at_ms;
            } else {
                state.broadcast_paused_at_ms = None;
            }
            if let Some(play_at) = broadcast.play_at_ms {
                if server_time >= play_at {
                    state.broadcast_playback_started_at_ms =
                        Some(state.broadcast_playback_started_at_ms.unwrap_or(play_at).max(play_at));
                }
            }
        }
    } else {
        state.broadcast_cache = None;
        state.last_applied_broadcast_color = None;
    }

    let server_time = get_server_time(now_ms, state.clock_offset_ms);
    let first_color = response
        .events
        .first()
        .map(|e| e.color.clone())
        .unwrap_or_else(|| "#000000".to_string());

    let display_color = if state.broadcast_cache.is_none() {
        state.last_displayed_color = Some(first_color.clone());
        first_color.clone()
    } else {
        let position_sec = get_broadcast_playback_sec(state, now_ms);
        let broadcast_color = position_sec.and_then(|pos| {
            get_color_from_broadcast_timeline(
                &state.broadcast_cache.as_ref().unwrap().timeline,
                pos,
            )
        });
        let broadcast_color = if let Some(c) = broadcast_color {
            state.last_applied_broadcast_color = Some(c.clone());
            Some(c)
        } else if state.broadcast_cache.as_ref().and_then(|b| b.play_at_ms).is_some()
            && state.broadcast_cache.as_ref().and_then(|b| b.pause_at_ms).is_some()
            && server_time >= state.broadcast_paused_at_ms.unwrap_or(0) as i64
        {
            let cache = state.broadcast_cache.as_ref().unwrap();
            let paused_elapsed_ms = state
                .broadcast_paused_at_ms
                .unwrap_or(0)
                .saturating_sub(cache.play_at_ms.unwrap_or(0));
            let paused_pos = cache.readhead_sec + paused_elapsed_ms as f64 / 1000.0;
            get_color_from_broadcast_timeline(&cache.timeline, paused_pos)
        } else {
            None
        };
        let result = broadcast_color
            .or_else(|| state.last_applied_broadcast_color.clone())
            .or_else(|| state.last_displayed_color.clone())
            .unwrap_or(first_color);
        state.last_displayed_color = Some(result.clone());
        result
    };

    (display_color, server_time)
}
