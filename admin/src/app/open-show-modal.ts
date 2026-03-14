/**
 * Open Show modal: fetch list of shows, render tiles, call onShowSelected when user opens one.
 */

import { openModal } from "../components/modal";
import { HEADER_SELECTORS } from "./header-selectors";

export type ShowListItem = {
  show_id: string;
  name: string;
  created_by: string;
  created_at_ms: number;
  last_modified_ms: number;
};

export function formatShowDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export function openOpenShowModal(onShowSelected: (show: { id: string; name: string }) => void): void {
  const content = document.createElement("div");
  content.className = "open-show-modal-content";
  content.innerHTML = `
    <div class="open-show-modal-grid" id="${HEADER_SELECTORS.openShowGrid}"></div>
    <div id="${HEADER_SELECTORS.openShowError}" class="open-show-modal-error" hidden></div>`;
  const grid = content.querySelector(`#${HEADER_SELECTORS.openShowGrid}`) as HTMLElement;
  const errorEl = content.querySelector(`#${HEADER_SELECTORS.openShowError}`) as HTMLElement;

  let shows: ShowListItem[] = [];
  let selectedShowId: string | null = null;

  const DOUBLE_CLICK_MS = 500;
  let lastRowClickTime = 0;
  let lastRowClickShowId: string | null = null;

  function openSelectedShow(): void {
    if (!selectedShowId) return;
    const show = shows.find((s) => s.show_id === selectedShowId);
    if (!show) return;
    close();
    onShowSelected({ id: show.show_id, name: show.name });
  }

  const { close } = openModal({
    size: "medium",
    clickOutsideToClose: true,
    title: "Select a Show to load:",
    content,
    cancel: {},
    actions: [
      {
        preset: "primary",
        label: "Open",
        onClick: openSelectedShow,
      },
    ],
  });

  const openBtn = content.closest(HEADER_SELECTORS.globalModalPanel)?.querySelector(HEADER_SELECTORS.globalModalFooterRightButton) as HTMLButtonElement | null;
  if (openBtn) openBtn.disabled = true;

  function renderTiles(): void {
    grid.innerHTML = "";
    const header = document.createElement("div");
    header.className = "open-show-modal-list-header";
    header.setAttribute("role", "presentation");
    header.innerHTML = `<span>Name</span><span>Created By</span><span>Created</span><span>Modified</span>`;
    grid.appendChild(header);

    for (const show of shows) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "open-show-tile" + (selectedShowId === show.show_id ? " open-show-tile--selected" : "");
      tile.dataset.showId = show.show_id;
      tile.innerHTML = `
        <span class="open-show-tile-cell-name">${escapeHtml(show.name)}</span>
        <span class="open-show-tile-cell-muted">${escapeHtml(show.created_by)}</span>
        <span class="open-show-tile-cell-muted">${formatShowDate(show.created_at_ms)}</span>
        <span class="open-show-tile-cell-muted">${formatShowDate(show.last_modified_ms)}</span>`;
      tile.addEventListener("click", () => {
        const now = Date.now();
        const isDoubleClick = show.show_id === lastRowClickShowId && now - lastRowClickTime < DOUBLE_CLICK_MS;
        lastRowClickShowId = show.show_id;
        lastRowClickTime = now;

        selectedShowId = show.show_id;
        grid.querySelectorAll(HEADER_SELECTORS.openShowTile).forEach((t) => t.classList.remove("open-show-tile--selected"));
        tile.classList.add("open-show-tile--selected");
        const btn = content.closest(HEADER_SELECTORS.globalModalPanel)?.querySelector(HEADER_SELECTORS.globalModalFooterRightButton) as HTMLButtonElement | null;
        if (btn) btn.disabled = false;

        if (isDoubleClick) {
          openSelectedShow();
        }
      });
      grid.appendChild(tile);
    }
  }

  (async () => {
    try {
      const res = await fetch("/api/admin/show-workspaces", { credentials: "include" });
      if (!res.ok) {
        errorEl.textContent = "Failed to load shows.";
        errorEl.hidden = false;
        return;
      }
      shows = (await res.json()) as ShowListItem[];
      if (shows.length === 0) {
        grid.innerHTML = '<p class="open-show-modal-empty">No shows yet. Create one with the New Show button.</p>';
        return;
      }
      renderTiles();
    } catch {
      errorEl.textContent = "Network error.";
      errorEl.hidden = false;
    }
  })();
}
