import noSignalSvg from "../../icons/noSignal.svg?raw";
import trashIcon from "../../icons/trash.svg?raw";
import { createRefreshEvery } from "../../components/refresh-every";
import type { SimulatedClient, SimulatedClientDistKey, DistributionCurve } from "./types";
import { createClientWithRandomCurves, deleteClient, cloneClient, toggleConnection } from "./client-store";
import { renderClientGrid } from "./client-grid";
import {
  renderDetailsPane,
  DISTRIBUTION_CHART_PRESETS,
  type DistributionChartSelection,
} from "./details-pane";

const MAX_SAMPLE_POINTS = 100;

const SQUARE_SIZE_MIN = 12;
const SQUARE_SIZE_MAX = 48;
const SQUARE_SIZE_DEFAULT = 24;
const GRID_GAP_PX = 4;

const MIN_CURVE_POINTS = 1;
const MAX_CURVE_POINTS = 100;
const DEFAULT_MAX_CURVE_POINTS = 10;

function showCreateClientsModal(onCreate: (newClients: SimulatedClient[]) => void): void {
  const chartBlocksHtml = DISTRIBUTION_CHART_PRESETS.map(
    (preset, i) => `
  <div class="create-clients-chart-block" data-index="${i}">
    <h4 class="create-clients-chart-title">${escapeHtml(preset.title)}</h4>
    <div class="create-clients-range-row">
      <label for="create-modal-min-${i}">Min:</label>
      <input type="number" id="create-modal-min-${i}" min="${MIN_CURVE_POINTS}" max="${MAX_CURVE_POINTS}" value="${MIN_CURVE_POINTS}" />
      <label for="create-modal-max-${i}">Max:</label>
      <input type="number" id="create-modal-max-${i}" min="${MIN_CURVE_POINTS}" max="${MAX_CURVE_POINTS}" value="${DEFAULT_MAX_CURVE_POINTS}" />
    </div>
  </div>`
  ).join("");

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal create-clients-modal">
      <div class="create-clients-row">
        <label for="create-modal-count">New Client Count:</label>
        <input type="number" id="create-modal-count" min="1" value="1" />
      </div>
      ${chartBlocksHtml}
      <div class="modal-actions">
        <button type="button" class="btn-cancel">Cancel</button>
        <button type="button" class="btn-confirm">Create</button>
      </div>
    </div>`;

  const close = (): void => overlay.remove();

  overlay.querySelector(".btn-cancel")?.addEventListener("click", close);

  overlay.querySelector(".btn-confirm")?.addEventListener("click", () => {
    const countInput = overlay.querySelector("#create-modal-count") as HTMLInputElement | null;
    const count = countInput != null ? parseInt(countInput.value.trim(), 10) : NaN;
    if (!Number.isInteger(count) || count < 1) {
      alert("New Client Count must be an integer ≥ 1.");
      return;
    }
    const mins: number[] = [];
    const maxs: number[] = [];
    for (let i = 0; i < DISTRIBUTION_CHART_PRESETS.length; i++) {
      const minInput = overlay.querySelector(`#create-modal-min-${i}`) as HTMLInputElement | null;
      const maxInput = overlay.querySelector(`#create-modal-max-${i}`) as HTMLInputElement | null;
      const minVal = minInput != null ? parseInt(minInput.value.trim(), 10) : NaN;
      const maxVal = maxInput != null ? parseInt(maxInput.value.trim(), 10) : NaN;
      if (!Number.isInteger(minVal) || minVal < MIN_CURVE_POINTS || minVal > MAX_CURVE_POINTS) {
        alert(`Chart "${DISTRIBUTION_CHART_PRESETS[i].title}": Min must be an integer between ${MIN_CURVE_POINTS} and ${MAX_CURVE_POINTS}.`);
        return;
      }
      if (!Number.isInteger(maxVal) || maxVal < MIN_CURVE_POINTS || maxVal > MAX_CURVE_POINTS) {
        alert(`Chart "${DISTRIBUTION_CHART_PRESETS[i].title}": Max must be an integer between ${MIN_CURVE_POINTS} and ${MAX_CURVE_POINTS}.`);
        return;
      }
      if (minVal > maxVal) {
        alert(`Chart "${DISTRIBUTION_CHART_PRESETS[i].title}": Min must not exceed Max.`);
        return;
      }
      mins.push(minVal);
      maxs.push(maxVal);
    }
    const bounds = DISTRIBUTION_CHART_PRESETS.map((p) => ({
      xMin: p.xAxis.min,
      xMax: p.xAxis.max,
    }));
    const newClients: SimulatedClient[] = [];
    for (let c = 0; c < count; c++) {
      const pointCounts = mins.map((min, i) => {
        const max = maxs[i];
        return min === max ? min : min + Math.floor(Math.random() * (max - min + 1));
      });
      newClients.push(createClientWithRandomCurves(bounds, pointCounts));
    }
    close();
    onCreate(newClients);
  });

  document.body.appendChild(overlay);
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

let clients: SimulatedClient[] = [];
let selectedId: string | null = null;
let selectedAnchor: DistributionChartSelection | null = null;
/** Per client per distKey: rolling list of (x,y) sample points for debug; not persisted. */
const sampleHistory: Record<string, { x: number; y: number }[]> = {};

function sampleHistoryKey(clientId: string, distKey: SimulatedClientDistKey): string {
  return `${clientId}:${distKey}`;
}

function getSamplePoints(clientId: string, distKey: SimulatedClientDistKey): { x: number; y: number }[] {
  return sampleHistory[sampleHistoryKey(clientId, distKey)] ?? [];
}

function recordSample(clientId: string, distKey: SimulatedClientDistKey, x: number, y: number): void {
  const key = sampleHistoryKey(clientId, distKey);
  const list = sampleHistory[key] ?? [];
  list.push({ x, y });
  sampleHistory[key] = list.slice(-MAX_SAMPLE_POINTS);
  refresh();
}
let gridContainer: HTMLElement | null = null;
let detailsContainer: HTMLElement | null = null;
let gridRefreshApi: ReturnType<typeof createRefreshEvery> | null = null;
let detailsRefreshApi: ReturnType<typeof createRefreshEvery> | null = null;
let clockRafId: number | null = null;
let secondaryToolbar: HTMLElement | null = null;
let btnDelete: HTMLElement | null = null;
let btnClone: HTMLElement | null = null;
let btnToggleConnection: HTMLElement | null = null;

let squareSizePx = SQUARE_SIZE_DEFAULT;
let pageIndex = 0;
let resizeObserver: ResizeObserver | null = null;
let lastContainerWidth = 0;
let lastContainerHeight = 0;
let scheduledGridUpdate = false;
let paginationInfoEl: HTMLElement | null = null;
let pagePrevBtn: HTMLButtonElement | null = null;
let pageNextBtn: HTMLButtonElement | null = null;

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
  const panel = document.getElementById("simulate-devices-grid-panel");
  const paginationEl = document.getElementById("simulate-devices-grid-pagination");
  if (!panel) return { w: FALLBACK_GRID_WIDTH, h: FALLBACK_GRID_HEIGHT };
  const style = getComputedStyle(panel);
  const padT = parseFloat(style.paddingTop) || 0;
  const padB = parseFloat(style.paddingBottom) || 0;
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const toolbarEl = panel.querySelector<HTMLElement>(".simulate-devices-toolbar");
  const toolbarSecondaryEl = panel.querySelector<HTMLElement>(".simulate-devices-toolbar-secondary");
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

function updateGridLayoutAndRender(): void {
  if (!gridContainer) return;
  const { w, h } = getGridAvailableSize();
  const layout = computeGridLayout(w, h, squareSizePx, GRID_GAP_PX, 0, clients.length);
  const { pageSize, totalPages } = layout;
  pageIndex = Math.min(pageIndex, Math.max(0, totalPages - 1));
  const start = pageIndex * pageSize;
  const pageClients = clients.slice(start, start + pageSize);
  renderClientGrid(gridContainer, pageClients, selectedId, noSignalSvg, (id) => {
    selectedId = id;
    selectedAnchor = null;
    refresh();
  }, squareSizePx);
  updatePaginationUI(totalPages, pageIndex);
}

function getSelected(): SimulatedClient | null {
  if (selectedId == null) return null;
  return clients.find((c) => c.id === selectedId) ?? null;
}

function refresh(): void {
  if (!gridContainer || !detailsContainer) return;
  const savedScrollTop = detailsContainer.scrollTop;
  updateGridLayoutAndRender();
  const client = getSelected();
  detailsRefreshApi =
    renderDetailsPane(
      detailsContainer,
      client,
      (distKey: SimulatedClientDistKey, curve: DistributionCurve) => {
        if (selectedId == null) return;
        clients = clients.map((c) =>
          c.id === selectedId ? { ...c, [distKey]: curve } : c
        );
        refresh();
      },
      selectedAnchor,
      (sel) => {
        selectedAnchor = sel;
        refresh();
      },
      client ? (distKey) => getSamplePoints(client.id, distKey) : undefined,
      client ? (distKey, x, y) => recordSample(client.id, distKey, x, y) : undefined,
      {
        name: "simulate-devices-details-refresh",
        defaultMs: 1000,
        onIntervalChange: () => {},
      }
    ) ?? null;
  detailsContainer.scrollTop = savedScrollTop;

  if (secondaryToolbar) {
    const hide = selectedId == null;
    secondaryToolbar.hidden = hide;
    secondaryToolbar.style.visibility = hide ? "hidden" : "";
    secondaryToolbar.style.pointerEvents = hide ? "none" : "";
  }
  if (btnToggleConnection) {
    const sel = getSelected();
    btnToggleConnection.textContent = sel?.connectionEnabled ? "Disable Connection" : "Enable Connection";
  }
}

export function render(container: HTMLElement): void {
  if (clockRafId != null) {
    cancelAnimationFrame(clockRafId);
    clockRafId = null;
  }
  clients = [];
  selectedId = null;
  pageIndex = 0;

  resizeObserver?.disconnect();
  resizeObserver = null;

  container.innerHTML = `
    <div class="simulate-devices-page">
      <div class="simulate-devices-body">
        <div class="simulate-devices-client-array-panel" id="simulate-devices-grid-panel">
          <div class="simulate-devices-toolbar">
            <button type="button" class="devices-toolbar-btn" id="simulate-devices-create">Create Clients</button>
            <button type="button" class="devices-toolbar-btn devices-toolbar-btn-danger" id="simulate-devices-destroy">Destroy all Clients</button>
            <label for="simulate-devices-square-size" class="simulate-devices-toolbar-label">Square size</label>
            <input type="range" id="simulate-devices-square-size" min="${SQUARE_SIZE_MIN}" max="${SQUARE_SIZE_MAX}" value="${squareSizePx}" />
            <span id="simulate-devices-square-size-value">${squareSizePx} px</span>
          </div>
          <div class="simulate-devices-toolbar-secondary" id="simulate-devices-toolbar-secondary" hidden>
            <button type="button" class="btn btn-danger" id="simulate-devices-delete">${trashIcon}<span>Delete Client</span></button>
            <button type="button" class="btn btn-icon-label" id="simulate-devices-clone">Clone Client</button>
            <button type="button" class="btn btn-icon-label" id="simulate-devices-toggle-connection">Disable Connection</button>
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
          <div id="simulate-devices-details-pane"></div>
        </section>
      </div>
    </div>
  `;

  gridContainer = document.getElementById("simulate-devices-grid-area");
  detailsContainer = document.getElementById("simulate-devices-details-pane");
  secondaryToolbar = document.getElementById("simulate-devices-toolbar-secondary");
  btnDelete = document.getElementById("simulate-devices-delete");
  btnClone = document.getElementById("simulate-devices-clone");
  btnToggleConnection = document.getElementById("simulate-devices-toggle-connection");
  paginationInfoEl = document.getElementById("simulate-devices-page-info");
  pagePrevBtn = document.getElementById("simulate-devices-page-prev") as HTMLButtonElement | null;
  pageNextBtn = document.getElementById("simulate-devices-page-next") as HTMLButtonElement | null;

  const gridPanelEl = document.getElementById("simulate-devices-grid-panel");
  const toolbarEl = gridPanelEl?.querySelector<HTMLElement>(".simulate-devices-toolbar");
  if (toolbarEl) {
    gridRefreshApi = createRefreshEvery({
      name: "simulate-devices-grid-refresh",
      defaultMs: 1000,
      onIntervalChange: () => {},
    });
    toolbarEl.insertBefore(gridRefreshApi.root, toolbarEl.firstChild);
  }
  if (gridPanelEl) observeGridPanel(gridPanelEl);

  function tickClocks(): void {
    gridRefreshApi?.updateClockHand();
    detailsRefreshApi?.updateClockHand();
    clockRafId = requestAnimationFrame(tickClocks);
  }
  clockRafId = requestAnimationFrame(tickClocks);

  requestAnimationFrame(() => refresh());

  const pageRoot = (): HTMLElement | null => gridContainer?.closest(".simulate-devices-page") ?? null;
  const bodyEl = (): HTMLElement | null =>
    pageRoot()?.querySelector(".simulate-devices-body") ?? null;

  document.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as Node;
    const el = e.target as Element;
    if (detailsContainer && !detailsContainer.contains(target)) {
      selectedAnchor = null;
      refresh();
    }
    if (detailsContainer?.contains(target)) return;
    if (el.closest?.(".simulate-devices-chart-container") || el.closest?.(".distribution-chart")) return;
    const body = bodyEl();
    const insideBody = body?.contains(target) ?? false;
    const isButtonOrDropdown = el.closest?.("button") ?? el.closest?.("select") ?? el.closest?.("[role='listbox']") ?? el.closest?.("[role='menu']");
    if (!insideBody && !isButtonOrDropdown) {
      selectedId = null;
      selectedAnchor = null;
      refresh();
    }
  });
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (selectedAnchor == null || selectedAnchor.indices.length === 0) return;
    const client = getSelected();
    if (client == null) return;
    const { distKey, indices } = selectedAnchor;
    const curve = client[distKey];
    const indexSet = new Set(indices);
    const anchors = curve.anchors.filter((_, i) => !indexSet.has(i));
    clients = clients.map((c) =>
      c.id === selectedId ? { ...c, [distKey]: { anchors } } : c
    );
    selectedAnchor = null;
    e.preventDefault();
    refresh();
  });

  document.getElementById("simulate-devices-create")?.addEventListener("click", () => {
    showCreateClientsModal((newClients) => {
      clients = [...clients, ...newClients];
      refresh();
    });
  });

  document.getElementById("simulate-devices-destroy")?.addEventListener("click", () => {
    clients = [];
    selectedId = null;
    refresh();
  });

  btnDelete?.addEventListener("click", () => {
    if (selectedId == null) return;
    clients = deleteClient(clients, selectedId);
    selectedId = null;
    refresh();
  });

  btnClone?.addEventListener("click", () => {
    const sel = getSelected();
    if (sel == null) return;
    const cloned = cloneClient(sel);
    clients = [...clients, cloned];
    selectedId = cloned.id;
    refresh();
  });

  btnToggleConnection?.addEventListener("click", () => {
    const sel = getSelected();
    if (sel == null) return;
    toggleConnection(sel);
    refresh();
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

  pagePrevBtn?.addEventListener("click", () => {
    pageIndex--;
    updateGridLayoutAndRender();
    refresh();
  });
  pageNextBtn?.addEventListener("click", () => {
    pageIndex++;
    updateGridLayoutAndRender();
    refresh();
  });
}
