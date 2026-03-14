/**
 * Returns the innerHTML string for the simulate-devices page layout.
 */

export interface SimulateDevicesMarkupOptions {
  squareSizePx: number;
  squareSizeMin: number;
  squareSizeMax: number;
  openIcon: string;
  trashIcon: string;
  noSignalIcon: string;
}

export function getSimulateDevicesMarkup(options: SimulateDevicesMarkupOptions): string {
  const { squareSizePx, squareSizeMin, squareSizeMax, openIcon, trashIcon, noSignalIcon } = options;
  return `
    <div class="simulate-devices-page">
      <div class="simulate-devices-body">
        <div class="simulate-devices-client-array-panel" id="simulate-devices-grid-panel">
          <div class="simulate-devices-toolbar">
            <span id="simulate-devices-clock-error-wrap" class="simulate-devices-clock-error-wrap"></span>
            <button type="button" class="devices-toolbar-btn devices-toolbar-btn-icon" id="simulate-devices-create">${openIcon}<span>Create Clients</span></button>
            <button type="button" class="devices-toolbar-btn devices-toolbar-btn-danger" id="simulate-devices-destroy">Destroy all Clients</button>
            <span class="simulate-devices-square-size-wrap">
              <label for="simulate-devices-square-size" class="simulate-devices-toolbar-label">Square size</label>
              <input type="range" id="simulate-devices-square-size" min="${squareSizeMin}" max="${squareSizeMax}" value="${squareSizePx}" />
              <span id="simulate-devices-square-size-value">${squareSizePx} px</span>
            </span>
            <button type="button" class="devices-toolbar-btn" id="simulate-devices-lag-overlay-toggle"><span id="simulate-devices-lag-overlay-toggle-label">Hide </span><span class="simulate-devices-lag-overlay-toggle-icon">${noSignalIcon}</span></button>
          </div>
          <div class="simulate-devices-toolbar-secondary" id="simulate-devices-toolbar-secondary" hidden>
            <button type="button" class="btn btn-danger" id="simulate-devices-delete">${trashIcon}<span>Delete Client</span></button>
            <button type="button" class="btn btn-icon-label" id="simulate-devices-clone">Clone Client</button>
          </div>
          <div class="simulate-devices-grid-panel-inner">
            <div class="simulate-devices-grid-area" id="simulate-devices-grid-area"></div>
            <div class="simulate-devices-grid-pagination" id="simulate-devices-grid-pagination">
              <span id="simulate-devices-page-info">Page 1 of 1</span>
              <button type="button" id="simulate-devices-page-prev">Prev</button>
              <button type="button" id="simulate-devices-page-next">Next</button>
            </div>
          </div>
        </div>
        <section class="simulate-devices-details-section" aria-label="Client details">
          <div class="simulate-devices-details-refresh-wrap" id="simulate-devices-details-refresh-wrap"></div>
          <div id="simulate-devices-details-pane"></div>
        </section>
      </div>
    </div>
  `;
}
