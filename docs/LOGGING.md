# Lumelier server logging

This document defines the log format, categories, and which events are written to the **server log** (entire server) vs **show log** (per-show).

---

## Log channels

| Channel | Path | Scope |
|--------|------|--------|
| **Server log** | `userData/logs/server.txt` | All server activity: startup, auth, which shows went live/ended, simulated server, and any event that is not tied to a single show. |
| **Show log** | `userData/shows/<show_id>/logs/show.txt` | Activity for that show only: broadcast (timeline/play/pause), poll errors for that show, show mutations (timeline, track splitter, media), reset connections, optional device-count milestones. |

Events that are show-scoped can be written to **both** (server for global visibility, show for per-show audit), or only to the show log. The table below specifies the intended choice per event type.

---

## Format rules

- **One event per line.** Keep each log entry on a single line so that rolling files and line-based tools (grep, tail) work simply.
- **Format:**  
  `UNIXTIMESTAMP-CATEGORY-Subcat: Details`  
  - **UNIXTIMESTAMP:** seconds since Unix epoch (e.g. `1734567890`).  
  - **CATEGORY:** uppercase, one word (e.g. `UPTIME`, `AUTH`, `CLIENT`).  
  - **Subcat:** short label for the specific event (e.g. `Startup`, `Poll`, `Login`).  
  - **Details:** free-form message; avoid unescaped newlines. For structured data use a single JSON object (e.g. `{"show_id":"abc123","error":"invalid show_id"}`).
- **Delimiter:** A single hyphen between timestamp and category, and between category and subcat. Colon and space before details: `-Subcat: Details`.
- **No newlines in details.** If you must log multi-field data, use JSON or a compact key=value style on one line.

**Examples:**

```
1734567890-UPTIME-Startup: Server started main=3002 admin=3010 preset=localProd
1734567891-AUTH-Login: username=ops success
1734567892-SHOW-GoLive: show_id=abc12345 username=ops
1734567893-CLIENT-Poll: show_id=abc12345 device_id=xyz error={"code":"BAD_REQUEST","reason":"missing X-Client-Send-Ms"}
1734567894-BROADCAST-Play: show_id=abc12345 readhead_sec=12.5 play_at_ms=1734567895000
```

---

## Categories and subcategories

| Category | Subcategory | Description |
|----------|-------------|-------------|
| **UPTIME** | Startup | Server process started; ports, preset, simulated server, dirs, ffprobe. |
| **UPTIME** | Shutdown | Server shutting down (if we log it). |
| **AUTH** | Login | Login attempt; success or failure (no passwords). |
| **AUTH** | Logout | User logged out. |
| **AUTH** | Register | Registration attempt; success or failure. |
| **AUTH** | SessionInvalid | Session missing or invalid (optional; can be DEBUG only). |
| **AUTH** | ShareShow | User shared a show with another user; show_id, from_username, to_username, success or error. |
| **SHOW** | GoLive | Show went live; show_id, optional username. |
| **SHOW** | EndLive | Show ended; show_id, optional username. |
| **SHOW** | Create | Show workspace created; show_id, name, username. |
| **SHOW** | Delete | Show workspace deleted; show_id, username. |
| **BROADCAST** | Timeline | Timeline broadcast for show; show_id, success or error. |
| **BROADCAST** | Play | Play command; show_id, readhead_sec, play_at_ms. |
| **BROADCAST** | Pause | Pause command; show_id, pause_at_ms. |
| **CLIENT** | Poll | Poll-related event; usually errors only (show_id, device_id, error). Optional: periodic rate/summary. |
| **CLIENT** | DeviceCount | Optional milestone: show first crossed N devices (e.g. 1000, 10000). |
| **WORKSPACE** | TimelinePut | Timeline saved; show_id, success or error. |
| **WORKSPACE** | TrackSplitterPut | Track splitter saved; show_id, success or error. |
| **WORKSPACE** | MediaUpload | Timeline media uploaded; show_id, filename, success or error. |
| **WORKSPACE** | ShowLocation | Show location / map state updated (optional / DEBUG). |
| **ADMIN** | ResetConnections | Admin reset connections for show; show_id, optional username. |
| **ADMIN** | FullDeviceList | Full device list or export requested; show_id (optional). |
| **SIMULATED** | NotifyLive | Notify simulated server show went live; show_id, success or error. |
| **SIMULATED** | NotifyEnded | Notify simulated server show ended; show_id, success or error. |
| **ERROR** | Handler | Unexpected error in a handler; path, show_id if relevant, error message. |

---

## Where each log goes: Show log vs Server log

Use this table to decide per event type. **Show** = write to `userData/shows/<show_id>/logs/show.txt`. **Server** = write to `userData/logs/server.txt`. **Both** = write to both files (and include show_id in the details for the server log so the line is self-describing).

| Category | Subcategory | Example details (short) | Show log | Server log |
|----------|-------------|--------------------------|:--------:|:----------:|
| UPTIME | Startup | Server started main=3002 admin=3010 | No | Yes |
| UPTIME | Shutdown | Server shutting down | No | Yes |
| AUTH | Login | username=ops success | No | Yes |
| AUTH | Logout | username=ops | No | Yes |
| AUTH | Register | username=ops success | No | Yes |
| AUTH | SessionInvalid | (optional) | No | Yes |
| AUTH | ShareShow | show_id=abc12345 from_username=ops to_username=editor success | Yes | Yes |
| SHOW | GoLive | show_id=abc12345 username=ops | Yes | Yes |
| SHOW | EndLive | show_id=abc12345 username=ops | Yes | Yes |
| SHOW | Create | show_id=abc12345 name=... username=ops | Yes | Yes |
| SHOW | Delete | show_id=abc12345 username=ops | Yes | Yes |
| BROADCAST | Timeline | show_id=abc12345 success | Yes | Yes |
| BROADCAST | Play | show_id=abc12345 readhead_sec=12.5 play_at_ms=... | Yes | Yes |
| BROADCAST | Pause | show_id=abc12345 pause_at_ms=... | Yes | Yes |
| CLIENT | Poll | show_id=abc12345 device_id=... error={...} | Yes | Yes |
| CLIENT | DeviceCount | show_id=abc12345 count=10000 | Yes | Optional |
| WORKSPACE | TimelinePut | show_id=abc12345 success | Yes | Optional |
| WORKSPACE | TrackSplitterPut | show_id=abc12345 success | Yes | Optional |
| WORKSPACE | MediaUpload | show_id=abc12345 filename=... success | Yes | Optional |
| WORKSPACE | ShowLocation | show_id=abc12345 (optional) | Yes | No |
| ADMIN | ResetConnections | show_id=abc12345 username=ops | Yes | Yes |
| ADMIN | FullDeviceList | show_id=abc12345 | Yes | Optional |
| SIMULATED | NotifyLive | show_id=abc12345 success | No | Yes |
| SIMULATED | NotifyEnded | show_id=abc12345 success | No | Yes |
| ERROR | Handler | path=/api/... show_id=... error=... | If show_id present: Yes | Yes |

**Guidelines:**

- **Server log only:** Events that are not tied to a show (startup, shutdown, auth, simulated server notify). These have no show_id or the show_id is only context.
- **Show log only:** Optional high-volume or very local events (e.g. ShowLocation at DEBUG).
- **Both:** Show-scoped events you want to see both in the show’s audit trail and in the global server log (go-live, end-live, broadcast, poll errors, reset connections, create/delete show). When writing to the server log, always include `show_id` in the details so the line is self-explanatory.

---

## Rolling / retention

- **Rolling:** Rotation is **size-based** at approximately **20 MB** per file. When the active file reaches the limit, it is renamed (e.g. `server.txt` → `server.txt.1`), older rotated files are shifted (`.1` → `.2`, etc.), and a new active file is opened. The last **5** rotated files are kept per channel; older ones are deleted so disk usage stays bounded (~100 MB per channel).
- **Server log:** Active file `userData/logs/server.txt`; rotated files `server.txt.1` … `server.txt.5` in `userData/logs/`.
- **Show log:** Active file `userData/shows/<show_id>/logs/show.txt`; rotated files `show.txt.1` … `show.txt.5` in that directory. When a show is deleted, its log directory is removed with the show folder. When a show ends (EndLive), the worker closes that show’s file handle so we do not hold open files for every show that ever logged.
