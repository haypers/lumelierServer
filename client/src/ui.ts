import * as color from "./color";
import {
  ICON_INFO_SVG,
  ICON_FULLSCREEN_SVG,
  ICON_EXIT_FULLSCREEN_SVG,
} from "./icons";
let didInitFullscreenHandlers = false;

/** Last hex color applied to the display (used by popups for contrasting color). */
let lastAppliedColor = "#000000";

export function getDisplayedColor(): string {
  return lastAppliedColor;
}

export function applyDisplayedColor(hexColor: string): void {
  const c = color.normalizeHex(hexColor) ?? "#000000";
  lastAppliedColor = c;
  const uiColor = color.getFaintUiTextColor(c);
  const popupContrast = color.getFaintUiTextColor(c, color.POPUP_CONTRAST_DELTA);
  document.documentElement.style.background = c;
  document.documentElement.style.setProperty("--popup-contrast", popupContrast);
  document.body.style.background = c;
  document.body.style.margin = "0";
  const app = document.getElementById("app");
  if (app) app.style.color = uiColor;
}

export function isFullscreen(): boolean {
  return document.fullscreenElement != null;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (!isFullscreen()) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    // Ignore (gesture requirements / unsupported / etc.)
  }
}

function updateFullscreenButton(): void {
  const btn = document.getElementById("btn-fullscreen");
  if (!btn) return;
  btn.innerHTML = isFullscreen() ? ICON_EXIT_FULLSCREEN_SVG : ICON_FULLSCREEN_SVG;
}

export function bindUiHandlers(onInfoClick?: () => void): void {
  const infoBtn = document.getElementById("btn-info") as HTMLButtonElement | null;
  const fullscreenBtn = document.getElementById("btn-fullscreen") as HTMLButtonElement | null;

  if (infoBtn) infoBtn.onclick = () => onInfoClick?.();
  if (fullscreenBtn)
    fullscreenBtn.onclick = () => {
      void toggleFullscreen().finally(updateFullscreenButton);
    };

  updateFullscreenButton();
  if (!didInitFullscreenHandlers) {
    didInitFullscreenHandlers = true;
    document.addEventListener("fullscreenchange", updateFullscreenButton);
  }
}

export interface RenderParams {
  deviceId: string;
  serverTime: number;
  firstColor: string;
  /** If set, called when the Info button is clicked (e.g. to open track panel). */
  onInfoClick?: () => void;
}

/**
 * Render the main screen UI (content div, corners, info/fullscreen buttons, hidden device-id/server-time).
 * Caller must have already set lastDisplayedColor and applied color; this only renders DOM.
 */
export function render(params: RenderParams): void {
  const app = document.getElementById("app");
  if (!app) return;
  const { deviceId, serverTime, firstColor, onInfoClick } = params;
  applyDisplayedColor(firstColor);

  app.innerHTML = `
    <div style="position:fixed;inset:0;box-sizing:border-box;font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif;font-weight:650;">
      <div id="content" style="position:absolute;inset:20px;box-sizing:border-box;">
        <div aria-hidden="true" style="position:absolute;inset:0;--corner:min(10vh, 10vw);opacity:0.65;pointer-events:none;">
          <div style="position:absolute;top:0;left:0;width:var(--corner);height:var(--corner);border-top:2px solid currentColor;border-left:2px solid currentColor;"></div>
          <div style="position:absolute;top:0;right:0;width:var(--corner);height:var(--corner);border-top:2px solid currentColor;border-right:2px solid currentColor;"></div>
          <div style="position:absolute;bottom:0;left:0;width:var(--corner);height:var(--corner);border-bottom:2px solid currentColor;border-left:2px solid currentColor;"></div>
          <div style="position:absolute;bottom:0;right:0;width:var(--corner);height:var(--corner);border-bottom:2px solid currentColor;border-right:2px solid currentColor;"></div>
        </div>

        <button id="btn-info" type="button" aria-label="Info" style="position:absolute;top:3vmin;left:3vmin;width:5vmax;height:5vmax;background:transparent;border:0;padding:0;cursor:pointer;color:inherit;opacity:0.8;">
          ${ICON_INFO_SVG}
        </button>
        <button id="btn-fullscreen" type="button" aria-label="Toggle fullscreen" style="position:absolute;top:3vmin;right:3vmin;width:5vmax;height:5vmax;background:transparent;border:0;padding:0;cursor:pointer;color:inherit;opacity:0.8;">
          ${ICON_FULLSCREEN_SVG}
        </button>

        <div style="display:none;">
          <span id="device-id">${deviceId || "—"}</span>
          <span id="server-time">${serverTime}</span>
        </div>
      </div>
    </div>
  `;
  bindUiHandlers(onInfoClick);
}
