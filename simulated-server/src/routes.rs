//! # HTTP Routes — API for the Admin UI and Runner
//!
//! Defines all endpoints: health; **notify** (POST from admin when a show goes live or ends);
//! GET/POST/DELETE /shows/:show_id/clients, POST .../clients/summaries,
//! GET/PATCH/DELETE /shows/:show_id/clients/:id, POST .../clients/:id/sample. Shared state is per_show
//! (one bucket per live show); 404 if show is not in the map.

use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use std::sync::Arc;
use std::time::Duration;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;

use crate::distribution;
use crate::per_show::PerShowSimulatedState;
use crate::store::{
    chart_bounds_for_key, ClientSummary, MinimalClient, SamplePoint, SimulatedClientRecord,
    SimulatedStore, DIST_KEYS,
};
use dashmap::DashMap;
use std::time::UNIX_EPOCH;

/// State shared by all route handlers: per-show buckets (store + runner state per show).
#[derive(Clone)]
pub struct SimulatedAppState {
    pub per_show: Arc<DashMap<String, Arc<PerShowSimulatedState>>>,
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

/// Body for POST /notify/show-live and POST /notify/show-ended (sent by the admin server when a show goes live or ends).
#[derive(serde::Deserialize)]
struct NotifyShowBody {
    #[serde(rename = "show_id")]
    show_id: String,
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

/// POST /notify/show-live — called by the admin server when a show goes live (real-time notification).
/// We create a bucket for this show_id immediately so the admin UI can add simulated clients without
/// waiting for the next 10-second poll of GET /api/admin/live-show-ids. The 10s poll remains as a
/// fallback and reconciliation. Body: { "show_id": "..." }. Returns 200.
async fn post_notify_show_live(
    State(state): State<AppState>,
    Json(body): Json<NotifyShowBody>,
) -> StatusCode {
    let show_id = body.show_id.trim();
    if show_id.is_empty() || show_id.len() != 8 || !show_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return StatusCode::BAD_REQUEST;
    }
    state
        .per_show
        .entry(show_id.to_string())
        .or_insert_with(|| Arc::new(PerShowSimulatedState::new()));
    StatusCode::OK
}

/// POST /notify/show-ended — called by the admin server when a show ends live (real-time notification).
/// We remove the bucket for this show_id immediately so memory is freed. Any per-client tasks for
/// that show will exit on their next loop when they see the bucket is missing. The 10s poll also
/// removes stale buckets. Body: { "show_id": "..." }. Returns 204.
async fn post_notify_show_ended(
    State(state): State<AppState>,
    Json(body): Json<NotifyShowBody>,
) -> StatusCode {
    let show_id = body.show_id.trim();
    if show_id.is_empty() || show_id.len() != 8 || !show_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return StatusCode::BAD_REQUEST;
    }
    state.per_show.remove(show_id);
    StatusCode::NO_CONTENT
}

/// GET /shows/:show_id/clients — list all clients as { id, deviceId } for pagination. 404 if show not live.
async fn get_clients_minimal(
    State(state): State<AppState>,
    Path(show_id): Path<String>,
) -> Result<Json<Vec<MinimalClient>>, StatusCode> {
    let bucket = state.per_show.get(&show_id).ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(bucket.store.get_minimal_list()))
}

/// GET /shows/:show_id/clients/:id — full record plus runner timers. 404 if show not live or client not found.
async fn get_client_full(
    State(state): State<AppState>,
    Path((show_id, id)): Path<(String, String)>,
) -> Result<Json<ClientFullResponse>, StatusCode> {
    let bucket = state.per_show.get(&show_id).ok_or(StatusCode::NOT_FOUND)?;
    let record = bucket.store.get_full(&id).ok_or(StatusCode::NOT_FOUND)?;
    let now = now_ms();
    let (next_poll_in_ms, next_lag_spike_in_ms, lag_ends_in_ms, last_rtt_ms, last_network_rtt_ms, last_processing_ms, last_effective_rtt_ms) =
        if let Some(runner) = bucket.runner_state.clients.get(&id) {
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

/// POST /shows/:show_id/clients — create clients from body; returns { created: number }. 404 if show not live.
async fn post_clients(
    State(state): State<AppState>,
    Path(show_id): Path<String>,
    Json(body): Json<PostClientsBody>,
) -> Result<Json<CreatedResponse>, StatusCode> {
    let bucket = state.per_show.get(&show_id).ok_or(StatusCode::NOT_FOUND)?;
    let list = body.clients.unwrap_or_default();
    let created = bucket.store.add_clients(list);
    Ok(Json(CreatedResponse { created }))
}

/// POST /shows/:show_id/clients/summaries — body { ids: string[] }; returns summaries. 404 if show not live.
async fn post_summaries(
    State(state): State<AppState>,
    Path(show_id): Path<String>,
    Json(body): Json<SummariesBody>,
) -> Result<Json<SummariesResponse>, StatusCode> {
    let bucket = state.per_show.get(&show_id).ok_or(StatusCode::NOT_FOUND)?;
    let ids = body.ids.unwrap_or_default();
    let mut summaries = bucket.store.get_summaries_for_ids(&ids);
    let now = now_ms();
    for s in &mut summaries {
        s.lag_ends_in_ms = Some(
            bucket
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
    Ok(Json(SummariesResponse { summaries }))
}

/// POST /shows/:show_id/clients/:id/sample — body { distKey }; sample from that curve. 404 if show not live or client not found.
async fn post_sample(
    State(state): State<AppState>,
    Path((show_id, id)): Path<(String, String)>,
    Json(body): Json<SampleBody>,
) -> Result<Json<SamplePoint>, StatusCode> {
    let bucket = state.per_show.get(&show_id).ok_or(StatusCode::NOT_FOUND)?;
    let dist_key = body
        .dist_key
        .as_deref()
        .filter(|k| DIST_KEYS.contains(&k))
        .ok_or(StatusCode::BAD_REQUEST)?;
    let record = bucket.store.get_full(&id).ok_or(StatusCode::NOT_FOUND)?;
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
    bucket
        .store
        .append_sample(&id, dist_key, point.clone())
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(point))
}

/// PATCH /shows/:show_id/clients/:id — partial update. 404 if show not live or client not found.
async fn patch_client(
    State(state): State<AppState>,
    Path((show_id, id)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> StatusCode {
    let bucket = match state.per_show.get(&show_id) {
        Some(b) => b,
        None => return StatusCode::NOT_FOUND,
    };
    if bucket.store.patch(&id, &body) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

/// DELETE /shows/:show_id/clients/:id — remove one client. 404 if show not live or client not found.
async fn delete_client(
    State(state): State<AppState>,
    Path((show_id, id)): Path<(String, String)>,
) -> StatusCode {
    let bucket = match state.per_show.get(&show_id) {
        Some(b) => b,
        None => return StatusCode::NOT_FOUND,
    };
    if bucket.store.remove(&id) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

/// DELETE /shows/:show_id/clients — remove all clients for that show. 404 if show not live.
async fn delete_all_clients(
    State(state): State<AppState>,
    Path(show_id): Path<String>,
) -> StatusCode {
    let bucket = match state.per_show.get(&show_id) {
        Some(b) => b,
        None => return StatusCode::NOT_FOUND,
    };
    bucket.store.clear();
    StatusCode::NO_CONTENT
}

/// Build the Axum Router with all routes, CORS, body size limit, and shared state.
pub fn simulated_app(per_show: Arc<DashMap<String, Arc<PerShowSimulatedState>>>) -> Router {
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
        .route("/notify/show-live", post(post_notify_show_live))
        .route("/notify/show-ended", post(post_notify_show_ended))
        .route(
            "/shows/:show_id/clients",
            get(get_clients_minimal)
                .post(post_clients)
                .delete(delete_all_clients),
        )
        .route("/shows/:show_id/clients/summaries", post(post_summaries))
        .route(
            "/shows/:show_id/clients/:id",
            get(get_client_full)
                .patch(patch_client)
                .delete(delete_client),
        )
        .route("/shows/:show_id/clients/:id/sample", post(post_sample))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(100 * 1024 * 1024))
        .layer(cors)
        .with_state(SimulatedAppState { per_show })
}
