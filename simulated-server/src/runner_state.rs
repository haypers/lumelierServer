// Per-client state for the runner. No distribution values are stored; we sample on every use.

use crate::client_sync::ClientSyncState;
use dashmap::DashMap;
use std::collections::HashSet;
use tokio::sync::mpsc::UnboundedSender;

/// State for one simulated client in the runner. Only scheduling and sync state; no cached distribution samples.
pub struct RunnerClientState {
    pub next_poll_at_ms: u64,
    pub next_lag_spike_at_ms: u64,
    /// 0 = not in block; else drop all in/out until this time (ms).
    pub lag_spike_block_until_ms: u64,
    /// When set, poll delivery sends () to wake the client's display task so it recalculates and reschedules.
    pub display_sync_tx: Option<UnboundedSender<()>>,
    pub sync_state: ClientSyncState,
    /// C2S + S2C of the last completed round; sent as X-Ping-Ms on the next poll.
    pub last_rtt_ms: Option<u32>,
}

/// All running clients keyed by client id. Runner ensures entries exist for all store clients.
pub struct RunnerState {
    pub clients: DashMap<String, RunnerClientState>,
}

impl RunnerState {
    pub fn new() -> Self {
        Self {
            clients: DashMap::new(),
        }
    }

    /// Ensure a client is in the runner state. If newly inserted, use the given initial timestamps
    /// (caller samples pingsEverySecDist and timeBetweenLagSpikesDist at use time).
    /// Caller sets display_sync_tx after insert when spawning the display task.
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
                last_rtt_ms: None,
            },
        );
    }

    /// Remove runner state for any client whose id is not in `ids` (e.g. deleted from store).
    pub fn retain_only_ids(&self, ids: &HashSet<String>) {
        self.clients.retain(|k, _| ids.contains(k));
    }
}

impl Default for RunnerState {
    fn default() -> Self {
        Self::new()
    }
}
