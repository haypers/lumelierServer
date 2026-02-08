import noSignalSvg from "../../icons/noSignal.svg?raw";
import trashIcon from "../../icons/trash.svg?raw";
import type { SimulatedClient } from "./types";
import { createClient, deleteClient, cloneClient, toggleConnection } from "./client-store";
import { renderClientGrid } from "./client-grid";
import { renderDetailsPane } from "./details-pane";

let clients: SimulatedClient[] = [];
let selectedId: string | null = null;
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
    refresh();
  });
  renderDetailsPane(detailsContainer, getSelected());

  if (secondaryToolbar) {
    secondaryToolbar.hidden = selectedId == null;
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

  document.getElementById("simulate-devices-create")?.addEventListener("click", () => {
    clients = [...clients, createClient()];
    refresh();
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
