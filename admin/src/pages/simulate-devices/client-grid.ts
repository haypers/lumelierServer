import type { ClientSummaryForGrid } from "./types";
import noSignalSvg from "../../icons/noSignal.svg?raw";

const inLag = (c: ClientSummaryForGrid): boolean =>
  c.lagEndsInMs != null && c.lagEndsInMs > 0;

/** Line break between track groups when "Group by track" is on; forces next group to start on a new row. */
export interface GridBreak {
  _gridBreak: true;
}

export type GridItem = ClientSummaryForGrid | GridBreak;

function isGridBreak(item: GridItem): item is GridBreak {
  return item != null && typeof item === "object" && "_gridBreak" in item && item._gridBreak === true;
}

export function renderClientGrid(
  container: HTMLElement,
  items: GridItem[],
  selectedId: string | null,
  onSelect: (id: string) => void,
  squareSizePx: number = 24,
  showLagOverlay: boolean = true
): void {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "simulate-devices-grid-wrap";
  const inner = document.createElement("div");
  inner.className = "simulate-devices-grid";
  const size = `${squareSizePx}px`;
  for (const item of items) {
    if (isGridBreak(item)) {
      const br = document.createElement("span");
      br.className = "simulate-devices-grid-break";
      br.setAttribute("aria-hidden", "true");
      inner.appendChild(br);
      continue;
    }
    const client = item;
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
    const color = client.currentDisplayColor ?? "var(--bg-elevated)";
    btn.style.backgroundColor = color;
    const overlay = document.createElement("span");
    overlay.className = "simulate-devices-grid-square-lag-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = noSignalSvg;
    if (showLagOverlay && inLag(client)) {
      overlay.classList.add("simulate-devices-grid-square-lag-overlay--visible");
    }
    btn.appendChild(overlay);
    inner.appendChild(btn);
  }
  inner.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".simulate-devices-grid-square");
    if (btn) {
      const id = btn.getAttribute("data-client-id");
      if (id) onSelect(id);
    }
  });
  wrap.appendChild(inner);
  container.appendChild(wrap);
}

export function updateClientGrid(
  container: HTMLElement,
  items: GridItem[],
  selectedId: string | null,
  onSelect: (id: string) => void,
  squareSizePx: number = 24,
  showLagOverlay: boolean = true
): void {
  const inner = container.querySelector(".simulate-devices-grid");
  const squares = inner?.querySelectorAll(".simulate-devices-grid-square");
  const clients = items.filter((item): item is ClientSummaryForGrid => !isGridBreak(item));
  if (inner && squares && squares.length === clients.length && items.length === clients.length) {
    const size = `${squareSizePx}px`;
    for (let i = 0; i < clients.length; i++) {
      const btn = squares[i] as HTMLButtonElement;
      const client = clients[i];
      btn.setAttribute("data-client-id", client.id);
      btn.style.width = size;
      btn.style.height = size;
      btn.style.minWidth = size;
      btn.style.minHeight = size;
      btn.classList.toggle("simulate-devices-grid-square--selected", client.id === selectedId);
      btn.style.backgroundColor =
        client.currentDisplayColor ?? btn.style.backgroundColor ?? "var(--bg-elevated)";
      const overlay = btn.querySelector(".simulate-devices-grid-square-lag-overlay");
      if (overlay) {
        overlay.classList.toggle(
          "simulate-devices-grid-square-lag-overlay--visible",
          showLagOverlay && inLag(client)
        );
      }
    }
    return;
  }
  renderClientGrid(container, items, selectedId, onSelect, squareSizePx, showLagOverlay);
}
