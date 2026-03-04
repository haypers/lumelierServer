import { TabulatorFull as Tabulator } from "tabulator-tables";
import "tabulator-tables/dist/css/tabulator_midnight.min.css"; // dark theme
import "./styles.css";
import downloadIcon from "../../icons/download.svg?raw";
import resetIcon from "../../icons/reset.svg?raw";
import { createRefreshEvery, DEFAULT_RESPONSE_TIMEOUT_MS } from "../../components/refresh-every";
import { createInfoBubble } from "../../components/info-bubble";

const DEFAULT_REFRESH_MS = 2000;

const PAGE_SIZE_STORAGE_KEY = "Connected_Devices_List-PageSize";
const DEFAULT_PAGE_SIZE = 10;
/** Tabulator column field -> API sortField */
const SORT_FIELD_MAP: Record<string, string> = {
  deviceId: "deviceId",
  connectionStatus: "connectionStatus",
  firstConnectedAtFormatted: "firstConnectedAt",
  averagePingMs: "averagePingMs",
  lastClientRttMs: "lastClientRttMs",
  averageServerProcessingMs: "averageServerProcessingMs",
  lastServerProcessingMs: "lastServerProcessingMs",
  timeSinceLastContactMs: "timeSinceLastContactMs",
  disconnectEvents: "disconnectEvents",
  estimatedUptimeFormatted: "estimatedUptimeMs",
  estimatedUptimeMs: "estimatedUptimeMs",
  geoLat: "geoLat",
  geoLon: "geoLon",
  geoAccuracy: "geoAccuracy",
  geoAlt: "geoAlt",
  geoAltAccuracy: "geoAltAccuracy",
};

/** Tooltips for column headers (same order as columnDefs). */
const COLUMN_HEADER_TOOLTIPS = [
  "Stable identifier for this device. Sent by the client in the X-Device-ID header once it has received one from the server (e.g. on first connection).",
  "Whether the server considers the device connected (contacted within the last 20 s) and if the client has returned the device ID handshake.",
  "Server time (Unix ms) when this device was first seen. Shown in local time.",
  "Round-trip time reported by the client (average of last few polls). Measured by the client from send of GET /api/poll to receipt of response, sent on the next poll as X-Ping-Ms.",
  "Most recent round-trip time reported by the client for the previous poll. Same measurement as Avg but not averaged.",
  "Average server-side processing time (ms) for /api/poll for this device: serverTimeAtSend - serverTimeAtRecv (average of recent samples). Useful for spotting server load.",
  "Most recent server-side processing time (ms) for /api/poll for this device: serverTimeAtSend - serverTimeAtRecv.",
  "Milliseconds since the server last received a poll request from this device.",
  "Number of times this device has gone silent (no poll within 20 s) and then contacted again. Increments once per disconnect.",
  "Time from first contact to now (if connected) or to last contact (if disconnected).",
  "Latitude (degrees) from client when the show requests GPS. Sent in X-Geo-Lat.",
  "Longitude (degrees) from client when the show requests GPS. Sent in X-Geo-Lon.",
  "Horizontal accuracy (meters) of the position. Sent in X-Geo-Accuracy.",
  "Altitude (meters) if available. Sent in X-Geo-Alt.",
  "Altitude accuracy (meters) if available. Sent in X-Geo-Alt-Accuracy.",
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
  averageServerProcessingMs?: number | null;
  lastServerProcessingMs?: number | null;
  disconnectEvents: number;
  estimatedUptimeMs: number;
  timeSinceLastContactMs: number;
  geoLat?: number | null;
  geoLon?: number | null;
  geoAccuracy?: number | null;
  geoAlt?: number | null;
  geoAltAccuracy?: number | null;
}

interface ConnectedDevicesFullResponse {
  serverTimeMs: number;
  stats: Stats;
  devices: DeviceRow[];
}

interface StatsResponse {
  serverTimeMs: number;
  stats: Stats;
}

interface PageIdsResponse {
  serverTimeMs: number;
  total_count: number;
  page: number;
  pageSize: number;
  ids: string[];
}

interface ByIdsResponse {
  serverTimeMs: number;
  devices: DeviceRow[];
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let statsRefreshTimer: ReturnType<typeof setInterval> | null = null;
let table: Tabulator | null = null;
let connectedFilterActive = false;
/** Current show ID from render(); used for show-scoped API paths. */
let currentShowId: string | null = null;
/** Offset (ms) from client time to server time: serverTimeMs ≈ Date.now() + serverTimeOffsetMs */
let serverTimeOffsetMs = 0;
let serverTimeRafId: number | null = null;

/** Pagination/sort state (used by refresh to build page-ids and by-ids requests). */
let paginationPage = 1;
let paginationPageSize = DEFAULT_PAGE_SIZE;
let paginationTotalCount = 0;
let sortField = "deviceId";
let sortDir: "asc" | "desc" = "asc";
/** When true, updateTable will set this so dataSorted does not trigger a refresh. */
let programmaticSort = false;

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

function getStoredPageSize(): number {
  const s = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
  if (s == null) return DEFAULT_PAGE_SIZE;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 10 ? n : DEFAULT_PAGE_SIZE;
}

async function fetchPageIds(): Promise<PageIdsResponse> {
  const params = new URLSearchParams({
    page: String(paginationPage),
    pageSize: String(paginationPageSize),
    connectedOnly: connectedFilterActive ? "1" : "0",
    sortField,
    sortDir,
  });
  if (!currentShowId) throw new Error("No show selected");
  const res = await fetch(`/api/admin/shows/${currentShowId}/connected-devices/page-ids?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to fetch page-ids: ${res.status}`);
  return res.json() as Promise<PageIdsResponse>;
}

async function fetchRowsByIds(ids: string[]): Promise<ByIdsResponse> {
  if (ids.length === 0) {
    return { serverTimeMs: Date.now(), devices: [] };
  }
  if (!currentShowId) throw new Error("No show selected");
  const res = await fetch(`/api/admin/shows/${currentShowId}/connected-devices/by-ids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to fetch by-ids: ${res.status}`);
  return res.json() as Promise<ByIdsResponse>;
}

async function fetchFullDeviceList(): Promise<DeviceRow[]> {
  if (!currentShowId) throw new Error("No show selected");
  const res = await fetch(`/api/admin/shows/${currentShowId}/connected-devices`, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to fetch devices: ${res.status}`);
  const data = (await res.json()) as ConnectedDevicesFullResponse;
  return data.devices;
}

/** Escape a value for CSV: wrap in quotes if it contains comma, newline, or quote; double internal quotes. */
function escapeCsvField(value: string): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildDevicesCsv(devices: DeviceRow[]): string {
  const headers = [
    "Device ID",
    "Connection Status",
    "First Connected At",
    "Avg Client RTT (ms)",
    "Last Client RTT (ms)",
    "Avg Server Processing (ms)",
    "Last Server Processing (ms)",
    "Time since last contact (ms)",
    "Disconnect Events",
    "Estimated Uptime",
    "Latitude",
    "Longitude",
    "Geo Accuracy (m)",
    "Altitude (m)",
    "Altitude Accuracy (m)",
  ];
  const headerRow = headers.map(escapeCsvField).join(",");
  const rows = devices.map((d) =>
    [
      d.deviceId,
      d.connectionStatus,
      formatTime(d.firstConnectedAt),
      d.averagePingMs != null ? String(d.averagePingMs) : "",
      d.lastClientRttMs != null ? String(d.lastClientRttMs) : "",
      d.averageServerProcessingMs != null ? String(d.averageServerProcessingMs) : "",
      d.lastServerProcessingMs != null ? String(d.lastServerProcessingMs) : "",
      String(d.timeSinceLastContactMs),
      String(d.disconnectEvents),
      formatUptime(d.estimatedUptimeMs),
      d.geoLat != null ? String(d.geoLat) : "",
      d.geoLon != null ? String(d.geoLon) : "",
      d.geoAccuracy != null ? String(d.geoAccuracy) : "",
      d.geoAlt != null ? String(d.geoAlt) : "",
      d.geoAltAccuracy != null ? String(d.geoAltAccuracy) : "",
    ]
      .map(escapeCsvField)
      .join(","),
  );
  return [headerRow, ...rows].join("\r\n");
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportDeviceListCsv(): Promise<void> {
  try {
    const devices = await fetchFullDeviceList();
    const csv = buildDevicesCsv(devices);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadCsv(csv, `connected-devices-${timestamp}.csv`);
  } catch (e) {
    console.error("Export device list failed", e);
  }
}

async function fetchStats(): Promise<StatsResponse> {
  if (!currentShowId) throw new Error("No show selected");
  const res = await fetch(`/api/admin/shows/${currentShowId}/stats`, { credentials: "include" });
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

function getTotalPages(): number {
  if (paginationPageSize === 0) return 1;
  return Math.max(1, Math.ceil(paginationTotalCount / paginationPageSize));
}

function updatePagerUI(): void {
  const infoEl = document.getElementById("devices-pager-info");
  const prevBtn = document.getElementById("devices-pager-prev");
  const nextBtn = document.getElementById("devices-pager-next");
  const pagerWrap = document.getElementById("devices-pager-wrap");
  if (!pagerWrap) return;
  const totalPages = getTotalPages();
  const showPager = paginationPageSize > 0 && paginationTotalCount > 0;
  pagerWrap.hidden = !showPager;
  if (infoEl) {
    infoEl.textContent = `Page ${paginationPage} of ${totalPages}`;
    const start = paginationPageSize === 0 ? 1 : (paginationPage - 1) * paginationPageSize + 1;
    const end =
      paginationPageSize === 0
        ? paginationTotalCount
        : Math.min(paginationPage * paginationPageSize, paginationTotalCount);
    infoEl.title = `Showing ${start}–${end} of ${paginationTotalCount}`;
  }
  if (prevBtn) (prevBtn as HTMLButtonElement).disabled = paginationPage <= 1;
  if (nextBtn) (nextBtn as HTMLButtonElement).disabled = paginationPage >= totalPages;
}

function applyConnectedFilter(): void {
  connectedFilterActive = !connectedFilterActive;
  paginationPage = 1;
  refresh();
}

function sortByPing(): void {
  sortField = "averagePingMs";
  sortDir = "asc";
  paginationPage = 1;
  refresh();
}

/** Order devices to match the given ids (backend may return in arbitrary order). */
function orderRowsByIds(devices: DeviceRow[], ids: string[]): DeviceRow[] {
  const byId = new Map(devices.map((d) => [d.deviceId, d]));
  return ids.map((id) => byId.get(id)).filter((d): d is DeviceRow => d != null);
}

function updateTable(data: DeviceRow[], orderIds?: string[]): void {
  const rows = (orderIds ? orderRowsByIds(data, orderIds) : data).map((d) => ({
    deviceId: d.deviceId,
    connectionStatus: d.connectionStatus,
    firstConnectedAt: d.firstConnectedAt,
    firstConnectedAtFormatted: formatTime(d.firstConnectedAt),
    averagePingMs: d.averagePingMs ?? null,
    lastClientRttMs: d.lastClientRttMs ?? null,
    averageServerProcessingMs: d.averageServerProcessingMs ?? null,
    lastServerProcessingMs: d.lastServerProcessingMs ?? null,
    disconnectEvents: d.disconnectEvents,
    estimatedUptimeMs: d.estimatedUptimeMs,
    estimatedUptimeFormatted: formatUptime(d.estimatedUptimeMs),
    timeSinceLastContactMs: d.timeSinceLastContactMs,
    geoLat: d.geoLat ?? null,
    geoLon: d.geoLon ?? null,
    geoAccuracy: d.geoAccuracy ?? null,
    geoAlt: d.geoAlt ?? null,
    geoAltAccuracy: d.geoAltAccuracy ?? null,
  }));

  const t = table;
  if (!t) return;

  // Avoid page scroll/layout jump by not rebuilding the whole table on each refresh.
  // We update rows in-place keyed by deviceId, and only delete/add as needed.
  programmaticSort = true;
  const tab = t as unknown as {
    blockRedraw?: () => void;
    restoreRedraw?: () => void;
    updateOrAddData?: (rows: unknown[]) => void;
    getRows?: () => { getData: () => unknown; delete: () => void }[];
    getSorters?: () => unknown[];
    setSort: (sorters: unknown[]) => void;
  };
  tab.blockRedraw?.();
  try {
    // Update existing + add new (requires Tabulator `index: "deviceId"`).
    tab.updateOrAddData?.(rows);

    // Delete any rows that are no longer present in the current page.
    const desired = new Set(rows.map((r) => r.deviceId));
    for (const row of tab.getRows?.() ?? []) {
      const d = row.getData() as { deviceId?: string } | undefined;
      const id = d?.deviceId;
      if (id && !desired.has(id)) {
        row.delete();
      }
    }

    // Keep the sort indicator consistent, but don't resort every refresh.
    const sortCol =
      Object.keys(SORT_FIELD_MAP).find((k) => SORT_FIELD_MAP[k] === sortField) ??
      sortField;
    const existing = tab.getSorters?.() ?? [];
    const first = existing[0] as { field?: string; dir?: string } | undefined;
    const existingField = first?.field ?? "";
    const existingDir = (first?.dir === "desc" ? "desc" : "asc") as "asc" | "desc";
    if (existingField !== sortCol || existingDir !== sortDir) {
      t.setSort([{ column: sortCol, dir: sortDir }]);
    }
  } finally {
    tab.restoreRedraw?.();
    // Allow dataSorted handlers to fire normally after this tick.
    setTimeout(() => {
      programmaticSort = false;
    }, 0);
  }
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
    let pageData = await fetchPageIds();
    paginationTotalCount = pageData.total_count;
    let totalPages = getTotalPages();
    if (paginationPage > totalPages && totalPages >= 1) {
      paginationPage = totalPages;
      pageData = await fetchPageIds();
    }
    const ids = pageData.ids;
    const byIdsData = await fetchRowsByIds(ids);
    updateTable(byIdsData.devices, ids);
    updatePagerUI();
    success = true;
  } catch (e) {
    console.error("Failed to refresh devices", e);
  } finally {
    refreshEveryApi?.requestCompleted(success);
  }
}

async function doReset(): Promise<void> {
  if (!currentShowId) return;
  try {
    const res = await fetch(`/api/admin/shows/${currentShowId}/connections/reset`, { method: "POST", credentials: "include" });
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

const CONNECTED_DEVICES_LIST_EMPTY_MESSAGE =
  "Please open or create a show to view the connected devices list.";

const CONNECTED_DEVICES_LIST_NOT_LIVE_MESSAGE =
  "Set this show live to view the List of Connected Client Devices";

const LIVE_STATE_EVENT_NAME = "lumelier-live-state";
let connectedDevicesListContainer: HTMLElement | null = null;
let connectedDevicesLiveStateListener: ((e: Event) => void) | null = null;

function cleanupConnectedDevicesList(): void {
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
  refreshEveryApi = null;
  statsRefreshEveryApi = null;
}

function showConnectedDevicesNotLiveMessage(container: HTMLElement): void {
  container.innerHTML = `
    <div class="show-required-empty-state">
      <p class="show-required-empty-state-message">${CONNECTED_DEVICES_LIST_NOT_LIVE_MESSAGE}</p>
    </div>`;
}

function renderConnectedDevicesListFull(container: HTMLElement): void {
  cleanupConnectedDevicesList();

  paginationPageSize = getStoredPageSize();
  paginationPage = 1;

  const columnDefs = [
    { title: "Device ID", field: "deviceId", sorter: "string", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[0] } },
    { title: "Connection Status", field: "connectionStatus", sorter: "string", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[1] } },
    { title: "First Connected At", field: "firstConnectedAtFormatted", sorter: "string", visible: false, titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[2] } },
    { title: "Avg Client RTT (ms)", field: "averagePingMs", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[3] } },
    { title: "Last Client RTT (ms)", field: "lastClientRttMs", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[4] } },
    { title: "Avg Server Processing (ms)", field: "averageServerProcessingMs", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[5] } },
    { title: "Last Server Processing (ms)", field: "lastServerProcessingMs", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[6] } },
    { title: "Time since last contact (ms)", field: "timeSinceLastContactMs", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[7] } },
    { title: "Disconnect Events", field: "disconnectEvents", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[8] } },
    { title: "Estimated Uptime", field: "estimatedUptimeFormatted", sorter: "number", visible: false, sorterParams: { field: "estimatedUptimeMs" }, titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[9] } },
    { title: "Latitude", field: "geoLat", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[10] } },
    { title: "Longitude", field: "geoLon", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[11] } },
    { title: "Geo Accuracy (m)", field: "geoAccuracy", sorter: "number", titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[12] } },
    { title: "Altitude (m)", field: "geoAlt", sorter: "number", visible: false, titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[13] } },
    { title: "Altitude Accuracy (m)", field: "geoAltAccuracy", sorter: "number", visible: false, titleFormatter: columnTitleWithInfoBubble, titleFormatterParams: { tooltipText: COLUMN_HEADER_TOOLTIPS[14] } },
  ];

  container.innerHTML = `
    <div class="devices-list-page">
      <div class="devices-toolbar">
        <button type="button" class="devices-toolbar-btn" id="devices-drop-disconnected">${resetIcon}<span>Drop Disconnected Devices</span><span class="devices-toolbar-btn-info" id="devices-drop-disconnected-info"></span></button>
        <button type="button" class="devices-toolbar-btn" id="devices-export-list">${downloadIcon}<span>Export Device List</span><span class="devices-toolbar-btn-info" id="devices-export-list-info"></span></button>
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
          <span class="devices-pager-wrap" id="devices-pager-wrap">
            <button type="button" id="devices-pager-prev" class="devices-pager-btn">Previous</button>
            <span id="devices-pager-info" class="devices-pager-info">Page 1 of 1</span>
            <button type="button" id="devices-pager-next" class="devices-pager-btn">Next</button>
          </span>
          <span class="devices-controls-sep">|</span>
          <div class="column-chooser">
            <button type="button" id="column-chooser-btn">Hide Columns</button>
            <div id="column-chooser-list" class="column-chooser-list" hidden></div>
          </div>
          <span class="devices-controls-sep">|</span>
          <label class="devices-pagination-label" for="devices-page-size">Rows Per Page:</label>
          <select id="devices-page-size" class="devices-page-size-select" aria-label="Rows per page">
            <option value="10" ${paginationPageSize === 10 ? "selected" : ""}>10</option>
            <option value="20" ${paginationPageSize === 20 ? "selected" : ""}>20</option>
            <option value="50" ${paginationPageSize === 50 ? "selected" : ""}>50</option>
          </select>
        </div>
        <div id="devices-table" class="devices-table"></div>
      </div>
    </div>`;

  table = new Tabulator("#devices-table", {
    layout: "fitColumns",
    index: "deviceId",
    columns: columnDefs,
    columnDefaults: {
      headerFilter: false,
    },
  });

  table.on("dataSorted", () => {
    if (programmaticSort) return;
    const sorters = table?.getSorters() ?? [];
    const first = sorters[0] as { field?: string; dir?: string; column?: { getField?: () => string } } | undefined;
    if (first) {
      const field =
        first.field ??
        (typeof first.column?.getField === "function" ? first.column.getField() : undefined) ??
        "";
      const apiField = (field && SORT_FIELD_MAP[field]) ?? field;
      const dir = (first.dir === "asc" ? "asc" : "desc") as "asc" | "desc";
      if (apiField && (apiField !== sortField || dir !== sortDir)) {
        sortField = apiField;
        sortDir = dir;
        paginationPage = 1;
        refresh();
      }
    }
  });

  document.getElementById("devices-drop-disconnected")?.addEventListener("click", () => showResetConfirmModal(() => doReset()));

  const dropDisconnectedInfoEl = document.getElementById("devices-drop-disconnected-info");
  if (dropDisconnectedInfoEl) {
    dropDisconnectedInfoEl.appendChild(
      createInfoBubble({
        tooltipText:
          "The server holds onto a log of connection stats for each devices to better synconize the clocks. To release resources, this opperation drops those logs for disconnected devices.",
        ariaLabel: "Info about Drop Disconnected Devices",
      }),
    );
  }

  document.getElementById("devices-export-list")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".devices-toolbar-btn-info")) return;
    exportDeviceListCsv();
  });

  const exportListInfoEl = document.getElementById("devices-export-list-info");
  if (exportListInfoEl) {
    exportListInfoEl.appendChild(
      createInfoBubble({
        tooltipText:
          "This opperation can add extra strain to the server. It's not reccommended durring a preformance. It will export all columns for all devices. This data is useful for debugging.",
        ariaLabel: "Info about Export Device List",
      }),
    );
  }

  const pageSizeSelect = document.getElementById("devices-page-size");
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      const val = parseInt((pageSizeSelect as HTMLSelectElement).value, 10);
      paginationPageSize = Number.isFinite(val) ? val : DEFAULT_PAGE_SIZE;
      localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(paginationPageSize));
      paginationPage = 1;
      refresh();
    });
  }
  document.getElementById("devices-pager-prev")?.addEventListener("click", () => {
    if (paginationPage > 1) {
      paginationPage -= 1;
      refresh();
    }
  });
  document.getElementById("devices-pager-next")?.addEventListener("click", () => {
    if (paginationPage < getTotalPages()) {
      paginationPage += 1;
      refresh();
    }
  });

  const chooserBtn = document.getElementById("column-chooser-btn");
  const chooserList = document.getElementById("column-chooser-list");
  if (chooserBtn && chooserList && table) {
    chooserList.innerHTML = columnDefs
      .map(
        (def, i) => {
          const title = def.title ?? def.field ?? `Column ${i + 1}`;
          const checked = def.visible !== false ? "checked" : "";
          return `<label class="column-chooser-label"><input type="checkbox" data-col-index="${i}" ${checked} /> ${title}</label>`;
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

export function render(container: HTMLElement, showId: string | null): void {
  currentShowId = showId;
  if (showId === null) {
    connectedDevicesListContainer = null;
    if (connectedDevicesLiveStateListener) {
      window.removeEventListener(LIVE_STATE_EVENT_NAME, connectedDevicesLiveStateListener);
      connectedDevicesLiveStateListener = null;
    }
    cleanupConnectedDevicesList();
    container.innerHTML = `
      <div class="show-required-empty-state">
        <p class="show-required-empty-state-message">${CONNECTED_DEVICES_LIST_EMPTY_MESSAGE}</p>
      </div>`;
    return;
  }
  connectedDevicesListContainer = container;
  if (connectedDevicesLiveStateListener) {
    window.removeEventListener(LIVE_STATE_EVENT_NAME, connectedDevicesLiveStateListener);
  }
  connectedDevicesLiveStateListener = (e: Event) => {
    const ev = e as CustomEvent<{ showId: string; live: boolean }>;
    if (ev.detail?.showId !== currentShowId || !connectedDevicesListContainer) return;
    cleanupConnectedDevicesList();
    if (ev.detail.live) {
      renderConnectedDevicesListFull(connectedDevicesListContainer);
    } else {
      showConnectedDevicesNotLiveMessage(connectedDevicesListContainer);
    }
  };
  window.addEventListener(LIVE_STATE_EVENT_NAME, connectedDevicesLiveStateListener);

  fetch(`/api/admin/show-workspaces/${showId}/live-join-url`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : { live: false }))
    .then((data: { live?: boolean }) => {
      if (currentShowId !== showId) return;
      if (!data.live) {
        showConnectedDevicesNotLiveMessage(container);
        return;
      }
      renderConnectedDevicesListFull(container);
    })
    .catch(() => {
      if (currentShowId !== showId) return;
      showConnectedDevicesNotLiveMessage(container);
    });
}
