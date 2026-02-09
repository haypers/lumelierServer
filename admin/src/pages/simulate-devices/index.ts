import noSignalSvg from "../../icons/noSignal.svg?raw";
import trashIcon from "../../icons/trash.svg?raw";
import type { SimulatedClient, SimulatedClientDistKey, DistributionCurve } from "./types";
import { createClientWithRandomCurves, deleteClient, cloneClient, toggleConnection } from "./client-store";
import { renderClientGrid } from "./client-grid";
import {
  renderDetailsPane,
  DISTRIBUTION_CHART_PRESETS,
  type DistributionChartSelection,
} from "./details-pane";

const MAX_SAMPLE_POINTS = 100;

const MIN_CURVE_POINTS = 1;
const MAX_CURVE_POINTS = 100;
const DEFAULT_MAX_CURVE_POINTS = 15;

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
let secondaryToolbar: HTMLElement | null = null;
let btnDelete: HTMLElement | null = null;
let btnClone: HTMLElement | null = null;
let btnToggleConnection: HTMLElement | null = null;

function getSelected(): SimulatedClient | null {
  if (selectedId == null) return null;
  return clients.find((c) => c.id === selectedId) ?? null;
}

function refresh(): void {
  if (!gridContainer || !detailsContainer) return;
  renderClientGrid(gridContainer, clients, selectedId, noSignalSvg, (id) => {
    selectedId = id;
    selectedAnchor = null;
    refresh();
  });
  const client = getSelected();
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
    client ? (distKey, x, y) => recordSample(client.id, distKey, x, y) : undefined
  );

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
  clients = [];
  selectedId = null;

  container.innerHTML = `
    <div class="simulate-devices-page">
      <div class="simulate-devices-toolbar">
        <button type="button" class="devices-toolbar-btn" id="simulate-devices-create">Create Clients</button>
        <button type="button" class="devices-toolbar-btn devices-toolbar-btn-danger" id="simulate-devices-destroy">Destroy all Clients</button>
      </div>
      <div class="simulate-devices-toolbar-secondary" id="simulate-devices-toolbar-secondary" hidden>
        <button type="button" class="btn btn-danger" id="simulate-devices-delete">${trashIcon}<span>Delete Client</span></button>
        <button type="button" class="btn btn-icon-label" id="simulate-devices-clone">Clone Client</button>
        <button type="button" class="btn btn-icon-label" id="simulate-devices-toggle-connection">Disable Connection</button>
      </div>
      <div class="simulate-devices-body">
        <div class="simulate-devices-grid-panel" id="simulate-devices-grid-panel"></div>
        <section class="simulate-devices-details-section" aria-label="Client details">
          <div id="simulate-devices-details-pane"></div>
        </section>
      </div>
    </div>
  `;

  gridContainer = document.getElementById("simulate-devices-grid-panel");
  detailsContainer = document.getElementById("simulate-devices-details-pane");
  secondaryToolbar = document.getElementById("simulate-devices-toolbar-secondary");
  btnDelete = document.getElementById("simulate-devices-delete");
  btnClone = document.getElementById("simulate-devices-clone");
  btnToggleConnection = document.getElementById("simulate-devices-toggle-connection");

  const pageRoot = (): HTMLElement | null => gridContainer?.closest(".simulate-devices-page") ?? null;
  const bodyEl = (): HTMLElement | null => gridContainer?.parentElement ?? null;

  document.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as Node;
    const el = e.target as Element;
    if (detailsContainer && !detailsContainer.contains(target)) {
      selectedAnchor = null;
      refresh();
    }
    const page = pageRoot();
    const body = bodyEl();
    if (page?.contains(target) && body && !body.contains(target) && !el.closest?.("button")) {
      selectedId = null;
      selectedAnchor = null;
      refresh();
    }
  });
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (selectedAnchor == null) return;
    const client = getSelected();
    if (client == null) return;
    const { distKey, index } = selectedAnchor;
    const curve = client[distKey];
    const anchors = curve.anchors.filter((_, i) => i !== index);
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

  refresh();
}
