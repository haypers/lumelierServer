//! # Live show store — Per-show registry and broadcast
//!
//! When a show is "live", it has an entry in LiveShowStore: a ConnectionRegistry (devices)
//! and a BroadcastSnapshot (timeline + play/pause). Poll and admin device/broadcast APIs
//! resolve the bucket by show_id; 404 if not live.

use std::sync::Arc;

use dashmap::DashMap;

use crate::broadcast::BroadcastSnapshot;
use crate::connections::ConnectionRegistry;

#[derive(Clone)]
pub struct LiveShowState {
    pub registry: Arc<ConnectionRegistry>,
    pub broadcast: Arc<arc_swap::ArcSwap<BroadcastSnapshot>>,
}

impl LiveShowState {
    fn new() -> Self {
        Self {
            registry: Arc::new(ConnectionRegistry::new()),
            broadcast: Arc::new(arc_swap::ArcSwap::from_pointee(
                BroadcastSnapshot::new(),
            )),
        }
    }
}

/// Store of live shows: show_id -> LiveShowState. Create via get_or_create; remove via remove.
#[derive(Clone, Default)]
pub struct LiveShowStore {
    inner: Arc<DashMap<String, Arc<LiveShowState>>>,
}

impl LiveShowStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(DashMap::new()),
        }
    }

    /// Get or create a live bucket for this show_id. Returns the bucket (registry + broadcast).
    pub fn get_or_create(&self, show_id: &str) -> Arc<LiveShowState> {
        let key = show_id.to_string();
        if let Some(bucket) = self.inner.get(&key) {
            return Arc::clone(bucket.value());
        }
        self.inner
            .entry(key)
            .or_insert_with(|| Arc::new(LiveShowState::new()))
            .value()
            .clone()
    }

    /// Remove the live bucket for this show_id. Devices and broadcast for this show are dropped.
    pub fn remove(&self, show_id: &str) {
        self.inner.remove(show_id);
    }

    /// Get the live bucket if it exists.
    pub fn get(&self, show_id: &str) -> Option<Arc<LiveShowState>> {
        self.inner.get(show_id).map(|r| Arc::clone(r.value()))
    }

    /// Call tick_disconnects on every live registry. Run periodically (e.g. every 10s).
    pub fn tick_all_disconnects(&self, now_ms: u64) {
        for entry in self.inner.iter() {
            entry.value().registry.tick_disconnects(now_ms);
        }
    }
}
