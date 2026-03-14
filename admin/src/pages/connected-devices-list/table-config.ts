/**
 * Tabulator column definitions and sort/API mapping for the connected devices table.
 */

/** Tabulator column field -> API sortField */
export const SORT_FIELD_MAP: Record<string, string> = {
  deviceId: "deviceId",
  connectionStatus: "connectionStatus",
  firstConnectedAtFormatted: "firstConnectedAt",
  averagePingMs: "averagePingMs",
  lastClientRttMs: "lastClientRttMs",
  averageServerProcessingMs: "averageServerProcessingMs",
  lastServerProcessingMs: "lastServerProcessingMs",
  timeSinceLastContactMs: "timeSinceLastContactMs",
  disconnectEvents: "disconnectEvents",
  estimatedUptimeFormatted: "estimatedUptimeMs",
  estimatedUptimeMs: "estimatedUptimeMs",
  geoLat: "geoLat",
  geoLon: "geoLon",
  geoAccuracy: "geoAccuracy",
  geoAlt: "geoAlt",
  geoAltAccuracy: "geoAltAccuracy",
  trackDisplay: "trackIndex",
  trackIndex: "trackIndex",
};

/** Tooltips for column headers (same order as column defs). */
export const COLUMN_HEADER_TOOLTIPS = [
  "Stable identifier for this device. Sent by the client in the X-Device-ID header once it has received one from the server (e.g. on first connection).",
  "Whether the server considers the device connected (contacted within the last 20 s) and if the client has returned the device ID handshake.",
  "Track index (1-based) assigned by the server when the device first polled; label (TRACKID - TRACKNAME) is resolved in this UI from the show timeline layers.",
  "Server time (Unix ms) when this device was first seen. Shown in local time.",
  "Round-trip time reported by the client (average of last few polls). Measured by the client from send of GET /api/poll to receipt of response, sent on the next poll as X-Ping-Ms.",
  "Most recent round-trip time reported by the client for the previous poll. Same measurement as Avg but not averaged.",
  "Average server-side processing time (ms) for /api/poll for this device: serverTimeAtSend - serverTimeAtRecv (average of recent samples). Useful for spotting server load.",
  "Most recent server-side processing time (ms) for /api/poll for this device: serverTimeAtSend - serverTimeAtRecv.",
  "Milliseconds since the server last received a poll request from this device.",
  "Number of times this device has gone silent (no poll within 20 s) and then contacted again. Increments once per disconnect.",
  "Time from first contact to now (if connected) or to last contact (if disconnected).",
  "Latitude (degrees) from client when the show requests GPS. Sent in X-Geo-Lat.",
  "Longitude (degrees) from client when the show requests GPS. Sent in X-Geo-Lon.",
  "Horizontal accuracy (meters) of the position. Sent in X-Geo-Accuracy.",
  "Altitude (meters) if available. Sent in X-Geo-Alt.",
  "Altitude accuracy (meters) if available. Sent in X-Geo-Alt-Accuracy.",
  "True if the device is currently sending latitude and longitude in poll headers (X-Geo-Lat, X-Geo-Lon). Set from the most recent poll; used by the server for track assignment at GPS branches.",
];

export type ColumnTitleFormatter = (
  cell: { getValue: () => string },
  formatterParams: { tooltipText?: string },
) => HTMLElement;

/** Minimal column def shape for chooser (title, visible). */
export interface ColumnDefForChooser {
  title?: string;
  field?: string;
  visible?: boolean;
  [key: string]: unknown;
}

/** Build Tabulator column definitions with the given title formatter (info bubble + title). */
export function getColumnDefs(columnTitleWithInfoBubble: ColumnTitleFormatter): ColumnDefForChooser[] {
  const T = columnTitleWithInfoBubble;
  const C = COLUMN_HEADER_TOOLTIPS;
  return [
    { title: "Device ID", field: "deviceId", sorter: "string", titleFormatter: T, titleFormatterParams: { tooltipText: C[0] } },
    { title: "Connection Status", field: "connectionStatus", sorter: "string", titleFormatter: T, titleFormatterParams: { tooltipText: C[1] } },
    { title: "Track", field: "trackDisplay", sorter: "string", sorterParams: { field: "trackIndex" }, titleFormatter: T, titleFormatterParams: { tooltipText: C[2] } },
    { title: "Is Sending GPS Data", field: "isSendingGps", sorter: "boolean", formatter: (c: { getValue(): unknown }) => (c.getValue() ? "Yes" : "No"), titleFormatter: T, titleFormatterParams: { tooltipText: C[16] } },
    { title: "First Connected At", field: "firstConnectedAtFormatted", sorter: "string", visible: false, titleFormatter: T, titleFormatterParams: { tooltipText: C[3] } },
    { title: "Avg Client RTT (ms)", field: "averagePingMs", sorter: "number", titleFormatter: T, titleFormatterParams: { tooltipText: C[4] } },
    { title: "Last Client RTT (ms)", field: "lastClientRttMs", sorter: "number", titleFormatter: T, titleFormatterParams: { tooltipText: C[5] } },
    { title: "Avg Server Processing (ms)", field: "averageServerProcessingMs", sorter: "number", titleFormatter: T, titleFormatterParams: { tooltipText: C[6] } },
    { title: "Last Server Processing (ms)", field: "lastServerProcessingMs", sorter: "number", titleFormatter: T, titleFormatterParams: { tooltipText: C[7] } },
    { title: "Time since last contact (ms)", field: "timeSinceLastContactMs", sorter: "number", titleFormatter: T, titleFormatterParams: { tooltipText: C[8] } },
    { title: "Disconnect Events", field: "disconnectEvents", sorter: "number", titleFormatter: T, titleFormatterParams: { tooltipText: C[9] } },
    { title: "Estimated Uptime", field: "estimatedUptimeFormatted", sorter: "number", visible: false, sorterParams: { field: "estimatedUptimeMs" }, titleFormatter: T, titleFormatterParams: { tooltipText: C[10] } },
    { title: "Latitude", field: "geoLat", sorter: "number", titleFormatter: T, titleFormatterParams: { tooltipText: C[11] } },
    { title: "Longitude", field: "geoLon", sorter: "number", titleFormatter: T, titleFormatterParams: { tooltipText: C[12] } },
    { title: "Geo Accuracy (m)", field: "geoAccuracy", sorter: "number", titleFormatter: T, titleFormatterParams: { tooltipText: C[13] } },
    { title: "Altitude (m)", field: "geoAlt", sorter: "number", visible: false, titleFormatter: T, titleFormatterParams: { tooltipText: C[14] } },
    { title: "Altitude Accuracy (m)", field: "geoAltAccuracy", sorter: "number", visible: false, titleFormatter: T, titleFormatterParams: { tooltipText: C[15] } },
  ];
}
