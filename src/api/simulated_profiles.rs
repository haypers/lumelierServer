//! # Simulated Client Profiles API — Save and Load Profiles (show-scoped)
//!
//! Profiles (JSON for simulated client config) are stored under each show's simulatedClientProfiles/.
//! POST save: name + profile JSON, optional overwrite. GET list: .json names. GET by name: file contents.
//! Filenames sanitized (no path traversal).

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use tokio::fs;

use crate::api::sanitize::{ensure_json_ext, sanitize_filename};
use crate::api::show_workspaces::check_show_access;
use crate::api::AdminAppState;
use crate::auth;

fn profile_dir(state: &AdminAppState, show_id: &str) -> std::path::PathBuf {
    state.shows_path.join(show_id).join("simulatedClientProfiles")
}

#[derive(Deserialize)]
pub struct SaveProfileRequest {
    pub name: String,
    #[serde(default)]
    pub overwrite: bool,
    pub profile: serde_json::Value,
}

#[derive(serde::Serialize)]
pub struct SaveProfileResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exists: Option<bool>,
}

/// POST /api/admin/show-workspaces/:show_id/simulated-client-profiles
pub async fn post_save_simulated_client_profile(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<SaveProfileRequest>,
) -> Result<Json<SaveProfileResponse>, (StatusCode, Json<SaveProfileResponse>)> {
    let session_id = auth::parse_session_cookie(&headers).ok_or((
        StatusCode::UNAUTHORIZED,
        Json(SaveProfileResponse {
            success: false,
            exists: None,
        }),
    ))?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or((
            StatusCode::UNAUTHORIZED,
            Json(SaveProfileResponse {
                success: false,
                exists: None,
            }),
        ))?;
    check_show_access(&state, &username, &show_id).await.map_err(|e| {
        (
            e,
            Json(SaveProfileResponse {
                success: false,
                exists: None,
            }),
        )
    })?;

    let name = ensure_json_ext(body.name.trim());
    let safe = sanitize_filename(&name).ok_or((
        StatusCode::BAD_REQUEST,
        Json(SaveProfileResponse {
            success: false,
            exists: None,
        }),
    ))?;

    let dir = profile_dir(&state, &show_id);
    let file_path = dir.join(&safe);
    if file_path.exists() && !body.overwrite {
        return Err((
            StatusCode::CONFLICT,
            Json(SaveProfileResponse {
                success: false,
                exists: Some(true),
            }),
        ));
    }

    let bytes = serde_json::to_vec_pretty(&body.profile).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(SaveProfileResponse {
                success: false,
                exists: None,
            }),
        )
    })?;

    fs::create_dir_all(&dir).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(SaveProfileResponse {
                success: false,
                exists: None,
            }),
        )
    })?;
    fs::write(&file_path, &bytes).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(SaveProfileResponse {
                success: false,
                exists: None,
            }),
        )
    })?;

    Ok(Json(SaveProfileResponse {
        success: true,
        exists: None,
    }))
}

/// GET /api/admin/show-workspaces/:show_id/simulated-client-profiles
pub async fn list_simulated_client_profiles(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Vec<String>>, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;

    let dir = profile_dir(&state, &show_id);
    let mut names = Vec::new();
    if dir.exists() {
        let mut entries = fs::read_dir(&dir)
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
    }
    names.sort();
    Ok(Json(names))
}

/// GET /api/admin/show-workspaces/:show_id/simulated-client-profiles/:name
pub async fn get_simulated_client_profile(
    State(state): State<AdminAppState>,
    Path((show_id, name)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<axum::response::Response, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;

    let name = ensure_json_ext(name.trim());
    let safe = sanitize_filename(&name).ok_or(StatusCode::BAD_REQUEST)?;
    let file_path = profile_dir(&state, &show_id).join(&safe);
    let bytes = fs::read(&file_path).await.map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    })?;
    Ok(([("content-type", "application/json")], bytes).into_response())
}
