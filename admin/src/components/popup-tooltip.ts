/**
 * Reusable popup/tooltip: trigger element + tooltip that positions above/below
 * based on viewport half and clamps horizontally so it stays on screen.
 * Used by info-bubble and by the refresh-every disconnect indicator.
 */

const TOOLTIP_PAD = 12;

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export interface PopupTooltipOptions {
  /** HTML string for the trigger (icon or other content). */
  triggerContent: string;
  tooltipText: string;
  ariaLabel?: string;
  /** Class name(s) for the wrapper span. e.g. "info-bubble" or "disconnect-indicator". */
  wrapperClass: string;
}

export interface TooltipPortalOptions {
  /** When true, always show tooltip above the trigger (e.g. for disabled buttons). */
  above?: boolean;
}

/**
 * Show tooltip in a portal (appended to body) so it isn't clipped by overflow/stacking
 * and always has a high z-index. Positions with position:fixed from trigger rect.
 */
function showTooltipPortal(trigger: HTMLElement, text: string, opts?: TooltipPortalOptions): HTMLElement {
  const rect = trigger.getBoundingClientRect();
  const forceAbove = opts?.above === true;
  const inTopHalf = !forceAbove && (rect.top + rect.height / 2 < window.innerHeight / 2);
  const portal = document.createElement("div");
  portal.className = "info-tooltip info-tooltip--portal " + (inTopHalf ? "info-tooltip--below" : "info-tooltip--above");
  portal.setAttribute("role", "tooltip");
  portal.textContent = text;
  document.body.appendChild(portal);
  requestAnimationFrame(() => {
    const tw = portal.offsetWidth;
    const iconCenter = rect.left + rect.width / 2;
    const clampedLeft = Math.max(
      TOOLTIP_PAD,
      Math.min(iconCenter - tw / 2, window.innerWidth - TOOLTIP_PAD - tw)
    );
    portal.style.left = `${clampedLeft}px`;
    if (inTopHalf) {
      portal.style.top = `${rect.bottom + 6}px`;
    } else {
      portal.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    }
    portal.classList.add("info-tooltip--visible");
  });
  return portal;
}

/**
 * Attaches mouseenter/mouseleave to position the tooltip and show/hide it.
 * Uses a body-level portal so the tooltip is never clipped by table overflow or stacking.
 */
export function attachTooltipBehavior(trigger: HTMLElement, tooltipEl: HTMLElement): void {
  let portal: HTMLElement | null = null;
  trigger.addEventListener("mouseenter", () => {
    const text = tooltipEl.textContent ?? "";
    portal = showTooltipPortal(trigger, text);
  });
  trigger.addEventListener("mouseleave", () => {
    if (portal?.parentNode) {
      portal.remove();
      portal = null;
    }
  });
}

/**
 * Show tooltip only when getTooltipText() returns non-empty (e.g. when a button is disabled).
 * Use for disabled buttons: wrap the button in a span, call this with the span; tooltip appears above on hover when disabled.
 */
export function attachTooltipWhen(trigger: HTMLElement, getTooltipText: () => string): void {
  let portal: HTMLElement | null = null;
  trigger.addEventListener("mouseenter", () => {
    const text = getTooltipText();
    if (!text) return;
    portal = showTooltipPortal(trigger, text, { above: true });
  });
  trigger.addEventListener("mouseleave", () => {
    if (portal?.parentNode) {
      portal.remove();
      portal = null;
    }
  });
}

/**
 * Returns a span (with the given wrapperClass) containing the trigger content and tooltip.
 * Caller must append the returned element to the DOM.
 */
export function createPopupTrigger(opts: PopupTooltipOptions): HTMLElement {
  const { triggerContent, tooltipText, ariaLabel, wrapperClass } = opts;
  const root = document.createElement("span");
  root.className = wrapperClass;
  if (ariaLabel != null) root.setAttribute("aria-label", ariaLabel);
  root.innerHTML = `
    ${triggerContent}
    <span class="info-tooltip info-tooltip--inline-only" role="tooltip">${escapeHtml(tooltipText)}</span>
  `;
  const tooltipEl = root.querySelector<HTMLElement>(".info-tooltip");
  if (tooltipEl) attachTooltipBehavior(root, tooltipEl);
  return root;
}
