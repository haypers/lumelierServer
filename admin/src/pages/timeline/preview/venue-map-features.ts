/**
 * Venue map features for the preview map (GPS on): search, Edit Show Location (circle), Map Clients.
 */

import L from "leaflet";
import searchIcon from "../../../icons/search.svg?raw";
import dragHandleIcon from "../../../icons/drag-handle.svg?raw";
import animatedLoadingIcon from "../../../icons/animatedLoadingIcon.svg?raw";
import mapIcon from "../../../icons/map.svg?raw";
import eyeIcon from "../../../icons/eye.svg?raw";
import noEyeIcon from "../../../icons/no-eye.svg?raw";
import carrotIcon from "../../../icons/carrot.svg?raw";
import lightOffIcon from "../../../icons/light-off.svg?raw";
import lightOnIcon from "../../../icons/light-on.svg?raw";
import robotIcon from "../../../icons/robot.svg?raw";
import { createInfoBubble } from "../../../components/info-bubble";

const NOMINATIM_USER_AGENT = "Lumelier Light Show Planner";
const SEARCH_TIMEOUT_MS = 12_000;

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

type MapClientsParentMode = "none" | "mapped";
type MapClientsSubMode = "locationOnly" | "plannedColor" | "simulatedColors";
interface MapClientsStateApi {
  parentMode: MapClientsParentMode;
  mappedLimit: number;
  subMode: MapClientsSubMode | null;
}

const MAP_CLIENTS_TOOLTIP: Record<MapClientsSubMode, string> = {
  locationOnly:
    "This is the least resource intensive operation, simply plotting the locations of the connected clients with a grey dot",
  plannedColor:
    "This opperation will additionally request the timeline for each client, and set the points to the intended color. This will require significant resources.",
  simulatedColors:
    "This opperation will connect to the simulated clients server, and plot the color of simulated clients in real time, allowing a simulation preview. This is very resource intensive.",
};

function clampInt(n: number, min: number, max: number): number {
  const nn = Math.round(n);
  if (!Number.isFinite(nn)) return min;
  return Math.min(max, Math.max(min, nn));
}

export interface ShowLocationData {
  lat: number;
  lng: number;
  radiusMeters: number;
  requestsGPS: boolean;
}

export interface PreviewMapVenueFeaturesOptions {
  onShowSyncing?: () => void;
  onShowSaved?: () => void;
  onShowLocationUpdated?: (data: ShowLocationData) => void;
}

export function initPreviewMapVenueFeatures(
  map: L.Map,
  wrapEl: HTMLElement,
  showId: string | null,
  options?: PreviewMapVenueFeaturesOptions
): void {
  const searchOverlay = wrapEl.querySelector(".timeline-preview-map-overlay-search") as HTMLElement | null;
  const bottomLeftOverlay = wrapEl.querySelector(".timeline-preview-map-overlay-bottom-left") as HTMLElement | null;
  if (!searchOverlay || !bottomLeftOverlay) return;

  const searchResultMarkerLayer = L.layerGroup().addTo(map);
  let clearSearchMarkerHandler: ((e: L.LeafletMouseEvent) => void) | null = null;

  function clearSearchMarker(): void {
    searchResultMarkerLayer.clearLayers();
    if (clearSearchMarkerHandler) {
      map.off("click", clearSearchMarkerHandler);
      clearSearchMarkerHandler = null;
    }
  }

  function addTemporarySearchMarker(latNum: number, lonNum: number): void {
    clearSearchMarker();
    L.marker([latNum, lonNum], {
      icon: L.divIcon({
        className: "timeline-preview-map-search-pin",
        html: "<span></span>",
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(searchResultMarkerLayer);
    clearSearchMarkerHandler = () => clearSearchMarker();
    map.once("click", clearSearchMarkerHandler);
  }

  // --- Search overlay (top-right) ---
  const searchWrapId = "timeline-preview-map-search-wrap";
  const searchInputId = "timeline-preview-map-search-input";
  const searchBtnId = "timeline-preview-map-search-btn";
  const searchResultsId = "timeline-preview-map-search-results";

  searchOverlay.innerHTML = `
    <div class="timeline-preview-map-search-wrap" id="${searchWrapId}">
      <div class="timeline-preview-map-search-group">
        <input type="text" id="${searchInputId}" placeholder="Search for a place…" aria-label="Search place" />
        <button type="button" class="timeline-preview-map-search-btn" id="${searchBtnId}" aria-label="Search">${searchIcon}</button>
      </div>
      <div class="timeline-preview-map-search-results" id="${searchResultsId}" hidden role="listbox" aria-label="Search results"></div>
    </div>
  `;

  const searchBtnEl = searchOverlay.querySelector(`#${searchBtnId}`) as HTMLButtonElement;
  const searchResultsEl = searchOverlay.querySelector(`#${searchResultsId}`) as HTMLElement;

  function setSearchButtonIcon(loading: boolean): void {
    if (!searchBtnEl) return;
    searchBtnEl.innerHTML = loading ? animatedLoadingIcon : searchIcon;
  }

  function closeSearchResults(): void {
    if (!searchResultsEl) return;
    searchResultsEl.hidden = true;
    searchResultsEl.innerHTML = "";
  }

  function showNoSearchResults(): void {
    if (!searchResultsEl) return;
    searchResultsEl.innerHTML = '<div class="timeline-preview-map-search-results-empty">No places found</div>';
    searchResultsEl.hidden = false;
  }

  function showSearchResultsList(results: NominatimResult[]): void {
    if (!searchResultsEl) return;
    searchResultsEl.innerHTML = "";
    for (const r of results) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "timeline-preview-map-search-results-item";
      btn.setAttribute("role", "option");
      btn.dataset.lat = r.lat;
      btn.dataset.lon = r.lon;
      btn.textContent = r.display_name;
      searchResultsEl.appendChild(btn);
    }
    searchResultsEl.hidden = false;
  }

  function flyToAndMark(latNum: number, lonNum: number): void {
    try {
      if (map.getContainer().isConnected) {
        map.invalidateSize();
      }
    } catch {
      /* map container may be detached */
    }
    map.flyTo([latNum, lonNum], 14, { duration: 0.5 });
    addTemporarySearchMarker(latNum, lonNum);
  }

  async function search(): Promise<void> {
    if (!searchOverlay) return;
    const input = searchOverlay.querySelector(`#${searchInputId}`) as HTMLInputElement;
    const q = input?.value?.trim();
    if (!q) return;

    closeSearchResults();

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;
    function restoreIcon(): void {
      if (resolved) return;
      resolved = true;
      if (timeoutId != null) clearTimeout(timeoutId);
      setSearchButtonIcon(false);
      searchBtnEl.disabled = false;
    }

    searchBtnEl.disabled = true;
    setSearchButtonIcon(true);
    timeoutId = setTimeout(restoreIcon, SEARCH_TIMEOUT_MS);

    try {
      const params = new URLSearchParams({ q, format: "json", limit: "10" });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { "User-Agent": NOMINATIM_USER_AGENT },
      });
      restoreIcon();
      if (!res.ok) throw new Error("Search failed");
      const data = (await res.json()) as NominatimResult[];
      const cleaned = (data ?? []).filter(
        (r) =>
          r &&
          typeof r.display_name === "string" &&
          typeof r.lat === "string" &&
          typeof r.lon === "string" &&
          Number.isFinite(Number(r.lat)) &&
          Number.isFinite(Number(r.lon))
      );
      if (!cleaned.length) {
        showNoSearchResults();
        return;
      }
      if (cleaned.length === 1) {
        flyToAndMark(Number(cleaned[0].lat), Number(cleaned[0].lon));
        return;
      }
      showSearchResultsList(cleaned);
    } catch {
      restoreIcon();
    }
  }

  searchOverlay.querySelector(`#${searchWrapId}`)?.addEventListener("click", (e) => e.stopPropagation());
  searchBtnEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    search();
  });
  searchOverlay.querySelector(`#${searchInputId}`)?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") search();
  });
  searchResultsEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    const target = e.target as HTMLElement | null;
    const btn = target?.closest?.(".timeline-preview-map-search-results-item") as HTMLButtonElement | null;
    if (!btn) return;
    const latNum = Number(btn.dataset.lat);
    const lonNum = Number(btn.dataset.lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return;
    closeSearchResults();
    flyToAndMark(latNum, lonNum);
  });

  // --- Bottom-left: Edit Show Location + Map Clients ---
  const editLocationBtnId = "timeline-preview-map-edit-location-btn";
  const mapClientsBtnId = "timeline-preview-map-map-clients-btn";
  const mapClientsDropdownId = "timeline-preview-map-map-clients-dropdown";

  let mapClientsParentMode: MapClientsParentMode = "none";
  let mapClientsMappedLimit = 10;
  let mapClientsSubMode: MapClientsSubMode | null = null;

  bottomLeftOverlay.innerHTML = `
    <button type="button" class="timeline-preview-map-btn" id="${editLocationBtnId}">${mapIcon}<span>Edit Show Location</span></button>
    <div class="timeline-preview-map-clients-wrap">
      <button type="button" class="timeline-preview-map-btn timeline-preview-map-clients-btn" id="${mapClientsBtnId}" aria-expanded="false" aria-haspopup="true" aria-controls="${mapClientsDropdownId}">
        <span class="timeline-preview-map-clients-icon" data-map-clients-btn-icon aria-hidden="true">${eyeIcon}</span>
        <span class="timeline-preview-map-clients-label">Map Clients<span class="timeline-preview-map-clients-caret" aria-hidden="true">${carrotIcon}</span></span>
      </button>
      <div class="timeline-preview-map-clients-dropdown" id="${mapClientsDropdownId}" hidden role="menu"></div>
    </div>
  `;

  const editLocationBtn = bottomLeftOverlay.querySelector(`#${editLocationBtnId}`) as HTMLButtonElement;
  const mapClientsBtnEl = bottomLeftOverlay.querySelector(`#${mapClientsBtnId}`) as HTMLButtonElement;
  const mapClientsDropdownEl = bottomLeftOverlay.querySelector(`#${mapClientsDropdownId}`) as HTMLElement;

  let editLocationMode = false;
  let showLocation: ShowLocationData | null = null;
  let circleLayer: L.Circle | null = null;
  let circleCenterMarker: L.Marker | null = null;
  let circleHandleMarker: L.Marker | null = null;
  const circleEditLayer = L.layerGroup().addTo(map);
  const EDIT_BTN_CONFIRM_CLASS = "timeline-preview-map-edit-btn--confirm";

  function setEditLocationMode(active: boolean): void {
    editLocationMode = active;
    if (active) {
      closeSearchResults();
      closeMapClientsDropdown();
    }
  }

  const MIN_RADIUS_METERS = 10;

  function getDefaultRadiusMeters(): number {
    const bounds = map.getBounds();
    const center = map.getCenter();
    const east = L.latLng(center.lat, bounds.getEast());
    const north = L.latLng(bounds.getNorth(), center.lng);
    const w = map.distance(center, east);
    const h = map.distance(center, north);
    return Math.max(MIN_RADIUS_METERS, Math.min(w, h) / 4);
  }

  function latLngAtBearing(center: L.LatLng, radiusMeters: number, bearingDeg: number): L.LatLng {
    const R = 6371000;
    const br = (bearingDeg * Math.PI) / 180;
    const lat0 = (center.lat * Math.PI) / 180;
    const lng0 = (center.lng * Math.PI) / 180;
    const lat1 = Math.asin(
      Math.sin(lat0) * Math.cos(radiusMeters / R) +
        Math.cos(lat0) * Math.sin(radiusMeters / R) * Math.cos(br)
    );
    const lng1 =
      lng0 +
      Math.atan2(
        Math.sin(br) * Math.sin(radiusMeters / R) * Math.cos(lat0),
        Math.cos(radiusMeters / R) - Math.sin(lat0) * Math.sin(lat1)
      );
    return L.latLng((lat1 * 180) / Math.PI, (lng1 * 180) / Math.PI);
  }

  function closeMapClientsDropdown(): void {
    if (!mapClientsDropdownEl) return;
    mapClientsDropdownEl.hidden = true;
    mapClientsBtnEl?.setAttribute("aria-expanded", "false");
  }

  function openMapClientsDropdown(): void {
    if (!mapClientsDropdownEl) return;
    closeSearchResults();
    mapClientsDropdownEl.hidden = false;
    mapClientsBtnEl?.setAttribute("aria-expanded", "true");
    syncMapClientsDropdown();
  }

  function toggleMapClientsDropdown(): void {
    if (!mapClientsDropdownEl) return;
    if (mapClientsDropdownEl.hidden) openMapClientsDropdown();
    else closeMapClientsDropdown();
  }

  function updateEditButtonLabel(): void {
    if (!editLocationBtn) return;
    const span = editLocationBtn.querySelector("span");
    if (!span) return;
    if (!editLocationMode) {
      span.textContent = "Edit Show Location";
      editLocationBtn.classList.remove("timeline-preview-map-btn-danger");
      editLocationBtn.classList.remove(EDIT_BTN_CONFIRM_CLASS);
      return;
    }
    if (!showLocation) {
      span.textContent = "Cancel";
      editLocationBtn.classList.add("timeline-preview-map-btn-danger");
      editLocationBtn.classList.remove(EDIT_BTN_CONFIRM_CLASS);
    } else {
      span.textContent = "Confirm Location";
      editLocationBtn.classList.remove("timeline-preview-map-btn-danger");
      editLocationBtn.classList.add(EDIT_BTN_CONFIRM_CLASS);
    }
  }

  function removeCircleEditLayers(): void {
    circleEditLayer.clearLayers();
    circleLayer = null;
    circleCenterMarker = null;
    circleHandleMarker = null;
  }

  function drawCircleState(fitBounds = false): void {
    removeCircleEditLayers();
    if (!showLocation || showLocation.radiusMeters <= 0) {
      updateEditButtonLabel();
      return;
    }
    const center = L.latLng(showLocation.lat, showLocation.lng);
    const isEditing = editLocationMode;
    const fillOpacity = isEditing ? 0.25 : 0;
    const strokeColor = isEditing ? "#4a7dc7" : "#4a7dc7";
    const weight = isEditing ? 2 : 2;
    circleLayer = L.circle(center, {
      radius: showLocation.radiusMeters,
      color: strokeColor,
      fillColor: "#87ceeb",
      fillOpacity,
      weight,
    }).addTo(circleEditLayer);
    if (isEditing) {
      circleCenterMarker = L.marker(center, {
        icon: L.divIcon({
          className: "timeline-preview-map-show-location-center",
          html: "<span></span>",
          iconSize: [8, 8],
          iconAnchor: [4, 4],
        }),
        interactive: false,
      }).addTo(circleEditLayer);
      const handleLatLng = latLngAtBearing(center, showLocation.radiusMeters, 0);
      circleHandleMarker = L.marker(handleLatLng, {
        draggable: true,
        icon: L.divIcon({
          className: "timeline-preview-map-show-location-handle",
          html: `<span class="timeline-preview-map-show-location-handle-inner">${dragHandleIcon}</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      }).addTo(circleEditLayer);
      circleHandleMarker.on("click", (e) => L.DomEvent.stopPropagation(e));
      circleHandleMarker.on("drag", () => {
        if (!showLocation || !circleHandleMarker) return;
        const handleLl = circleHandleMarker.getLatLng();
        const centerLl = L.latLng(showLocation.lat, showLocation.lng);
        const newRadius = map.distance(centerLl, handleLl);
        if (newRadius < 10) return;
        showLocation = { ...showLocation, radiusMeters: newRadius };
        circleHandleMarker!.setLatLng(latLngAtBearing(centerLl, newRadius, 0));
        if (circleLayer) circleLayer.setRadius(newRadius);
      });
    }
    if (fitBounds) {
      const r = showLocation.radiusMeters;
      const padding = r * 0.2;
      const bounds = L.latLngBounds(
        latLngAtBearing(center, r + padding, 225),
        latLngAtBearing(center, r + padding, 45)
      );
      map.fitBounds(bounds, { padding: [20, 20] });
    }
    updateEditButtonLabel();
  }

  function putShowLocationOnConfirm(): void {
    if (!showId || !showLocation) return;
    const radiusMeters = Math.max(MIN_RADIUS_METERS, showLocation.radiusMeters);
    const payload = {
      lat: showLocation.lat,
      lng: showLocation.lng,
      radiusMeters,
      requestsGPS: showLocation.requestsGPS,
    };
    options?.onShowSyncing?.();
    fetch(`/api/admin/show-workspaces/${showId}/show-location`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (res.ok) {
          options?.onShowSaved?.();
          options?.onShowLocationUpdated?.(payload);
        } else {
          res.text().then((t) => alert(`Failed to save show location: ${res.status} ${t || res.statusText}`));
        }
      })
      .catch((e) => {
        alert(`Failed to save show location: ${e instanceof Error ? e.message : String(e)}`);
      });
  }

  function setBubbleSelected(bubble: HTMLElement | null, selected: boolean): void {
    if (!bubble) return;
    bubble.classList.toggle("map-clients-bubble--selected", selected);
  }

  function ensureDefaultSubMode(): void {
    if (mapClientsParentMode === "mapped" && mapClientsSubMode == null) {
      mapClientsSubMode = "locationOnly";
    }
  }

  function syncMapClientsButtonIcon(): void {
    if (!mapClientsBtnEl) return;
    const slot = mapClientsBtnEl.querySelector<HTMLElement>("[data-map-clients-btn-icon]");
    if (!slot) return;
    slot.innerHTML = mapClientsParentMode === "none" ? noEyeIcon : eyeIcon;
  }

  function syncMapClientsDropdown(): void {
    if (!mapClientsDropdownEl) return;
    const parentNoneBtn = mapClientsDropdownEl.querySelector<HTMLElement>('[data-map-clients-parent="none"]');
    const parentMappedBtn = mapClientsDropdownEl.querySelector<HTMLElement>('[data-map-clients-parent="mapped"]');
    const limitInput = mapClientsDropdownEl.querySelector<HTMLInputElement>(".map-clients-limit-input");

    setBubbleSelected(parentNoneBtn?.querySelector<HTMLElement>(".map-clients-bubble") ?? null, mapClientsParentMode === "none");
    setBubbleSelected(parentMappedBtn?.querySelector<HTMLElement>(".map-clients-bubble") ?? null, mapClientsParentMode === "mapped");
    parentNoneBtn?.setAttribute("aria-checked", String(mapClientsParentMode === "none"));
    parentMappedBtn?.setAttribute("aria-checked", String(mapClientsParentMode === "mapped"));

    if (limitInput) {
      limitInput.disabled = mapClientsParentMode !== "mapped";
      limitInput.value = String(mapClientsMappedLimit);
    }

    const subEnabled = mapClientsParentMode === "mapped";
    const subButtons = mapClientsDropdownEl.querySelectorAll<HTMLButtonElement>("[data-map-clients-sub]");
    subButtons.forEach((btn) => {
      const key = btn.dataset.mapClientsSub as MapClientsSubMode | undefined;
      const bubble = btn.querySelector<HTMLElement>(".map-clients-bubble");
      btn.classList.toggle("map-clients-row--disabled", !subEnabled);
      btn.setAttribute("aria-disabled", String(!subEnabled));
      const selected = subEnabled && key != null && key === mapClientsSubMode;
      setBubbleSelected(bubble, selected);
      if (!subEnabled) setBubbleSelected(bubble, false);
    });

    syncMapClientsButtonIcon();
  }

  function postCurrentMapState(alertOnError: boolean): Promise<boolean> {
    if (!showId) return Promise.resolve(true);
    const payload: MapClientsStateApi = {
      parentMode: mapClientsParentMode,
      mappedLimit: mapClientsMappedLimit,
      subMode: mapClientsSubMode,
    };
    return fetch(`/api/admin/show-workspaces/${showId}/map-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: [], loadedVenueName: null, mapClients: payload }),
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok && alertOnError) {
          res.text().then((t) => alert(`Failed to update map state: ${res.status} ${t || res.statusText}`));
        }
        return res.ok;
      })
      .catch((e) => {
        if (alertOnError) alert(`Failed to update map state: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      });
  }

  let mapClientsSyncDebounce: ReturnType<typeof setTimeout> | null = null;
  function queueMapClientsStateSync(): void {
    if (mapClientsSyncDebounce) {
      clearTimeout(mapClientsSyncDebounce);
      mapClientsSyncDebounce = null;
    }
    mapClientsSyncDebounce = setTimeout(() => {
      mapClientsSyncDebounce = null;
      void postCurrentMapState(false);
    }, 250);
  }

  if (mapClientsDropdownEl) {
    mapClientsDropdownEl.innerHTML = `
      <div class="map-clients-section">
        <button type="button" class="map-clients-row" data-map-clients-parent="none" role="menuitemradio" aria-checked="true">
          <span class="map-clients-bubble" aria-hidden="true"></span>
          <span class="map-clients-icon" aria-hidden="true">${noEyeIcon}</span>
          <span class="map-clients-text">No clients are mapped</span>
        </button>
        <button type="button" class="map-clients-row" data-map-clients-parent="mapped" role="menuitemradio" aria-checked="false">
          <span class="map-clients-bubble" aria-hidden="true"></span>
          <span class="map-clients-icon" aria-hidden="true">${eyeIcon}</span>
          <span class="map-clients-text">Up to</span>
          <input class="map-clients-limit-input" type="number" min="1" max="10000" step="1" value="${mapClientsMappedLimit}" aria-label="Max mapped devices" disabled />
          <span class="map-clients-text">devices are mapped.</span>
        </button>
      </div>
      <div class="map-clients-section map-clients-section--sub">
        <button type="button" class="map-clients-row map-clients-row--indented map-clients-row--disabled" data-map-clients-sub="locationOnly" role="menuitemradio" aria-checked="false" aria-disabled="true">
          <span class="map-clients-bubble" aria-hidden="true"></span>
          <span class="map-clients-icon" aria-hidden="true">${lightOffIcon}</span>
          <span class="map-clients-text">Location Only</span>
          <span class="map-clients-info-slot" data-map-clients-sub-info="locationOnly"></span>
        </button>
        <button type="button" class="map-clients-row map-clients-row--indented map-clients-row--disabled" data-map-clients-sub="plannedColor" role="menuitemradio" aria-checked="false" aria-disabled="true">
          <span class="map-clients-bubble" aria-hidden="true"></span>
          <span class="map-clients-icon" aria-hidden="true">${lightOnIcon}</span>
          <span class="map-clients-text">Location and Planned Color</span>
          <span class="map-clients-info-slot" data-map-clients-sub-info="plannedColor"></span>
        </button>
        <button type="button" class="map-clients-row map-clients-row--indented map-clients-row--disabled" data-map-clients-sub="simulatedColors" role="menuitemradio" aria-checked="false" aria-disabled="true">
          <span class="map-clients-bubble" aria-hidden="true"></span>
          <span class="map-clients-icon" aria-hidden="true">${robotIcon}</span>
          <span class="map-clients-text">Location, and Simulated Client Colors</span>
          <span class="map-clients-info-slot" data-map-clients-sub-info="simulatedColors"></span>
        </button>
      </div>
    `;
    mapClientsDropdownEl.querySelectorAll<HTMLElement>("[data-map-clients-sub-info]").forEach((slot) => {
      const key = slot.dataset.mapClientsSubInfo as MapClientsSubMode | undefined;
      if (!key) return;
      const tooltipText = MAP_CLIENTS_TOOLTIP[key] ?? "";
      const bubble = createInfoBubble({ tooltipText, ariaLabel: "Info" });
      bubble.classList.add("map-clients-info");
      slot.replaceWith(bubble);
    });
  }

  searchOverlay.querySelector(`#${searchWrapId}`)?.addEventListener("click", (e) => e.stopPropagation());
  mapClientsBtnEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMapClientsDropdown();
  });
  mapClientsDropdownEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    const target = e.target as HTMLElement | null;
    const parentBtn = target?.closest?.("[data-map-clients-parent]") as HTMLButtonElement | null;
    if (parentBtn && mapClientsDropdownEl?.contains(parentBtn)) {
      const mode = parentBtn.dataset.mapClientsParent as MapClientsParentMode | undefined;
      if (mode === "none") {
        mapClientsParentMode = "none";
        mapClientsSubMode = null;
      } else if (mode === "mapped") {
        mapClientsParentMode = "mapped";
        ensureDefaultSubMode();
      }
      syncMapClientsDropdown();
      queueMapClientsStateSync();
      return;
    }
    const subBtn = target?.closest?.("[data-map-clients-sub]") as HTMLButtonElement | null;
    if (subBtn && mapClientsDropdownEl?.contains(subBtn)) {
      if (mapClientsParentMode !== "mapped") return;
      const sub = subBtn.dataset.mapClientsSub as MapClientsSubMode | undefined;
      if (!sub) return;
      mapClientsSubMode = sub;
      syncMapClientsDropdown();
      queueMapClientsStateSync();
    }
  });
  mapClientsDropdownEl
    ?.querySelector<HTMLInputElement>(".map-clients-limit-input")
    ?.addEventListener("input", (e) => {
      if (mapClientsParentMode !== "mapped") return;
      const input = e.currentTarget as HTMLInputElement;
      const n = clampInt(parseInt(input.value || "0", 10), 1, 10000);
      mapClientsMappedLimit = n;
      syncMapClientsDropdown();
      queueMapClientsStateSync();
    });

  map.on("click", (e: L.LeafletMouseEvent) => {
    if (!editLocationMode) return;
    const { lat, lng } = e.latlng;
    if (showLocation) {
      showLocation = { ...showLocation, lat, lng };
      drawCircleState();
      if (circleCenterMarker) circleCenterMarker.setLatLng(e.latlng);
      if (circleHandleMarker)
        circleHandleMarker.setLatLng(latLngAtBearing(e.latlng, showLocation.radiusMeters, 0));
    } else {
      const radiusMeters = getDefaultRadiusMeters();
      showLocation = { lat, lng, radiusMeters, requestsGPS: false };
      drawCircleState(true);
    }
  });

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      closeSearchResults();
      closeMapClientsDropdown();
      if (editLocationMode && !showLocation) {
        setEditLocationMode(false);
        updateEditButtonLabel();
      }
    }
  };
  document.addEventListener("keydown", onKeydown);

  const onDocClick = (): void => closeSearchResults();
  document.addEventListener("click", onDocClick);

  editLocationBtn?.addEventListener("click", () => {
    if (!editLocationMode) {
      setEditLocationMode(true);
      if (showLocation) drawCircleState();
      else updateEditButtonLabel();
      return;
    }
    if (!showLocation) {
      setEditLocationMode(false);
      removeCircleEditLayers();
      updateEditButtonLabel();
      return;
    }
    setEditLocationMode(false);
    removeCircleEditLayers();
    drawCircleState();
    putShowLocationOnConfirm();
  });

  syncMapClientsDropdown();

  async function loadShowLocationFromServer(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/admin/show-workspaces/${id}/show-location`, { credentials: "include" });
      if (res.status === 403 || res.status === 404) {
        showLocation = null;
        removeCircleEditLayers();
        syncMapClientsDropdown();
        return;
      }
      if (!res.ok) return;
      const raw = (await res.json()) as unknown;
      if (!raw || typeof raw !== "object") return;
      const obj = raw as Record<string, unknown>;
      const lat = typeof obj.lat === "number" && Number.isFinite(obj.lat) ? obj.lat : null;
      const lng = typeof obj.lng === "number" && Number.isFinite(obj.lng) ? obj.lng : null;
      const radiusMeters =
        typeof obj.radiusMeters === "number" && Number.isFinite(obj.radiusMeters) && obj.radiusMeters > 0
          ? obj.radiusMeters
          : null;
      const requestsGPS = obj.requestsGPS === true;
      if (lat != null && lng != null && radiusMeters != null) {
        showLocation = { lat, lng, radiusMeters, requestsGPS };
        drawCircleState(true);
      } else {
        showLocation = null;
      }
    } finally {
      syncMapClientsDropdown();
    }
  }

  if (showId) {
    void loadShowLocationFromServer(showId).then(() => {
      fetch(`/api/admin/show-workspaces/${showId}/map-state`, { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((raw: unknown) => {
          if (!raw || typeof raw !== "object") return;
          const obj = raw as Record<string, unknown>;
          const mc = obj.mapClients && typeof obj.mapClients === "object" ? (obj.mapClients as Record<string, unknown>) : null;
          if (!mc) return;
          if (mc.parentMode === "none" || mc.parentMode === "mapped") mapClientsParentMode = mc.parentMode;
          if (typeof mc.mappedLimit === "number" && Number.isFinite(mc.mappedLimit))
            mapClientsMappedLimit = clampInt(mc.mappedLimit, 1, 10000);
          if (mc.subMode === "locationOnly" || mc.subMode === "plannedColor" || mc.subMode === "simulatedColors")
            mapClientsSubMode = mapClientsParentMode === "mapped" ? mc.subMode : null;
          syncMapClientsDropdown();
        });
    });
  }
}
