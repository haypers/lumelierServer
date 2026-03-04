import "vis-timeline/styles/vis-timeline-graph2d.css";
import "./styles.css";
import { DataSet } from "vis-data";
import { Timeline, type DataItem, type DataGroup, type IdType } from "vis-timeline";
import animatedLoadingIcon from "../../icons/animatedLoadingIcon.svg?raw";
import circleCheckIcon from "../../icons/circle-check.svg?raw";
import pauseIcon from "../../icons/pause.svg?raw";
import playIcon from "../../icons/play.svg?raw";
import resetIcon from "../../icons/reset.svg?raw";
import trashIcon from "../../icons/trash.svg?raw";
import {
  SEC,
  readheadId,
  defaultTimeZero,
  toMs,
  timeToDate,
  dateToSec,
  dateToSecFloat,
  type TimelineItemPayload,
} from "./types";
import { createInfoBubble } from "../../components/info-bubble";
import type { DetailsPanelUpdates } from "./details-panel";
import { updateDetailsPanel } from "./details-panel";
import {
  exportState,
  importState,
  type NextIds,
} from "./state-serialization";
import type { TimelineStateJSON } from "./types";
export type { TimelineItemPayload, TimelineStateJSON } from "./types";

let timeline: Timeline | null = null;
let groups: DataSet<DataGroup>;
let items: DataSet<DataItem & { payload?: TimelineItemPayload }>;
/** Reuse the same label element per group so vis-timeline's redraw doesn't see a new node and report "resized" in a loop. */
const groupLabelCache = new Map<string, HTMLElement>();
let nextLayerId = 1;
let nextItemId = 1;
let projectTitle = "Untitled Show";
let requestsGPS = false;
const EVENT_TYPE_SET_COLOR_BROADCAST = "Set Color Broadcast";
/** True once the user has opened or created a show; timeline and toolbar are visible. */
let hasLoadedShow = false;
/** Show ID from URL when timeline is scoped to a show; used for load and autosave. */
let currentShowId: string | null = null;
const AUTOSAVE_DEBOUNCE_MS = 1000;
/** Minimum time to show "Syncing" so the user sees the state change even when the request is very fast. */
const MIN_SYNCING_DISPLAY_MS = 400;
let autosaveTimerId: ReturnType<typeof setTimeout> | null = null;
let timelineAutosaveEl: HTMLElement | null = null;
/** True when in Broadcasting mode; used to guard layer edit/remove and drive broadcast UI. */
let isBroadcastMode = false;
const LIVE_STATE_EVENT_NAME = "lumelier-live-state";
let timelineLiveStateListenerRef: ((e: Event) => void) | null = null;
/** Set in render(); used when loading a show to create timeline and show content. */
let timelineWrapEl: HTMLElement | null = null;
let timelineContentEl: HTMLElement | null = null;
let timelinePageBodyEl: HTMLElement | null = null;
let timelineMountEl: HTMLElement | null = null;
let timelineDetailsPanelEl: HTMLElement | null = null;
let timelineLoadingEl: HTMLElement | null = null;
let deleteKeyListenerAdded = false;

/** Offset (ms) from client time to server time: serverTimeMs ≈ Date.now() + serverTimeOffsetMs */
let serverTimeOffsetMs = 0;
let broadcastPlayAtMs: number | null = null;
let broadcastReadheadSec = 0;
let broadcastPauseAtMs: number | null = null;
let broadcastReadheadTickId: ReturnType<typeof setInterval> | null = null;

const BROADCAST_READHEAD_TICK_MS = 100;
const BROADCAST_READHEAD_POST_DEBOUNCE_MS = 150;
let broadcastReadheadPostTimer: ReturnType<typeof setTimeout> | null = null;

function getServerTimeMs(): number {
  return Date.now() + serverTimeOffsetMs;
}

function tickBroadcastReadhead(): void {
  if (broadcastPlayAtMs == null || !timeline) return;
  const nowMs = getServerTimeMs();
  if (nowMs < broadcastPlayAtMs) return;
  if (broadcastPauseAtMs != null && nowMs >= broadcastPauseAtMs) {
    return;
  }
  const sec = broadcastReadheadSec + (nowMs - broadcastPlayAtMs) / 1000;
  timeline.setCustomTime(timeToDate(sec), readheadId);
}

function postBroadcastReadheadDebounced(sec: number): void {
  if (!isBroadcastMode) return;
  // If currently playing (not yet paused), the readhead is driven by tickBroadcastReadhead().
  // We intentionally do not spam the server with playback ticks.
  if (broadcastPlayAtMs != null && broadcastPauseAtMs == null) return;
  if (broadcastReadheadPostTimer != null) {
    clearTimeout(broadcastReadheadPostTimer);
    broadcastReadheadPostTimer = null;
  }
  const clamped = Math.max(0, sec);
  broadcastReadheadPostTimer = setTimeout(() => {
    broadcastReadheadPostTimer = null;
    if (!currentShowId) return;
    fetch(`/api/admin/shows/${currentShowId}/broadcast/readhead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readheadSec: clamped }),
      credentials: "include",
    }).catch(() => {});
  }, BROADCAST_READHEAD_POST_DEBOUNCE_MS);
}

function startBroadcastReadheadTick(): void {
  if (broadcastReadheadTickId != null) {
    clearInterval(broadcastReadheadTickId);
    broadcastReadheadTickId = null;
  }
  broadcastReadheadTickId = setInterval(tickBroadcastReadhead, BROADCAST_READHEAD_TICK_MS);
}

function stopBroadcastReadheadTick(): void {
  if (broadcastReadheadTickId != null) {
    clearInterval(broadcastReadheadTickId);
    broadcastReadheadTickId = null;
  }
  broadcastPlayAtMs = null;
  broadcastPauseAtMs = null;
}

function ensureGroups(): void {
  if (!groups.length) {
    addLayer();
  }
}

function addLayer(): string {
  const id = String(nextLayerId++);
  const label = `Layer ${id}`;
  groups.add({ id, content: label });
  updateOnlyLayerVisibility();
  refreshDetailsPanel();
  scheduleAutosave();
  return id;
}

function removeLayer(id: IdType): void {
  const groupIds = groups.getIds();
  if (groupIds.length <= 1) return;
  groupLabelCache.delete(String(id));
  groups.remove(id);
  items.getIds().forEach((itemId) => {
    const item = items.get(itemId) as (DataItem & { payload?: TimelineItemPayload }) | null;
    if (item?.group === id) items.remove(itemId);
  });
  updateOnlyLayerVisibility();
  refreshDetailsPanel();
  scheduleAutosave();
}

function addClip(layerId?: IdType): string {
  ensureGroups();
  const gid = layerId ?? groups.getIds()[0];
  const start = timeline ? dateToSec(timeline.getWindow().start) + 2 : 0;
  const end = start + 5;
  const id = `item-${nextItemId++}`;
  const payload: TimelineItemPayload = { kind: "clip", label: `Clip ${id}`, effectType: "fade" };
  items.add({
    id,
    group: gid,
    start: timeToDate(start),
    end: timeToDate(end),
    content: payload.label ?? id,
    type: "range",
    payload,
  });
  scheduleAutosave();
  return id;
}

function addEvent(layerId?: IdType): string {
  ensureGroups();
  const gid = layerId ?? groups.getIds()[0];
  const at = timeline ? dateToSec(timeline.getWindow().start) + 2 : 0;
  const id = `item-${nextItemId++}`;
  const payload: TimelineItemPayload = {
    kind: "event",
    label: `Event ${id}`,
    effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
  };
  items.add({
    id,
    group: gid,
    start: timeToDate(at),
    content: payload.label ?? id,
    type: "point",
    payload,
  });
  scheduleAutosave();
  return id;
}

function removeSelected(): void {
  const sel = timeline?.getSelection() ?? [];
  sel.forEach((id) => items.remove(id));
  scheduleAutosave();
}

function getLayers(): { id: string; label: string }[] {
  return groups.get().map((g: DataGroup) => ({
    id: String(g.id),
    label: String(g.content),
  }));
}

function updateItemInTimeline(id: IdType, updates: DetailsPanelUpdates): void {
  const item = items.get(id) as (DataItem & { payload?: TimelineItemPayload }) | null;
  if (!item) return;
  const payload = { ...(item.payload ?? { kind: "event" as const }) };
  let start: Date | undefined;
  let end: Date | undefined;
  let group: string | undefined;
  let content: string | undefined;

  if (updates.startSec !== undefined) {
    const sec = Number(updates.startSec);
    if (!Number.isNaN(sec) && sec >= 0) {
      start = timeToDate(sec);
      if (item.end != null && payload.kind === "clip") {
        const durMs = new Date(item.end).getTime() - new Date(item.start).getTime();
        end = new Date(start.getTime() + durMs);
      } else if (payload.kind === "event") {
        end = undefined;
      }
    }
  }
  if (updates.layerId !== undefined) {
    group = updates.layerId;
  }
  if (updates.label !== undefined) {
    payload.label = updates.label || undefined;
    content = updates.label?.trim() || String(id);
  }
  if (updates.effectType !== undefined) {
    payload.effectType = updates.effectType || undefined;
  }
  if (updates.target !== undefined) {
    payload.target = updates.target || undefined;
  }
  if (updates.color !== undefined) {
    payload.color = updates.color || undefined;
  }

  items.update({
    id,
    ...(start != null && { start }),
    ...(end !== undefined && { end }),
    ...(group != null && { group }),
    ...(content != null && { content }),
    payload,
  });
  scheduleAutosave();
}

function createGroupLabelElement(
  groupData: { id: IdType; content: string },
  onRemove: (id: IdType) => void,
  onRename: (id: IdType, newContent: string) => void
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "timeline-layer-label";
  const label = String(groupData.content ?? "");
  wrap.innerHTML = `
    <span class="timeline-layer-label-name" title="Double-click to rename">${escapeHtml(label)}</span>
    <button type="button" class="timeline-layer-label-remove" title="Remove layer" aria-label="Remove layer">${trashIcon}</button>
  `;
  const nameEl = wrap.querySelector(".timeline-layer-label-name") as HTMLElement;
  const btn = wrap.querySelector(".timeline-layer-label-remove") as HTMLButtonElement;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (isBroadcastMode) return;
    if (groupData.id == null) return;
    if (groups.getIds().length <= 1) return;
    if (confirm("Remove this layer and all its items?")) {
      onRemove(groupData.id);
      timeline?.fit();
    }
  });

  nameEl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (isBroadcastMode) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "timeline-layer-label-input";
    input.value = nameEl.textContent ?? "";
    input.setAttribute("aria-label", "Layer name");
    const commit = () => {
      const val = input.value.trim();
      if (val && groupData.id != null) {
        onRename(groupData.id, val);
      }
      wrap.replaceChild(nameEl, input);
      nameEl.textContent = val || label;
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        input.blur();
      }
      if (ev.key === "Escape") {
        wrap.replaceChild(nameEl, input);
      }
    });
    wrap.replaceChild(input, nameEl);
    input.focus();
    input.select();
  });

  return wrap;
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

let updateOnlyLayerVisibilityRafId: number | null = null;
function updateOnlyLayerVisibility(): void {
  if (updateOnlyLayerVisibilityRafId != null) return;
  updateOnlyLayerVisibilityRafId = requestAnimationFrame(() => {
    updateOnlyLayerVisibilityRafId = null;
    const mount = document.getElementById("timeline-mount");
    if (!mount) return;
    const totalLayers = groups.getIds().length;
    const onlyOne = totalLayers <= 1;
    mount.querySelectorAll(".timeline-layer-label").forEach((el) => {
      const wrap = el as HTMLElement;
      if (onlyOne) {
        wrap.classList.add("timeline-layer-label--only-one");
      } else {
        wrap.classList.remove("timeline-layer-label--only-one");
      }
    });
  });
}

function injectAddLayerButton(): void {
  const mount = document.getElementById("timeline-mount");
  if (!mount) return;
  const corner = mount.querySelector(
    ".vis-panel.vis-background:not(.vis-horizontal):not(.vis-vertical)"
  ) as HTMLElement | null;
  if (!corner) return;
  const existing = mount.querySelector(".timeline-add-layer-wrap");
  if (existing) return;
  const wrap = document.createElement("div");
  wrap.className = "timeline-add-layer-wrap";
  wrap.innerHTML = '<button type="button" class="timeline-add-layer-btn">+ Layer</button>';
  wrap.querySelector("button")?.addEventListener("click", () => {
    addLayer();
    timeline?.fit();
  });
  corner.appendChild(wrap);
}

function getExportState(): TimelineStateJSON {
  return exportState(
    groups,
    items,
    () =>
      timeline
        ? dateToSecFloat(new Date(toMs(timeline.getCustomTime(readheadId))))
        : 0,
    () => projectTitle,
    () => requestsGPS
  );
}

function setRequestsGPS(value: boolean): void {
  requestsGPS = value;
  const btn = document.getElementById("timeline-request-gps-toggle");
  if (btn) {
    btn.classList.toggle("gps-toggle--on", value);
    btn.setAttribute("aria-pressed", String(value));
  }
}

function getReadheadSecClamped(): number {
  if (!timeline) return 0;
  const sec = dateToSecFloat(new Date(toMs(timeline.getCustomTime(readheadId))));
  return Math.max(0, sec);
}

/** Default state for "Create New Show": one layer, one event at 5s (no clip). */
function getDefaultNewShowState(): TimelineStateJSON {
  return {
    version: 1,
    title: "Untitled Show",
    requestsGPS: false,
    layers: [{ id: "layer-1", label: "Layer 1" }],
    items: [
      {
        id: "item-1",
        layerId: "layer-1",
        kind: "event",
        startSec: 5,
        label: "Event item-1",
        effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      },
    ],
    readheadSec: 0,
  };
}

/** Rainbow Cycle: uses 3 layers with different rainbow progressions over 60 seconds */
function getRainbowCycleTemplate(): TimelineStateJSON {
  const layers = [
    { id: "layer-1", label: "Primary Rainbow" },
    { id: "layer-2", label: "Secondary Colors" },
    { id: "layer-3", label: "Accent Colors" },
  ];
  
  // Layer 1: Main rainbow sequence (every 5 seconds)
  const layer1Colors = [
    { hex: "#FF0000", name: "Red" },
    { hex: "#FF7F00", name: "Orange" },
    { hex: "#FFFF00", name: "Yellow" },
    { hex: "#00FF00", name: "Green" },
    { hex: "#0000FF", name: "Blue" },
    { hex: "#8B00FF", name: "Violet" },
  ];
  
  // Layer 2: Complementary colors (every 6 seconds, offset by 1s)
  const layer2Colors = [
    { hex: "#00FFFF", name: "Cyan" },
    { hex: "#FF00FF", name: "Magenta" },
    { hex: "#7FFF00", name: "Chartreuse" },
    { hex: "#FF1493", name: "Deep Pink" },
    { hex: "#00CED1", name: "Turquoise" },
  ];
  
  // Layer 3: Accent colors (every 4 seconds, offset by 2s)
  const layer3Colors = [
    { hex: "#FFD700", name: "Gold" },
    { hex: "#FF69B4", name: "Hot Pink" },
    { hex: "#00FA9A", name: "Spring Green" },
    { hex: "#BA55D3", name: "Orchid" },
    { hex: "#FF4500", name: "Orange Red" },
    { hex: "#1E90FF", name: "Dodger Blue" },
  ];
  
  const items: TimelineStateJSON["items"] = [];
  let itemId = 1;
  
  // Layer 1: Events every 5 seconds for full 60 seconds
  for (let i = 0; i < 12; i++) {
    const color = layer1Colors[i % layer1Colors.length];
    items.push({
      id: `rainbow-1-${itemId++}`,
      layerId: "layer-1",
      kind: "event",
      startSec: i * 5,
      label: color.name,
      effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      color: color.hex,
      target: "All",
    });
  }
  
  // Layer 2: Events every 6 seconds, offset by 1 second
  for (let i = 0; i < 10; i++) {
    const color = layer2Colors[i % layer2Colors.length];
    items.push({
      id: `rainbow-2-${itemId++}`,
      layerId: "layer-2",
      kind: "event",
      startSec: 1 + i * 6,
      label: color.name,
      effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      color: color.hex,
      target: "All",
    });
  }
  
  // Layer 3: Events every 4 seconds, offset by 2 seconds
  for (let i = 0; i < 15; i++) {
    const color = layer3Colors[i % layer3Colors.length];
    items.push({
      id: `rainbow-3-${itemId++}`,
      layerId: "layer-3",
      kind: "event",
      startSec: 2 + i * 4,
      label: color.name,
      effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      color: color.hex,
      target: "All",
    });
  }
  
  return {
    version: 1,
    title: "Rainbow Cycle",
    requestsGPS: false,
    layers,
    items,
    readheadSec: 0,
  };
}

/** Breathe: gentle pulse between blue shades for a full minute */
function getBreatheTemplate(): TimelineStateJSON {
  const items: TimelineStateJSON["items"] = [];
  const colors = [
    { hex: "#001f3f", name: "Navy" },
    { hex: "#0047AB", name: "Cobalt" },
    { hex: "#4169E1", name: "Royal Blue" },
    { hex: "#87CEEB", name: "Sky Blue" },
    { hex: "#ADD8E6", name: "Light Blue" },
    { hex: "#87CEEB", name: "Sky Blue" },
    { hex: "#4169E1", name: "Royal Blue" },
    { hex: "#0047AB", name: "Cobalt" },
  ];
  
  // Create 20 events over 60 seconds (every 3 seconds)
  for (let i = 0; i < 20; i++) {
    const color = colors[i % colors.length];
    items.push({
      id: `breathe-${i + 1}`,
      layerId: "layer-1",
      kind: "event",
      startSec: i * 3,
      label: color.name,
      effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      color: color.hex,
      target: "All",
    });
  }
  
  return {
    version: 1,
    title: "Breathe",
    requestsGPS: false,
    layers: [{ id: "layer-1", label: "Layer 1" }],
    items,
    readheadSec: 0,
  };
}

/** Party Mode: energetic rapid color changes between vibrant colors */
function getPartyModeTemplate(): TimelineStateJSON {
  const items: TimelineStateJSON["items"] = [];
  const colors = [
    { hex: "#FF0000", name: "Red" },
    { hex: "#00FF00", name: "Green" },
    { hex: "#0000FF", name: "Blue" },
    { hex: "#FFFF00", name: "Yellow" },
  ];
  
  // Create 20 events over 60 seconds (every 3 seconds)
  for (let i = 0; i < 20; i++) {
    const color = colors[i % colors.length];
    items.push({
      id: `party-${i + 1}`,
      layerId: "layer-1",
      kind: "event",
      startSec: i * 3,
      label: color.name,
      effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      color: color.hex,
      target: "All",
    });
  }
  
  return {
    version: 1,
    title: "Party Mode",
    requestsGPS: false,
    layers: [{ id: "layer-1", label: "Layer 1" }],
    items,
    readheadSec: 0,
  };
}

export type TemplateType = "blank" | "rainbow" | "breathe" | "party";

/** Get a template show state by type */
export function getTemplateState(templateType: TemplateType): TimelineStateJSON {
  switch (templateType) {
    case "rainbow":
      return getRainbowCycleTemplate();
    case "breathe":
      return getBreatheTemplate();
    case "party":
      return getPartyModeTemplate();
    case "blank":
    default:
      return getDefaultNewShowState();
  }
}

/** Load a template into an existing show by showId */
export async function applyTemplateToShow(showId: string, templateType: TemplateType): Promise<void> {
  const state = getTemplateState(templateType);
  await fetch(`/api/admin/shows/${showId}/timeline`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(state),
  });
}

function refreshDetailsPanel(forceItemId?: IdType): void {
  if (!timelineDetailsPanelEl) return;
  const itemId = forceItemId ?? timeline?.getSelection()?.[0];
  if (itemId == null) {
    updateDetailsPanel(
      timelineDetailsPanelEl,
      null,
      () => null,
      () => {},
      () => []
    );
    ensureReadOnlyBadge();
    return;
  }
  updateDetailsPanel(
    timelineDetailsPanelEl,
    itemId,
    (id) => items.get(id) as (DataItem & { payload?: TimelineItemPayload }) | null,
    updateItemInTimeline,
    getLayers,
    (currentItemId) => refreshDetailsPanel(currentItemId)
  );
  ensureReadOnlyBadge();
}

function ensureReadOnlyBadge(): void {
  if (!isBroadcastMode || !timelineDetailsPanelEl) return;
  if (timelineDetailsPanelEl.querySelector(".timeline-details-readonly-badge")) return;
  ensureReadOnlyHeaderRow();
}

/** In broadcast mode, wrap the details panel h3 in a header row with badge and info so they stay on one line. */
function ensureReadOnlyHeaderRow(): void {
  if (!timelineDetailsPanelEl) return;
  const detailsH3 = timelineDetailsPanelEl.querySelector("h3");
  if (!detailsH3) return;
  let wrapper = timelineDetailsPanelEl.querySelector(".timeline-details-header-row") as HTMLElement | null;
  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.className = "timeline-details-header-row";
    timelineDetailsPanelEl.insertBefore(wrapper, detailsH3);
    wrapper.appendChild(detailsH3);
  }
  if (wrapper.querySelector(".timeline-details-readonly-badge")) return;
  const badge = document.createElement("span");
  badge.className = "timeline-details-readonly-badge";
  badge.textContent = "Read Only";
  wrapper.appendChild(badge);
  const infoBubble = createInfoBubble({
    tooltipText: "When in Broadcasting mode, no changes to the timeline can be made.",
    ariaLabel: "Read only info",
  });
  infoBubble.classList.add("timeline-details-readonly-info");
  wrapper.appendChild(infoBubble);
}

function showTimelineContent(): void {
  if (!timelineWrapEl) return;
  const emptyState = timelineWrapEl.querySelector(".timeline-empty-state");
  const content = timelineWrapEl.querySelector(".timeline-content");
  emptyState?.classList.add("timeline-empty-state--hidden");
  content?.classList.remove("timeline-content--hidden");
  timelinePageBodyEl?.classList.remove("timeline-page-body--details-hidden");
  hasLoadedShow = true;
}

function ensureTimelineCreated(): void {
  if (timeline != null) return;
  if (!timelineMountEl || !timelineDetailsPanelEl) return;
  const loadingEl = timelineLoadingEl;
  timeline = new Timeline(
    timelineMountEl,
    items,
    groups,
    {
      start: defaultTimeZero,
      end: timeToDate(60),
      min: defaultTimeZero,
      max: timeToDate(600),
      zoomMin: 100,
      zoomMax: 600 * SEC,
      orientation: "top",
      showCurrentTime: false,
      snap: null,
      format: {
        minorLabels: (date: unknown) => `${toMs(date as Date | number | { valueOf(): number }) / SEC}s`,
        majorLabels: (date: unknown) => `${toMs(date as Date | number | { valueOf(): number }) / SEC}s`,
      },
      editable: { add: false, remove: false, updateGroup: false, updateTime: true },
      itemsAlwaysDraggable: { item: true, range: true },
      margin: { item: 10, axis: 4 },
      stack: false,
      multiselect: true,
      selectable: true,
      verticalScroll: true,
      groupHeightMode: "fixed",
      groupTemplate: (data: { id: IdType; content: string }, _element: HTMLElement) => {
        const key = String(data?.id ?? "");
        let wrap = groupLabelCache.get(key);
        if (wrap) {
          const nameEl = wrap.querySelector(".timeline-layer-label-name") as HTMLElement | null;
          if (nameEl) {
            nameEl.textContent = String(data.content ?? "");
            nameEl.title = "Double-click to rename";
          }
          return wrap;
        }
        wrap = createGroupLabelElement(
          data,
          (id) => removeLayer(id),
          (id, newContent) => {
            groups.update({ id, content: newContent });
            refreshDetailsPanel();
            scheduleAutosave();
          }
        );
        groupLabelCache.set(key, wrap);
        return wrap;
      },
      onInitialDrawComplete: () => {
        requestAnimationFrame(() => {
          if (loadingEl) {
            loadingEl.classList.add("timeline-loading--hidden");
            loadingEl.setAttribute("aria-hidden", "true");
          }
          injectAddLayerButton();
          updateOnlyLayerVisibility();
          /* Force a redraw after DOM has settled so layers don't overlap the ruler on first load
             (vis-timeline can stop after its redraw limit and leave layout wrong until interaction). */
          requestAnimationFrame(() => {
            timeline?.redraw();
          });
        });
      },
    }
  );
  timeline.addCustomTime(defaultTimeZero, readheadId);
  timeline.setCustomTimeTitle("Readhead", readheadId);
  items.on("update", () => scheduleAutosave());
  timeline.on("timechange", (props: { id?: string; time?: Date | number }) => {
    if (props.id !== readheadId || !timeline) return;
    const sec = dateToSecFloat(new Date(toMs(props.time ?? 0)));
    if (sec < 0) timeline.setCustomTime(timeToDate(0), readheadId);
    postBroadcastReadheadDebounced(sec);
  });
  timeline.on("select", (props) => {
    updateDetailsPanel(
      timelineDetailsPanelEl as HTMLElement,
      props.items?.[0] ?? null,
      (id) => items.get(id) as (DataItem & { payload?: TimelineItemPayload }) | null,
      updateItemInTimeline,
      getLayers,
      (currentItemId) => refreshDetailsPanel(currentItemId)
    );
  });
  timeline.on("deselect", () => {
    updateDetailsPanel(
      timelineDetailsPanelEl as HTMLElement,
      null,
      () => null,
      () => {},
      () => []
    );
  });
  if (!deleteKeyListenerAdded) {
    deleteKeyListenerAdded = true;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Delete") return;
      if (!timeline) return;
      if (isBroadcastMode) return;
      const sel = timeline.getSelection();
      if (!sel?.length) return;
      const tag = document.activeElement?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      sel.forEach((id) => items.remove(id));
      scheduleAutosave();
      updateDetailsPanel(
        timelineDetailsPanelEl as HTMLElement,
        null,
        () => null,
        () => {},
        () => []
      );
    });
  }
  /* Do not call updateOnlyLayerVisibility from groups.on("*") — "*" fires during vis-timeline's
   * internal redraws and would schedule a RAF that mutates label DOM and triggers a redraw loop.
   * We call it from onInitialDrawComplete, addLayer, and removeLayer only. */
}

/** Load state into timeline and show toolbar + timeline. Call when opening a show or creating new. */
function loadShowState(state: TimelineStateJSON): void {
  groupLabelCache.clear();
  ensureTimelineCreated();
  importState(
    state,
    groups,
    items,
    (sec) => timeline?.setCustomTime(timeToDate(sec), readheadId),
    (ids: NextIds) => {
      nextItemId = ids.nextItemId;
      nextLayerId = ids.nextLayerId;
    },
    (title) => {
      projectTitle = title;
      const el = document.getElementById("timeline-project-title-input");
      if (el instanceof HTMLInputElement) el.value = title;
    },
    (value) => setRequestsGPS(value)
  );
  showTimelineContent();
  timeline?.fit();
  /* Timeline is created while .timeline-content is hidden, so vis-timeline's first draw runs with
   * zero-sized container and readhead/events/axis don't render. rAF and redraw() alone are not
   * enough; vis-timeline only recalculates layout on resize. Trigger a resize so it redraws. */
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
  }, 0);
  if (isBroadcastMode && timeline) {
    timeline.setOptions({
      editable: { add: false, remove: false, updateGroup: false, updateTime: false },
    });
    timelineContentEl?.classList.add("timeline-readhead-no-drag");
  }
}

function setAutosaveUI(state: "saved" | "syncing"): void {
  if (!timelineAutosaveEl) return;
  if (state === "saved") {
    timelineAutosaveEl.innerHTML = `<span class="timeline-autosave-icon">${circleCheckIcon}</span><span>Saved</span>`;
    timelineAutosaveEl.classList.remove("timeline-autosave--syncing");
  } else {
    timelineAutosaveEl.innerHTML = `<span class="timeline-autosave-icon timeline-autosave-icon--spin">${animatedLoadingIcon}</span><span>Syncing</span>`;
    timelineAutosaveEl.classList.add("timeline-autosave--syncing");
  }
}

function scheduleAutosave(): void {
  if (autosaveTimerId != null) {
    clearTimeout(autosaveTimerId);
    autosaveTimerId = null;
  }
  autosaveTimerId = setTimeout(() => {
    autosaveTimerId = null;
    runAutosave();
  }, AUTOSAVE_DEBOUNCE_MS);
}

async function runAutosave(): Promise<void> {
  if (!currentShowId || !hasLoadedShow) return;
  const syncingStartedAt = Date.now();
  setAutosaveUI("syncing");
  try {
    await fetch(`/api/admin/show-workspaces/${currentShowId}/timeline`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(getExportState()),
    });
    const elapsed = Date.now() - syncingStartedAt;
    const minDisplayRemaining = Math.max(0, MIN_SYNCING_DISPLAY_MS - elapsed);
    if (minDisplayRemaining > 0) {
      await new Promise((r) => setTimeout(r, minDisplayRemaining));
    }
    setAutosaveUI("saved");
  } catch {
    const elapsed = Date.now() - syncingStartedAt;
    const minDisplayRemaining = Math.max(0, MIN_SYNCING_DISPLAY_MS - elapsed);
    if (minDisplayRemaining > 0) {
      await new Promise((r) => setTimeout(r, minDisplayRemaining));
    }
    setAutosaveUI("saved");
  }
}

async function loadTimelineFromServer(showId: string): Promise<void> {
  try {
    const res = await fetch(`/api/admin/show-workspaces/${showId}/timeline`, { credentials: "include" });
    if (res.status === 403) {
      window.location.pathname = "/timeline";
      return;
    }
    if (res.status === 404) {
      loadShowState(getDefaultNewShowState());
      hasLoadedShow = true;
      setAutosaveUI("saved");
      return;
    }
    if (!res.ok) {
      return;
    }
    const state = (await res.json()) as TimelineStateJSON;
    if (state.version !== 1 || !Array.isArray(state.layers) || !Array.isArray(state.items)) {
      loadShowState(getDefaultNewShowState());
    } else {
      loadShowState(state);
    }
    hasLoadedShow = true;
    setAutosaveUI("saved");
  } catch {
    loadShowState(getDefaultNewShowState());
    hasLoadedShow = true;
    setAutosaveUI("saved");
  }
}

export function render(container: HTMLElement, showId: string | null): void {
  timeline = null;
  hasLoadedShow = false;
  currentShowId = showId;
  isBroadcastMode = false;
  requestsGPS = false;
  groups = new DataSet<DataGroup>([]);
  items = new DataSet<DataItem & { payload?: TimelineItemPayload }>([]);
  timelineAutosaveEl = null;

  if (showId === null) {
    if (timelineLiveStateListenerRef) {
      window.removeEventListener(LIVE_STATE_EVENT_NAME, timelineLiveStateListenerRef);
      timelineLiveStateListenerRef = null;
    }
    container.innerHTML = `
      <div class="show-required-empty-state">
        <p class="show-required-empty-state-message">Please open or create a show to view or play its timeline.</p>
      </div>`;
    return;
  }

  const MESSAGE_NOT_LIVE = "Because the show is not live, you can edit this timeline.";
  const MESSAGE_LIVE = "Because the show is live, you can NOT edit this show, but you can now broadcast it.";

  container.innerHTML = `
    <div class="timeline-page">
      <div class="timeline-actions-row">
        <p class="timeline-live-status-message" id="timeline-live-status-message">${MESSAGE_NOT_LIVE}</p>
      </div>
      <div class="timeline-page-body timeline-page-body--details-hidden">
        <div class="timeline">
          <div class="timeline-empty-state" id="timeline-empty-state">
            <p class="timeline-empty-state-message">Loading…</p>
          </div>
          <div class="timeline-content timeline-content--hidden">
            <div class="timeline-toolbar timeline-toolbar-row2">
              <div class="timeline-toolbar-left">
                <div class="timeline-toolbar-left-edit" id="timeline-toolbar-left-edit">
                  <div class="timeline-save-status-wrap">
                    <span class="timeline-autosave" id="timeline-autosave"><span class="timeline-autosave-icon">${circleCheckIcon}</span><span>Saved</span></span>
                  </div>
                  <span class="timeline-toolbar-gps">
                    <span class="timeline-toolbar-gps-label">Request Client GPS:</span>
                    <button type="button" class="mode-switch-toggle gps-toggle" id="timeline-request-gps-toggle" aria-pressed="false" aria-label="Request GPS">
                      <span class="mode-switch-track">
                        <span class="mode-switch-knob"></span>
                      </span>
                    </button>
                  </span>
                </div>
              </div>
              <div class="timeline-toolbar-spacer" id="timeline-toolbar-spacer"></div>
              <div class="timeline-toolbar-center" id="timeline-toolbar-center" hidden>
                <button type="button" class="btn btn-icon-only" data-action="restart" aria-label="Restart from beginning">${resetIcon}</button>
                <button type="button" class="btn btn-icon-only" data-action="play" aria-label="Play">${playIcon}</button>
                <button type="button" class="btn btn-icon-only" data-action="pause" aria-label="Pause">${pauseIcon}</button>
              </div>
              <div class="timeline-toolbar-right" id="timeline-toolbar-right">
                <button type="button" class="btn btn-primary" data-action="add-event">Add event</button>
                <button type="button" class="btn btn-danger" data-action="remove-item">Remove selected</button>
              </div>
            </div>
            <div class="timeline-container-wrap">
              <div class="timeline-loading timeline-loading--hidden" id="timeline-loading" aria-hidden="true">
                <span class="timeline-loading-icon">${animatedLoadingIcon}</span>
              </div>
              <div id="timeline-mount"></div>
            </div>
          </div>
        </div>
        <section class="timeline-details-panel" aria-label="Selected item details">
          <h3>Selection</h3>
          <div class="timeline-details-body">
            <p class="no-selection">Select an item on the timeline to view or edit its details.</p>
          </div>
        </section>
      </div>
    </div>
  `;

  const timelineWrap = container.querySelector(".timeline") as HTMLElement | null;
  const pageBody = container.querySelector(".timeline-page-body") as HTMLElement | null;
  const mount = container.querySelector("#timeline-mount");
  const detailsPanel = container.querySelector(".timeline-details-panel");
  const loadingEl = container.querySelector("#timeline-loading");

  timelineWrapEl = timelineWrap;
  timelinePageBodyEl = pageBody;
  timelineContentEl = container.querySelector(".timeline-content") as HTMLElement | null;
  timelineMountEl = mount as HTMLElement | null;
  timelineDetailsPanelEl = detailsPanel as HTMLElement | null;
  timelineLoadingEl = loadingEl as HTMLElement | null;

  const statusMessageEl = container.querySelector("#timeline-live-status-message") as HTMLElement | null;
  const toolbarLeftEditEl = container.querySelector("#timeline-toolbar-left-edit") as HTMLElement | null;
  const toolbarSpacerEl = container.querySelector("#timeline-toolbar-spacer") as HTMLElement | null;
  const toolbarCenterEl = container.querySelector("#timeline-toolbar-center") as HTMLElement | null;
  const toolbarRightEl = container.querySelector("#timeline-toolbar-right") as HTMLElement | null;

  function updateLiveStatusMessage(liveOrPending: boolean): void {
    if (statusMessageEl) {
      statusMessageEl.textContent = liveOrPending ? MESSAGE_LIVE : MESSAGE_NOT_LIVE;
    }
    if (toolbarLeftEditEl) toolbarLeftEditEl.hidden = liveOrPending;
    if (toolbarSpacerEl) toolbarSpacerEl.hidden = liveOrPending;
    if (toolbarCenterEl) toolbarCenterEl.hidden = !liveOrPending;
    if (toolbarRightEl) toolbarRightEl.hidden = liveOrPending;
  }

  function applyBroadcastUI(): void {
    isBroadcastMode = true;
    timelineContentEl?.classList.add("timeline-content--broadcast");
    timelineDetailsPanelEl?.classList.add("timeline-details-panel--readonly");
    ensureReadOnlyHeaderRow();
    timeline?.setOptions({
      editable: { add: false, remove: false, updateGroup: false, updateTime: false },
    });
    updateLiveStatusMessage(true);
  }

  function revertBroadcastUI(): void {
    isBroadcastMode = false;
    stopBroadcastReadheadTick();
    timelineContentEl?.classList.remove("timeline-readhead-no-drag");
    timelineContentEl?.classList.remove("timeline-content--broadcast");
    timelineDetailsPanelEl?.classList.remove("timeline-details-panel--readonly");
    const wrapper = timelineDetailsPanelEl?.querySelector(".timeline-details-header-row");
    if (wrapper && wrapper.parentNode) {
      const h3 = wrapper.querySelector("h3");
      if (h3) timelineDetailsPanelEl?.insertBefore(h3, wrapper);
      wrapper.remove();
    }
    timeline?.setOptions({
      editable: { add: false, remove: false, updateGroup: false, updateTime: true },
    });
    updateLiveStatusMessage(false);
  }

  function applyLiveState(live: boolean, pending: boolean): void {
    const liveOrPending = live || pending;
    if (liveOrPending) {
      applyBroadcastUI();
    } else {
      revertBroadcastUI();
    }
  }

  if (timelineLiveStateListenerRef) {
    window.removeEventListener(LIVE_STATE_EVENT_NAME, timelineLiveStateListenerRef);
  }
  timelineLiveStateListenerRef = (e: Event) => {
    const ev = e as CustomEvent<{ showId: string; live: boolean; pending?: boolean }>;
    if (ev.detail?.showId !== currentShowId) return;
    const live = ev.detail.live === true;
    const pending = ev.detail.pending === true;
    applyLiveState(live, pending);
  };
  window.addEventListener(LIVE_STATE_EVENT_NAME, timelineLiveStateListenerRef);

  timelineAutosaveEl = container.querySelector("#timeline-autosave");

  if (!mount || !detailsPanel) return;

  container.querySelector("#timeline-request-gps-toggle")?.addEventListener("click", () => {
    setRequestsGPS(!requestsGPS);
    scheduleAutosave();
  });
  setRequestsGPS(requestsGPS);

  container.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", async () => {
      const action = (el as HTMLElement).getAttribute("data-action");
      switch (action) {
        case "restart": {
          // Set readhead to 0 and start playing
          if (timeline) {
            timeline.setCustomTime(timeToDate(0), readheadId);
          }
          console.log("User hit restart, playing from beginning.");
          try {
            if (!currentShowId) throw new Error("No show selected");
            const res = await fetch(`/api/admin/shows/${currentShowId}/broadcast/play`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ readheadSec: 0 }),
              credentials: "include",
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = (await res.json()) as { playAtMs?: number; serverTimeMs?: number };
            const playAtMs = data.playAtMs ?? 0;
            if (data.serverTimeMs != null) {
              serverTimeOffsetMs = data.serverTimeMs - Date.now();
            }
            broadcastPlayAtMs = playAtMs;
            broadcastReadheadSec = 0;
            broadcastPauseAtMs = null;
            startBroadcastReadheadTick();
            timeline?.setOptions({
              editable: { add: false, remove: false, updateGroup: false, updateTime: false },
            });
            timelineContentEl?.classList.add("timeline-readhead-no-drag");
            console.log("Restarting timeline from beginning at", playAtMs);
          } catch (e) {
            console.error("Broadcast restart failed:", e);
          }
          break;
        }
        case "play": {
          const readheadSec = getReadheadSecClamped();
          console.log("User hit play from", readheadSec, "(readhead sec).");
          try {
            if (!currentShowId) throw new Error("No show selected");
            const res = await fetch(`/api/admin/shows/${currentShowId}/broadcast/play`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ readheadSec }),
              credentials: "include",
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = (await res.json()) as { playAtMs?: number; serverTimeMs?: number };
            const playAtMs = data.playAtMs ?? 0;
            if (data.serverTimeMs != null) {
              serverTimeOffsetMs = data.serverTimeMs - Date.now();
            }
            broadcastPlayAtMs = playAtMs;
            broadcastReadheadSec = readheadSec;
            broadcastPauseAtMs = null;
            startBroadcastReadheadTick();
            timeline?.setOptions({
              editable: { add: false, remove: false, updateGroup: false, updateTime: false },
            });
            timelineContentEl?.classList.add("timeline-readhead-no-drag");
            console.log("Planning to start playing timeline at", playAtMs);
            console.log("Starting to send json to all clients");
            console.log("Finished sending to all clients");
            setTimeout(() => {
              console.log("All clients should have started playing the timeline now.");
            }, 1000);
          } catch (e) {
            console.error("Broadcast play failed:", e);
          }
          break;
        }
        case "pause": {
          try {
            if (!currentShowId) throw new Error("No show selected");
            const res = await fetch(`/api/admin/shows/${currentShowId}/broadcast/pause`, { method: "POST", credentials: "include" });
            if (!res.ok) throw new Error(String(res.status));
            const data = (await res.json()) as { pauseAtMs?: number; serverTimeMs?: number };
            const pauseAtMs = data.pauseAtMs ?? 0;
            if (data.serverTimeMs != null) {
              serverTimeOffsetMs = data.serverTimeMs - Date.now();
            }
            broadcastPauseAtMs = pauseAtMs;
            timeline?.setOptions({
              editable: { add: false, remove: false, updateGroup: false, updateTime: true },
            });
            timelineContentEl?.classList.remove("timeline-readhead-no-drag");
            console.log("User requested a pause. Planning to pause at", pauseAtMs);
            console.log("Sending pause instruction to clients to pause at", pauseAtMs);
            console.log("Finished sending pause request");
            setTimeout(() => {
              console.log("All clients should be pausing NOW");
            }, 1000);
          } catch (e) {
            console.error("Broadcast pause failed:", e);
          }
          break;
        }
        case "add-clip":
          addClip();
          timeline?.fit();
          break;
        case "add-event":
          addEvent();
          timeline?.fit();
          break;
        case "remove-item":
          removeSelected();
          updateDetailsPanel(
            detailsPanel as HTMLElement,
            null,
            () => null,
            () => {},
            () => []
          );
          break;
      }
    });
  });

  // Load timeline first, then fetch live state and apply. This ensures the timeline is
  // always created and shown before we apply broadcast UI (so opening the tab while live works).
  loadTimelineFromServer(showId).then(() => {
    if (currentShowId !== showId) return;
    fetch(`/api/admin/show-workspaces/${showId}/live-join-url`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { live: false }))
      .then((data: { live?: boolean }) => {
        if (currentShowId !== showId) return;
        applyLiveState(data.live === true, false);
      })
      .catch(() => {
        if (currentShowId !== showId) return;
        applyLiveState(false, false);
      });
  });
}
