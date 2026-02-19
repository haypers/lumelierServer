import * as popup from "./popup";

/** Cached position from geolocation; used for poll headers when the show requests GPS. */
export interface CachedGeo {
  lat: number;
  lon: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
}

let cachedGeo: CachedGeo | null = null;
const GEO_REFRESH_INTERVAL_MS = 8000;
let geoRefreshTimerId: ReturnType<typeof setInterval> | null = null;

function clearGeoRefreshTimer(): void {
  if (geoRefreshTimerId != null) {
    clearInterval(geoRefreshTimerId);
    geoRefreshTimerId = null;
  }
}

function updateGeoCache(position: GeolocationPosition): void {
  const c = position.coords;
  cachedGeo = {
    lat: c.latitude,
    lon: c.longitude,
    accuracy: c.accuracy,
    altitude: c.altitude ?? null,
    altitudeAccuracy: c.altitudeAccuracy ?? null,
  };
}

/** Single getCurrentPosition; on success updates cache and dismisses gps-required popup. */
function requestSingleGeoUpdate(): void {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      updateGeoCache(pos);
      popup.dismissPopupsByType("gps-required");
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
}

function startGeoRefreshTimer(): void {
  clearGeoRefreshTimer();
  function tick(): void {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => updateGeoCache(pos),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  }
  tick();
  geoRefreshTimerId = setInterval(tick, GEO_REFRESH_INTERVAL_MS);
}

async function checkGeolocationPermission(): Promise<"granted" | "denied" | "prompt"> {
  if (typeof navigator.permissions?.query !== "function") return "prompt";
  try {
    const result = await navigator.permissions.query({ name: "geolocation" });
    return result.state as "granted" | "denied" | "prompt";
  } catch {
    return "prompt";
  }
}

/**
 * Call after each poll when the timeline may have changed.
 * If gpsRequired is true: ensure permission (show Allow popup or start periodic geo updates).
 * If false: stop the refresh timer.
 */
export function setGpsRequired(gpsRequired: boolean): void {
  if (!gpsRequired) {
    clearGeoRefreshTimer();
    return;
  }
  checkGeolocationPermission().then((perm) => {
    if (perm === "granted") {
      startGeoRefreshTimer();
      popup.dismissPopupsByType("gps-required");
    } else {
      const insecure = typeof window !== "undefined" && !window.isSecureContext;
      const message = insecure
        ? "This lightshow requires location. Location access only works on secure connections (HTTPS) or localhost. Please open this page via https:// or use a device on the same computer as the show server."
        : "This lightshow requires location information on your device.";
      popup.showOneButtonPopupIfNotExists("gps-required", {
        message,
        primaryLabel: insecure ? "OK" : "Allow",
        onPrimaryClick: insecure ? () => popup.dismissPopupsByType("gps-required") : requestSingleGeoUpdate,
      });
    }
  });
}

/** Last cached position, or null. Used to build poll request headers. */
export function getCachedGeo(): CachedGeo | null {
  return cachedGeo;
}

/** Append X-Geo-* headers to the given object when cached position exists. */
export function addGeoHeaders(headers: Record<string, string>): void {
  const geo = cachedGeo;
  if (!geo) return;
  headers["X-Geo-Lat"] = String(geo.lat);
  headers["X-Geo-Lon"] = String(geo.lon);
  headers["X-Geo-Accuracy"] = String(geo.accuracy);
  if (geo.altitude != null) {
    headers["X-Geo-Alt"] = String(geo.altitude);
  }
  if (geo.altitudeAccuracy != null) {
    headers["X-Geo-Alt-Accuracy"] = String(geo.altitudeAccuracy);
  }
}
