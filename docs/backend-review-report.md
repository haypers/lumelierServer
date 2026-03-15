# Backend Review Report — Lumelier Server

**Context:** Concert light-show sync with audience phones; backend must be simple, efficient, and maintainable for **~80,000 concurrent connections** in production.

**Scope:** Rust server (`src/`), simulated-server (`simulated-server/`), and how they interact. No code changes in this report—findings and recommendations only.

---

## 1. Critical bugs

### 1.1 Poll requires `X-Client-Send-Ms` → 400 for clients that omit it

**Location:** `src/api/poll.rs` line 219

```rust
let client_send_ms = client_send_ms_from_headers(&headers).ok_or(StatusCode::BAD_REQUEST)?;
```

If the header is missing or invalid, the server returns **400 Bad Request**. Any client (e.g. old app version, broken client, or script) that does not send `X-Client-Send-Ms` will never get a successful poll. For NTP-style sync the server could fall back to a default (e.g. `server_time_at_recv`) and still respond; rejecting the request is harsh and can look like a “backend down” to users.

**Recommendation:** Either make the header optional and use `server_time_at_recv` when missing, or document it as mandatory and ensure all clients send it before deployment.

---

### 1.2 `timeline_validator.rs`: `.unwrap()` on `as_array()`

**Location:** `src/timeline_validator.rs` line 20

```rust
for (i, item) in items.as_array().unwrap().iter().enumerate() {
```

Earlier code checks `items.is_array()` but does not narrow the type; the loop uses `.unwrap()` on `as_array()`. If the type system or logic changes, this could panic. Prefer `if let Some(arr) = items.as_array()` and iterate over `arr`, or use a single `as_array().ok_or(...)?` and iterate without unwrap.

---

### 1.3 Broadcast timeline: double JSON parse

**Location:** `src/api/broadcast.rs` `post_broadcast_timeline`

- `timeline_validator::validate_broadcast_timeline(body)` parses the body to validate.
- Then the handler does `serde_json::from_str(&json)` again on the same bytes.

So the timeline is parsed twice on every broadcast. Not a correctness bug but wasteful; at 80k clients, admin actions that trigger broadcast should be as cheap as possible.

**Recommendation:** Have the validator return a parsed `Value` (or take/return a parsed value) so the handler parses once.

---

### 1.4 `post_broadcast_timeline`: `serde_json::to_string(&parsed).unwrap_or(json)`

**Location:** `src/api/broadcast.rs` line 78

If `to_string` fails (e.g. non-serializable value), the handler falls back to the original `json` string. That can hide bugs (e.g. custom types that don’t serialize) and can produce a response that no longer matches `parsed`. Prefer returning an error or logging and failing explicitly instead of silently falling back.

---

## 2. Scalability and efficiency (80k connections)

### 2.1 Poll path: O(timeline size) per request

**Location:** `src/api/poll.rs` `filter_timeline_by_track()`

For **every** poll the server:

- Clones/filters the full timeline JSON for the device’s track.
- Builds a new `serde_json::Value` and wraps it in `Arc`.

With 80k polls per refresh cycle (e.g. 2s), this is **80k × (timeline clone + filter)** per cycle. The simulator CPU regression doc (`docs/simulator-cpu-regression-report.md`) already identifies this as the main hotspot.

**Recommendations:**

- Cache filtered timeline by `(timeline_identity, track_index)` and reuse `Arc` when the broadcast snapshot hasn’t changed (e.g. content hash or version).
- Consider a representation that allows per-track views without full clone (e.g. pre-split by layer so each poll does index lookups instead of full scan + clone).

---

### 2.2 Track assignment: `OsRng` on first poll / GPS change

**Location:** `src/api/poll.rs` lines 261–264

When the device is new or GPS toggles, the server calls `track_splitter_tree::evaluate(..., &mut rand::rngs::OsRng)`. **OsRng** uses system entropy and is relatively expensive. With many clients joining at once (e.g. doors open), this can cause a CPU spike.

**Recommendation:** Use a fast PRNG (e.g. `StdRng` or `ThreadRng`) seeded per request or per show, as suggested in the simulator CPU report, so track assignment does not hit the system RNG for every new device.

---

### 2.3 Admin: full device list materialized on every page-ids request

**Location:** `src/api/admin.rs` `get_page_ids`, `src/connections.rs` `list_rows_filtered`

`get_page_ids` calls `list_rows_filtered(now_ms, connected_only)`, which:

- Iterates the **entire** `ConnectionRegistry` (80k entries).
- Builds a **full** `Vec<DeviceRow>` (with string clones, optional floats, etc.).
- Sorts the full list, then skips/takes for the page.

So every page-ids request (e.g. every 2s when the Connected Devices tab is open) is **O(80k)** in memory and CPU. The admin UI uses page-ids + by-ids for the table, but the server still builds 80k rows every time.

**Recommendations:**

- Implement server-side pagination without materializing all rows: e.g. one pass that produces only `(device_id, sort_key)` or similar, sort that, then fetch full rows only for the current page (e.g. via existing by-ids).
- Cap or throttle: e.g. if `total_connected > N`, return 4xx or a “too many devices, use filters” and/or increase the minimum refresh interval (see hosting’s `min_refresh_ms`).

---

### 2.4 `get_connected_devices` returns the full list

**Location:** `src/api/admin.rs` `get_connected_devices`

This endpoint returns **all** devices (no pagination). It is used by the admin **Export CSV** flow (`admin/src/pages/connected-devices-list/index.ts`: `fetchFullDeviceList()`). With 80k devices:

- The server builds 80k `DeviceRow`s and sends a huge JSON body.
- The client holds 80k rows in memory and builds a CSV.

Risk of timeouts, high memory, and poor UX.

**Recommendations:**

- Add a streaming or paged export (e.g. export by page, or stream CSV chunks), or
- Cap export size (e.g. max 10k devices) and require filters (e.g. connected-only, or date range if you add it).

---

### 2.5 `tick_disconnects` called from every admin device request

**Location:** `src/api/admin.rs`: `get_stats`, `get_connected_devices`, `get_page_ids`, `post_by_ids` all call `bucket.registry.tick_disconnects(now_ms)`.

`tick_disconnects` does `devices.iter_mut().for_each(...)` over the **entire** registry. So every stats, full-list, page-ids, and by-ids request does a full 80k-entry pass. The background task in `main.rs` already runs `tick_all_disconnects` every 10s; admin handlers don’t need to run it again.

**Recommendation:** Remove `tick_disconnects` from admin handlers and rely on the existing 10s background task. Admin reads “eventually consistent” disconnect state (within 10s), which is acceptable for the UI.

---

### 2.6 No cap on `page_size` in `get_page_ids`

**Location:** `src/api/admin.rs` lines 279–297

`page_size` is taken from the query (default 10) but never capped. A client could send `pageSize=1000000` and force the server to build and sort a huge list and return a huge `ids` array. Even with pagination, a single request can be abused.

**Recommendation:** Cap `page_size` (e.g. max 500 or 1000) and clamp before use.

---

### 2.7 Connection registry never pruned automatically

**Location:** `src/connections.rs` `remove_disconnected`

`remove_disconnected(now_ms)` is only called from **POST .../connections/reset** (admin). There is no periodic cleanup of devices that are long-disconnected. So for a long-lived show, the registry grows without bound (every device that ever polled stays in the map until “End live” or reset). With 80k devices and many reconnects over time, the map can grow beyond 80k and memory can keep increasing.

**Recommendation:** Either run a periodic task (e.g. every 5–10 minutes) that calls `remove_disconnected` for each live show, or evict entries when `time_since_last_contact_ms > CONNECTED_THRESHOLD_MS` (e.g. 2–3×) to bound memory. Document that “connected” count may lag by one cleanup period.

---

## 3. Unfinished / not implemented (hosting and config)

The following are documented in `src/hosting.rs` as **not implemented** (server does not read or enforce them). For production at 80k connections they matter.

| Area | Env / constant | Effect if unimplemented |
|------|----------------|-------------------------|
| **Session cleanup** | `SESSION_MAX_AGE_SECS`, `SESSION_CLEANUP_INTERVAL_SECS` | Session files never deleted; disk and inode usage grow. |
| **Session limits** | `SESSION_INACTIVITY_TIMEOUT_SECS`, `MAX_SESSIONS_PER_USER` | No sliding expiry; no “one session per user” enforcement. |
| **Client poll rate** | `MIN_REFRESH_CLIENT_POLL_MS` | No server-side enforcement of minimum interval; clients can hammer poll. |
| **Max devices per show** | `MAX_CONNECTED_DEVICES_PER_SHOW` | No rejection of new pollers when at capacity (e.g. 80k); risk of overload. |
| **Live show limits** | `LIVE_SHOW_MAX_DURATION_SECS`, `MAX_LIVE_SHOWS_PER_USER` | Shows can stay live indefinitely; no “one live show per user” if desired. |
| **Registration gate** | `REGISTRATION_ENABLED` | Register route always mounted; cannot disable signups in production. |
| **Data dir** | `LUMELIER_DATA_DIR` | Paths hardcoded to `./userData`; less flexible for deployment. |
| **Upload size** | `LUMELIER_UPLOAD_MAX_BYTES` | Hardcoded 500 MiB in main; not driven by preset/env. |

**Recommendation:** Prioritize implementing at least: (1) **MAX_CONNECTED_DEVICES_PER_SHOW** in the poll handler (reject with 503 or 429 when at cap), (2) **session cleanup** task so session files are removed, (3) **MIN_REFRESH_CLIENT_POLL_MS** (reject or delay polls that are too fast). Then add live-show duration and session limits as needed.

---

## 4. Maintainability and robustness

### 4.1 `println!` in broadcast handlers

**Location:** `src/api/broadcast.rs` (e.g. lines 98–100, 110, 130–133, 149–154)

Play/pause and readhead use `println!` for logging. In production at scale this mixes with other stdout and is not structured. Prefer a logging crate (e.g. `tracing` or `log`) with levels and optional request/context so production logs can be filtered and aggregated.

---

### 4.2 `unwrap` / `expect` usage

Findings from grep (summary):

- **auth.rs:** `cookie.parse().unwrap()` for Set-Cookie — parse can fail on special characters; handle or validate.
- **main.rs:** `TcpListener::bind(...).await.unwrap()` and `r1.expect(...)` — acceptable for startup, but consider logging and exit code.
- **show_workspaces.rs:** `serde_json::to_string(&show_location_initial).unwrap()` — if structure changes and doesn’t serialize, this panics; same for `serde_json::to_string(&default).unwrap()` elsewhere.
- **time.rs:** `duration_since(UNIX_EPOCH).expect(...)` — fine for “clock before epoch”.
- **poll.rs:** `HeaderValue::from_str(&track_index.to_string()).expect(...)` — track_index is 1–256, so safe in practice; still, a defensive `unwrap_or_else` or validated header would avoid any theoretical panic.

**Recommendation:** Replace `unwrap()` in request-handling and serialization paths with proper error handling or `expect("...")` with a clear comment where panic is acceptable. Use logging instead of panics where possible.

---

### 4.3 Session store: file I/O on every protected request

**Location:** `src/auth.rs` `require_session` and `get_me`

Every protected admin request does `state.auth.sessions.get(&id).await`, which **reads a session file from disk**. At high admin concurrency this can become a bottleneck. Session data is small and rarely changes.

**Recommendation:** Add an in-memory cache (e.g. TTL cache keyed by session id) with fallback to file, or move sessions to a fast store (e.g. Redis) if you outgrow a single machine.

---

### 4.4 Broadcast: file I/O in hot path

**Location:** `src/api/broadcast.rs` `post_broadcast_timeline` → `merge_requests_gps_into_timeline`

On every timeline broadcast, the server reads **ShowLocation.json** from disk to merge `requestsGPS` into the timeline. That’s one file read per broadcast; under load or slow disk it can add latency. Not per-poll, but still on a critical admin path.

**Recommendation:** Cache ShowLocation per show (e.g. in memory or in the live bucket) and invalidate or reload when ShowLocation is updated (e.g. PUT show-location).

---

## 5. Security and abuse

### 5.1 No rate limiting

There is no rate limiting on:

- **GET /api/poll** — a client or attacker can poll as fast as possible; with 80k legitimate clients, extra traffic can push the server over.
- **Admin routes** — no per-IP or per-session rate limit; brute force or abuse is easier.

**Recommendation:** Enforce a minimum interval for poll (e.g. 429 if same device_id polls within N ms), and consider rate limiting on admin auth and sensitive endpoints.

---

### 5.2 Device ID from client

**Location:** `src/api/poll.rs` `device_id_from_headers`

Device ID is taken from **X-Device-ID** if present; otherwise the server generates a UUID. So clients can send arbitrary IDs. That’s by design for identity, but it means:

- No proof that the same device is the same client across requests (could impersonate or spam many IDs).
- Malicious client could send many distinct device IDs to bloat the registry.

**Recommendation:** For abuse mitigation, consider a cap per IP or per show on “new” device IDs per minute, or treat unknown device IDs with a shorter TTL until they’ve been seen multiple times. Keep the design simple; this is optional depending on threat model.

---

## 6. Simulated server (lumelier-simulated-server)

- **Live-show sync:** Uses both real-time POSTs (go-live / end-live) and a 10s poll of live-show-ids; design is clear and robust.
- **Bind/listen:** `TcpListener::bind(...).await.expect("bind")` and `axum::serve(...).await.expect("serve failed")` — acceptable for a dev/simulator binary; consider logging before exit.
- No additional critical bugs found in the reviewed entry point and flow; the main server and poll path are the primary focus for 80k connections.

---

## 7. Summary: what to fix first for 80k connections

**Efficiency (poll path):**

1. Cache filtered timeline by (timeline identity, track) to avoid O(timeline) clone per poll.
2. Use a fast RNG for track assignment instead of OsRng.
3. Rely on background `tick_disconnects` only; remove from admin handlers.

**Efficiency (admin):**

4. Page-ids without building a full 80k `Vec<DeviceRow>` (e.g. sort keys only, then by-ids for the page).
5. Cap `page_size` on page-ids (e.g. max 500).
6. Export CSV via paged or streaming API, or cap export size.

**Stability and correctness:**

7. Make `X-Client-Send-Ms` optional in poll or document and enforce it consistently.
8. Remove `.unwrap()` in timeline_validator; use safe iteration.
9. Single parse for broadcast timeline (validator returns or accepts parsed value).
10. Periodic (or threshold-based) `remove_disconnected` so registry memory is bounded.

**Production readiness:**

11. Implement `MAX_CONNECTED_DEVICES_PER_SHOW` in poll (reject when at cap).
12. Implement session cleanup task (and optionally session limits from hosting).
13. Replace `println!` in broadcast with structured logging.
14. Optional: minimum poll interval enforcement (e.g. 429 if too fast).

This keeps the backend simple and maintainable while making it safe and efficient for ~80,000 connections.
