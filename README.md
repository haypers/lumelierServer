# Lumelier Server

One binary that acts as both the **signal server** (API) and the **client server** (web UI). Same port for everything: API and static client.

## Requirements

- **Rust 1.85+** (for Cargo; the crates.io index includes packages that need it). If `cargo check` fails with `edition2024 is required`, install [rustup](https://rustup.rs/) and run `rustup update` so the project’s `rust-toolchain.toml` can use a recent toolchain. Do not rely on the system `cargo` from apt if it is older than 1.85.

## Build and run

### 1. Build the client

From the repo root:

```bash
cd client
npm install
npm run build
cd ..
```

This writes the web app into `dist/` at the repo root.

### 2. Run the server

From the repo root:

```bash
cargo run
```

The server listens on **http://0.0.0.0:3000** (all interfaces), so you can use:

- **http://localhost:3000** on this machine
- **http://\<your-local-ip\>:3000** from other devices on the same network (e.g. for phone/QR testing later)

### 3. Use the client

Open **http://localhost:3000** in a browser. The page will poll `/api/poll` every few seconds, show synced server time, and display the current event color.

## One-port deployment

- **GET /api/health** — liveness check (`{ "ok": true }`).
- **GET /api/poll** — returns `{ "serverTime", "events" }` (JSON).
- **GET /** and other paths — static files from `dist/` (the client app).

All served by the same process on port 3000. No separate frontend server in production.

## Admin panel (port 3010)

A separate admin web app is served on **port 3010** (same process, second listener). Build it from the repo root:

```bash
cd admin
npm install
npm run build
cd ..
```

Then run the server; open **http://localhost:3010** (or **http://\<local-ip\>:3010**). You’ll see a gate screen with a “Proceed” button. Clicking it sets a localStorage token and shows the dashboard. Auth is a placeholder (localStorage only) so you can swap in real auth later.

## After changing the client or admin

Rebuild the app you changed, then restart the server (it reads from `dist/` and `dist-admin/` on each request):

```bash
cd client && npm run build && cd ..   # client
# or
cd admin && npm run build && cd ..   # admin
cargo run
```
