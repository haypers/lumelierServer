Current setup (single show)
Main server (port 3002)
Serves the client app and GET /api/poll.
One ConnectionRegistry: single DashMap<device_id, DeviceState> — all devices in one bucket.
One BroadcastSnapshot (ArcSwap): one timeline, one play/pause/readhead for everyone.
Poll: reads device id (and optional headers), upserts into that single registry, returns the single broadcast. No notion of “show”.
Admin server (port 3010)
Same registry and broadcast in AdminAppState.
All admin routes use that single state: connected devices, stats, broadcast timeline/play/pause, shows (file list/get/put), venues, map-state, simulated-client-profiles.
No auth; anyone who can reach the server sees and changes everything.
Shows (files)
show_timelines_path: list/get/put show JSON files by name.
The “live” timeline is whatever was last POSTed to /api/admin/broadcast/timeline; it’s not tied to a show filename. Admin loads a show file and POSTs it to broadcast.
Simulated server
Separate binary, started by main if present. Simulated clients poll the main server.
Admin has “Simulate Devices” page and simulated-client-profiles API; all global, no show scoping.
So today: one logical show — one registry, one broadcast, one “live” timeline. Multi-show means introducing a show identity and scoping all of that by show.
What MultiShow must change
Show identity
4-character show code (e.g. ABCD).
Client: “I am show ABCD” (e.g. from URL or header).
Admin: “I’m acting on show ABCD” (from login/session + header).
Per-show state
Devices: which show each device belongs to.
Timeline + play/pause: per show.
Optional: per-show map state / venue list (or keep global; your choice).
SingleShow vs MultiShow
SingleShow: behave as now; one implicit show (e.g. "default"). No show code in requests.
MultiShow: every request that needs show context carries a show code; server uses only that show’s data.
Simulated server
In MultiShow: don’t start it, don’t expose Simulate Devices UI or simulated-client-profiles (or gate them behind SingleShow).
Strategies
1. Show code: how clients and admin send it
Client (devices)
Option A – Query: GET /api/poll?show=ABCD
Simple; client gets code from somewhere (e.g. printed URL or QR).
Option B – Header: X-Show-Code: ABCD
Same URL for all shows; good for shared client build.
Option C – Path: GET /api/poll/ABCD
RESTy; client must know code and build path.
Recommendation: header or query; header keeps URLs identical and is easy to add. Client can get code from URL (e.g. ?show=ABCD) once and then send it in header on every poll if you prefer.
Admin
After login, backend knows “which shows this user can access” and optionally “current show”.
Every admin request sends current show in a header, e.g. X-Show-Code: ABCD (or X-Admin-Show: ABCD).
Server uses that to choose registry + broadcast (and optionally map state, etc.).
No auth yet: you can still add the header from the frontend (admin UI picks current show from a dropdown); later you tie allowed shows to login.
2. Storing per-show state (registry + broadcast)
Option A – Single struct keyed by show
DashMap<ShowCode, ConnectionRegistry> and DashMap<ShowCode, Arc<ArcSwap<BroadcastSnapshot>>> (and optionally per-show map state).
Lookup by show code on every poll and every admin call.
SingleShow: use a constant key, e.g. "default".
Option B – Show-scoped “app state”
One struct, e.g. ShowState { registry, broadcast, map_state?, … }.
DashMap<ShowCode, ShowState> (or similar).
Same idea as A but keeps all per-show data in one place; good if you add more per-show things later.
Option C – Keep one registry, tag devices
Registry key (show_code, device_id) or a device_id that embeds show (e.g. ABCD:uuid).
Broadcast still has to be per-show, so you’d have DashMap<ShowCode, ArcSwap<BroadcastSnapshot>> anyway.
More invasive for registry and all listing/filtering; usually A or B is simpler.
Recommendation: Option B — a ShowState (or “show bucket”) per show code. SingleShow = one predefined show code (e.g. "default") created at startup; MultiShow = create or lazily create a bucket per valid 4-char code.
3. Where show code comes from (client)
SingleShow:
No show code required. Backend uses the single default show for all requests (poll and admin).
MultiShow:
Client must know the code. Options:
URL: e.g. https://yourapp.com/?show=ABCD or https://yourapp.com/ABCD; client reads code and sends it on poll (query or header).
QR / printed: “Show ABCD” with link containing code; same idea.
Validation: 4-char, allowed charset (e.g. alphanumeric). 404 or 400 if missing/invalid in MultiShow.
4. Admin: auth and which shows
Phase 1 (no auth):
Admin UI has a “Current show” dropdown (or input).
Frontend sends X-Show-Code: ABCD on every admin API request.
Backend trusts the header and serves only that show’s data (devices, broadcast, etc.).
Good for building and testing MultiShow.
Phase 2 (auth):
Login (e.g. JWT or session).
Backend has a list of show codes per user (or per org).
“Current show” dropdown is filtered to shows the user is allowed to see.
Optionally: middleware that checks JWT, resolves allowed shows, and sets “current show” from header or session so handlers only see one show.
MultiShow:
Require auth for admin and require X-Show-Code (or equivalent) for all admin endpoints that touch devices/timeline/map.
SingleShow: no header needed; backend uses default show.
5. Mode flag: SingleShow vs MultiShow
Config / env: e.g. SINGLE_SHOW=true (default) vs MULTI_SHOW=true.
SingleShow:
One default show bucket.
Poll: no show code required; use default.
Admin: no show header required; use default.
Simulated server and Simulate Devices UI: on.
MultiShow:
Show code required on poll (and optionally on client URL).
Admin: show code required (from header); auth can validate that the user can access that show.
Simulated server: do not start.
Admin UI: hide “Simulate Devices” (and simulated-client-profiles routes or return 404 in MultiShow).
6. Shared vs per-show data (optional)
Per-show (recommended for MultiShow):
Registry (devices).
Broadcast (timeline + play/pause/readhead).
Map state (so each show has its own map/venue state).
Global (simpler, if you prefer):
Show timeline files (list/get/put): could stay global and identify by filename, e.g. ABCD.json; in MultiShow, list only shows the user can access (e.g. by show code).
Venues: could stay global or move to per-show; same for simulated profiles if you ever expose them in MultiShow (e.g. per-show profiles).
7. Show timeline files and “live” broadcast
Today: show files are just storage; “live” is one global broadcast.
MultiShow: each show has its own broadcast.
put_show / get_show: can stay file-based, with naming like {show_code}.json or {name}.json and access control by show.
POST broadcast/timeline: in MultiShow, must be tied to show (from admin header), and only that show’s broadcast is updated.
Suggested order of work
Introduce show concept in backend
Add a mode flag (SingleShow / MultiShow).
SingleShow: one ShowState (registry + broadcast) keyed e.g. "default".
MultiShow: DashMap<ShowCode, ShowState> (or similar); create/lazy-create per code.
Poll
SingleShow: ignore show code; use default show.
MultiShow: require show code (header or query), validate 4-char; use that show’s registry and broadcast; 400 if missing/invalid.
Admin state and routes
Admin state holds the “show store” (map of show code → ShowState), not a single registry/broadcast.
Extract “current show” from header (and later from auth).
Every handler that today uses state.registry / state.broadcast uses instead the registry/broadcast for that show.
SingleShow: no header; use default show.
Admin UI
Add “Current show” (dropdown or input); send X-Show-Code on every request.
In MultiShow, only show codes the user is allowed to see (later from auth).
Client
In MultiShow, client gets show code from URL (or config) and sends it on each poll (query or header).
Simulated server and UI
If mode is MultiShow: don’t spawn simulated server; in admin, hide Simulate Devices and (optionally) disable simulated-client-profiles for that mode.
Auth (later)
Login; attach allowed show codes to the user; middleware validates X-Show-Code against that list.
Summary
SingleShow: Keep current behavior with one implicit show; one registry, one broadcast; simulated server and UI on.
MultiShow: 4-char show code; per-show registry + broadcast (and optionally map state); client sends code on poll; admin sends code in header and (later) auth restricts which codes they can use; no simulated server or Simulate Devices UI.
Implementing a show-scoped state store (e.g. ShowState per code) and a mode flag gives you a clear path to both modes without rewriting everything twice.