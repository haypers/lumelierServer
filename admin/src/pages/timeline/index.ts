import "vis-timeline/styles/vis-timeline-graph2d.css";
import { DataSet } from "vis-data";
import { Timeline, type DataItem, type DataGroup, type IdType } from "vis-timeline";
import {
  SEC,
  readheadId,
  defaultTimeZero,
  toMs,
  timeToDate,
  dateToSec,
  type TimelineItemPayload,
} from "./types";
import { updateDetailsPanel } from "./details-panel";
import {
  exportState,
  importState,
  type NextIds,
} from "./state-serialization";

export type { TimelineItemPayload, TimelineStateJSON } from "./types";

let timeline: Timeline | null = null;
let groups: DataSet<DataGroup>;
let items: DataSet<DataItem & { payload?: TimelineItemPayload }>;
let nextLayerId = 1;
let nextItemId = 1;

function ensureGroups(): void {
  if (!groups.length) {
    addLayer();
  }
}

function addLayer(): string {
  const id = String(nextLayerId++);
  const label = `Layer ${id}`;
  groups.add({ id, content: label });
  return id;
}

function removeLayer(id: IdType): void {
  const groupIds = groups.getIds();
  if (groupIds.length <= 1) return;
  groups.remove(id);
  items.getIds().forEach((itemId) => {
    const item = items.get(itemId) as (DataItem & { payload?: TimelineItemPayload }) | null;
    if (item?.group === id) items.remove(itemId);
  });
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
  return id;
}

function addFlag(layerId?: IdType): string {
  ensureGroups();
  const gid = layerId ?? groups.getIds()[0];
  const at = timeline ? dateToSec(timeline.getWindow().start) + 2 : 0;
  const id = `item-${nextItemId++}`;
  const payload: TimelineItemPayload = { kind: "flag", label: `Flag ${id}`, effectType: "trigger" };
  items.add({
    id,
    group: gid,
    start: timeToDate(at),
    content: payload.label ?? id,
    type: "point",
    payload,
  });
  return id;
}

function removeSelected(): void {
  const sel = timeline?.getSelection() ?? [];
  sel.forEach((id) => items.remove(id));
}

function loadFromClipboard(): void {
  navigator.clipboard.readText().then(
    (text) => {
      const state = JSON.parse(text) as import("./types").TimelineStateJSON;
      if (state.version !== 1 || !Array.isArray(state.layers) || !Array.isArray(state.items)) {
        alert("Invalid timeline JSON.");
        return;
      }
      importState(
        state,
        groups,
        items,
        (sec) => timeline?.setCustomTime(timeToDate(sec), readheadId),
        (ids: NextIds) => {
          nextItemId = ids.nextItemId;
          nextLayerId = ids.nextLayerId;
        }
      );
      timeline?.fit();
    },
    () => alert("Could not read clipboard.")
  );
}

function copyExportToClipboard(): void {
  const state = exportState(
    groups,
    items,
    () => (timeline ? dateToSec(timeline.getCustomTime(readheadId)) : 0)
  );
  navigator.clipboard.writeText(JSON.stringify(state, null, 2));
}

export function render(container: HTMLElement): void {
  groups = new DataSet<DataGroup>([]);
  items = new DataSet<DataItem & { payload?: TimelineItemPayload }>([]);

  container.innerHTML = `
    <div class="timeline-page">
      <section class="timeline-details-panel" aria-label="Selected item details">
        <h3>Selection</h3>
        <div class="timeline-details-body">
          <p class="no-selection">Select an item on the timeline to view or edit its details.</p>
        </div>
      </section>
      <div class="timeline">
        <div class="timeline-toolbar">
          <button type="button" class="btn btn-primary" data-action="add-layer">Add layer</button>
          <button type="button" class="btn" data-action="remove-layer">Remove layer</button>
          <span class="toolbar-divider"></span>
          <button type="button" class="btn btn-primary" data-action="add-clip">Add clip</button>
          <button type="button" class="btn btn-primary" data-action="add-flag">Add flag</button>
          <button type="button" class="btn btn-danger" data-action="remove-item">Remove selected</button>
          <span class="toolbar-divider"></span>
          <button type="button" class="btn" data-action="copy-json">Copy JSON</button>
          <button type="button" class="btn" data-action="load-json">Load from clipboard</button>
        </div>
        <div class="timeline-container-wrap">
          <div id="timeline-mount"></div>
        </div>
      </div>
    </div>
  `;

  const mount = document.getElementById("timeline-mount");
  const detailsPanel = container.querySelector(".timeline-details-panel");

  if (!mount || !detailsPanel) return;

  timeline = new Timeline(
    mount,
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
    }
  );

  timeline.addCustomTime(defaultTimeZero, readheadId);
  timeline.setCustomTimeTitle("Readhead", readheadId);

  timeline.on("select", (props) => {
    updateDetailsPanel(
      detailsPanel as HTMLElement,
      props.items?.[0] ?? null,
      (id) => items.get(id) as (DataItem & { payload?: TimelineItemPayload }) | null
    );
  });

  timeline.on("deselect", () => {
    updateDetailsPanel(detailsPanel as HTMLElement, null, () => null);
  });

  addLayer();
  addClip();
  addClip();
  addFlag();
  timeline.fit();

  container.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", () => {
      const action = (el as HTMLElement).getAttribute("data-action");
      switch (action) {
        case "add-layer": {
          addLayer();
          timeline?.fit();
          break;
        }
        case "remove-layer": {
          const layerIds = groups.getIds();
          if (layerIds.length <= 1) break;
          const sel = timeline?.getSelection();
          const toRemove =
            sel?.length ? (items.get(sel[0]) as DataItem)?.group : layerIds[layerIds.length - 1];
          if (toRemove != null) removeLayer(toRemove);
          timeline?.fit();
          break;
        }
        case "add-clip":
          addClip();
          timeline?.fit();
          break;
        case "add-flag":
          addFlag();
          timeline?.fit();
          break;
        case "remove-item":
          removeSelected();
          updateDetailsPanel(detailsPanel as HTMLElement, null, () => null);
          break;
        case "copy-json":
          copyExportToClipboard();
          break;
        case "load-json":
          loadFromClipboard();
          break;
      }
    });
  });
}
