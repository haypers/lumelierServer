import type { TimelineStateJSON } from "./types";

const AUTOSAVE_DEBOUNCE_MS = 1000;
const MIN_SYNCING_DISPLAY_MS = 400;

let autosaveTimerId: ReturnType<typeof setTimeout> | null = null;

export interface AutosaveDeps {
  getExportState: () => TimelineStateJSON;
  getCurrentShowId: () => string | null;
  getHasLoadedShow: () => boolean;
  getAutosaveEl: () => HTMLElement | null;
  getIcons: () => { circleCheck: string; loading: string };
}

let deps: AutosaveDeps | null = null;

export function initAutosave(d: AutosaveDeps): void {
  deps = d;
}

export function setAutosaveUI(state: "saved" | "syncing"): void {
  if (!deps) return;
  const el = deps.getAutosaveEl();
  if (!el) return;
  const icons = deps.getIcons();
  if (state === "saved") {
    el.innerHTML = `<span class="editor-autosave-icon">${icons.circleCheck}</span><span>Saved</span>`;
    el.classList.remove("editor-autosave--syncing");
  } else {
    if (el.classList.contains("editor-autosave--syncing")) return;
    el.innerHTML = `<span class="editor-autosave-icon editor-autosave-icon--spin">${icons.loading}</span><span>Syncing</span>`;
    el.classList.add("editor-autosave--syncing");
  }
}

export function scheduleAutosave(): void {
  if (!deps) return;
  setAutosaveUI("syncing");
  if (autosaveTimerId != null) {
    clearTimeout(autosaveTimerId);
    autosaveTimerId = null;
  }
  autosaveTimerId = setTimeout(() => {
    autosaveTimerId = null;
    runAutosave();
  }, AUTOSAVE_DEBOUNCE_MS);
}

async function runAutosave(): Promise<void> {
  if (!deps) return;
  const showId = deps.getCurrentShowId();
  if (!showId || !deps.getHasLoadedShow()) return;
  const syncingStartedAt = Date.now();
  setAutosaveUI("syncing");
  try {
    await fetch(`/api/admin/show-workspaces/${showId}/timeline`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(deps.getExportState()),
    });
    const elapsed = Date.now() - syncingStartedAt;
    const minDisplayRemaining = Math.max(0, MIN_SYNCING_DISPLAY_MS - elapsed);
    if (minDisplayRemaining > 0) {
      await new Promise((r) => setTimeout(r, minDisplayRemaining));
    }
    setAutosaveUI("saved");
  } catch {
    const elapsed = Date.now() - syncingStartedAt;
    const minDisplayRemaining = Math.max(0, MIN_SYNCING_DISPLAY_MS - elapsed);
    if (minDisplayRemaining > 0) {
      await new Promise((r) => setTimeout(r, minDisplayRemaining));
    }
    setAutosaveUI("saved");
  }
}
