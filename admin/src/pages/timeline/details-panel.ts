import type { DataItem } from "vis-timeline";
import type { IdType } from "vis-timeline";
import type { TimelineItemPayload } from "./types";
import { dateToSec } from "./types";

export type GetItemFn = (
  id: IdType
) => (DataItem & { payload?: TimelineItemPayload }) | null;

export function updateDetailsPanel(
  container: HTMLElement,
  itemId: IdType | null | undefined,
  getItem: GetItemFn
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
  if (!item) {
    h3.textContent = "Selection";
    body.innerHTML = '<p class="no-selection">Item not found.</p>';
    return;
  }

  const payload = item.payload ?? { kind: "clip" as const };
  const startSec = dateToSec(new Date(item.start as Date));
  const endSec =
    item.end != null ? dateToSec(new Date(item.end as Date)) : null;

  h3.textContent = payload.kind === "clip" ? "Clip details" : "Flag details";
  body.innerHTML = `
    <dl class="detail-grid">
      <dt>ID</dt><dd>${String(item.id)}</dd>
      <dt>Type</dt><dd>${payload.kind}</dd>
      <dt>Start</dt><dd>${startSec} s</dd>
      ${endSec != null ? `<dt>End</dt><dd>${endSec} s</dd><dt>Duration</dt><dd>${endSec - startSec} s</dd>` : ""}
      <dt>Layer</dt><dd>${String(item.group)}</dd>
      <dt>Label</dt><dd>${payload.label ?? "—"}</dd>
      <dt>Effect type</dt><dd>${payload.effectType ?? "—"}</dd>
    </dl>
  `;
}
