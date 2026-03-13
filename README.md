# Lumelier Server

Just ask the model how to get this project running. it can make a translation of the runAll.sh command for your os. i'm on linux rn. - hayden

## Requirements

- **Rust 1.85+** (for Cargo; the crates.io index includes packages that need it). If `cargo check` fails with `edition2024 is required`, install [rustup](https://rustup.rs/) and run `rustup update` so the project’s `rust-toolchain.toml` can use a recent toolchain. Do not rely on the system `cargo` from apt if it is older than 1.85.

- **ffmpeg** (optional but recommended). Used to read duration of audio/video assets in the admin timeline (Assets tab). Without it, the server runs normally but duration stays blank. Install with: `sudo apt install ffmpeg` (Debian/Ubuntu) or `brew install ffmpeg` (macOS).

- **Why Rust?** Because we are working with complex bulk networking, we can't aford the networking overhead that node provides. You'll notice the fronend for both the admin (show manager) and the client (phones) are node projects, but the networking is all served by rust. I don't know rust, I'm having AI help me build it lol.

## Build and run

### Start with fresh frontend builds (recommended)

From the repo root, run:

```bash
./runAll.sh
```

This builds the client and admin apps, then starts the server. Ensure the script is executable (`chmod +x runAll.sh` if needed). To start the server without rebuilding the frontends, use `cargo run` instead.

### 1. Build the client (manual)

From the repo root:

```bash
cd client
npm install
npm run build
cd ..
```

This writes the web app into `dist-client/` at the repo root.

### 2. Run the server

From the repo root:

```bash
cargo run
```

The server listens on **http://0.0.0.0:3002** (all interfaces), so you can use:

- **http://localhost:3002** on this machine
- **http://\<your-local-ip\>:3002** from other devices on the same network (e.g. for phone/QR testing later)

### 3. Use the client

Open **http://localhost:3002** (or **http://localhost:3002/<show_id>** for a specific show) in a browser. The page will poll `/api/poll` every few seconds, show synced server time, and display the current event color.

## One-port deployment

- **GET /api/health** — liveness check (`{ "ok": true }`).
- **GET /api/poll** — returns `{ "serverTime", "events" }` (JSON).
- **GET /** and other paths — static files from `dist-client/` (the client app).

All served by the same process on port 3002. No separate frontend server in production.

## Admin panel (port 3010)

A separate admin web app is served on **port 3010** (same process, second listener). Build it from the repo root:

```bash
cd admin
npm install
npm run build
cd ..
```

Then run the server; open **http://localhost:3010** (or **http://\<local-ip\>:3010**). You’ll see a gate screen with a “Proceed” button. Clicking it sets a localStorage token and shows the timeline. Auth is a placeholder (localStorage only) so you can swap in real auth later.

## After changing the client or admin

Rebuild the app you changed, then restart the server (it reads from `dist-client/` and `dist-admin/` on each request):

```bash
cd client && npm run build && cd ..   # client
# or
cd admin && npm run build && cd ..   # admin
cargo run
```

---

## Hosting on app.lumelier.com

Putting the app and admin behind Caddy at **app.lumelier.com** and **admin.lumelier.com** (e.g. on a myServer box).

### DNS records

At your DNS provider for **lumelier.com** add:

| Type  | Name   | Value                     |
|-------|--------|---------------------------|
| **A** | `app`  | `<your-server-public-IP>` |
| **A** | `admin`| `<same-IP>`               |

Or use **CNAME**: `app` and `admin` → `lumelier.com` (if lumelier.com already points at this server).

### Prerequisites on the server

- **Rust 1.85+** (e.g. `rustup`). **Node/npm** for building client and admin.
- **ffmpeg** (optional): `sudo apt install ffmpeg` for asset duration in the admin Assets tab.

### Build and run (first time)

From the repo root on the server:

```bash
./prodAll.sh
```

This builds client + admin and the release binary. Listens on **3002** (app) and **3010** (admin).

To run as a **systemd service** (survives reboots):

```bash
sudo cp /path/to/lumelierServer/lumelier-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable lumelier-server
sudo systemctl start lumelier-server
```

The service sets `LUMELIER_PUBLIC_URL=https://app.lumelier.com` so live-join URLs and QR codes use the public HTTPS URL.

### Caddy (reverse proxy)

The myServer **unified Caddyfile** should have:

- **app.lumelier.com** → `localhost:3002`
- **admin.lumelier.com** → `localhost:3010`

Deploy: `sudo cp ~/myServer/unified-caddyfile.conf /etc/caddy/Caddyfile && sudo systemctl reload caddy`. Caddy will get TLS certs once DNS points at the server.

### Checklist

1. **DNS**: A (or CNAME) for `app` and `admin` → server IP.
2. **Build**: `./prodAll.sh`
3. **Service**: Install and start `lumelier-server.service`.
4. **Caddy**: Deploy unified Caddyfile and reload.
5. **Use**: https://app.lumelier.com (client), https://admin.lumelier.com (admin). Create a user in the admin first.

### Ports used

| Port  | Purpose                                              |
|-------|------------------------------------------------------|
| 3002  | Main app (client + API)                              |
| 3010  | Admin panel                                          |
| 3003  | Simulated client server (optional; runAll.sh / dev)  |

Only 3002 and 3010 need to be reachable by Caddy on localhost.
