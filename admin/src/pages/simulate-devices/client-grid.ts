import type { ClientSummaryForGrid } from "./types";

export function renderClientGrid(
  container: HTMLElement,
  clients: ClientSummaryForGrid[],
  selectedId: string | null,
  noSignalSvg: string,
  onSelect: (id: string) => void,
  squareSizePx: number = 24
): void {
  container.innerHTML = "";
  container.className = "simulate-devices-grid-wrap";
  const inner = document.createElement("div");
  inner.className = "simulate-devices-grid";
  const size = `${squareSizePx}px`;
  for (const client of clients) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "simulate-devices-grid-square";
    btn.setAttribute("data-client-id", client.id);
    btn.style.width = size;
    btn.style.height = size;
    btn.style.minWidth = size;
    btn.style.minHeight = size;
    if (client.id === selectedId) {
      btn.classList.add("simulate-devices-grid-square--selected");
    }
    if (client.connectionEnabled === false) {
      btn.classList.add("simulate-devices-grid-square--disabled");
      btn.innerHTML = noSignalSvg;
    } else {
      const color = client.currentDisplayColor ?? "var(--bg-elevated)";
      btn.style.backgroundColor = color;
    }
    btn.addEventListener("click", () => onSelect(client.id));
    inner.appendChild(btn);
  }
  container.appendChild(inner);
}

export function updateClientGrid(
  container: HTMLElement,
  clients: ClientSummaryForGrid[],
  selectedId: string | null,
  noSignalSvg: string,
  onSelect: (id: string) => void,
  squareSizePx: number = 24
): void {
  renderClientGrid(container, clients, selectedId, noSignalSvg, onSelect, squareSizePx);
}
