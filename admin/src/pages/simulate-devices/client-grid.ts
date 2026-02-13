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
  const wrap = document.createElement("div");
  wrap.className = "simulate-devices-grid-wrap";
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
  clients: ClientSummaryForGrid[],
  selectedId: string | null,
  noSignalSvg: string,
  onSelect: (id: string) => void,
  squareSizePx: number = 24
): void {
  const inner = container.querySelector(".simulate-devices-grid");
  const squares = inner?.querySelectorAll(".simulate-devices-grid-square");
  if (inner && squares && squares.length === clients.length) {
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
      if (client.connectionEnabled === false) {
        btn.classList.add("simulate-devices-grid-square--disabled");
        btn.innerHTML = noSignalSvg;
        btn.style.backgroundColor = "";
      } else if (client.connectionEnabled === true) {
        btn.classList.remove("simulate-devices-grid-square--disabled");
        btn.innerHTML = "";
        btn.style.backgroundColor =
          client.currentDisplayColor ?? btn.style.backgroundColor ?? "var(--bg-elevated)";
      } else {
        if (client.currentDisplayColor != null) {
          btn.style.backgroundColor = client.currentDisplayColor;
        }
      }
    }
    return;
  }
  renderClientGrid(container, clients, selectedId, noSignalSvg, onSelect, squareSizePx);
}
