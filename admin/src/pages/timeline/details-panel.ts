import type { TimelineItemPayload } from "./types";
import { dateToSecFloat } from "./types";
import { createLayerTrackPicker } from "./layer-track-picker";

/** Item shape used by the details panel (id, start/end/group, payload). */
export interface DetailsPanelItem {
  id: string;
  start: Date;
  end?: Date;
  group: string;
  payload: TimelineItemPayload;
}

export type GetItemFn = (id: string) => DetailsPanelItem | null;

export interface LayerInfo {
  id: string;
  label: string;
}

export interface DetailsPanelUpdates {
  startSec?: number;
  layerId?: string;
  label?: string;
  effectType?: string;
  color?: string;
}

export type UpdateItemFn = (id: string, updates: DetailsPanelUpdates) => void;
export type GetLayersFn = () => LayerInfo[];

/** Event type options for the dropdown. Only one for now. */
export const EVENT_TYPE_OPTIONS = ["Set Color Broadcast"] as const;

/** Called to refresh the details panel; pass current itemId to re-render that item (e.g. after changing event type). */
export type OnDetailsUpdatedFn = (currentItemId?: string) => void;

export function updateDetailsPanel(
  container: HTMLElement,
  itemId: string | null | undefined,
  getItem: GetItemFn,
  updateItem: UpdateItemFn,
  getLayers: GetLayersFn,
  onUpdated?: OnDetailsUpdatedFn
): void {
  const h3 = container.querySelector("h3");
  const body = container.querySelector(".timeline-details-body");
  if (!h3 || !body) return;

  if (itemId == null) {
    h3.textContent = "Selection";
    body.innerHTML =
      '<p class="no-selection">Select an item on the timeline to view or edit its details.</p>';
    return;
  }

  const item = getItem(itemId);
  if (!item || itemId == null) {
    h3.textContent = "Selection";
    body.innerHTML = '<p class="no-selection">Item not found.</p>';
    return;
  }
  const itemIdStr = itemId as string;

  const payload = item.payload ?? { kind: "event" as const };
  const startSec = dateToSecFloat(item.start);
  const layers = getLayers();

  h3.textContent = payload.kind === "clip" ? "Clip details" : "Event details";

  const eventTypeOptions =
    `<option value="" ${payload.effectType == null || payload.effectType === "" ? "selected" : ""}>—</option>` +
    EVENT_TYPE_OPTIONS.map(
      (t) =>
        `<option value="${escapeAttr(t)}" ${t === (payload.effectType ?? "") ? "selected" : ""}>${escapeHtml(t)}</option>`
    ).join("");

  const isSetColorBroadcast =
    payload.kind === "event" && payload.effectType === "Set Color Broadcast";
  const colorValue =
    payload.color && /^#[0-9A-Fa-f]{6}$/.test(payload.color)
      ? payload.color
      : "#ffffff";

  const subsettingsHtml =
    isSetColorBroadcast
      ? `
  <div class="detail-subsettings">
    <dl class="detail-grid">
      <dt>Color</dt>
      <dd>
        <input type="color" class="detail-input detail-color" value="${escapeAttr(colorValue)}" aria-label="Color" />
        <span class="detail-color-hex">${escapeHtml(colorValue)}</span>
      </dd>
    </dl>
  </div>`
      : "";

  body.innerHTML = `
    <dl class="detail-grid">
      <dt>ID</dt><dd class="detail-readonly">${escapeHtml(String(item.id))}</dd>
      <dt>Type</dt><dd class="detail-readonly">${escapeHtml(payload.kind)}</dd>
      <dt>Start</dt>
      <dd>
        <input type="number" class="detail-input detail-start" step="any" min="0" value="${startSec}" aria-label="Start time in seconds" />
        <span class="detail-unit">s</span>
      </dd>
      <dt>Layer</dt>
      <dd class="detail-layer-wrap"></dd>
      <dt>Name</dt>
      <dd>
        <input type="text" class="detail-input detail-label" value="${escapeAttr(payload.label ?? "")}" aria-label="Name" />
      </dd>
      ${payload.kind === "event" ? `
      <dt>Event Type</dt>
      <dd>
        <select class="detail-input detail-effect-type" aria-label="Event type">
          ${eventTypeOptions}
        </select>
      </dd>
    </dl>
    ${subsettingsHtml}
      ` : "</dl>"}
  `;

  const layerWrap = body.querySelector(".detail-layer-wrap");
  if (layerWrap) {
    layerWrap.appendChild(
      createLayerTrackPicker({
        layers,
        value: String(item.group),
        onChange: (layerId) => updateItem(itemIdStr, { layerId }),
        ariaLabel: "Layer by name",
      })
    );
  }

  const startInput = body.querySelector(".detail-start") as HTMLInputElement;
  const labelInput = body.querySelector(".detail-label") as HTMLInputElement;
  const effectSelect = body.querySelector(".detail-effect-type") as HTMLSelectElement | null;

  function applyStart(): void {
    const val = parseFloat(startInput.value);
    if (!Number.isNaN(val) && val >= 0) {
      updateItem(itemIdStr, { startSec: val });
    }
  }

  function applyLabel(): void {
    updateItem(itemIdStr, { label: labelInput.value.trim() || undefined });
  }

  function applyEffectType(): void {
    if (effectSelect) {
      const val = effectSelect.value;
      updateItem(itemIdStr, { effectType: val });
      if (val === "Set Color Broadcast") {
        updateItem(itemIdStr, { color: "#ffffff" });
      }
      onUpdated?.(itemIdStr);
    }
  }

  function applyColor(): void {
    if (!body) return;
    const colorInput = body.querySelector(".detail-color") as HTMLInputElement | null;
    const hexSpan = body.querySelector(".detail-color-hex");
    if (colorInput) {
      const hex = colorInput.value;
      updateItem(itemIdStr, { color: hex });
      if (hexSpan) hexSpan.textContent = hex;
    }
  }

  startInput.addEventListener("change", applyStart);
  startInput.addEventListener("blur", applyStart);
  labelInput.addEventListener("change", applyLabel);
  labelInput.addEventListener("blur", applyLabel);
  if (effectSelect) {
    effectSelect.addEventListener("change", applyEffectType);
  }
  const colorInput = body.querySelector(".detail-color") as HTMLInputElement | null;
  if (colorInput) {
    colorInput.addEventListener("input", applyColor);
    colorInput.addEventListener("change", applyColor);
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
