import "./styles.css";
import menuIcon from "./icons/menu.svg?raw";
import dashboardIcon from "./icons/dashboard.svg?raw";
import timelineIcon from "./icons/timeline.svg?raw";
import tableIcon from "./icons/table.svg?raw";
import mapIcon from "./icons/map.svg?raw";
import { render as renderDashboard } from "./pages/dashboard";
import { render as renderTimeline } from "./pages/timeline";
import { render as renderConnectedDevicesList } from "./pages/connected-devices-list";
import { render as renderConnectedDevicesMap } from "./pages/connected-devices-map";

const AUTH_TOKEN_KEY = "lumelier_admin_auth";

type RoutePath = "/" | "/timeline" | "/connectedDevicesList" | "/connectedDevicesMap";

const ROUTES: { path: RoutePath; title: string; icon: string }[] = [
  { path: "/", title: "Dashboard", icon: dashboardIcon },
  { path: "/timeline", title: "Timeline", icon: timelineIcon },
  { path: "/connectedDevicesList", title: "Connected Devices List", icon: tableIcon },
  { path: "/connectedDevicesMap", title: "Connected Devices Map", icon: mapIcon },
];

function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(value: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, value);
}

function getPath(): RoutePath {
  const p = window.location.pathname.replace(/\/$/, "") || "/";
  return (ROUTES.some((r) => r.path === p) ? p : "/") as RoutePath;
}

function navigate(path: RoutePath): void {
  if (getPath() === path) return;
  window.history.pushState({}, "", path);
  render();
}

function renderGate(app: HTMLElement): void {
  app.innerHTML = `
    <div class="gate">
      <p>Admin panel</p>
      <button type="button" id="proceed">Proceed</button>
    </div>
  `;
  document.getElementById("proceed")?.addEventListener("click", () => {
    setAuthToken("true");
    render();
  });
}

function renderHeader(container: HTMLElement, currentPath: RoutePath): void {
  const current = ROUTES.find((r) => r.path === currentPath)!;
  const dropdownId = "menu-dropdown";
  container.innerHTML = `
    <header class="admin-header">
      <button type="button" class="menu-btn" id="menu-btn" aria-expanded="false" aria-haspopup="true" aria-controls="${dropdownId}">${menuIcon}</button>
      <span class="page-title">${current.title}</span>
      <div id="${dropdownId}" class="menu-dropdown" hidden role="menu">
        ${ROUTES.map(
          (r) =>
            `<a href="${r.path}" role="menuitem" data-path="${r.path}" class="${r.path === currentPath ? "current" : ""}"><span class="icon-wrap">${r.icon}</span>${r.title}</a>`
        ).join("")}
      </div>
    </header>
    <main class="admin-content" id="admin-content"></main>
  `;

  const menuBtn = document.getElementById("menu-btn");
  const dropdown = document.getElementById(dropdownId);
  if (menuBtn && dropdown) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = dropdown.hidden;
      dropdown.hidden = !open;
      menuBtn.setAttribute("aria-expanded", String(!open));
    });
    dropdown.addEventListener("click", (e) => e.stopPropagation());
    if (!(window as unknown as { _adminMenuClosed?: boolean })._adminMenuClosed) {
      (window as unknown as { _adminMenuClosed: boolean })._adminMenuClosed = true;
      document.addEventListener("click", () => {
        const d = document.getElementById(dropdownId);
        const b = document.getElementById("menu-btn");
        if (d) d.hidden = true;
        if (b) b.setAttribute("aria-expanded", "false");
      });
    }
  }

  dropdown?.querySelectorAll("a[data-path]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(a.getAttribute("data-path") as RoutePath);
      dropdown!.hidden = true;
      menuBtn?.setAttribute("aria-expanded", "false");
    });
  });
}

function renderPageContent(path: RoutePath): void {
  const main = document.getElementById("admin-content");
  if (!main) return;
  switch (path) {
    case "/":
      return renderDashboard(main);
    case "/timeline":
      return renderTimeline(main);
    case "/connectedDevicesList":
      return renderConnectedDevicesList(main);
    case "/connectedDevicesMap":
      return renderConnectedDevicesMap(main);
  }
}

function renderApp(): void {
  const app = document.getElementById("app");
  if (!app) return;
  const path = getPath();
  renderHeader(app, path);
  renderPageContent(path);
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;
  if (!getAuthToken()) {
    renderGate(app);
    return;
  }
  renderApp();
}

window.addEventListener("popstate", () => render());

render();
