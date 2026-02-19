import { getFaintUiTextColor, normalizeHex } from "./color";

const POPUP_CONTAINER_ID = "popup-container";
const POPUP_STACK_ID = "popup-stack";

function getContrastColor(): string {
  const bg =
    document.documentElement.style.background ||
    document.body.style.background ||
    "#000000";
  const hex = normalizeHex(bg) ?? "#000000";
  return getFaintUiTextColor(hex);
}

export interface TwoButtonModalOptions {
  type: string;
  message: string;
  leftLabel: string;
  rightLabel: string;
  /** Optional: called when left button is clicked (before any dismiss). */
  onLeftClick?: () => void;
  /** Optional: called when right button is clicked (before any dismiss). */
  onRightClick?: () => void;
}

export interface OneButtonModalOptions {
  type: string;
  message: string;
  primaryLabel: string;
  /** Called when the button is clicked (e.g. to trigger permission prompt). Popup is not auto-dismissed. */
  onPrimaryClick?: () => void;
}

interface PopupEntry {
  type: string;
  element: HTMLElement;
  dismiss: () => void;
}

const popups: PopupEntry[] = [];
const TRANSITION_MS = 220;

function ensureContainer(): HTMLElement {
  let overlay = document.getElementById(POPUP_CONTAINER_ID);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = POPUP_CONTAINER_ID;
  overlay.style.cssText = [
    "position:fixed;inset:0;pointer-events:none;z-index:9999;",
    "display:flex;align-items:center;justify-content:center;",
    "box-sizing:border-box;padding:16px;",
  ].join(" ");
  const stack = document.createElement("div");
  stack.id = POPUP_STACK_ID;
  stack.style.cssText = [
    "pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:12px;",
    "max-height:100vh;overflow-y:auto;overflow-x:hidden;",
    "-webkit-overflow-scrolling:touch;",
    "box-sizing:border-box;",
  ].join(" ");
  overlay.appendChild(stack);
  document.body.appendChild(overlay);
  return overlay;
}

function getStack(): HTMLElement {
  ensureContainer();
  const stack = document.getElementById(POPUP_STACK_ID);
  if (!stack) throw new Error("popup stack missing");
  return stack;
}

function removePopup(entry: PopupEntry): void {
  if (popups.indexOf(entry) === -1) return;
  entry.element.style.transition = `opacity ${TRANSITION_MS}ms ease-out, transform ${TRANSITION_MS}ms ease-out`;
  entry.element.style.opacity = "0";
  entry.element.style.transform = "scale(0.98)";
  setTimeout(() => {
    entry.element.remove();
    const i = popups.indexOf(entry);
    if (i !== -1) popups.splice(i, 1);
  }, TRANSITION_MS);
}

/**
 * Create a two-button modal: message block (top corners rounded), buttons row
 * (left button bottom-left rounded, right button bottom-right rounded). No padding between.
 */
export function createTwoButtonModal(options: TwoButtonModalOptions): { dismiss: () => void } {
  const { type, message, leftLabel, rightLabel, onLeftClick, onRightClick } = options;
  const stack = getStack();
  const contrast = getContrastColor();

  const card = document.createElement("div");
  card.dataset.popupType = type;
  card.style.cssText = [
    "min-width:min(280px, 85vw);max-width:400px;",
    "background:transparent;",
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;",
    "overflow:hidden;",
    "transition:opacity 0.2s ease-out, transform 0.2s ease-out;",
  ].join(" ");

  const messageBlock = document.createElement("div");
  messageBlock.textContent = message;
  messageBlock.style.cssText = [
    "padding:16px 18px;margin:0;background:transparent;",
    "border:4px solid " + contrast + ";border-bottom-width:0;",
    "border-radius:12px 12px 0 0;",
    "line-height:1.45;color:" + contrast + ";",
  ].join(" ");

  const buttonsRow = document.createElement("div");
  buttonsRow.style.cssText = "display:flex;margin:0;";

  const leftBtn = document.createElement("button");
  leftBtn.type = "button";
  leftBtn.textContent = leftLabel;
  leftBtn.style.cssText = [
    "flex:1;padding:14px 16px;background:transparent;",
    "border:4px solid " + contrast + ";border-right-width:0;",
    "border-radius:0 0 0 12px;",
    "font:inherit;font-size:14px;cursor:pointer;color:" + contrast + ";",
  ].join(" ");
  leftBtn.addEventListener("click", () => onLeftClick?.());

  const rightBtn = document.createElement("button");
  rightBtn.type = "button";
  rightBtn.textContent = rightLabel;
  rightBtn.style.cssText = [
    "flex:1;padding:14px 16px;background:transparent;",
    "border:4px solid " + contrast + ";border-left-width:0;",
    "border-radius:0 0 12px 0;",
    "font:inherit;font-size:14px;cursor:pointer;color:" + contrast + ";",
  ].join(" ");
  rightBtn.addEventListener("click", () => onRightClick?.());

  buttonsRow.appendChild(leftBtn);
  buttonsRow.appendChild(rightBtn);
  card.appendChild(messageBlock);
  card.appendChild(buttonsRow);
  stack.appendChild(card);

  let dismissed = false;
  function dismiss(): void {
    if (dismissed) return;
    dismissed = true;
    removePopup(entry);
  }

  const entry: PopupEntry = { type, element: card, dismiss };
  popups.push(entry);
  return { dismiss };
}

/**
 * Create a one-button modal: message block and single full-width button. Same visual style as two-button modal.
 */
export function createOneButtonModal(options: OneButtonModalOptions): { dismiss: () => void } {
  const { type, message, primaryLabel, onPrimaryClick } = options;
  const stack = getStack();
  const contrast = getContrastColor();

  const card = document.createElement("div");
  card.dataset.popupType = type;
  card.style.cssText = [
    "min-width:min(280px, 85vw);max-width:400px;",
    "background:transparent;",
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;",
    "overflow:hidden;",
    "transition:opacity 0.2s ease-out, transform 0.2s ease-out;",
  ].join(" ");

  const messageBlock = document.createElement("div");
  messageBlock.textContent = message;
  messageBlock.style.cssText = [
    "padding:16px 18px;margin:0;background:transparent;",
    "border:4px solid " + contrast + ";border-bottom-width:0;",
    "border-radius:12px 12px 0 0;",
    "line-height:1.45;color:" + contrast + ";",
  ].join(" ");

  const primaryBtn = document.createElement("button");
  primaryBtn.type = "button";
  primaryBtn.textContent = primaryLabel;
  primaryBtn.style.cssText = [
    "width:100%;padding:14px 16px;background:transparent;margin:0;",
    "border:4px solid " + contrast + ";",
    "border-radius:0 0 12px 12px;",
    "font:inherit;font-size:14px;cursor:pointer;color:" + contrast + ";",
  ].join(" ");
  primaryBtn.addEventListener("click", () => onPrimaryClick?.());

  card.appendChild(messageBlock);
  card.appendChild(primaryBtn);
  stack.appendChild(card);

  let dismissed = false;
  function dismiss(): void {
    if (dismissed) return;
    dismissed = true;
    removePopup(entry);
  }

  const entry: PopupEntry = { type, element: card, dismiss };
  popups.push(entry);
  return { dismiss };
}

/**
 * Dismiss all popups with the given type. Remaining popups reflow with a short transition.
 */
export function dismissPopupsByType(type: string): void {
  const toRemove = popups.filter((p) => p.type === type);
  toRemove.forEach((e) => e.dismiss());
}

/**
 * Return true if at least one popup with the given type exists.
 */
export function hasPopupWithType(type: string): boolean {
  return popups.some((p) => p.type === type);
}

/**
 * If no popup with the given type exists, create one with the provided options and return true; else return false.
 */
export function showPopupIfNotExists(
  type: string,
  options: Omit<TwoButtonModalOptions, "type">
): boolean {
  if (hasPopupWithType(type)) return false;
  createTwoButtonModal({ ...options, type });
  return true;
}

/**
 * If no popup with the given type exists, create a one-button popup and return true; else return false.
 */
export function showOneButtonPopupIfNotExists(
  type: string,
  options: Omit<OneButtonModalOptions, "type">
): boolean {
  if (hasPopupWithType(type)) return false;
  createOneButtonModal({ ...options, type });
  return true;
}
