import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./styles.css";
import { convexHull } from "./convex-hull";
import searchIcon from "../../icons/search.svg?raw";
import animatedLoadingIcon from "../../icons/animatedLoadingIcon.svg?raw";
import openIcon from "../../icons/open.svg?raw";
import saveIcon from "../../icons/save.svg?raw";
import mapIcon from "../../icons/map.svg?raw";

const MAP_CONTAINER_ID = "connected-devices-map";
const SEARCH_INPUT_ID = "connected-devices-map-search-input";
const SEARCH_BTN_ID = "connected-devices-map-search-btn";
const TOOLBAR_ID = "connected-devices-map-toolbar";
const EDIT_VENUE_BTN_ID = "connected-devices-map-edit-venue-btn";
const LOAD_VENUE_DROPDOWN_ID = "connected-devices-map-load-dropdown";
const NOMINATIM_USER_AGENT = "Lumelier Light Show Planner";
const SEARCH_TIMEOUT_MS = 12_000;

/** Sanitize venue name to a safe filename (only [a-zA-Z0-9._-]); append .json. */
function venueNameToFilename(name: string): string {
  const t = name
    .trim()
    .replace(/[/\\]/g, "")
    .replace(/[^a-zA-Z0-9._\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .trim();
  const base = t || "Untitled_Venue";
  return `${base}.json`;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export function render(container: HTMLElement): void {
  container.innerHTML = `
    <div class="connected-devices-map-wrap">
      <div class="connected-devices-map-toolbar" id="${TOOLBAR_ID}">
        <div class="connected-devices-map-search-group">
          <input type="text" id="${SEARCH_INPUT_ID}" placeholder="Search for a place…" aria-label="Search place" />
          <button type="button" class="connected-devices-map-search-btn" id="${SEARCH_BTN_ID}" aria-label="Search">${searchIcon}</button>
        </div>
        <div class="connected-devices-map-load-wrap" id="${LOAD_VENUE_DROPDOWN_ID}">
          <button type="button" class="devices-toolbar-btn" id="connected-devices-map-load-btn" aria-expanded="false" aria-haspopup="true">${openIcon}<span>Load Venue</span></button>
          <div class="connected-devices-map-load-dropdown" id="connected-devices-map-load-dropdown-list" hidden role="menu"></div>
        </div>
        <button type="button" class="devices-toolbar-btn" id="connected-devices-map-save-btn">${saveIcon}<span>Save Venue</span></button>
        <button type="button" class="devices-toolbar-btn" id="${EDIT_VENUE_BTN_ID}">${mapIcon}<span>Edit Venue Shape</span></button>
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

  const searchBtnEl = document.getElementById(SEARCH_BTN_ID) as HTMLButtonElement;

  function setSearchButtonIcon(loading: boolean): void {
    if (!searchBtnEl) return;
    searchBtnEl.innerHTML = loading ? animatedLoadingIcon : searchIcon;
  }

  async function search(): Promise<void> {
    const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement;
    const q = input?.value?.trim();
    if (!q) return;

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
      const params = new URLSearchParams({ q, format: "json", limit: "1" });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { "User-Agent": NOMINATIM_USER_AGENT },
      });
      restoreIcon();
      if (!res.ok) throw new Error("Search failed");
      const data = (await res.json()) as NominatimResult[];
      if (!data.length) return;
      const { lat, lon } = data[0];
      const latNum = Number(lat);
      const lonNum = Number(lon);
      map.invalidateSize();
      map.flyTo([latNum, lonNum], 14, { duration: 0.5 });
    } catch {
      restoreIcon();
    }
  }

  searchBtnEl?.addEventListener("click", () => search());
  document.getElementById(SEARCH_INPUT_ID)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });

  // --- Drawing mode: venue polygon (convex hull), no dimming ---
  let drawingMode = false;
  let points: [number, number][] = [];
  let selectedPointIndex: number | null = null;
  let confirmed = false; // after confirm, no more editing/selecting/dragging
  const pointMarkersLayer = L.layerGroup().addTo(map);
  let hullPolygon: L.Polygon | null = null;
  const editVenueBtn = document.getElementById(EDIT_VENUE_BTN_ID) as HTMLButtonElement;
  const toolbarEl = document.getElementById(TOOLBAR_ID);
  const loadBtn = document.getElementById("connected-devices-map-load-btn") as HTMLButtonElement;
  const saveBtn = document.getElementById("connected-devices-map-save-btn") as HTMLButtonElement;
  const loadDropdownList = document.getElementById("connected-devices-map-load-dropdown-list");

  function updateSaveLoadDisabled(): void {
    if (saveBtn) saveBtn.disabled = drawingMode || points.length < 3;
    if (loadBtn) loadBtn.disabled = drawingMode;
  }

  function setDrawingMode(active: boolean): void {
    drawingMode = active;
    toolbarEl?.classList.toggle("connected-devices-map-toolbar--drawing", active);
    updateSaveLoadDisabled();
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
      return;
    }
    if (points.length < 3) span.textContent = "Cancel Drawing Shape";
    else span.textContent = "Confirm Polygon Shape";
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
    updateSaveLoadDisabled();
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
    updateSaveLoadDisabled();
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
      setDrawingMode(true);
      confirmed = false;
      syncHullAndLayers();
      updateEditButtonLabel();
      return;
    }
    if (points.length < 3) {
      removeHullLayers();
      points.length = 0;
      setSelectedPoint(null);
      setDrawingMode(false);
      updateEditButtonLabel();
      return;
    }
    confirmed = true;
    setDrawingMode(false);
    setSelectedPoint(null);
    pointMarkersLayer.clearLayers();
    updateEditButtonLabel();
    updateSaveLoadDisabled();
  });

  function showOverwriteConfirmModal(onConfirm: () => void): void {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <p>A venue with this name already exists. Overwrite?</p>
        <div class="modal-actions">
          <button type="button" class="btn-cancel">Cancel</button>
          <button type="button" class="btn-confirm">Overwrite</button>
        </div>
      </div>`;
    const close = () => overlay.remove();
    overlay.querySelector(".btn-cancel")?.addEventListener("click", close);
    overlay.querySelector(".btn-confirm")?.addEventListener("click", () => {
      onConfirm();
      close();
    });
    document.body.appendChild(overlay);
  }

  function showSaveVenueModal(): void {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <p><label for="venue-save-name">Venue name</label></p>
        <input type="text" id="venue-save-name" class="modal-input" placeholder="My Venue" aria-label="Venue name" />
        <div class="modal-actions">
          <button type="button" class="btn-cancel">Cancel</button>
          <button type="button" class="btn-confirm">Save</button>
        </div>
      </div>`;
    const input = overlay.querySelector("#venue-save-name") as HTMLInputElement;
    const close = () => overlay.remove();

    overlay.querySelector(".btn-cancel")?.addEventListener("click", close);
    overlay.querySelector(".btn-confirm")?.addEventListener("click", async () => {
      const name = input?.value?.trim() ?? "";
      const filename = venueNameToFilename(name);
      let list: string[] = [];
      try {
        const res = await fetch("/api/admin/venues");
        if (res.ok) list = (await res.json()) as string[];
      } catch {
        // ignore
      }
      const exists = list.includes(filename);
      const doPut = async () => {
        try {
          const res = await fetch(`/api/admin/venues/${encodeURIComponent(filename)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ points }),
          });
          if (res.ok) {
            close();
            alert("Venue saved successfully.");
          } else {
            const text = await res.text();
            alert(`Save failed: ${res.status} ${text || res.statusText}`);
          }
        } catch (e) {
          alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      if (exists) {
        close();
        showOverwriteConfirmModal(doPut);
      } else {
        await doPut();
      }
    });
    document.body.appendChild(overlay);
    input?.focus();
  }

  saveBtn?.addEventListener("click", () => {
    if (drawingMode || points.length < 3) return;
    showSaveVenueModal();
  });

  function closeLoadDropdown(): void {
    if (loadDropdownList) loadDropdownList.hidden = true;
    loadBtn?.setAttribute("aria-expanded", "false");
  }

  loadBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (drawingMode) return;
    const isOpen = !loadDropdownList?.hidden;
    if (isOpen) {
      closeLoadDropdown();
      return;
    }
    fetch("/api/admin/venues")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((files: string[]) => {
        if (!loadDropdownList) return;
        const filtered = (files as string[]).filter((f: string) => f.endsWith(".json"));
        if (filtered.length === 0) {
          loadDropdownList.innerHTML = '<div class="connected-devices-map-load-dropdown-empty">No saved venues</div>';
        } else {
          loadDropdownList.innerHTML = filtered
            .map(
              (f) =>
                `<button type="button" class="connected-devices-map-load-dropdown-item" data-filename="${f.replace(/"/g, "&quot;")}">${f.replace(/</g, "&lt;")}</button>`
            )
            .join("");
          loadDropdownList.querySelectorAll(".connected-devices-map-load-dropdown-item").forEach((btn) => {
            btn.addEventListener("click", async (ev) => {
              const name = (ev.currentTarget as HTMLElement).dataset.filename;
              if (!name) return;
              closeLoadDropdown();
              try {
                const res = await fetch(`/api/admin/venues/${encodeURIComponent(name)}`);
                if (!res.ok) throw new Error(String(res.status));
                const data = (await res.json()) as { points?: unknown };
                if (!Array.isArray(data.points) || data.points.length < 3) {
                  alert("Invalid venue JSON.");
                  return;
                }
                const pts = data.points as unknown[];
                const valid = pts.every(
                  (p): p is [number, number] =>
                    Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number"
                );
                if (!valid) {
                  alert("Invalid venue JSON.");
                  return;
                }
                points = pts as [number, number][];
                selectedPointIndex = null;
                confirmed = false;
                pointMarkersLayer.clearLayers();
                updateHullPolygonOnly(true);
              } catch (e) {
                alert(`Failed to load venue: ${e instanceof Error ? e.message : String(e)}`);
              }
            });
          });
        }
        loadDropdownList.hidden = false;
        loadBtn?.setAttribute("aria-expanded", "true");
      })
      .catch((e) => {
        alert(`Failed to list venues: ${e instanceof Error ? e.message : String(e)}`);
      });
  });

  document.addEventListener("click", () => closeLoadDropdown());
  loadDropdownList?.addEventListener("click", (e) => e.stopPropagation());

  updateSaveLoadDisabled();
}
