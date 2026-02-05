/**
 * Reusable info icon with a tooltip (uses shared popup-tooltip component).
 */

import infoIcon from "../icons/info.svg?raw";
import { createPopupTrigger } from "./popup-tooltip";

export interface InfoBubbleOptions {
  tooltipText: string;
  ariaLabel?: string;
}

/**
 * Returns a span element (class "info-bubble") containing the icon and tooltip.
 * Caller must append the returned element to the DOM.
 */
export function createInfoBubble(opts: InfoBubbleOptions): HTMLElement {
  const { tooltipText, ariaLabel = "Info" } = opts;
  return createPopupTrigger({
    triggerContent: infoIcon,
    tooltipText,
    ariaLabel,
    wrapperClass: "info-bubble",
  });
}
