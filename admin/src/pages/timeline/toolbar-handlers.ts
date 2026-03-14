import type { TrackAssignmentsRoot } from "./pageComponents/track-assignments";
import type { OpenModalOptions } from "./pageComponents/import-from-video";
import type { VideoImportEvent } from "./pageComponents/import-from-video";
import { updateDetailsPanel } from "./pageComponents/details-panel";
import {
  requestBroadcastRestart,
  requestBroadcastPlay,
  requestBroadcastPause,
} from "./broadcast";

export const TOOLBAR_ACTIONS = {
  RESTART: "restart",
  PLAY: "play",
  PAUSE: "pause",
  ADD_RANGE: "add-range",
  IMPORT_FROM_VIDEO: "import-from-video",
  ADD_EVENT: "add-event",
  REMOVE_ITEM: "remove-item",
  SPLIT_DEVICES_TRACKS: "split-devices-tracks",
} as const;

export interface ToolbarHandlerCallbacks {
  getCurrentShowId: () => string | null;
  setReadheadSec: (sec: number) => void;
  getReadheadSecClamped: () => number;
  addContentReadheadNoDrag: () => void;
  removeContentReadheadNoDrag: () => void;
  addRange: () => void;
  updateTimelineView: () => void;
  getLayers: () => { id: string; label: string }[];
  addEventsFromVideo: (events: VideoImportEvent[], layerId: string) => void;
  inBroadcastMode: () => boolean;
  openVideoImportModal: (options: OpenModalOptions) => void;
  addEvent: () => void;
  removeSelected: () => void;
  getDetailsPanelEl: () => HTMLElement | null;
  getIsBroadcastMode: () => boolean;
  isTrackAssignmentsDropdownOpen: () => boolean;
  closeTrackAssignmentsDropdown: () => void;
  openTrackAssignmentsDropdown: (
    button: HTMLElement,
    getLayers: () => { id: string; label: string }[],
    saveTrackSplitterTreeToServer: (root: TrackAssignmentsRoot) => Promise<void>
  ) => void;
  saveTrackSplitterTreeToServer: (root: TrackAssignmentsRoot) => Promise<void>;
}

export function attachToolbarHandlers(container: HTMLElement, callbacks: ToolbarHandlerCallbacks): void {
  const detailsPanel = callbacks.getDetailsPanelEl();
  if (!detailsPanel) return;

  container.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      const action = (el as HTMLElement).getAttribute("data-action");
      switch (action) {
        case TOOLBAR_ACTIONS.RESTART: {
          callbacks.setReadheadSec(0);
          try {
            const showId = callbacks.getCurrentShowId();
            if (!showId) throw new Error("No show selected");
            await requestBroadcastRestart(showId);
            callbacks.addContentReadheadNoDrag();
          } catch (err) {
            console.error("Broadcast restart failed:", err);
          }
          break;
        }
        case TOOLBAR_ACTIONS.PLAY: {
          const readheadSec = callbacks.getReadheadSecClamped();
          try {
            const showId = callbacks.getCurrentShowId();
            if (!showId) throw new Error("No show selected");
            await requestBroadcastPlay(showId, readheadSec);
            callbacks.addContentReadheadNoDrag();
          } catch (err) {
            console.error("Broadcast play failed:", err);
          }
          break;
        }
        case TOOLBAR_ACTIONS.PAUSE: {
          try {
            const showId = callbacks.getCurrentShowId();
            if (!showId) throw new Error("No show selected");
            await requestBroadcastPause(showId);
            callbacks.removeContentReadheadNoDrag();
          } catch (err) {
            console.error("Broadcast pause failed:", err);
          }
          break;
        }
        case TOOLBAR_ACTIONS.ADD_RANGE:
          callbacks.addRange();
          callbacks.updateTimelineView();
          break;
        case TOOLBAR_ACTIONS.IMPORT_FROM_VIDEO:
          callbacks.openVideoImportModal({
            getLayers: callbacks.getLayers,
            addEventsFromVideo: callbacks.addEventsFromVideo,
            inBroadcastMode: callbacks.inBroadcastMode,
          });
          break;
        case TOOLBAR_ACTIONS.ADD_EVENT:
          callbacks.addEvent();
          break;
        case TOOLBAR_ACTIONS.REMOVE_ITEM:
          callbacks.removeSelected();
          updateDetailsPanel(
            detailsPanel,
            null,
            () => null,
            () => {},
            () => [],
            undefined,
            {
              showId: callbacks.getCurrentShowId(),
              readonly: callbacks.getIsBroadcastMode(),
            }
          );
          break;
        case TOOLBAR_ACTIONS.SPLIT_DEVICES_TRACKS: {
          const btn = el as HTMLElement;
          (e as MouseEvent).stopPropagation();
          if (callbacks.isTrackAssignmentsDropdownOpen()) {
            callbacks.closeTrackAssignmentsDropdown();
          } else {
            callbacks.openTrackAssignmentsDropdown(
              btn,
              callbacks.getLayers,
              callbacks.saveTrackSplitterTreeToServer
            );
          }
          break;
        }
      }
    });
  });
}
