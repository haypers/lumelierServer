import { TabulatorFull as Tabulator } from "tabulator-tables";
import "tabulator-tables/dist/css/tabulator_midnight.min.css"; // dark theme
import resetIcon from "../../icons/reset.svg?raw";
import { createRefreshEvery, DEFAULT_RESPONSE_TIMEOUT_MS } from "../../components/refresh-every";
import { createInfoBubble } from "../../components/info-bubble";

const DEFAULT_REFRESH_MS = 2000;

/** Tooltips for column headers (same order as columnDefs). */
const COLUMN_HEADER_TOOLTIPS = [
  "Stable identifier for this device. Sent by the client in the X-Device-ID header once it has received one from the server (e.g. on first connection).",
  "Whether the server considers the device connected (contacted within the last 20 s) and if the client has returned the device ID handshake.",
  "Server time (Unix ms) when this device was first seen. Shown in local time.",
  "Round-trip time reported by the client (average of last few polls). Measured by the client from send of GET /api/poll to receipt of response, sent on the next poll as X-Ping-Ms.",
  "Most recent round-trip time reported by the client for the previous poll. Same measurement as Avg but not averaged.",
  "Milliseconds since the server last received a poll request from this device.",
  "Number of times this device has gone silent (no poll within 20 s) and then contacted again. Increments once per disconnect.",
  "Time from first contact to now (if connected) or to last contact (if disconnected).",
];

interface Stats {
  total_connected: number;
  averagePingMs: number | null;
}

interface DeviceRow {
  deviceId: string;
  connectionStatus: string;
  firstConnectedAt: number;
  averagePingMs: number | null;
  lastClientRttMs: number | null;
  disconnectEvents: number;
  estimatedUptimeMs: number;
  timeSinceLastContactMs: number;
}

interface ConnectedDevicesResponse {
  serverTimeMs: number;
  stats: Stats;
  devices: DeviceRow[];
}

interface StatsResponse {
  serverTimeMs: number;
  stats: Stats;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let statsRefreshTimer: ReturnType<typeof setInterval> | null = null;
let table: Tabulator | null = null;
let connectedFilterActive = false;
/** Offset (ms) from client time to server time: serverTimeMs ≈ Date.now() + serverTimeOffsetMs */
let serverTimeOffsetMs = 0;
let serverTimeRafId: number | null = null;

function formatUptime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  if (min < 60) return `${min}m ${s}s`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m ${s}s`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

async function fetchDevices(): Promise<ConnectedDevicesResponse> {
  const res = await fetch("/api/admin/connected-devices");
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  return res.json() as Promise<ConnectedDevicesResponse>;
}

async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch("/api/admin/stats");
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
  return res.json() as Promise<StatsResponse>;
}

function showResetConfirmModal(onConfirm: () => void): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <p>Remove all disconnected devices from the list?</p>
      <div class="modal-actions">
        <button type="button" class="btn-cancel">Cancel</button>
        <button type="button" class="btn-confirm">Confirm</button>
      </div>
    </div>`;
  const close = () => overlay.remove();
  overlay.querySelector(".btn-cancel")?.addEventListener("click", close);
  overlay.querySelector(".btn-confirm")?.addEventListener("click", () => {
    onConfirm();
    close();
  });
  document.body.appendChild(overlay);
}

function updateServerTimeDisplay(): void {
  const el = document.getElementById("server-time-unix");
  if (el) {
    const serverMs = Date.now() + serverTimeOffsetMs;
    el.textContent = String(Math.round(serverMs));
  }
  refreshEveryApi?.updateClockHand();
  statsRefreshEveryApi?.updateClockHand();
  serverTimeRafId = requestAnimationFrame(updateServerTimeDisplay);
}

function updateStatsEls(stats: Stats): void {
  const totalEl = document.getElementById("stat-total-connected");
  const pingEl = document.getElementById("stat-average-ping");
  if (totalEl) totalEl.textContent = String(stats.total_connected);
  if (pingEl) pingEl.textContent = stats.averagePingMs != null ? `${Math.round(stats.averagePingMs)} ms` : "—";
}

function applyConnectedFilter(): void {
  if (!table) return;
  connectedFilterActive = !connectedFilterActive;
  if (connectedFilterActive) {
    table.setFilter("connectionStatus", "like", "connected");
  } else {
    table.clearFilter();
  }
}

function sortByPing(): void {
  if (!table) return;
  table.setSort([ { column: "averagePingMs", dir: "asc" } ]);
}

function updateTable(data: DeviceRow[]): void {
  const rows = data.map((d) => ({
    deviceId: d.deviceId,
    connectionStatus: d.connectionStatus,
    firstConnectedAt: d.firstConnectedAt,
    firstConnectedAtFormatted: formatTime(d.firstConnectedAt),
    averagePingMs: d.averagePingMs ?? null,
    lastClientRttMs: d.lastClientRttMs ?? null,
    disconnectEvents: d.disconnectEvents,
    estimatedUptimeMs: d.estimatedUptimeMs,
    estimatedUptimeFormatted: formatUptime(d.estimatedUptimeMs),
    timeSinceLastContactMs: d.timeSinceLastContactMs,
  }));
  table?.setData(rows);
}

let refreshEveryApi: ReturnType<typeof createRefreshEvery> | null = null;
let statsRefreshEveryApi: ReturnType<typeof createRefreshEvery> | null = null;

async function refreshStats(): Promise<void> {
  statsRefreshEveryApi?.requestStarted();
  statsRefreshEveryApi?.recordRefresh();
  let success = false;
  try {
    const data = await fetchStats();
    serverTimeOffsetMs = data.serverTimeMs - Date.now();
    updateStatsEls(data.stats);
    updateServerTimeDisplay();
    success = true;
  } catch (e) {
    console.error("Failed to refresh stats", e);
  } finally {
    statsRefreshEveryApi?.requestCompleted(success);
  }
}

async function refresh(): Promise<void> {
  refreshEveryApi?.requestStarted();
  refreshEveryApi?.recordRefresh();
  let success = false;
  try {
    const data = await fetchDevices();
    updateTable(data.devices);
    success = true;
  } catch (e) {
    console.error("Failed to refresh devices", e);
  } finally {
    refreshEveryApi?.requestCompleted(success);
  }
}

async function doReset(): Promise<void> {
  try {
    const res = await fetch("/api/admin/connections/reset", { method: "POST" });
    if (res.ok) await refresh();
  } catch (e) {
    console.error("Reset failed", e);
  }
}

/** Tabulator titleFormatter: renders header as info bubble + title (receives mockCell, params, onRendered). */
function columnTitleWithInfoBubble(
  cell: { getValue: () => string },
  formatterParams: { tooltipText?: string },
): HTMLElement {
  const title = cell.getValue();
  const tooltipText = formatterParams.tooltipText ?? "";
  const container = document.createElement("span");
  container.className = "devices-col-header-title-cell";
  const bubbleWrap = document.createElement("span");
  bubbleWrap.className = "devices-col-header-info-wrap";
  bubbleWrap.appendChild(
    createInfoBubble({
      tooltipText,
      ariaLabel: `Info about ${title}`,
    }),
  );
  container.appendChild(bubbleWrap);
  const titleSpan = document.createElement("span");
  titleSpan.textContent = title;
  container.appendChild(titleSpan);
  return container;
}

export function render(container: HTMLElement): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (statsRefreshTimer) {
    clearInterval(statsRefreshTimer);
    statsRefreshTimer = null;
  }
  if (serverTimeRafId != null) {
    cancelAnimationFrame(serverTimeRafId);
    serverTimeRafId = null;
  }
  if (table) {
    table.destroy();
    table = null;
  }

  const columnDefs = [
    { title: "Device ID", field: "deviceId", sorter: "string", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[0] } },
    { title: "Connection Status", field: "connectionStatus", sorter: "string", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[1] } },
    { title: "First Connected At", field: "firstConnectedAtFormatted", sorter: "string", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[2] } },
    { title: "Avg Client RTT (ms)", field: "averagePingMs", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[3] } },
    { title: "Last Client RTT (ms)", field: "lastClientRttMs", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[4] } },
    { title: "Time since last contact (ms)", field: "timeSinceLastContactMs", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[5] } },
    { title: "Disconnect Events", field: "disconnectEvents", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[6] } },
    { title: "Estimated Uptime", field: "estimatedUptimeFormatted", sorter: "number", sorterParams: { field: "estimatedUptimeMs" }, titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[7] } },
  ];

  container.innerHTML = `
    <div class="devices-list-page">
      <div class="devices-toolbar">
        <button type="button" class="devices-toolbar-btn devices-toolbar-btn-danger" id="devices-drop-disconnected">${resetIcon}<span>Drop Disconnected Devices</span></button>
      </div>
      <div class="devices-stats-group">
      <div class="devices-stats-controls" id="devices-stats-controls"></div>
      <div class="devices-stats">
        <div class="stat-widget stat-widget-clickable" id="stat-widget-total" role="button" tabindex="0" title="Click to filter table to connected only">
          <span class="stat-label">Total number of connected clients:</span>
          <span class="stat-value stat-value-fixed stat-value-num" id="stat-total-connected">0</span>
        </div>
        <div class="stat-widget stat-widget-clickable" id="stat-widget-ping" role="button" tabindex="0" title="Click to sort table by Avg Client RTT (lowest first)">
          <span class="stat-label">Avg RTT (client-reported, ms):</span>
          <span class="stat-value stat-value-fixed stat-value-ping" id="stat-average-ping">—</span>
        </div>
        <div class="stat-widget stat-widget-server-time" id="stat-widget-server-time">
          <span class="stat-label">Server Time:</span>
          <span class="stat-value stat-value-fixed stat-value-time" id="server-time-unix">—</span>
        </div>
      </div>
      </div>
      <div class="devices-table-section">
        <div class="devices-controls" id="devices-controls">
          <span class="devices-controls-sep">|</span>
          <div class="column-chooser">
            <button type="button" id="column-chooser-btn">Columns</button>
            <div id="column-chooser-list" class="column-chooser-list" hidden></div>
          </div>
        </div>
        <div id="devices-table" class="devices-table"></div>
      </div>
    </div>`;

  table = new Tabulator("#devices-table", {
    layout: "fitColumns",
    columns: columnDefs,
    columnDefaults: {
      headerFilter: false,
    },
  });

  document.getElementById("devices-drop-disconnected")?.addEventListener("click", () => showResetConfirmModal(() => doReset()));

  const chooserBtn = document.getElementById("column-chooser-btn");
  const chooserList = document.getElementById("column-chooser-list");
  if (chooserBtn && chooserList && table) {
    chooserList.innerHTML = columnDefs
      .map(
        (def, i) => {
          const title = def.title ?? def.field ?? `Column ${i + 1}`;
          return `<label class="column-chooser-label"><input type="checkbox" data-col-index="${i}" checked /> ${title}</label>`;
        }
      )
      .join("");
    chooserBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      chooserList.hidden = !chooserList.hidden;
    });
    chooserList.addEventListener("click", (e) => e.stopPropagation());
    chooserList.querySelectorAll("input[data-col-index]").forEach((input) => {
      input.addEventListener("change", () => {
        const idx = parseInt((input as HTMLInputElement).dataset.colIndex ?? "0", 10);
        const col = table?.getColumns()[idx];
        if (col) col[(input as HTMLInputElement).checked ? "show" : "hide"]();
      });
    });
  }

  document.getElementById("stat-widget-total")?.addEventListener("click", applyConnectedFilter);
  document.getElementById("stat-widget-total")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      applyConnectedFilter();
    }
  });
  document.getElementById("stat-widget-ping")?.addEventListener("click", sortByPing);
  document.getElementById("stat-widget-ping")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      sortByPing();
    }
  });

  function closeColumnChooser(): void {
    const colList = document.getElementById("column-chooser-list");
    if (colList) colList.hidden = true;
  }
  document.addEventListener("click", () => closeColumnChooser());

  statsRefreshEveryApi = createRefreshEvery({
    name: "Connected_Devices_List-StatsWidgets",
    defaultMs: DEFAULT_REFRESH_MS,
    infoTooltip: "These stats require server resources to compute. Refresh only as often as you need.",
    responseTimeoutMs: DEFAULT_RESPONSE_TIMEOUT_MS,
    onManualRefresh: refreshStats,
    onIntervalChange(ms) {
      if (statsRefreshTimer) clearInterval(statsRefreshTimer);
      statsRefreshTimer = null;
      if (ms > 0) statsRefreshTimer = setInterval(refreshStats, ms);
    },
  });
  const statsControlsEl = document.getElementById("devices-stats-controls");
  if (statsControlsEl) statsControlsEl.appendChild(statsRefreshEveryApi.root);

  refreshEveryApi = createRefreshEvery({
    name: "Connected_Devices_List-DevicesTable",
    defaultMs: DEFAULT_REFRESH_MS,
    infoTooltip: "Pulling this table from the server often can consume server resources.",
    responseTimeoutMs: DEFAULT_RESPONSE_TIMEOUT_MS,
    onManualRefresh: refresh,
    onIntervalChange(ms) {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = null;
      if (ms > 0) refreshTimer = setInterval(refresh, ms);
    },
  });
  const controlsEl = document.getElementById("devices-controls");
  if (controlsEl) controlsEl.insertBefore(refreshEveryApi.root, controlsEl.firstChild);

  const serverTimeWidget = document.getElementById("stat-widget-server-time");
  if (serverTimeWidget) {
    const serverTimeInfo = createInfoBubble({
      tooltipText: "The value updates in the UI every frame but is only re-synced with the server on each refresh.",
      ariaLabel: "Info about server time",
    });
    serverTimeWidget.appendChild(serverTimeInfo);
  }

  refreshStats();
  refresh();
  const statsMs = statsRefreshEveryApi.getIntervalMs();
  const devicesMs = refreshEveryApi.getIntervalMs();
  if (statsMs > 0) statsRefreshTimer = setInterval(refreshStats, statsMs);
  if (devicesMs > 0) refreshTimer = setInterval(refresh, devicesMs);
  serverTimeRafId = requestAnimationFrame(updateServerTimeDisplay);
}
