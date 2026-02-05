use std::collections::HashMap;

const CONNECTED_THRESHOLD_MS: u64 = 20_000;
const PING_SAMPLES_MAX: usize = 10;

#[derive(Clone, Debug)]
pub struct DeviceState {
    pub device_id: String,
    pub first_connected_at_ms: u64,
    pub last_seen_at_ms: u64,
    pub ping_samples: Vec<u32>,
    pub disconnect_events: u32,
    /// True once the client has sent X-Device-ID back (handshake returned).
    pub handshake_returned: bool,
    /// True after we've counted this device's current disconnect (so we only increment once per disconnect).
    pub disconnect_counted: bool,
}

#[derive(Clone, Debug)]
pub struct DeviceRow {
    pub device_id: String,
    pub connection_status: String,
    pub first_connected_at_ms: u64,
    pub average_ping_ms: Option<f64>,
    pub disconnect_events: u32,
    pub estimated_uptime_ms: u64,
    /// Milliseconds since this device last contacted the server.
    pub time_since_last_contact_ms: u64,
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

    fn estimated_uptime_ms(&self, now_ms: u64) -> u64 {
        let end = if self.is_connected(now_ms) {
            now_ms
        } else {
            self.last_seen_at_ms
        };
        end.saturating_sub(self.first_connected_at_ms)
    }
}

#[derive(Clone, Default)]
pub struct ConnectionRegistry {
    devices: HashMap<String, DeviceState>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            devices: HashMap::new(),
        }
    }

    pub fn upsert(
        &mut self,
        device_id: String,
        now_ms: u64,
        ping_ms: Option<u32>,
        handshake_returned: bool,
    ) {
        let entry = self.devices.entry(device_id.clone()).or_insert_with(|| DeviceState {
            device_id: device_id.clone(),
            first_connected_at_ms: now_ms,
            last_seen_at_ms: now_ms,
            ping_samples: Vec::with_capacity(PING_SAMPLES_MAX),
            disconnect_events: 0,
            handshake_returned: false,
            disconnect_counted: false,
        });

        // Mark as connected again so we'll count the next disconnect when they go silent.
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
    }

    /// Update disconnect counts for devices that have gone silent (not on reconnect).
    pub fn tick_disconnects(&mut self, now_ms: u64) {
        for (_id, d) in self.devices.iter_mut() {
            if d.is_connected(now_ms) {
                d.disconnect_counted = false;
            } else if !d.disconnect_counted {
                d.disconnect_events = d.disconnect_events.saturating_add(1);
                d.disconnect_counted = true;
            }
        }
    }

    pub fn list_with_stats(&self, now_ms: u64) -> (u32, Option<f64>, Vec<DeviceRow>) {
        let rows: Vec<DeviceRow> = self
            .devices
            .values()
            .map(|d| {
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
                    disconnect_events: d.disconnect_events,
                    estimated_uptime_ms: d.estimated_uptime_ms(now_ms),
                    time_since_last_contact_ms: now_ms.saturating_sub(d.last_seen_at_ms),
                }
            })
            .collect();

        let connected_rows: Vec<_> = rows.iter().filter(|r| r.connection_status.starts_with("connected")).collect();
        let total_connected = connected_rows.len() as u32;
        let average_ping_ms = if connected_rows.is_empty() {
            None
        } else {
            let sum: f64 = connected_rows.iter().filter_map(|r| r.average_ping_ms).sum();
            let count = connected_rows.iter().filter(|r| r.average_ping_ms.is_some()).count();
            if count == 0 {
                None
            } else {
                Some(sum / count as f64)
            }
        };

        (total_connected, average_ping_ms, rows)
    }

    pub fn remove_disconnected(&mut self, now_ms: u64) {
        self.devices.retain(|_, d| d.is_connected(now_ms));
    }
}
