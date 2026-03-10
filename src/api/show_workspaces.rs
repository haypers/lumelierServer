//! # Show workspaces — Per-show folders under userData/shows
//!
//! Each show has a folder {show_id}/ with info.json, timeline.json, trackSplitterTree.json,
//! venueShape.json, and simulatedClientProfiles/. Creating a show updates the user's show_ids and the show's info.json.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::api::AdminAppState;
use crate::auth;
use crate::broadcast::BroadcastSnapshot;
use crate::time;
use crate::timeline_validator;
use crate::track_splitter_tree::TrackSplitterTree;

const SHOW_ID_LEN: usize = 8;
const SHOW_ID_CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

/// Show ID format: exactly 8 alphanumeric (lowercase) chars.
pub fn is_valid_show_id_format(id: &str) -> bool {
    id.len() == SHOW_ID_LEN && id.chars().all(|c| c.is_ascii_alphanumeric() && !c.is_ascii_uppercase())
}

fn random_show_id() -> String {
    let mut bytes = [0u8; SHOW_ID_LEN];
    getrandom::getrandom(&mut bytes).expect("getrandom");
    let mut s = String::with_capacity(SHOW_ID_LEN);
    for &b in &bytes {
        s.push(SHOW_ID_CHARS[(b as usize) % SHOW_ID_CHARS.len()] as char);
    }
    s
}

fn sanitize_show_name(name: &str) -> Option<String> {
    let s = name.trim();
    if s.is_empty() || s.len() > 200 {
        return None;
    }
    if s.contains('\0') || s.chars().any(|c| c == '/' || c == '\\') {
        return None;
    }
    Some(s.to_string())
}

#[derive(Deserialize)]
pub struct CreateShowBody {
    pub name: String,
}

#[derive(Serialize)]
pub struct CreateShowResponse {
    pub show_id: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct ShowListItem {
    pub show_id: String,
    pub name: String,
    pub created_by: String,
    pub created_at_ms: u64,
    pub last_modified_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ShowUserAccess {
    pub username: String,
    pub role: String, // "read" | "edit"
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ShowInfo {
    pub name: String,
    pub created_by: String,
    pub created_at_ms: u64,
    pub last_modified_ms: u64,
    pub users: Vec<ShowUserAccess>,
}

/// Check that the user has access to the show (user's show_ids + show's info.json users).
/// Returns Ok(ShowListItem) if allowed, Err(StatusCode) 403/404 otherwise. Logs to stderr when user
/// file lists show but info.json does not contain the user.
pub async fn check_show_access(
    state: &AdminAppState,
    username: &str,
    show_id: &str,
) -> Result<ShowListItem, StatusCode> {
    let show_ids = state
        .auth
        .users
        .get_show_ids(username)
        .await
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    if !show_ids.contains(&show_id.to_string()) {
        return Err(StatusCode::NOT_FOUND);
    }
    let info_path = state.shows_path.join(show_id).join("info.json");
    let contents = fs::read_to_string(&info_path).await.map_err(|_| StatusCode::NOT_FOUND)?;
    let info: ShowInfo = serde_json::from_str(&contents).map_err(|_| StatusCode::NOT_FOUND)?;
    if !info.users.iter().any(|u| u.username == username) {
        eprintln!(
            "[show-workspaces] user file lists show_id {} for user {:?} but info.json does not contain that user; denying access",
            show_id, username
        );
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(ShowListItem {
        show_id: show_id.to_string(),
        name: info.name,
        created_by: info.created_by,
        created_at_ms: info.created_at_ms,
        last_modified_ms: info.last_modified_ms,
    })
}

pub async fn post_create_show(
    State(state): State<AdminAppState>,
    headers: HeaderMap,
    Json(body): Json<CreateShowBody>,
) -> Result<(StatusCode, Json<CreateShowResponse>), (StatusCode, &'static str)> {
    let name = sanitize_show_name(&body.name).ok_or((StatusCode::BAD_REQUEST, "Invalid show name"))?;
    let session_id = auth::parse_session_cookie(&headers).ok_or((StatusCode::UNAUTHORIZED, "Not authenticated"))?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid session"))?;

    let shows_path = state.shows_path.as_path();
    let mut show_id = random_show_id();
    let mut attempts = 0;
    while shows_path.join(&show_id).exists() && attempts < 20 {
        show_id = random_show_id();
        attempts += 1;
    }
    if shows_path.join(&show_id).exists() {
        return Err((StatusCode::CONFLICT, "Could not generate unique show ID"));
    }

    let show_dir = shows_path.join(&show_id);
    fs::create_dir_all(&show_dir).await.map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create show directory"))?;

    let now_ms = time::unix_now_ms();
    let info = ShowInfo {
        name: name.clone(),
        created_by: username.clone(),
        created_at_ms: now_ms,
        last_modified_ms: now_ms,
        users: vec![ShowUserAccess {
            username: username.clone(),
            role: "edit".to_string(),
        }],
    };
    let info_json = serde_json::to_string(&info).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to serialize info"))?;
    fs::write(show_dir.join("info.json"), info_json)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to write info.json"))?;

    let timeline_json = "{}";
    fs::write(show_dir.join("timeline.json"), timeline_json)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to write timeline.json"))?;

    let venue_json = r#"{"points":[]}"#;
    fs::write(show_dir.join("venueShape.json"), venue_json)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to write venueShape.json"))?;

    fs::create_dir_all(show_dir.join("simulatedClientProfiles"))
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create simulatedClientProfiles dir"))?;

    state
        .auth
        .users
        .add_show_access(&username, &show_id)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user access"))?;

    Ok((
        StatusCode::CREATED,
        Json(CreateShowResponse {
            show_id: show_id.clone(),
            name,
        }),
    ))
}

pub async fn get_list_shows(
    State(state): State<AdminAppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ShowListItem>>, (StatusCode, &'static str)> {
    let session_id = auth::parse_session_cookie(&headers).ok_or((StatusCode::UNAUTHORIZED, "Not authenticated"))?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid session"))?;

    let show_ids = state
        .auth
        .users
        .get_show_ids(&username)
        .await
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Failed to load user"))?;

    let shows_path = state.shows_path.as_path();
    let mut list = Vec::with_capacity(show_ids.len());
    for show_id in show_ids {
        let info_path = shows_path.join(&show_id).join("info.json");
        let contents = match fs::read_to_string(&info_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };
        let info: ShowInfo = match serde_json::from_str(&contents) {
            Ok(i) => i,
            Err(_) => continue,
        };
        let has_access = info.users.iter().any(|u| u.username == username);
        if !has_access {
            eprintln!(
                "[show-workspaces] user file lists show_id {} for user {:?} but info.json does not contain that user; skipping",
                show_id, username
            );
            continue;
        }
        list.push(ShowListItem {
            show_id,
            name: info.name,
            created_by: info.created_by,
            created_at_ms: info.created_at_ms,
            last_modified_ms: info.last_modified_ms,
        });
    }
    Ok(Json(list))
}

/// GET /api/admin/show-workspaces/:show_id — single show by ID (same shape as list items). 403/404 if no access.
pub async fn get_show_by_id(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ShowListItem>, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let item = check_show_access(&state, &username, &show_id).await?;
    Ok(Json(item))
}

/// GET /api/admin/show-workspaces/:show_id/timeline — returns timeline.json for the show. 404 if file missing.
pub async fn get_timeline(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    let path = state.shows_path.join(&show_id).join("timeline.json");
    let bytes = fs::read(&path)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        })?;
    Ok(([("content-type", "application/json")], bytes))
}

/// PUT /api/admin/show-workspaces/:show_id/timeline — write timeline JSON. Validates minimal structure.
pub async fn put_timeline(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    let value: serde_json::Value =
        serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    let obj = value.as_object().ok_or(StatusCode::BAD_REQUEST)?;
    if obj.get("version").and_then(|v| v.as_u64()) != Some(1) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !obj.get("layers").and_then(|v| v.as_array()).is_some() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !obj.get("items").and_then(|v| v.as_array()).is_some() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let path = state.shows_path.join(&show_id).join("timeline.json");
    fs::write(&path, &body)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

const TRACK_SPLITTER_TREE_FILENAME: &str = "trackSplitterTree.json";

/// GET /api/admin/show-workspaces/:show_id/track-splitter-tree — returns trackSplitterTree.json for the show. 404 if file missing.
pub async fn get_track_splitter_tree(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    let path = state.shows_path.join(&show_id).join(TRACK_SPLITTER_TREE_FILENAME);
    let bytes = fs::read(&path)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        })?;
    Ok(([("content-type", "application/json")], bytes))
}

/// PUT /api/admin/show-workspaces/:show_id/track-splitter-tree — write trackSplitterTree.json. Expects { "root": ... }.
pub async fn put_track_splitter_tree(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    let value: serde_json::Value =
        serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    let obj = value.as_object().ok_or(StatusCode::BAD_REQUEST)?;
    if !obj.contains_key("root") {
        return Err(StatusCode::BAD_REQUEST);
    }
    let path = state.shows_path.join(&show_id).join(TRACK_SPLITTER_TREE_FILENAME);
    fs::write(&path, &body)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

/// GET /api/admin/show-workspaces/:show_id/venue-shape — returns venueShape.json for the show. 404 if file missing.
pub async fn get_venue_shape(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    let path = state.shows_path.join(&show_id).join("venueShape.json");
    let bytes = fs::read(&path)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        })?;
    Ok(([("content-type", "application/json")], bytes))
}

/// PUT /api/admin/show-workspaces/:show_id/venue-shape — write venue shape JSON. Expects { "points": [[lat, lng], ...] }.
pub async fn put_venue_shape(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    let value: serde_json::Value =
        serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    let obj = value.as_object().ok_or(StatusCode::BAD_REQUEST)?;
    let points = obj.get("points").and_then(|p| p.as_array()).ok_or(StatusCode::BAD_REQUEST)?;
    for p in points {
        let arr = p.as_array().ok_or(StatusCode::BAD_REQUEST)?;
        if arr.len() != 2 {
            return Err(StatusCode::BAD_REQUEST);
        }
        let lat = arr[0].as_f64().ok_or(StatusCode::BAD_REQUEST)?;
        let lng = arr[1].as_f64().ok_or(StatusCode::BAD_REQUEST)?;
        if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lng) {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    let path = state.shows_path.join(&show_id).join("venueShape.json");
    fs::write(&path, &body)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
pub struct UsernameCheckQuery {
    pub username: String,
}

#[derive(Serialize)]
pub struct UserExistsResponse {
    pub exists: bool,
}

/// GET /api/admin/users/check?username=... — returns { "exists": true } if user exists. Requires session.
pub async fn get_user_exists(
    State(state): State<AdminAppState>,
    headers: HeaderMap,
    Query(q): Query<UsernameCheckQuery>,
) -> Result<Json<UserExistsResponse>, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let _username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let exists = state.auth.users.user_exists(q.username.trim()).await;
    Ok(Json(UserExistsResponse { exists }))
}

#[derive(Serialize)]
pub struct ShowMemberResponse {
    pub username: String,
    pub role: String,
}

#[derive(Serialize)]
pub struct ShowMembersResponse {
    pub users: Vec<ShowMemberResponse>,
}

/// GET /api/admin/show-workspaces/:show_id/members — list users with access. Requires show access.
pub async fn get_show_members(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ShowMembersResponse>, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    let info_path = state.shows_path.join(&show_id).join("info.json");
    let contents = fs::read_to_string(&info_path).await.map_err(|_| StatusCode::NOT_FOUND)?;
    let info: ShowInfo = serde_json::from_str(&contents).map_err(|_| StatusCode::NOT_FOUND)?;
    let users = info
        .users
        .into_iter()
        .map(|u| ShowMemberResponse {
            username: u.username,
            role: u.role,
        })
        .collect();
    Ok(Json(ShowMembersResponse { users }))
}

#[derive(Deserialize)]
pub struct AddShowMemberBody {
    pub username: String,
}

/// POST /api/admin/show-workspaces/:show_id/members — add a user to the show. Requires show access.
pub async fn post_show_member(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<AddShowMemberBody>,
) -> Result<StatusCode, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    let new_username = body.username.trim().to_lowercase();
    if new_username.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !state.auth.users.user_exists(&new_username).await {
        return Err(StatusCode::NOT_FOUND);
    }
    let info_path = state.shows_path.join(&show_id).join("info.json");
    let contents = fs::read_to_string(&info_path).await.map_err(|_| StatusCode::NOT_FOUND)?;
    let mut info: ShowInfo = serde_json::from_str(&contents).map_err(|_| StatusCode::NOT_FOUND)?;
    if info.users.iter().any(|u| u.username == new_username) {
        return Err(StatusCode::CONFLICT);
    }
    info.users.push(ShowUserAccess {
        username: new_username.clone(),
        role: "edit".to_string(),
    });
    let info_json = serde_json::to_string(&info).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&info_path, info_json)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state
        .auth
        .users
        .add_show_access(&new_username, &show_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::CREATED)
}

/// DELETE /api/admin/show-workspaces/:show_id — delete show and remove from all users' access. Requires show access.
pub async fn delete_show(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    let info_path = state.shows_path.join(&show_id).join("info.json");
    let contents = fs::read_to_string(&info_path).await.map_err(|_| StatusCode::NOT_FOUND)?;
    let info: ShowInfo = serde_json::from_str(&contents).map_err(|_| StatusCode::NOT_FOUND)?;
    let users: Vec<String> = info.users.into_iter().map(|u| u.username).collect();
    let show_dir = state.shows_path.join(&show_id);
    for u in &users {
        let _ = state.auth.users.remove_show_access(u, &show_id).await;
    }
    fs::remove_dir_all(&show_dir)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

// --- Go live / End live / Live join URL (Phase 1 multi-show) ---

#[derive(Serialize)]
pub struct LiveJoinUrlResponse {
    pub live: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// POST /api/admin/show-workspaces/:show_id/go-live — ensure live bucket exists for show. No URL printed to console.
/// Notifies the simulated client server so it can create a per-show bucket immediately (in addition to the 10s poll).
pub async fn post_go_live(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    if !is_valid_show_id_format(&show_id) {
        return Err(StatusCode::NOT_FOUND);
    }
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    let bucket = state.live_shows.get_or_create(&show_id);

    // Load saved timeline from show workspace into broadcast so clients get it when they poll.
    let timeline_path = state.shows_path.join(&show_id).join("timeline.json");
    if let Ok(bytes) = fs::read(&timeline_path).await {
        if timeline_validator::validate_broadcast_timeline(&bytes).is_ok() {
            if let Ok(json) = String::from_utf8(bytes.to_vec()) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json) {
                    let readhead_sec = parsed
                        .get("readheadSec")
                        .and_then(|v| v.as_f64())
                        .filter(|v| v.is_finite())
                        .map(|v| v.max(0.0))
                        .unwrap_or(0.0);
                    let snapshot = BroadcastSnapshot {
                        timeline_raw: Some(Arc::from(json.into_boxed_str())),
                        timeline_parsed: Some(Arc::new(parsed)),
                        readhead_sec,
                        play_at_ms: None,
                        pause_at_ms: None,
                    };
                    bucket.broadcast.store(Arc::new(snapshot));
                }
            }
        }
    } else {
        // File missing or unreadable; leave broadcast empty (same as before go-live).
    }

    // Load track splitter tree so poll can assign devices to tracks.
    let tree_path = state.shows_path.join(&show_id).join(TRACK_SPLITTER_TREE_FILENAME);
    if let Ok(bytes) = fs::read(&tree_path).await {
        if let Ok(tree) = serde_json::from_slice::<TrackSplitterTree>(&bytes) {
            bucket
                .track_splitter_tree
                .store(Arc::new(Arc::new(Some(tree))));
        }
    }

    // Notify simulated server in real time so it can create the bucket without waiting for the next 10s poll.
    let simulated_url = state.simulated_server_url.clone();
    let show_id_notify = show_id.clone();
    tokio::spawn(async move {
        notify_simulated_server_show_live(&simulated_url, &show_id_notify).await;
    });

    Ok(StatusCode::OK)
}

/// POST /api/admin/show-workspaces/:show_id/end-live — remove live bucket for show.
/// Notifies the simulated client server so it can drop the per-show bucket immediately (in addition to the 10s poll).
pub async fn post_end_live(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    if !is_valid_show_id_format(&show_id) {
        return Err(StatusCode::NOT_FOUND);
    }
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    state.live_shows.remove(&show_id);

    // Notify simulated server in real time so it can remove the bucket without waiting for the next 10s poll.
    let simulated_url = state.simulated_server_url.clone();
    let show_id_notify = show_id.clone();
    tokio::spawn(async move {
        notify_simulated_server_show_ended(&simulated_url, &show_id_notify).await;
    });

    Ok(StatusCode::NO_CONTENT)
}

/// Sends a POST to the simulated client server to tell it a show just went live.
/// The simulated server will create a bucket for this show_id immediately (so the admin UI can add simulated clients without waiting for the 10s poll).
/// Fire-and-forget: we do not block the go-live response on this; failures are logged and the 10s poll will sync anyway.
async fn notify_simulated_server_show_live(base_url: &str, show_id: &str) {
    let url = format!("{}/notify/show-live", base_url.trim_end_matches('/'));
    let body = serde_json::json!({ "show_id": show_id });
    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("notify simulated server (go-live): failed to build client: {}", e);
            return;
        }
    };
    if let Err(e) = client.post(&url).json(&body).send().await {
        eprintln!("notify simulated server (go-live): request failed: {}", e);
    }
}

/// Sends a POST to the simulated client server to tell it a show just ended live.
/// The simulated server will remove the bucket for this show_id immediately (freeing memory).
/// Fire-and-forget: we do not block the end-live response on this; failures are logged and the 10s poll will sync anyway.
async fn notify_simulated_server_show_ended(base_url: &str, show_id: &str) {
    let url = format!("{}/notify/show-ended", base_url.trim_end_matches('/'));
    let body = serde_json::json!({ "show_id": show_id });
    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("notify simulated server (end-live): failed to build client: {}", e);
            return;
        }
    };
    if let Err(e) = client.post(&url).json(&body).send().await {
        eprintln!("notify simulated server (end-live): request failed: {}", e);
    }
}

/// GET /api/admin/show-workspaces/:show_id/live-join-url — { live: true, url } or { live: false }.
pub async fn get_live_join_url(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<LiveJoinUrlResponse>, StatusCode> {
    if !is_valid_show_id_format(&show_id) {
        return Err(StatusCode::NOT_FOUND);
    }
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;
    let (live, url) = match state.live_shows.get(&show_id) {
        Some(_) => (true, Some(format!("{}/{}", state.client_base_url, show_id))),
        None => (false, None),
    };
    Ok(Json(LiveJoinUrlResponse { live, url }))
}

// ---------------------------------------------------------------------------
// Live show IDs — used by the simulated client server to know which shows are live
// ---------------------------------------------------------------------------
//
// The simulated client server keeps a "bucket" (store + runner state) only for shows that are
// live. It learns which shows are live in two ways:
//
// 1. **Real-time notify:** When an admin goes live or ends live, we POST to the simulated server
//    (POST /notify/show-live or POST /notify/show-ended) so it can add/remove the bucket immediately.
//
// 2. **10-second poll:** The simulated server also polls GET /api/admin/live-show-ids every 10
//    seconds. This endpoint returns the list of show_ids that currently have a live bucket. We
//    do *not* put this endpoint behind session auth so the simulated server (a separate process
//    with no browser cookies) can call it. The data is low-sensitivity (just which show IDs are live).

#[derive(Serialize)]
pub struct LiveShowIdsResponse {
    #[serde(rename = "show_ids")]
    pub show_ids: Vec<String>,
}

/// GET /api/admin/live-show-ids — returns { "show_ids": ["id1", "id2", ...] } for all shows that are currently live.
/// Used by the simulated client server: it polls this every 10s and adds/removes its per-show buckets to match.
/// Not behind session auth so the simulated server (no cookies) can call it.
pub async fn get_live_show_ids(
    State(state): State<AdminAppState>,
) -> Result<Json<LiveShowIdsResponse>, StatusCode> {
    let show_ids = state.live_shows.live_show_ids();
    Ok(Json(LiveShowIdsResponse { show_ids }))
}
