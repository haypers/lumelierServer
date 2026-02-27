/**
 * Reusable "Refresh every" control: label, dropdown, optional clock icon,
 * optional info tooltip, and optional disconnect indicator when requests exceed response time.
 */

import { createInfoBubble } from "./info-bubble";
import { createPopupTrigger } from "./popup-tooltip";
import warningBulbEmpty from "../icons/warningBulbEmpty.svg?raw";
import warningBulbFilled from "../icons/warningBulbFilled.svg?raw";
import alertIcon from "../icons/alert.svg?raw";

const FLASH_FRAME_COUNT = 8;
const MIN_INTERVAL_MS_TO_SHOW_CLOCK = 500;
const NEVER_MS = 0;

/** Default time (ms) after which a request is considered "not responding" and the disconnect indicator is shown. */
export const DEFAULT_RESPONSE_TIMEOUT_MS = 1_000;

/** Inline SVG: circular arrow refresh icon */
const REFRESH_ICON_SVG = `<svg class="refresh-manual-icon-svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 0-2.2 5.8L21 21M21 3v6h-6"/>
</svg>`;

export const REFRESH_EVERY_OPTIONS = [
  { value: 16, label: "Frame" },
  { value: 32, label: "Every 2 Frames" },
  { value: 48, label: "Every 3 Frames" },
  { value: 75, label: "Every 5 Frames" },
  { value: 100, label: "0.1 sec" },
  { value: 200, label: "0.2 sec" },
  { value: 500, label: "0.5 sec" },
  { value: 1000, label: "1 sec" },
  { value: 2000, label: "2 sec" },
  { value: 3000, label: "3 sec" },
  { value: 5000, label: "5 sec" },
  { value: 10000, label: "10 sec" },
  { value: 30000, label: "30 sec" },
  { value: NEVER_MS, label: "Never" },
] as const;

export interface RefreshEveryOptions {
  /** Used as the localStorage key to persist the selected interval. Loaded on init, saved on change. */
  name: string;
  defaultMs: number;
  onIntervalChange: (ms: number) => void;
  /** Called when user clicks the manual refresh icon (shown when "Never" is selected). */
  onManualRefresh?: () => void;
  /** If set, show an info icon with this tooltip text. */
  infoTooltip?: string;
  /**
   * If set, show a disconnect indicator when a request fails or exceeds this many ms.
   * Call requestStarted() before each request and requestCompleted(success) when it finishes.
   */
  responseTimeoutMs?: number;
  /** Custom tooltip for the disconnect indicator when responseTimeoutMs is set. Defaults to a generic server-not-responding message. */
  disconnectTooltip?: string;
  /** When false (default), timer does not run, clock does not spin, and a light-yellow alert icon with tooltip is shown. */
  isDataLive?: boolean;
}

export interface RefreshEveryApi {
  root: HTMLElement;
  getIntervalMs: () => number;
  recordRefresh: () => void;
  updateClockHand: () => void;
  /** Call before starting a request; use with responseTimeoutMs. */
  requestStarted: () => void;
  /** Call when a request finishes. Pass false on failure (or timeout) to show disconnect indicator; pass true on success to hide it. */
  requestCompleted: (success: boolean) => void;
}

function getStoredIntervalMs(name: string, defaultMs: number): number {
  const s = localStorage.getItem(name);
  if (s == null) return defaultMs;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : defaultMs;
}

function removeFlashAfterFrames(clockEl: HTMLElement, framesLeft: number): void {
  if (framesLeft <= 0) {
    clockEl.classList.remove("refresh-clock--flash");
    return;
  }
  requestAnimationFrame(() => removeFlashAfterFrames(clockEl, framesLeft - 1));
}

const DISCONNECT_TOOLTIP = "The server is not responding to our requests to update this value.";

const NOT_LIVE_TOOLTIP =
  "This show is not being broadcast on a live show server.\n\nOnce live, this timer will determine how often your UI will refresh.";

export function createRefreshEvery(opts: RefreshEveryOptions): RefreshEveryApi {
  const { name, defaultMs, onIntervalChange, onManualRefresh, infoTooltip, responseTimeoutMs, disconnectTooltip, isDataLive = false } = opts;
  const intervalMs = getStoredIntervalMs(name, defaultMs);
  let lastRefreshTime = 0;
  let responseTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let disconnectIndicatorVisible = false;

  const root = document.createElement("div");
  root.className = "refresh-every-wrapper" + (isDataLive ? "" : " refresh-every-wrapper--not-live");

  const optionsHtml = REFRESH_EVERY_OPTIONS.map(
    (o) =>
      `<option value="${o.value}" ${o.value === intervalMs ? "selected" : ""}>${o.label}</option>`
  ).join("");

  const isNever = intervalMs === NEVER_MS;
  const clockVisible = !isNever && intervalMs >= MIN_INTERVAL_MS_TO_SHOW_CLOCK;
  const manualVisible = isNever;

  root.innerHTML = `
    <label class="refresh-every-label">Refresh every:</label>
    <select class="refresh-every-select" data-refresh-every-select>
      ${optionsHtml}
    </select>
    <span class="refresh-clock ${clockVisible ? "" : "refresh-clock--hidden"}" aria-hidden="true" data-refresh-clock>
      <svg class="refresh-clock-svg" viewBox="0 0 24 24" width="24" height="24">
        <circle class="refresh-clock-face" cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <g class="refresh-clock-hand" data-refresh-clock-hand transform="rotate(0 12 12)">
          <line x1="12" y1="12" x2="12" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </g>
      </svg>
    </span>
    <button type="button" class="refresh-manual-btn ${manualVisible ? "" : "refresh-manual-btn--hidden"}" data-refresh-manual-btn title="Refresh now" aria-label="Refresh now">
      ${REFRESH_ICON_SVG}
    </button>
  `;
  if (!isDataLive) {
    const notLiveTrigger = createPopupTrigger({
      triggerContent: `<span class="refresh-every-not-live-icon" aria-hidden="true">${alertIcon}</span>`,
      tooltipText: NOT_LIVE_TOOLTIP,
      ariaLabel: "Not live",
      wrapperClass: "refresh-every-not-live-trigger",
    });
    root.insertBefore(notLiveTrigger, root.firstChild);
  }
  if (infoTooltip != null && infoTooltip !== "") {
    const infoBubble = createInfoBubble({ tooltipText: infoTooltip, ariaLabel: "Info" });
    root.appendChild(infoBubble);
  }

  const hasResponseTimeout = typeof responseTimeoutMs === "number" && responseTimeoutMs > 0;
  let disconnectIndicatorEl: HTMLElement | null = null;
  if (hasResponseTimeout) {
    const bulbHtml = `
      <span class="disconnect-indicator-bulbs" aria-hidden="true">
        <span class="disconnect-indicator-empty">${warningBulbEmpty}</span>
        <span class="disconnect-indicator-filled">${warningBulbFilled}</span>
      </span>`;
    disconnectIndicatorEl = createPopupTrigger({
      triggerContent: bulbHtml,
      tooltipText: disconnectTooltip ?? DISCONNECT_TOOLTIP,
      ariaLabel: "Server not responding",
      wrapperClass: "disconnect-indicator disconnect-indicator--hidden",
    });
    root.appendChild(disconnectIndicatorEl);
  }

  const selectEl = root.querySelector<HTMLSelectElement>("[data-refresh-every-select]");
  const clockEl = root.querySelector<HTMLElement>("[data-refresh-clock]");
  const clockHandEl = root.querySelector<SVGGElement>("[data-refresh-clock-hand]");
  const manualBtnEl = root.querySelector<HTMLButtonElement>("[data-refresh-manual-btn]");

  if (!selectEl || !clockEl) throw new Error("refresh-every: missing elements");

  function updateClockVsManual(ms: number): void {
    const never = ms === NEVER_MS;
    if (clockEl) clockEl.classList.toggle("refresh-clock--hidden", never || ms < MIN_INTERVAL_MS_TO_SHOW_CLOCK);
    if (manualBtnEl) manualBtnEl.classList.toggle("refresh-manual-btn--hidden", !never);
  }

  selectEl.addEventListener("change", () => {
    const ms = parseInt(selectEl.value, 10);
    if (!Number.isFinite(ms) || ms < 0) return;
    localStorage.setItem(name, String(ms));
    lastRefreshTime = Date.now();
    updateClockVsManual(ms);
    onIntervalChange(ms);
  });

  if (manualBtnEl && onManualRefresh) {
    manualBtnEl.addEventListener("click", () => onManualRefresh());
  }

  function getIntervalMs(): number {
    return getStoredIntervalMs(name, defaultMs);
  }

  function recordRefresh(): void {
    lastRefreshTime = Date.now();
    if (clockEl && !clockEl.classList.contains("refresh-clock--hidden")) {
      clockEl.classList.add("refresh-clock--flash");
      removeFlashAfterFrames(clockEl, FLASH_FRAME_COUNT);
    }
  }

  function updateClockHand(): void {
    if (!isDataLive) return;
    const ms = getIntervalMs();
    if (ms === NEVER_MS || ms < MIN_INTERVAL_MS_TO_SHOW_CLOCK || !clockHandEl) return;
    if (lastRefreshTime <= 0) lastRefreshTime = Date.now();
    const elapsed = Date.now() - lastRefreshTime;
    const progress = (elapsed % ms) / ms;
    const angle = progress * 360;
    clockHandEl.setAttribute("transform", `rotate(${angle} 12 12)`);
  }

  function requestStarted(): void {
    if (!hasResponseTimeout || !disconnectIndicatorEl) return;
    if (responseTimeoutId != null) clearTimeout(responseTimeoutId);
    responseTimeoutId = setTimeout(() => {
      responseTimeoutId = null;
      disconnectIndicatorVisible = true;
      disconnectIndicatorEl?.classList.remove("disconnect-indicator--hidden");
    }, responseTimeoutMs!);
  }

  function requestCompleted(success: boolean): void {
    if (responseTimeoutId != null) {
      clearTimeout(responseTimeoutId);
      responseTimeoutId = null;
    }
    if (success) {
      if (disconnectIndicatorVisible && disconnectIndicatorEl) {
        disconnectIndicatorVisible = false;
        disconnectIndicatorEl.classList.add("disconnect-indicator--hidden");
      }
    } else {
      disconnectIndicatorVisible = true;
      disconnectIndicatorEl?.classList.remove("disconnect-indicator--hidden");
    }
  }

  lastRefreshTime = Date.now();
  return { root, getIntervalMs, recordRefresh, updateClockHand, requestStarted, requestCompleted };
}
