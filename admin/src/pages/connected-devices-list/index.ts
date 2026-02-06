import { TabulatorFull as Tabulator } from "tabulator-tables";
import "tabulator-tables/dist/css/tabulator_midnight.min.css"; // dark theme
import resetIcon from "../../icons/reset.svg?raw";
import { createRefreshEvery, DEFAULT_RESPONSE_TIMEOUT_MS } from "../../components/refresh-every";
import { createInfoBubble } from "../../components/info-bubble";
import { createActionsDropdown } from "../../components/actions-dropdown";

const DEFAULT_REFRESH_MS = 2000;

interface Stats {
  total_connected: number;
  averagePingMs: number | null;
}

interface DeviceRow {
  deviceId: string;
  connectionStatus: string;
  firstConnectedAt: number;
  averagePingMs: number | null;
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
    { title: "Device ID", field: "deviceId", sorter: "string" },
    { title: "Connection Status", field: "connectionStatus", sorter: "string" },
    { title: "First Connected At", field: "firstConnectedAtFormatted", sorter: "string" },
    { title: "Average Ping (ms)", field: "averagePingMs", sorter: "number" },
    { title: "Time since last contact (ms)", field: "timeSinceLastContactMs", sorter: "number" },
    { title: "Disconnect Events", field: "disconnectEvents", sorter: "number" },
    { title: "Estimated Uptime", field: "estimatedUptimeFormatted", sorter: "number", sorterParams: { field: "estimatedUptimeMs" } },
  ];

  const actionsDropdown = createActionsDropdown({
    dropdownId: "devices-actions-dropdown-list",
    items: [
      { id: "drop-disconnected", label: "Drop Disconnected Devices", icon: resetIcon, danger: true },
    ],
  });
  container.innerHTML = `
    <div class="devices-list-page">
      <div class="devices-toolbar" id="devices-toolbar-actions"></div>
      <div class="devices-stats-group">
      <div class="devices-stats-controls" id="devices-stats-controls"></div>
      <div class="devices-stats">
        <div class="stat-widget stat-widget-clickable" id="stat-widget-total" role="button" tabindex="0" title="Click to filter table to connected only">
          <span class="stat-label">Total number of connected clients:</span>
          <span class="stat-value stat-value-fixed stat-value-num" id="stat-total-connected">0</span>
        </div>
        <div class="stat-widget stat-widget-clickable" id="stat-widget-ping" role="button" tabindex="0" title="Click to sort table by ping (lowest first)">
          <span class="stat-label">Average ping time of connected clients:</span>
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

  const toolbarActions = document.getElementById("devices-toolbar-actions");
  if (toolbarActions) toolbarActions.appendChild(actionsDropdown.root);
  actionsDropdown.onAction("drop-disconnected", () => showResetConfirmModal(() => doReset()));

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
