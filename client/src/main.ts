interface PollEvent {
  t: number;
  color: string;
}

const DEVICE_ID_STORAGE_KEY = "lumelier_device_id";

interface PollResponse {
  serverTime: number;
  deviceId: string;
  events: PollEvent[];
}

const POLL_INTERVAL_MS = 2500;
const CLOCK_UPDATE_MS = 100;

/** Offset from local time to server time (ms). serverTime ≈ Date.now() + offset */
let clockOffset = 0;
let clockIntervalStarted = false;
/** RTT from previous poll (ms), sent on next request for server to store. */
let lastRttMs: number | null = null;

function getServerTime(): number {
  return Date.now() + clockOffset;
}

async function fetchPoll(): Promise<PollResponse> {
  const deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  const headers: HeadersInit = {};
  if (deviceId) (headers as Record<string, string>)["X-Device-ID"] = deviceId;
  if (lastRttMs != null) (headers as Record<string, string>)["X-Ping-Ms"] = String(lastRttMs);
  const t0 = Date.now();
  const res = await fetch("/api/poll", { headers });
  lastRttMs = Date.now() - t0;
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  const data = (await res.json()) as PollResponse;
  if (data.deviceId) localStorage.setItem(DEVICE_ID_STORAGE_KEY, data.deviceId);
  return data;
}

function render(events: PollEvent[], deviceId: string) {
  const app = document.getElementById("app");
  if (!app) return;

  const firstColor = events.length > 0 ? events[0].color : "#000000";
  const serverTime = getServerTime();
  app.innerHTML = `
    <p style="font-size:11px;color:#666;word-break:break-all;"><strong>Device ID:</strong> ${deviceId || "—"}</p>
    <p>Server time: <span id="server-time">${serverTime}</span></p>
    <p>Events: ${events.length}</p>
    <div style="width:80px;height:80px;background:${firstColor};border:1px solid #333;"></div>
  `;
}

function updateClockDisplay() {
  const el = document.getElementById("server-time");
  if (el) el.textContent = String(getServerTime());
}

async function pollLoop() {
  try {
    const data = await fetchPoll();
    clockOffset = data.serverTime - Date.now();
    const displayId = data.deviceId || localStorage.getItem(DEVICE_ID_STORAGE_KEY) || "—";
    render(data.events, displayId);
    if (!clockIntervalStarted) {
      clockIntervalStarted = true;
      setInterval(updateClockDisplay, CLOCK_UPDATE_MS);
    }
  } catch (e) {
    const app = document.getElementById("app");
    if (app) app.innerHTML = `<p>Error: ${String(e)}</p>`;
  }
  setTimeout(pollLoop, POLL_INTERVAL_MS);
}

pollLoop();
