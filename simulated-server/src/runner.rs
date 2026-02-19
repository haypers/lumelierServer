//! # Runner — Simulated Clients in the Loop
//!
//! The runner is a background task that:
//! 1. **Sync loop** (every SYNC_INTERVAL_MS): ensures every client in the store has an entry in runner_state,
//!    and spawns three per-client tasks if new: poll loop, lag loop, display loop.
//! 2. **Poll loop** (per client): sleep until next_poll_at_ms (or end of lag block), apply C2S delay, GET /api/poll,
//!    apply S2C delay, then apply_poll_response and schedule next poll from distribution.
//! 3. **Lag loop** (per client): sleep until next lag spike or end of current spike; then either start a spike
//!    (sample duration, set lag_spike_block_until_ms) or schedule next spike from distribution.
//! 4. **Display loop** (per client): wake on channel (when poll delivered) or timer; compute current color from
//!    broadcast timeline and update store; schedule next wake at next color change or fallback interval.
//!
//! We sample distributions on every use (no cached values). No in-flight cap — stress test friendly.

use crate::client_sync::{self, PollResponse};
use crate::distribution;
use crate::runner_state::RunnerState;
use crate::store::{self, SamplePoint, SimulatedStore};
use rand::Rng;
use std::collections::HashSet;
use std::sync::Arc;
use std::pin::Pin;
use std::time::{Duration, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio::time::sleep;

const SYNC_INTERVAL_MS: u64 = 1000;
const DISPLAY_FALLBACK_SEC: u64 = 15;

/// Current time as milliseconds since Unix epoch.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Config passed into the runner: main server URL, store, and runner state (all shared via Arc).
pub struct RunnerConfig {
    pub main_server_url: String,
    pub store: Arc<SimulatedStore>,
    pub runner_state: Arc<RunnerState>,
}

/// Sample from a distribution, append (x, y) to the client's chart history, and return (x, y).
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

/// Like record_sample but returns x in milliseconds (for delay dists; pings/lag dists store x in sec so we convert).
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

/// Like record_sample but returns x in seconds (for pings interval, lag timing). Clamped to >= 0.
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

/// Main runner entry: runs forever. Every SYNC_INTERVAL_MS we sync store ↔ runner_state and spawn new client tasks.
pub async fn run_runner(config: RunnerConfig) {
    let config = Arc::new(config);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("reqwest client");

    let mut sync_interval = tokio::time::interval(Duration::from_millis(SYNC_INTERVAL_MS));
    sync_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        sync_interval.tick().await;
        let now = now_ms();
        let ids = config.store.all_ids();
        let ids_set: HashSet<String> = ids.iter().cloned().collect();
        config.runner_state.retain_only_ids(&ids_set);

        let mut rng = rand::thread_rng();
        for id in &ids {
            // New client: create runner state with first poll/lag times spread over [0, interval], then spawn three loops.
            if !config.runner_state.clients.contains_key(id) {
                let record = match config.store.get_full(id) {
                    Some(r) => r,
                    None => continue,
                };
                // First time only: spread initial timers over [0, full_interval] to avoid sync at creation.
                let poll_anchors = curve_anchors(&record, "pingsEverySecDist");
                let poll_interval_sec = record_sample_sec(
                    &config.store,
                    id,
                    "pingsEverySecDist",
                    &poll_anchors,
                    &mut rng,
                );
                let first_poll_delay_sec = poll_interval_sec * rng.gen::<f64>();
                let next_poll = now + (first_poll_delay_sec * 1000.0) as u64;

                let lag_anchors = curve_anchors(&record, "timeBetweenLagSpikesDist");
                let lag_interval_sec = record_sample_sec(
                    &config.store,
                    id,
                    "timeBetweenLagSpikesDist",
                    &lag_anchors,
                    &mut rng,
                );
                let first_lag_delay_sec = lag_interval_sec * rng.gen::<f64>();
                let next_lag = now + (first_lag_delay_sec * 1000.0) as u64;

                config.runner_state.ensure_client(id.clone(), next_poll, next_lag);

                let client_id = id.clone();
                let (tx, rx) = mpsc::unbounded_channel();
                if let Some(mut state) = config.runner_state.clients.get_mut(&client_id) {
                    state.display_sync_tx = Some(tx);
                }
                let config_display = config.clone();
                tokio::spawn(async move {
                    client_display_loop(client_id, config_display, rx).await;
                });

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
}

/// Per-client task: wait until next lag spike time or end of current spike, then either start a spike (sample duration) or schedule next spike.
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

/// Per-client task: sleep until next poll time (or end of lag block), apply C2S delay, GET /api/poll, S2C delay, apply_poll_response, schedule next poll.
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
        let t0_ms = now_ms();
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
        let last_rtt = config
            .runner_state
            .clients
            .get(&client_id)
            .and_then(|s| s.last_network_rtt_ms);
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(h) = reqwest::header::HeaderValue::from_str(&device_id) {
            headers.insert("x-device-id", h);
        }
        if let Some(rtt) = last_rtt {
            if let Ok(h) = reqwest::header::HeaderValue::from_str(&rtt.to_string()) {
                headers.insert("x-ping-ms", h);
            }
        }
        if let Ok(h) = reqwest::header::HeaderValue::from_str(&t0_ms.to_string()) {
            headers.insert("x-client-send-ms", h);
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

        // For clock sync math, treat t3 as the *ideal* network receive time (no runtime scheduler bias).
        // Any lateness between ideal receive and actual apply is modeled as processing/timer delay below.
        let t3_recv_ms_ideal = t0_ms
            .saturating_add(u64::from(c2s_ms))
            .saturating_add(u64::from(s2c_ms));

        // Simulate client-side receive/processing delay (browser main-thread / JSON parse / timer slop).
        let processing_anchors = curve_anchors(&record, "clientProcessingDelayMsDist");
        let processing_sample_ms = record_sample_ms(
            &config.store,
            &client_id,
            "clientProcessingDelayMsDist",
            &processing_anchors,
            &mut rand::thread_rng(),
        );
        if processing_sample_ms > 0 {
            sleep(Duration::from_millis(processing_sample_ms as u64)).await;
        }

        let deliver_at = now_ms();
        let network_rtt_ms = c2s_ms + s2c_ms;
        // Total time between ideal network receive and actual apply-time.
        let processing_total_ms = deliver_at.saturating_sub(t3_recv_ms_ideal).min(u64::from(u32::MAX)) as u32;
        let effective_rtt_ms = network_rtt_ms.saturating_add(processing_total_ms);

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
            t0_ms,
            t3_recv_ms_ideal,
            deliver_at,
        );
        state.last_network_rtt_ms = Some(network_rtt_ms);
        state.last_processing_ms = Some(processing_total_ms);
        state.last_effective_rtt_ms = Some(effective_rtt_ms);
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
        if let Some(tx) = state.display_sync_tx.as_ref() {
            let _ = tx.send(());
        }
    }
}

/// Per-client task: wake on message (from poll delivery) or on timer; recompute display color from broadcast and update store; reschedule at next color change or fallback.
async fn client_display_loop(
    client_id: String,
    config: Arc<RunnerConfig>,
    mut rx: mpsc::UnboundedReceiver<()>,
) {
    let mut sleep = Box::pin(tokio::time::sleep(Duration::from_millis(0)));
    loop {
        tokio::select! {
            res = rx.recv() => match res {
                Some(()) => sync_and_schedule(&client_id, &config, &mut sleep).await,
                None => return,
            },
            _ = sleep.as_mut() => {
                sync_and_schedule(&client_id, &config, &mut sleep).await;
            }
        }
    }
}

/// Recompute current color from sync_state and timeline; update store; schedule sleep until next color change or DISPLAY_FALLBACK_SEC.
async fn sync_and_schedule(
    client_id: &str,
    config: &RunnerConfig,
    sleep: &mut Pin<Box<tokio::time::Sleep>>,
) {
    let state_opt = config.runner_state.clients.get_mut(client_id);
    let mut state = match state_opt {
        Some(s) => s,
        None => return,
    };
    let now = now_ms();

    if state.sync_state.broadcast_cache.is_none() {
        let color = state
            .sync_state
            .last_displayed_color
            .clone()
            .unwrap_or_else(|| "#000000".to_string());
        let _ = config.store.update_display(client_id, None, Some(color), None, None);
        drop(state);
        *sleep = Box::pin(tokio::time::sleep(Duration::from_secs(DISPLAY_FALLBACK_SEC)));
        return;
    }

    let position_sec = client_sync::get_broadcast_playback_sec(&state.sync_state, now);
    let current_color = client_sync::get_display_color_at(&state.sync_state, now);
    if state.sync_state.last_displayed_color.as_deref() != Some(current_color.as_str()) {
        state.sync_state.last_displayed_color = Some(current_color.clone());
        let _ = config.store.update_display(client_id, None, Some(current_color), None, None);
    }

    if position_sec.is_none() {
        drop(state);
        *sleep = Box::pin(tokio::time::sleep(Duration::from_secs(DISPLAY_FALLBACK_SEC)));
        return;
    }
    let position_sec = position_sec.unwrap();
    let timeline = &state.sync_state.broadcast_cache.as_ref().unwrap().timeline;
    let next_sec = client_sync::next_color_change_sec(timeline, position_sec);
    drop(state);

    if let Some(next_sec) = next_sec {
        let delay_sec = (next_sec - position_sec).max(0.0);
        let mut delay_ms = (delay_sec * 1000.0).round().max(1.0) as u64;
        // Timer slop: wake up late by a sampled client processing delay.
        if let Some(record) = config.store.get_full(client_id) {
            delay_ms = delay_ms.saturating_add(sample_curve_ms(&record, "clientProcessingDelayMsDist"));
        }
        *sleep = Box::pin(tokio::time::sleep(Duration::from_millis(delay_ms)));
    } else {
        let mut delay_ms = DISPLAY_FALLBACK_SEC * 1000;
        if let Some(record) = config.store.get_full(client_id) {
            delay_ms = delay_ms.saturating_add(sample_curve_ms(&record, "clientProcessingDelayMsDist"));
        }
        *sleep = Box::pin(tokio::time::sleep(Duration::from_millis(delay_ms)));
    }
}

/// Get curve anchors as (x, y) tuples for the distribution module.
fn curve_anchors(record: &store::SimulatedClientRecord, dist_key: &str) -> Vec<(f64, f64)> {
    let curve = SimulatedStore::curve_for_key(record, dist_key);
    curve.anchors.iter().map(|a| (a.x, a.y)).collect()
}

/// Sample a curve (ms) without recording a sample history point.
fn sample_curve_ms(record: &store::SimulatedClientRecord, dist_key: &str) -> u64 {
    let curve = SimulatedStore::curve_for_key(record, dist_key);
    let anchors: Vec<(f64, f64)> = curve.anchors.iter().map(|a| (a.x, a.y)).collect();
    let (x_min, x_max) = store::chart_bounds_for_key(dist_key);
    let (x, _) = distribution::sample_from_distribution(&anchors, x_min, x_max, &mut rand::thread_rng());
    x.round().max(0.0) as u64
}
