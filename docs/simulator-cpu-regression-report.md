# Simulator CPU Regression Report: 25k → ~1k Devices

**Context:** Early in development the stack could run ~25,000 simulated devices before maxing out CPU. Today the limit is around 1,000. This report identifies likely CPU hotspots in the **main server**, **simulated server**, and **admin frontend**, and suggests where to improve. Focus is on CPU; RAM is assumed fine. When testing locally, both servers and the browser run on one machine, so networking (TCP, serialization, request handling) still consumes CPU.

---

## 1. Main Server (Lumelier — port 3002)

The main server handles **GET /api/poll** from every real and simulated client. Each poll does registry work, optional track assignment, broadcast load, timeline filtering, and JSON response build.

**Future direction:** A refactor will give **each device its own timeline** (or a timeline keyed by something device-specific). Most devices will have different timelines; some may share. Recommendations below do not assume that any two devices share a timeline long term—we can still gain by caching when they do.

### 1.1 Per-poll hot path (src/api/poll.rs, connections.rs)

- **Connection registry (DashMap):** `upsert()` does an `entry()` plus mutable update (clone device_id, push to ping_samples/server_processing_samples, geo fields). `get_is_sending_gps()` and `get_track_index()` / `set_track_index()` add more lookups. Cost scales with concurrency, not total device count; DashMap is per-key, so this is usually modest.
- **Track assignment:** When the client does not send `X-Request-Track-Id`, the server may call `track_splitter_tree::evaluate()` with `rand::rngs::OsRng`. **OsRng uses system entropy and is relatively expensive.** For simulated clients we only send device-id, ping, client-send-ms; we do not send track id. For *existing* devices (already in registry, no GPS change) we do not call `evaluate`; we only call `get_track_index`. So OsRng cost is mainly on first poll or when GPS toggles. If many simulated clients are created at once, the first wave of polls can spike CPU from OsRng.
- **Broadcast snapshot:** `broadcast.load_full()` (ArcSwap) is cheap (atomic load of an Arc).
- **Timeline preparation per device:** Today `filter_timeline_by_track()` runs per poll; after the refactor, the server will deliver a **different timeline per device** (or per timeline id). The same cost applies: for each poll we must produce the device’s timeline (filter, subset, or lookup). For every poll this currently:
  - Clones the full timeline `serde_json::Value` (or at least the object map and arrays).
  - Iterates all `items` to filter by `layerId` (or equivalent).
  - Builds a new object and wraps in `Arc::new()`.
  With a large timeline, that’s **O(timeline size) per poll**. With thousands of polls per second, this becomes **timeline size × poll rate**. We cannot assume two devices share a timeline, but we can still cache by timeline identity when they do.
- **Response serialization:** `Json(body).into_response()` serializes the poll response (including the filtered timeline). Larger filtered payload = more CPU per response.

**Improvement ideas (main server):**

- **Cache prepared timeline by identity (map, reuse on repeat):** Each device gets a timeline (or a “timeline id” that resolves to one). Maintain a cache keyed by **timeline identity** (e.g. content hash, or server-assigned id if timelines are stored). When serving a poll, resolve the device’s timeline id; if the cache already has a prepared/ serialized form for that id, reuse it (e.g. Arc clone). Otherwise compute (filter/subset as today), insert into the cache, then serve. This gives a win when two or more devices share the same timeline, without assuming they do. Use eviction (e.g. LRU, or by version) to bound memory.
- **Avoid cloning the full timeline when building per-device view:** e.g. store timelines in a structure that allows cheap per-timeline views (pre-split by layer or by timeline id) so producing a device’s payload is index-based rather than full scan + clone. With per-device timelines, the main gain is “no full clone per poll” when we can reuse a cached result for that timeline id.
- **Replace OsRng with a fast RNG for track assignment:** e.g. `rand::rngs::StdRng` or `ThreadRng` seeded once per request (or per device) so track assignment does not hit the system RNG on every first poll when simulating many devices at once.
- **Reduce JSON size:** If timelines are large, consider a compact representation or omitting unchanged parts for clients that already have it (e.g. etag/conditional response). Less to serialize and send.

---

### 1.2 Admin API and device list (src/api/admin.rs, connections.rs)

When the admin **Connected Devices** list is open, it refreshes on a timer (default 2 s). Each refresh does:

- **GET .../connected-devices/page-ids:** Resolves bucket, calls `tick_disconnects(now_ms)`, then **`list_rows_filtered(now_ms, connected_only)`**. That method **iterates the entire registry** and builds a `Vec<DeviceRow>` (one per device), then the handler sorts and paginates. So with 25k devices, **every 2 seconds** the server builds 25k `DeviceRow` structs (with string clones, optional floats, etc.) and sorts the full list. Then **POST .../connected-devices/by-ids** does `tick_disconnects` again and `rows_by_ids(now_ms, &body.ids)` for the visible page only (cheap if page size is small).

So with many devices, the **page-ids** path is O(total devices) per refresh and runs every few seconds. That can add significant CPU when the admin tab is open and device count is high.

**Improvement ideas (admin device list):**

- **Server-side pagination without materializing all rows:** e.g. maintain an index or iterate the registry once to produce only (device_id, sort_key) for the current page, then fetch full rows only for those IDs. Avoid building and sorting a 25k-element `Vec<DeviceRow>` on every refresh.
- **Call `tick_disconnects` once per refresh** (e.g. in one endpoint or a shared path) instead of in both page-ids and by-ids when both are called in the same refresh cycle.
- **Throttle or increase default refresh interval** when device count is large (e.g. backend could suggest or enforce a higher interval when total_connected &gt; N).

---

### 1.3 tick_disconnects (connections.rs, live_shows.rs)

`tick_disconnects(now_ms)` is called from admin handlers (get_stats, get_connected_devices, get_page_ids, post_by_ids). It does `devices.iter_mut().for_each(...)` over the whole registry. So every admin request that touches devices triggers a full registry scan. With 25k devices that’s 25k entries touched. Cost is linear in device count and request rate from the admin.

**Improvement ideas:**

- Run `tick_disconnects` in a **single background task** (e.g. every 10 s) and have admin handlers read state without calling it. Or call it at most once per “tick” shared across admin endpoints.

---

## 2. Simulated Server (lumelier-simulated-server — port 3003)

The simulated server runs **one process** that pretends to be many clients: it has a **runner** (sync loop + per-client tasks) and **HTTP routes** for the admin UI.

### 2.1 Architecture: 3 tasks per client

For each simulated client the runner spawns **three long-lived tasks**:

1. **Poll loop:** Sleep until next poll time (or end of lag block), apply C2S delay, **GET main server /api/poll**, apply S2C delay, apply poll response, schedule next poll, update store, wake display loop.
2. **Lag loop:** Sleep until next lag spike or end of current spike; sample distributions and update lag state.
3. **Display loop:** Wake on channel (poll delivered) or timer; compute current color from broadcast timeline; update store; sleep until next color change or fallback (15 s).

So **N clients ⇒ 3N tasks**. At 25k clients that’s **75k tokio tasks**. Each task does async work (sleep, channel, HTTP). Context switching and scheduler overhead scale with task count; so does memory (stack, state). This is a structural cost that didn’t exist when the design was “simpler” or client count was low.

**Improvement ideas:**

- **Batch or pool clients:** e.g. one task that drives many “virtual” clients in a loop (round-robin or time-ordered wakeups) instead of 3 tasks per client. Fewer tasks, more predictable scheduling.
- **Limit concurrency of outbound HTTP:** e.g. a semaphore or a fixed pool of poll workers that take “next due” client from a queue. Reduces simultaneous connections and request handling on the main server when testing locally.

---

### 2.2 Poll loop CPU (runner.rs, client_sync.rs)

Per poll completion the simulated server does:

- Multiple **DashMap** lookups: `per_show.get(show_id)`, `runner_state.clients.get/get_mut`, `store.get_full()` several times, `store.append_sample`, `store.update_display`.
- **rand::thread_rng()** used many times per poll: for C2S delay, S2C delay, processing delay, next poll interval. `thread_rng()` is cheaper than OsRng but still non-zero.
- **HTTP:** `client.get(url).send().await` and `response.json().await` — on localhost this is TCP + serialization on main server and deserialization on simulated server. Both sides pay CPU.
- **apply_poll_response()** (client_sync.rs): Pushes to `sync_samples`, computes median (sorts a Vec), filters by delay, clones `broadcast_cache` (full `PollBroadcast` with timeline), updates playback state, then **get_color_from_broadcast_timeline** and **next_color_change_sec**: both **filter and sort timeline items** (Set Color Broadcast events). So every poll does **O(timeline items)** work in the simulated server as well. After the refactor, each simulated client may have a different timeline; we can still cache derived data per timeline identity so repeats get a cache hit.
- **store.update_display()** and **append_sample()**: DashMap get_mut, Vec push, possible drain for sample_history trim.

So per client per poll: **multiple DashMap ops, RNG calls, HTTP round-trip, JSON deserialize, median sort, timeline filter/sort, store updates.** At 25k clients and e.g. 1 poll/sec each, that’s 25k × that work per second on the simulated server, plus 25k responses from the main server (each with filter_timeline_by_track + serialize).

**Improvement ideas:**

- **Cache timeline-derived data by timeline identity (map, reuse on repeat):** Maintain a map from **timeline identity** (e.g. content hash or id from the poll response) to precomputed index (e.g. sorted Set Color events, or next-change lookup). When applying a poll response, look up that timeline’s id; if the map has an entry, use it (no filter/sort). If not, compute the index, insert into the map, then use it. Most devices will have different timelines, but when two do share one we avoid redoing the work. Evict old entries (e.g. LRU) to bound memory.
- **Reduce RNG calls:** e.g. batch or reuse samples where semantics allow.
- **Lighter apply_poll_response:** Avoid cloning the full broadcast when possible; share Arc or reference; keep median buffer but avoid extra allocations in the hot path.

---

### 2.3 Display loop (runner.rs)

The display loop runs for every client. On wake (from poll delivery or timer) it:

- Gets bucket and **runner_state.clients.get_mut(client_id)**.
- **get_broadcast_playback_sec**, **get_display_color_at**, **next_color_change_sec** — the latter two again **filter and sort timeline items** (Set Color Broadcast).
- **store.update_display()** if color changed.
- **store.get_full()** for delay sampling for the next sleep.

So every time a client’s poll is delivered, the display task runs and does **timeline filter + sort** and possibly a store update. With 25k clients, that’s 25k such runs per “wave” of poll completions. Each client may have a different timeline after the refactor; we can still reuse work when the same timeline appears again.

**Improvement ideas:**

- Same as above: **per-timeline-identity index map** (e.g. sorted Set Color events, or next-change lookup keyed by timeline id/hash). Display loop looks up the current client’s timeline id; if present, do a binary search or lookup instead of full filter/sort. If absent, compute, store in map, then use. Reuse when two clients share a timeline.
- Consider **throttling display updates** (e.g. update at most every 100 ms per client) to cap CPU when many clients receive a poll in a short window.

---

### 2.4 Runner sync loop (runner.rs)

Every **SYNC_INTERVAL_MS (1 s)** the runner:

- Iterates all shows and **all client IDs** in the store.
- For each client not yet in runner_state: **store.get_full()**, **record_sample_sec** (distribution sample + **store.append_sample**), **runner_state.ensure_client()**, then **spawns 3 tasks**.

So for **new** clients we do get_full, distribution sampling, append_sample, and 3 spawns. The ongoing cost is low once all clients are running; the one-time cost when adding many clients (e.g. “Create 10k”) is a burst of get_full, sampling, and 3×10k spawns. That can cause a CPU and memory spike.

**Improvement ideas:**

- **Stagger spawning:** e.g. add clients to a “pending” set and spawn in batches (e.g. 500 per 100 ms) so we don’t spawn 30k tasks in one second.
- **Lazy or batched sampling** when creating many clients so we don’t do full distribution work for each before the first poll.

---

### 2.5 HTTP routes (simulated-server routes.rs)

Admin UI calls **POST .../clients/summaries** with a list of visible client IDs. The handler calls **store.get_summaries_for_ids(ids)** (one DashMap get per id) and then for each summary fills **lag_ends_in_ms** from **runner_state.clients.get(id)**. So cost is O(visible_ids). We already limited the frontend to visible page + selected only; so this path is bounded and likely not the main regression. **GET .../clients** returns **get_minimal_list()** which iterates all clients and builds a Vec of minimal entries — if the admin or any tool calls this often with 25k clients, it would be O(25k) per request. Worth ensuring this is only used for initial load or low-frequency pagination, not on a tight timer.

---

## 3. Admin Frontend (Simulate Devices tab)

The simulate-devices tab now:

- Requests **summaries only for visible grid clients + selected** (POST summaries with ids).
- Uses **rAF-aligned updates** and **dirty-checked grid** to reduce DOM and layout work.

So the frontend is already optimized for high refresh rate and many clients. Remaining cost is:

- **Refresh interval:** If the user sets “Refresh every: Frame” (16 ms), the browser sends **POST .../clients/summaries** ~60 times per second. Each request is small (visible IDs only), but the simulated server still does get_summaries_for_ids + lag from runner_state per request. At 60 req/s the simulated server does 60 × (visible_count) lookups per second. Usually acceptable; if visible_count were large (e.g. 500) it might add up.
- **GET .../clients** (full minimal list): Used on full refresh (load, create, destroy, clone). With 25k clients this returns 25k minimal records. One big JSON parse and one big merge into client list. Do this only when necessary, not on a timer.

No change needed for the “visible only” and rAF/dirty-check work; just avoid calling GET .../clients on a tight loop.

---

## 4. Local testing and networking

When everything runs on one machine:

- **Main server** receives 25k TCP connections (or a smaller pool with keep-alive) and 25k poll requests per “wave.” Each request is handled in the hot path above (registry, broadcast, per-device timeline preparation, serialize). No real network latency to hide CPU cost.
- **Simulated server** opens 25k HTTP requests (or reuses connections) to localhost. Each request uses CPU for reqwest, TLS (if any), and JSON. **Same-machine TCP is still syscalls, copy, and (de)serialization**, so CPU scales with request rate and payload size.

So “networking” in local testing is largely **CPU-bound**: both sides burn CPU on the same core(s). Reducing work per poll (main + simulated) and reducing concurrency (fewer simultaneous polls, or batched virtual clients) will help more than optimizing “network” in the traditional sense.

---

## 5. Summary: most impactful improvements

| Area | Suspected cost | Improvement |
|------|----------------|------------|
| **Main server** | Full timeline clone + filter (or equivalent) per poll, per device | **Cache prepared timeline by identity:** map from timeline id/hash → prepared result (e.g. Arc); lookup per poll, reuse when the same timeline is requested again. Evict (e.g. LRU) to bound memory. Do not assume two devices share; the map gives reuse when they do. |
| **Main server** | OsRng in track_splitter_tree when assigning track | Use a fast RNG (e.g. StdRng/ThreadRng) for tree evaluation. |
| **Main server** | Admin device list: list_rows_filtered + sort over all devices every 2 s | Server-side pagination without building full Vec&lt;DeviceRow&gt;; or iterate once to get sort keys and fetch full rows only for current page. |
| **Main server** | tick_disconnects on every admin request | Run tick_disconnects in a single periodic task; admin reads without mutating. |
| **Simulated server** | 3 tasks per client (75k tasks at 25k clients) | Drive many virtual clients from fewer tasks (batched loop or worker pool). |
| **Simulated server** | Timeline filter + sort in apply_poll_response and display loop, per client | **Per-timeline-identity index map:** key by timeline id/hash; value = precomputed sorted Set Color events (or next-change index). Look up on each poll/display; compute and insert on miss. Reuse when two clients share a timeline; no assumption that they do. |
| **Simulated server** | Burst of spawns when adding many clients | Stagger spawning (e.g. 500 clients per 100 ms). |
| **Both** | Large JSON timeline in every poll response | Cache prepared/serialized response per timeline identity where possible; consider smaller or incremental format. |

Implementing a **per-timeline-identity cache** on the main server (prepared timeline or serialized response) and a **per-timeline-identity index map** on the simulated server (precomputed filter/sort for color and next-change) should give the largest gain: reuse when timelines repeat, without assuming any two devices share. Follow with reducing per-client task count and admin device-list full-scan.
