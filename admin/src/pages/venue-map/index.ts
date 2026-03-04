import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./styles.css";
import { convexHull } from "./convex-hull";
import searchIcon from "../../icons/search.svg?raw";
import animatedLoadingIcon from "../../icons/animatedLoadingIcon.svg?raw";
import mapIcon from "../../icons/map.svg?raw";
import eyeIcon from "../../icons/eye.svg?raw";
import noEyeIcon from "../../icons/no-eye.svg?raw";
import carrotIcon from "../../icons/carrot.svg?raw";
import lightOffIcon from "../../icons/light-off.svg?raw";
import lightOnIcon from "../../icons/light-on.svg?raw";
import robotIcon from "../../icons/robot.svg?raw";
import { createInfoBubble } from "../../components/info-bubble";
import { createRefreshEvery } from "../../components/refresh-every";

const MAP_CONTAINER_ID = "connected-devices-map";
const SEARCH_INPUT_ID = "connected-devices-map-search-input";
const SEARCH_BTN_ID = "connected-devices-map-search-btn";
const SEARCH_WRAP_ID = "connected-devices-map-search-wrap";
const SEARCH_RESULTS_ID = "connected-devices-map-search-results";
const MAP_REFRESH_WRAP_ID = "connected-devices-map-refresh-wrap";
const MAP_CLIENTS_WRAP_ID = "connected-devices-map-map-clients-wrap";
const MAP_CLIENTS_BTN_ID = "connected-devices-map-map-clients-btn";
const MAP_CLIENTS_DROPDOWN_ID = "connected-devices-map-map-clients-dropdown";
const TOOLBAR_ID = "connected-devices-map-toolbar";
const EDIT_VENUE_BTN_ID = "connected-devices-map-edit-venue-btn";
const NOMINATIM_USER_AGENT = "Lumelier Light Show Planner";
const SEARCH_TIMEOUT_MS = 12_000;
const EDIT_BTN_CONFIRM_CLASS = "connected-devices-map-edit-btn--confirm";
const MAP_STATE_REFRESH_DEFAULT_MS = 2000;
const MAP_STATE_REFRESH_STORAGE_KEY = "Connected_Devices_Map-State";

/** Module-level show id when viewing a show's venue map; used for PUT venue-shape on Confirm. */
let currentShowId: string | null = null;

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

interface MapStateApi {
  points: [number, number][];
  loadedVenueName: string | null;
  mapClients: MapClientsStateApi;
}

const VENUE_MAP_EMPTY_MESSAGE =
  "Please open or create a show to view or edit its venue map.";

export function render(container: HTMLElement, showId: string | null): void {
  if (showId === null) {
    container.innerHTML = `
      <div class="show-required-empty-state">
        <p class="show-required-empty-state-message">${VENUE_MAP_EMPTY_MESSAGE}</p>
      </div>`;
    currentShowId = null;
    return;
  }

  currentShowId = showId;
  container.innerHTML = `
    <div class="connected-devices-map-wrap">
      <div class="connected-devices-map-toolbar" id="${TOOLBAR_ID}">
        <div class="connected-devices-map-search-wrap" id="${SEARCH_WRAP_ID}">
          <div class="connected-devices-map-search-group">
            <input type="text" id="${SEARCH_INPUT_ID}" placeholder="Search for a place…" aria-label="Search place" />
            <button type="button" class="connected-devices-map-search-btn" id="${SEARCH_BTN_ID}" aria-label="Search">${searchIcon}</button>
          </div>
          <div class="connected-devices-map-search-results" id="${SEARCH_RESULTS_ID}" hidden role="listbox" aria-label="Search results"></div>
        </div>
        <button type="button" class="devices-toolbar-btn" id="${EDIT_VENUE_BTN_ID}">${mapIcon}<span>Edit Venue Shape</span></button>
      </div>
      <div class="connected-devices-map-options-bar">
        <div class="connected-devices-map-refresh-wrap" id="${MAP_REFRESH_WRAP_ID}"></div>
        <div class="connected-devices-map-map-clients-wrap" id="${MAP_CLIENTS_WRAP_ID}">
          <button type="button" class="devices-toolbar-btn connected-devices-map-map-clients-btn" id="${MAP_CLIENTS_BTN_ID}" aria-expanded="false" aria-haspopup="true" aria-controls="${MAP_CLIENTS_DROPDOWN_ID}">
            <span class="connected-devices-map-map-clients-leading-icon" data-map-clients-btn-icon aria-hidden="true">${eyeIcon}</span>
            <span class="connected-devices-map-map-clients-label">Map Clients<span class="connected-devices-map-map-clients-caret" aria-hidden="true">${carrotIcon}</span></span>
          </button>
          <div class="connected-devices-map-map-clients-dropdown" id="${MAP_CLIENTS_DROPDOWN_ID}" hidden role="menu"></div>
        </div>
      </div>
      <div class="connected-devices-map-area">
        <div id="${MAP_CONTAINER_ID}"></div>
      </div>
    </div>
  `;

  const mapEl = document.getElementById(MAP_CONTAINER_ID);
  if (!mapEl) return;

  const map = L.map(mapEl).setView([20, 0], 2);

  // Positron, no labels: shapes only (roads, water, parks).
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(map);

  // Temporary marker for search results (cleared on next map click).
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
        className: "connected-devices-map-search-pin",
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

  const searchBtnEl = document.getElementById(SEARCH_BTN_ID) as HTMLButtonElement;
  const searchWrapEl = document.getElementById(SEARCH_WRAP_ID);
  const searchResultsEl = document.getElementById(SEARCH_RESULTS_ID);
  const mapRefreshWrapEl = document.getElementById(MAP_REFRESH_WRAP_ID);

  const mapClientsWrapEl = document.getElementById(MAP_CLIENTS_WRAP_ID);
  const mapClientsBtnEl = document.getElementById(MAP_CLIENTS_BTN_ID) as HTMLButtonElement;
  const mapClientsDropdownEl = document.getElementById(MAP_CLIENTS_DROPDOWN_ID);

  let mapClientsParentMode: MapClientsParentMode = "none";
  let mapClientsMappedLimit = 10;
  let mapClientsSubMode: MapClientsSubMode | null = null;
  let loadedVenueName: string | null = null;
  let mapStateRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let refreshClockRafId: number | null = null;
  let mapRefreshEveryApi: ReturnType<typeof createRefreshEvery> | null = null;
  let mapStateSyncInFlight = false;
  let mapClientsSyncDebounce: ReturnType<typeof setTimeout> | null = null;

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

  function clonePoints(src: [number, number][]): [number, number][] {
    return src.map(([lat, lng]) => [lat, lng]);
  }

  function parseMapState(raw: unknown): MapStateApi | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.points)) return null;
    const points: [number, number][] = [];
    for (const p of obj.points) {
      if (
        !Array.isArray(p) ||
        p.length !== 2 ||
        typeof p[0] !== "number" ||
        typeof p[1] !== "number" ||
        !Number.isFinite(p[0]) ||
        !Number.isFinite(p[1])
      ) {
        return null;
      }
      points.push([p[0], p[1]]);
    }
    const loadedVenueName =
      typeof obj.loadedVenueName === "string" ? obj.loadedVenueName : null;
    const mapClientsRaw =
      obj.mapClients && typeof obj.mapClients === "object"
        ? (obj.mapClients as Record<string, unknown>)
        : null;
    if (!mapClientsRaw) return null;
    const parentMode = mapClientsRaw.parentMode;
    const mappedLimit = mapClientsRaw.mappedLimit;
    const subMode = mapClientsRaw.subMode;
    if (parentMode !== "none" && parentMode !== "mapped") return null;
    if (typeof mappedLimit !== "number" || !Number.isFinite(mappedLimit)) return null;
    if (
      subMode !== null &&
      subMode !== "locationOnly" &&
      subMode !== "plannedColor" &&
      subMode !== "simulatedColors"
    ) {
      return null;
    }
    return {
      points,
      loadedVenueName,
      mapClients: {
        parentMode,
        mappedLimit: clampInt(mappedLimit, 1, 10000),
        subMode,
      },
    };
  }

  function getCurrentMapStatePayload(): MapStateApi {
    return {
      points: clonePoints(points),
      loadedVenueName,
      mapClients: {
        parentMode: mapClientsParentMode,
        mappedLimit: mapClientsMappedLimit,
        subMode: mapClientsSubMode,
      },
    };
  }

  function applyMapState(state: MapStateApi, fitBounds = false): void {
    points = clonePoints(state.points);
    loadedVenueName = state.loadedVenueName;
    mapClientsParentMode = state.mapClients.parentMode;
    mapClientsMappedLimit = clampInt(state.mapClients.mappedLimit, 1, 10000);
    mapClientsSubMode =
      mapClientsParentMode === "mapped"
        ? state.mapClients.subMode ?? "locationOnly"
        : null;
    selectedPointIndex = null;
    confirmed = false;
    pointMarkersLayer.clearLayers();
    updateHullPolygonOnly(fitBounds);
    syncMapClientsDropdown();
  }

  async function postCurrentMapState(alertOnError: boolean): Promise<boolean> {
    try {
      const res = await fetch("/api/admin/map-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getCurrentMapStatePayload()),
      });
      if (!res.ok) {
        if (alertOnError) {
          const text = await res.text();
          alert(`Failed to update map state: ${res.status} ${text || res.statusText}`);
        }
        return false;
      }
      return true;
    } catch (e) {
      if (alertOnError) {
        alert(`Failed to update map state: ${e instanceof Error ? e.message : String(e)}`);
      }
      return false;
    }
  }

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

  async function syncMapStateFromServer(): Promise<void> {
    if (mapStateSyncInFlight) return;
    mapStateSyncInFlight = true;
    try {
      const res = await fetch("/api/admin/map-state", { credentials: "include" });
      if (!res.ok) return;
      const parsed = parseMapState(await res.json());
      if (!parsed || drawingMode) return;
      if (currentShowId != null) {
        mapClientsParentMode = parsed.mapClients.parentMode;
        mapClientsMappedLimit = clampInt(parsed.mapClients.mappedLimit, 1, 10000);
        mapClientsSubMode =
          parsed.mapClients.parentMode === "mapped"
            ? parsed.mapClients.subMode ?? "locationOnly"
            : null;
        syncMapClientsDropdown();
      } else {
        applyMapState(parsed);
      }
    } finally {
      mapStateSyncInFlight = false;
      mapRefreshEveryApi?.recordRefresh();
    }
  }

  function startMapStateRefresh(ms: number): void {
    if (mapStateRefreshTimer) {
      clearInterval(mapStateRefreshTimer);
      mapStateRefreshTimer = null;
    }
    if (ms > 0) {
      mapStateRefreshTimer = setInterval(() => {
        void syncMapStateFromServer();
      }, ms);
    }
  }

  function runRefreshClock(): void {
    mapRefreshEveryApi?.updateClockHand();
    refreshClockRafId = requestAnimationFrame(runRefreshClock);
  }

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
    searchResultsEl.innerHTML =
      '<div class="connected-devices-map-search-results-empty">No places found</div>';
    searchResultsEl.hidden = false;
  }

  function showSearchResultsList(results: NominatimResult[]): void {
    if (!searchResultsEl) return;
    searchResultsEl.innerHTML = "";
    for (const r of results) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "connected-devices-map-search-results-item";
      btn.setAttribute("role", "option");
      btn.dataset.lat = r.lat;
      btn.dataset.lon = r.lon;
      btn.textContent = r.display_name;
      searchResultsEl.appendChild(btn);
    }
    searchResultsEl.hidden = false;
  }

  function flyToAndMark(latNum: number, lonNum: number): void {
    map.invalidateSize();
    map.flyTo([latNum, lonNum], 14, { duration: 0.5 });
    addTemporarySearchMarker(latNum, lonNum);
  }

  async function search(): Promise<void> {
    const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement;
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
        const latNum = Number(cleaned[0].lat);
        const lonNum = Number(cleaned[0].lon);
        flyToAndMark(latNum, lonNum);
        return;
      }
      showSearchResultsList(cleaned);
    } catch {
      restoreIcon();
    }
  }

  // Prevent document-level outside-click handlers from firing when interacting with search UI.
  searchWrapEl?.addEventListener("click", (e) => e.stopPropagation());

  mapRefreshEveryApi = createRefreshEvery({
    name: MAP_STATE_REFRESH_STORAGE_KEY,
    defaultMs: MAP_STATE_REFRESH_DEFAULT_MS,
    infoTooltip: "How often to retreive map state from the server.",
    onManualRefresh: syncMapStateFromServer,
    onIntervalChange(ms) {
      startMapStateRefresh(ms);
    },
  });
  if (mapRefreshWrapEl && mapRefreshEveryApi) {
    mapRefreshWrapEl.appendChild(mapRefreshEveryApi.root);
  }
  const initialMapRefreshMs = mapRefreshEveryApi.getIntervalMs();
  startMapStateRefresh(initialMapRefreshMs);
  if (refreshClockRafId == null) {
    refreshClockRafId = requestAnimationFrame(runRefreshClock);
  }

  searchBtnEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    search();
  });

  document.getElementById(SEARCH_INPUT_ID)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });

  searchResultsEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    const target = e.target as HTMLElement | null;
    const btn = target?.closest?.(".connected-devices-map-search-results-item") as
      | HTMLButtonElement
      | null;
    if (!btn) return;
    const latNum = Number(btn.dataset.lat);
    const lonNum = Number(btn.dataset.lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return;
    closeSearchResults();
    flyToAndMark(latNum, lonNum);
  });

  document.addEventListener("click", () => closeSearchResults());

  // --- Map Clients dropdown UI (no functionality yet) ---
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

  function attachMapClientsTooltips(): void {
    if (!mapClientsDropdownEl) return;
    const slots = mapClientsDropdownEl.querySelectorAll<HTMLElement>("[data-map-clients-sub-info]");
    slots.forEach((slot) => {
      const key = slot.dataset.mapClientsSubInfo as MapClientsSubMode | undefined;
      if (!key) return;
      const tooltipText = MAP_CLIENTS_TOOLTIP[key] ?? "";
      const bubble = createInfoBubble({
        tooltipText,
        ariaLabel: "Info",
      });
      bubble.classList.add("map-clients-info");
      slot.replaceWith(bubble);
    });
  }

  function syncMapClientsDropdown(): void {
    if (!mapClientsDropdownEl) return;
    const parentNoneBtn = mapClientsDropdownEl.querySelector<HTMLElement>(
      '[data-map-clients-parent="none"]'
    );
    const parentMappedBtn = mapClientsDropdownEl.querySelector<HTMLElement>(
      '[data-map-clients-parent="mapped"]'
    );
    const limitInput =
      mapClientsDropdownEl.querySelector<HTMLInputElement>(".map-clients-limit-input");

    setBubbleSelected(
      parentNoneBtn?.querySelector<HTMLElement>(".map-clients-bubble") ?? null,
      mapClientsParentMode === "none"
    );
    setBubbleSelected(
      parentMappedBtn?.querySelector<HTMLElement>(".map-clients-bubble") ?? null,
      mapClientsParentMode === "mapped"
    );
    parentNoneBtn?.setAttribute("aria-checked", String(mapClientsParentMode === "none"));
    parentMappedBtn?.setAttribute("aria-checked", String(mapClientsParentMode === "mapped"));

    if (limitInput) {
      limitInput.disabled = mapClientsParentMode !== "mapped";
      limitInput.value = String(mapClientsMappedLimit);
    }

    const subEnabled = mapClientsParentMode === "mapped";
    const subButtons = mapClientsDropdownEl.querySelectorAll<HTMLButtonElement>(
      "[data-map-clients-sub]"
    );
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
    attachMapClientsTooltips();
  }

  mapClientsWrapEl?.addEventListener("click", (e) => e.stopPropagation());
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

  document.addEventListener("click", () => closeMapClientsDropdown());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSearchResults();
      closeMapClientsDropdown();
    }
  });

  // --- Drawing mode: venue polygon (convex hull), no dimming ---
  let drawingMode = false;
  let points: [number, number][] = [];
  let selectedPointIndex: number | null = null;
  let confirmed = false; // after confirm, no more editing/selecting/dragging
  let pointsBeforeDrawing: [number, number][] = [];
  const pointMarkersLayer = L.layerGroup().addTo(map);
  let hullPolygon: L.Polygon | null = null;
  const editVenueBtn = document.getElementById(EDIT_VENUE_BTN_ID) as HTMLButtonElement;
  const toolbarEl = document.getElementById(TOOLBAR_ID);

  function setDrawingMode(active: boolean): void {
    drawingMode = active;
    toolbarEl?.classList.toggle("connected-devices-map-toolbar--drawing", active);
    if (active) {
      closeSearchResults();
      closeMapClientsDropdown();
    }
  }

  function setSelectedPoint(index: number | null): void {
    if (confirmed) return;
    selectedPointIndex = index;
    syncPointMarkerSelection();
  }

  function updateEditButtonLabel(): void {
    if (!editVenueBtn) return;
    const span = editVenueBtn.querySelector("span");
    if (!span) return;
    if (!drawingMode || confirmed) {
      span.textContent = "Edit Venue Shape";
      editVenueBtn.classList.remove("devices-toolbar-btn-danger");
      editVenueBtn.classList.remove(EDIT_BTN_CONFIRM_CLASS);
      return;
    }
    if (points.length < 3) {
      span.textContent = "Cancel Drawing Shape";
      editVenueBtn.classList.add("devices-toolbar-btn-danger");
      editVenueBtn.classList.remove(EDIT_BTN_CONFIRM_CLASS);
    } else {
      span.textContent = "Confirm Polygon Shape";
      editVenueBtn.classList.remove("devices-toolbar-btn-danger");
      editVenueBtn.classList.add(EDIT_BTN_CONFIRM_CLASS);
    }
  }

  function removeHullLayers(): void {
    if (hullPolygon) {
      map.removeLayer(hullPolygon);
      hullPolygon = null;
    }
    pointMarkersLayer.clearLayers();
  }

  function createPointMarker(
    latLng: L.LatLngExpression,
    isSelected: boolean,
    onDragEnd: (marker: L.Marker) => void,
    onClick: () => void,
    onDragStart: () => void
  ): L.Marker {
    const marker = L.marker(latLng, {
      draggable: !confirmed,
      icon: L.divIcon({
        className: "connected-devices-map-point-marker" + (isSelected ? " selected" : ""),
        html: "<span></span>",
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    });
    marker.on("dragend", () => onDragEnd(marker));
    marker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      onClick();
    });
    marker.on("dragstart", onDragStart);
    return marker;
  }

  function syncPointMarkerSelection(): void {
    pointMarkersLayer.eachLayer((layer) => {
      const marker = layer as L.Marker & { __pointIndex?: number };
      const el = marker.getElement?.();
      if (!el || marker.__pointIndex === undefined) return;
      el.classList.toggle("selected", marker.__pointIndex === selectedPointIndex);
    });
  }

  function indexOfClosestPoint(targetLat: number, targetLng: number): number {
    if (points.length === 0) return -1;
    let best = 0;
    let bestD = 1e30;
    for (let i = 0; i < points.length; i++) {
      const [lat, lng] = points[i];
      const d = (lat - targetLat) ** 2 + (lng - targetLng) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function syncHullAndLayers(selectNewLatLng?: { lat: number; lng: number }): void {
    if (points.length >= 3) {
      const hull = convexHull(points);
      points.length = 0;
      points.push(...hull);
    }

    if (selectNewLatLng) {
      const closest = indexOfClosestPoint(selectNewLatLng.lat, selectNewLatLng.lng);
      selectedPointIndex = closest >= 0 ? closest : null;
    }

    pointMarkersLayer.clearLayers();
    for (let i = 0; i < points.length; i++) {
      const idx = i;
      const pt = points[idx];
      const isSelected = idx === selectedPointIndex;
      const marker = createPointMarker(
        pt,
        isSelected,
        (m) => {
          const ll = m.getLatLng();
          points[idx] = [ll.lat, ll.lng];
          syncHullAndLayers();
        },
        () => setSelectedPoint(idx),
        () => setSelectedPoint(idx)
      );
      (marker as L.Marker & { __pointIndex?: number }).__pointIndex = idx;
      pointMarkersLayer.addLayer(marker);
    }

    if (hullPolygon) {
      map.removeLayer(hullPolygon);
      hullPolygon = null;
    }

    if (points.length >= 3) {
      const hullLatLngs = points.map((p) => L.latLng(p[0], p[1]));
      hullPolygon = L.polygon(hullLatLngs, {
        color: "#4a7dc7",
        fillColor: "#4a7dc7",
        fillOpacity: 0,
        weight: 2,
      }).addTo(map);
    }
    updateEditButtonLabel();
  }

  /** Update only the hull polygon from current points (no markers). Used after load. */
  function updateHullPolygonOnly(fitBounds = false): void {
    if (hullPolygon) {
      map.removeLayer(hullPolygon);
      hullPolygon = null;
    }
    if (points.length >= 3) {
      const hullLatLngs = points.map((p) => L.latLng(p[0], p[1]));
      hullPolygon = L.polygon(hullLatLngs, {
        color: "#4a7dc7",
        fillColor: "#4a7dc7",
        fillOpacity: 0,
        weight: 2,
      }).addTo(map);
      if (fitBounds) {
        const bounds = L.latLngBounds(points.map((p) => [p[0], p[1]] as L.LatLngTuple));
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    }
  }

  map.on("click", (e: L.LeafletMouseEvent) => {
    if (!drawingMode || confirmed) return;
    const { lat, lng } = e.latlng;
    points.push([lat, lng]);
    syncHullAndLayers({ lat, lng });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Delete" || !drawingMode || confirmed) return;
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    if (selectedPointIndex == null || selectedPointIndex < 0 || selectedPointIndex >= points.length) return;
    points.splice(selectedPointIndex, 1);
    setSelectedPoint(null);
    syncHullAndLayers();
  });

  editVenueBtn?.addEventListener("click", () => {
    if (!drawingMode) {
      pointsBeforeDrawing = clonePoints(points);
      setDrawingMode(true);
      confirmed = false;
      syncHullAndLayers();
      updateEditButtonLabel();
      return;
    }
    if (points.length < 3) {
      removeHullLayers();
      points = clonePoints(pointsBeforeDrawing);
      setSelectedPoint(null);
      setDrawingMode(false);
      updateHullPolygonOnly();
      updateEditButtonLabel();
      return;
    }
    confirmed = true;
    setDrawingMode(false);
    setSelectedPoint(null);
    pointMarkersLayer.clearLayers();
    updateEditButtonLabel();
    putVenueShapeOnConfirm();
  });

  function putVenueShapeOnConfirm(): void {
    if (!currentShowId) return;
    const payload = JSON.stringify({ points: clonePoints(points) });
    fetch(`/api/admin/show-workspaces/${currentShowId}/venue-shape`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: payload,
    })
      .then((res) => {
        if (!res.ok) {
          res.text().then((t) => alert(`Failed to save venue shape: ${res.status} ${t || res.statusText}`));
        }
      })
      .catch((e) => alert(`Failed to save venue shape: ${e instanceof Error ? e.message : String(e)}`));
  }

  async function loadVenueShapeFromServer(showId: string): Promise<void> {
    try {
      const res = await fetch(`/api/admin/show-workspaces/${showId}/venue-shape`, { credentials: "include" });
      if (res.status === 403) {
        window.location.pathname = "/venueMap";
        return;
      }
      if (res.status === 404) {
        points = [];
        updateHullPolygonOnly();
        syncMapClientsDropdown();
        return;
      }
      if (!res.ok) return;
      const raw = (await res.json()) as unknown;
      if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).points)) {
        return;
      }
      const arr = (raw as { points: unknown[] }).points;
      const next: [number, number][] = [];
      for (const p of arr) {
        if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "number" || typeof p[1] !== "number") continue;
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        next.push([p[0], p[1]]);
      }
      points = next;
      updateHullPolygonOnly(true);
    } finally {
      syncMapClientsDropdown();
    }
  }

  syncMapClientsDropdown();
  void loadVenueShapeFromServer(showId).then(() => {
    void syncMapStateFromServer();
  });
}
