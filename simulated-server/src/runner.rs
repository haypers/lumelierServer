// Event-driven delay layer (C2S/S2C, lag spike) and HTTP polling via per-client timers.
// No in-flight cap: the simulator may open as many concurrent connections as the OS and main
// server allow (for stress testing). In production, consider raising the OS limit for the server
// (e.g. Linux: ulimit -n, limits.conf; Windows: ephemeral port range, TCP settings) so many
// concurrent connections are supported.
//
// Samples distributions on every use; no cached values.

use crate::client_sync::{self, PollResponse};
use crate::distribution;
use crate::runner_state::RunnerState;
use crate::store::{self, SamplePoint, SimulatedStore};
use rand::Rng;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};
use tokio::time::sleep;

const SYNC_INTERVAL_MS: u64 = 1000;
/// ~60 Hz display tick for re-evaluating current color from broadcast timeline.
const DISPLAY_INTERVAL_MS: u64 = 16;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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
    let config = Arc::new(config);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("reqwest client");

    let mut sync_interval = tokio::time::interval(Duration::from_millis(SYNC_INTERVAL_MS));
    sync_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut display_interval = tokio::time::interval(Duration::from_millis(DISPLAY_INTERVAL_MS));
    display_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = sync_interval.tick() => {
                let now = now_ms();
                let ids = config.store.all_ids();
                let ids_set: HashSet<String> = ids.iter().cloned().collect();
                config.runner_state.retain_only_ids(&ids_set);

                let mut rng = rand::thread_rng();
                for id in &ids {
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
                        let phase_ms = rng.gen_range(0..DISPLAY_INTERVAL_MS);
                        config.runner_state.ensure_client(id.clone(), next_poll, next_lag, now + phase_ms);

                        let client_id = id.clone();
                        let config_lag = config.clone();
                        tokio::spawn(async move {
                            client_lag_loop(client_id, config_lag).await;
                        });
                        let client_id = id.clone();
                        let config_poll = config.clone();
                        let client_poll = client.clone();
                        tokio::spawn(async move {
                            client_poll_loop(client_id, config_poll, client_poll).await;
                        });
                    }
                }
            }
            _ = display_interval.tick() => {
                let now = now_ms();
                for mut entry in config.runner_state.clients.iter_mut() {
                    let client_id = entry.key().clone();
                    let state = entry.value_mut();
                    if now < state.next_display_check_at_ms {
                        continue;
                    }
                    let color = client_sync::get_display_color_at(&state.sync_state, now);
                    let _ = config.store.update_display(&client_id, None, Some(color), None, None);
                    state.next_display_check_at_ms = now + DISPLAY_INTERVAL_MS;
                }
            }
        }
    }
}

async fn client_lag_loop(client_id: String, config: Arc<RunnerConfig>) {
    loop {
        let wake = {
            let state_opt = config.runner_state.clients.get(&client_id);
            let state = match state_opt.as_ref() {
                Some(s) => s,
                None => return,
            };
            let now = now_ms();
            if now < state.lag_spike_block_until_ms {
                Some((true, state.lag_spike_block_until_ms))
            } else if state.next_lag_spike_at_ms != 0 {
                Some((false, state.next_lag_spike_at_ms))
            } else {
                let record = match config.store.get_full(&client_id) {
                    Some(r) => r,
                    None => return,
                };
                let between_anchors = curve_anchors(&record, "timeBetweenLagSpikesDist");
                let between_sec = record_sample_sec(
                    &config.store,
                    &client_id,
                    "timeBetweenLagSpikesDist",
                    &between_anchors,
                    &mut rand::thread_rng(),
                );
                let next = now + (between_sec * 1000.0) as u64;
                drop(state_opt);
                if let Some(mut state) = config.runner_state.clients.get_mut(&client_id) {
                    state.next_lag_spike_at_ms = next;
                } else {
                    return;
                }
                None
            }
        };

        let (in_block, wake_at_ms) = match wake {
            Some(pair) => pair,
            None => continue,
        };

        let delay = wake_at_ms.saturating_sub(now_ms());
        if delay > 0 {
            sleep(Duration::from_millis(delay)).await;
        }

        let record = match config.store.get_full(&client_id) {
            Some(r) => r,
            None => return,
        };
        let mut state_opt = config.runner_state.clients.get_mut(&client_id);
        let state = match state_opt.as_mut() {
            Some(s) => s,
            None => return,
        };
        let now = now_ms();
        if in_block {
            state.next_lag_spike_at_ms = now
                + (record_sample_sec(
                    &config.store,
                    &client_id,
                    "timeBetweenLagSpikesDist",
                    &curve_anchors(&record, "timeBetweenLagSpikesDist"),
                    &mut rand::thread_rng(),
                ) * 1000.0) as u64;
        } else {
            let duration_sec = record_sample_sec(
                &config.store,
                &client_id,
                "lagSpikeDurationDist",
                &curve_anchors(&record, "lagSpikeDurationDist"),
                &mut rand::thread_rng(),
            );
            state.lag_spike_block_until_ms = now + (duration_sec * 1000.0) as u64;
            state.next_lag_spike_at_ms = 0;
        }
    }
}

async fn client_poll_loop(client_id: String, config: Arc<RunnerConfig>, client: reqwest::Client) {
    let url = format!("{}/api/poll", config.main_server_url.trim_end_matches('/'));
    loop {
        let wake_at_ms = {
            let state_opt = config.runner_state.clients.get(&client_id);
            let state = match state_opt {
                Some(s) => s,
                None => return,
            };
            let now = now_ms();
            if now < state.lag_spike_block_until_ms {
                state.lag_spike_block_until_ms
            } else {
                state.next_poll_at_ms
            }
        };

        let delay = wake_at_ms.saturating_sub(now_ms());
        if delay > 0 {
            sleep(Duration::from_millis(delay)).await;
        }

        {
            let state_opt = config.runner_state.clients.get(&client_id);
            let state = match state_opt {
                Some(s) => s,
                None => return,
            };
            if now_ms() < state.lag_spike_block_until_ms {
                continue;
            }
        }

        let record = match config.store.get_full(&client_id) {
            Some(r) => r,
            None => return,
        };
        let c2s_anchors = curve_anchors(&record, "clientToServerDelayDist");
        let c2s_ms = record_sample_ms(
            &config.store,
            &client_id,
            "clientToServerDelayDist",
            &c2s_anchors,
            &mut rand::thread_rng(),
        );
        sleep(Duration::from_millis(c2s_ms as u64)).await;

        {
            let state_opt = config.runner_state.clients.get(&client_id);
            let state = match state_opt {
                Some(s) => s,
                None => return,
            };
            if now_ms() <= state.lag_spike_block_until_ms {
                continue;
            }
        }

        let device_id = record.device_id.clone();
        let last_rtt = config.runner_state.clients.get(&client_id).and_then(|s| s.last_rtt_ms);
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(h) = reqwest::header::HeaderValue::from_str(&device_id) {
            headers.insert("x-device-id", h);
        }
        if let Some(rtt) = last_rtt {
            if let Ok(h) = reqwest::header::HeaderValue::from_str(&rtt.to_string()) {
                headers.insert("x-ping-ms", h);
            }
        }
        let res = client.get(&url).headers(headers).send().await;
        let response = match res.and_then(|r| r.error_for_status()) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let body: PollResponse = match response.json().await {
            Ok(b) => b,
            Err(_) => continue,
        };

        let record = match config.store.get_full(&client_id) {
            Some(r) => r,
            None => return,
        };
        let s2c_anchors = curve_anchors(&record, "serverToClientDelayDist");
        let (x_min, x_max) = store::chart_bounds_for_key("serverToClientDelayDist");
        let (x, y) = distribution::sample_from_distribution(
            &s2c_anchors,
            x_min,
            x_max,
            &mut rand::thread_rng(),
        );
        let _ = config.store.append_sample(
            &client_id,
            "serverToClientDelayDist",
            SamplePoint { x, y },
        );
        let s2c_ms = x.round().max(0.0) as u32;
        sleep(Duration::from_millis(s2c_ms as u64)).await;

        let deliver_at = now_ms();
        let rtt = c2s_ms + s2c_ms;

        let mut state_opt = config.runner_state.clients.get_mut(&client_id);
        let state = match state_opt.as_mut() {
            Some(s) => s,
            None => return,
        };
        if deliver_at <= state.lag_spike_block_until_ms {
            continue;
        }
        let (display_color, server_time_est) = client_sync::apply_poll_response(
            &mut state.sync_state,
            &body,
            rtt,
            deliver_at,
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
        state.next_poll_at_ms = deliver_at + (next_poll_sec * 1000.0) as u64;
        let error_ms = server_time_est - (deliver_at as i64);
        let _ = config.store.update_display(
            &client_id,
            Some(server_time_est),
            Some(display_color),
            Some(deliver_at),
            Some(error_ms),
        );
    }
}

fn curve_anchors(record: &store::SimulatedClientRecord, dist_key: &str) -> Vec<(f64, f64)> {
    let curve = SimulatedStore::curve_for_key(record, dist_key);
    curve.anchors.iter().map(|a| (a.x, a.y)).collect()
}
