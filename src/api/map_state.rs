//! # Map State API — Server-Owned Connected Devices Map State
//!
//! Stores current map state in memory (venue shape + mapped clients options), exposes read/write,
//! and provides load/save venue actions backed by venue shape JSON files.

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::api::AdminAppState;

type ApiError = (StatusCode, String);
type ApiResult<T> = Result<Json<T>, ApiError>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapState {
    pub points: Vec<[f64; 2]>,
    pub loaded_venue_name: Option<String>,
    pub map_clients: MapClientsState,
}

impl Default for MapState {
    fn default() -> Self {
        Self {
            points: Vec::new(),
            loaded_venue_name: None,
            map_clients: MapClientsState::default(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapClientsState {
    pub parent_mode: MapClientsParentMode,
    pub mapped_limit: u32,
    pub sub_mode: Option<MapClientsSubMode>,
}

impl Default for MapClientsState {
    fn default() -> Self {
        Self {
            parent_mode: MapClientsParentMode::None,
            mapped_limit: 10,
            sub_mode: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MapClientsParentMode {
    None,
    Mapped,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MapClientsSubMode {
    LocationOnly,
    PlannedColor,
    SimulatedColors,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VenueNameBody {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VenueShapeBody {
    pub points: Vec<[f64; 2]>,
}

pub async fn get_map_state(State(state): State<AdminAppState>) -> Json<MapState> {
    let current = state.map_state.load();
    Json(current.as_ref().clone())
}

pub async fn post_map_state(
    State(state): State<AdminAppState>,
    Json(mut body): Json<MapState>,
) -> ApiResult<MapState> {
    validate_and_normalize_map_state(&mut body)?;
    state.map_state.store(Arc::new(body.clone()));
    Ok(Json(body))
}

pub async fn post_load_map_state_venue(
    State(state): State<AdminAppState>,
    Json(body): Json<VenueNameBody>,
) -> ApiResult<MapState> {
    let name = ensure_json_ext(&body.name);
    let safe_name = sanitize_filename(&name)
        .ok_or((StatusCode::BAD_REQUEST, "Invalid venue name.".to_string()))?;
    let file_path = state.venue_shapes_path.join(&safe_name);
    let bytes = tokio::fs::read(&file_path).await.map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => (StatusCode::NOT_FOUND, "Venue not found.".to_string()),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read venue file.".to_string(),
        ),
    })?;

    let parsed: VenueShapeBody = serde_json::from_slice(&bytes).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "Venue file JSON is invalid.".to_string(),
        )
    })?;
    validate_points(&parsed.points)?;

    let current = state.map_state.load();
    let mut next = current.as_ref().clone();
    next.points = parsed.points;
    next.loaded_venue_name = Some(safe_name);
    state.map_state.store(Arc::new(next.clone()));
    Ok(Json(next))
}

pub async fn post_save_map_state_venue(
    State(state): State<AdminAppState>,
    Json(body): Json<VenueNameBody>,
) -> ApiResult<MapState> {
    let name = ensure_json_ext(&body.name);
    let safe_name = sanitize_filename(&name)
        .ok_or((StatusCode::BAD_REQUEST, "Invalid venue name.".to_string()))?;

    let current = state.map_state.load();
    let mut next = current.as_ref().clone();
    validate_points(&next.points)?;
    if next.points.len() < 3 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Cannot save venue with fewer than 3 points.".to_string(),
        ));
    }

    let content = serde_json::to_vec(&VenueShapeBody {
        points: next.points.clone(),
    })
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to serialize map points.".to_string(),
        )
    })?;
    let file_path = state.venue_shapes_path.join(&safe_name);
    tokio::fs::write(&file_path, content).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to write venue file.".to_string(),
        )
    })?;

    next.loaded_venue_name = Some(safe_name);
    state.map_state.store(Arc::new(next.clone()));
    Ok(Json(next))
}

fn validate_and_normalize_map_state(state: &mut MapState) -> Result<(), ApiError> {
    validate_points(&state.points)?;

    if !(1..=10_000).contains(&state.map_clients.mapped_limit) {
        return Err((
            StatusCode::BAD_REQUEST,
            "mapClients.mappedLimit must be between 1 and 10000.".to_string(),
        ));
    }

    match state.map_clients.parent_mode {
        MapClientsParentMode::None => {
            state.map_clients.sub_mode = None;
        }
        MapClientsParentMode::Mapped => {
            if state.map_clients.sub_mode.is_none() {
                state.map_clients.sub_mode = Some(MapClientsSubMode::LocationOnly);
            }
        }
    }

    if let Some(name) = state.loaded_venue_name.as_deref() {
        let normalized = ensure_json_ext(name);
        let safe_name = sanitize_filename(&normalized)
            .ok_or((StatusCode::BAD_REQUEST, "Invalid loadedVenueName.".to_string()))?;
        state.loaded_venue_name = Some(safe_name);
    }

    Ok(())
}

fn validate_points(points: &[[f64; 2]]) -> Result<(), ApiError> {
    if !points.is_empty() && points.len() < 3 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Map state must include either 0 points or at least 3 points.".to_string(),
        ));
    }

    for point in points {
        let lat = point[0];
        let lon = point[1];
        if !lat.is_finite() || !lon.is_finite() {
            return Err((
                StatusCode::BAD_REQUEST,
                "Point coordinates must be finite numbers.".to_string(),
            ));
        }
        if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
            return Err((
                StatusCode::BAD_REQUEST,
                "Point coordinates are out of bounds.".to_string(),
            ));
        }
    }

    Ok(())
}

fn sanitize_filename(name: &str) -> Option<String> {
    if name.is_empty() || name.contains("..") || name.contains('/') || name.contains('\\') {
        return None;
    }
    let ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-');
    if !ok {
        return None;
    }
    Some(name.to_string())
}

fn ensure_json_ext(name: &str) -> String {
    if name.ends_with(".json") {
        name.to_string()
    } else {
        format!("{}.json", name)
    }
}
