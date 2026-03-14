//! # Show workspaces — Per-show folders under userData/shows
//!
//! Each show has a folder {show_id}/ with info.json, timeline.json, trackSplitterTree.json,
//! ShowLocation.json, and simulatedClientProfiles/. Creating a show updates the user's show_ids and the show's info.json.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Multipart, Path, Query, State};
use axum::http::header::{HeaderValue, CONTENT_DISPOSITION, CONTENT_TYPE};
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::process::Command;

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

    let show_location_initial = ShowLocationFile {
        lat: None,
        lng: None,
        radius_meters: None,
        angle: None,
        requests_gps: false,
    };
    fs::write(
        show_dir.join(SHOW_LOCATION_FILENAME),
        serde_json::to_string(&show_location_initial).unwrap(),
    )
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to write ShowLocation.json"))?;

    let track_splitter_json = r#"{"root":{"type":"setTrack","trackId":"1"}}"#;
    fs::write(show_dir.join(TRACK_SPLITTER_TREE_FILENAME), track_splitter_json)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to write trackSplitterTree.json"))?;

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

const SHOW_LOCATION_FILENAME: &str = "ShowLocation.json";

/// ShowLocation.json on disk: null lat/lng/radius/angle means no pin placed yet.
#[derive(Serialize, Deserialize)]
struct ShowLocationFile {
    lat: Option<f64>,
    lng: Option<f64>,
    #[serde(rename = "radiusMeters")]
    radius_meters: Option<f64>,
    #[serde(default)]
    angle: Option<f64>,
    #[serde(rename = "requestsGPS", default)]
    requests_gps: bool,
}

fn validate_show_location_optional(body: &ShowLocationFile) -> Result<(), StatusCode> {
    if let Some(lat) = body.lat {
        if !lat.is_finite() || !(-90.0..=90.0).contains(&lat) {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    if let Some(lng) = body.lng {
        if !lng.is_finite() || !(-180.0..=180.0).contains(&lng) {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    if let Some(r) = body.radius_meters {
        if !r.is_finite() || r <= 0.0 {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    if let Some(a) = body.angle {
        if !a.is_finite() {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    Ok(())
}

/// Default show location (no circle): all null, requestsGPS false. Used when creating a new show or when file is missing.
fn show_location_default_json() -> String {
    let default = ShowLocationFile {
        lat: None,
        lng: None,
        radius_meters: None,
        angle: None,
        requests_gps: false,
    };
    serde_json::to_string(&default).unwrap()
}

/// GET /api/admin/show-workspaces/:show_id/show-location — returns ShowLocation.json for the show. If file is missing, creates it with null values and returns that.
pub async fn get_show_location(
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
    let path = state.shows_path.join(&show_id).join(SHOW_LOCATION_FILENAME);
    let bytes = match fs::read(&path).await {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let default_json = show_location_default_json();
            if fs::write(&path, &default_json).await.is_err() {
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
            default_json.into_bytes()
        }
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    };
    Ok(([("content-type", "application/json")], bytes))
}

/// PUT /api/admin/show-workspaces/:show_id/show-location — write ShowLocation.json.
/// Accepts { lat?, lng?, radiusMeters?, angle?, requestsGPS }; null location fields mean no pin placed.
pub async fn put_show_location(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, (StatusCode, String)> {
    let session_id = auth::parse_session_cookie(&headers).ok_or((
        StatusCode::UNAUTHORIZED,
        "Unauthorized".to_string(),
    ))?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or((
            StatusCode::UNAUTHORIZED,
            "Unauthorized".to_string(),
        ))?;
    check_show_access(&state, &username, &show_id)
        .await
        .map_err(|code| (code, "Access denied".to_string()))?;
    let value: ShowLocationFile = serde_json::from_slice(&body).map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", e))
    })?;
    validate_show_location_optional(&value).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "Validation failed: lat in [-90,90], lng in [-180,180], radiusMeters > 0 when set".to_string(),
        )
    })?;
    let path = state.shows_path.join(&show_id).join(SHOW_LOCATION_FILENAME);
    let json = serde_json::to_string(&value).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to serialize".to_string(),
        )
    })?;
    fs::write(&path, &json).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to write file".to_string(),
        )
    })?;
    Ok(StatusCode::OK)
}

/// Read ShowLocation.json for the show and set timeline["requestsGPS"] so clients receive it via broadcast.
pub async fn merge_requests_gps_into_timeline(
    state: &AdminAppState,
    show_id: &str,
    timeline: &mut serde_json::Value,
) {
    let path = state.shows_path.join(show_id).join(SHOW_LOCATION_FILENAME);
    if let Ok(bytes) = fs::read(&path).await {
        if let Ok(show_loc) = serde_json::from_slice::<ShowLocationFile>(&bytes) {
            timeline["requestsGPS"] = serde_json::json!(show_loc.requests_gps);
        }
    }
}

// ---------------------------------------------------------------------------
// Timeline media — per-show TimelineMedia folder: list, upload, download
// ---------------------------------------------------------------------------

const TIMELINE_MEDIA_DIR: &str = "TimelineMedia";

const ALLOWED_EXTENSIONS: &[&str] = &[
    "mp3", "mp4", "wav", "mov", "aac", "ogg", "png", "jpeg", "jpg", "bmp",
    "webm", "mkv", "m4v", "avi",
];

#[derive(Serialize)]
pub struct TimelineMediaFile {
    pub name: String,
    pub size_bytes: u64,
    /// Duration in seconds for audio/video files; absent for images or when unknown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
}

#[derive(Serialize)]
pub struct TimelineMediaListResponse {
    pub files: Vec<TimelineMediaFile>,
}

#[derive(Serialize)]
pub(crate) struct TimelineMediaUploadError {
    pub(crate) error: String,
}

fn timeline_media_dir(state: &AdminAppState, show_id: &str) -> std::path::PathBuf {
    state.shows_path.join(show_id).join(TIMELINE_MEDIA_DIR)
}

/// Extensions we try to get duration for (audio/video). Others (images) get None.
const DURATION_EXTENSIONS: &[&str] = &[
    "mp3", "mp4", "wav", "mov", "aac", "ogg", "webm", "mkv", "m4v", "avi",
];

fn is_audio_or_video_ext(filename: &str) -> bool {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());
    match ext.as_deref() {
        Some(ext) => DURATION_EXTENSIONS.contains(&ext),
        None => false,
    }
}

/// Run ffprobe (from the ffmpeg package) to get duration in seconds.
/// Returns None if ffprobe is not installed, not on PATH, or fails — the server does not require ffmpeg to run.
async fn get_duration_ffprobe(path: &std::path::Path) -> Option<f64> {
    // Use canonical path so ffprobe gets an absolute path (helps when server cwd differs).
    let path = fs::canonicalize(path).await.ok().unwrap_or_else(|| path.to_path_buf());
    let path_str = path.to_string_lossy();

    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path_str.as_ref(),
        ])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout);
    // Parse first line; accept "123.45" or "duration=123.45" or leading/trailing whitespace.
    let line = s.lines().next()?.trim();
    let num_str = line.strip_prefix("duration=").unwrap_or(line);
    num_str
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|&d| d.is_finite() && d >= 0.0)
}

async fn list_timeline_media_files(media_dir: &std::path::Path) -> Result<Vec<TimelineMediaFile>, StatusCode> {
    let mut entries = match fs::read_dir(media_dir).await {
        Ok(rd) => rd,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                return Ok(Vec::new());
            }
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    let mut files = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        let meta = entry.metadata().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if !meta.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let duration_sec = if is_audio_or_video_ext(&name) {
            get_duration_ffprobe(&media_dir.join(&name)).await
        } else {
            None
        };
        files.push(TimelineMediaFile {
            size_bytes: meta.len(),
            name,
            duration_sec,
        });
    }
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(files)
}

/// GET /api/admin/show-workspaces/:show_id/timeline-media — list files in TimelineMedia folder.
pub async fn get_timeline_media_list(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<TimelineMediaListResponse>, StatusCode> {
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
    let media_dir = timeline_media_dir(&state, &show_id);
    let files = list_timeline_media_files(media_dir.as_path()).await?;
    Ok(Json(TimelineMediaListResponse { files }))
}

fn sanitize_timeline_media_filename(name: &str) -> Option<String> {
    let base = std::path::Path::new(name).file_name()?.to_string_lossy();
    let s = base.trim();
    if s.is_empty() || s.contains('\0') || s.contains('/') || s.contains('\\') || s.contains("..") {
        return None;
    }
    Some(s.to_string())
}

fn allowed_extension(filename: &str) -> bool {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    ALLOWED_EXTENSIONS.contains(&ext.as_str())
}

/// POST /api/admin/show-workspaces/:show_id/timeline-media — upload a file; returns updated file list.
pub async fn post_timeline_media_upload(
    State(state): State<AdminAppState>,
    Path(show_id): Path<String>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<TimelineMediaListResponse>), (StatusCode, Json<TimelineMediaUploadError>)> {
    if !is_valid_show_id_format(&show_id) {
        return Err((
            StatusCode::NOT_FOUND,
            Json(TimelineMediaUploadError {
                error: "Not found".to_string(),
            }),
        ));
    }
    let session_id = auth::parse_session_cookie(&headers).ok_or((
        StatusCode::UNAUTHORIZED,
        Json(TimelineMediaUploadError {
            error: "Unauthorized".to_string(),
        }),
    ))?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or((
            StatusCode::UNAUTHORIZED,
            Json(TimelineMediaUploadError {
                error: "Unauthorized".to_string(),
            }),
        ))?;
    check_show_access(&state, &username, &show_id)
        .await
        .map_err(|code| {
            (
                code,
                Json(TimelineMediaUploadError {
                    error: "Access denied".to_string(),
                }),
            )
        })?;

    let media_dir = timeline_media_dir(&state, &show_id);
    fs::create_dir_all(&media_dir).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(TimelineMediaUploadError {
                error: "Failed to create directory".to_string(),
            }),
        )
    })?;

    let bad_request = |msg: String| {
        (
            StatusCode::BAD_REQUEST,
            Json(TimelineMediaUploadError { error: msg }),
        )
    };

    let mut saved = false;
    while let Some(field) = multipart.next_field().await.map_err(|_| {
        bad_request("Invalid multipart request".to_string())
    })? {
        if field.name().as_deref() != Some("file") {
            continue;
        }
        let filename = field
            .file_name()
            .ok_or_else(|| bad_request("Missing filename".to_string()))?
            .to_string();
        let sanitized = sanitize_timeline_media_filename(&filename)
            .ok_or_else(|| bad_request("Invalid filename".to_string()))?;
        if !allowed_extension(&sanitized) {
            return Err(bad_request(format!(
                "Unsupported file type. Allowed: {}",
                ALLOWED_EXTENSIONS.join(", ")
            )));
        }
        let path = media_dir.join(&sanitized);
        let data = field.bytes().await.map_err(|_| {
            bad_request("Failed to read file data".to_string())
        })?;
        fs::write(&path, &data).await.map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(TimelineMediaUploadError {
                    error: "Failed to write file".to_string(),
                }),
            )
        })?;
        saved = true;
        break;
    }
    if !saved {
        return Err(bad_request(
            "No file uploaded. Send a multipart field named 'file'.".to_string(),
        ));
    }

    let files = list_timeline_media_files(media_dir.as_path()).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(TimelineMediaUploadError {
                error: "Failed to list files".to_string(),
            }),
        )
    })?;
    Ok((StatusCode::CREATED, Json(TimelineMediaListResponse { files })))
}

/// GET /api/admin/show-workspaces/:show_id/timeline-media/:filename — download a file.
pub async fn get_timeline_media_file(
    State(state): State<AdminAppState>,
    Path((show_id, filename)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    if !is_valid_show_id_format(&show_id) {
        return Err(StatusCode::NOT_FOUND);
    }
    if filename.is_empty()
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || filename.contains('\0')
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;

    let path = timeline_media_dir(&state, &show_id).join(&filename);
    let bytes = fs::read(&path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
    let disp = format!("attachment; filename=\"{}\"", filename.replace('"', "\\\""));
    if let Ok(v) = HeaderValue::try_from(disp) {
        headers.insert(CONTENT_DISPOSITION, v);
    }
    Ok((headers, bytes))
}

/// DELETE /api/admin/show-workspaces/:show_id/timeline-media/:filename — delete a file; returns updated file list.
pub async fn delete_timeline_media_file(
    State(state): State<AdminAppState>,
    Path((show_id, filename)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<TimelineMediaListResponse>, StatusCode> {
    if !is_valid_show_id_format(&show_id) {
        return Err(StatusCode::NOT_FOUND);
    }
    if filename.is_empty()
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || filename.contains('\0')
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let session_id = auth::parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state
        .auth
        .sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    check_show_access(&state, &username, &show_id).await?;

    let media_dir = timeline_media_dir(&state, &show_id);
    let path = media_dir.join(&filename);
    if path.parent() != Some(media_dir.as_path()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if fs::remove_file(&path).await.is_err() {
        return Err(StatusCode::NOT_FOUND);
    }

    let files = list_timeline_media_files(media_dir.as_path()).await.map_err(|_| {
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(TimelineMediaListResponse { files }))
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
                if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(&json) {
                    merge_requests_gps_into_timeline(&state, &show_id, &mut parsed).await;
                    let readhead_sec = parsed
                        .get("readheadSec")
                        .and_then(|v| v.as_f64())
                        .filter(|v| v.is_finite())
                        .map(|v| v.max(0.0))
                        .unwrap_or(0.0);
                    let json_merged = serde_json::to_string(&parsed).unwrap_or(json);
                    let snapshot = BroadcastSnapshot {
                        timeline_raw: Some(Arc::from(json_merged.into_boxed_str())),
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
    if state.simulated_server_enabled && !state.simulated_server_url.is_empty() {
        let simulated_url = state.simulated_server_url.clone();
        let show_id_notify = show_id.clone();
        tokio::spawn(async move {
            notify_simulated_server_show_live(&simulated_url, &show_id_notify).await;
        });
    }

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
    if state.simulated_server_enabled && !state.simulated_server_url.is_empty() {
        let simulated_url = state.simulated_server_url.clone();
        let show_id_notify = show_id.clone();
        tokio::spawn(async move {
            notify_simulated_server_show_ended(&simulated_url, &show_id_notify).await;
        });
    }

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
