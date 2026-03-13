/** Bar background color by range type (match asset tab pills). */
export const RANGE_TYPE_BG: Record<"Audio" | "Video" | "Image", string> = {
  Audio: "var(--asset-pill-audio)",
  Video: "var(--asset-pill-video)",
  Image: "var(--asset-pill-image)",
};

export const RANGE_HANDLE_WIDTH_PX = 8;
export const RANGE_MIN_WIDTH_PX = 24;
/** Hit zone centered on each range end; total width 16px (8px each side of the end). */
export const RANGE_HANDLE_ZONE_WIDTH_PX = 16;
