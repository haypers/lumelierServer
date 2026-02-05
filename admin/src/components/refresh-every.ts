/**
 * Reusable "Refresh every" control: label, dropdown, optional clock icon,
 * and optional info tooltip (uses shared info-bubble component).
 */

import { createInfoBubble } from "./info-bubble";

const FLASH_FRAME_COUNT = 8;
const MIN_INTERVAL_MS_TO_SHOW_CLOCK = 500;
const NEVER_MS = 0;

/** Inline SVG: circular arrow refresh icon */
const REFRESH_ICON_SVG = `<svg class="refresh-manual-icon-svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 0-2.2 5.8L21 21M21 3v6h-6"/>
</svg>`;

export const REFRESH_EVERY_OPTIONS = [
  { value: 16, label: "Frame" },
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
  storageKey: string;
  defaultMs: number;
  onIntervalChange: (ms: number) => void;
  /** Called when user clicks the manual refresh icon (shown when "Never" is selected). */
  onManualRefresh?: () => void;
  /** If set, show an info icon with this tooltip text. */
  infoTooltip?: string;
}

export interface RefreshEveryApi {
  root: HTMLElement;
  getIntervalMs: () => number;
  recordRefresh: () => void;
  updateClockHand: () => void;
}

function getStoredIntervalMs(storageKey: string, defaultMs: number): number {
  const s = localStorage.getItem(storageKey);
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

export function createRefreshEvery(opts: RefreshEveryOptions): RefreshEveryApi {
  const { storageKey, defaultMs, onIntervalChange, onManualRefresh, infoTooltip } = opts;
  const intervalMs = getStoredIntervalMs(storageKey, defaultMs);
  let lastRefreshTime = 0;

  const root = document.createElement("div");
  root.className = "refresh-every-wrapper";

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
  if (infoTooltip != null && infoTooltip !== "") {
    const infoBubble = createInfoBubble({ tooltipText: infoTooltip, ariaLabel: "Info" });
    root.appendChild(infoBubble);
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
    localStorage.setItem(storageKey, String(ms));
    lastRefreshTime = Date.now();
    updateClockVsManual(ms);
    onIntervalChange(ms);
  });

  if (manualBtnEl && onManualRefresh) {
    manualBtnEl.addEventListener("click", () => onManualRefresh());
  }

  function getIntervalMs(): number {
    return getStoredIntervalMs(storageKey, defaultMs);
  }

  function recordRefresh(): void {
    lastRefreshTime = Date.now();
    if (clockEl && !clockEl.classList.contains("refresh-clock--hidden")) {
      clockEl.classList.add("refresh-clock--flash");
      removeFlashAfterFrames(clockEl, FLASH_FRAME_COUNT);
    }
  }

  function updateClockHand(): void {
    const ms = getIntervalMs();
    if (ms === NEVER_MS || ms < MIN_INTERVAL_MS_TO_SHOW_CLOCK || !clockHandEl) return;
    if (lastRefreshTime <= 0) lastRefreshTime = Date.now();
    const elapsed = Date.now() - lastRefreshTime;
    const progress = (elapsed % ms) / ms;
    const angle = progress * 360;
    clockHandEl.setAttribute("transform", `rotate(${angle} 12 12)`);
  }

  lastRefreshTime = Date.now();
  return { root, getIntervalMs, recordRefresh, updateClockHand };
}
