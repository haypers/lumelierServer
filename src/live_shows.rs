//! # Live show store — Per-show registry and broadcast
//!
//! When a show is "live", it has an entry in LiveShowState: a ConnectionRegistry (devices),
//! a BroadcastSnapshot (timeline + play/pause), and an optional track splitter tree for
//! assigning devices to tracks. Poll and admin device/broadcast APIs resolve the bucket by show_id; 404 if not live.

use std::sync::Arc;

use arc_swap::ArcSwap;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};

use crate::broadcast::BroadcastSnapshot;
use crate::connections::ConnectionRegistry;
use crate::track_splitter_tree::TrackSplitterTree;

/// Optional track splitter tree for this show (loaded at go-live from trackSplitterTree.json).
pub type TrackSplitterTreeRef = Arc<ArcSwap<Arc<Option<TrackSplitterTree>>>>;

/// Per-show networking config: poll interval and timeline lookahead. Defaults: 2 s, 10 s.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowNetworkingConfig {
    pub poll_interval_sec: f64,
    pub timeline_lookahead_sec: f64,
}

impl Default for ShowNetworkingConfig {
    fn default() -> Self {
        Self {
            poll_interval_sec: 2.0,
            timeline_lookahead_sec: 10.0,
        }
    }
}

pub type ShowNetworkingConfigRef = Arc<ArcSwap<ShowNetworkingConfig>>;

#[derive(Clone)]
pub struct LiveShowState {
    pub registry: Arc<ConnectionRegistry>,
    pub broadcast: Arc<ArcSwap<BroadcastSnapshot>>,
    pub track_splitter_tree: TrackSplitterTreeRef,
    pub networking: ShowNetworkingConfigRef,
}

impl LiveShowState {
    fn new() -> Self {
        Self {
            registry: Arc::new(ConnectionRegistry::new()),
            broadcast: Arc::new(ArcSwap::from_pointee(BroadcastSnapshot::new())),
            track_splitter_tree: Arc::new(ArcSwap::from_pointee(Arc::new(None))),
            networking: Arc::new(ArcSwap::from_pointee(ShowNetworkingConfig::default())),
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

    /// Returns the list of show_ids that currently have a live bucket.
    pub fn live_show_ids(&self) -> Vec<String> {
        self.inner.iter().map(|r| r.key().clone()).collect()
    }

    /// Call tick_disconnects on every live registry. Run periodically (e.g. every 10s).
    pub fn tick_all_disconnects(&self, now_ms: u64) {
        for entry in self.inner.iter() {
            entry.value().registry.tick_disconnects(now_ms);
        }
    }
}
