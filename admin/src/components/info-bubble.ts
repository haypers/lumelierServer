/**
 * Reusable info icon with a tooltip that positions above/below based on
 * viewport half and clamps horizontally so it stays on screen.
 */

import infoIcon from "../icons/info.svg?raw";

const TOOLTIP_PAD = 12;

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export interface InfoBubbleOptions {
  tooltipText: string;
  ariaLabel?: string;
}

function attachTooltipBehavior(trigger: HTMLElement, tooltipEl: HTMLElement): void {
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
 * Returns a span element (class "info-bubble") containing the icon and tooltip.
 * Caller must append the returned element to the DOM.
 */
export function createInfoBubble(opts: InfoBubbleOptions): HTMLElement {
  const { tooltipText, ariaLabel = "Info" } = opts;
  const root = document.createElement("span");
  root.className = "info-bubble";
  root.setAttribute("aria-label", ariaLabel);
  root.innerHTML = `
    ${infoIcon}
    <span class="info-tooltip info-tooltip--below" role="tooltip">${escapeHtml(tooltipText)}</span>
  `;
  const tooltipEl = root.querySelector<HTMLElement>(".info-tooltip");
  if (tooltipEl) attachTooltipBehavior(root, tooltipEl);
  return root;
}
