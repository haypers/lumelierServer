import "./styles.css";
import { createInfoBubble } from "../info-bubble";

export type ModalSize = "large" | "medium" | "small";

export type ModalActionButton =
  | { preset: "save"; label?: string; onClick: () => void }
  | { preset: "share"; label?: string; onClick: () => void }
  | { preset: "delete"; label: string; onClick: () => void }
  | { preset: "primary"; label: string; onClick: () => void }
  | { preset: "secondary"; label: string; onClick: () => void };

export interface OpenModalOptions {
  size: ModalSize;
  clickOutsideToClose: boolean;
  title?: string;
  info?: string;
  content: HTMLElement;
  cancel?: { label?: string };
  actions?: ModalActionButton[];
  /** Called when the modal is closed (Cancel, backdrop, Escape). */
  onClose?: () => void;
}

const TITLE_ID = "global-modal-title";

function createPanel(options: OpenModalOptions): { backdrop: HTMLElement; panel: HTMLElement } {
  const { size, title, info, content, cancel, actions } = options;
  const backdrop = document.createElement("div");
  backdrop.className = "global-modal-backdrop";
  backdrop.setAttribute("aria-hidden", "false");

  const panel = document.createElement("div");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.className = `global-modal-panel global-modal-panel--${size}`;
  if (title) {
    panel.setAttribute("aria-labelledby", TITLE_ID);
  }

  if (title) {
    const header = document.createElement("div");
    header.className = "global-modal-header";
    const h2 = document.createElement("h2");
    h2.id = TITLE_ID;
    h2.textContent = title;
    header.appendChild(h2);
    if (info) {
      header.appendChild(createInfoBubble({ tooltipText: info }));
    }
    panel.appendChild(header);
  }

  const contentWrap = document.createElement("div");
  contentWrap.className = "global-modal-content";
  contentWrap.appendChild(content);
  panel.appendChild(contentWrap);

  const hasFooter = cancel != null || (actions != null && actions.length > 0);
  if (hasFooter) {
    const footer = document.createElement("div");
    footer.className = "global-modal-footer";
    const left = document.createElement("div");
    left.className = "global-modal-footer-left";
    const right = document.createElement("div");
    right.className = "global-modal-footer-right";
    if (cancel != null) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "global-modal-btn global-modal-btn-cancel";
      cancelBtn.textContent = cancel.label ?? "Cancel";
      left.appendChild(cancelBtn);
    }
    if (actions != null && actions.length > 0) {
      actions.forEach((a) => {
        const btn = document.createElement("button");
        btn.type = "button";
        if (a.preset === "delete") {
          btn.className = "global-modal-btn global-modal-btn-danger";
          btn.textContent = a.label;
        } else if (a.preset === "secondary") {
          btn.className = "global-modal-btn global-modal-btn-secondary";
          btn.textContent = a.label;
        } else {
          btn.className = "global-modal-btn global-modal-btn-primary";
          btn.textContent =
            a.preset === "save"
              ? a.label ?? "Save"
              : a.preset === "share"
                ? a.label ?? "Share"
                : a.label;
        }
        btn.addEventListener("click", () => a.onClick());
        right.appendChild(btn);
      });
    }
    footer.appendChild(left);
    footer.appendChild(right);
    panel.appendChild(footer);
  }

  backdrop.appendChild(panel);
  return { backdrop, panel };
}

export function openModal(options: OpenModalOptions): { close: () => void } {
  const { clickOutsideToClose, onClose } = options;
  const { backdrop, panel } = createPanel(options);

  function close(): void {
    onClose?.();
    backdrop.remove();
    document.removeEventListener("keydown", onEscape);
  }

  const cancelBtn = backdrop.querySelector(".global-modal-btn-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", close);
  }

  const onEscape = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onEscape);

  if (clickOutsideToClose) {
    backdrop.addEventListener("click", (e: MouseEvent) => {
      if (e.target === backdrop) close();
    });
  }

  panel.addEventListener("click", (e) => e.stopPropagation());

  document.body.appendChild(backdrop);
  return { close };
}
