/**
 * Handles "drop asset onto timeline": when the drag enters a valid layer,
 * create a range with the right duration (file duration for audio/video, 15% viewport for images/no duration) and hand off to timeline drag.
 */

import type { CustomTimelineView } from "./custom-timeline";
import type { AssetDragCallbacks, AssetDragFileInfo } from "../pageComponents/assets/asset-drag";

export interface AssetDropOnTimelineOptions {
  getView: () => CustomTimelineView | null;
  addRange: (
    layerId: string,
    startSec: number,
    durationSec: number,
    filePath: string,
    rangeType: "Image" | "Video" | "Audio"
  ) => string;
  ensureTimelineCreated: () => void;
}

/**
 * Returns AssetDragCallbacks that commit when the cursor is over a valid timeline layer:
 * creates a range (duration from fileInfo.durationSec or view's default for no media), then starts external range drag.
 */
export function createAssetDropOnTimelineHandler(
  options: AssetDropOnTimelineOptions
): AssetDragCallbacks {
  const { getView, addRange, ensureTimelineCreated } = options;

  return {
    onMove(clientX: number, clientY: number, fileInfo: AssetDragFileInfo) {
      ensureTimelineCreated();
      const view = getView();
      if (!view) return "continue";

      const layerId = view.getLayerIdUnderClientY(clientY);
      if (!layerId) return "continue";

      const startSec = view.getStartSecFromClientX(clientX);
      const durationSec =
        fileInfo.durationSec != null && fileInfo.durationSec > 0
          ? fileInfo.durationSec
          : view.getDefaultDurationForNoMediaSec();

      const id = addRange(layerId, startSec, durationSec, fileInfo.filePath, fileInfo.rangeType);
      view.startExternalRangeDrag(id, clientX, clientY);
      return "commit";
    },
  };
}
