# Server→client push (SSE) for urgent commands

Feasibility and design notes for adding a dedicated server→client channel for urgent messages (e.g. play/pause) while keeping the majority of data transfer on the existing client→server poll.

---

## Current architecture

- **Client → server**: Client calls `GET /api/poll` every **2.5 s** with optional `X-Device-ID` and `X-Ping-Ms`. The server responds with full state: `serverTime`, `serverTimeAtSend`, `deviceId`, `events`, and **`broadcast`** (timeline JSON, `playAtMs`, `pauseAtMs`, `readheadSec`).
- **Play/pause**: Admin calls `POST /api/admin/broadcast/play` or `.../pause`; the server updates in-memory broadcast state. Clients see that only on their **next poll**, so worst-case latency is **~2.5 s + RTT** (e.g. 2.5–3 s).

So today, all server→client data (including urgent play/pause) is carried only on the **client-initiated** poll response.

---

## Feasibility of a server→client channel for urgent commands

**Feasible and a good fit.** Two practical options:

### 1. Server-Sent Events (SSE)

- One-way server→client.
- Client opens something like `GET /api/events` (or `/api/broadcast/stream`) and keeps the connection open; server sends a line of JSON when play/pause (and later other urgent things) happen.
- **Axum**: straightforward (e.g. `Stream` of `Event` or a channel receiver).
- **Client**: `EventSource` API; on message, parse JSON and apply play/pause immediately.
- No change to how the client identifies itself if you send the same `deviceId` (or session) in the SSE URL or in a first event.

### 2. WebSockets

- One (or two) connections: either WS only for push, or WS for push + keep poll for “bulk” data.
- Gives a single long-lived connection; you can later use it for other push or even for lightweight pings.
- Slightly more work (connection lifecycle, reconnects, maybe ping/pong) than SSE for “just push.”

**Recommendation:** For “urgent notes like pause and play” only, **SSE is the lighter and simpler** option; you can add a dedicated **server→client** channel without changing the rest of the design.

---

## Upsides

- **Lower latency for play/pause**  
  Commands reach the client in roughly **one RTT** (e.g. tens–hundreds of ms) instead of waiting for the next 2.5 s poll. Better for “start at time T” sync.

- **Clear split of roles**  
  - **Push (SSE)**: urgent, small payloads (play, pause, maybe later “seek” or “reset”).  
  - **Poll**: bulk and source-of-truth (timeline, config, device id, server time, etc.).  
  As you add more data to the poll response, play/pause latency doesn’t get worse.

- **Scalability of data**  
  You can grow the poll payload (more timeline/metadata, more fields over time) without touching the push path or increasing push message size.

- **Simpler mental model**  
  “Urgent = push; everything else = poll.” Easy to document and extend (e.g. add another event type on SSE later).

---

## Downsides and mitigations

- **Two connections per client**  
  Poll (HTTP) + SSE. More connections and a bit more server logic (e.g. a set of SSE subscribers). For a single admin and a moderate number of clients this is usually fine; you can bound max SSE connections if needed.

- **Reconnect and ordering**  
  If the SSE connection drops, the client must reconnect (e.g. `EventSource` does this; you can add backoff). Risk: client might miss a play/pause during the gap.  
  **Mitigation:** Treat **poll as source of truth**. When a poll response includes `broadcast`, the client overwrites/merges with current state (as it already does). So even if a push message is missed, the next poll (within 2.5 s) corrects state. Push is then a “latency optimization,” not the only way to get play/pause.

- **Consistency**  
  Client might get play via SSE and then a slightly different `broadcast` on the next poll (e.g. if admin hits pause right after).  
  **Mitigation:** Same as above: always apply poll’s `broadcast` when present; design push payloads so they’re a subset of what poll can send (e.g. same `playAtMs` / `pauseAtMs` semantics). No conflicting truth.

- **Operational / environment**  
  Long-lived SSE can be buffered by some proxies or closed by load balancers. In practice, many environments support SSE; if you hit issues, you can add a heartbeat (comment line every N s) or fall back to “poll-only” behavior (current behavior).

---

## Suggested design (high level)

- **New endpoint:** e.g. `GET /api/broadcast/events` (or `/api/events`) returning `text/event-stream`, optionally scoped by `deviceId` or a token in the query string if you want.
- **On admin play/pause:**  
  - Keep current behavior: update broadcast state (so the next poll still sees it).  
  - Additionally: push one SSE event (e.g. `{"type":"play","playAtMs":...,"serverTimeMs":...}` or the same shape as `PollBroadcast` for play/pause only) to all connected SSE clients.
- **Client:**  
  - Keep `pollLoop()` and full handling of `data.broadcast` as today (source of truth).  
  - Open `EventSource("/api/broadcast/events?...")` on load; on message, parse and apply play/pause (and later other urgent commands) immediately.  
  - No need to send timeline over SSE; timeline stays on poll only.

That keeps the majority of data transfer on **client→server** (poll) and uses a **server→client** channel only for low-latency, urgent notes like play and pause, with a clear path to add more such events later.
