export interface ActionsDropdownItem {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
}

export interface ActionsDropdownOptions {
  dropdownId: string;
  items: ActionsDropdownItem[];
}

const arrowSvg = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2.5 4.5L6 8l3.5-3.5"/></svg>`;

export function createActionsDropdown(options: ActionsDropdownOptions): {
  root: HTMLElement;
  onAction: (id: string, callback: () => void) => void;
} {
  const { dropdownId, items } = options;
  const callbacks = new Map<string, () => void>();

  const listContent = items
    .map(
      (item) =>
        `<button type="button" class="actions-dropdown-item${item.danger ? " danger" : ""}" data-action-id="${item.id}" role="menuitem">${item.icon ?? ""}<span>${item.label}</span></button>`
    )
    .join("");

  const root = document.createElement("div");
  root.className = "actions-dropdown";
  root.innerHTML = `
    <button type="button" class="actions-dropdown-btn" aria-expanded="false" aria-haspopup="true" aria-controls="${dropdownId}">
      Actions
      <span class="actions-dropdown-arrow" aria-hidden="true">${arrowSvg}</span>
    </button>
    <div id="${dropdownId}" class="actions-dropdown-list" hidden role="menu">
      ${listContent}
    </div>`;

  const btn = root.querySelector(".actions-dropdown-btn") as HTMLButtonElement;
  const list = root.querySelector(`#${dropdownId}`) as HTMLElement;

  function close(): void {
    if (list) {
      list.hidden = true;
      btn?.setAttribute("aria-expanded", "false");
    }
  }

  root.querySelectorAll("[data-action-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).getAttribute("data-action-id");
      close();
      if (id) {
        const cb = callbacks.get(id);
        if (cb) cb();
      }
    });
  });

  if (btn && list) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = !list.hidden;
      list.hidden = isOpen;
      btn.setAttribute("aria-expanded", String(!isOpen));
    });
    list.addEventListener("click", (e) => e.stopPropagation());
  }

  document.addEventListener("click", () => close());

  return {
    root,
    onAction(id: string, callback: () => void) {
      callbacks.set(id, callback);
    },
  };
}
