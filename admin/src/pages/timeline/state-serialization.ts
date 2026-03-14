import type { TimelineStateJSON } from "./types";

export type LayersArray = TimelineStateJSON["layers"];
export type ItemsArray = TimelineStateJSON["items"];

export function exportState(
  getLayers: () => LayersArray,
  getItems: () => ItemsArray,
  getReadheadSec: () => number,
  getTitle: () => string
): TimelineStateJSON {
  return {
    version: 1,
    title: getTitle(),
    layers: getLayers().map((l) => ({ id: l.id, label: l.label })),
    items: getItems().map((it) => ({
      id: it.id,
      layerId: it.layerId,
      kind: it.kind,
      startSec: it.startSec,
      endSec: it.kind === "range" ? it.endSec : undefined,
      label: it.label,
      effectType: it.effectType,
      color: it.color,
      rangeType: it.kind === "range" ? it.rangeType : undefined,
      filePath: it.kind === "range" ? it.filePath : undefined,
      positionOverlay: it.kind === "range" ? it.positionOverlay : undefined,
    })),
    readheadSec: getReadheadSec(),
  };
}

export interface NextIds {
  nextItemId: number;
  nextLayerId: number;
}

export function importState(
  state: TimelineStateJSON,
  setLayers: (layers: LayersArray) => void,
  setItems: (items: ItemsArray) => void,
  setReadheadSec: (sec: number) => void,
  setNextIds: (ids: NextIds) => void,
  setTitle: (title: string) => void
): void {
  setTitle(state.title ?? "Untitled Show");
  setLayers(state.layers.map((l) => ({ id: l.id, label: l.label })));
  setItems(
    state.items.map((it) => {
      const raw = it as {
        kind: string;
        rangeType?: "Image" | "Video" | "Audio";
        filePath?: string;
        positionOverlay?: { x: number; y: number; angle: number; hs: number; vs: number };
      };
      const kind = raw.kind === "clip" ? "range" : it.kind;
      const rangeType =
        kind === "range" ? (raw.rangeType ?? "Audio") : undefined;
      const filePath = kind === "range" ? raw.filePath : undefined;
      const positionOverlay =
        kind === "range" && raw.positionOverlay != null
          ? {
              x: Number.isFinite(raw.positionOverlay.x) ? raw.positionOverlay.x : 0,
              y: Number.isFinite(raw.positionOverlay.y) ? raw.positionOverlay.y : 0,
              angle: Number.isFinite(raw.positionOverlay.angle) ? raw.positionOverlay.angle : 0,
              hs: Number.isFinite(raw.positionOverlay.hs) && raw.positionOverlay.hs > 0 ? raw.positionOverlay.hs : 1,
              vs: Number.isFinite(raw.positionOverlay.vs) && raw.positionOverlay.vs > 0 ? raw.positionOverlay.vs : 1,
            }
          : undefined;
      return {
        id: it.id,
        layerId: it.layerId,
        kind,
        startSec: it.startSec,
        endSec: it.endSec,
        label: it.label,
        effectType: it.effectType,
        color: it.color,
        rangeType,
        filePath,
        positionOverlay,
      };
    })
  );
  const maxId = state.items.reduce((acc, it) => {
    const n = parseInt(it.id.replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  const layerNum = state.layers.reduce((acc, l) => {
    const n = parseInt(l.id.replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  setNextIds({ nextItemId: maxId + 1, nextLayerId: layerNum + 1 });
  setReadheadSec(Math.max(0, state.readheadSec ?? 0));
}
