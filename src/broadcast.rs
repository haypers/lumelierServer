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
