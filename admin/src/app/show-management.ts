import menuIcon from "../icons/menu.svg?raw";
import userIcon from "../icons/user.svg?raw";
import newtabIcon from "../icons/newtab.svg?raw";
import openIcon from "../icons/open.svg?raw";
import newIcon from "../icons/new.svg?raw";
import carrotIcon from "../icons/carrot.svg?raw";
import closeIcon from "../icons/close.svg?raw";
import shareIcon from "../icons/share.svg?raw";
import trashIcon from "../icons/trash.svg?raw";
import { type RoutePath, getVisibleRoutes } from "./routing";
import { type TemplateType, getTemplateState } from "../pages/timeline";
import { createInfoBubble } from "../components/info-bubble";
import { openModal } from "../components/modal";
import { HEADER_SELECTORS } from "./header-selectors";
import {
  initLiveState,
  setSyncShowStatusUIRef,
  refreshLiveStateUI,
  fetchLiveStateFromServer,
  clearLiveStatePollTimer,
  scheduleNextLiveStatePoll,
  broadcastLiveState,
  dispatchLiveStateEvent,
  LIVE_STATE_INITIAL_POLL_MS,
} from "./live-state";
import { openOpenShowModal as openOpenShowModalFromModule, type ShowListItem } from "./open-show-modal";

export type ShowCallbacks = {
  navigateToPathWithShow: (path: RoutePath, show: { id: string } | null) => void;
  renderApp: (username: string) => void;
  getPath: () => RoutePath;
};

let callbacks: ShowCallbacks | null = null;

export function initShowManagement(cb: ShowCallbacks): void {
  callbacks = cb;
  initLiveState({ getCurrentShow, setShowLiveState });
}

function getCb(): ShowCallbacks {
  if (!callbacks) throw new Error("show-management: initShowManagement must be called first");
  return callbacks;
}

let currentShow: { id: string; name: string } | null = null;
let lastUsername = "";

export function getCurrentShow(): { id: string; name: string } | null {
  return currentShow;
}

export function setCurrentShow(show: { id: string; name: string } | null): void {
  currentShow = show;
}

type ShowLiveState = "not_live" | "requesting" | "live";
let showLiveState: ShowLiveState = "not_live";

export function getShowLiveState(): ShowLiveState {
  return showLiveState;
}

export function setShowLiveState(s: ShowLiveState): void {
  showLiveState = s;
}

export {
  fetchLiveStateFromServer,
  clearLiveStatePollTimer,
  scheduleNextLiveStatePoll,
  setupLiveStateBroadcastListener,
} from "./live-state";

function renderSelectedShowBlock(): string {
  if (currentShow) {
    const name = currentShow.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const statusLabel = showLiveState === "not_live" ? "Not Live" : showLiveState === "requesting" ? "Requesting Server" : "Live";
    const statusClass = showLiveState === "not_live" ? "admin-header-status-wrap--not-live" : showLiveState === "requesting" ? "admin-header-status-wrap--requesting" : "admin-header-status-wrap--live";
    const statusHasDropdown = showLiveState === "not_live" || showLiveState === "live";
    return `
      <div class="admin-header-show-name-wrap">
        <button type="button" class="admin-header-show-name-btn" id="show-name-dropdown-btn" aria-haspopup="true" aria-expanded="false" aria-controls="${HEADER_SELECTORS.showNameDropdown}">
          <span class="admin-header-selected-show-name">${name}</span>
          <span class="admin-header-show-name-caret" aria-hidden="true">${carrotIcon}</span>
        </button>
        <div class="admin-header-show-name-dropdown" id="${HEADER_SELECTORS.showNameDropdown}" hidden role="menu" aria-label="Show actions">
          <button type="button" class="admin-header-show-name-menu-item" data-action="close-show" role="menuitem"><span class="admin-header-show-name-menu-icon">${closeIcon}</span>Close This Show</button>
          <button type="button" class="admin-header-show-name-menu-item" data-action="open-another" role="menuitem"><span class="admin-header-show-name-menu-icon">${openIcon}</span>Open Another Show</button>
          <button type="button" class="admin-header-show-name-menu-item" data-action="add-admin" role="menuitem"><span class="admin-header-show-name-menu-icon">${shareIcon}</span>Add Another Admin To This Show</button>
          <button type="button" class="admin-header-show-name-menu-item admin-header-show-name-menu-item--danger" data-action="delete-show" role="menuitem"><span class="admin-header-show-name-menu-icon">${trashIcon}</span>Delete This Show</button>
        </div>
      </div>
      <div class="admin-header-status-wrap-container">
        <button type="button" class="admin-header-status-wrap ${statusClass}" id="show-status-btn" aria-haspopup="true" aria-expanded="false" aria-controls="${HEADER_SELECTORS.showStatusDropdown}" ${!statusHasDropdown ? "disabled" : ""}>
          <span class="admin-header-status-tag">${statusLabel}</span>
          ${statusHasDropdown ? `<span class="admin-header-status-caret" aria-hidden="true">${carrotIcon}</span>` : ""}
        </button>
        <div class="admin-header-status-dropdown" id="${HEADER_SELECTORS.showStatusDropdown}" hidden role="menu" aria-label="Live status"></div>
      </div>`;
  }
  return `
    <div class="admin-header-selected-show-empty" id="selected-show-empty">
      <div class="admin-header-selected-show-empty-actions">
        <button type="button" class="admin-header-selected-show-btn admin-header-selected-show-btn--open" id="open-saved-show-btn"><span class="admin-header-selected-show-btn-icon">${openIcon}</span>Open Saved Show</button>
        <button type="button" class="admin-header-selected-show-btn admin-header-selected-show-btn--new" id="new-show-btn"><span class="admin-header-selected-show-btn-icon">${newIcon}</span>Create New Show</button>
        <div class="admin-header-default-shows-wrap">
          <button type="button" class="admin-header-selected-show-btn admin-header-selected-show-btn--default" id="default-shows-btn" aria-expanded="false" aria-haspopup="true" aria-controls="default-shows-dropdown">Create From Show Template<span class="admin-header-default-shows-caret" aria-hidden="true">${carrotIcon}</span></button>
          <div class="admin-header-default-shows-dropdown" id="default-shows-dropdown" hidden role="menu" aria-label="Show templates"></div>
        </div>
      </div>
    </div>`;
}

export function renderHeader(container: HTMLElement, currentPath: RoutePath, username: string): void {
  lastUsername = username;
  const visibleRoutes = getVisibleRoutes();
  const current = visibleRoutes.find((r) => r.path === currentPath) ?? visibleRoutes[0];
  document.title = current.title;
  const escapedUsername = username.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  container.innerHTML = `
    <header class="admin-header">
      <button type="button" class="menu-btn" id="${HEADER_SELECTORS.menuBtn}" aria-expanded="false" aria-haspopup="true" aria-controls="${HEADER_SELECTORS.menuDropdown}">${menuIcon}</button>
      <span class="page-title">${current.title}</span>${currentPath === "/simulateDevices" ? `<span id="${HEADER_SELECTORS.pageHeaderExtra}"></span>` : ""}
      <div class="admin-header-spacer"></div>
      <div class="admin-header-selected-show" id="selected-show-wrap">
        ${renderSelectedShowBlock()}
      </div>
      <div class="admin-header-spacer"></div>
      <div class="admin-header-account-wrap">
        <span class="admin-header-branding">Lumelier</span>
        <button type="button" class="admin-header-account-btn" id="${HEADER_SELECTORS.accountBtn}" aria-expanded="false" aria-haspopup="true" aria-controls="${HEADER_SELECTORS.accountDropdown}"><span class="admin-header-account-icon">${userIcon}</span></button>
        <div id="${HEADER_SELECTORS.accountDropdown}" class="admin-header-account-dropdown" hidden role="menu" aria-label="Account">
          <div class="admin-header-account-username" role="none">${escapedUsername}</div>
          <button type="button" id="${HEADER_SELECTORS.accountLogoutBtn}" class="admin-header-account-logout" role="menuitem">Log out</button>
        </div>
      </div>
      <div id="${HEADER_SELECTORS.menuDropdown}" class="menu-dropdown" hidden role="menu">
        ${visibleRoutes.map((r) => {
          const fullPath = currentShow ? `${r.path}/${currentShow.id}` : r.path;
          return `<div class="menu-dropdown-item" role="menuitem" data-path="${r.path}" data-full-path="${fullPath}">
              <a href="${fullPath}" class="menu-dropdown-item-link ${r.path === currentPath ? "current" : ""}"><span class="icon-wrap">${r.icon}</span>${r.title}</a>
              <button type="button" class="menu-dropdown-newtab-btn" aria-label="Open in new tab">${newtabIcon}</button>
            </div>`;
        }).join("")}
      </div>
    </header>
    <main class="admin-content" id="admin-content"></main>
  `;

  const menuBtn = document.getElementById(HEADER_SELECTORS.menuBtn);
  const dropdown = document.getElementById(HEADER_SELECTORS.menuDropdown);
  if (menuBtn && dropdown) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = dropdown.hidden;
      dropdown.hidden = !open;
      menuBtn.setAttribute("aria-expanded", String(!open));
      const ad = document.getElementById(HEADER_SELECTORS.accountDropdown) as HTMLElement | null;
      if (!open && ad) ad.hidden = true;
    });
    dropdown.addEventListener("click", (e) => e.stopPropagation());
    if (!(window as unknown as { _adminMenuClosed?: boolean })._adminMenuClosed) {
      (window as unknown as { _adminMenuClosed: boolean })._adminMenuClosed = true;
      document.addEventListener("click", () => {
        const d = document.getElementById(HEADER_SELECTORS.menuDropdown);
        const b = document.getElementById(HEADER_SELECTORS.menuBtn);
        if (d) d.hidden = true;
        if (b) b.setAttribute("aria-expanded", "false");
        const ad = document.getElementById(HEADER_SELECTORS.accountDropdown);
        const ab = document.getElementById(HEADER_SELECTORS.accountBtn);
        if (ad) ad.hidden = true;
        if (ab) ab.setAttribute("aria-expanded", "false");
        const showNameD = document.getElementById(HEADER_SELECTORS.showNameDropdown);
        const showNameB = document.getElementById(HEADER_SELECTORS.showNameDropdownBtn);
        if (showNameD) showNameD.hidden = true;
        if (showNameB) showNameB.setAttribute("aria-expanded", "false");
        const statusD = document.getElementById(HEADER_SELECTORS.showStatusDropdown);
        const statusB = document.getElementById(HEADER_SELECTORS.showStatusBtn);
        if (statusD) statusD.hidden = true;
        if (statusB) statusB.setAttribute("aria-expanded", "false");
        const defaultShowsD = document.getElementById(HEADER_SELECTORS.defaultShowsDropdown);
        const defaultShowsB = document.getElementById(HEADER_SELECTORS.defaultShowsBtn);
        if (defaultShowsD) defaultShowsD.hidden = true;
        if (defaultShowsB) defaultShowsB.setAttribute("aria-expanded", "false");
      });
    }
  }

  const accountBtn = document.getElementById(HEADER_SELECTORS.accountBtn);
  const accountDropdown = document.getElementById(HEADER_SELECTORS.accountDropdown);
  if (accountBtn && accountDropdown) {
    accountBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = accountDropdown.hidden;
      accountDropdown.hidden = !open;
      accountBtn.setAttribute("aria-expanded", String(!open));
      if (!open && dropdown) dropdown.hidden = true;
    });
    accountDropdown.addEventListener("click", (e) => e.stopPropagation());
  }

  document.getElementById(HEADER_SELECTORS.accountLogoutBtn)?.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  });

  dropdown?.querySelectorAll(HEADER_SELECTORS.menuDropdownItemLink).forEach((link) => {
    link.addEventListener("click", () => {
      dropdown!.hidden = true;
      menuBtn?.setAttribute("aria-expanded", "false");
    });
  });
  dropdown?.querySelectorAll(HEADER_SELECTORS.menuDropdownNewtabBtn).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = (e.currentTarget as HTMLElement).closest(HEADER_SELECTORS.menuDropdownItem);
      const fullPath = item?.getAttribute("data-full-path");
      if (fullPath) {
        const url = new URL(fullPath, window.location.origin).href;
        window.open(url, "_blank", "noopener,noreferrer");
      }
      dropdown!.hidden = true;
      menuBtn?.setAttribute("aria-expanded", "false");
    });
  });

  const newShowBtn = document.getElementById(HEADER_SELECTORS.newShowBtn);
  if (newShowBtn) {
    newShowBtn.addEventListener("click", () => openNewShowModal());
  }
  const openShowBtn = document.getElementById(HEADER_SELECTORS.openSavedShowBtn);
  if (openShowBtn) {
    openShowBtn.addEventListener("click", () => openOpenShowModal());
  }

  const defaultShowsBtn = document.getElementById(HEADER_SELECTORS.defaultShowsBtn);
  const defaultShowsDropdown = document.getElementById(HEADER_SELECTORS.defaultShowsDropdown);
  if (defaultShowsBtn && defaultShowsDropdown) {
    const templates: Array<{ type: TemplateType; label: string }> = [
      { type: "rainbow", label: "Rainbow Cycle" },
      { type: "breathe", label: "Breathe" },
      { type: "party", label: "Party Mode" },
    ];
    defaultShowsDropdown.innerHTML = templates
      .map(
        (t) =>
          `<button type="button" class="admin-header-show-name-menu-item" data-template="${t.type}" role="menuitem">${t.label}</button>`
      )
      .join("");

    defaultShowsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = defaultShowsDropdown.hidden;
      defaultShowsDropdown.hidden = !open;
      defaultShowsBtn.setAttribute("aria-expanded", String(!open));
      if (!open) {
        const ad = document.getElementById(HEADER_SELECTORS.accountDropdown) as HTMLElement | null;
        if (ad) ad.hidden = true;
      }
    });

    defaultShowsDropdown.querySelectorAll(HEADER_SELECTORS.dataTemplate).forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const template = (e.currentTarget as HTMLElement).dataset.template as TemplateType;
        defaultShowsDropdown.hidden = true;
        defaultShowsBtn.setAttribute("aria-expanded", "false");
        await createAndOpenDefaultShow(template);
      });
    });
  }

  const showNameDropdownBtn = document.getElementById(HEADER_SELECTORS.showNameDropdownBtn);
  const showNameDropdown = document.getElementById(HEADER_SELECTORS.showNameDropdown);
  if (showNameDropdownBtn && showNameDropdown) {
    showNameDropdownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = showNameDropdown.hidden;
      showNameDropdown.hidden = !open;
      showNameDropdownBtn.setAttribute("aria-expanded", String(!open));
      if (!open) {
        const ad = document.getElementById(HEADER_SELECTORS.accountDropdown) as HTMLElement | null;
        if (ad) ad.hidden = true;
        if (dropdown) dropdown.hidden = true;
      }
    });
    showNameDropdown.addEventListener("click", (e) => e.stopPropagation());
    showNameDropdown.querySelectorAll(HEADER_SELECTORS.adminHeaderShowNameMenuItem).forEach((btn) => {
      btn.addEventListener("click", () => {
        showNameDropdown.hidden = true;
        showNameDropdownBtn?.setAttribute("aria-expanded", "false");
        const action = (btn as HTMLElement).dataset.action;
        if (action === "close-show") closeCurrentShow();
        else if (action === "open-another") openOpenShowModal();
        else if (action === "add-admin") openShareShowModal();
        else if (action === "delete-show") openDeleteShowModal();
      });
    });
  }

  function syncShowStatusUI(): void {
    const statusBtn = document.getElementById(HEADER_SELECTORS.showStatusBtn);
    const statusDropdown = document.getElementById(HEADER_SELECTORS.showStatusDropdown);
    if (!statusBtn || !statusDropdown) return;
    const tag = statusBtn.querySelector(HEADER_SELECTORS.adminHeaderStatusTag);
    const label = showLiveState === "not_live" ? "Not Live" : showLiveState === "requesting" ? "Requesting Server" : "Live";
    const stateClass = showLiveState === "not_live" ? "admin-header-status-wrap--not-live" : showLiveState === "requesting" ? "admin-header-status-wrap--requesting" : "admin-header-status-wrap--live";
    statusBtn.className = "admin-header-status-wrap " + stateClass;
    statusBtn.removeAttribute("disabled");
    if (tag) tag.textContent = label;
    const hasDropdown = showLiveState === "not_live" || showLiveState === "live";
    if (hasDropdown) {
      if (!statusBtn.querySelector(HEADER_SELECTORS.adminHeaderStatusCaret)) {
        const caret = document.createElement("span");
        caret.className = "admin-header-status-caret";
        caret.setAttribute("aria-hidden", "true");
        caret.innerHTML = carrotIcon;
        statusBtn.appendChild(caret);
      }
    } else {
      statusBtn.setAttribute("disabled", "");
      const caret = statusBtn.querySelector(HEADER_SELECTORS.adminHeaderStatusCaret);
      if (caret) caret.remove();
    }
    if (showLiveState === "not_live") {
      statusDropdown.innerHTML = `<button type="button" class="admin-header-show-name-menu-item" data-status-action="go-live" role="menuitem">Request Server to Go Live</button>`;
    } else if (showLiveState === "live") {
      statusDropdown.innerHTML = `<button type="button" class="admin-header-show-name-menu-item" data-status-action="end-live" role="menuitem">End Live Session</button>`;
    } else {
      statusDropdown.innerHTML = "";
    }
    statusDropdown.hidden = true;
    statusBtn.setAttribute("aria-expanded", "false");
  }
  setSyncShowStatusUIRef(syncShowStatusUI);

  const statusBtn = document.getElementById(HEADER_SELECTORS.showStatusBtn);
  const statusDropdown = document.getElementById(HEADER_SELECTORS.showStatusDropdown);
  if (statusBtn && statusDropdown && currentShow) {
    statusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (statusBtn.hasAttribute("disabled")) return;
      const open = !statusDropdown.hidden;
      statusDropdown.hidden = open;
      statusBtn.setAttribute("aria-expanded", String(!open));
      if (!open) {
        const ad = document.getElementById(HEADER_SELECTORS.accountDropdown) as HTMLElement | null;
        if (ad) ad.hidden = true;
        if (dropdown) dropdown.hidden = true;
        const showNameD = document.getElementById(HEADER_SELECTORS.showNameDropdown);
        const showNameB = document.getElementById(HEADER_SELECTORS.showNameDropdownBtn);
        if (showNameD) showNameD.hidden = true;
        if (showNameB) showNameB.setAttribute("aria-expanded", "false");
      }
    });
    statusDropdown.addEventListener("click", (e) => e.stopPropagation());
    statusDropdown.addEventListener("click", async (e) => {
      const target = (e.target as HTMLElement).closest("[data-status-action]");
      if (!target) return;
      const action = (target as HTMLElement).dataset.statusAction;
      statusDropdown.hidden = true;
      statusBtn.setAttribute("aria-expanded", "false");
      const showId = currentShow?.id;
      if (!showId) return;
      if (action === "go-live") {
        showLiveState = "requesting";
        syncShowStatusUI();
        dispatchLiveStateEvent(showId, false, true);
        try {
          const res = await fetch(`/api/admin/show-workspaces/${showId}/go-live`, {
            method: "POST",
            credentials: "include",
          });
          if (res.ok) {
            showLiveState = "live";
            syncShowStatusUI();
            broadcastLiveState(showId, true);
          } else {
            showLiveState = "not_live";
            syncShowStatusUI();
            dispatchLiveStateEvent(showId, false, false);
          }
        } catch {
          showLiveState = "not_live";
          syncShowStatusUI();
          dispatchLiveStateEvent(showId, false, false);
        }
      } else if (action === "end-live") {
        try {
          const res = await fetch(`/api/admin/show-workspaces/${showId}/end-live`, {
            method: "POST",
            credentials: "include",
          });
          if (res.ok) {
            showLiveState = "not_live";
            syncShowStatusUI();
            broadcastLiveState(showId, false);
          }
        } catch {
          // keep current UI state on error
        }
      }
    });
    syncShowStatusUI();
  }

  if (currentPath === "/simulateDevices") {
    const extra = document.getElementById(HEADER_SELECTORS.pageHeaderExtra);
    if (extra) {
      extra.appendChild(
        createInfoBubble({
          tooltipText:
            "This page allows you to simulate extra clients with various network configurations and delays to see how they will react to the timeline.",
          ariaLabel: "Info",
        })
      );
    }
  }
}

function openNewShowModal(): void {
  const cb = getCb();
  const content = document.createElement("div");
  content.innerHTML = `
    <label for="${HEADER_SELECTORS.newShowNameInput}" style="display:block;margin-bottom:4px;font-size:12px;color:var(--text-muted);">Show name</label>
    <input type="text" id="${HEADER_SELECTORS.newShowNameInput}" class="modal-input" placeholder="e.g. My Show" style="width:100%;margin-bottom:12px;padding:6px 8px;font-size:13px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);box-sizing:border-box;" />
    <div id="${HEADER_SELECTORS.newShowError}" style="font-size:12px;color:#e87a7a;margin-bottom:8px;" hidden></div>`;
  const input = content.querySelector(`#${HEADER_SELECTORS.newShowNameInput}`) as HTMLInputElement;
  const errorEl = content.querySelector("#new-show-error") as HTMLElement;

  const { close } = openModal({
    size: "small",
    clickOutsideToClose: true,
    title: "New Show",
    content,
    cancel: {},
    actions: [{ preset: "primary", label: "Create", onClick: async () => {
      const name = input?.value?.trim() ?? "";
      if (!name) {
        errorEl.textContent = "Enter a show name.";
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;
      try {
        const res = await fetch("/api/admin/show-workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name }),
        });
        const data = await res.json().catch(() => ({})) as { show_id?: string; name?: string };
        if (res.ok && data.show_id != null && data.name != null) {
          currentShow = { id: data.show_id, name: data.name };
          showLiveState = "not_live";
          close();
          cb.navigateToPathWithShow(cb.getPath(), currentShow);
          cb.renderApp(lastUsername);
          fetchLiveStateFromServer(currentShow.id)
            .then((live) => {
              showLiveState = live ? "live" : "not_live";
              refreshLiveStateUI();
              scheduleNextLiveStatePoll(LIVE_STATE_INITIAL_POLL_MS);
            })
            .catch(() => scheduleNextLiveStatePoll(LIVE_STATE_INITIAL_POLL_MS));
          return;
        }
        errorEl.textContent = res.status === 400 ? "Invalid show name." : "Failed to create show.";
        errorEl.hidden = false;
      } catch {
        errorEl.textContent = "Network error.";
        errorEl.hidden = false;
      }
    } }],
  });

  input?.focus();
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function createAndOpenDefaultShow(templateType: TemplateType): Promise<void> {
  const cb = getCb();
  const templateData = getTemplateState(templateType);
  const showName = templateData.title;

  try {
    const listRes = await fetch("/api/admin/show-workspaces", { credentials: "include" });
    if (listRes.ok) {
      const shows = (await listRes.json()) as ShowListItem[];
      const existingShow = shows.find(s => s.name === showName);

      if (existingShow) {
        currentShow = { id: existingShow.show_id, name: existingShow.name };
        showLiveState = "not_live";
        cb.navigateToPathWithShow("/timeline", currentShow);
        cb.renderApp(lastUsername);

        fetchLiveStateFromServer(currentShow.id)
          .then((live) => {
            showLiveState = live ? "live" : "not_live";
            refreshLiveStateUI();
            scheduleNextLiveStatePoll(LIVE_STATE_INITIAL_POLL_MS);
          })
          .catch(() => scheduleNextLiveStatePoll(LIVE_STATE_INITIAL_POLL_MS));
        return;
      }
    }

    const res = await fetch("/api/admin/show-workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: showName }),
    });

    const data = await res.json().catch(() => ({})) as { show_id?: string; name?: string };
    if (!res.ok || !data.show_id || !data.name) {
      alert("Failed to create show. Please try again.");
      return;
    }

    const putRes = await fetch(`/api/admin/show-workspaces/${data.show_id}/timeline`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(templateData),
    });

    if (!putRes.ok) {
      alert("Failed to apply template. The show was created but is empty.");
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    currentShow = { id: data.show_id, name: data.name };
    showLiveState = "not_live";
    cb.navigateToPathWithShow("/timeline", currentShow);
    cb.renderApp(lastUsername);

    fetchLiveStateFromServer(currentShow.id)
      .then((live) => {
        showLiveState = live ? "live" : "not_live";
        refreshLiveStateUI();
        scheduleNextLiveStatePoll(LIVE_STATE_INITIAL_POLL_MS);
      })
      .catch(() => scheduleNextLiveStatePoll(LIVE_STATE_INITIAL_POLL_MS));
  } catch (err) {
    alert("Network error. Please try again.");
    console.error("Failed to create default show:", err);
  }
}

function openOpenShowModal(): void {
  const cb = getCb();
  openOpenShowModalFromModule((show) => {
    currentShow = show;
    showLiveState = "not_live";
    cb.navigateToPathWithShow(cb.getPath(), currentShow);
    cb.renderApp(lastUsername);
    fetchLiveStateFromServer(show.id)
      .then((live) => {
        showLiveState = live ? "live" : "not_live";
        refreshLiveStateUI();
        scheduleNextLiveStatePoll(LIVE_STATE_INITIAL_POLL_MS);
      })
      .catch(() => scheduleNextLiveStatePoll(LIVE_STATE_INITIAL_POLL_MS));
  });
}

function closeCurrentShow(): void {
  const cb = getCb();
  currentShow = null;
  showLiveState = "not_live";
  clearLiveStatePollTimer();
  window.history.replaceState(null, "", cb.getPath());
  cb.renderApp(lastUsername);
}

function openShareShowModal(): void {
  if (!currentShow) return;
  const showId = currentShow.id;
  const inputId = "share-show-username-input";
  const content = document.createElement("div");
  content.innerHTML = `
    <label for="${inputId}" style="display:block;margin-bottom:4px;font-size:12px;color:var(--text-muted);">Username</label>
    <input type="text" id="${inputId}" class="modal-input" placeholder="Enter username" autocomplete="username" style="width:100%;margin-bottom:6px;padding:6px 8px;font-size:13px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);box-sizing:border-box;" />
    <div id="share-show-hint" style="font-size:12px;margin-bottom:12px;min-height:18px;"></div>`;
  const input = content.querySelector(`#${inputId}`) as HTMLInputElement;
  const hintEl = content.querySelector("#share-show-hint") as HTMLElement;

  let checkAbort = 0;
  async function checkUsername(): Promise<void> {
    const q = (input?.value ?? "").trim();
    if (!q) {
      hintEl.textContent = "";
      hintEl.style.color = "";
      return;
    }
    const gen = ++checkAbort;
    try {
      const res = await fetch(`/api/admin/users/check?username=${encodeURIComponent(q)}`, { credentials: "include" });
      const data = (await res.json()) as { exists?: boolean };
      if (gen !== checkAbort) return;
      if (data.exists) {
        hintEl.textContent = "User found.";
        hintEl.style.color = "var(--text-muted)";
      } else {
        hintEl.textContent = "Username incorrect.";
        hintEl.style.color = "#e87a7a";
      }
    } catch {
      if (gen !== checkAbort) return;
      hintEl.textContent = "Could not check username.";
      hintEl.style.color = "#e87a7a";
    }
  }

  let inputDebounce: ReturnType<typeof setTimeout> | null = null;
  input?.addEventListener("input", () => {
    if (inputDebounce) clearTimeout(inputDebounce);
    inputDebounce = setTimeout(() => { inputDebounce = null; checkUsername(); }, 300);
  });
  input?.addEventListener("blur", () => { if (inputDebounce) clearTimeout(inputDebounce); inputDebounce = null; checkUsername(); });

  const { close } = openModal({
    size: "small",
    clickOutsideToClose: true,
    title: "Add Another Admin To This Show",
    content,
    cancel: {},
    actions: [
      {
        preset: "share",
        onClick: async () => {
          const username = (input?.value ?? "").trim();
          if (!username) return;
          try {
            const res = await fetch(`/api/admin/show-workspaces/${showId}/members`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ username }),
            });
            if (res.ok) {
              close();
              return;
            }
            if (res.status === 409) {
              hintEl.textContent = "That user already has access.";
              hintEl.style.color = "#e87a7a";
            } else {
              hintEl.textContent = "Failed to add user.";
              hintEl.style.color = "#e87a7a";
            }
          } catch {
            hintEl.textContent = "Network error.";
            hintEl.style.color = "#e87a7a";
          }
        },
      },
    ],
  });

  input?.focus();
}

function openDeleteShowModal(): void {
  const cb = getCb();
  if (!currentShow) return;
  const showId = currentShow.id;
  const showName = currentShow.name;
  const content = document.createElement("div");
  content.innerHTML = `
    <p style="font-size:13px;color:var(--text-muted);margin:0 0 8px;">Everyone with access will lose access. People with access:</p>
    <ul id="${HEADER_SELECTORS.deleteShowMembersList}" style="margin:0 0 12px;padding-left:20px;font-size:13px;color:var(--text);"></ul>
    <p style="font-size:13px;color:var(--text-muted);margin:0 0 4px;">Type the show name below to confirm:</p>
    <input type="text" id="${HEADER_SELECTORS.deleteShowConfirmInput}" class="modal-input" placeholder="Show name" style="width:100%;margin-bottom:12px;padding:6px 8px;font-size:13px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);box-sizing:border-box;" />
    <div id="${HEADER_SELECTORS.deleteShowError}" style="font-size:12px;color:#e87a7a;margin-bottom:8px;" hidden></div>`;
  const membersList = content.querySelector(`#${HEADER_SELECTORS.deleteShowMembersList}`) as HTMLElement;
  const confirmInput = content.querySelector(`#${HEADER_SELECTORS.deleteShowConfirmInput}`) as HTMLInputElement;
  const errorEl = content.querySelector(`#${HEADER_SELECTORS.deleteShowError}`) as HTMLElement;

  (async () => {
    try {
      const res = await fetch(`/api/admin/show-workspaces/${showId}/members`, { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as { users: { username: string }[] };
        membersList.innerHTML = data.users.map((u) => `<li>${escapeHtml(u.username)}</li>`).join("") || "<li>(none)</li>";
      }
    } catch {
      membersList.innerHTML = "<li>(could not load)</li>";
    }
  })();

  const { close } = openModal({
    size: "small",
    clickOutsideToClose: true,
    title: "Delete This Show",
    content,
    cancel: {},
    actions: [
      {
        preset: "delete",
        label: "Delete",
        onClick: async () => {
          if ((confirmInput?.value ?? "").trim() !== showName) return;
          errorEl.hidden = true;
          try {
            const res = await fetch(`/api/admin/show-workspaces/${showId}`, { method: "DELETE", credentials: "include" });
            if (res.ok || res.status === 204) {
              close();
              closeCurrentShow();
              cb.renderApp(lastUsername);
              return;
            }
            errorEl.textContent = "Failed to delete show.";
            errorEl.hidden = false;
          } catch {
            errorEl.textContent = "Network error.";
            errorEl.hidden = false;
          }
        },
      },
    ],
  });

  const deleteBtn = content.closest(HEADER_SELECTORS.globalModalPanel)?.querySelector(HEADER_SELECTORS.globalModalFooterRightButton) as HTMLButtonElement | null;
  function updateDeleteButton(): void {
    const typed = (confirmInput?.value ?? "").trim();
    if (deleteBtn) deleteBtn.disabled = typed !== showName;
  }
  if (deleteBtn) deleteBtn.disabled = true;
  confirmInput?.addEventListener("input", updateDeleteButton);

  confirmInput?.focus();
}
