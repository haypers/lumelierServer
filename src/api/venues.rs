//! # Venues API — List, Get, Put Venue Shapes
//!
//! Venue shapes are stored as JSON files under venue_shapes_path. List returns sorted .json names;
//! GET returns file contents; PUT writes body to file. Names are sanitized to prevent path traversal.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use crate::api::AdminAppState;

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

pub async fn list_venues(
    State(state): State<AdminAppState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    let mut names = Vec::new();
    let mut entries = tokio::fs::read_dir(&state.venue_shapes_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".json") {
            names.push(name);
        }
    }
    names.sort();
    Ok(Json(names))
}

pub async fn get_venue(
    State(state): State<AdminAppState>,
    Path(name): Path<String>,
) -> Result<axum::response::Response, StatusCode> {
    let name = ensure_json_ext(&name);
    let safe = sanitize_filename(&name).ok_or(StatusCode::BAD_REQUEST)?;
    let file_path = state.venue_shapes_path.join(&safe);
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        })?;
    Ok(([("content-type", "application/json")], bytes).into_response())
}

pub async fn put_venue(
    State(state): State<AdminAppState>,
    Path(name): Path<String>,
    body: axum::body::Bytes,
) -> Result<StatusCode, StatusCode> {
    let name = ensure_json_ext(&name);
    let safe = sanitize_filename(&name).ok_or(StatusCode::BAD_REQUEST)?;
    let file_path = state.venue_shapes_path.join(&safe);
    tokio::fs::write(&file_path, &body)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}
