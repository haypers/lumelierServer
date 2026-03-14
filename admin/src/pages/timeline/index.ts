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
import type { DetailsPanelUpdates } from "./pageComponents/details-panel";
import { updateDetailsPanel } from "./pageComponents/details-panel";
import { renderPreviewPanel } from "./pageComponents/preview";
import { renderAssetsPanel } from "./pageComponents/assets";
import { createAssetDropOnTimelineHandler } from "./timelineEditor/asset-drop-onto-timeline";
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
} from "./pageComponents/track-assignments";
import { getDefaultTrackAssignments } from "./pageComponents/track-assignments";
import type { TrackAssignmentsRoot } from "./pageComponents/track-assignments";
export type { TimelineItemPayload, TimelineStateJSON } from "./types";
export type { TemplateType } from "./templates";
export { getTemplateState, applyTemplateToShow, getDefaultNewShowState } from "./templates";
import { getDefaultNewShowState } from "./templates";
import { openModal as openVideoImportModal } from "./pageComponents/import-from-video";
import type { VideoImportEvent } from "./pageComponents/import-from-video";
import {
  getOverlapResolution,
  isEditingRangeEngulfed,
} from "./timelineEditor/range-overlap";
import {
  initBroadcast,
  postBroadcastReadheadDebounced,
  stopBroadcastReadheadTick,
} from "./broadcast";
import { initAutosave, scheduleAutosave, setAutosaveUI } from "./autosave";
import { getEditorPageMarkup } from "./page-markup";
import { attachToolbarHandlers } from "./toolbar-handlers";
import { EDITOR_SELECTORS } from "./editor-selectors";

let layers: LayersArray = [];
let items: ItemsArray = [];
let readheadSec = 0;
let selectedItemId: string | null = null;
let draggingRangeId: string | null = null;
/** Snapshot of the range's bounds when a drag or resize started; used for overlap resolution or undo. */
let rangeEditingSnapshot: { startSec: number; endSec: number } | null = null;
let customTimelineView: CustomTimelineView | null = null;
let nextLayerId = 1;
let nextItemId = 1;
let projectTitle = "Untitled Show";
const EVENT_TYPE_SET_COLOR_BROADCAST = "Set Color Broadcast";
/** True once the user has opened or created a show; timeline and toolbar are visible. */
let hasLoadedShow = false;
/** Show ID from URL when timeline is scoped to a show; used for load and autosave. */
let currentShowId: string | null = null;
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

function setReadheadSec(sec: number): void {
  readheadSec = Math.max(0, sec);
  if (customTimelineView?.scheduleUpdate) {
    customTimelineView.scheduleUpdate();
  } else {
    customTimelineView?.update();
  }
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

function addRange(
  layerId?: string,
  startSec?: number,
  durationSec?: number,
  filePath?: string,
  rangeType?: "Image" | "Video" | "Audio"
): string {
  ensureGroups();
  const gid = layerId ?? layers[0].id;
  const start = startSec ?? getDefaultStartSec();
  const duration = durationSec ?? 5;
  const end = start + duration;
  const id = `item-${nextItemId++}`;
  items.push({
    id,
    layerId: gid,
    kind: "range",
    startSec: start,
    endSec: end,
    label: `Range ${id}`,
    rangeType: rangeType ?? "Audio",
    filePath: filePath ?? "",
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
  if (updates.positionOverlay !== undefined && item.kind === "range") {
    const prev = item.positionOverlay ?? { x: 0, y: 0, angle: 0, hs: 1, vs: 1 };
    item.positionOverlay = {
      x: updates.positionOverlay.x ?? prev.x,
      y: updates.positionOverlay.y ?? prev.y,
      angle: updates.positionOverlay.angle ?? prev.angle,
      hs: updates.positionOverlay.hs ?? prev.hs,
      vs: updates.positionOverlay.vs ?? prev.vs,
    };
  }
  customTimelineView?.update();
  scheduleAutosave();
}

function getExportState(): TimelineStateJSON {
  return exportState(
    () => layers,
    () => items,
    () => readheadSec,
    () => projectTitle
  );
}

function getReadheadSecClamped(): number {
  return Math.max(0, readheadSec);
}

function getItemForDetails(id: string): import("./pageComponents/details-panel").DetailsPanelItem | null {
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
      gpsData: it.kind === "range" ? it.gpsData : undefined,
      positionOverlay: it.kind === "range" ? it.positionOverlay : undefined,
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
      () => [],
      undefined,
      { showId: currentShowId, readonly: isBroadcastMode }
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
    (currentItemId) => refreshDetailsPanel(currentItemId),
    { showId: currentShowId, readonly: isBroadcastMode }
  );
  ensureReadOnlyBadge();
}

function ensureReadOnlyBadge(): void {
  if (!isBroadcastMode || !timelineDetailsPanelEl) return;
  if (timelineDetailsPanelEl.querySelector(EDITOR_SELECTORS.detailsReadonlyBadge)) return;
  ensureReadOnlyHeaderRow();
}

/** In broadcast mode, wrap the details panel h3 in a header row with badge and info so they stay on one line. */
function ensureReadOnlyHeaderRow(): void {
  if (!timelineDetailsPanelEl) return;
  const detailsH3 = timelineDetailsPanelEl.querySelector("h3");
  if (!detailsH3) return;
  let wrapper = timelineDetailsPanelEl.querySelector(EDITOR_SELECTORS.detailsHeaderRow) as HTMLElement | null;
  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.className = "details-header-row";
    timelineDetailsPanelEl.insertBefore(wrapper, detailsH3);
    wrapper.appendChild(detailsH3);
  }
  if (wrapper.querySelector(EDITOR_SELECTORS.detailsReadonlyBadge)) return;
  const badge = document.createElement("span");
  badge.className = "details-readonly-badge";
  badge.textContent = "Read Only";
  wrapper.appendChild(badge);
  const infoBubble = createInfoBubble({
    tooltipText: "When in Broadcasting mode, no changes to the timeline can be made.",
    ariaLabel: "Read only info",
  });
  infoBubble.classList.add("details-readonly-info");
  wrapper.appendChild(infoBubble);
}

function showTimelineContent(): void {
  if (!timelineWrapEl) return;
  const emptyState = timelineWrapEl.querySelector(EDITOR_SELECTORS.emptyState);
  const content = timelineWrapEl.querySelector(EDITOR_SELECTORS.content);
  emptyState?.classList.add("editor-empty-state--hidden");
  content?.classList.remove("editor-content--hidden");
  timelinePageBodyEl?.classList.remove("editor-page-body--details-hidden");
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
  if (!timelineMountEl?.isConnected || !timelineDetailsPanelEl?.isConnected) {
    const main = document.getElementById("admin-content");
    if (main) {
      const mount = main.querySelector(EDITOR_SELECTORS.mount);
      const details = main.querySelector(EDITOR_SELECTORS.detailsPanel);
      if (mount && details) {
        timelineMountEl = mount as HTMLElement;
        timelineDetailsPanelEl = details as HTMLElement;
      }
    }
  }
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
      readheadDraggable: !timelineContentEl?.classList.contains("editor-readhead-no-drag"),
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
        const item = items.find((i) => i.id === id);
        if (item?.kind === "range") {
          rangeEditingSnapshot = {
            startSec: item.startSec,
            endSec: item.endSec ?? item.startSec + 1,
          };
        } else {
          rangeEditingSnapshot = null;
        }
        customTimelineView?.update();
      },
      onRangeDragEnd: (didDragOrResize) => {
        const editingId = draggingRangeId;
        draggingRangeId = null;
        const snapshot = rangeEditingSnapshot;
        rangeEditingSnapshot = null;
        if (editingId == null || snapshot == null) {
          customTimelineView?.update();
          refreshDetailsPanel(selectedItemId ?? undefined);
          return;
        }
        if (!didDragOrResize) {
          customTimelineView?.update();
          refreshDetailsPanel(selectedItemId ?? undefined);
          return;
        }
        const editingItem = items.find((i) => i.id === editingId);
        if (editingItem?.kind !== "range") {
          customTimelineView?.update();
          refreshDetailsPanel(selectedItemId ?? undefined);
          return;
        }
        const editStart = editingItem.startSec;
        const editEnd = editingItem.endSec ?? editingItem.startSec + 1;
        const layerId = editingItem.layerId;
        const layerRanges = items.filter(
          (i): i is typeof i & { kind: "range" } =>
            i.kind === "range" && i.layerId === layerId && i.id !== editingId
        );
        const otherRanges = layerRanges.map((r) => ({
          id: r.id,
          startSec: r.startSec,
          endSec: r.endSec,
        }));

        const editingEngulfedByOther = layerRanges.some((other) => {
          const oEnd = other.endSec ?? other.startSec + 1;
          return isEditingRangeEngulfed(editStart, editEnd, other.startSec, oEnd);
        });
        if (editingEngulfedByOther) {
          editingItem.startSec = snapshot.startSec;
          editingItem.endSec = snapshot.endSec;
          console.log(
            "TODO: allow trimming a range into two ranges by dragging a smaller range into it."
          );
          customTimelineView?.update();
          refreshDetailsPanel(editingId);
          scheduleAutosave();
          return;
        }

        const { engulfedIds, trims } = getOverlapResolution(editStart, editEnd, otherRanges);
        const engulfedSet = new Set(engulfedIds);
        items = items.filter((it) => !engulfedSet.has(it.id));
        /* Delete events on the same layer whose timestamp is inside the editing range */
        items = items.filter((it) => {
          if (it.kind !== "event" || it.layerId !== layerId) return true;
          return it.startSec < editStart || it.startSec >= editEnd;
        });
        for (const t of trims) {
          const it = items.find((i) => i.id === t.id);
          if (it?.kind !== "range") continue;
          if (t.newStartSec != null) it.startSec = t.newStartSec;
          if (t.newEndSec != null) it.endSec = t.newEndSec;
          const end = it.endSec ?? it.startSec + 1;
          if (it.startSec >= end) {
            items = items.filter((i) => i.id !== t.id);
          }
        }
        if (!items.some((i) => i.id === editingId)) {
          selectedItemId = null;
        }
        customTimelineView?.update();
        refreshDetailsPanel(selectedItemId ?? undefined);
        scheduleAutosave();
      },
      onMoveItemToLayer: (itemId, layerId) => {
        const item = items.find((i) => i.id === itemId);
        if (item) {
          item.layerId = layerId;
          customTimelineView?.update();
          refreshDetailsPanel();
          scheduleAutosave();
        }
      },
    },
    currentShowId ? `lumelier-timeline:${currentShowId}:viewport` : undefined
  );
  requestAnimationFrame(() => {
    if (loadingEl) {
      loadingEl.classList.add("editor-loading--hidden");
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
      const el = document.getElementById(EDITOR_SELECTORS.projectTitleInput.slice(1));
      if (el instanceof HTMLInputElement) el.value = title;
    }
  );
  ensureCustomTimelineCreated();
  customTimelineView?.update();
  showTimelineContent();
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
      loadShowState(getDefaultNewShowState());
      await loadTrackSplitterTree(showId);
      hasLoadedShow = true;
      setAutosaveUI("saved");
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

  container.innerHTML = getEditorPageMarkup(
    {
      circleCheck: circleCheckIcon,
      play: playIcon,
      pause: pauseIcon,
      reset: resetIcon,
      tree: treeIcon,
      loading: animatedLoadingIcon,
    },
    { notLive: MESSAGE_NOT_LIVE, live: MESSAGE_LIVE }
  );

  const timelineWrap = container.querySelector(EDITOR_SELECTORS.timelineWrap) as HTMLElement | null;
  const pageBody = container.querySelector(EDITOR_SELECTORS.pageBody) as HTMLElement | null;
  const mount = container.querySelector(EDITOR_SELECTORS.mount);
  const loadingEl = container.querySelector(EDITOR_SELECTORS.loading);
  const bottomRowEl = container.querySelector(EDITOR_SELECTORS.bottomRow) as HTMLElement | null;

  /* Build bottom row: resizable split with details (left) and preview (right).
   * Storage keys include showId so tab selection and split sizes are persisted per show. */
  if (bottomRowEl) {
    const detailsSection = document.createElement("section");
    detailsSection.className = "details-panel";
    detailsSection.setAttribute("aria-label", "Selected item details");
    detailsSection.innerHTML = `
      <h3>Selection</h3>
      <div class="details-body">
        <p class="no-selection">Select an item on the timeline to view or edit its details.</p>
      </div>
    `;
    const bottomRightSection = document.createElement("section");
    bottomRightSection.className = "bottom-right-panel";
    bottomRightSection.setAttribute("aria-label", "Preview and assets");

    const { container: splitContainer, panelA, panelB } = createResizableSplit("horizontal", {
      size: 50,
      min: 15,
      max: 85,
      storageKey: `lumelier-timeline:${showId}:details-preview-split`,
    });
    panelA.appendChild(detailsSection);
    bottomRowEl.appendChild(splitContainer);

    const { container: tabbedContainer } = createTabbedPane({
      storageKey: `lumelier-timeline:${showId}:bottom-right-tabs`,
      tabs: [
        {
          id: "preview",
          label: "Preview",
          getContent: () => {
            const el = document.createElement("div");
            el.className = "editor-tab-content editor-tab-content--preview";
            renderPreviewPanel(el, showId, {
              onShowSyncing: () => setAutosaveUI("syncing"),
              onShowSaved: () => setAutosaveUI("saved"),
            });
            return el;
          },
        },
        {
          id: "assets",
          label: "Assets",
          getContent: () => {
            const el = document.createElement("div");
            el.className = "editor-tab-content editor-tab-content--assets";
            ensureCustomTimelineCreated();
            renderAssetsPanel(el, currentShowId, {
              getAssetDragCallbacks: () =>
                createAssetDropOnTimelineHandler({
                  getView: () => customTimelineView,
                  addRange: (layerId, startSec, durationSec, filePath, rangeType) =>
                    addRange(layerId, startSec, durationSec, filePath, rangeType),
                  ensureTimelineCreated: ensureCustomTimelineCreated,
                }),
            });
            return el;
          },
        },
      ],
    });
    bottomRightSection.appendChild(tabbedContainer);
    panelB.appendChild(bottomRightSection);
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

  const detailsPanel = container.querySelector(EDITOR_SELECTORS.detailsPanel);

  timelineWrapEl = timelineWrap;
  timelinePageBodyEl = pageBody;
  timelineContentEl = container.querySelector(EDITOR_SELECTORS.content) as HTMLElement | null;
  timelineMountEl = mount as HTMLElement | null;
  timelineDetailsPanelEl = detailsPanel as HTMLElement | null;
  timelineLoadingEl = loadingEl as HTMLElement | null;

  const statusMessageEl = container.querySelector(EDITOR_SELECTORS.liveStatusMessage) as HTMLElement | null;
  const toolbarLeftEditEl = container.querySelector(EDITOR_SELECTORS.toolbarLeftEdit) as HTMLElement | null;
  const toolbarSpacerEl = container.querySelector(EDITOR_SELECTORS.toolbarSpacer) as HTMLElement | null;
  const toolbarCenterEl = container.querySelector(EDITOR_SELECTORS.toolbarCenter) as HTMLElement | null;
  const toolbarRightEl = container.querySelector(EDITOR_SELECTORS.toolbarRight) as HTMLElement | null;

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
    timelineContentEl?.classList.add("editor-content--broadcast");
    timelineDetailsPanelEl?.classList.add("details-panel--readonly");
    ensureReadOnlyHeaderRow();
    updateLiveStatusMessage(true);
  }

  function revertBroadcastUI(): void {
    isBroadcastMode = false;
    stopBroadcastReadheadTick();
    timelineContentEl?.classList.remove("editor-readhead-no-drag");
    timelineContentEl?.classList.remove("editor-content--broadcast");
    timelineDetailsPanelEl?.classList.remove("details-panel--readonly");
    const wrapper = timelineDetailsPanelEl?.querySelector(EDITOR_SELECTORS.detailsHeaderRow);
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

  timelineAutosaveEl = container.querySelector(EDITOR_SELECTORS.autosave);

  if (!mount || !detailsPanel) return;

  initBroadcast({
    setReadheadSec,
    getIsBroadcastMode: () => isBroadcastMode,
    getCurrentShowId: () => currentShowId,
  });

  initAutosave({
    getExportState,
    getCurrentShowId: () => currentShowId,
    getHasLoadedShow: () => hasLoadedShow,
    getAutosaveEl: () => timelineAutosaveEl,
    getIcons: () => ({ circleCheck: circleCheckIcon, loading: animatedLoadingIcon }),
  });

  attachToolbarHandlers(container, {
    getCurrentShowId: () => currentShowId,
    setReadheadSec,
    getReadheadSecClamped,
    addContentReadheadNoDrag: () => timelineContentEl?.classList.add("editor-readhead-no-drag"),
    removeContentReadheadNoDrag: () => timelineContentEl?.classList.remove("editor-readhead-no-drag"),
    addRange,
    updateTimelineView: () => customTimelineView?.update(),
    getLayers,
    addEventsFromVideo,
    inBroadcastMode: () => isBroadcastMode,
    openVideoImportModal: (opts) => openVideoImportModal(opts),
    addEvent,
    removeSelected,
    getDetailsPanelEl: () => detailsPanel as HTMLElement,
    getIsBroadcastMode: () => isBroadcastMode,
    isTrackAssignmentsDropdownOpen,
    closeTrackAssignmentsDropdown,
    openTrackAssignmentsDropdown: (btn, getLayersFn, saveFn) =>
      openTrackAssignmentsDropdown(btn, getLayersFn, saveFn),
    saveTrackSplitterTreeToServer,
  });

  // Defer load so the DOM from this render is committed and in the document before we create the timeline.
  // Fixes empty timeline-mount when opening a show (first load after "open show").
  requestAnimationFrame(() => {
    if (currentShowId !== showId) return;
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
  });
}
