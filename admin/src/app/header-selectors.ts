/**
 * Centralized IDs and class selectors for the admin header and related modals.
 * Use these instead of string literals to avoid typos and simplify renames.
 */
export const HEADER_SELECTORS = {
  /* Header element IDs */
  menuBtn: "menu-btn",
  menuDropdown: "menu-dropdown",
  accountDropdown: "account-dropdown",
  accountBtn: "account-btn",
  accountLogoutBtn: "account-logout-btn",
  newShowBtn: "new-show-btn",
  openSavedShowBtn: "open-saved-show-btn",
  defaultShowsBtn: "default-shows-btn",
  defaultShowsDropdown: "default-shows-dropdown",
  showNameDropdownBtn: "show-name-dropdown-btn",
  showNameDropdown: "show-name-dropdown",
  showStatusBtn: "show-status-btn",
  showStatusDropdown: "show-status-dropdown",
  pageHeaderExtra: "page-header-extra",
  adminContent: "admin-content",

  /* Modal content IDs */
  newShowNameInput: "new-show-name-input",
  newShowError: "new-show-error",
  openShowGrid: "open-show-grid",
  openShowError: "open-show-error",
  shareShowHint: "share-show-hint",
  deleteShowMembersList: "delete-show-members-list",
  deleteShowConfirmInput: "delete-show-confirm-input",
  deleteShowError: "delete-show-error",

  /* Class selectors (for querySelector / querySelectorAll) */
  menuDropdownItemLink: ".menu-dropdown-item-link",
  menuDropdownNewtabBtn: ".menu-dropdown-newtab-btn",
  menuDropdownItem: ".menu-dropdown-item",
  adminHeaderShowNameMenuItem: ".admin-header-show-name-menu-item",
  adminHeaderStatusTag: ".admin-header-status-tag",
  adminHeaderStatusCaret: ".admin-header-status-caret",
  openShowTile: ".open-show-tile",
  globalModalPanel: ".global-modal-panel",
  globalModalFooterRightButton: ".global-modal-footer-right button",
  dataTemplate: "[data-template]",
} as const;
