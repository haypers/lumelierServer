import trashIcon from "../../../icons/trash.svg?raw";

export function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export interface LayerLabelCallbacks {
  onRemoveLayer: (id: string) => void;
  onRenameLayer: (id: string, label: string) => void;
}

export function buildLayerLabelRow(
  layer: { id: string; label: string },
  onlyOne: boolean,
  rowHeightPx: number,
  callbacks: LayerLabelCallbacks
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "timeline-layer-label custom-timeline-layer-label-row";
  wrap.style.height = `${rowHeightPx}px`;
  wrap.style.minHeight = `${rowHeightPx}px`;
  const label = String(layer.label ?? "");
  wrap.innerHTML = `
    <span class="timeline-layer-label-name" title="Double-click to rename">${escapeHtml(label)}</span>
    <button type="button" class="timeline-layer-label-remove" title="Remove layer" aria-label="Remove layer">${trashIcon}</button>
  `;
  if (onlyOne) wrap.classList.add("timeline-layer-label--only-one");
  const nameEl = wrap.querySelector(".timeline-layer-label-name") as HTMLElement;
  const btn = wrap.querySelector(".timeline-layer-label-remove") as HTMLButtonElement;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onlyOne) return;
    if (confirm("Remove this layer and all its items?")) {
      callbacks.onRemoveLayer(layer.id);
    }
  });

  nameEl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "timeline-layer-label-input";
    input.value = nameEl.textContent ?? "";
    input.setAttribute("aria-label", "Layer name");
    const commit = () => {
      const val = input.value.trim();
      if (val) callbacks.onRenameLayer(layer.id, val);
      wrap.replaceChild(nameEl, input);
      nameEl.textContent = val || label;
      removeClickOutsideListener();
    };
    const removeClickOutsideListener = () => {
      document.removeEventListener("mousedown", clickOutsideHandler);
    };
    const clickOutsideHandler = (ev: MouseEvent) => {
      if (document.activeElement !== input) return;
      if (wrap.contains(ev.target as Node)) return;
      commit();
      input.blur();
    };
    document.addEventListener("mousedown", clickOutsideHandler);
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        input.blur();
      }
      if (ev.key === "Escape") {
        removeClickOutsideListener();
        wrap.replaceChild(nameEl, input);
      }
    });
    wrap.replaceChild(input, nameEl);
    input.focus();
    input.select();
  });

  return wrap;
}
