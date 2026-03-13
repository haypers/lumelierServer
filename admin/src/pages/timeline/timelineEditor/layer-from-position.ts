/**
 * Map mouse client Y to the timeline layer under the cursor.
 * Accounts for layersContent scroll; clamps above/below strip to top/bottom layer.
 */

export interface LayerRef {
  id: string;
}

/**
 * Returns the id of the layer under the given client Y, or null if layers is empty.
 * contentY = clientY - rect.top + scrollTop; index = clamp(floor(contentY / rowHeightPx), 0, layers.length - 1).
 */
export function getLayerIdUnderClientY(
  clientY: number,
  layersContent: HTMLElement,
  layers: LayerRef[],
  rowHeightPx: number
): string | null {
  if (layers.length === 0) return null;
  const rect = layersContent.getBoundingClientRect();
  const contentY = clientY - rect.top + layersContent.scrollTop;
  let index = Math.floor(contentY / rowHeightPx);
  index = Math.max(0, Math.min(layers.length - 1, index));
  return layers[index]?.id ?? null;
}
