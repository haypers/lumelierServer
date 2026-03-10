import type { ClientSummaryForGrid } from "./types";
import noSignalSvg from "../../icons/noSignal.svg?raw";
import { getContrastingColor } from "../../color";

const inLag = (c: ClientSummaryForGrid): boolean =>
  c.lagEndsInMs != null && c.lagEndsInMs > 0;

/** Fallback when client has no display color (e.g. not yet from server). */
const DEFAULT_BG_FOR_CONTRAST = "#333333";

export function renderClientGrid(
  container: HTMLElement,
  items: ClientSummaryForGrid[],
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
  for (const client of items) {
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
    const bgForContrast = client.currentDisplayColor ?? DEFAULT_BG_FOR_CONTRAST;
    overlay.style.color = getContrastingColor(bgForContrast);
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
  items: ClientSummaryForGrid[],
  selectedId: string | null,
  onSelect: (id: string) => void,
  squareSizePx: number = 24,
  showLagOverlay: boolean = true
): void {
  const inner = container.querySelector(".simulate-devices-grid");
  const squares = inner?.querySelectorAll(".simulate-devices-grid-square");
  if (inner && squares && squares.length === items.length) {
    const size = `${squareSizePx}px`;
    for (let i = 0; i < items.length; i++) {
      const btn = squares[i] as HTMLButtonElement;
      const client = items[i];
      btn.setAttribute("data-client-id", client.id);
      btn.style.width = size;
      btn.style.height = size;
      btn.style.minWidth = size;
      btn.style.minHeight = size;
      btn.classList.toggle("simulate-devices-grid-square--selected", client.id === selectedId);
      btn.style.backgroundColor =
        client.currentDisplayColor ?? btn.style.backgroundColor ?? "var(--bg-elevated)";
      const overlay = btn.querySelector(".simulate-devices-grid-square-lag-overlay") as HTMLElement | null;
      if (overlay) {
        const bgForContrast = client.currentDisplayColor ?? DEFAULT_BG_FOR_CONTRAST;
        overlay.style.color = getContrastingColor(bgForContrast);
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
