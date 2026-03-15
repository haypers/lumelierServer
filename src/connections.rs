//! # Connection Registry — Device Presence and Ping
//!
//! All connected-device data (identity, timestamps, ping, track, geo, etc.) is held in this single
//! in-memory structure for fast access. There is no persistence and no separate datastructures for
//! device state—keep it that way to avoid drift and extra complexity.
//!
//! Tracks each device that has hit GET /api/poll: last seen time, recent RTT samples (X-Ping-Ms),
//! handshake status, and disconnect events. "Connected" means last_seen within CONNECTED_THRESHOLD_MS.
//! A background task calls tick_disconnects every 10s to bump disconnect_events for devices that have gone silent.

use std::cmp::Ordering;

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
    /// True if the current poll included lat and lon (we do not require altitude).
    pub is_sending_gps: bool,
    /// Assigned track index (1-based). 0 means not yet assigned.
    pub track_index: u32,
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
    /// True if the device is currently sending GPS (lat/lon) in polls.
    pub is_sending_gps: bool,
    pub track_index: u32,
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

/// Lightweight sort key for pagination without building full DeviceRow. Ordering matches sort_rows in admin.
#[derive(Clone, Debug)]
enum PageSortKey {
    Str(String),
    U64(u64),
    OptionF64(Option<f64>),
    OptionU32(Option<u32>),
    Bool(bool),
}

impl PartialEq for PageSortKey {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Str(a), Self::Str(b)) => a == b,
            (Self::U64(a), Self::U64(b)) => a == b,
            (Self::OptionF64(a), Self::OptionF64(b)) => a == b,
            (Self::OptionU32(a), Self::OptionU32(b)) => a == b,
            (Self::Bool(a), Self::Bool(b)) => a == b,
            _ => false,
        }
    }
}

impl Eq for PageSortKey {}

impl PartialOrd for PageSortKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PageSortKey {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (PageSortKey::Str(a), PageSortKey::Str(b)) => a.cmp(b),
            (PageSortKey::U64(a), PageSortKey::U64(b)) => a.cmp(b),
            (PageSortKey::OptionF64(a), PageSortKey::OptionF64(b)) => match (a, b) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Greater,
                (Some(_), None) => Ordering::Less,
                (Some(x), Some(y)) => x.partial_cmp(y).unwrap_or(Ordering::Equal),
            },
            (PageSortKey::OptionU32(a), PageSortKey::OptionU32(b)) => match (a, b) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Greater,
                (Some(_), None) => Ordering::Less,
                (Some(x), Some(y)) => x.cmp(y),
            },
            (PageSortKey::Bool(a), PageSortKey::Bool(b)) => a.cmp(b),
            _ => Ordering::Equal,
        }
    }
}

fn connection_status_str(connected: bool, handshake_returned: bool) -> &'static str {
    if connected {
        if handshake_returned {
            "connected, returned handshake"
        } else {
            "connected, no handshake"
        }
    } else {
        "disconnected"
    }
}

fn page_sort_key(d: &DeviceState, now_ms: u64, sort_field: &str) -> PageSortKey {
    let connected = d.is_connected(now_ms);
    let time_since_last_contact_ms = now_ms.saturating_sub(d.last_seen_at_ms);
    let estimated_uptime_ms = d.estimated_uptime_ms(now_ms);
    match sort_field {
        "deviceId" => PageSortKey::Str(d.device_id.clone()),
        "firstConnectedAt" => PageSortKey::U64(d.first_connected_at_ms),
        "averagePingMs" => PageSortKey::OptionF64(d.average_ping_ms()),
        "lastClientRttMs" => PageSortKey::OptionU32(d.ping_samples.last().copied()),
        "averageServerProcessingMs" => PageSortKey::OptionF64(d.average_server_processing_ms()),
        "lastServerProcessingMs" => {
            PageSortKey::OptionU32(d.server_processing_samples.last().copied())
        }
        "timeSinceLastContactMs" => PageSortKey::U64(time_since_last_contact_ms),
        "disconnectEvents" => PageSortKey::U64(d.disconnect_events as u64),
        "estimatedUptimeMs" => PageSortKey::U64(estimated_uptime_ms),
        "connectionStatus" => {
            PageSortKey::Str(connection_status_str(connected, d.handshake_returned).to_string())
        }
        "geoLat" => PageSortKey::OptionF64(d.geo_lat),
        "geoLon" => PageSortKey::OptionF64(d.geo_lon),
        "geoAccuracy" => PageSortKey::OptionF64(d.geo_accuracy),
        "geoAlt" => PageSortKey::OptionF64(d.geo_alt),
        "geoAltAccuracy" => PageSortKey::OptionF64(d.geo_alt_accuracy),
        "isSendingGps" => PageSortKey::Bool(d.is_sending_gps),
        "trackIndex" => PageSortKey::U64(d.track_index as u64),
        _ => PageSortKey::Str(d.device_id.clone()),
    }
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
    /// Returns true if the entry was newly inserted (first poll from this device).
    pub fn upsert(
        &self,
        device_id: String,
        now_ms: u64,
        ping_ms: Option<u32>,
        server_processing_ms: Option<u32>,
        handshake_returned: bool,
        geo: &GeoUpdate,
    ) -> bool {
        let is_sending_gps = geo.lat.is_some() && geo.lon.is_some();
        let was_new = !self.devices.contains_key(&device_id);
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
            is_sending_gps: false,
            track_index: 0,
        });
        entry.disconnect_counted = false;
        if handshake_returned {
            entry.handshake_returned = true;
        }
        entry.last_seen_at_ms = now_ms;
        entry.is_sending_gps = is_sending_gps;
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
        was_new
    }

    /// Returns the device's current is_sending_gps value, or None if the device is not in the registry.
    pub fn get_is_sending_gps(&self, device_id: &str) -> Option<bool> {
        self.devices.get(device_id).map(|r| r.is_sending_gps)
    }

    /// Sets the assigned track index for the device if it exists.
    pub fn set_track_index(&self, device_id: &str, track_index: u32) {
        if let Some(mut r) = self.devices.get_mut(device_id) {
            r.track_index = track_index;
        }
    }

    /// Returns the device's track index (1-based). Returns 1 if the device is not in the registry or not yet assigned (0).
    pub fn get_track_index(&self, device_id: &str) -> u32 {
        self.devices
            .get(device_id)
            .map(|r| {
                let t = r.track_index;
                if t == 0 {
                    1
                } else {
                    t
                }
            })
            .unwrap_or(1)
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
                    is_sending_gps: d.is_sending_gps,
                    track_index: d.track_index,
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

    /// We intentionally do not auto-prune disconnected devices; stats and UI should reflect
    /// disconnected devices. Pruning is only done via admin "Reset connections".
    pub fn remove_disconnected(&self, now_ms: u64) {
        self.devices.retain(|_, d| d.is_connected(now_ms));
    }

    /// Returns (total_count, ids for the requested page) without building full DeviceRows.
    /// One pass over the registry collects (device_id, sort_key), sorts, then paginates.
    pub fn list_page_ids(
        &self,
        now_ms: u64,
        connected_only: bool,
        sort_field: &str,
        sort_asc: bool,
        page: u32,
        page_size: u32,
    ) -> (u32, Vec<String>) {
        let mut entries: Vec<(String, PageSortKey)> = self
            .devices
            .iter()
            .filter_map(|r| {
                let d = r.value();
                if connected_only && !d.is_connected(now_ms) {
                    return None;
                }
                let key = page_sort_key(d, now_ms, sort_field);
                Some((d.device_id.clone(), key))
            })
            .collect();
        if sort_asc {
            entries.sort_by(|a, b| a.1.cmp(&b.1));
        } else {
            entries.sort_by(|a, b| b.1.cmp(&a.1));
        }
        let total_count = entries.len() as u32;
        let offset = ((page - 1) as usize) * (page_size as usize);
        let ids: Vec<String> = entries
            .into_iter()
            .skip(offset)
            .take(page_size as usize)
            .map(|e| e.0)
            .collect();
        (total_count, ids)
    }

    /// Returns all device rows, optionally filtered to connected only.
    #[allow(dead_code)]
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
                    is_sending_gps: d.is_sending_gps,
                    track_index: d.track_index,
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
                        is_sending_gps: d.is_sending_gps,
                        track_index: d.track_index,
                    }
                })
            })
            .collect()
    }
}
