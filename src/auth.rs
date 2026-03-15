//! # Auth — User and session storage, auth API
//!
//! Users stored as JSON in userData/users (username, password_hash). Sessions in userData/sessions.
//! Auth routes: register, login, logout, me. Session cookie: lumelier_session (HttpOnly, SameSite=Lax).

use argon2::{PasswordHash, PasswordHasher, PasswordVerifier};
use axum::extract::State;
use axum::http::header::{HeaderMap, SET_COOKIE};
use axum::http::{Request, StatusCode};
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

use crate::time;

const SESSION_COOKIE_NAME: &str = "lumelier_session";
/// Session cookie lifetime in seconds (3 days). Renewed on every protected request.
const SESSION_MAX_AGE_SECS: u32 = 3 * 24 * 60 * 60; // 259200
const USERNAME_MIN: usize = 3;
const USERNAME_MAX: usize = 32;
const PASSWORD_MIN: usize = 8;
/// 32 bytes as hex = 64 chars
const SESSION_ID_BYTES: usize = 32;

fn normalize_username(s: &str) -> String {
    s.trim().to_lowercase()
}

/// Sanitize for filename: only [a-zA-Z0-9._-]. Reject empty, "..", "/", "\".
fn sanitize_username(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() || s == ".." || s.contains('/') || s.contains('\\') {
        return None;
    }
    let out: String = s
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '_' || *c == '-')
        .collect();
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct UserFile {
    username: String,
    password_hash: String,
    created_at_ms: u64,
    #[serde(default)]
    show_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SessionFile {
    user_id: String,
    created_at_ms: u64,
}

#[derive(Clone)]
pub struct UserStore {
    pub path: PathBuf,
}

impl UserStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn user_path(&self, sanitized: &str) -> PathBuf {
        self.path.join(format!("{}.json", sanitized))
    }

    pub async fn create(&self, username: &str, password: &str) -> Result<(), CreateUserError> {
        let normalized = normalize_username(username);
        let sanitized = sanitize_username(&normalized).ok_or(CreateUserError::InvalidUsername)?;
        if normalized.len() < USERNAME_MIN || normalized.len() > USERNAME_MAX {
            return Err(CreateUserError::InvalidUsername);
        }
        if password.len() < PASSWORD_MIN {
            return Err(CreateUserError::InvalidPassword);
        }
        let path = self.user_path(&sanitized);
        if fs::try_exists(&path).await.unwrap_or(false) {
            return Err(CreateUserError::Exists);
        }
        let mut salt_rng = rand::rngs::OsRng;
        let hash = argon2::Argon2::default()
            .hash_password(password.as_bytes(), &argon2::password_hash::SaltString::generate(&mut salt_rng))
            .map_err(|_| CreateUserError::InvalidPassword)?
            .to_string();
        let data = UserFile {
            username: normalized.clone(),
            password_hash: hash,
            created_at_ms: time::unix_now_ms(),
            show_ids: Vec::new(),
        };
        let json = serde_json::to_string(&data).map_err(|_| CreateUserError::InvalidUsername)?;
        fs::write(&path, json).await.map_err(|_| CreateUserError::Exists)?;
        Ok(())
    }

    pub async fn verify(&self, username: &str, password: &str) -> Result<String, ()> {
        let normalized = normalize_username(username);
        let sanitized = match sanitize_username(&normalized) {
            Some(s) => s,
            None => return Err(()),
        };
        let path = self.user_path(&sanitized);
        let contents = fs::read_to_string(&path).await.map_err(|_| ())?;
        let data: UserFile = serde_json::from_str(&contents).map_err(|_| ())?;
        let parsed = PasswordHash::new(&data.password_hash).map_err(|_| ())?;
        let ok = argon2::Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok();
        if ok {
            Ok(data.username)
        } else {
            Err(())
        }
    }

    /// Add a show ID to the user's access list. Returns Ok(()) on success.
    pub async fn add_show_access(&self, username: &str, show_id: &str) -> Result<(), ()> {
        let normalized = normalize_username(username);
        let sanitized = sanitize_username(&normalized).ok_or(())?;
        let path = self.user_path(&sanitized);
        let contents = fs::read_to_string(&path).await.map_err(|_| ())?;
        let mut data: UserFile = serde_json::from_str(&contents).map_err(|_| ())?;
        if !data.show_ids.contains(&show_id.to_string()) {
            data.show_ids.push(show_id.to_string());
        }
        let json = serde_json::to_string(&data).map_err(|_| ())?;
        fs::write(&path, json).await.map_err(|_| ())?;
        Ok(())
    }

    /// Remove a show ID from the user's access list. Returns Ok(()) on success.
    pub async fn remove_show_access(&self, username: &str, show_id: &str) -> Result<(), ()> {
        let normalized = normalize_username(username);
        let sanitized = sanitize_username(&normalized).ok_or(())?;
        let path = self.user_path(&sanitized);
        let contents = fs::read_to_string(&path).await.map_err(|_| ())?;
        let mut data: UserFile = serde_json::from_str(&contents).map_err(|_| ())?;
        data.show_ids.retain(|id| id != show_id);
        let json = serde_json::to_string(&data).map_err(|_| ())?;
        fs::write(&path, json).await.map_err(|_| ())?;
        Ok(())
    }

    /// Get show IDs the user has access to.
    pub async fn get_show_ids(&self, username: &str) -> Option<Vec<String>> {
        let normalized = normalize_username(username);
        let sanitized = sanitize_username(&normalized)?;
        let path = self.user_path(&sanitized);
        let contents = fs::read_to_string(&path).await.ok()?;
        let data: UserFile = serde_json::from_str(&contents).ok()?;
        Some(data.show_ids)
    }

    /// Returns true if a user with this username exists (file present). Uses same normalize/sanitize as other methods.
    pub async fn user_exists(&self, username: &str) -> bool {
        let normalized = normalize_username(username);
        let sanitized = match sanitize_username(&normalized) {
            Some(s) => s,
            None => return false,
        };
        let path = self.user_path(&sanitized);
        fs::try_exists(&path).await.unwrap_or(false)
    }
}

pub enum CreateUserError {
    InvalidUsername,
    InvalidPassword,
    Exists,
}

#[derive(Clone)]
pub struct SessionStore {
    pub path: PathBuf,
}

fn random_session_id() -> String {
    let mut bytes = [0u8; SESSION_ID_BYTES];
    getrandom::getrandom(&mut bytes).expect("getrandom");
    hex::encode(bytes)
}

impl SessionStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn session_path(&self, id: &str) -> PathBuf {
        self.path.join(format!("{}.json", id))
    }

    pub async fn create(&self, user_id: &str) -> Result<String, ()> {
        let id = random_session_id();
        let path = self.session_path(&id);
        let data = SessionFile {
            user_id: user_id.to_string(),
            created_at_ms: time::unix_now_ms(),
        };
        let json = serde_json::to_string(&data).map_err(|_| ())?;
        fs::write(&path, json).await.map_err(|_| ())?;
        Ok(id)
    }

    pub async fn get(&self, id: &str) -> Option<String> {
        let path = self.session_path(id);
        let contents = fs::read_to_string(&path).await.ok()?;
        let data: SessionFile = serde_json::from_str(&contents).ok()?;
        Some(data.user_id)
    }

    pub async fn delete(&self, id: &str) -> Result<(), ()> {
        let path = self.session_path(id);
        let _ = fs::remove_file(&path).await;
        Ok(())
    }
}

pub fn parse_session_cookie(headers: &HeaderMap) -> Option<String> {
    let v = headers.get(axum::http::header::COOKIE)?.to_str().ok()?;
    for part in v.split(';') {
        let part = part.trim();
        if let Some(suffix) = part.strip_prefix(format!("{}=", SESSION_COOKIE_NAME).as_str()) {
            return Some(suffix.trim().to_string());
        }
    }
    None
}

// --- Auth API state
#[derive(Clone)]
pub struct AuthState {
    pub users: UserStore,
    pub sessions: SessionStore,
}

/// Trait so handlers can be generic over app state that holds AuthState (avoids circular deps).
pub trait AuthStateExt {
    fn auth(&self) -> &AuthState;
}

// --- Request/response types
#[derive(Deserialize)]
pub struct RegisterBody {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginBody {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct MeResponse {
    pub username: String,
}

// --- Handlers (generic over state that has .auth() and .log())
pub async fn post_register<S: AuthStateExt + crate::log::LogExt + Clone + Send + Sync>(
    State(state): State<S>,
    Json(body): Json<RegisterBody>,
) -> Result<StatusCode, (StatusCode, &'static str)> {
    match state.auth().users.create(&body.username, &body.password).await {
        Ok(()) => {
            state.log().log_server("AUTH", "Register", &format!("username={} success", body.username));
            Ok(StatusCode::CREATED)
        }
        Err(CreateUserError::InvalidUsername) => {
            state.log().log_server("AUTH", "Register", "invalid_username");
            Err((StatusCode::BAD_REQUEST, "Invalid username"))
        }
        Err(CreateUserError::InvalidPassword) => {
            state.log().log_server("AUTH", "Register", "invalid_password");
            Err((StatusCode::BAD_REQUEST, "Invalid password"))
        }
        Err(CreateUserError::Exists) => {
            state.log().log_server("AUTH", "Register", &format!("username={} exists", body.username));
            Err((StatusCode::CONFLICT, "Username unavailable"))
        }
    }
}

pub async fn post_login<S: AuthStateExt + crate::log::LogExt + Clone + Send + Sync>(
    State(state): State<S>,
    Json(body): Json<LoginBody>,
) -> Result<(StatusCode, HeaderMap, Json<MeResponse>), (StatusCode, &'static str)> {
    let username = state.auth()
        .users
        .verify(&body.username, &body.password)
        .await
        .map_err(|_| {
            state.log().log_server("AUTH", "Login", "invalid_credentials");
            (StatusCode::UNAUTHORIZED, "Invalid username or password")
        })?;
    let session_id = state.auth()
        .sessions
        .create(&username)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Session creation failed"))?;
    state.log().log_server("AUTH", "Login", &format!("username={} success", username));
    let cookie = format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        SESSION_COOKIE_NAME, session_id, SESSION_MAX_AGE_SECS
    );
    let mut headers = HeaderMap::new();
    headers.insert(SET_COOKIE, cookie.parse().unwrap());
    Ok((StatusCode::OK, headers, Json(MeResponse { username })))
}

pub async fn post_logout<S: AuthStateExt + crate::log::LogExt + Clone + Send + Sync>(
    State(state): State<S>,
    headers: HeaderMap,
) -> (StatusCode, HeaderMap) {
    if let Some(id) = parse_session_cookie(&headers) {
        if let Some(username) = state.auth().sessions.get(&id).await {
            state.log().log_server("AUTH", "Logout", &format!("username={}", username));
        }
        let _ = state.auth().sessions.delete(&id).await;
    }
    let mut res_headers = HeaderMap::new();
    let clear = format!("{}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0", SESSION_COOKIE_NAME);
    res_headers.insert(SET_COOKIE, clear.parse().unwrap());
    (StatusCode::OK, res_headers)
}

pub async fn get_me<S: AuthStateExt + Clone + Send + Sync>(
    State(state): State<S>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<MeResponse>), StatusCode> {
    let id = parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let username = state.auth().sessions.get(&id).await.ok_or(StatusCode::UNAUTHORIZED)?;
    let cookie = format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        SESSION_COOKIE_NAME, id, SESSION_MAX_AGE_SECS
    );
    let mut res_headers = HeaderMap::new();
    let _ = cookie.parse().map(|v: axum::http::HeaderValue| res_headers.insert(SET_COOKIE, v));
    Ok((res_headers, Json(MeResponse { username })))
}

/// Middleware: require valid session for admin API. Returns 401 if no/invalid session.
/// On success, adds Set-Cookie to the response to renew the session for another 3 days (sliding expiry).
/// Session file I/O on every protected request could be optimized later (e.g. cache or different store).
pub async fn require_session<S: AuthStateExt + crate::log::LogExt + Clone + Send + Sync>(
    State(state): State<S>,
    headers: HeaderMap,
    request: Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> Result<Response, StatusCode> {
    let id = parse_session_cookie(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let _ = state.auth().sessions.get(&id).await.ok_or(StatusCode::UNAUTHORIZED)?;
    let mut response = next.run(request).await;
    let cookie = format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        SESSION_COOKIE_NAME, id, SESSION_MAX_AGE_SECS
    );
    if let Ok(v) = cookie.parse() {
        response.headers_mut().insert(SET_COOKIE, v);
    }
    Ok(response)
}
