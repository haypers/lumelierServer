import { Tabulator } from "tabulator-tables";
import "tabulator-tables/dist/css/tabulator_midnight.min.css"; // dark theme
import resetIcon from "../../icons/reset.svg?raw";

const REFRESH_STORAGE_KEY = "lumelier_admin_devices_refresh_interval_ms";
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
  stats: Stats;
  devices: DeviceRow[];
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let table: Tabulator | null = null;
let connectedFilterActive = false;
let lastStats: Stats | null = null;

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

function getRefreshIntervalMs(): number {
  const s = localStorage.getItem(REFRESH_STORAGE_KEY);
  if (s == null) return DEFAULT_REFRESH_MS;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : DEFAULT_REFRESH_MS;
}

function updateStatsEls(stats: Stats): void {
  const totalEl = document.getElementById("stat-total-connected");
  const pingEl = document.getElementById("stat-average-ping");
  const totalWrap = document.getElementById("stat-widget-total");
  const pingWrap = document.getElementById("stat-widget-ping");
  const totalChanged = lastStats == null || lastStats.total_connected !== stats.total_connected;
  const pingChanged =
    lastStats == null ||
    (lastStats.averagePingMs ?? null) !== (stats.averagePingMs ?? null);
  lastStats = stats;

  if (totalEl) {
    totalEl.textContent = String(stats.total_connected);
    if (totalChanged && totalWrap) {
      totalWrap.classList.add("stat-updated");
      setTimeout(() => totalWrap.classList.remove("stat-updated"), 300);
    }
  }
  if (pingEl) {
    pingEl.textContent = stats.averagePingMs != null ? `${Math.round(stats.averagePingMs)} ms` : "—";
    if (pingChanged && pingWrap) {
      pingWrap.classList.add("stat-updated");
      setTimeout(() => pingWrap.classList.remove("stat-updated"), 300);
    }
  }
}

function applyConnectedFilter(): void {
  if (!table) return;
  connectedFilterActive = !connectedFilterActive;
  if (connectedFilterActive) {
    table.setFilter("connectionStatus", "like", "connected");
  } else {
    table.clearFilter();
  }
  const wrap = document.getElementById("stat-widget-total");
  wrap?.classList.toggle("stat-active", connectedFilterActive);
}

function sortByPing(): void {
  if (!table) return;
  table.setSort([ { column: "averagePingMs", dir: "asc" } ]);
  const wrap = document.getElementById("stat-widget-ping");
  wrap?.classList.add("stat-active");
  setTimeout(() => wrap?.classList.remove("stat-active"), 800);
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

async function refresh(): Promise<void> {
  try {
    const data = await fetchDevices();
    updateStatsEls(data.stats);
    updateTable(data.devices);
  } catch (e) {
    console.error("Failed to refresh devices", e);
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
  if (table) {
    table.destroy();
    table = null;
  }

  const intervalMs = getRefreshIntervalMs();
  const intervalOptions = [
    { value: 1000, label: "1s" },
    { value: 2000, label: "2s" },
    { value: 5000, label: "5s" },
    { value: 10000, label: "10s" },
  ];

  const columnDefs = [
    { title: "Device ID", field: "deviceId", sorter: "string", headerFilter: "input" },
    { title: "Connection Status", field: "connectionStatus", sorter: "string", headerFilter: "input" },
    { title: "First Connected At", field: "firstConnectedAtFormatted", sorter: "string", headerFilter: "input" },
    { title: "Average Ping (ms)", field: "averagePingMs", sorter: "number", headerFilter: "number" },
    { title: "Time since last contact (ms)", field: "timeSinceLastContactMs", sorter: "number", headerFilter: "number" },
    { title: "Disconnect Events", field: "disconnectEvents", sorter: "number", headerFilter: "number" },
    { title: "Estimated Uptime", field: "estimatedUptimeFormatted", sorter: "number", sorterParams: { field: "estimatedUptimeMs" }, headerFilter: "input" },
  ];

  container.innerHTML = `
    <div class="devices-list-page">
      <div class="devices-toolbar">
        <button type="button" class="btn-reset" id="btn-reset" title="Remove all disconnected devices">${resetIcon}<span>Reset connections</span></button>
      </div>
      <div class="devices-stats">
        <div class="stat-widget stat-widget-clickable" id="stat-widget-total" role="button" tabindex="0" title="Click to filter table to connected only">
          <span class="stat-label">Total number of connected clients:</span>
          <span class="stat-value" id="stat-total-connected">0</span>
        </div>
        <div class="stat-widget stat-widget-clickable" id="stat-widget-ping" role="button" tabindex="0" title="Click to sort table by ping (lowest first)">
          <span class="stat-label">Average ping time of connected clients:</span>
          <span class="stat-value" id="stat-average-ping">—</span>
        </div>
      </div>
      <div class="devices-controls">
        <label>Refresh every:
          <select id="refresh-interval">
            ${intervalOptions.map((o) => `<option value="${o.value}" ${o.value === intervalMs ? "selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </label>
        <span class="devices-controls-sep">|</span>
        <div class="column-chooser">
          <button type="button" id="column-chooser-btn">Columns</button>
          <div id="column-chooser-list" class="column-chooser-list" hidden></div>
        </div>
      </div>
      <div id="devices-table" class="devices-table"></div>
    </div>`;

  table = new Tabulator("#devices-table", {
    layout: "fitColumns",
    columns: columnDefs,
    columnDefaults: {
      headerFilter: true,
    },
  });

  const chooserBtn = document.getElementById("column-chooser-btn");
  const chooserList = document.getElementById("column-chooser-list");
  if (chooserBtn && chooserList && table) {
    chooserList.innerHTML = columnDefs
      .map(
        (col, i) =>
          `<label><input type="checkbox" data-col-index="${i}" checked /> ${col.title}</label>`
      )
      .join("");
    chooserList.hidden = true;
    chooserBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      chooserList.hidden = !chooserList.hidden;
    });
    document.addEventListener("click", () => {
      const list = document.getElementById("column-chooser-list");
      if (list) list.hidden = true;
    });
    chooserList.addEventListener("click", (e) => e.stopPropagation());
    chooserList.querySelectorAll("input[data-col-index]").forEach((input) => {
      input.addEventListener("change", () => {
        const idx = parseInt((input as HTMLInputElement).dataset.colIndex ?? "0", 10);
        const col = table?.getColumns()[idx];
        if (col) (col as { show: () => void; hide: () => void })[(input as HTMLInputElement).checked ? "show" : "hide"]();
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

  document.getElementById("btn-reset")?.addEventListener("click", () => {
    showResetConfirmModal(() => doReset());
  });

  document.getElementById("refresh-interval")?.addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value;
    const ms = parseInt(val, 10);
    if (Number.isFinite(ms)) {
      localStorage.setItem(REFRESH_STORAGE_KEY, String(ms));
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(refresh, ms);
    }
  });

  refresh();
  refreshTimer = setInterval(refresh, intervalMs);
}
