import {
  type RoutePath,
  parsePath,
  getPath,
  getShowIdFromPath,
} from "./routing";
import {
  initShowManagement,
  renderHeader,
  setupLiveStateBroadcastListener,
  getCurrentShow,
  setCurrentShow,
  setShowLiveState,
  clearLiveStatePollTimer,
  fetchLiveStateFromServer,
  scheduleNextLiveStatePoll,
} from "./show-management";
import { render as renderDashboard } from "../pages/dashboard";
import { render as renderTimeline } from "../pages/timeline";
import { render as renderConnectedDevicesList } from "../pages/connected-devices-list";
import { render as renderVenueMap } from "../pages/venue-map";
import { render as renderSimulateDevices } from "../pages/simulate-devices";
import { render as renderSessionManager } from "../pages/session-manager";
import { render as renderLogin } from "../pages/login";
import { render as renderRegister } from "../pages/register";

const LIVE_STATE_INITIAL_POLL_MS = 15000;

function renderPageContent(path: RoutePath): void {
  const main = document.getElementById("admin-content");
  if (!main) return;
  switch (path) {
    case "/dashboard":
      return renderDashboard(main, getShowIdFromPath());
    case "/timeline":
      return renderTimeline(main, getShowIdFromPath());
    case "/connectedDevicesList":
      return renderConnectedDevicesList(main, getShowIdFromPath());
    case "/venueMap":
      return renderVenueMap(main, getShowIdFromPath());
    case "/simulateDevices":
      return renderSimulateDevices(main, getShowIdFromPath());
    case "/sessionManager":
      return renderSessionManager(main, getShowIdFromPath());
    case "/login":
      return renderLogin(main);
    case "/register":
      return renderRegister(main);
  }
}

function renderApp(username: string): void {
  const app = document.getElementById("app");
  if (!app) return;
  const { path } = parsePath();
  const raw = window.location.pathname.replace(/\/$/, "") || "/";
  if (raw === "/" && path === "/dashboard") {
    window.history.replaceState(null, "", "/dashboard");
  }
  renderHeader(app, path, username);
  renderPageContent(path);
}

function navigateToPathWithShow(path: RoutePath, show: { id: string } | null): void {
  const fullPath = show ? `${path}/${show.id}` : path;
  window.history.pushState(null, "", fullPath);
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;
  const path = getPath();
  if (path === "/login" || path === "/register") {
    document.title = path === "/login" ? "Log in" : "Create an account";
    app.innerHTML = '<div id="auth-root"></div>';
    const root = document.getElementById("auth-root");
    if (root) {
      if (path === "/login") renderLogin(root);
      else renderRegister(root);
    }
    return;
  }

  fetch("/api/auth/me", { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) {
        const redirect = encodeURIComponent(window.location.pathname || "/dashboard");
        window.location.href = `/login?redirect=${redirect}`;
        return;
      }
      const data = await res.json() as { username: string };
      const path = getPath();
      const showId = getShowIdFromPath();
      clearLiveStatePollTimer();
      if (showId) {
        try {
          const showRes = await fetch(`/api/admin/show-workspaces/${showId}`, { credentials: "include" });
          if (showRes.ok) {
            const showData = (await showRes.json()) as { show_id: string; name: string };
            setCurrentShow({ id: showData.show_id, name: showData.name });
            try {
              const live = await fetchLiveStateFromServer(showData.show_id);
              setShowLiveState(live ? "live" : "not_live");
            } catch {
              setShowLiveState("not_live");
            }
          } else {
            setCurrentShow(null);
            window.history.replaceState(null, "", path);
          }
        } catch {
          setCurrentShow(null);
          window.history.replaceState(null, "", path);
        }
      } else {
        setCurrentShow(null);
      }
      renderApp(data.username);
      const currentShow = getCurrentShow();
      if (currentShow) {
        scheduleNextLiveStatePoll(LIVE_STATE_INITIAL_POLL_MS);
      }
    })
    .catch(() => {
      window.location.href = "/login";
    });
}

initShowManagement({ navigateToPathWithShow, renderApp, getPath });
setupLiveStateBroadcastListener();
window.addEventListener("popstate", () => render());

export { render };
