import "./styles/index.css";
import animatedLoadingIcon from "../../icons/animatedLoadingIcon.svg?raw";
import circleCheckIcon from "../../icons/circle-check.svg?raw";
import pauseIcon from "../../icons/pause.svg?raw";
import playIcon from "../../icons/play.svg?raw";
import resetIcon from "../../icons/reset.svg?raw";
import treeIcon from "../../icons/tree.svg?raw";
import { timeToDate } from "./types";
import type { TimelineStateJSON } from "./types";
import { createCustomTimelineView, type CustomTimelineView } from "./timelineEditor/custom-timeline";
import { createInfoBubble } from "../../components/info-bubble";
import { createResizableSplit } from "../../components/resizable-split";
import { createTabbedPane } from "../../components/tabbed-pane";
import type { DetailsPanelUpdates } from "./details-panel";
import { updateDetailsPanel } from "./details-panel";
import { renderPreviewPanel } from "./preview";
import { renderAssetsPanel } from "./assets";
import {
  exportState,
  importState,
  type NextIds,
  type LayersArray,
  type ItemsArray,
} from "./state-serialization";
import {
  closeTrackAssignmentsDropdown,
  openTrackAssignmentsDropdown,
  setTrackAssignmentsRoot,
  isTrackAssignmentsDropdownOpen,
} from "./track-assignments";
import { getDefaultTrackAssignments } from "./track-assignments";
import type { TrackAssignmentsRoot } from "./track-assignments";
export type { TimelineItemPayload, TimelineStateJSON } from "./types";
import { openModal as openVideoImportModal } from "./import-from-video";
import type { VideoImportEvent } from "./import-from-video";

let layers: LayersArray = [];
let items: ItemsArray = [];
let readheadSec = 0;
let selectedItemId: string | null = null;
let draggingRangeId: string | null = null;
let customTimelineView: CustomTimelineView | null = null;
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
/** Last applied live-or-pending state; only apply when it changes (avoids re-running broadcast UI on every 30s poll). */
let timelineLastLiveOrPending: boolean | null = null;
/** Set in render(); used when loading a show to create timeline and show content. */
let timelineWrapEl: HTMLElement | null = null;
let timelineContentEl: HTMLElement | null = null;
let timelinePageBodyEl: HTMLElement | null = null;
let timelineMountEl: HTMLElement | null = null;
let timelineDetailsPanelEl: HTMLElement | null = null;
let timelineLoadingEl: HTMLElement | null = null;

/** RAF id for throttling timeline update during event/range drag (one redraw per frame). */
let dragUpdateRafId: number | null = null;
let dragUpdateItemId: string | null = null;

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

function setReadheadSec(sec: number): void {
  readheadSec = Math.max(0, sec);
  if (customTimelineView?.scheduleUpdate) {
    customTimelineView.scheduleUpdate();
  } else {
    customTimelineView?.update();
  }
}

function tickBroadcastReadhead(): void {
  if (broadcastPlayAtMs == null) return;
  const nowMs = getServerTimeMs();
  if (nowMs < broadcastPlayAtMs) return;
  if (broadcastPauseAtMs != null && nowMs >= broadcastPauseAtMs) {
    return;
  }
  const sec = broadcastReadheadSec + (nowMs - broadcastPlayAtMs) / 1000;
  setReadheadSec(sec);
}

function postBroadcastReadheadDebounced(sec: number): void {
  if (!isBroadcastMode) return;
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
  if (!layers.length) {
    addLayer();
  }
}

function addLayer(): string {
  const id = String(nextLayerId++);
  const label = `Layer ${id}`;
  layers.push({ id, label });
  customTimelineView?.update();
  refreshDetailsPanel();
  scheduleAutosave();
  return id;
}

function removeLayer(id: string): void {
  if (layers.length <= 1) return;
  layers = layers.filter((l) => l.id !== id);
  items = items.filter((it) => it.layerId !== id);
  customTimelineView?.update();
  refreshDetailsPanel();
  scheduleAutosave();
}

function getDefaultStartSec(): number {
  const range = customTimelineView?.getVisibleRange?.();
  return range ? (range.startSec + range.endSec) / 2 : 0;
}

function addRange(layerId?: string): string {
  ensureGroups();
  const gid = layerId ?? layers[0].id;
  const start = getDefaultStartSec();
  const end = start + 5;
  const id = `item-${nextItemId++}`;
  items.push({
    id,
    layerId: gid,
    kind: "range",
    startSec: start,
    endSec: end,
    label: `Range ${id}`,
    rangeType: "Audio",
    filePath: "",
  });
  customTimelineView?.update();
  scheduleAutosave();
  return id;
}

function addEvent(layerId?: string): string {
  ensureGroups();
  const gid = layerId ?? layers[0].id;
  const at = getDefaultStartSec();
  const id = `item-${nextItemId++}`;
  items.push({
    id,
    layerId: gid,
    kind: "event",
    startSec: at,
    label: `Event ${id}`,
    effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
  });
  customTimelineView?.update();
  scheduleAutosave();
  return id;
}

function removeSelected(): void {
  if (selectedItemId == null) return;
  items = items.filter((it) => it.id !== selectedItemId);
  selectedItemId = null;
  customTimelineView?.update();
  refreshDetailsPanel();
  scheduleAutosave();
}

function getLayers(): { id: string; label: string }[] {
  return layers.map((l) => ({ id: l.id, label: l.label }));
}

/** Add multiple "Set Color Broadcast" events from video import; used by the video-import modal. */
function addEventsFromVideo(events: VideoImportEvent[], layerId: string): void {
  ensureGroups();
  const gid = layerId || layers[0].id;
  events.forEach((ev) => {
    const id = `video-${nextItemId++}`;
    items.push({
      id,
      layerId: gid,
      kind: "event",
      startSec: ev.startSec,
      label: id,
      effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      color: ev.color,
    });
  });
  customTimelineView?.update();
  scheduleAutosave();
}

function updateItemInTimeline(id: string, updates: DetailsPanelUpdates): void {
  const item = items.find((it) => it.id === id);
  if (!item) return;
  if (updates.startSec !== undefined) {
    const sec = Number(updates.startSec);
    if (!Number.isNaN(sec) && sec >= 0) {
      const dur = item.kind === "range" && item.endSec != null ? item.endSec - item.startSec : 0;
      item.startSec = sec;
      if (item.kind === "range") item.endSec = sec + dur;
    }
  }
  if (updates.endSec !== undefined) {
    const sec = Number(updates.endSec);
    if (!Number.isNaN(sec) && sec >= 0 && item.kind === "range") {
      item.endSec = sec;
    }
  }
  if (updates.layerId !== undefined) item.layerId = updates.layerId;
  if (updates.label !== undefined) item.label = updates.label || undefined;
  if (updates.effectType !== undefined) item.effectType = updates.effectType || undefined;
  if (updates.color !== undefined) item.color = updates.color || undefined;
  if (updates.rangeType !== undefined && item.kind === "range") {
    item.rangeType = updates.rangeType;
  }
  if (updates.filePath !== undefined && item.kind === "range") {
    item.filePath = updates.filePath;
  }
  customTimelineView?.update();
  scheduleAutosave();
}

function getExportState(): TimelineStateJSON {
  return exportState(
    () => layers,
    () => items,
    () => readheadSec,
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
  return Math.max(0, readheadSec);
}

/** Default state for "Create New Show": one layer, one event at 5s (no range). */
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
  await fetch(`/api/admin/show-workspaces/${showId}/timeline`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(state),
  });
}

function getItemForDetails(id: string): import("./details-panel").DetailsPanelItem | null {
  const it = items.find((i) => i.id === id);
  if (!it) return null;
  return {
    id: it.id,
    start: timeToDate(it.startSec),
    end: it.kind === "range" && it.endSec != null ? timeToDate(it.endSec) : undefined,
    group: it.layerId,
    payload: {
      kind: it.kind,
      label: it.label,
      effectType: it.effectType,
      color: it.color,
      rangeType: it.kind === "range" ? it.rangeType : undefined,
      filePath: it.kind === "range" ? it.filePath : undefined,
    },
  };
}

function refreshDetailsPanel(forceItemId?: string): void {
  if (!timelineDetailsPanelEl) return;
  const itemId = forceItemId ?? null;
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
    getItemForDetails,
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

/** Schedule at most one timeline update per frame during drag to reduce jitter. */
function scheduleDragUpdate(itemId: string): void {
  dragUpdateItemId = itemId;
  if (dragUpdateRafId != null) return;
  dragUpdateRafId = requestAnimationFrame(() => {
    dragUpdateRafId = null;
    const id = dragUpdateItemId;
    dragUpdateItemId = null;
    customTimelineView?.update();
    if (id != null) refreshDetailsPanel(id);
    scheduleAutosave();
  });
}

function ensureCustomTimelineCreated(): void {
  if (customTimelineView != null) return;
  if (!timelineMountEl || !timelineDetailsPanelEl) return;
  const loadingEl = timelineLoadingEl;
  customTimelineView = createCustomTimelineView(
    timelineMountEl,
    () => ({
      layers,
      items,
      readheadSec,
      selectedItemId,
      draggingRangeId,
      readheadDraggable: !timelineContentEl?.classList.contains("timeline-readhead-no-drag"),
    }),
    {
      onAddLayer: () => {
        addLayer();
        customTimelineView?.update();
      },
      onRemoveLayer: (id) => removeLayer(id),
      onRenameLayer: (id, label) => {
        const layer = layers.find((l) => l.id === id);
        if (layer) {
          layer.label = label;
          customTimelineView?.update();
          refreshDetailsPanel();
          scheduleAutosave();
        }
      },
      onSelectItem: (id) => {
        selectedItemId = id;
        refreshDetailsPanel(id ?? undefined);
        customTimelineView?.update();
      },
      onReadheadChange: (sec) => {
        setReadheadSec(sec);
        scheduleAutosave();
        postBroadcastReadheadDebounced(sec);
      },
      onMoveEvent: (itemId, startSec) => {
        const item = items.find((i) => i.id === itemId);
        if (item?.kind === "event") {
          item.startSec = startSec;
          selectedItemId = itemId;
          scheduleDragUpdate(itemId);
        }
      },
      onMoveRange: (itemId, newStartSec) => {
        const item = items.find((i) => i.id === itemId);
        if (item?.kind === "range") {
          const endSec = item.endSec ?? item.startSec + 1;
          const duration = endSec - item.startSec;
          item.startSec = newStartSec;
          item.endSec = newStartSec + duration;
          selectedItemId = itemId;
          scheduleDragUpdate(itemId);
        }
      },
      onResizeRange: (itemId, startSec, endSec) => {
        const item = items.find((i) => i.id === itemId);
        if (item?.kind === "range") {
          item.startSec = startSec;
          item.endSec = endSec;
          selectedItemId = itemId;
          scheduleDragUpdate(itemId);
        }
      },
      onRangeDragStart: (id) => {
        draggingRangeId = id;
        customTimelineView?.update();
      },
      onRangeDragEnd: () => {
        draggingRangeId = null;
        customTimelineView?.update();
      },
    },
    currentShowId ? `lumelier-timeline:${currentShowId}:viewport` : undefined
  );
  requestAnimationFrame(() => {
    if (loadingEl) {
      loadingEl.classList.add("timeline-loading--hidden");
      loadingEl.setAttribute("aria-hidden", "true");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (isBroadcastMode) return;
    if (selectedItemId == null) return;
    const tag = document.activeElement?.tagName?.toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    e.preventDefault();
    removeSelected();
  });
}

/** Load state into timeline and show toolbar + timeline. Call when opening a show or creating new. Track splitter tree is loaded separately via loadTrackSplitterTree(showId). */
function loadShowState(state: TimelineStateJSON): void {
  importState(
    state,
    (newLayers) => {
      layers = [...newLayers];
    },
    (newItems) => {
      items = [...newItems];
    },
    (sec) => setReadheadSec(sec),
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
  ensureCustomTimelineCreated();
  customTimelineView?.update();
  showTimelineContent();
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
  setAutosaveUI("syncing");
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

async function loadTrackSplitterTree(showId: string): Promise<void> {
  try {
    const res = await fetch(`/api/admin/show-workspaces/${showId}/track-splitter-tree`, {
      credentials: "include",
    });
    if (res.ok) {
      const tree = (await res.json()) as TrackAssignmentsRoot;
      if (tree?.root != null) {
        setTrackAssignmentsRoot(tree);
        return;
      }
    }
  } catch {
    // ignore
  }
  setTrackAssignmentsRoot(getDefaultTrackAssignments());
}

async function saveTrackSplitterTreeToServer(root: TrackAssignmentsRoot): Promise<void> {
  if (!currentShowId) return;
  await fetch(`/api/admin/show-workspaces/${currentShowId}/track-splitter-tree`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(root),
  });
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
      await loadTrackSplitterTree(showId);
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
    await loadTrackSplitterTree(showId);
    hasLoadedShow = true;
    setAutosaveUI("saved");
  } catch {
    loadShowState(getDefaultNewShowState());
    await loadTrackSplitterTree(showId);
    hasLoadedShow = true;
    setAutosaveUI("saved");
  }
}

export function render(container: HTMLElement, showId: string | null): void {
  customTimelineView = null;
  hasLoadedShow = false;
  currentShowId = showId;
  isBroadcastMode = false;
  requestsGPS = false;
  layers = [];
  items = [];
  readheadSec = 0;
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
                <button type="button" class="btn btn-icon-label" data-action="split-devices-tracks" aria-label="Split Devices Into Tracks">${treeIcon}Split Devices Into Tracks</button>
                <button type="button" class="btn btn-primary" data-action="import-from-video">Import from video</button>
                <button type="button" class="btn btn-primary" data-action="add-range">Add Range</button>
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
        <div class="timeline-bottom-row" id="timeline-bottom-row">
          <!-- Filled by JS with resizable split (details | preview) -->
        </div>
      </div>
    </div>
  `;

  const timelineWrap = container.querySelector(".timeline") as HTMLElement | null;
  const pageBody = container.querySelector(".timeline-page-body") as HTMLElement | null;
  const mount = container.querySelector("#timeline-mount");
  const loadingEl = container.querySelector("#timeline-loading");
  const bottomRowEl = container.querySelector("#timeline-bottom-row") as HTMLElement | null;

  /* Build bottom row: resizable split with details (left) and preview (right).
   * Storage keys include showId so tab selection and split sizes are persisted per show. */
  if (bottomRowEl) {
    const detailsSection = document.createElement("section");
    detailsSection.className = "timeline-details-panel";
    detailsSection.setAttribute("aria-label", "Selected item details");
    detailsSection.innerHTML = `
      <h3>Selection</h3>
      <div class="timeline-details-body">
        <p class="no-selection">Select an item on the timeline to view or edit its details.</p>
      </div>
    `;
    const bottomRightSection = document.createElement("section");
    bottomRightSection.className = "timeline-bottom-right-panel";
    bottomRightSection.setAttribute("aria-label", "Preview and assets");

    const { container: tabbedContainer } = createTabbedPane({
      storageKey: `lumelier-timeline:${showId}:bottom-right-tabs`,
      tabs: [
        {
          id: "preview",
          label: "Preview",
          getContent: () => {
            const el = document.createElement("div");
            el.className = "timeline-tab-content timeline-tab-content--preview";
            renderPreviewPanel(el, showId);
            return el;
          },
        },
        {
          id: "assets",
          label: "Assets",
          getContent: () => {
            const el = document.createElement("div");
            el.className = "timeline-tab-content timeline-tab-content--assets";
            renderAssetsPanel(el, currentShowId);
            return el;
          },
        },
      ],
    });

    const { container: splitContainer, panelA, panelB } = createResizableSplit("horizontal", {
      size: 50,
      min: 15,
      max: 85,
      storageKey: `lumelier-timeline:${showId}:details-preview-split`,
    });
    panelA.appendChild(detailsSection);
    bottomRightSection.appendChild(tabbedContainer);
    panelB.appendChild(bottomRightSection);
    bottomRowEl.appendChild(splitContainer);
  }

  /* Wrap timeline (top) and bottom row in a vertical resizable split */
  if (timelineWrap && bottomRowEl && pageBody) {
    const { container: verticalSplitContainer, panelA: topPanel, panelB: bottomPanel } = createResizableSplit("vertical", {
      size: 50,
      min: 20,
      max: 85,
      storageKey: `lumelier-timeline:${showId}:vertical-split`,
    });
    topPanel.appendChild(timelineWrap);
    bottomPanel.appendChild(bottomRowEl);
    pageBody.appendChild(verticalSplitContainer);
  }

  const detailsPanel = container.querySelector(".timeline-details-panel");

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
    updateLiveStatusMessage(false);
  }

  function applyLiveState(live: boolean, pending: boolean): void {
    const liveOrPending = live || pending;
    if (timelineLastLiveOrPending === liveOrPending) return;
    timelineLastLiveOrPending = liveOrPending;
    if (liveOrPending) {
      applyBroadcastUI();
    } else {
      revertBroadcastUI();
    }
  }

  if (timelineLiveStateListenerRef) {
    window.removeEventListener(LIVE_STATE_EVENT_NAME, timelineLiveStateListenerRef);
  }
  timelineLastLiveOrPending = null;
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
    el.addEventListener("click", async (e) => {
      const action = (el as HTMLElement).getAttribute("data-action");
      switch (action) {
        case "restart": {
          setReadheadSec(0);
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
        case "add-range":
          addRange();
          customTimelineView?.update();
          break;
        case "import-from-video":
          openVideoImportModal({
            getLayers,
            addEventsFromVideo,
            inBroadcastMode: () => isBroadcastMode,
          });
          break;
        case "add-event":
          addEvent();
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
        case "split-devices-tracks": {
          const btn = el as HTMLElement;
          (e as MouseEvent).stopPropagation();
          if (isTrackAssignmentsDropdownOpen()) {
            closeTrackAssignmentsDropdown();
          } else {
            openTrackAssignmentsDropdown(btn, getLayers, saveTrackSplitterTreeToServer);
          }
          break;
        }
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
