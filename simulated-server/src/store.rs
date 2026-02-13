use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const DIST_KEYS: &[&str] = &[
    "pingsEverySecDist",
    "clientToServerDelayDist",
    "serverToClientDelayDist",
    "timeBetweenLagSpikesDist",
    "lagSpikeDurationDist",
];

pub const CHART_BOUNDS: [(f64, f64); 5] = [
    (0.25, 5.25),
    (0.0, 500.0),
    (0.0, 500.0),
    (5.0, 120.0),
    (0.25, 5.0),
];

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DistributionAnchor {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DistributionCurve {
    pub anchors: Vec<DistributionAnchor>,
}

fn normalize_curve(curve: Option<&DistributionCurve>) -> DistributionCurve {
    let anchors = match curve {
        Some(c) => c
            .anchors
            .iter()
            .filter(|a| a.x.is_finite() && a.y.is_finite())
            .map(|a| DistributionAnchor { x: a.x, y: a.y })
            .collect(),
        None => vec![],
    };
    DistributionCurve { anchors }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SamplePoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatedClientRecord {
    pub id: String,
    pub device_id: String,
    pub server_time_estimate: Option<f64>,
    /// Actual server time (same-machine clock) when the last estimate was recorded; for UI comparison.
    pub server_time_actual_ms: Option<u64>,
    /// Estimate minus actual (ms); negative means client estimate was behind.
    pub server_time_estimate_error_ms: Option<i64>,
    pub current_display_color: Option<String>,
    pub pings_every_sec_dist: DistributionCurve,
    pub client_to_server_delay_dist: DistributionCurve,
    pub server_to_client_delay_dist: DistributionCurve,
    pub time_between_lag_spikes_dist: DistributionCurve,
    pub lag_spike_duration_dist: DistributionCurve,
    pub sample_history: HashMap<String, Vec<SamplePoint>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinimalClient {
    pub id: String,
    pub device_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSummary {
    pub id: String,
    pub current_display_color: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatedClientInput {
    pub id: Option<String>,
    pub device_id: Option<String>,
    pub server_time_estimate: Option<f64>,
    pub current_display_color: Option<String>,
    pub pings_every_sec_dist: Option<DistributionCurve>,
    pub client_to_server_delay_dist: Option<DistributionCurve>,
    pub server_to_client_delay_dist: Option<DistributionCurve>,
    pub time_between_lag_spikes_dist: Option<DistributionCurve>,
    pub lag_spike_duration_dist: Option<DistributionCurve>,
}

pub struct SimulatedStore {
    clients: DashMap<String, SimulatedClientRecord>,
}

const MAX_SAMPLE_POINTS: usize = 100;

impl SimulatedStore {
    pub fn new() -> Self {
        Self {
            clients: DashMap::new(),
        }
    }

    pub fn add_clients(&self, incoming: Vec<SimulatedClientInput>) -> usize {
        let mut created = 0;
        for c in incoming {
            let id = match &c.id {
                Some(s) if !s.is_empty() => s.clone(),
                _ => continue,
            };
            let device_id = c
                .device_id
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or(&id)
                .to_string();
            let sample_history: HashMap<String, Vec<SamplePoint>> = DIST_KEYS
                .iter()
                .map(|&k| (k.to_string(), vec![]))
                .collect();
            let record = SimulatedClientRecord {
                id: id.clone(),
                device_id,
                server_time_estimate: c
                    .server_time_estimate
                    .filter(|&x| x.is_finite()),
                server_time_actual_ms: None,
                server_time_estimate_error_ms: None,
                current_display_color: c
                    .current_display_color
                    .filter(|s| !s.is_empty()),
                pings_every_sec_dist: normalize_curve(c.pings_every_sec_dist.as_ref()),
                client_to_server_delay_dist: normalize_curve(c.client_to_server_delay_dist.as_ref()),
                server_to_client_delay_dist: normalize_curve(c.server_to_client_delay_dist.as_ref()),
                time_between_lag_spikes_dist: normalize_curve(
                    c.time_between_lag_spikes_dist.as_ref(),
                ),
                lag_spike_duration_dist: normalize_curve(c.lag_spike_duration_dist.as_ref()),
                sample_history,
            };
            self.clients.insert(id, record);
            created += 1;
        }
        created
    }

    pub fn get_minimal_list(&self) -> Vec<MinimalClient> {
        self.clients
            .iter()
            .map(|r| MinimalClient {
                id: r.id.clone(),
                device_id: r.device_id.clone(),
            })
            .collect()
    }

    pub fn get_full(&self, id: &str) -> Option<SimulatedClientRecord> {
        self.clients.get(id).map(|r| r.clone())
    }

    /// List all client ids. Runner uses this to find running clients.
    pub fn all_ids(&self) -> Vec<String> {
        self.clients.iter().map(|r| r.id.clone()).collect()
    }

    pub fn get_summaries_for_ids(&self, ids: &[String]) -> Vec<ClientSummary> {
        ids.iter()
            .map(|id| {
                self.clients.get(id).map(|r| ClientSummary {
                    id: r.id.clone(),
                    current_display_color: r.current_display_color.clone(),
                }).unwrap_or_else(|| ClientSummary {
                    id: id.clone(),
                    current_display_color: None,
                })
            })
            .collect()
    }

    pub fn curve_for_key<'a>(
        record: &'a SimulatedClientRecord,
        dist_key: &str,
    ) -> &'a DistributionCurve {
        match dist_key {
            "pingsEverySecDist" => &record.pings_every_sec_dist,
            "clientToServerDelayDist" => &record.client_to_server_delay_dist,
            "serverToClientDelayDist" => &record.server_to_client_delay_dist,
            "timeBetweenLagSpikesDist" => &record.time_between_lag_spikes_dist,
            "lagSpikeDurationDist" => &record.lag_spike_duration_dist,
            _ => &record.pings_every_sec_dist,
        }
    }

    pub fn append_sample(
        &self,
        id: &str,
        dist_key: &str,
        point: SamplePoint,
    ) -> Option<SamplePoint> {
        if !DIST_KEYS.contains(&dist_key) {
            return None;
        }
        let mut r = self.clients.get_mut(id)?;
        let list = r.sample_history.get_mut(dist_key)?;
        list.push(SamplePoint {
            x: point.x,
            y: point.y,
        });
        if list.len() > MAX_SAMPLE_POINTS {
            let keep = list.len() - MAX_SAMPLE_POINTS;
            list.drain(0..keep);
        }
        Some(point)
    }

    pub fn patch(&self, id: &str, body: &serde_json::Value) -> bool {
        let mut r = match self.clients.get_mut(id) {
            Some(x) => x,
            None => return false,
        };
        let obj = match body.as_object() {
            Some(x) => x,
            None => return true,
        };
        if let Some(v) = obj.get("currentDisplayColor") {
            r.current_display_color = v.as_str().map(String::from);
        }
        for &key in DIST_KEYS {
            if let Some(v) = obj.get(key) {
                if let Some(anchors) = v.get("anchors").and_then(|a| a.as_array()) {
                    let curve_anchors: Vec<DistributionAnchor> = anchors
                        .iter()
                        .filter_map(|a| {
                            let x = a.get("x")?.as_f64()?;
                            let y = a.get("y")?.as_f64()?;
                            if x.is_finite() && y.is_finite() {
                                Some(DistributionAnchor { x, y })
                            } else {
                                None
                            }
                        })
                        .collect();
                    let curve = DistributionCurve {
                        anchors: curve_anchors,
                    };
                    match key {
                        "pingsEverySecDist" => r.pings_every_sec_dist = curve,
                        "clientToServerDelayDist" => r.client_to_server_delay_dist = curve,
                        "serverToClientDelayDist" => r.server_to_client_delay_dist = curve,
                        "timeBetweenLagSpikesDist" => r.time_between_lag_spikes_dist = curve,
                        "lagSpikeDurationDist" => r.lag_spike_duration_dist = curve,
                        _ => {}
                    }
                }
            }
        }
        true
    }

    pub fn remove(&self, id: &str) -> bool {
        self.clients.remove(id).is_some()
    }

    pub fn clear(&self) {
        self.clients.clear();
    }

    /// Update server time estimate, actual, error, and current_display_color for a client (used by runner).
    pub fn update_display(
        &self,
        id: &str,
        server_time_estimate_ms: Option<i64>,
        current_display_color: Option<String>,
        server_time_actual_ms: Option<u64>,
        server_time_estimate_error_ms: Option<i64>,
    ) -> bool {
        let mut r = match self.clients.get_mut(id) {
            Some(x) => x,
            None => return false,
        };
        if let Some(t) = server_time_estimate_ms {
            r.server_time_estimate = Some(t as f64);
        }
        if let Some(ref c) = current_display_color {
            r.current_display_color = Some(c.clone());
        }
        if server_time_actual_ms.is_some() {
            r.server_time_actual_ms = server_time_actual_ms;
        }
        if server_time_estimate_error_ms.is_some() {
            r.server_time_estimate_error_ms = server_time_estimate_error_ms;
        }
        true
    }
}

impl Default for SimulatedStore {
    fn default() -> Self {
        Self::new()
    }
}

/// Get (x_min, x_max) for a dist key. Used by sample handler.
pub fn chart_bounds_for_key(dist_key: &str) -> (f64, f64) {
    DIST_KEYS
        .iter()
        .position(|&k| k == dist_key)
        .map(|idx| CHART_BOUNDS[idx])
        .unwrap_or((0.0, 1.0))
}
