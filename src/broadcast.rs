//! # Broadcast Snapshot — Timeline and Playback
//!
//! Immutable snapshot of broadcast state, published atomically (ArcSwap).
//! Used by poll response (to send timeline + play/pause to clients) and by admin broadcast endpoints.

use std::sync::Arc;

#[derive(Clone, Default)]
pub struct BroadcastSnapshot {
    /// Raw JSON text (exactly as uploaded).
    pub timeline_raw: Option<Arc<str>>,
    /// Parsed JSON value (parsed once on upload).
    pub timeline_parsed: Option<Arc<serde_json::Value>>,
    pub play_at_ms: Option<u64>,
    pub readhead_sec: f64,
    pub pause_at_ms: Option<u64>,
}

impl BroadcastSnapshot {
    pub fn new() -> Self {
        Self::default()
    }
}
