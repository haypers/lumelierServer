//! # Runner State — Per-Client Scheduling and Sync
//!
//! This module holds the **runtime state** for each simulated client that the runner uses:
//! when to poll next, when the next lag spike is, whether we're currently in a lag block,
//! and the client-sync state (clock, broadcast) that mirrors the real client logic.
//!
//! It does **not** store distribution curves or config; those live in the store. We sample
//! from the store's distributions each time we need a new delay or interval.

use crate::client_sync::ClientSyncState;
use dashmap::DashMap;
use std::collections::HashSet;
use tokio::sync::mpsc::UnboundedSender;

/// State for **one** simulated client inside the runner.
/// Only scheduling and sync; no cached distribution samples.
pub struct RunnerClientState {
    /// When (Unix ms) we should send the next GET /api/poll. Runner sleeps until this time.
    pub next_poll_at_ms: u64,
    /// When (Unix ms) the next lag spike should start. 0 means "not scheduled" (e.g. we're in a spike).
    pub next_lag_spike_at_ms: u64,
    /// If non-zero: we're in a "lag spike" until this time (Unix ms). All in/out traffic is dropped until then.
    pub lag_spike_block_until_ms: u64,
    /// Channel to wake the client's display task when a poll response is delivered, so it recalculates color and reschedules.
    pub display_sync_tx: Option<UnboundedSender<()>>,
    /// Clock offset, broadcast cache, last colors — mirrors client/src/main.ts sync logic.
    pub sync_state: ClientSyncState,
    /// Last network round-trip time (C2S + S2C ms). Sent as X-Ping-Ms on the next poll.
    pub last_network_rtt_ms: Option<u32>,
    /// Last sampled client-side processing delay (ms) before applying a poll response.
    pub last_processing_ms: Option<u32>,
    /// Last end-to-end time (network RTT + processing delay), for UI/debugging.
    pub last_effective_rtt_ms: Option<u32>,
}

/// All runner clients, keyed by client id. The main loop ensures an entry exists for every id in the store.
pub struct RunnerState {
    /// DashMap: concurrent hash map. Many tasks can read/write different keys at once without locking the whole map.
    pub clients: DashMap<String, RunnerClientState>,
}

impl RunnerState {
    pub fn new() -> Self {
        Self {
            clients: DashMap::new(),
        }
    }

    /// Ensure a client exists in the map. If it's new, insert with the given initial timestamps.
    /// The caller is responsible for sampling the distributions to get those timestamps.
    /// After insert, the caller also sets `display_sync_tx` when it spawns the display task.
    pub fn ensure_client(
        &self,
        client_id: String,
        initial_next_poll_at_ms: u64,
        initial_next_lag_spike_at_ms: u64,
    ) {
        if self.clients.contains_key(&client_id) {
            return;
        }
        self.clients.insert(
            client_id,
            RunnerClientState {
                next_poll_at_ms: initial_next_poll_at_ms,
                next_lag_spike_at_ms: initial_next_lag_spike_at_ms,
                lag_spike_block_until_ms: 0,
                display_sync_tx: None,
                sync_state: ClientSyncState::default(),
                last_network_rtt_ms: None,
                last_processing_ms: None,
                last_effective_rtt_ms: None,
            },
        );
    }

    /// Remove any client whose id is not in `ids`. Used when clients are deleted from the store.
    /// `retain` keeps only entries for which the closure returns true.
    pub fn retain_only_ids(&self, ids: &HashSet<String>) {
        self.clients.retain(|k, _| ids.contains(k));
    }
}

impl Default for RunnerState {
    fn default() -> Self {
        Self::new()
    }
}
