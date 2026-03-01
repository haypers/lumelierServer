//! Per-show simulated state: one store + runner state per live show.

use crate::runner_state::RunnerState;
use crate::store::SimulatedStore;

/// State for a single live show: store and runner state. Dropped when the show is no longer live.
pub struct PerShowSimulatedState {
    pub store: SimulatedStore,
    pub runner_state: RunnerState,
}

impl PerShowSimulatedState {
    pub fn new() -> Self {
        Self {
            store: SimulatedStore::new(),
            runner_state: RunnerState::new(),
        }
    }
}

impl Default for PerShowSimulatedState {
    fn default() -> Self {
        Self::new()
    }
}
