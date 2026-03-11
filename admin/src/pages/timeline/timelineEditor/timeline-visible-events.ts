import type { TimelineStateJSON } from "../types";

/** Return items that overlap [startSec - marginSec, endSec + marginSec]. */
export function getVisibleItems(
  items: TimelineStateJSON["items"],
  startSec: number,
  endSec: number,
  marginSec: number
): TimelineStateJSON["items"] {
  const lo = startSec - marginSec;
  const hi = endSec + marginSec;
  return items.filter((it) => {
    if (it.kind === "event") {
      return it.startSec >= lo && it.startSec <= hi;
    }
    const itemEnd = it.endSec ?? it.startSec + 1;
    return it.startSec < hi && itemEnd > lo;
  });
}
