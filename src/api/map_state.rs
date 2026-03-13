//! # Map State API — Per-show map state (venue shape + mapped clients options)
//!
//! GET/POST map state for a show. Stored as mapState.json in the show directory.
//! GET returns saved state, or default with points from venueShape.json if no mapState.json yet.

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::api::show_workspaces::check_show_access;
use crate::api::AdminAppState;
use crate::auth;

type ApiError = (StatusCode, String);
type ApiResult<T> = Result<Json<T>, ApiError>;

const MAP_STATE_FILENAME: &str = "mapState.json";
const VENUE_SHAPE_FILENAME: &str = "venueShape.json";

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

#[derive(Debug, Serialize, Deserialize)]
struct VenueShapeBody {
    points: Vec<[f64; 2]>,
}

fn show_dir(state: &AdminAppState, show_id: &str) -> std::path::PathBuf {
    state.shows_path.join(show_id)
}

/// GET /api/admin/show-workspaces/:show_id/map-state
pub async fn get_map_state_show(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<MapState>, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;

    let dir = show_dir(&state, &show_id);
    let map_state_path = dir.join(MAP_STATE_FILENAME);
    let venue_path = dir.join(VENUE_SHAPE_FILENAME);

    if map_state_path.exists() {
        let bytes = fs::read(&map_state_path)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let mut parsed: MapState = serde_json::from_slice(&bytes)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if validate_and_normalize_map_state(&mut parsed).is_err() {
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        return Ok(Json(parsed));
    }

    let mut default_state = MapState::default();
    if venue_path.exists() {
        if let Ok(bytes) = fs::read(&venue_path).await {
            if let Ok(venue) = serde_json::from_slice::<VenueShapeBody>(&bytes) {
                if validate_points(&venue.points).is_ok() {
                    default_state.points = venue.points;
                }
            }
        }
    }
    Ok(Json(default_state))
}

/// POST /api/admin/show-workspaces/:show_id/map-state
pub async fn post_map_state_show(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    Json(mut body): Json<MapState>,
) -> ApiResult<MapState> {
    let session_id = auth::parse_session_cookie(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Not authenticated".to_string()))?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid session".to_string()))?;
    check_show_access(&state, &username, &show_id)
        .await
        .map_err(|e| (e, "Show access denied".to_string()))?;

    validate_and_normalize_map_state(&mut body)?;

    let dir = show_dir(&state, &show_id);
    fs::create_dir_all(&dir)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create show dir".to_string()))?;
    let path = dir.join(MAP_STATE_FILENAME);
    let bytes = serde_json::to_vec_pretty(&body).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to serialize map state".to_string(),
        )
    })?;
    fs::write(&path, &bytes)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to write map state".to_string()))?;
    Ok(Json(body))
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
        let trimmed = name.trim();
        if !trimmed.is_empty() && !trimmed.contains('/') && !trimmed.contains('\\') {
            state.loaded_venue_name = Some(trimmed.to_string());
        }
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
