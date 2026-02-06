import "vis-timeline/styles/vis-timeline-graph2d.css";
import { DataSet } from "vis-data";
import { Timeline, type DataItem, type DataGroup, type IdType } from "vis-timeline";
import animatedLoadingIcon from "../../icons/animatedLoadingIcon.svg?raw";
import trashIcon from "../../icons/trash.svg?raw";
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
import type { TimelineStateJSON } from "./types";
import { createActionsDropdown } from "../../components/actions-dropdown";

export type { TimelineItemPayload, TimelineStateJSON } from "./types";

let timeline: Timeline | null = null;
let groups: DataSet<DataGroup>;
let items: DataSet<DataItem & { payload?: TimelineItemPayload }>;
let nextLayerId = 1;
let nextItemId = 1;
let projectTitle = "Untitled Show";

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
    if (groupData.id == null) return;
    if (groups.getIds().length <= 1) return;
    if (confirm("Remove this layer and all its items?")) {
      onRemove(groupData.id);
      timeline?.fit();
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

function updateOnlyLayerVisibility(): void {
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
        },
        (title) => {
          projectTitle = title;
          const el = document.getElementById("timeline-project-title-input");
          if (el instanceof HTMLInputElement) el.value = title;
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
    () => (timeline ? dateToSec(timeline.getCustomTime(readheadId)) : 0),
    () => projectTitle
  );
  navigator.clipboard.writeText(JSON.stringify(state, null, 2));
}

/** Sanitize project title to a safe filename (only [a-zA-Z0-9._-]); append .json. */
function titleToFilename(title: string): string {
  const t = title
    .trim()
    .replace(/[/\\]/g, "")
    .replace(/[^a-zA-Z0-9._\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .trim();
  const base = t || "Untitled_Show";
  return `${base}.json`;
}

function getExportState(): TimelineStateJSON {
  return exportState(
    groups,
    items,
    () => (timeline ? dateToSec(timeline.getCustomTime(readheadId)) : 0),
    () => projectTitle
  );
}

function showOverwriteConfirmModal(onConfirm: () => void): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <p>A show with this name already exists. Overwrite?</p>
      <div class="modal-actions">
        <button type="button" class="btn-cancel">Cancel</button>
        <button type="button" class="btn-confirm">Overwrite</button>
      </div>
    </div>`;
  const close = () => overlay.remove();
  overlay.querySelector(".btn-cancel")?.addEventListener("click", close);
  overlay.querySelector(".btn-confirm")?.addEventListener("click", () => {
    onConfirm();
    close();
  });
  document.body.appendChild(overlay);
}

async function saveShow(): Promise<void> {
  const filename = titleToFilename(projectTitle);
  let list: string[] = [];
  try {
    const res = await fetch("/api/admin/shows");
    if (res.ok) list = (await res.json()) as string[];
  } catch {
    // ignore; will try save anyway
  }
  const exists = list.includes(filename);
  const doPut = async () => {
    try {
      const res = await fetch(`/api/admin/shows/${encodeURIComponent(filename)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getExportState()),
      });
      if (res.ok) {
        alert("Show saved successfully.");
      } else {
        const text = await res.text();
        alert(`Save failed: ${res.status} ${text || res.statusText}`);
      }
    } catch (e) {
      alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  if (exists) {
    showOverwriteConfirmModal(doPut);
  } else {
    await doPut();
  }
}

function showOpenShowModal(): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <p>Select a show to open:</p>
      <ul class="modal-show-list" id="modal-show-list"></ul>
      <div class="modal-actions">
        <button type="button" class="btn-cancel">Cancel</button>
      </div>
    </div>`;
  const listEl = overlay.querySelector("#modal-show-list") as HTMLElement;
  const close = () => overlay.remove();

  overlay.querySelector(".btn-cancel")?.addEventListener("click", close);

  fetch("/api/admin/shows")
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
    .then((files: string[]) => {
      if (!listEl) return;
      listEl.innerHTML = files
        .filter((f) => f.endsWith(".json"))
        .map((f) => `<li><button type="button" class="modal-show-item" data-filename="${f.replace(/"/g, "&quot;")}">${f.replace(/</g, "&lt;")}</button></li>`)
        .join("");
      listEl.querySelectorAll(".modal-show-item").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const name = (btn as HTMLElement).dataset.filename;
          if (!name) return;
          try {
            const res = await fetch(`/api/admin/shows/${encodeURIComponent(name)}`);
            if (!res.ok) throw new Error(`${res.status}`);
            const state = (await res.json()) as TimelineStateJSON;
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
              },
              (title) => {
                projectTitle = title;
                const el = document.getElementById("timeline-project-title-input");
                if (el instanceof HTMLInputElement) el.value = title;
              }
            );
            close();
            timeline?.fit();
          } catch (e) {
            alert(`Failed to load show: ${e instanceof Error ? e.message : String(e)}`);
          }
        });
      });
    })
    .catch((e) => {
      alert(`Failed to list shows: ${e instanceof Error ? e.message : String(e)}`);
    });

  document.body.appendChild(overlay);
}

export function render(container: HTMLElement): void {
  groups = new DataSet<DataGroup>([]);
  items = new DataSet<DataItem & { payload?: TimelineItemPayload }>([]);

  container.innerHTML = `
    <div class="timeline-page">
      <div class="timeline-actions-row"></div>
      <div class="timeline-page-body">
        <section class="timeline-details-panel" aria-label="Selected item details">
          <h3>Selection</h3>
          <div class="timeline-details-body">
            <p class="no-selection">Select an item on the timeline to view or edit its details.</p>
          </div>
        </section>
        <div class="timeline">
          <div class="timeline-toolbar">
            <span class="timeline-project-title-wrap">
              <label for="timeline-project-title-input">Show:</label>
              <input type="text" id="timeline-project-title-input" value="Untitled Show" />
            </span>
            <button type="button" class="btn btn-primary" data-action="add-clip">Add clip</button>
          <button type="button" class="btn btn-primary" data-action="add-flag">Add flag</button>
          <button type="button" class="btn btn-danger" data-action="remove-item">Remove selected</button>
          <span class="toolbar-divider"></span>
          <button type="button" class="btn" data-action="copy-json">Copy JSON</button>
          <button type="button" class="btn" data-action="load-json">Load from clipboard</button>
        </div>
          <div class="timeline-container-wrap">
            <div class="timeline-loading" id="timeline-loading" aria-hidden="false">
              <span class="timeline-loading-icon">${animatedLoadingIcon}</span>
            </div>
            <div id="timeline-mount"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const mount = document.getElementById("timeline-mount");
  const detailsPanel = container.querySelector(".timeline-details-panel");
  const loadingEl = document.getElementById("timeline-loading");

  const actionsRow = container.querySelector(".timeline-actions-row");
  const actionsDropdown = createActionsDropdown({
    dropdownId: "timeline-actions-dropdown-list",
    items: [
      { id: "save-show", label: "Save Show" },
      { id: "open-show", label: "Open Show" },
    ],
  });
  if (actionsRow) actionsRow.appendChild(actionsDropdown.root);
  actionsDropdown.onAction("save-show", () => saveShow());
  actionsDropdown.onAction("open-show", () => showOpenShowModal());

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
      groupTemplate: (data: { id: IdType; content: string }, _element: HTMLElement) => {
        return createGroupLabelElement(
          data,
          (id) => removeLayer(id),
          (id, newContent) => groups.update({ id, content: newContent })
        );
      },
      onInitialDrawComplete: () => {
        if (loadingEl) {
          loadingEl.classList.add("timeline-loading--hidden");
          loadingEl.setAttribute("aria-hidden", "true");
        }
        injectAddLayerButton();
        updateOnlyLayerVisibility();
      },
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

  groups.on("*", () => updateOnlyLayerVisibility());

  addLayer();
  addClip();
  addClip();
  addFlag();
  timeline.fit();

  const titleInput = document.getElementById("timeline-project-title-input");
  if (titleInput instanceof HTMLInputElement) {
    titleInput.value = projectTitle;
    titleInput.addEventListener("input", () => {
      projectTitle = titleInput.value.trim() || "Untitled Show";
    });
  }

  container.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", () => {
      const action = (el as HTMLElement).getAttribute("data-action");
      switch (action) {
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
