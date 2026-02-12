use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use std::sync::Arc;
use std::time::Duration;
use tower_http::cors::{Any, CorsLayer};

use crate::distribution;
use crate::store::{
    chart_bounds_for_key, ClientSummary, MinimalClient, SamplePoint, SimulatedClientRecord,
    SimulatedStore, DIST_KEYS,
};

pub type AppState = Arc<SimulatedStore>;

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

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}

async fn get_clients_minimal(State(store): State<AppState>) -> Json<Vec<MinimalClient>> {
    Json(store.get_minimal_list())
}

async fn get_client_full(
    State(store): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SimulatedClientRecord>, StatusCode> {
    let record = store.get_full(&id).ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(record))
}

async fn post_clients(
    State(store): State<AppState>,
    Json(body): Json<PostClientsBody>,
) -> Json<CreatedResponse> {
    let list = body.clients.unwrap_or_default();
    let created = store.add_clients(list);
    Json(CreatedResponse { created })
}

async fn post_summaries(
    State(store): State<AppState>,
    Json(body): Json<SummariesBody>,
) -> Json<SummariesResponse> {
    let ids = body.ids.unwrap_or_default();
    let summaries = store.get_summaries_for_ids(&ids);
    Json(SummariesResponse { summaries })
}

async fn post_sample(
    State(store): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<SampleBody>,
) -> Result<Json<SamplePoint>, StatusCode> {
    let dist_key = body
        .dist_key
        .as_deref()
        .filter(|k| DIST_KEYS.contains(&k))
        .ok_or(StatusCode::BAD_REQUEST)?;
    let record = store.get_full(&id).ok_or(StatusCode::NOT_FOUND)?;
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
    store
        .append_sample(&id, dist_key, point.clone())
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(point))
}

async fn patch_client(
    State(store): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> StatusCode {
    if store.patch(&id, &body) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

async fn delete_client(
    State(store): State<AppState>,
    Path(id): Path<String>,
) -> StatusCode {
    if store.remove(&id) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

async fn delete_all_clients(State(store): State<AppState>) -> StatusCode {
    store.clear();
    StatusCode::NO_CONTENT
}

pub fn simulated_app(store: AppState) -> Router {
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
        .layer(cors)
        .with_state(store)
}
