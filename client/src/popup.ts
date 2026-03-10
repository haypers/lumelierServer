const POPUP_CONTAINER_ID = "popup-container";
const POPUP_STACK_ID = "popup-stack";

/** Popups use var(--popup-contrast), set by ui.applyDisplayedColor when the main display color changes. */
const POPUP_CONTRAST_VAR = "var(--popup-contrast)";

/** Shared layout: same width, variable height, same color. */
const POPUP_CARD_WIDTH = "min(400px, max(280px, 85vw))";
const POPUP_PADDING = "16px 18px";
const POPUP_BORDER_WIDTH = "4px";
const POPUP_RADIUS = "12px";
const POPUP_FONT = "system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
const POPUP_FONT_SIZE = "15px";
const POPUP_BUTTON_FONT_SIZE = "14px";
const POPUP_BUTTON_PADDING = "14px 16px";
const POPUP_LINE_HEIGHT = "1.45";

function cardBaseStyle(): string {
  return [
    `width:${POPUP_CARD_WIDTH};box-sizing:border-box;`,
    "background:transparent;",
    `font-family:${POPUP_FONT};font-size:${POPUP_FONT_SIZE};`,
    "overflow:hidden;",
    "transition:opacity 0.2s ease-out, transform 0.2s ease-out;",
  ].join(" ");
}

function messageBlockStyle(): string {
  return [
    `padding:${POPUP_PADDING};margin:0;background:transparent;`,
    `border:${POPUP_BORDER_WIDTH} solid ${POPUP_CONTRAST_VAR};border-bottom-width:0;`,
    `border-radius:${POPUP_RADIUS} ${POPUP_RADIUS} 0 0;`,
    `line-height:${POPUP_LINE_HEIGHT};color:${POPUP_CONTRAST_VAR};`,
  ].join(" ");
}

function buttonStyle(radius: string): string {
  return [
    `padding:${POPUP_BUTTON_PADDING};background:transparent;`,
    `border:${POPUP_BORDER_WIDTH} solid ${POPUP_CONTRAST_VAR};`,
    `border-radius:${radius};`,
    `font:inherit;font-size:${POPUP_BUTTON_FONT_SIZE};cursor:pointer;color:${POPUP_CONTRAST_VAR};`,
  ].join(" ");
}

function leftButtonStyle(): string {
  return [
    `flex:1;margin:0;padding:${POPUP_BUTTON_PADDING};background:transparent;`,
    `border:${POPUP_BORDER_WIDTH} solid ${POPUP_CONTRAST_VAR};border-right-width:0;`,
    `border-radius:0 0 0 ${POPUP_RADIUS};`,
    `font:inherit;font-size:${POPUP_BUTTON_FONT_SIZE};cursor:pointer;color:${POPUP_CONTRAST_VAR};`,
  ].join(" ");
}

function rightButtonStyle(): string {
  return [
    `flex:1;margin:0;padding:${POPUP_BUTTON_PADDING};background:transparent;`,
    `border:${POPUP_BORDER_WIDTH} solid ${POPUP_CONTRAST_VAR};border-left-width:0;`,
    `border-radius:0 0 ${POPUP_RADIUS} 0;`,
    `font:inherit;font-size:${POPUP_BUTTON_FONT_SIZE};cursor:pointer;color:${POPUP_CONTRAST_VAR};`,
  ].join(" ");
}

/** Style for a button inside custom card content (uses currentColor to match card). */
export function getCustomCardButtonStyle(): string {
  return [
    `padding:${POPUP_BUTTON_PADDING};background:transparent;margin:0;`,
    `border:${POPUP_BORDER_WIDTH} solid currentColor;`,
    `border-radius:${POPUP_RADIUS};`,
    `font:inherit;font-size:${POPUP_BUTTON_FONT_SIZE};cursor:pointer;color:inherit;`,
  ].join(" ");
}

/** Full-width bottom button for custom card (matches one-button modal structure). Use as last element in content. */
export function getCustomCardPrimaryButtonStyle(): string {
  return [
    `width:100%;margin:0;padding:${POPUP_BUTTON_PADDING};background:transparent;`,
    `border:${POPUP_BORDER_WIDTH} solid currentColor;border-top-width:0;`,
    `border-radius:0 0 ${POPUP_RADIUS} ${POPUP_RADIUS};`,
    `font:inherit;font-size:${POPUP_BUTTON_FONT_SIZE};cursor:pointer;color:inherit;`,
  ].join(" ");
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

  const card = document.createElement("div");
  card.dataset.popupType = type;
  card.style.cssText = cardBaseStyle();

  const messageBlock = document.createElement("div");
  messageBlock.textContent = message;
  messageBlock.style.cssText = messageBlockStyle();

  const buttonsRow = document.createElement("div");
  buttonsRow.style.cssText = "display:flex;margin:0;";

  const leftBtn = document.createElement("button");
  leftBtn.type = "button";
  leftBtn.textContent = leftLabel;
  leftBtn.style.cssText = leftButtonStyle();
  leftBtn.addEventListener("click", () => onLeftClick?.());

  const rightBtn = document.createElement("button");
  rightBtn.type = "button";
  rightBtn.textContent = rightLabel;
  rightBtn.style.cssText = rightButtonStyle();
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

  const card = document.createElement("div");
  card.dataset.popupType = type;
  card.style.cssText = cardBaseStyle();

  const messageBlock = document.createElement("div");
  messageBlock.textContent = message;
  messageBlock.style.cssText = messageBlockStyle();

  const primaryBtn = document.createElement("button");
  primaryBtn.type = "button";
  primaryBtn.textContent = primaryLabel;
  primaryBtn.style.cssText = [
    "width:100%;margin:0;",
    buttonStyle(`0 0 ${POPUP_RADIUS} ${POPUP_RADIUS}`),
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

export interface CustomCardOptions {
  type: string;
  /** Card body (message area only). Do not include the primary button here. */
  content: HTMLElement;
  /** Optional full-width bottom button (e.g. Close). Apply getCustomCardPrimaryButtonStyle() before passing. Appended to card outside the padded content so it aligns with one-button modal. */
  primaryButton?: HTMLElement;
}

/**
 * Push a custom card to the popup stack. Same width, structure, and color as other modals.
 * Content is wrapped in a message-style block (top rounded, no bottom border). If primaryButton
 * is provided, it is appended to the card as a sibling (full-width, no content padding).
 */
export function showCustomCard(options: CustomCardOptions): { dismiss: () => void } {
  const { type, content, primaryButton } = options;
  const stack = getStack();

  const card = document.createElement("div");
  card.dataset.popupType = type;
  card.style.cssText = cardBaseStyle();

  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    messageBlockStyle(),
    "display:flex;flex-direction:column;gap:12px;",
    "width:100%;box-sizing:border-box;",
  ].join(" ");
  wrapper.appendChild(content);
  card.appendChild(wrapper);
  if (primaryButton) {
    primaryButton.style.cssText = [
      "width:100%;margin:0;",
      "padding:" + POPUP_BUTTON_PADDING + ";background:transparent;",
      "border:" + POPUP_BORDER_WIDTH + " solid " + POPUP_CONTRAST_VAR + ";",
      "border-radius:0 0 " + POPUP_RADIUS + " " + POPUP_RADIUS + ";",
      "font:inherit;font-size:" + POPUP_BUTTON_FONT_SIZE + ";cursor:pointer;color:" + POPUP_CONTRAST_VAR + ";",
    ].join(" ");
    card.appendChild(primaryButton);
  }

  let dismissed = false;
  function dismiss(): void {
    if (dismissed) return;
    dismissed = true;
    removePopup(entry);
  }

  const entry: PopupEntry = { type, element: card, dismiss };
  popups.push(entry);
  stack.appendChild(card);
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
