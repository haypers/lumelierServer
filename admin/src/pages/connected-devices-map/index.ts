import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./styles.css";

const MAP_CONTAINER_ID = "connected-devices-map";
const SEARCH_INPUT_ID = "connected-devices-map-search-input";
const NOMINATIM_USER_AGENT = "Lumelier Light Show Planner";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export function render(container: HTMLElement): void {
  container.innerHTML = `
    <div class="connected-devices-map-wrap">
      <div class="connected-devices-map-search">
        <input type="text" id="${SEARCH_INPUT_ID}" placeholder="Search for a place…" aria-label="Search place" />
        <button type="button" id="connected-devices-map-search-btn">Search</button>
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

  async function search(): Promise<void> {
    const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement;
    const btn = document.getElementById("connected-devices-map-search-btn") as HTMLButtonElement;
    const q = input?.value?.trim();
    if (!q) return;

    btn.disabled = true;
    try {
      const params = new URLSearchParams({ q, format: "json", limit: "1" });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { "User-Agent": NOMINATIM_USER_AGENT },
      });
      if (!res.ok) throw new Error("Search failed");
      const data = (await res.json()) as NominatimResult[];
      if (!data.length) {
        return;
      }
      const { lat, lon } = data[0];
      const latNum = Number(lat);
      const lonNum = Number(lon);
      map.flyTo([latNum, lonNum], 14, { duration: 0.5 });
    } finally {
      btn.disabled = false;
    }
  }

  document.getElementById("connected-devices-map-search-btn")?.addEventListener("click", search);
  document.getElementById(SEARCH_INPUT_ID)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });
}
