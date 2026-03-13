import timelineIcon from "../icons/timeline.svg?raw";
import mapIcon from "../icons/map.svg?raw";
import qrcodeIcon from "../icons/qrcode.svg?raw";
import tableIcon from "../icons/table.svg?raw";
import robotIcon from "../icons/robot.svg?raw";

export type RoutePath =
  | "/timeline"
  | "/venueMap"
  | "/connectedDevicesList"
  | "/simulateDevices"
  | "/sessionManager"
  | "/login"
  | "/register";

export const ROUTES: { path: RoutePath; title: string; icon: string }[] = [
  { path: "/timeline", title: "Timeline", icon: timelineIcon },
  { path: "/venueMap", title: "Venue Map", icon: mapIcon },
  { path: "/sessionManager", title: "Attendee Access Point", icon: qrcodeIcon },
  { path: "/connectedDevicesList", title: "Connected Devices List", icon: tableIcon },
  { path: "/simulateDevices", title: "Simulate Extra Devices", icon: robotIcon },
];

export const KNOWN_APP_PATHS: RoutePath[] = [
  "/timeline",
  "/venueMap",
  "/sessionManager",
  "/connectedDevicesList",
  "/simulateDevices",
];

export const SHOW_ID_REGEX = /^[a-z0-9]{8}$/;

export function parsePath(): { path: RoutePath; showId: string | null } {
  const raw = window.location.pathname.replace(/\/$/, "") || "/";
  const segments = raw === "/" ? [] : raw.split("/").filter(Boolean);
  if (segments.length === 0) return { path: "/timeline", showId: null };
  if (segments.length === 1) {
    const one = "/" + segments[0];
    if (one === "/login" || one === "/register") return { path: one, showId: null };
    if (KNOWN_APP_PATHS.includes(one as RoutePath)) return { path: one as RoutePath, showId: null };
    return { path: "/timeline", showId: null };
  }
  if (segments.length === 2) {
    const basePath = "/" + segments[0] as RoutePath;
    const showId = segments[1];
    if (KNOWN_APP_PATHS.includes(basePath)) {
      return { path: basePath, showId };
    }
  }
  return { path: "/timeline", showId: null };
}

export function getPath(): RoutePath {
  return parsePath().path;
}

export function getShowIdFromPath(): string | null {
  return parsePath().showId;
}
