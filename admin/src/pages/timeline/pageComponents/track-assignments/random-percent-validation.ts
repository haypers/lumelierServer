/**
 * Validation and styling for % inputs under "Split Devices Randomly" parents.
 * - Sum of sibling % inputs must equal 100; otherwise inputs get a light red border.
 * - Any value not greater than 0 is invalid (that path can never trigger); 0 gets the same light red.
 * - On focus: darker red if invalid, light blue if valid. On blur: reset to light red or default.
 * - Save is disabled while any percent group is invalid (sum !== 100 or any value <= 0).
 */

const CLASS_INVALID = "track-assignments-percent-input--invalid";
const CLASS_INVALID_FOCUSED = "track-assignments-percent-input--invalid-focused";
const CLASS_VALID_SIBLING_FOCUSED = "track-assignments-percent-input--valid-sibling-focused";
const CLASS_VALID_FOCUSED = "track-assignments-percent-input--valid-focused";

const SIBLING_DOT_COLORS = [
  "orange",
  "lime",
  "purple",
  "magenta",
  "yellow",
  "green",
  "#7dd3fc",
  "red",
  "gray",
  "brown",
  "#1e40af",
];

/** Returns the row wrapper that is the "Split Devices Randomly" parent, or null if this input is not under one. */
function getParentRandomRowWrapper(percentInput: HTMLElement): Element | null {
  const rowWrapper = percentInput.closest(".track-assignments-row-wrapper");
  if (!rowWrapper) return null;
  const childrenContainer = rowWrapper.parentElement;
  if (
    !childrenContainer ||
    !childrenContainer.classList.contains("track-assignments-children-container")
  ) {
    return null;
  }
  return childrenContainer.parentElement;
}

/** Returns all percent inputs that are direct children of the same "Split Devices Randomly" parent. */
function getSiblingPercentInputs(percentInput: HTMLElement): HTMLInputElement[] {
  const parent = getParentRandomRowWrapper(percentInput);
  if (!parent) return [];
  const childrenContainer = parent.querySelector(":scope > .track-assignments-children-container");
  if (!childrenContainer) return [];
  const inputs: HTMLInputElement[] = [];
  childrenContainer
    .querySelectorAll(":scope > .track-assignments-row-wrapper:not(.track-assignments-add-branch-row)")
    .forEach((wrapper) => {
      const input = wrapper.querySelector(".track-assignments-percent-input") as HTMLInputElement | null;
      if (input) inputs.push(input);
    });
  return inputs;
}

function parsePercentInputValue(input: HTMLInputElement): number {
  const n = Number(input.value);
  return Number.isFinite(n) ? n : 0;
}

function getSum(inputs: HTMLInputElement[]): number {
  return inputs.reduce((s, el) => s + parsePercentInputValue(el), 0);
}

/** Returns true if the container has any percent group that is invalid (sum !== 100 or any value <= 0). */
export function hasInvalidPercentGroups(container: HTMLElement): boolean {
  return container.querySelector(`.${CLASS_INVALID}`) != null;
}

function getDotForPercentInput(input: HTMLInputElement): HTMLElement | null {
  const wrapper = input.closest(".track-assignments-row-wrapper");
  return wrapper?.querySelector(".track-assignments-dot") as HTMLElement | null;
}

function setSiblingDotColors(focusedInput: HTMLInputElement): void {
  const siblings = getSiblingPercentInputs(focusedInput);
  siblings.forEach((input, index) => {
    const dot = getDotForPercentInput(input);
    if (dot) {
      dot.style.backgroundColor = SIBLING_DOT_COLORS[index % SIBLING_DOT_COLORS.length];
    }
  });
}

function clearSiblingDotColors(blurredInput: HTMLInputElement): void {
  const siblings = getSiblingPercentInputs(blurredInput);
  siblings.forEach((input) => {
    const dot = getDotForPercentInput(input);
    if (dot) dot.style.backgroundColor = "";
  });
}

function isGroupInvalid(inputs: HTMLInputElement[]): boolean {
  if (inputs.length === 0) return false;
  const sum = getSum(inputs);
  if (sum !== 100) return true;
  return inputs.some((input) => parsePercentInputValue(input) <= 0);
}

/** Update invalid/valid border state for all inputs in the same random parent group. Sum !== 100 highlights all; value <= 0 highlights only that input. */
function updateGroupValidation(parentRowWrapper: Element, focusedInput: HTMLInputElement | null = null): void {
  const childrenContainer = parentRowWrapper.querySelector(
    ":scope > .track-assignments-children-container"
  );
  if (!childrenContainer) return;
  const inputs = getSiblingPercentInputs(
    childrenContainer.querySelector(".track-assignments-percent-input") as HTMLElement
  );
  if (inputs.length === 0) return;
  const sum = getSum(inputs);
  const sumInvalid = sum !== 100;
  inputs.forEach((input) => {
    const zeroOrLess = parsePercentInputValue(input) <= 0;
    const invalid = sumInvalid || zeroOrLess;
    if (invalid) {
      input.classList.add(CLASS_INVALID);
    } else {
      input.classList.remove(CLASS_INVALID);
      if (input !== focusedInput) {
        input.classList.remove(CLASS_INVALID_FOCUSED);
      }
    }
  });
}

/** Apply focus styling for the whole group: when valid, all get light blue and focused gets darker blue; when invalid, only focused gets brighter red. */
function applyFocusStyles(focusedInput: HTMLInputElement): void {
  const siblings = getSiblingPercentInputs(focusedInput);
  if (siblings.length === 0) return;
  const invalid = isGroupInvalid(siblings);
  siblings.forEach((input) => {
    input.classList.remove(CLASS_VALID_SIBLING_FOCUSED, CLASS_VALID_FOCUSED, CLASS_INVALID_FOCUSED);
  });
  if (invalid) {
    focusedInput.classList.add(CLASS_INVALID_FOCUSED);
  } else {
    siblings.forEach((input) => input.classList.add(CLASS_VALID_SIBLING_FOCUSED));
    focusedInput.classList.add(CLASS_VALID_FOCUSED);
  }
}

/** Remove focus-only styles from all siblings (call on blur). */
function clearFocusStyles(blurredInput: HTMLInputElement): void {
  const siblings = getSiblingPercentInputs(blurredInput);
  siblings.forEach((input) => {
    input.classList.remove(CLASS_VALID_SIBLING_FOCUSED, CLASS_VALID_FOCUSED, CLASS_INVALID_FOCUSED);
  });
}

function handleInputOrChange(percentInput: HTMLElement, onValidationChange?: (container: HTMLElement) => void): void {
  const container = percentInput.closest(".track-assignments-hierarchy-viewer") as HTMLElement | null;
  const parent = getParentRandomRowWrapper(percentInput);
  if (!parent) return;
  const focused = document.activeElement === percentInput ? (percentInput as HTMLInputElement) : null;
  updateGroupValidation(parent, focused);
  if (focused) applyFocusStyles(focused);
  if (container && onValidationChange) onValidationChange(container);
}

function handleFocus(percentInput: HTMLElement): void {
  const el = percentInput as HTMLInputElement;
  applyFocusStyles(el);
  setSiblingDotColors(el);
}

function handleBlur(percentInput: HTMLElement, onValidationChange?: (container: HTMLElement) => void): void {
  const el = percentInput as HTMLInputElement;
  clearFocusStyles(el);
  clearSiblingDotColors(el);
  const parent = getParentRandomRowWrapper(percentInput);
  if (parent) updateGroupValidation(parent, null);
  const container = percentInput.closest(".track-assignments-hierarchy-viewer") as HTMLElement | null;
  if (container && onValidationChange) onValidationChange(container);
}

/**
 * Attach validation and focus/blur styling to all percent inputs under "Split Devices Randomly" parents.
 * Call after the hierarchy DOM is rendered (e.g. at the end of renderTrackAssignmentsHierarchy).
 */
function preventArrowKeyNumberChange(e: KeyboardEvent): void {
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
  }
}

export function attachRandomPercentValidation(
  container: HTMLElement,
  onValidationChange?: (container: HTMLElement) => void
): void {
  const inputs = container.querySelectorAll(".track-assignments-percent-input");
  const processedParents = new Set<Element>();
  inputs.forEach((input) => {
    const el = input as HTMLInputElement;
    const parent = getParentRandomRowWrapper(el);
    if (!parent) return;
    if (!processedParents.has(parent)) {
      processedParents.add(parent);
      updateGroupValidation(parent);
    }
    el.addEventListener("keydown", preventArrowKeyNumberChange);
    el.addEventListener("input", () => handleInputOrChange(el, onValidationChange));
    el.addEventListener("change", () => handleInputOrChange(el, onValidationChange));
    el.addEventListener("focus", () => handleFocus(el));
    el.addEventListener("blur", () => handleBlur(el, onValidationChange));
  });
  if (onValidationChange) onValidationChange(container);
}
