use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

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

pub async fn post_save_simulated_client_profile(
    State(state): State<AdminAppState>,
    Json(body): Json<SaveProfileRequest>,
) -> Result<Json<SaveProfileResponse>, (StatusCode, Json<SaveProfileResponse>)> {
    let name = ensure_json_ext(body.name.trim());
    let safe = sanitize_filename(&name).ok_or((
        StatusCode::BAD_REQUEST,
        Json(SaveProfileResponse {
            success: false,
            exists: None,
        }),
    ))?;

    let file_path = state.simulated_client_profiles_path.join(&safe);

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

    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(|_| {
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

pub async fn list_simulated_client_profiles(
    State(state): State<AdminAppState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    let mut names = Vec::new();
    let mut entries = tokio::fs::read_dir(&state.simulated_client_profiles_path)
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

pub async fn get_simulated_client_profile(
    State(state): State<AdminAppState>,
    Path(name): Path<String>,
) -> Result<axum::response::Response, StatusCode> {
    let name = ensure_json_ext(name.trim());
    let safe = sanitize_filename(&name).ok_or(StatusCode::BAD_REQUEST)?;
    let file_path = state.simulated_client_profiles_path.join(&safe);
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        })?;
    Ok(([("content-type", "application/json")], bytes).into_response())
}
