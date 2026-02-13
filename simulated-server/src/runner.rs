// Tick loop, delay layer (C2S/S2C, lag spike), and HTTP polling. Samples distributions on every use; no cached values.

use crate::client_sync::{self, PollResponse};
use crate::distribution;
use crate::runner_state::RunnerState;
use crate::store::{self, SamplePoint, SimulatedStore};
use rand::Rng;
use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};
use tokio::sync::Mutex;

const TICK_INTERVAL_MS: u64 = 50;
const MAX_IN_FLIGHT: usize = 1000;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

struct PendingSend {
    client_id: String,
    send_at_ms: u64,
    c2s_ms: u32,
}

pub struct RunnerConfig {
    pub main_server_url: String,
    pub store: Arc<SimulatedStore>,
    pub runner_state: Arc<RunnerState>,
}

/// Sample from a distribution, record (x, y) in the store for the given client/chart, and return (x, y).
fn record_sample(
    store: &SimulatedStore,
    id: &str,
    dist_key: &str,
    anchors: &[(f64, f64)],
    rng: &mut impl Rng,
) -> (f64, f64) {
    let (x_min, x_max) = store::chart_bounds_for_key(dist_key);
    let (x, y) = distribution::sample_from_distribution(anchors, x_min, x_max, rng);
    let _ = store.append_sample(id, dist_key, SamplePoint { x, y });
    (x, y)
}

/// Record a sample and return the x value in milliseconds (for delay distributions).
fn record_sample_ms(
    store: &SimulatedStore,
    id: &str,
    dist_key: &str,
    anchors: &[(f64, f64)],
    rng: &mut impl Rng,
) -> u32 {
    let (x, _) = record_sample(store, id, dist_key, anchors, rng);
    let ms = if dist_key == "pingsEverySecDist" || dist_key == "timeBetweenLagSpikesDist" || dist_key == "lagSpikeDurationDist" {
        (x * 1000.0).round().max(0.0) as u32
    } else {
        x.round().max(0.0) as u32
    };
    ms
}

/// Record a sample and return the x value in seconds (for time distributions).
fn record_sample_sec(
    store: &SimulatedStore,
    id: &str,
    dist_key: &str,
    anchors: &[(f64, f64)],
    rng: &mut impl Rng,
) -> f64 {
    let (x, _) = record_sample(store, id, dist_key, anchors, rng);
    x.max(0.0)
}

pub async fn run_runner(config: RunnerConfig) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("reqwest client");
    let pending_sends: Arc<Mutex<VecDeque<PendingSend>>> = Arc::new(Mutex::new(VecDeque::new()));
    let pending_deliveries: Arc<Mutex<Vec<(String, u64, PollResponse, u32, u32)>>> =
        Arc::new(Mutex::new(Vec::new()));
    let in_flight: Arc<AtomicUsize> = Arc::new(AtomicUsize::new(0));

    let mut tick_interval = tokio::time::interval(Duration::from_millis(TICK_INTERVAL_MS));
    tick_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tick_interval.tick().await;
        let now = now_ms();

        // 1) Sync runner state with store: add new connection_enabled clients, remove disabled and deleted
        let ids = config.store.all_ids();
        let ids_set: HashSet<String> = ids.iter().cloned().collect();
        config.runner_state.retain_only_ids(&ids_set);

        // Purge pending queues for clients no longer in the store
        {
            let mut sends = pending_sends.lock().await;
            sends.retain(|s| ids_set.contains(&s.client_id));
        }
        {
            let mut list = pending_deliveries.lock().await;
            list.retain(|(client_id, _, _, _, _)| ids_set.contains(client_id));
        }

        {
            let mut rng = rand::thread_rng();
            for id in &ids {
                if config.store.is_connection_enabled(id) {
                    if !config.runner_state.clients.contains_key(id) {
                        let record = match config.store.get_full(id) {
                            Some(r) => r,
                            None => continue,
                        };
                        let next_poll = now;
                        let anchors = curve_anchors(&record, "timeBetweenLagSpikesDist");
                        let lag_sec = record_sample_sec(
                            &config.store,
                            id,
                            "timeBetweenLagSpikesDist",
                            &anchors,
                            &mut rng,
                        );
                        let next_lag = now + (lag_sec * 1000.0) as u64;
                        config.runner_state.ensure_client(id.clone(), next_poll, next_lag);
                    }
                } else {
                    config.runner_state.remove_if_disabled(id, false);
                }
            }
        }

        // 2) Lag spike: next spike timer only starts after current lag ends. When not in block and
        //    next_lag_spike_at_ms == 0, schedule next spike. When now >= next_lag_spike_at_ms, enter block and set next to 0.
        {
            let mut rng = rand::thread_rng();
            for mut entry in config.runner_state.clients.iter_mut() {
                let client_id = entry.key().clone();
                let state = entry.value_mut();
                if now <= state.lag_spike_block_until_ms {
                    continue;
                }
                let record = match config.store.get_full(&client_id) {
                    Some(r) => r,
                    None => continue,
                };
                if state.next_lag_spike_at_ms == 0 {
                    let between_anchors = curve_anchors(&record, "timeBetweenLagSpikesDist");
                    let between_sec = record_sample_sec(
                        &config.store,
                        &client_id,
                        "timeBetweenLagSpikesDist",
                        &between_anchors,
                        &mut rng,
                    );
                    state.next_lag_spike_at_ms = now + (between_sec * 1000.0) as u64;
                } else if now >= state.next_lag_spike_at_ms {
                    let duration_anchors = curve_anchors(&record, "lagSpikeDurationDist");
                    let duration_sec = record_sample_sec(
                        &config.store,
                        &client_id,
                        "lagSpikeDurationDist",
                        &duration_anchors,
                        &mut rng,
                    );
                    state.lag_spike_block_until_ms = now + (duration_sec * 1000.0) as u64;
                    state.next_lag_spike_at_ms = 0;
                }
            }
        }

        // 3) Enqueue sends for clients that are due (next_poll_at <= now, not in block, not already in pending_sends)
        let pending_client_ids: Vec<String> = {
            let sends = pending_sends.lock().await;
            sends.iter().map(|s| s.client_id.clone()).collect()
        };
        let mut sends_to_add: Vec<PendingSend> = Vec::new();
        {
            let mut rng = rand::thread_rng();
            for mut entry in config.runner_state.clients.iter_mut() {
                let client_id = entry.key().clone();
                if pending_client_ids.contains(&client_id) {
                    continue;
                }
                let state = entry.value_mut();
                if now < state.next_poll_at_ms || now <= state.lag_spike_block_until_ms {
                    continue;
                }
                let record = match config.store.get_full(&client_id) {
                    Some(r) => r,
                    None => continue,
                };
                let c2s_anchors = curve_anchors(&record, "clientToServerDelayDist");
                let c2s_ms = record_sample_ms(&config.store, &client_id, "clientToServerDelayDist", &c2s_anchors, &mut rng);
                sends_to_add.push(PendingSend {
                    client_id,
                    send_at_ms: now + c2s_ms as u64,
                    c2s_ms,
                });
            }
        }
        {
            let mut sends = pending_sends.lock().await;
            for s in sends_to_add {
                sends.push_back(s);
            }
        }

        // 4) Process pending sends that are due: start HTTP (up to cap)
        let mut to_send: Vec<PendingSend> = Vec::new();
        {
            let mut sends = pending_sends.lock().await;
            while let Some(front) = sends.front() {
                if front.send_at_ms > now {
                    break;
                }
                if in_flight.load(Ordering::Relaxed) >= MAX_IN_FLIGHT {
                    break;
                }
                to_send.push(sends.pop_front().unwrap());
            }
        }
        for pending in to_send {
            let client_id = pending.client_id.clone();
            let c2s_ms = pending.c2s_ms;
            if now <= config.runner_state.clients.get(&client_id).map(|s| s.lag_spike_block_until_ms).unwrap_or(0) {
                pending_sends.lock().await.push_back(pending);
                continue;
            }
            let record = match config.store.get_full(&client_id) {
                Some(r) => r,
                None => continue,
            };
            let store = config.store.clone();
            let url = format!("{}/api/poll", config.main_server_url.trim_end_matches('/'));
            let client_clone = client.clone();
            let pending_deliveries = pending_deliveries.clone();
            let in_flight = in_flight.clone();
            let device_id = record.device_id.clone();
            let last_rtt = config.runner_state.clients.get(&client_id).and_then(|s| s.last_rtt_ms);

            if in_flight.load(Ordering::Relaxed) >= MAX_IN_FLIGHT {
                pending_sends.lock().await.push_back(pending);
                continue;
            }
            in_flight.fetch_add(1, Ordering::Relaxed);

            tokio::spawn(async move {
                let mut headers = reqwest::header::HeaderMap::new();
                if let Ok(h) = reqwest::header::HeaderValue::from_str(&device_id) {
                    headers.insert("x-device-id", h);
                }
                if let Some(rtt) = last_rtt {
                    if let Ok(h) = reqwest::header::HeaderValue::from_str(&rtt.to_string()) {
                        headers.insert("x-ping-ms", h);
                    }
                }
                let res = client_clone.get(&url).headers(headers).send().await;
                let _ = in_flight.fetch_sub(1, Ordering::Relaxed);

                let response = match res.and_then(|r| r.error_for_status()) {
                    Ok(r) => r,
                    Err(_) => return,
                };
                let body: PollResponse = match response.json().await {
                    Ok(b) => b,
                    Err(_) => return,
                };
                let (s2c_ms, deliver_at) = {
                    let record = match store.get_full(&client_id) {
                        Some(r) => r,
                        None => return,
                    };
                    let s2c_anchors = curve_anchors(&record, "serverToClientDelayDist");
                    let mut rng = rand::thread_rng();
                    let (x_min, x_max) = store::chart_bounds_for_key("serverToClientDelayDist");
                    let (x, y) = distribution::sample_from_distribution(&s2c_anchors, x_min, x_max, &mut rng);
                    let _ = store.append_sample(&client_id, "serverToClientDelayDist", SamplePoint { x, y });
                    let s2c_ms = x.round().max(0.0) as u32;
                    let deliver_at = now_ms() + s2c_ms as u64;
                    (s2c_ms, deliver_at)
                };
                let mut list = pending_deliveries.lock().await;
                list.push((client_id, deliver_at, body, c2s_ms, s2c_ms));
            });
        }

        // 5) Process pending deliveries that are due
        let mut to_deliver: Vec<(String, PollResponse, u32, u32)> = Vec::new();
        {
            let mut list = pending_deliveries.lock().await;
            let mut i = 0;
            while i < list.len() {
                if list[i].1 <= now {
                    let (client_id, _, response, c2s, s2c) = list.remove(i);
                    to_deliver.push((client_id, response, c2s, s2c));
                } else {
                    i += 1;
                }
            }
        }
        for (client_id, response, c2s_ms, s2c_ms) in to_deliver {
            let rtt = c2s_ms + s2c_ms;
            let mut state_opt = config.runner_state.clients.get_mut(&client_id);
            let state = match state_opt.as_mut() {
                Some(s) => s,
                None => continue,
            };
            if now <= state.lag_spike_block_until_ms {
                continue;
            }
            let (display_color, server_time_est) = client_sync::apply_poll_response(
                &mut state.sync_state,
                &response,
                rtt,
                now,
            );
            state.last_rtt_ms = Some(rtt);
            let record = match config.store.get_full(&client_id) {
                Some(r) => r,
                None => continue,
            };
            let anchors = curve_anchors(&record, "pingsEverySecDist");
            let next_poll_sec = record_sample_sec(
                &config.store,
                &client_id,
                "pingsEverySecDist",
                &anchors,
                &mut rand::thread_rng(),
            );
            state.next_poll_at_ms = now + (next_poll_sec * 1000.0) as u64;
            let actual_ms = now;
            let error_ms = server_time_est - (actual_ms as i64);
            let _ = config.store.update_display(
                &client_id,
                Some(server_time_est),
                Some(display_color),
                Some(actual_ms),
                Some(error_ms),
            );
        }
    }
}

fn curve_anchors(record: &store::SimulatedClientRecord, dist_key: &str) -> Vec<(f64, f64)> {
    let curve = SimulatedStore::curve_for_key(record, dist_key);
    curve.anchors.iter().map(|a| (a.x, a.y)).collect()
}
