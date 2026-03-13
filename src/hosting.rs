//! Hosting presets: env variable names and per-preset values.
//!
//! Scripts pass only one parameter: the profile. Run `./prod.sh [local|public]` (default: local)
//! or `./localProd.sh` / `./publicProd.sh`. They set **only** `LUMELIER_PRESET=localProd` or
//! `LUMELIER_PRESET=publicProd`. All preset values (session limits, upload size, simulated server
//! enabled, etc.) are defined **inside this module** in `local_prod` and `public_prod`. When
//! implementing, the server reads `LUMELIER_PRESET` once and uses the corresponding module's
//! constants; it does not read individual env vars for each setting.
//!
//! ## Implementation status
//!
//! **Implemented outside this module (not using hosting:: constants):**
//! - `LUMELIER_PUBLIC_URL` in main.rs → used for client_base_url() when set (live-join URL/QR).
//! - `SIMULATED_SERVER_URL` in main.rs → passed to AdminAppState when simulated server is enabled.
//!
//! **Implemented:** `simulated_server_enabled()` — reads LUMELIER_SIMULATED_SERVER_ENABLED or
//! LUMELIER_PRESET (localProd vs publicProd). When false, main does not spawn the simulated server
//! and GET /api/admin/config returns simulatedServerEnabled: false so the admin UI hides the simulate-devices tab.
//!
//! **Not implemented (server does not read these yet):** everything below (session limits, upload size, etc.).
#![allow(dead_code)]

// -----------------------------------------------------------------------------
// Preset names (value for LUMELIER_PRESET)
// -----------------------------------------------------------------------------

pub mod preset {
    /// Preset: local production (same machine, relaxed session, registration on).
    pub const LOCAL_PROD: &str = "localProd";
    /// Preset: public production (behind reverse proxy, stricter session, optional registration off).
    pub const PUBLIC_PROD: &str = "publicProd";
}

// -----------------------------------------------------------------------------
// Env variable name constants (keys only; no env reads here)
// -----------------------------------------------------------------------------

/// Which preset is active. Scripts set this; server may use it later.
pub const PRESET_KEY: &str = "LUMELIER_PRESET";

/// Session cookie and cleanup. **Not implemented:** auth.rs uses hardcoded SESSION_MAX_AGE_SECS; no cleanup task.
pub mod session {
    /// Cookie/sliding session max age in seconds.
    pub const MAX_AGE_SECS_KEY: &str = "LUMELIER_SESSION_MAX_AGE_SECS";
    /// Absolute session cap in seconds (session invalid after this from creation).
    pub const ABSOLUTE_MAX_SECS_KEY: &str = "LUMELIER_SESSION_ABSOLUTE_MAX_SECS";
    /// How often to run session cleanup (seconds).
    pub const CLEANUP_INTERVAL_SECS_KEY: &str = "LUMELIER_SESSION_CLEANUP_INTERVAL_SECS";
    /// Cookie Secure flag: "true" or "false".
    pub const COOKIE_SECURE_KEY: &str = "LUMELIER_COOKIE_SECURE";
}

/// **Not implemented:** register route is always mounted; no gate on registration.
pub mod auth {
    /// Whether registration is enabled: "true" or "false".
    pub const REGISTRATION_ENABLED_KEY: &str = "LUMELIER_REGISTRATION_ENABLED";
}

/// **Not implemented:** main.rs uses hardcoded ./userData paths.
pub mod paths {
    /// Base directory for userData (shows, users, sessions live under this).
    pub const DATA_DIR_KEY: &str = "LUMELIER_DATA_DIR";
}

/// Partially implemented: main.rs reads LUMELIER_PUBLIC_URL for client base URL (not this key). SIMULATED_SERVER_URL read in main, not via hosting.
pub mod urls {
    /// Public client base URL (e.g. https://app.lumelier.com). When set, used for live-join URL/QR.
    pub const CLIENT_BASE_URL_KEY: &str = "LUMELIER_CLIENT_BASE_URL";
    /// Simulated server URL (main.rs also reads SIMULATED_SERVER_URL; this is the canonical name).
    pub const SIMULATED_SERVER_URL_KEY: &str = "LUMELIER_SIMULATED_SERVER_URL";
}

/// **Not implemented:** main.rs uses hardcoded DefaultBodyLimit::max(500 * 1024 * 1024) for timeline-media.
pub mod upload {
    /// Max request body size in bytes for timeline-media uploads.
    pub const MAX_BYTES_KEY: &str = "LUMELIER_UPLOAD_MAX_BYTES";
}

/// When false, main does not spawn simulated server; admin UI hides the simulated-devices tab.
pub mod simulated_server {
    /// Whether the simulated server is compiled/run and shown in the admin UI. "true" or "false".
    pub const ENABLED_KEY: &str = "LUMELIER_SIMULATED_SERVER_ENABLED";
    /// When simulated server is enabled, max number of simulated clients allowed. Unset or None = no limit.
    pub const MAX_SIMULATED_CLIENTS_KEY: &str = "LUMELIER_MAX_SIMULATED_CLIENTS";
}

/// Returns whether the simulated server is enabled for the current preset (from LUMELIER_PRESET).
/// If LUMELIER_SIMULATED_SERVER_ENABLED is set to "false" or "0", returns false regardless of preset.
/// If set to "true" or "1", returns true. Otherwise uses preset (publicProd/public => false, local/default => true).
pub fn simulated_server_enabled() -> bool {
    if let Ok(v) = std::env::var(simulated_server::ENABLED_KEY) {
        let v = v.trim().to_lowercase();
        if v == "false" || v == "0" || v.is_empty() {
            return false;
        }
        if v == "true" || v == "1" {
            return true;
        }
    }
    let preset = std::env::var(PRESET_KEY)
        .unwrap_or_else(|_| preset::LOCAL_PROD.to_string())
        .trim()
        .to_lowercase();
    if preset == preset::PUBLIC_PROD.to_lowercase() || preset == "public" {
        public_prod::SIMULATED_SERVER_ENABLED
    } else {
        local_prod::SIMULATED_SERVER_ENABLED
    }
}

/// **Not implemented.** Server would expose these (e.g. config API); admin and client UIs would clamp their refresh intervals to be >= these. No backend enforcement for client poll rate yet.
pub mod min_refresh_ms {
    /// Client (phone) poll: min ms between GET /api/poll requests.
    pub const CLIENT_POLL_KEY: &str = "LUMELIER_MIN_REFRESH_CLIENT_POLL_MS";
    /// Client GPS: min ms between geolocation refresh ticks.
    pub const CLIENT_GPS_KEY: &str = "LUMELIER_MIN_REFRESH_CLIENT_GPS_MS";
    /// Admin connected-devices list: min interval for the devices table refresh.
    pub const CONNECTED_DEVICES_LIST_KEY: &str = "LUMELIER_MIN_REFRESH_CONNECTED_DEVICES_LIST_MS";
    /// Admin connected-devices list: min interval for the stats refresh (same page).
    pub const CONNECTED_DEVICES_STATS_KEY: &str = "LUMELIER_MIN_REFRESH_CONNECTED_DEVICES_STATS_MS";
    /// Admin venue map: min interval for map state refresh.
    pub const VENUE_MAP_KEY: &str = "LUMELIER_MIN_REFRESH_VENUE_MAP_MS";
    /// Admin simulate-devices: min interval for the client grid refresh.
    pub const SIMULATE_DEVICES_GRID_KEY: &str = "LUMELIER_MIN_REFRESH_SIMULATE_DEVICES_GRID_MS";
    /// Admin simulate-devices: min interval for the details pane refresh.
    pub const SIMULATE_DEVICES_DETAILS_KEY: &str = "LUMELIER_MIN_REFRESH_SIMULATE_DEVICES_DETAILS_MS";
    /// Admin timeline: min interval for the broadcast readhead tick (UI animation).
    pub const BROADCAST_READHEAD_TICK_KEY: &str = "LUMELIER_MIN_REFRESH_BROADCAST_READHEAD_TICK_MS";
    /// Admin show-management: min interval for polling show live state (live-join-url).
    pub const LIVE_STATE_POLL_KEY: &str = "LUMELIER_MIN_REFRESH_LIVE_STATE_POLL_MS";
}

/// **Not implemented.** Requires tracking go-live time per show, a background check for max duration, and "set live by" username + one-live-per-user enforcement in go-live handler.
pub mod live_show {
    /// Max time a show can stay live (seconds). Unset or None = unbounded.
    pub const MAX_DURATION_SECS_KEY: &str = "LUMELIER_LIVE_SHOW_MAX_DURATION_SECS";
    /// Max number of shows a user can have live at once. Unset or None = unbounded. Server tracks "set live by" username either way.
    pub const MAX_LIVE_SHOWS_PER_USER_KEY: &str = "LUMELIER_MAX_LIVE_SHOWS_PER_USER";
}

/// **Not implemented.** Inactivity timeout needs per-session last_activity and a cleanup task. Max sessions per user needs login to revoke other sessions.
pub mod session_limits {
    /// If no successful admin traffic for this many seconds, cleanup session. Unset or None = disabled (local: do not cleanup).
    pub const INACTIVITY_TIMEOUT_SECS_KEY: &str = "LUMELIER_SESSION_INACTIVITY_TIMEOUT_SECS";
    /// Max concurrent sessions per user. 1 = one session per user (new login signs out elsewhere). Unset or None = unlimited.
    pub const MAX_SESSIONS_PER_USER_KEY: &str = "LUMELIER_MAX_SESSIONS_PER_USER";
}

/// **Not implemented.** Devices: check connected count in poll handler. Show folder: compute dir size before upload/put. Per-user: sum show sizes for user's show_ids.
pub mod limits {
    /// Max connected (by last_seen) devices per show; stop accepting new pollers above this. Unset or None = no limit.
    pub const MAX_CONNECTED_DEVICES_PER_SHOW_KEY: &str = "LUMELIER_MAX_CONNECTED_DEVICES_PER_SHOW";
    /// Max size in bytes for a single show folder (userData/shows/:show_id/). Unset or None = no limit.
    pub const MAX_SHOW_FOLDER_BYTES_KEY: &str = "LUMELIER_MAX_SHOW_FOLDER_BYTES";
    /// Max total storage in bytes for all shows a user has access to combined. Unset or None = no limit.
    pub const MAX_STORAGE_PER_USER_BYTES_KEY: &str = "LUMELIER_MAX_STORAGE_PER_USER_BYTES";
}

// -----------------------------------------------------------------------------
// Per-preset default values (for scripts and future server use)
// -----------------------------------------------------------------------------

/// Default values for the localProd preset. Limit fields are None = no limit (server interprets as infinite).
/// In localProd.sh these limit env vars are left unset so the server uses these None defaults.
pub mod local_prod {
    /// 3 days in seconds.
    pub const SESSION_MAX_AGE_SECS: u32 = 3 * 24 * 60 * 60; // 259200
    /// 7 days absolute cap.
    pub const SESSION_ABSOLUTE_MAX_SECS: u32 = 7 * 24 * 60 * 60;
    /// Cleanup every 10 minutes.
    pub const SESSION_CLEANUP_INTERVAL_SECS: u64 = 600;
    pub const COOKIE_SECURE: bool = false;
    pub const REGISTRATION_ENABLED: bool = true;
    pub const DATA_DIR: &str = "./userData";
    /// Empty = server derives from local IP.
    pub const CLIENT_BASE_URL: &str = "";
    pub const SIMULATED_SERVER_URL: &str = "http://127.0.0.1:3003";
    /// 500 MiB.
    pub const UPLOAD_MAX_BYTES: u64 = 500 * 1024 * 1024;

    /// Simulated server: run on startup and show in admin UI.
    pub const SIMULATED_SERVER_ENABLED: bool = true;
    /// No limit on simulated clients when enabled.
    pub const MAX_SIMULATED_CLIENTS: Option<u32> = None;
    /// No floor on refresh intervals (user can pick fastest options).
    pub const MIN_REFRESH_CLIENT_POLL_MS: Option<u32> = None;
    pub const MIN_REFRESH_CLIENT_GPS_MS: Option<u32> = None;
    pub const MIN_REFRESH_CONNECTED_DEVICES_LIST_MS: Option<u32> = None;
    pub const MIN_REFRESH_CONNECTED_DEVICES_STATS_MS: Option<u32> = None;
    pub const MIN_REFRESH_VENUE_MAP_MS: Option<u32> = None;
    pub const MIN_REFRESH_SIMULATE_DEVICES_GRID_MS: Option<u32> = None;
    pub const MIN_REFRESH_SIMULATE_DEVICES_DETAILS_MS: Option<u32> = None;
    pub const MIN_REFRESH_BROADCAST_READHEAD_TICK_MS: Option<u32> = None;
    pub const MIN_REFRESH_LIVE_STATE_POLL_MS: Option<u32> = None;

    /// Live show: no max duration. None = unbounded (interpret as infinite).
    pub const LIVE_SHOW_MAX_DURATION_SECS: Option<u64> = None;
    /// No limit on live shows per user (still track "set live by").
    pub const MAX_LIVE_SHOWS_PER_USER: Option<u32> = None;
    /// Do not cleanup session on admin inactivity.
    pub const SESSION_INACTIVITY_TIMEOUT_SECS: Option<u64> = None;
    /// Multiple sessions per user allowed.
    pub const MAX_SESSIONS_PER_USER: Option<u32> = None;
    /// No limit on connected devices per show.
    pub const MAX_CONNECTED_DEVICES_PER_SHOW: Option<u32> = None;
    /// No limit on show folder size.
    pub const MAX_SHOW_FOLDER_BYTES: Option<u64> = None;
    /// No limit on total storage per user.
    pub const MAX_STORAGE_PER_USER_BYTES: Option<u64> = None;
}

/// Default values for the publicProd preset. Match these in publicProd.sh.
/// Limit fields are Some(x) = enforced; when reading env, unset falls back to these.
pub mod public_prod {
    /// 1 hour.
    pub const SESSION_MAX_AGE_SECS: u32 = 3600;
    /// 24 hours absolute cap.
    pub const SESSION_ABSOLUTE_MAX_SECS: u32 = 24 * 60 * 60;
    /// Cleanup every 5 minutes.
    pub const SESSION_CLEANUP_INTERVAL_SECS: u64 = 300;
    pub const COOKIE_SECURE: bool = true;
    pub const REGISTRATION_ENABLED: bool = false;
    pub const DATA_DIR: &str = "./userData";
    /// Must be set when deployed (e.g. https://app.lumelier.com).
    pub const CLIENT_BASE_URL: &str = "";
    pub const SIMULATED_SERVER_URL: &str = "http://127.0.0.1:3003";
    /// 100 MiB.
    pub const UPLOAD_MAX_BYTES: u64 = 100 * 1024 * 1024;

    /// Simulated server: do not run on startup; do not show simulated-devices tab in admin UI.
    pub const SIMULATED_SERVER_ENABLED: bool = false;
    /// When simulated server is enabled (e.g. override), max simulated clients. Not used when disabled.
    pub const MAX_SIMULATED_CLIENTS: Option<u32> = Some(50);
    /// Fastest permitted refresh intervals (ms) to limit server load.
    pub const MIN_REFRESH_CLIENT_POLL_MS: Option<u32> = Some(2000);
    pub const MIN_REFRESH_CLIENT_GPS_MS: Option<u32> = Some(5000);
    pub const MIN_REFRESH_CONNECTED_DEVICES_LIST_MS: Option<u32> = Some(3000);
    pub const MIN_REFRESH_CONNECTED_DEVICES_STATS_MS: Option<u32> = Some(5000);
    pub const MIN_REFRESH_VENUE_MAP_MS: Option<u32> = Some(3000);
    pub const MIN_REFRESH_SIMULATE_DEVICES_GRID_MS: Option<u32> = Some(2000);
    pub const MIN_REFRESH_SIMULATE_DEVICES_DETAILS_MS: Option<u32> = Some(2000);
    pub const MIN_REFRESH_BROADCAST_READHEAD_TICK_MS: Option<u32> = Some(100);
    pub const MIN_REFRESH_LIVE_STATE_POLL_MS: Option<u32> = Some(15000);

    /// Live show: max 2 hours, then auto-end and notify admin.
    pub const LIVE_SHOW_MAX_DURATION_SECS: Option<u64> = Some(2 * 3600);
    /// One live show per user; must end current before starting another.
    pub const MAX_LIVE_SHOWS_PER_USER: Option<u32> = Some(1);
    /// Cleanup session if no successful admin traffic for 30 minutes.
    pub const SESSION_INACTIVITY_TIMEOUT_SECS: Option<u64> = Some(30 * 60);
    /// One session per user; new login signs out elsewhere.
    pub const MAX_SESSIONS_PER_USER: Option<u32> = Some(1);
    /// Stop accepting new connections per show after 200 connected devices.
    pub const MAX_CONNECTED_DEVICES_PER_SHOW: Option<u32> = Some(200);
    /// Max 500 MiB per show folder.
    pub const MAX_SHOW_FOLDER_BYTES: Option<u64> = Some(500 * 1024 * 1024);
    /// Max 1 GiB total storage per user (all shows they have access to).
    pub const MAX_STORAGE_PER_USER_BYTES: Option<u64> = Some(1024 * 1024 * 1024);
}
