//! # HTTP Routes — API for the Admin UI and Runner
//!
//! Defines all endpoints: health, GET/POST/DELETE /clients, POST /clients/summaries,
//! GET/PATCH/DELETE /clients/:id, POST /clients/:id/sample. Shared state is store + runner_state
//! (passed via Axum's State extractor).

use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use std::sync::Arc;
use std::time::Duration;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;

use crate::distribution;
use crate::runner_state::RunnerState;
use crate::store::{
    chart_bounds_for_key, ClientSummary, MinimalClient, SamplePoint, SimulatedClientRecord,
    SimulatedStore, DIST_KEYS,
};
use std::time::UNIX_EPOCH;

/// State shared by all route handlers: the store and the runner state (so we can read timers/lag).
#[derive(Clone)]
pub struct SimulatedAppState {
    pub store: Arc<SimulatedStore>,
    pub runner_state: Arc<RunnerState>,
}

pub type AppState = SimulatedAppState;

#[derive(serde::Serialize)]
struct HealthResponse {
    ok: bool,
}

#[derive(serde::Deserialize)]
struct PostClientsBody {
    clients: Option<Vec<crate::store::SimulatedClientInput>>,
}

#[derive(serde::Serialize)]
struct CreatedResponse {
    created: usize,
}

#[derive(serde::Deserialize)]
struct SummariesBody {
    ids: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
struct SummariesResponse {
    summaries: Vec<ClientSummary>,
}

#[derive(serde::Deserialize)]
struct SampleBody {
    #[serde(rename = "distKey")]
    dist_key: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientFullResponse {
    #[serde(flatten)]
    record: SimulatedClientRecord,
    next_poll_in_ms: Option<u64>,
    next_lag_spike_in_ms: Option<u64>,
    lag_ends_in_ms: Option<u64>,
    /// Back-compat: original field name used by the UI.
    #[serde(rename = "lastRttMs")]
    last_rtt_ms: Option<u32>,
    #[serde(rename = "lastNetworkRttMs")]
    last_network_rtt_ms: Option<u32>,
    #[serde(rename = "lastProcessingMs")]
    last_processing_ms: Option<u32>,
    #[serde(rename = "lastEffectiveRttMs")]
    last_effective_rtt_ms: Option<u32>,
}

/// Current time as milliseconds since Unix epoch (for timer math).
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// GET / and GET /health — simple health check.
async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}

/// GET /clients — list all clients as { id, deviceId } for pagination.
async fn get_clients_minimal(State(state): State<AppState>) -> Json<Vec<MinimalClient>> {
    Json(state.store.get_minimal_list())
}

/// GET /clients/:id — full record plus runner timers (next poll, next lag, lag ends in, last RTT).
async fn get_client_full(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ClientFullResponse>, StatusCode> {
    let record = state.store.get_full(&id).ok_or(StatusCode::NOT_FOUND)?;
    let now = now_ms();
    let (next_poll_in_ms, next_lag_spike_in_ms, lag_ends_in_ms, last_rtt_ms, last_network_rtt_ms, last_processing_ms, last_effective_rtt_ms) =
        if let Some(runner) = state.runner_state.clients.get(&id) {
            let next_poll_in_ms = runner.next_poll_at_ms.saturating_sub(now);
            let next_lag_spike_in_ms = if runner.next_lag_spike_at_ms == 0 {
                None
            } else {
                Some(runner.next_lag_spike_at_ms.saturating_sub(now))
            };
            let lag_ends_in_ms = if now < runner.lag_spike_block_until_ms {
                runner.lag_spike_block_until_ms - now
            } else {
                0
            };
            let last_rtt_ms = runner.last_network_rtt_ms;
            let last_network_rtt_ms = runner.last_network_rtt_ms;
            let last_processing_ms = runner.last_processing_ms;
            let last_effective_rtt_ms = runner.last_effective_rtt_ms;
            (
                Some(next_poll_in_ms),
                next_lag_spike_in_ms,
                Some(lag_ends_in_ms),
                last_rtt_ms,
                last_network_rtt_ms,
                last_processing_ms,
                last_effective_rtt_ms,
            )
        } else {
            (None, None, None, None, None, None, None)
        };
    Ok(Json(ClientFullResponse {
        record,
        next_poll_in_ms,
        next_lag_spike_in_ms,
        lag_ends_in_ms,
        last_rtt_ms,
        last_network_rtt_ms,
        last_processing_ms,
        last_effective_rtt_ms,
    }))
}

/// POST /clients — create clients from body; returns { created: number }.
async fn post_clients(
    State(state): State<AppState>,
    Json(body): Json<PostClientsBody>,
) -> Json<CreatedResponse> {
    let list = body.clients.unwrap_or_default();
    let created = state.store.add_clients(list);
    Json(CreatedResponse { created })
}

/// POST /clients/summaries — body { ids: string[] }; returns summaries (color, clock error, lag) in same order; lag filled from runner.
async fn post_summaries(
    State(state): State<AppState>,
    Json(body): Json<SummariesBody>,
) -> Json<SummariesResponse> {
    let ids = body.ids.unwrap_or_default();
    let mut summaries = state.store.get_summaries_for_ids(&ids);
    let now = now_ms();
    for s in &mut summaries {
        s.lag_ends_in_ms = Some(
            state
                .runner_state
                .clients
                .get(&s.id)
                .map(|r| {
                    if now < r.lag_spike_block_until_ms {
                        r.lag_spike_block_until_ms - now
                    } else {
                        0
                    }
                })
                .unwrap_or(0),
        );
    }
    Json(SummariesResponse { summaries })
}

/// POST /clients/:id/sample — body { distKey }; sample from that curve, append to history, return { x, y }.
async fn post_sample(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<SampleBody>,
) -> Result<Json<SamplePoint>, StatusCode> {
    let dist_key = body
        .dist_key
        .as_deref()
        .filter(|k| DIST_KEYS.contains(&k))
        .ok_or(StatusCode::BAD_REQUEST)?;
    let record = state.store.get_full(&id).ok_or(StatusCode::NOT_FOUND)?;
    let curve = SimulatedStore::curve_for_key(&record, dist_key);
    let (x_min, x_max) = chart_bounds_for_key(dist_key);
    let anchors: Vec<(f64, f64)> = curve.anchors.iter().map(|a| (a.x, a.y)).collect();
    let (x, y) = distribution::sample_from_distribution(
        &anchors,
        x_min,
        x_max,
        &mut rand::thread_rng(),
    );
    let point = SamplePoint { x, y };
    state
        .store
        .append_sample(&id, dist_key, point.clone())
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(point))
}

/// PATCH /clients/:id — partial update (currentDisplayColor and/or distribution anchors). 204 on success, 404 if not found.
async fn patch_client(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> StatusCode {
    if state.store.patch(&id, &body) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

/// DELETE /clients/:id — remove one client. 204 or 404.
async fn delete_client(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> StatusCode {
    if state.store.remove(&id) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

/// DELETE /clients — remove all clients. Always 204.
async fn delete_all_clients(State(state): State<AppState>) -> StatusCode {
    state.store.clear();
    StatusCode::NO_CONTENT
}

/// Build the Axum Router with all routes, CORS, body size limit, and shared state.
pub fn simulated_app(store: Arc<SimulatedStore>, runner_state: Arc<RunnerState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PATCH,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([axum::http::header::CONTENT_TYPE])
        .max_age(Duration::from_secs(86400));

    Router::new()
        .route("/", get(health))
        .route("/health", get(health))
        .route(
            "/clients",
            get(get_clients_minimal)
                .post(post_clients)
                .delete(delete_all_clients),
        )
        .route("/clients/summaries", post(post_summaries))
        .route(
            "/clients/:id",
            get(get_client_full)
                .patch(patch_client)
                .delete(delete_client),
        )
        .route("/clients/:id/sample", post(post_sample))
        // Disable Axum’s 2MB default so DELETE (no body) and large POSTs don’t get 413.
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(100 * 1024 * 1024)) // 100 MB max body (bulk POST /clients, POST /clients/summaries)
        .layer(cors)
        .with_state(SimulatedAppState { store, runner_state })
}
