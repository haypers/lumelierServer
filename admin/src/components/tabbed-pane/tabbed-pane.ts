/**
 * Reusable tabbed pane: tab row + content area; selected tab persisted in localStorage.
 */

import "./styles.css";

export interface TabbedPaneTab {
  id: string;
  label: string;
  getContent: () => HTMLElement;
}

export interface TabbedPaneOptions {
  tabs: TabbedPaneTab[];
  storageKey: string;
}

export interface TabbedPaneResult {
  container: HTMLElement;
  showTab: (id: string) => void;
}

function loadStoredTab(key: string, tabIds: string[]): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v == null || v === "") return null;
    return tabIds.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function saveTab(key: string, id: string): void {
  try {
    localStorage.setItem(key, id);
  } catch {
    /* ignore */
  }
}

export function createTabbedPane(options: TabbedPaneOptions): TabbedPaneResult {
  const { tabs, storageKey } = options;
  if (tabs.length === 0) {
    const container = document.createElement("div");
    container.className = "tabbed-pane";
    return { container, showTab: () => {} };
  }

  const tabIds = tabs.map((t) => t.id);
  const storedId = loadStoredTab(storageKey, tabIds);
  const initialId = storedId ?? tabIds[0]!;

  const container = document.createElement("div");
  container.className = "tabbed-pane";

  const tabRow = document.createElement("div");
  tabRow.className = "tabbed-pane__tabs";
  tabRow.setAttribute("role", "tablist");

  const contentWrap = document.createElement("div");
  contentWrap.className = "tabbed-pane__content";

  const tabButtons: HTMLElement[] = [];
  const contentPanels: HTMLElement[] = [];

  tabs.forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tabbed-pane__tab";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.setAttribute("aria-controls", `tabbed-pane-panel-${tab.id}`);
    button.id = `tabbed-pane-tab-${tab.id}`;
    button.textContent = tab.label;
    tabButtons.push(button);
    tabRow.appendChild(button);

    const panel = document.createElement("div");
    panel.className = "tabbed-pane__panel";
    panel.id = `tabbed-pane-panel-${tab.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    panel.hidden = true;
    const content = tab.getContent();
    content.className = (content.className || "").trim() + " tabbed-pane__panel-inner";
    panel.appendChild(content);
    contentPanels.push(panel);
    contentWrap.appendChild(panel);
  });

  container.appendChild(tabRow);
  container.appendChild(contentWrap);

  function showTab(id: string): void {
    const idx = tabIds.indexOf(id);
    if (idx < 0) return;
    tabButtons.forEach((btn, i) => {
      const isSelected = i === idx;
      btn.classList.toggle("tabbed-pane__tab--selected", isSelected);
      btn.setAttribute("aria-selected", String(isSelected));
    });
    contentPanels.forEach((panel, i) => {
      panel.hidden = i !== idx;
    });
    saveTab(storageKey, id);
  }

  tabButtons.forEach((button, i) => {
    button.addEventListener("click", () => showTab(tabIds[i]!));
  });

  showTab(initialId);

  return { container, showTab };
}
