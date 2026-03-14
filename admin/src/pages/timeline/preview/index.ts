/**
 * Preview panel: array-dimensions slider (5–25) + X×X grid of client squares when GPS is off;
 * when GPS is on, a map is shown in place of the grid.
 * Layout: portrait (taller than wide) → horizontal slider 20px tall at top, content below;
 *         landscape (wider than tall) → vertical slider 20px wide on left, content to the right.
 * When options are provided, a "Use GPS" toggle is shown: above the slider in portrait, left of the slider in landscape.
 */

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./styles.css";
import { initPreviewMapVenueFeatures } from "./venue-map-features";

export interface ShowLocationData {
  lat: number;
  lng: number;
  radiusMeters: number;
  requestsGPS: boolean;
}

export interface PreviewPanelOptions {
  onShowSyncing?: () => void;
  onShowSaved?: () => void;
  /** Called when show location is saved from the map (e.g. after confirming circle edit) so preview can keep its copy in sync. */
  onShowLocationUpdated?: (data: ShowLocationData) => void;
}

const MIN_DIM = 5;
const MAX_DIM = 25;
const DEFAULT_DIM = 10;

const PREVIEW_MAP_CONTAINER_ID = "timeline-preview-map";

const STORAGE_KEY_PREFIX = "lumelier-timeline:";
const STORAGE_KEY_SUFFIX = ":preview-array-dim";

function loadStoredDim(showId: string): number | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY_PREFIX + showId + STORAGE_KEY_SUFFIX);
    if (v == null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= MIN_DIM && n <= MAX_DIM ? n : null;
  } catch {
    return null;
  }
}

function saveDim(showId: string, dim: number): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + showId + STORAGE_KEY_SUFFIX, String(dim));
  } catch {
    /* ignore */
  }
}

export function renderPreviewPanel(
  container: HTMLElement,
  showId: string | null = null,
  options?: PreviewPanelOptions
): void {
  container.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "timeline-preview-widget";

  const sliderBar = document.createElement("div");
  sliderBar.className = "timeline-preview-slider-bar";

  const sliderRow = document.createElement("div");
  sliderRow.className = "timeline-preview-slider-row";
  let requestsGPS = false;
  let showLocation: ShowLocationData | null = null;
  const MIN_RADIUS_METERS = 10;
  const defaultShowLocation = (): ShowLocationData => ({
    lat: 0,
    lng: 0,
    radiusMeters: Math.max(MIN_RADIUS_METERS, 100),
    requestsGPS: false,
  });
  if (options) {
    const gpsWrap = document.createElement("div");
    gpsWrap.className = "timeline-preview-gps-wrap";
    const gpsLabel = document.createElement("span");
    gpsLabel.className = "timeline-preview-gps-label";
    gpsLabel.textContent = "Use GPS";
    const gpsToggle = document.createElement("button");
    gpsToggle.type = "button";
    gpsToggle.className = "mode-switch-toggle gps-toggle timeline-preview-gps-toggle";
    gpsToggle.setAttribute("aria-label", "Use GPS");
    gpsToggle.setAttribute("aria-pressed", "false");
    gpsToggle.innerHTML = `
      <span class="mode-switch-track">
        <span class="mode-switch-knob"></span>
      </span>
    `;
    gpsToggle.addEventListener("click", async () => {
      if (!showId || !options?.onShowSyncing || !options?.onShowSaved) return;
      const next = !requestsGPS;
      const payload = showLocation ?? defaultShowLocation();
      const lat = Number(payload.lat);
      const lng = Number(payload.lng);
      const radiusMeters = Math.max(
        MIN_RADIUS_METERS,
        Number.isFinite(payload.radiusMeters) ? payload.radiusMeters : 100
      );
      const body = {
        lat: Number.isFinite(lat) ? lat : 0,
        lng: Number.isFinite(lng) ? lng : 0,
        radiusMeters,
        requestsGPS: next,
      };
      options.onShowSyncing();
      try {
        const res = await fetch(`/api/admin/show-workspaces/${showId}/show-location`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        if (res.ok) {
          requestsGPS = next;
          showLocation = { ...payload, requestsGPS: next };
          gpsToggle.classList.toggle("gps-toggle--on", next);
          gpsToggle.setAttribute("aria-pressed", String(next));
          setGpsModeView(next);
          options.onShowSaved();
        }
      } catch {
        /* leave toggle state unchanged */
      }
    });
    gpsWrap.appendChild(gpsLabel);
    gpsWrap.appendChild(gpsToggle);
    sliderRow.appendChild(gpsWrap);
  }

  const sliderWrap = document.createElement("div");
  sliderWrap.className = "timeline-preview-slider-wrap";

  const storedDim = showId ? loadStoredDim(showId) : null;
  const initialDim = Math.min(MAX_DIM, storedDim ?? DEFAULT_DIM);

  const sliderInput = document.createElement("input");
  sliderInput.type = "range";
  sliderInput.min = String(MIN_DIM);
  sliderInput.max = String(MAX_DIM);
  sliderInput.step = "1";
  sliderInput.value = String(initialDim);
  sliderInput.className = "timeline-preview-array-slider";
  sliderInput.setAttribute("aria-label", "Array dimensions (grid size)");

  const gridArea = document.createElement("div");
  gridArea.className = "timeline-preview-grid-area";

  const gridContainer = document.createElement("div");
  gridContainer.className = "timeline-preview-grid-container";

  let mapArea: HTMLElement | null = null;
  let previewMap: L.Map | null = null;

  if (options) {
    mapArea = document.createElement("div");
    mapArea.className = "timeline-preview-map-area";
    const mapWrap = document.createElement("div");
    mapWrap.className = "timeline-preview-map-wrap";
    const mapContainer = document.createElement("div");
    mapContainer.id = PREVIEW_MAP_CONTAINER_ID;
    mapContainer.className = "timeline-preview-map-container";
    mapWrap.appendChild(mapContainer);
    const searchOverlay = document.createElement("div");
    searchOverlay.className = "timeline-preview-map-overlay-search";
    searchOverlay.setAttribute("aria-label", "Search place");
    const bottomLeftOverlay = document.createElement("div");
    bottomLeftOverlay.className = "timeline-preview-map-overlay-bottom-left";
    mapWrap.appendChild(searchOverlay);
    mapWrap.appendChild(bottomLeftOverlay);
    mapArea.appendChild(mapWrap);
  }

  sliderWrap.appendChild(sliderInput);
  sliderBar.appendChild(sliderWrap);
  sliderRow.appendChild(sliderBar);
  gridArea.appendChild(gridContainer);
  wrapper.appendChild(sliderRow);
  wrapper.appendChild(gridArea);
  if (mapArea) wrapper.appendChild(mapArea);
  container.appendChild(wrapper);

  let venueFeaturesInitialized = false;

  function initPreviewMap(): void {
    const mapEl = container.querySelector(`#${PREVIEW_MAP_CONTAINER_ID}`) as HTMLElement | null;
    if (!mapEl || previewMap) return;
    previewMap = L.map(mapEl).setView([20, 0], 2);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(previewMap);
    requestAnimationFrame(() => {
      try {
        if (previewMap?.getContainer().isConnected) {
          previewMap.invalidateSize();
        }
      } catch {
        /* map container may be detached */
      }
      const mapWrap = container.querySelector(".timeline-preview-map-wrap") as HTMLElement | null;
      if (previewMap && mapWrap && !venueFeaturesInitialized) {
        venueFeaturesInitialized = true;
        initPreviewMapVenueFeatures(previewMap, mapWrap, showId, {
          onShowSyncing: options?.onShowSyncing,
          onShowSaved: options?.onShowSaved,
          onShowLocationUpdated: (data) => {
            showLocation = data;
            options?.onShowLocationUpdated?.(data);
          },
        });
      }
    });
  }

  function setGpsModeView(gpsOn: boolean): void {
    if (!mapArea) return;
    if (gpsOn) {
      gridArea.style.display = "none";
      mapArea.style.display = "";
      initPreviewMap();
      requestAnimationFrame(() => {
        try {
          if (previewMap?.getContainer().isConnected) {
            previewMap.invalidateSize();
          }
        } catch {
          /* map container may be detached */
        }
      });
    } else {
      gridArea.style.display = "";
      mapArea.style.display = "none";
    }
  }

  if (options && showId) {
    const gpsToggleBtn = wrapper.querySelector(".timeline-preview-gps-toggle") as HTMLButtonElement | null;
    (async () => {
      try {
        const res = await fetch(`/api/admin/show-workspaces/${showId}/show-location`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = (await res.json()) as ShowLocationData;
          if (
            typeof data.lat === "number" &&
            typeof data.lng === "number" &&
            typeof data.radiusMeters === "number" &&
            typeof data.requestsGPS === "boolean"
          ) {
            showLocation = data;
            requestsGPS = data.requestsGPS;
            setGpsModeView(requestsGPS);
            if (gpsToggleBtn) {
              gpsToggleBtn.classList.toggle("gps-toggle--on", requestsGPS);
              gpsToggleBtn.setAttribute("aria-pressed", String(requestsGPS));
            }
          }
        }
      } catch {
        /* keep defaults */
      }
    })();
  }

  let dimension = initialDim;

  function renderGrid(): void {
    const side = dimension;
    gridContainer.style.gridTemplateColumns = `repeat(${side}, 1fr)`;
    gridContainer.style.gridTemplateRows = `repeat(${side}, 1fr)`;
    gridContainer.innerHTML = "";
    const total = side * side;
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("div");
      cell.className = "timeline-preview-grid-cell";
      cell.setAttribute("aria-hidden", "true");
      gridContainer.appendChild(cell);
    }
  }

  function onSliderInput(): void {
    const val = sliderInput.value;
    const n = Math.round(parseFloat(val));
    if (Number.isFinite(n) && n >= MIN_DIM && n <= MAX_DIM) {
      dimension = n;
      renderGrid();
      if (showId) saveDim(showId, n);
    }
  }

  sliderInput.addEventListener("input", onSliderInput);
  renderGrid();

  function updateLayout(): void {
    const w = container.offsetWidth;
    const h = container.offsetHeight;
    const isPortrait = h > w;
    wrapper.classList.toggle("timeline-preview-widget--portrait", isPortrait);
    wrapper.classList.toggle("timeline-preview-widget--landscape", !isPortrait);
  }

  const ro = new ResizeObserver(updateLayout);
  ro.observe(container);
  updateLayout();
}
