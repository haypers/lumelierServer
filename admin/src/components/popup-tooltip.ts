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

/**
 * Attaches mouseenter/mouseleave to position the tooltip and show/hide it.
 * Caller must ensure the tooltip has classes info-tooltip and info-tooltip--below (or --above).
 */
export function attachTooltipBehavior(trigger: HTMLElement, tooltipEl: HTMLElement): void {
  trigger.addEventListener("mouseenter", () => {
    const rect = trigger.getBoundingClientRect();
    const inTopHalf = rect.top + rect.height / 2 < window.innerHeight / 2;
    tooltipEl.classList.toggle("info-tooltip--below", inTopHalf);
    tooltipEl.classList.toggle("info-tooltip--above", !inTopHalf);
    requestAnimationFrame(() => {
      const tw = tooltipEl.offsetWidth;
      const iconCenter = rect.left + rect.width / 2;
      const clampedLeft = Math.max(
        TOOLTIP_PAD,
        Math.min(iconCenter - tw / 2, window.innerWidth - TOOLTIP_PAD - tw)
      );
      tooltipEl.style.left = `${clampedLeft - rect.left}px`;
      tooltipEl.style.transform = "none";
    });
  });
  trigger.addEventListener("mouseleave", () => {
    tooltipEl.style.left = "";
    tooltipEl.style.transform = "";
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
    <span class="info-tooltip info-tooltip--below" role="tooltip">${escapeHtml(tooltipText)}</span>
  `;
  const tooltipEl = root.querySelector<HTMLElement>(".info-tooltip");
  if (tooltipEl) attachTooltipBehavior(root, tooltipEl);
  return root;
}
