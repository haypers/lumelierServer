use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use crate::api::AdminAppState;

/// Sanitize name: only allow [a-zA-Z0-9._-], reject "..", "/", "\\".
/// Returns None if invalid.
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

/// Ensure the name ends with .json for storage; if not, append it.
fn ensure_json_ext(name: &str) -> String {
    if name.ends_with(".json") {
        name.to_string()
    } else {
        format!("{}.json", name)
    }
}

pub async fn list_shows(
    State(state): State<AdminAppState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    let mut names = Vec::new();
    let mut entries = tokio::fs::read_dir(&state.show_timelines_path)
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

pub async fn get_show(
    State(state): State<AdminAppState>,
    Path(name): Path<String>,
) -> Result<axum::response::Response, StatusCode> {
    let name = ensure_json_ext(&name);
    let safe = sanitize_filename(&name).ok_or(StatusCode::BAD_REQUEST)?;
    let file_path = state.show_timelines_path.join(&safe);
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        })?;
    Ok((
        [("content-type", "application/json")],
        bytes,
    ).into_response())
}

pub async fn put_show(
    State(state): State<AdminAppState>,
    Path(name): Path<String>,
    body: axum::body::Bytes,
) -> Result<StatusCode, StatusCode> {
    let name = ensure_json_ext(&name);
    let safe = sanitize_filename(&name).ok_or(StatusCode::BAD_REQUEST)?;
    let file_path = state.show_timelines_path.join(&safe);
    tokio::fs::write(&file_path, &body)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}
