import "vis-timeline/styles/vis-timeline-graph2d.css";
import "./styles.css";
import { DataSet } from "vis-data";
import { Timeline, type DataItem, type DataGroup, type IdType } from "vis-timeline";
import animatedLoadingIcon from "../../icons/animatedLoadingIcon.svg?raw";
import circleCheckIcon from "../../icons/circle-check.svg?raw";
import pauseIcon from "../../icons/pause.svg?raw";
import playIcon from "../../icons/play.svg?raw";
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
    fetch("/api/admin/broadcast/readhead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readheadSec: clamped }),
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

async function uploadTimelineToServer(): Promise<boolean> {
  const state = getExportState();
  try {
    const res = await fetch("/api/admin/broadcast/timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!res.ok) {
      console.error("Failed to upload timeline:", res.status, await res.text());
      return false;
    }
    console.log("timeline successfully uploaded to server");
    return true;
  } catch (e) {
    console.error("Failed to upload timeline:", e);
    return false;
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
    container.innerHTML = `
      <div class="show-required-empty-state">
        <p class="show-required-empty-state-message">Please open or create a show to view or play its timeline.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="timeline-page">
      <div class="timeline-actions-row"></div>
      <div class="timeline-page-body timeline-page-body--details-hidden">
        <div class="timeline">
          <div class="timeline-empty-state" id="timeline-empty-state">
            <p class="timeline-empty-state-message">Loading…</p>
          </div>
          <div class="timeline-content timeline-content--hidden">
            <div class="timeline-toolbar">
              <div class="timeline-toolbar-left">
                <span class="timeline-autosave" id="timeline-autosave"><span class="timeline-autosave-icon">${circleCheckIcon}</span><span>Saved</span></span>
                <span class="timeline-toolbar-gps">
                  <span class="timeline-toolbar-gps-label">Request GPS:</span>
                  <button type="button" class="mode-switch-toggle gps-toggle" id="timeline-request-gps-toggle" aria-pressed="false" aria-label="Request GPS">
                    <span class="mode-switch-track">
                      <span class="mode-switch-knob"></span>
                    </span>
                  </button>
                </span>
              </div>
              <div class="timeline-toolbar-center"></div>
              <div class="timeline-toolbar-right">
                <button type="button" class="btn btn-primary hidden" data-action="add-clip" aria-hidden="true">Add clip</button>
                <button type="button" class="btn btn-primary" data-action="add-event">Add event</button>
                <button type="button" class="btn btn-danger" data-action="remove-item">Remove selected</button>
              </div>
            </div>
            <div class="timeline-toolbar-broadcast">
              <div class="timeline-toolbar-left">
                <span class="timeline-broadcast-show-name" id="timeline-broadcast-show-name">Untitled Show</span>
              </div>
              <div class="timeline-toolbar-center">
                <button type="button" class="btn btn-icon-only" data-action="play" aria-label="Play">${playIcon}</button>
                <button type="button" class="btn btn-icon-only" data-action="pause" aria-label="Pause">${pauseIcon}</button>
              </div>
              <div class="timeline-toolbar-right"></div>
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
  const mount = document.getElementById("timeline-mount");
  const detailsPanel = container.querySelector(".timeline-details-panel");
  const loadingEl = document.getElementById("timeline-loading");

  timelineWrapEl = timelineWrap;
  timelinePageBodyEl = pageBody;
  timelineContentEl = container.querySelector(".timeline-content") as HTMLElement | null;
  timelineMountEl = mount;
  timelineDetailsPanelEl = detailsPanel as HTMLElement | null;
  timelineLoadingEl = loadingEl;

  const actionsRow = container.querySelector(".timeline-actions-row");
  if (actionsRow) {
    const modeSwitch = document.createElement("div");
    modeSwitch.className = "mode-switch";
    modeSwitch.setAttribute("role", "group");
    modeSwitch.setAttribute("aria-label", "Mode");
    modeSwitch.innerHTML = `
      <span class="mode-switch-label mode-switch-label-edit active">Editing</span>
      <button type="button" class="mode-switch-toggle" id="timeline-mode-toggle" aria-pressed="false" aria-label="Switch mode">
        <span class="mode-switch-track">
          <span class="mode-switch-knob"></span>
        </span>
      </button>
      <span class="mode-switch-label mode-switch-label-broadcast">Broadcasting</span>
    `;
    const toggleBtn = modeSwitch.querySelector(".mode-switch-toggle");
    const labelEdit = modeSwitch.querySelector(".mode-switch-label-edit");
    const labelBroadcast = modeSwitch.querySelector(".mode-switch-label-broadcast");

    function applyBroadcastUI(): void {
      isBroadcastMode = true;
      modeSwitch.classList.add("mode-switch--broadcast");
      toggleBtn?.setAttribute("aria-pressed", "true");
      labelEdit?.classList.remove("active");
      labelBroadcast?.classList.add("active");
      timelineContentEl?.classList.add("timeline-content--broadcast");
      timelineDetailsPanelEl?.classList.add("timeline-details-panel--readonly");
      const broadcastShowName = document.getElementById("timeline-broadcast-show-name");
      if (broadcastShowName) broadcastShowName.textContent = projectTitle;
      ensureReadOnlyHeaderRow();
      timeline?.setOptions({
        editable: { add: false, remove: false, updateGroup: false, updateTime: false },
      });
    }

    function revertBroadcastUI(): void {
      isBroadcastMode = false;
      stopBroadcastReadheadTick();
      timelineContentEl?.classList.remove("timeline-readhead-no-drag");
      modeSwitch.classList.remove("mode-switch--broadcast");
      toggleBtn?.setAttribute("aria-pressed", "false");
      labelEdit?.classList.add("active");
      labelBroadcast?.classList.remove("active");
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
    }

    toggleBtn?.addEventListener("click", async () => {
      const currentlyBroadcast = modeSwitch.classList.contains("mode-switch--broadcast");
      if (currentlyBroadcast) {
        revertBroadcastUI();
        return;
      }
      const canEnterBroadcast =
        hasLoadedShow && groups.length > 0 && items.length > 0;
      if (!canEnterBroadcast) {
        alert("To enter broadcasting mode, you must have a non empty timeline loaded.");
        return;
      }
      applyBroadcastUI();
      const ok = await uploadTimelineToServer();
      if (!ok) {
        revertBroadcastUI();
        alert("Failed to upload timeline to server.");
      }
    });
    actionsRow.appendChild(modeSwitch);
  }

  timelineAutosaveEl = document.getElementById("timeline-autosave");

  if (!mount || !detailsPanel) return;

  document.getElementById("timeline-request-gps-toggle")?.addEventListener("click", () => {
    setRequestsGPS(!requestsGPS);
    scheduleAutosave();
  });
  setRequestsGPS(requestsGPS);

  container.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", async () => {
      const action = (el as HTMLElement).getAttribute("data-action");
      switch (action) {
        case "play": {
          const readheadSec = getReadheadSecClamped();
          console.log("User hit play from", readheadSec, "(readhead sec).");
          try {
            const res = await fetch("/api/admin/broadcast/play", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ readheadSec }),
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
            const res = await fetch("/api/admin/broadcast/pause", { method: "POST" });
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

  loadTimelineFromServer(showId);
}
