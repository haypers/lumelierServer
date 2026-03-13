//! # API Module — HTTP Handlers and Shared State
//!
//! Re-exports all route handlers and defines MainAppState (for main server) and AdminAppState (for admin).
//! Health is shared; poll has two entry points (main and admin) but same impl.

use crate::auth::{AuthState, AuthStateExt};

mod admin;
mod broadcast;
mod map_state;
mod poll;
mod shows;
mod show_workspaces;
mod simulated_profiles;
mod venues;

pub use admin::{
    get_connected_devices, get_page_ids, get_stats, post_by_ids, post_reset_connections,
};
pub use broadcast::{
    post_broadcast_pause, post_broadcast_play, post_broadcast_readhead, post_broadcast_timeline,
};
pub use map_state::{
    get_map_state, post_load_map_state_venue, post_map_state, post_save_map_state_venue, MapState,
};
pub use poll::{poll, poll_admin};
pub use shows::{get_show, list_shows, put_show};
pub use venues::{get_venue, list_venues, put_venue};
pub use show_workspaces::{
    check_show_access, delete_show, get_list_shows, get_live_join_url, get_live_show_ids,
    get_show_by_id, get_show_members, get_timeline, get_timeline_media_file, get_timeline_media_list,
    get_track_splitter_tree, get_user_exists, get_venue_shape, is_valid_show_id_format,
    post_create_show, post_end_live, post_go_live, post_show_member, post_timeline_media_upload,
    put_timeline, put_track_splitter_tree, put_venue_shape,
};
pub use simulated_profiles::{
    get_simulated_client_profile, list_simulated_client_profiles, post_save_simulated_client_profile,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;

use crate::live_shows::LiveShowStore;

/// Shared state for the app on port 3002 (poll, health).
#[derive(Clone)]
pub struct MainAppState {
    pub live_shows: Arc<LiveShowStore>,
}

/// Shared state for the admin app (live show store + paths + auth). client_base_url is main server base (e.g. http://host:3002) for live-join-url.
/// simulated_server_url is used to POST real-time go-live/end-live notifications to the simulated client server (optional; env SIMULATED_SERVER_URL).
#[derive(Clone)]
pub struct AdminAppState {
    pub live_shows: Arc<LiveShowStore>,
    pub client_base_url: String,
    /// Base URL of the simulated client server (e.g. http://127.0.0.1:3003). Used to notify it when a show goes live or ends, so it can update its per-show buckets immediately instead of waiting for the next 10s poll.
    pub simulated_server_url: String,
    pub show_timelines_path: PathBuf,
    pub simulated_client_profiles_path: PathBuf,
    pub venue_shapes_path: PathBuf,
    pub shows_path: PathBuf,
    pub map_state: Arc<arc_swap::ArcSwap<MapState>>,
    pub auth: AuthState,
}

impl AuthStateExt for AdminAppState {
    fn auth(&self) -> &AuthState {
        &self.auth
    }
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub ok: bool,
}

pub async fn health() -> axum::Json<HealthResponse> {
    axum::Json(HealthResponse { ok: true })
}
