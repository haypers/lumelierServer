//! # Time — Shared Clock Helper
//!
//! Single function: unix_now_ms() for consistent "now" in milliseconds since Unix epoch across the main server.

use std::time::{SystemTime, UNIX_EPOCH};

/// Returns current time as milliseconds since Unix epoch. Panics if system time is before epoch (should not happen).
pub fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before UNIX_EPOCH")
        .as_millis() as u64
}
