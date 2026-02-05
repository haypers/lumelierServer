use std::time::{SystemTime, UNIX_EPOCH};

/// Current time as milliseconds since UNIX_EPOCH.
pub fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before UNIX_EPOCH")
        .as_millis() as u64
}
