interface PollEvent {
  t: number;
  color: string;
}

interface PollResponse {
  serverTime: number;
  events: PollEvent[];
}

const POLL_INTERVAL_MS = 2500;
const CLOCK_UPDATE_MS = 100;

/** Offset from local time to server time (ms). serverTime ≈ Date.now() + offset */
let clockOffset = 0;
let clockIntervalStarted = false;

function getServerTime(): number {
  return Date.now() + clockOffset;
}

async function fetchPoll(): Promise<PollResponse> {
  const res = await fetch("/api/poll");
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json() as Promise<PollResponse>;
}

function render(events: PollEvent[]) {
  const app = document.getElementById("app");
  if (!app) return;

  const firstColor = events.length > 0 ? events[0].color : "#000000";
  const serverTime = getServerTime();
  app.innerHTML = `
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
    render(data.events);
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
