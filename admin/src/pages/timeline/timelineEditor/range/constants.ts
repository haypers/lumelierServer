/** Bar background color by range type (match asset tab pills). */
export const RANGE_TYPE_BG: Record<"Audio" | "Video" | "Image", string> = {
  Audio: "var(--asset-pill-audio)",
  Video: "var(--asset-pill-video)",
  Image: "var(--asset-pill-image)",
};

export const RANGE_MIN_WIDTH_PX = 2;
/** 1D X distance in px within which a range edge is considered "hovered" for resize handle. */
export const RANGE_HANDLE_HOVER_RADIUS_PX = 10;
