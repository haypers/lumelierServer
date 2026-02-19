//! # Connection Registry — Device Presence and Ping
//!
//! Tracks each device that has hit GET /api/poll: last seen time, recent RTT samples (X-Ping-Ms),
//! handshake status, and disconnect events. "Connected" means last_seen within CONNECTED_THRESHOLD_MS.
//! A background task calls tick_disconnects every 10s to bump disconnect_events for devices that have gone silent.

use dashmap::DashMap;

const CONNECTED_THRESHOLD_MS: u64 = 20_000;
const PING_SAMPLES_MAX: usize = 10;

/// Per-device state: identity, timestamps, recent ping samples, handshake and disconnect flags.
#[derive(Clone, Debug)]
pub struct DeviceState {
    pub device_id: String,
    pub first_connected_at_ms: u64,
    pub last_seen_at_ms: u64,
    pub ping_samples: Vec<u32>,
    pub server_processing_samples: Vec<u32>,
    pub disconnect_events: u32,
    /// True once the client has sent X-Device-ID back (handshake returned).
    pub handshake_returned: bool,
    /// True after we've counted this device's current disconnect (so we only increment once per disconnect).
    pub disconnect_counted: bool,
    /// Latest GPS from client (X-Geo-* headers).
    pub geo_lat: Option<f64>,
    pub geo_lon: Option<f64>,
    pub geo_accuracy: Option<f64>,
    pub geo_alt: Option<f64>,
    pub geo_alt_accuracy: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct DeviceRow {
    pub device_id: String,
    pub connection_status: String,
    pub first_connected_at_ms: u64,
    pub average_ping_ms: Option<f64>,
    /// Most recent RTT (ms) reported by the client (last element of ping_samples).
    pub latest_rtt_ms: Option<u32>,
    pub average_server_processing_ms: Option<f64>,
    pub latest_server_processing_ms: Option<u32>,
    pub disconnect_events: u32,
    pub estimated_uptime_ms: u64,
    /// Milliseconds since this device last contacted the server.
    pub time_since_last_contact_ms: u64,
    pub geo_lat: Option<f64>,
    pub geo_lon: Option<f64>,
    pub geo_accuracy: Option<f64>,
    pub geo_alt: Option<f64>,
    pub geo_alt_accuracy: Option<f64>,
}

/// Geo values from client (X-Geo-* headers). All optional.
#[derive(Clone, Default)]
pub struct GeoUpdate {
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub accuracy: Option<f64>,
    pub alt: Option<f64>,
    pub alt_accuracy: Option<f64>,
}

impl DeviceState {
    fn is_connected(&self, now_ms: u64) -> bool {
        now_ms.saturating_sub(self.last_seen_at_ms) < CONNECTED_THRESHOLD_MS
    }

    fn average_ping_ms(&self) -> Option<f64> {
        if self.ping_samples.is_empty() {
            return None;
        }
        let sum: u64 = self.ping_samples.iter().copied().map(u64::from).sum();
        Some(sum as f64 / self.ping_samples.len() as f64)
    }

    fn average_server_processing_ms(&self) -> Option<f64> {
        if self.server_processing_samples.is_empty() {
            return None;
        }
        let sum: u64 = self
            .server_processing_samples
            .iter()
            .copied()
            .map(u64::from)
            .sum();
        Some(sum as f64 / self.server_processing_samples.len() as f64)
    }

    fn estimated_uptime_ms(&self, now_ms: u64) -> u64 {
        let end = if self.is_connected(now_ms) {
            now_ms
        } else {
            self.last_seen_at_ms
        };
        end.saturating_sub(self.first_connected_at_ms)
    }
}

/// Map of device_id → DeviceState. DashMap allows concurrent reads/writes on different keys.
#[derive(Default)]
pub struct ConnectionRegistry {
    devices: DashMap<String, DeviceState>,
}

impl ConnectionRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            devices: DashMap::new(),
        }
    }

    /// Upsert: only this key is locked; no global write lock.
    pub fn upsert(
        &self,
        device_id: String,
        now_ms: u64,
        ping_ms: Option<u32>,
        server_processing_ms: Option<u32>,
        handshake_returned: bool,
        geo: &GeoUpdate,
    ) {
        let mut entry = self.devices.entry(device_id.clone()).or_insert_with(|| DeviceState {
            device_id: device_id.clone(),
            first_connected_at_ms: now_ms,
            last_seen_at_ms: now_ms,
            ping_samples: Vec::with_capacity(PING_SAMPLES_MAX),
            server_processing_samples: Vec::with_capacity(PING_SAMPLES_MAX),
            disconnect_events: 0,
            handshake_returned: false,
            disconnect_counted: false,
            geo_lat: None,
            geo_lon: None,
            geo_accuracy: None,
            geo_alt: None,
            geo_alt_accuracy: None,
        });
        entry.disconnect_counted = false;
        if handshake_returned {
            entry.handshake_returned = true;
        }
        entry.last_seen_at_ms = now_ms;
        if let Some(p) = ping_ms {
            entry.ping_samples.push(p);
            if entry.ping_samples.len() > PING_SAMPLES_MAX {
                entry.ping_samples.remove(0);
            }
        }
        if let Some(p) = server_processing_ms {
            entry.server_processing_samples.push(p);
            if entry.server_processing_samples.len() > PING_SAMPLES_MAX {
                entry.server_processing_samples.remove(0);
            }
        }
        if geo.lat.is_some() {
            entry.geo_lat = geo.lat;
        }
        if geo.lon.is_some() {
            entry.geo_lon = geo.lon;
        }
        if geo.accuracy.is_some() {
            entry.geo_accuracy = geo.accuracy;
        }
        if geo.alt.is_some() {
            entry.geo_alt = geo.alt;
        }
        if geo.alt_accuracy.is_some() {
            entry.geo_alt_accuracy = geo.alt_accuracy;
        }
    }

    /// Update disconnect counts for devices that have gone silent (not on reconnect).
    /// Per-entry mutation via iter_mut(); no global lock.
    pub fn tick_disconnects(&self, now_ms: u64) {
        self.devices.iter_mut().for_each(|mut r| {
            let d = r.value_mut();
            if d.is_connected(now_ms) {
                d.disconnect_counted = false;
            } else if !d.disconnect_counted {
                d.disconnect_events = d.disconnect_events.saturating_add(1);
                d.disconnect_counted = true;
            }
        });
    }

    /// Returns (total_connected, average_ping_ms) without allocating device rows.
    pub fn list_stats_only(&self, now_ms: u64) -> (u32, Option<f64>) {
        let mut total_connected = 0u32;
        let mut ping_sum = 0f64;
        let mut ping_count = 0usize;
        for r in self.devices.iter() {
            let d = r.value();
            if !d.is_connected(now_ms) {
                continue;
            }
            total_connected += 1;
            if let Some(p) = d.average_ping_ms() {
                ping_sum += p;
                ping_count += 1;
            }
        }
        let average_ping_ms = if ping_count == 0 {
            None
        } else {
            Some(ping_sum / ping_count as f64)
        };
        (total_connected, average_ping_ms)
    }

    pub fn list_with_stats(&self, now_ms: u64) -> (u32, Option<f64>, Vec<DeviceRow>) {
        let rows: Vec<DeviceRow> = self
            .devices
            .iter()
            .map(|r| {
                let d = r.value();
                let connected = d.is_connected(now_ms);
                let connection_status = if connected {
                    if d.handshake_returned {
                        "connected, returned handshake".to_string()
                    } else {
                        "connected, no handshake".to_string()
                    }
                } else {
                    "disconnected".to_string()
                };
                DeviceRow {
                    device_id: d.device_id.clone(),
                    connection_status,
                    first_connected_at_ms: d.first_connected_at_ms,
                    average_ping_ms: d.average_ping_ms(),
                    latest_rtt_ms: d.ping_samples.last().copied(),
                    average_server_processing_ms: d.average_server_processing_ms(),
                    latest_server_processing_ms: d.server_processing_samples.last().copied(),
                    disconnect_events: d.disconnect_events,
                    estimated_uptime_ms: d.estimated_uptime_ms(now_ms),
                    time_since_last_contact_ms: now_ms.saturating_sub(d.last_seen_at_ms),
                    geo_lat: d.geo_lat,
                    geo_lon: d.geo_lon,
                    geo_accuracy: d.geo_accuracy,
                    geo_alt: d.geo_alt,
                    geo_alt_accuracy: d.geo_alt_accuracy,
                }
            })
            .collect();

        let connected_rows: Vec<_> = rows
            .iter()
            .filter(|r| r.connection_status.starts_with("connected"))
            .collect();
        let total_connected = connected_rows.len() as u32;
        let average_ping_ms = if connected_rows.is_empty() {
            None
        } else {
            let sum: f64 = connected_rows.iter().filter_map(|r| r.average_ping_ms).sum();
            let count = connected_rows
                .iter()
                .filter(|r| r.average_ping_ms.is_some())
                .count();
            if count == 0 {
                None
            } else {
                Some(sum / count as f64)
            }
        };

        (total_connected, average_ping_ms, rows)
    }

    pub fn remove_disconnected(&self, now_ms: u64) {
        self.devices.retain(|_, d| d.is_connected(now_ms));
    }

    /// Returns all device rows, optionally filtered to connected only.
    pub fn list_rows_filtered(&self, now_ms: u64, connected_only: bool) -> Vec<DeviceRow> {
        let rows: Vec<DeviceRow> = self
            .devices
            .iter()
            .map(|r| {
                let d = r.value();
                let connected = d.is_connected(now_ms);
                let connection_status = if connected {
                    if d.handshake_returned {
                        "connected, returned handshake".to_string()
                    } else {
                        "connected, no handshake".to_string()
                    }
                } else {
                    "disconnected".to_string()
                };
                DeviceRow {
                    device_id: d.device_id.clone(),
                    connection_status,
                    first_connected_at_ms: d.first_connected_at_ms,
                    average_ping_ms: d.average_ping_ms(),
                    latest_rtt_ms: d.ping_samples.last().copied(),
                    average_server_processing_ms: d.average_server_processing_ms(),
                    latest_server_processing_ms: d.server_processing_samples.last().copied(),
                    disconnect_events: d.disconnect_events,
                    estimated_uptime_ms: d.estimated_uptime_ms(now_ms),
                    time_since_last_contact_ms: now_ms.saturating_sub(d.last_seen_at_ms),
                    geo_lat: d.geo_lat,
                    geo_lon: d.geo_lon,
                    geo_accuracy: d.geo_accuracy,
                    geo_alt: d.geo_alt,
                    geo_alt_accuracy: d.geo_alt_accuracy,
                }
            })
            .collect();
        if connected_only {
            rows.into_iter()
                .filter(|r| r.connection_status.starts_with("connected"))
                .collect()
        } else {
            rows
        }
    }

    /// Returns device rows for the given IDs in the same order as `ids`. Missing IDs are skipped.
    pub fn rows_by_ids(&self, now_ms: u64, ids: &[String]) -> Vec<DeviceRow> {
        ids.iter()
            .filter_map(|id| {
                self.devices.get(id).map(|r| {
                    let d = r.value();
                    let connected = d.is_connected(now_ms);
                    let connection_status = if connected {
                        if d.handshake_returned {
                            "connected, returned handshake".to_string()
                        } else {
                            "connected, no handshake".to_string()
                        }
                    } else {
                        "disconnected".to_string()
                    };
                    DeviceRow {
                        device_id: d.device_id.clone(),
                        connection_status,
                        first_connected_at_ms: d.first_connected_at_ms,
                        average_ping_ms: d.average_ping_ms(),
                        latest_rtt_ms: d.ping_samples.last().copied(),
                        average_server_processing_ms: d.average_server_processing_ms(),
                        latest_server_processing_ms: d.server_processing_samples.last().copied(),
                        disconnect_events: d.disconnect_events,
                        estimated_uptime_ms: d.estimated_uptime_ms(now_ms),
                        time_since_last_contact_ms: now_ms.saturating_sub(d.last_seen_at_ms),
                        geo_lat: d.geo_lat,
                        geo_lon: d.geo_lon,
                        geo_accuracy: d.geo_accuracy,
                        geo_alt: d.geo_alt,
                        geo_alt_accuracy: d.geo_alt_accuracy,
                    }
                })
            })
            .collect()
    }
}
