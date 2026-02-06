import type { DataSet } from "vis-data";
import type { DataGroup, DataItem } from "vis-timeline";
import type { TimelineItemPayload } from "./types";
import type { TimelineStateJSON } from "./types";
import { timeToDate, dateToSec } from "./types";

export function exportState(
  groups: DataSet<DataGroup>,
  items: DataSet<DataItem & { payload?: TimelineItemPayload }>,
  getReadheadSec: () => number
): TimelineStateJSON {
  const layers = groups.get().map((g: DataGroup) => ({
    id: String(g.id),
    label: String(g.content),
  }));
  const itemList = items
    .get()
    .map((it: DataItem & { payload?: TimelineItemPayload }) => {
      const payload = it.payload ?? { kind: "clip" as const };
      const startSec = dateToSec(new Date(it.start as Date));
      const endSec =
        it.end != null ? dateToSec(new Date(it.end as Date)) : undefined;
      return {
        id: String(it.id),
        layerId: String(it.group),
        kind: payload.kind,
        startSec,
        endSec: payload.kind === "clip" ? endSec : undefined,
        label: payload.label,
        effectType: payload.effectType,
      };
    });
  return {
    version: 1,
    layers,
    items: itemList,
    readheadSec: getReadheadSec(),
  };
}

export interface NextIds {
  nextItemId: number;
  nextLayerId: number;
}

export function importState(
  state: TimelineStateJSON,
  groups: DataSet<DataGroup>,
  items: DataSet<DataItem & { payload?: TimelineItemPayload }>,
  setReadheadSec: (sec: number) => void,
  setNextIds: (ids: NextIds) => void
): void {
  groups.clear();
  items.clear();
  state.layers.forEach((l) => groups.add({ id: l.id, content: l.label }));
  state.items.forEach((it) => {
    const payload: TimelineItemPayload = {
      kind: it.kind,
      label: it.label,
      effectType: it.effectType,
    };
    if (it.kind === "clip") {
      items.add({
        id: it.id,
        group: it.layerId,
        start: timeToDate(it.startSec),
        end: timeToDate(it.endSec ?? it.startSec + 1),
        content: it.label ?? it.id,
        type: "range",
        payload,
      });
    } else {
      items.add({
        id: it.id,
        group: it.layerId,
        start: timeToDate(it.startSec),
        content: it.label ?? it.id,
        type: "point",
        payload,
      });
    }
  });
  const maxId = state.items.reduce((acc, it) => {
    const n = parseInt(it.id.replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  const layerNum = state.layers.reduce((acc, l) => {
    const n = parseInt(l.id.replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  setNextIds({ nextItemId: maxId + 1, nextLayerId: layerNum + 1 });
  setReadheadSec(state.readheadSec);
}
