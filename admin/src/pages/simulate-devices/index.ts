import "./styles.css";
import openIcon from "../../icons/open.svg?raw";
import trashIcon from "../../icons/trash.svg?raw";
import noSignalIcon from "../../icons/noSignal.svg?raw";
import { createRefreshEvery, DEFAULT_RESPONSE_TIMEOUT_MS } from "../../components/refresh-every";
import { createInfoBubble } from "../../components/info-bubble";
import { showCreateClientsModal } from "./create-clients-modal";
import { showCloneClientModal } from "./clone-client-modal";
import type {
  SimulatedClientDistKey,
  DistributionCurve,
  SimulatedClientWithSampleHistory,
  ClientSummaryForGrid,
  ClientSummarySummary,
} from "./types";
import {
  getClients,
  getClient,
  getSummaries,
  postClients,
  patchClient,
  deleteClient as apiDeleteClient,
  deleteAllClients,
  postSample,
} from "./api";
import { updateClientGrid } from "./client-grid";
import {
  renderDetailsPane,
  updateDetailsPaneChartsSamplePoints,
  updateDetailsPaneReadOnly,
  type DistributionChartSelection,
} from "./details-pane";

const SQUARE_SIZE_MIN = 12;
const SQUARE_SIZE_MAX = 48;
const SQUARE_SIZE_DEFAULT = 24;
const GRID_GAP_PX = 4;

let clients: ClientSummaryForGrid[] = [];
let selectedId: string | null = null;
/** Full client + sampleHistory from GET /clients/:id; used for details pane. */
let selectedClientFull: SimulatedClientWithSampleHistory | null = null;
let selectedAnchor: DistributionChartSelection | null = null;
let gridContainer: HTMLElement | null = null;
let detailsContainer: HTMLElement | null = null;
let gridRefreshApi: ReturnType<typeof createRefreshEvery> | null = null;
let detailsRefreshApi: ReturnType<typeof createRefreshEvery> | null = null;
let gridRefreshTimer: ReturnType<typeof setInterval> | null = null;
let detailsRefreshTimer: ReturnType<typeof setInterval> | null = null;
let detailsRefreshIntervalMs = 0;
let clockRafId: number | null = null;
let secondaryToolbar: HTMLElement | null = null;
let btnDelete: HTMLElement | null = null;
let btnClone: HTMLElement | null = null;

let squareSizePx = SQUARE_SIZE_DEFAULT;
let showLagOverlay = true;
let pageIndex = 0;
let resizeObserver: ResizeObserver | null = null;
let lastContainerWidth = 0;
let lastContainerHeight = 0;
let scheduledGridUpdate = false;
/** Only re-render details pane when selection or full client data actually changed (avoids DOM rebuild on grid refresh). */
let lastRenderedDetailsSelectedId: string | null | undefined = undefined;
let lastRenderedDetailsClientFull: SimulatedClientWithSampleHistory | null | undefined = undefined;
let paginationInfoEl: HTMLElement | null = null;
let pagePrevBtn: HTMLButtonElement | null = null;
let pageNextBtn: HTMLButtonElement | null = null;
/** Prevents overlapping grid stats requests so the RefreshEvery disconnect timeout is not cleared by a new request. */
let gridRefreshStatsInFlight = false;
/** If a full refresh is requested during an in-flight refresh, run it after the in-flight completes. */
let gridRefreshFullPending = false;
/** Prevent auto-selecting clients while we're intentionally clearing the list (e.g. delete-all). */
let suppressAutoSelect = false;
/** Current show for simulated devices API; set in render(container, showId) when showId is non-null. */
let currentShowId: string | null = null;

function computeGridLayout(
  containerWidth: number,
  containerHeight: number,
  squareSizePxVal: number,
  gapPx: number,
  paddingPx: number,
  totalClients: number
): { squaresPerRow: number; rowsVisible: number; pageSize: number; totalPages: number } {
  const innerW = Math.max(0, containerWidth - paddingPx * 2);
  const innerH = Math.max(0, containerHeight - paddingPx * 2);
  const cellSize = squareSizePxVal + gapPx;
  const squaresPerRow = Math.max(1, Math.floor((innerW + gapPx) / cellSize));
  const rowsVisible = Math.max(1, Math.floor((innerH + gapPx) / cellSize));
  const pageSize = squaresPerRow * rowsVisible;
  const totalPages = Math.max(1, Math.ceil(totalClients / pageSize));
  return { squaresPerRow, rowsVisible, pageSize, totalPages };
}

function scheduleGridUpdate(): void {
  if (scheduledGridUpdate) return;
  scheduledGridUpdate = true;
  requestAnimationFrame(() => {
    scheduledGridUpdate = false;
    if (!gridContainer) return;
    updateGridLayoutAndRender();
  });
}

function observeGridPanel(panel: HTMLElement): void {
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry || !gridContainer) return;
    const { width, height } = entry.contentRect;
    const w = Math.round(width);
    const h = Math.round(height);
    if (w === lastContainerWidth && h === lastContainerHeight) return;
    lastContainerWidth = w;
    lastContainerHeight = h;
    scheduleGridUpdate();
  });
  resizeObserver.observe(panel);
  const rect = panel.getBoundingClientRect();
  lastContainerWidth = Math.round(rect.width);
  lastContainerHeight = Math.round(rect.height);
}

function updatePaginationUI(totalPages: number, currentPageIndex: number): void {
  if (paginationInfoEl) {
    paginationInfoEl.textContent = `Page ${currentPageIndex + 1} of ${totalPages}`;
  }
  if (pagePrevBtn) {
    pagePrevBtn.disabled = currentPageIndex === 0;
  }
  if (pageNextBtn) {
    pageNextBtn.disabled = currentPageIndex >= totalPages - 1 || totalPages <= 1;
  }
}

const FALLBACK_GRID_WIDTH = 400;
const FALLBACK_GRID_HEIGHT = 300;

function getGridAvailableSize(): { w: number; h: number } {
  if (gridContainer) {
    const w = Math.max(0, Math.round(gridContainer.clientWidth));
    const h = Math.max(0, Math.round(gridContainer.clientHeight));
    if (w > 0 && h > 0) return { w, h };
  }
  const panel = document.getElementById("simulate-devices-grid-panel");
  if (!panel) return { w: FALLBACK_GRID_WIDTH, h: FALLBACK_GRID_HEIGHT };
  const style = getComputedStyle(panel);
  const padT = parseFloat(style.paddingTop) || 0;
  const padB = parseFloat(style.paddingBottom) || 0;
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const toolbarEl = panel.querySelector<HTMLElement>(".simulate-devices-toolbar");
  const toolbarSecondaryEl = panel.querySelector<HTMLElement>(".simulate-devices-toolbar-secondary");
  const paginationEl = document.getElementById("simulate-devices-grid-pagination");
  const toolbarHeight = toolbarEl?.offsetHeight ?? 0;
  const toolbarSecondaryHeight = toolbarSecondaryEl?.offsetHeight ?? 0;
  const paginationHeight = paginationEl ? paginationEl.offsetHeight : 0;
  const w = Math.max(0, panel.clientWidth - padL - padR);
  const h = Math.max(
    0,
    panel.clientHeight - padT - padB - toolbarHeight - toolbarSecondaryHeight - paginationHeight
  );
  if (w <= 0 || h <= 0) return { w: FALLBACK_GRID_WIDTH, h: FALLBACK_GRID_HEIGHT };
  return { w, h };
}

/**
 * TODO: Add a "Sort by" feature later (e.g. dropdown: Device ID, Track ID, Effective RTT, Time Estimate Offset).
 * Display order is currently the order returned by the simulated server (getClients). Sorting could be
 * client-side or server-side with a paged/sorted API.
 */

/**
 * Single source of truth for "what is the current visible page". Uses the same snapped
 * height as the grid render so fetch and display never disagree (e.g. after resize).
 * Updates pageIndex (clamps to valid range). Call whenever layout might have changed.
 */
function getVisiblePageLayout(): {
  layout: ReturnType<typeof computeGridLayout>;
  start: number;
  pageSize: number;
  totalPages: number;
  displayClients: ClientSummaryForGrid[];
} {
  const displayClients = clients;
  const { w, h } = getGridAvailableSize();
  const cellSize = squareSizePx + GRID_GAP_PX;
  const snappedH = Math.max(cellSize, Math.floor(h / cellSize) * cellSize);
  const layout = computeGridLayout(w, snappedH, squareSizePx, GRID_GAP_PX, 0, displayClients.length);
  const { pageSize, totalPages } = layout;
  pageIndex = Math.min(pageIndex, Math.max(0, totalPages - 1));
  const start = pageIndex * pageSize;
  return { layout, start, pageSize, totalPages, displayClients };
}

function updateGridLayoutAndRender(): void {
  if (!gridContainer) return;
  const visible = getVisiblePageLayout();
  const { start, pageSize, totalPages, displayClients } = visible;
  const pageClients = displayClients.slice(start, start + pageSize);
  const showIdForGrid = currentShowId;
  updateClientGrid(gridContainer, pageClients, selectedId, (id) => {
    selectedId = id;
    selectedClientFull = null;
    selectedAnchor = null;
    refresh();
    if (showIdForGrid)
      getClient(showIdForGrid, id)
        .then((full) => {
          if (selectedId === id) {
            selectedClientFull = full;
            refresh();
          }
        })
        .catch(() => {
          if (selectedId === id) refresh();
        });
  }, squareSizePx, showLagOverlay);
  updatePaginationUI(totalPages, pageIndex);
}

function getSelected(): ClientSummaryForGrid | null {
  if (selectedId == null) return null;
  return clients.find((c) => c.id === selectedId) ?? null;
}

const CLOCK_ERROR_AVE_TOOLTIP =
  "The average difference between the client's estimated server clock and the actual server clock. This should approach 0 to indicate an accurate simulation.";
const CLOCK_ERROR_AVE_ABS_TOOLTIP =
  "The average of the absolute values of the difference between the client's estimated server clock and the actual server clock. The lower this value, the more in sync the devices are.";

function createClockErrorWidget(): HTMLElement {
  const root = document.createElement("div");
  root.className = "simulate-devices-clock-error-widget";
  const row1 = document.createElement("div");
  row1.className = "simulate-devices-clock-error-row";
  const label1 = document.createElement("span");
  label1.className = "simulate-devices-clock-error-label";
  label1.append(
    createInfoBubble({ tooltipText: CLOCK_ERROR_AVE_TOOLTIP, ariaLabel: "Info about average clock error" }),
    document.createTextNode(" Ave Clock Error:")
  );
  const value1 = document.createElement("span");
  value1.id = "simulate-devices-ave-clock-error-value";
  value1.className = "simulate-devices-clock-error-value";
  value1.textContent = "—";
  row1.append(label1, value1);

  const row2 = document.createElement("div");
  row2.className = "simulate-devices-clock-error-row";
  const label2 = document.createElement("span");
  label2.className = "simulate-devices-clock-error-label";
  label2.append(
    createInfoBubble({ tooltipText: CLOCK_ERROR_AVE_ABS_TOOLTIP, ariaLabel: "Info about average absolute clock error" }),
    document.createTextNode(" Ave Absolute Clock Error:")
  );
  const value2 = document.createElement("span");
  value2.id = "simulate-devices-ave-abs-clock-error-value";
  value2.className = "simulate-devices-clock-error-value";
  value2.textContent = "—";
  row2.append(label2, value2);

  const left = document.createElement("div");
  left.className = "simulate-devices-clock-error-left";
  left.append(row1, row2);
  root.appendChild(left);
  return root;
}

function updateClockErrorWidget(aveErrorMs: number | null, aveAbsErrorMs: number | null): void {
  const elAve = document.getElementById("simulate-devices-ave-clock-error-value");
  const elAbs = document.getElementById("simulate-devices-ave-abs-clock-error-value");
  if (elAve) elAve.textContent = aveErrorMs != null ? `${aveErrorMs.toFixed(1)} ms` : "—";
  if (elAbs) elAbs.textContent = aveAbsErrorMs != null ? `${aveAbsErrorMs.toFixed(1)} ms` : "—";
}

/** Merge summaries into clients by id. */
function mergeSummariesIntoClients(summaries: ClientSummarySummary[]): void {
  for (const s of summaries) {
    const c = clients.find((x) => x.id === s.id);
    if (c) {
      c.currentDisplayColor = s.currentDisplayColor;
      c.lagEndsInMs = s.lagEndsInMs ?? null;
    }
  }
}

/** Fetch summaries for currently visible page (and selected client if not on page), merge into clients, then refresh. */
async function fetchVisibleSummariesAndRefresh(): Promise<boolean> {
  const visible = getVisiblePageLayout();
  const { start, pageSize, displayClients } = visible;
  const visibleIds = displayClients.slice(start, start + pageSize).map((c) => c.id);
  const includeSelected =
    selectedId != null && !visibleIds.includes(selectedId);
  const idsToFetch: string[] = [...visibleIds];
  if (includeSelected && selectedId != null) idsToFetch.push(selectedId);
  if (idsToFetch.length === 0 || !currentShowId) {
    updateClockErrorWidget(null, null);
    refresh();
    return true;
  }
  try {
    const summaries = await getSummaries(currentShowId, idsToFetch);
    mergeSummariesIntoClients(summaries);
    const onScreenSummaries = summaries.slice(0, visibleIds.length);
    const errors = onScreenSummaries
      .map((s) => s.serverTimeEstimateErrorMs)
      .filter((e): e is number => e != null && Number.isFinite(e));
    if (errors.length > 0) {
      const ave = errors.reduce((a, b) => a + b, 0) / errors.length;
      const aveAbs = errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
      updateClockErrorWidget(ave, aveAbs);
    } else {
      updateClockErrorWidget(null, null);
    }
  } catch {
    // leave existing merged data as-is
    updateClockErrorWidget(null, null);
    refresh();
    return false;
  }
  refresh();
  return true;
}

function getDetailsScrollContainer(): HTMLElement | null {
  return detailsContainer?.parentElement ?? null;
}

function refresh(): void {
  if (!gridContainer || !detailsContainer) return;
  if (!suppressAutoSelect && clients.length > 0 && getSelected() === null) selectedId = clients[0].id;
  const scrollContainer = getDetailsScrollContainer();
  const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
  updateGridLayoutAndRender();
  const client = selectedClientFull;
  const showDetailsLoading = selectedId != null && selectedClientFull == null;
  const detailsRefreshWrapEl = document.getElementById("simulate-devices-details-refresh-wrap");
  if (detailsRefreshWrapEl) {
    detailsRefreshWrapEl.classList.toggle("simulate-devices-details-refresh-wrap--hidden", showDetailsLoading || client == null);
  }
  const detailsNeedRender =
    showDetailsLoading ||
    (client === null && (lastRenderedDetailsSelectedId === undefined || lastRenderedDetailsSelectedId !== null)) ||
    (client !== null &&
      (selectedId !== lastRenderedDetailsSelectedId || selectedClientFull !== lastRenderedDetailsClientFull));

  if (showDetailsLoading) {
    // Leave existing details content in place so scroll is preserved; when getClient resolves we will re-render and restore savedScrollTop.
    lastRenderedDetailsSelectedId = selectedId;
    lastRenderedDetailsClientFull = null;
  } else if (detailsNeedRender) {
    if (client === null) {
      lastRenderedDetailsSelectedId = null;
      lastRenderedDetailsClientFull = null;
    }
    // Hide pane during re-render to avoid visible flicker; restore scroll after layout.
    detailsContainer.style.visibility = "hidden";
    renderDetailsPane(
      detailsContainer,
      client,
      (distKey: SimulatedClientDistKey, curve: DistributionCurve) => {
        if (selectedId == null || !selectedClientFull || !currentShowId) return;
        patchClient(currentShowId, selectedId, { [distKey]: curve }).then(() => {
          selectedClientFull = selectedClientFull
            ? { ...selectedClientFull, [distKey]: curve }
            : null;
          refresh();
        });
      },
      selectedAnchor,
      (sel) => {
        selectedAnchor = sel;
        refresh();
      },
      client ? (distKey) => selectedClientFull?.sampleHistory?.[distKey] ?? [] : undefined,
      client && selectedId && currentShowId
        ? (distKey) => {
            postSample(currentShowId!, selectedId!, distKey)
              .then((point) => {
                if (selectedClientFull?.sampleHistory?.[distKey]) {
                  selectedClientFull.sampleHistory[distKey].push(point);
                  if (selectedClientFull.sampleHistory[distKey].length > 100) {
                    selectedClientFull.sampleHistory[distKey] =
                      selectedClientFull.sampleHistory[distKey].slice(-100);
                  }
                }
                navigator.clipboard.writeText(String(point.x)).catch(() => {});
                refresh();
              })
              .catch(() => refresh());
          }
        : undefined
    );
    lastRenderedDetailsSelectedId = selectedId;
    lastRenderedDetailsClientFull = selectedClientFull;
    const pane = detailsContainer;
    const scrollEl = getDetailsScrollContainer();
    requestAnimationFrame(() => {
      if (!pane) return;
      pane.style.visibility = "";
      if (scrollEl) {
        const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
        scrollEl.scrollTop = Math.min(savedScrollTop, Math.max(0, maxScroll));
      }
    });
  } else {
    const scrollEl = getDetailsScrollContainer();
    if (scrollEl) {
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      scrollEl.scrollTop = Math.min(savedScrollTop, Math.max(0, maxScroll));
    }
  }
  ensureDetailsRefreshTimer();

  if (secondaryToolbar) {
    const hide = selectedId == null;
    secondaryToolbar.hidden = hide;
    secondaryToolbar.style.visibility = hide ? "hidden" : "";
    secondaryToolbar.style.pointerEvents = hide ? "none" : "";
  }
}

/** Full refresh: fetch client list then summaries. Use on load, manual refresh, and after Create/Destroy/Delete/Clone. */
async function runGridRefreshFull(): Promise<void> {
  if (!currentShowId) return;
  if (gridRefreshStatsInFlight) {
    gridRefreshFullPending = true;
    return;
  }
  gridRefreshStatsInFlight = true;
  gridRefreshApi?.requestStarted();
  gridRefreshApi?.recordRefresh();
  let success = false;
  try {
    const list = await getClients(currentShowId);
    clients.length = 0;
    clients.push(...list);
    suppressAutoSelect = false;
    if (selectedId != null && !clients.some((c) => c.id === selectedId)) {
      selectedId = null;
      selectedClientFull = null;
    }
    if (!suppressAutoSelect && clients.length > 0 && selectedId == null) selectedId = clients[0].id;
    success = await fetchVisibleSummariesAndRefresh();
  } catch (e) {
    if (e instanceof Error && (e.message.includes("not live") || e.message.includes("404"))) {
      clients.length = 0;
      selectedId = null;
      selectedClientFull = null;
      refresh();
    }
    // Otherwise leave clients as-is; disconnect indicator will show
  } finally {
    gridRefreshStatsInFlight = false;
    gridRefreshApi?.requestCompleted(success);
    if (gridRefreshFullPending) {
      gridRefreshFullPending = false;
      // Best-effort; if another refresh started, it will re-pend.
      runGridRefreshFull();
    }
  }
}

/** Stats only: fetch summaries for visible IDs. Use for grid timer ticks. */
async function runGridRefreshStatsOnly(): Promise<void> {
  if (gridRefreshStatsInFlight) return;
  gridRefreshStatsInFlight = true;
  gridRefreshApi?.requestStarted();
  gridRefreshApi?.recordRefresh();
  let success = false;
  try {
    success = await fetchVisibleSummariesAndRefresh();
  } catch {
    // Leave existing data as-is
  } finally {
    gridRefreshStatsInFlight = false;
    gridRefreshApi?.requestCompleted(success);
    if (gridRefreshFullPending) {
      gridRefreshFullPending = false;
      runGridRefreshFull();
    }
  }
}

function ensureDetailsRefreshTimer(): void {
  const ms = detailsRefreshIntervalMs;
  const shouldRun = ms > 0 && selectedId != null && detailsRefreshApi != null;
  if (!shouldRun) {
    if (detailsRefreshTimer) clearInterval(detailsRefreshTimer);
    detailsRefreshTimer = null;
    return;
  }
  if (detailsRefreshTimer) return;
  detailsRefreshTimer = setInterval(() => {
    if (selectedId == null || !detailsRefreshApi || !currentShowId) return;
    const id = selectedId;
    const showId = currentShowId;
    detailsRefreshApi.requestStarted();
    detailsRefreshApi.recordRefresh();
    let success = false;
    getClient(showId, id)
      .then((full) => {
        if (selectedId !== id) return;
        if (full == null) {
          // Selected client no longer exists (e.g. deleted individually or via delete-all).
          // Clear selection so we don't hammer the server with repeated 404s.
          selectedId = null;
          selectedClientFull = null;
          selectedAnchor = null;
          refresh();
          return;
        }
        selectedClientFull = full;
        success = true;
        if (detailsContainer) {
          const hasReadOnlyNodes = detailsContainer.querySelector('[data-detail-key="deviceId"]') != null;
          if (!hasReadOnlyNodes) {
            // Details pane isn't rendered yet (or is showing loading). Do a full refresh once.
            refresh();
          } else {
            const scrollEl = getDetailsScrollContainer();
            const st = scrollEl ? scrollEl.scrollTop : 0;
            updateDetailsPaneReadOnly(detailsContainer, full);
            updateDetailsPaneChartsSamplePoints(detailsContainer, full);
            if (scrollEl) scrollEl.scrollTop = st;
            // Keep "last rendered" pointers in sync so unrelated refreshes don't rebuild details DOM.
            lastRenderedDetailsSelectedId = selectedId;
            lastRenderedDetailsClientFull = selectedClientFull;
          }
        }
      })
      .catch(() => {
        // Keep existing UI; disconnect indicator will show via refresh-every component.
      })
      .finally(() => detailsRefreshApi?.requestCompleted(success));
  }, ms);
}

const SIMULATE_DEVICES_EMPTY_MESSAGE =
  "Please open or create a show to simulate extra devices.";

const SIMULATE_DEVICES_NOT_LIVE_MESSAGE =
  "Set this show live to Simulate Extra Connected Devices";

const LIVE_STATE_EVENT_NAME = "lumelier-live-state";
let simulateDevicesContainer: HTMLElement | null = null;
let simulateDevicesLiveStateListener: ((e: Event) => void) | null = null;
/** True when the full grid+details UI is shown; false when showing "not live" or empty state. Used to avoid re-running full teardown+render on every live-state event (poll/BroadcastChannel). */
let simulateDevicesShowingFullUI = false;

function cleanupSimulateDevices(): void {
  if (clockRafId != null) {
    cancelAnimationFrame(clockRafId);
    clockRafId = null;
  }
  if (detailsRefreshTimer) {
    clearInterval(detailsRefreshTimer);
    detailsRefreshTimer = null;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (gridRefreshTimer != null) {
    clearInterval(gridRefreshTimer);
    gridRefreshTimer = null;
  }
  clients = [];
  selectedId = null;
  selectedClientFull = null;
  lastRenderedDetailsSelectedId = undefined;
  lastRenderedDetailsClientFull = undefined;
  pageIndex = 0;
  gridContainer = null;
  detailsContainer = null;
  gridRefreshApi = null;
  detailsRefreshApi = null;
  secondaryToolbar = null;
  btnDelete = null;
  btnClone = null;
  paginationInfoEl = null;
  pagePrevBtn = null;
  pageNextBtn = null;
}

function showSimulateDevicesNotLiveMessage(container: HTMLElement): void {
  container.innerHTML = `
    <div class="show-required-empty-state">
      <p class="show-required-empty-state-message">${SIMULATE_DEVICES_NOT_LIVE_MESSAGE}</p>
    </div>`;
}

function renderSimulateDevicesFull(container: HTMLElement): void {
  cleanupSimulateDevices();

  container.innerHTML = `
    <div class="simulate-devices-page">
      <div class="simulate-devices-body">
        <div class="simulate-devices-client-array-panel" id="simulate-devices-grid-panel">
          <div class="simulate-devices-toolbar">
            <span id="simulate-devices-clock-error-wrap" class="simulate-devices-clock-error-wrap"></span>
            <button type="button" class="devices-toolbar-btn devices-toolbar-btn-icon" id="simulate-devices-create">${openIcon}<span>Create Clients</span></button>
            <button type="button" class="devices-toolbar-btn devices-toolbar-btn-danger" id="simulate-devices-destroy">Destroy all Clients</button>
            <span class="simulate-devices-square-size-wrap">
              <label for="simulate-devices-square-size" class="simulate-devices-toolbar-label">Square size</label>
              <input type="range" id="simulate-devices-square-size" min="${SQUARE_SIZE_MIN}" max="${SQUARE_SIZE_MAX}" value="${squareSizePx}" />
              <span id="simulate-devices-square-size-value">${squareSizePx} px</span>
            </span>
            <button type="button" class="devices-toolbar-btn" id="simulate-devices-lag-overlay-toggle"><span id="simulate-devices-lag-overlay-toggle-label">Hide </span><span class="simulate-devices-lag-overlay-toggle-icon">${noSignalIcon}</span></button>
          </div>
          <div class="simulate-devices-toolbar-secondary" id="simulate-devices-toolbar-secondary" hidden>
            <button type="button" class="btn btn-danger" id="simulate-devices-delete">${trashIcon}<span>Delete Client</span></button>
            <button type="button" class="btn btn-icon-label" id="simulate-devices-clone">Clone Client</button>
          </div>
          <div class="simulate-devices-grid-panel-inner">
            <div class="simulate-devices-grid-area" id="simulate-devices-grid-area"></div>
            <div class="simulate-devices-grid-pagination" id="simulate-devices-grid-pagination">
              <span id="simulate-devices-page-info">Page 1 of 1</span>
              <button type="button" id="simulate-devices-page-prev">Prev</button>
              <button type="button" id="simulate-devices-page-next">Next</button>
            </div>
          </div>
        </div>
        <section class="simulate-devices-details-section" aria-label="Client details">
          <div class="simulate-devices-details-refresh-wrap" id="simulate-devices-details-refresh-wrap"></div>
          <div id="simulate-devices-details-pane"></div>
        </section>
      </div>
    </div>
  `;

  gridContainer = document.getElementById("simulate-devices-grid-area");
  detailsContainer = document.getElementById("simulate-devices-details-pane");
  const detailsRefreshWrapEl = document.getElementById("simulate-devices-details-refresh-wrap");
  secondaryToolbar = document.getElementById("simulate-devices-toolbar-secondary");
  btnDelete = document.getElementById("simulate-devices-delete");
  btnClone = document.getElementById("simulate-devices-clone");
  paginationInfoEl = document.getElementById("simulate-devices-page-info");
  pagePrevBtn = document.getElementById("simulate-devices-page-prev") as HTMLButtonElement | null;
  pageNextBtn = document.getElementById("simulate-devices-page-next") as HTMLButtonElement | null;

  const gridPanelEl = document.getElementById("simulate-devices-grid-panel");
  const toolbarEl = gridPanelEl?.querySelector<HTMLElement>(".simulate-devices-toolbar");
  if (toolbarEl) {
    gridRefreshApi = createRefreshEvery({
      name: "simulate-devices-grid-refresh",
      defaultMs: 1000,
      responseTimeoutMs: DEFAULT_RESPONSE_TIMEOUT_MS,
      disconnectTooltip: "The Simulated Client Server is not responding. It may be down.",
      infoTooltip: "Refreshing these values often can cause UI lag.",
      onIntervalChange(ms) {
        if (gridRefreshTimer) clearInterval(gridRefreshTimer);
        gridRefreshTimer = null;
        if (ms > 0) gridRefreshTimer = setInterval(() => runGridRefreshStatsOnly(), ms);
      },
      onManualRefresh: runGridRefreshFull,
    });
    toolbarEl.insertBefore(gridRefreshApi.root, toolbarEl.firstChild);
    const clockErrorWrap = document.getElementById("simulate-devices-clock-error-wrap");
    if (clockErrorWrap) clockErrorWrap.appendChild(createClockErrorWidget());
  }
  if (detailsRefreshWrapEl) {
    detailsRefreshApi = createRefreshEvery({
      name: "simulate-devices-details-refresh",
      defaultMs: 1000,
      responseTimeoutMs: DEFAULT_RESPONSE_TIMEOUT_MS,
      disconnectTooltip: "The simulated client server is not responding to our requests.",
      infoTooltip: "Refreshing these values often can cause UI lag.",
      onIntervalChange(ms) {
        detailsRefreshIntervalMs = ms;
        if (detailsRefreshTimer) clearInterval(detailsRefreshTimer);
        detailsRefreshTimer = null;
        ensureDetailsRefreshTimer();
      },
    });
    detailsRefreshWrapEl.appendChild(detailsRefreshApi.root);
    // Sync module interval with component's initial value (from localStorage or default) so the details timer runs on load
    detailsRefreshIntervalMs = detailsRefreshApi.getIntervalMs();
  }
  if (gridPanelEl) observeGridPanel(gridPanelEl);
  const gridMs = gridRefreshApi?.getIntervalMs() ?? 1000;
  if (gridRefreshTimer) clearInterval(gridRefreshTimer);
  gridRefreshTimer = null;
  if (gridMs > 0) gridRefreshTimer = setInterval(runGridRefreshStatsOnly, gridMs);

  function tickClocks(): void {
    gridRefreshApi?.updateClockHand();
    detailsRefreshApi?.updateClockHand();
    clockRafId = requestAnimationFrame(tickClocks);
  }
  clockRafId = requestAnimationFrame(tickClocks);

  requestAnimationFrame(() => {
    refresh();
    runGridRefreshFull();
  });

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const active = document.activeElement;
    if (
      active &&
      (active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active as HTMLElement).isContentEditable)
    )
      return;
    if (selectedAnchor == null || selectedAnchor.indices.length === 0) return;
    const client = selectedClientFull;
    if (client == null || selectedId == null || !currentShowId) return;
    const { distKey, indices } = selectedAnchor;
    const curve = client[distKey];
    const indexSet = new Set(indices);
    const anchors = curve.anchors.filter((_, i) => !indexSet.has(i));
    e.preventDefault();
    patchClient(currentShowId, selectedId, { [distKey]: { anchors } }).then(() => {
      selectedClientFull = selectedClientFull
        ? { ...selectedClientFull, [distKey]: { anchors } }
        : null;
      selectedAnchor = null;
      refresh();
    });
  });

  document.getElementById("simulate-devices-create")?.addEventListener("click", () => {
    if (!currentShowId) return;
    showCreateClientsModal(currentShowId, (newClients) => {
      postClients(currentShowId!, newClients)
        .then(() => runGridRefreshFull())
        .then(() => {
          if (selectedId != null && selectedClientFull == null && currentShowId) {
            getClient(currentShowId, selectedId).then((full) => {
              if (selectedId != null) {
                selectedClientFull = full;
                refresh();
              }
            });
          }
        })
        .catch(() => runGridRefreshFull());
    });
  });

  document.getElementById("simulate-devices-destroy")?.addEventListener("click", () => {
    // Make UI immediately consistent (empty grid + no selection), even if refresh calls are in-flight.
    suppressAutoSelect = true;
    clients.length = 0;
    pageIndex = 0;
    selectedId = null;
    selectedClientFull = null;
    selectedAnchor = null;
    refresh();
    ensureDetailsRefreshTimer();

    if (currentShowId)
      deleteAllClients(currentShowId)
        .then(() => runGridRefreshFull())
        .catch(() => runGridRefreshFull());
  });

  btnDelete?.addEventListener("click", () => {
    if (selectedId == null || !currentShowId) return;
    const idToDelete = selectedId;
    apiDeleteClient(currentShowId, idToDelete)
      .then(() => {
        selectedId = null;
        selectedClientFull = null;
        runGridRefreshFull();
      })
      .catch(() => runGridRefreshFull());
  });

  btnClone?.addEventListener("click", () => {
    const sel = selectedClientFull;
    if (sel == null || !currentShowId) return;
    showCloneClientModal(currentShowId, sel, (newClients) => {
      postClients(currentShowId!, newClients)
        .then(() => runGridRefreshFull())
        .then(() => {
          const lastId = newClients[newClients.length - 1]?.id;
          if (lastId && clients.some((c) => c.id === lastId) && currentShowId) {
            selectedId = lastId;
            selectedClientFull = null;
            getClient(currentShowId, lastId).then((full) => {
              if (selectedId === lastId) {
                selectedClientFull = full;
                refresh();
              }
            });
          }
          refresh();
        })
        .catch(() => runGridRefreshFull());
    });
  });

  const squareSizeInput = document.getElementById("simulate-devices-square-size") as HTMLInputElement | null;
  const squareSizeValueEl = document.getElementById("simulate-devices-square-size-value");
  squareSizeInput?.addEventListener("input", () => {
    const val = parseInt(squareSizeInput.value, 10);
    if (!Number.isNaN(val)) {
      squareSizePx = Math.max(SQUARE_SIZE_MIN, Math.min(SQUARE_SIZE_MAX, val));
      if (squareSizeValueEl) squareSizeValueEl.textContent = `${squareSizePx} px`;
      updateGridLayoutAndRender();
    }
  });
  const lagOverlayToggleBtn = document.getElementById("simulate-devices-lag-overlay-toggle");
  const lagOverlayToggleLabel = document.getElementById("simulate-devices-lag-overlay-toggle-label");
  lagOverlayToggleBtn?.addEventListener("click", () => {
    showLagOverlay = !showLagOverlay;
    if (lagOverlayToggleLabel) lagOverlayToggleLabel.textContent = showLagOverlay ? "Hide " : "Show ";
    updateGridLayoutAndRender();
  });

  pagePrevBtn?.addEventListener("click", () => {
    pageIndex--;
    refresh();
  });
  pageNextBtn?.addEventListener("click", () => {
    pageIndex++;
    refresh();
  });

  simulateDevicesShowingFullUI = true;
}

export function render(container: HTMLElement, showId: string | null): void {
  currentShowId = showId;
  if (showId === null) {
    simulateDevicesShowingFullUI = false;
    simulateDevicesContainer = null;
    if (simulateDevicesLiveStateListener) {
      window.removeEventListener(LIVE_STATE_EVENT_NAME, simulateDevicesLiveStateListener);
      simulateDevicesLiveStateListener = null;
    }
    cleanupSimulateDevices();
    container.innerHTML = `
      <div class="show-required-empty-state">
        <p class="show-required-empty-state-message">${SIMULATE_DEVICES_EMPTY_MESSAGE}</p>
      </div>`;
    return;
  }
  simulateDevicesContainer = container;
  if (simulateDevicesLiveStateListener) {
    window.removeEventListener(LIVE_STATE_EVENT_NAME, simulateDevicesLiveStateListener);
  }
  simulateDevicesLiveStateListener = (e: Event) => {
    const ev = e as CustomEvent<{ showId: string; live: boolean }>;
    if (ev.detail?.showId !== currentShowId || !simulateDevicesContainer) return;
    if (ev.detail.live) {
      // Only teardown and re-render when transitioning from not-live to live. If we're already
      // showing the full UI, the poll/BroadcastChannel "show is live" event must not nuke the grid.
      if (!simulateDevicesShowingFullUI) {
        cleanupSimulateDevices();
        renderSimulateDevicesFull(simulateDevicesContainer);
      }
    } else {
      simulateDevicesShowingFullUI = false;
      cleanupSimulateDevices();
      showSimulateDevicesNotLiveMessage(simulateDevicesContainer);
    }
  };
  window.addEventListener(LIVE_STATE_EVENT_NAME, simulateDevicesLiveStateListener);

  fetch(`/api/admin/show-workspaces/${showId}/live-join-url`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : { live: false }))
    .then((data: { live?: boolean }) => {
      if (currentShowId !== showId) return;
      if (!data.live) {
        showSimulateDevicesNotLiveMessage(container);
        return;
      }
      renderSimulateDevicesFull(container);
    })
    .catch(() => {
      if (currentShowId !== showId) return;
      showSimulateDevicesNotLiveMessage(container);
    });
}
