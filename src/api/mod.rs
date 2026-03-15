//! # API Module — HTTP Handlers and Shared State
//!
//! Re-exports all route handlers and defines MainAppState (for main server) and AdminAppState (for admin).
//! Health is shared; poll has two entry points (main and admin) but same impl.

use crate::auth::{AuthState, AuthStateExt};

mod admin;
mod broadcast;
mod map_state;
mod poll;
mod sanitize;
mod show_workspaces;
mod simulated_profiles;

pub use admin::{
    get_connected_devices, get_page_ids, get_stats, post_by_ids, post_reset_connections,
};
pub use broadcast::{
    post_broadcast_pause, post_broadcast_play, post_broadcast_readhead, post_broadcast_timeline,
};
pub use map_state::{get_map_state_show, post_map_state_show};
pub use poll::{poll, poll_admin};
pub use show_workspaces::{
    check_show_access, delete_show, delete_timeline_media_file, get_list_shows, get_live_join_url,
    get_live_show_ids, get_networking, get_show_by_id, get_show_members, get_show_location,
    get_timeline, get_timeline_media_file, get_timeline_media_list, get_track_splitter_tree,
    get_user_exists, is_valid_show_id_format, post_create_show, post_end_live, post_go_live,
    post_show_member, post_timeline_media_upload, put_networking, put_timeline, put_show_location,
    put_track_splitter_tree,
};
pub use simulated_profiles::{
    get_simulated_client_profile, list_simulated_client_profiles, post_save_simulated_client_profile,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;

use crate::live_shows::LiveShowStore;
use crate::log::{LogExt, LogSender};

/// Shared state for the app on port 3002 (poll, health).
#[derive(Clone)]
pub struct MainAppState {
    pub live_shows: Arc<LiveShowStore>,
    pub log: LogSender,
}

/// Shared state for the admin app (live show store + paths + auth). client_base_url is main server base (e.g. http://host:3002) for live-join-url.
/// When simulated_server_enabled is true, simulated_server_url is used to POST go-live/end-live notifications to the simulated client server.
#[derive(Clone)]
pub struct AdminAppState {
    pub live_shows: Arc<LiveShowStore>,
    pub client_base_url: String,
    /// When false, the simulated server is not started and the admin UI must not show the simulate-devices tab.
    pub simulated_server_enabled: bool,
    /// Base URL of the simulated client server (e.g. http://127.0.0.1:3003). Only used when simulated_server_enabled is true.
    pub simulated_server_url: String,
    pub shows_path: PathBuf,
    pub auth: AuthState,
    pub log: LogSender,
}

impl AuthStateExt for AdminAppState {
    fn auth(&self) -> &AuthState {
        &self.auth
    }
}

impl LogExt for AdminAppState {
    fn log(&self) -> &LogSender {
        &self.log
    }
}

impl LogExt for MainAppState {
    fn log(&self) -> &LogSender {
        &self.log
    }
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub ok: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminConfigResponse {
    pub simulated_server_enabled: bool,
}

pub async fn get_admin_config(
    axum::extract::State(state): axum::extract::State<AdminAppState>,
) -> axum::Json<AdminConfigResponse> {
    axum::Json(AdminConfigResponse {
        simulated_server_enabled: state.simulated_server_enabled,
    })
}

pub async fn health() -> axum::Json<HealthResponse> {
    axum::Json(HealthResponse { ok: true })
}
