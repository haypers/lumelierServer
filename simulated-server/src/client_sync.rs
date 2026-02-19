//! # Client Sync — Mirror of Real Client Logic
//!
//! When we change the real client (client/src/main.ts), we must update this module to match.
//! It mirrors: clock sync (median of offsets), broadcast timeline playback, and current display color.
//! No DOM or timers here; the runner calls these functions when it "delivers" a poll response.

use serde::Deserialize;
use std::collections::VecDeque;

const EVENT_TYPE_SET_COLOR_BROADCAST: &str = "Set Color Broadcast";
const SYNC_SAMPLES_MAX: usize = 30;
const DELAY_SLACK_MS: f64 = 40.0;
const SLEW_MAX_STEP_MS: f64 = 25.0;

/// JSON shape of the main server's GET /api/poll response. Deserialize with serde.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct PollResponse {
    pub server_time: u64,
    pub server_time_at_recv: u64,
    pub server_time_at_send: u64,
    pub client_send_ms_echo: u64,
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
    pub start_sec: Option<f64>,
    pub effect_type: Option<String>,
    pub color: Option<String>,
}

/// Per-client sync state: clock offset samples, broadcast cache, play/pause, last colors. No DOM or timers.
#[derive(Clone, Debug, Default)]
pub struct ClientSyncState {
    pub clock_offset_ms: i64,
    pub sync_samples: VecDeque<SyncSample>,
    pub broadcast_cache: Option<PollBroadcast>,
    pub broadcast_playback_started_at_ms: Option<u64>,
    pub broadcast_paused_at_ms: Option<u64>,
    pub last_applied_broadcast_color: Option<String>,
    pub last_displayed_color: Option<String>,
}

#[derive(Clone, Copy, Debug)]
pub struct SyncSample {
    pub offset_ms: f64,
    pub delay_ms: f64,
}

fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted: Vec<f64> = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = sorted.len() / 2;
    if sorted.len() % 2 != 0 {
        sorted[mid]
    } else {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    }
}

fn clamp(n: f64, min: f64, max: f64) -> f64 {
    n.max(min).min(max)
}

/// Client's estimate of server time: now + clock_offset_ms.
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

/// Given a timeline and a position in seconds, return the color from the last Set Color Broadcast event at or before that position.
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
                && it.color.as_ref().is_some_and(|c| !c.is_empty())
                && it.start_sec.is_some_and(|s| s.is_finite())
        })
        .collect();
    events.sort_by(|a, b| {
        a.start_sec
            .unwrap_or(f64::NAN)
            .partial_cmp(&b.start_sec.unwrap_or(f64::NAN))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut color = None;
    for ev in events {
        let start = ev.start_sec.unwrap_or(f64::NAN);
        if start.is_finite() && start <= position_sec {
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
                && it.color.as_ref().is_some_and(|c| !c.is_empty())
                && it.start_sec.is_some_and(|s| s.is_finite())
        })
        .collect();
    events.sort_by(|a, b| {
        a.start_sec
            .unwrap_or(f64::NAN)
            .partial_cmp(&b.start_sec.unwrap_or(f64::NAN))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    events
        .into_iter()
        .find_map(|ev| {
            let start = ev.start_sec?;
            if start.is_finite() && start > position_sec {
                Some(start)
            } else {
                None
            }
        })
}

/// Placeholder: we accept any broadcast for now.
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
    let cache = state.broadcast_cache.as_ref().unwrap();
    let server_time = get_server_time(now_ms, state.clock_offset_ms);
    let position_sec = get_broadcast_playback_sec(state, now_ms);
    let reference_sec = if let Some(pos) = position_sec {
        pos
    } else if cache.play_at_ms.is_some()
        && cache.pause_at_ms.is_some()
        && server_time >= cache.pause_at_ms.unwrap_or(0) as i64
    {
        let play_at = cache.play_at_ms.unwrap_or(0);
        let pause_at = cache.pause_at_ms.unwrap_or(0);
        cache.readhead_sec + pause_at.saturating_sub(play_at) as f64 / 1000.0
    } else {
        cache.readhead_sec
    };
    get_color_from_broadcast_timeline(&cache.timeline, reference_sec)
        .unwrap_or_else(|| "#000000".to_string())
}

/// Apply a poll response: update clock sync, broadcast cache, and compute current display color.
/// rtt_ms is the simulated RTT for this round (C2S + S2C). now_ms is current time when we "deliver" the response.
/// Returns (display_color, server_time_estimate).
pub fn apply_poll_response(
    state: &mut ClientSyncState,
    response: &PollResponse,
    t0_ms: u64,
    t3_recv_ms: u64,
    now_apply_ms: u64,
) -> (String, i64) {
    // NTP-style math using:
    // t0: client send (passed in)
    // t1: server receive (response.server_time_at_recv)
    // t2: server send (response.server_time_at_send)
    // t3: client receive (passed in; should NOT include client-side processing delay)
    let t0 = t0_ms as f64;
    let t1 = response.server_time_at_recv as f64;
    let t2 = response.server_time_at_send as f64;
    let t3 = t3_recv_ms as f64;
    let mut offset_ms = ((t1 - t0) + (t2 - t3)) / 2.0;
    let mut delay_ms = (t3 - t0) - (t2 - t1);
    if !offset_ms.is_finite() {
        offset_ms = 0.0;
    }
    if !delay_ms.is_finite() {
        delay_ms = 0.0;
    }
    delay_ms = delay_ms.max(0.0);

    state.sync_samples.push_back(SyncSample { offset_ms, delay_ms });
    if state.sync_samples.len() > SYNC_SAMPLES_MAX {
        state.sync_samples.pop_front();
    }

    let min_delay = state
        .sync_samples
        .iter()
        .map(|s| s.delay_ms)
        .fold(f64::INFINITY, f64::min);
    let good_offsets: Vec<f64> = state
        .sync_samples
        .iter()
        .filter(|s| s.delay_ms <= min_delay + DELAY_SLACK_MS)
        .map(|s| s.offset_ms)
        .collect();
    let all_offsets: Vec<f64> = state.sync_samples.iter().map(|s| s.offset_ms).collect();
    let filtered_offset = if !good_offsets.is_empty() {
        median(&good_offsets)
    } else {
        median(&all_offsets)
    };

    if state.sync_samples.len() < 3 {
        state.clock_offset_ms = filtered_offset.round() as i64;
    } else {
        let current = state.clock_offset_ms as f64;
        let delta = filtered_offset - current;
        state.clock_offset_ms = (current + clamp(delta, -SLEW_MAX_STEP_MS, SLEW_MAX_STEP_MS)).round() as i64;
    }

    if let Some(ref broadcast) = response.broadcast {
        if is_broadcast_timeline_valid(broadcast) {
            state.broadcast_cache = Some(broadcast.clone());
            let server_time = get_server_time(now_apply_ms, state.clock_offset_ms) as u64;
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

    // Return the estimate at apply-time (mirrors real client: Date.now()+offset at time of use).
    let server_time = get_server_time(now_apply_ms, state.clock_offset_ms);
    let first_color = response
        .events
        .first()
        .map(|e| e.color.clone())
        .unwrap_or_else(|| "#000000".to_string());

    let display_color = if state.broadcast_cache.is_none() {
        state.last_displayed_color = Some(first_color.clone());
        first_color.clone()
    } else {
        let position_sec = get_broadcast_playback_sec(state, now_apply_ms);
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
