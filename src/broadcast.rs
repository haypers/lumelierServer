//! # Broadcast State — Timeline and Playback
//!
//! Shared state for the color broadcast: timeline JSON, play/pause timestamps, and readhead position.
//! Used by poll response (to send timeline + play/pause to clients) and by admin broadcast endpoints.

#[derive(Clone, Default)]
pub struct BroadcastState {
    pub timeline_json: Option<String>,
    pub play_at_ms: Option<u64>,
    pub readhead_sec: f64,
    pub pause_at_ms: Option<u64>,
}

impl BroadcastState {
    pub fn new() -> Self {
        Self::default()
    }
}
