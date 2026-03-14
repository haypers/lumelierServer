export interface EditorPageMarkupIcons {
  circleCheck: string;
  play: string;
  pause: string;
  reset: string;
  tree: string;
  loading: string;
}

export interface EditorPageMarkupMessages {
  notLive: string;
  live: string;
}

/** Returns the innerHTML string for the main editor page (toolbar + container + mount + empty state). */
export function getEditorPageMarkup(
  icons: EditorPageMarkupIcons,
  messages: EditorPageMarkupMessages
): string {
  return `
    <div class="editor-page">
      <div class="editor-page-body editor-page-body--details-hidden">
        <div class="editor-timeline-wrap">
          <div class="editor-empty-state" id="editor-empty-state">
            <p class="editor-empty-state-message">Loading…</p>
          </div>
          <div class="editor-content editor-content--hidden">
            <div class="editor-toolbar">
              <div class="editor-toolbar-left">
                <div class="editor-toolbar-left-edit" id="editor-toolbar-left-edit">
                  <div class="editor-save-status-wrap">
                    <span class="editor-autosave" id="editor-autosave"><span class="editor-autosave-icon">${icons.circleCheck}</span><span>Saved</span></span>
                  </div>
                </div>
                <p class="editor-live-status-message" id="editor-live-status-message">${messages.notLive}</p>
              </div>
              <div class="editor-toolbar-spacer" id="editor-toolbar-spacer"></div>
              <div class="editor-toolbar-center" id="editor-toolbar-center" hidden>
                <button type="button" class="btn btn-icon-only" data-action="restart" aria-label="Restart from beginning">${icons.reset}</button>
                <button type="button" class="btn btn-icon-only" data-action="play" aria-label="Play">${icons.play}</button>
                <button type="button" class="btn btn-icon-only" data-action="pause" aria-label="Pause">${icons.pause}</button>
              </div>
              <div class="editor-toolbar-right" id="editor-toolbar-right">
                <button type="button" class="btn btn-icon-label" data-action="split-devices-tracks" aria-label="Split Devices Into Tracks">${icons.tree}Split Devices Into Tracks</button>
                <button type="button" class="btn btn-primary" data-action="import-from-video">Import from video</button>
                <button type="button" class="btn btn-primary" data-action="add-range">Add Range</button>
                <button type="button" class="btn btn-primary" data-action="add-event">Add event</button>
                <button type="button" class="btn btn-danger" data-action="remove-item">Remove selected</button>
              </div>
            </div>
            <div class="editor-container-wrap">
              <div class="editor-loading editor-loading--hidden" id="editor-loading" aria-hidden="true">
                <span class="editor-loading-icon">${icons.loading}</span>
              </div>
              <div id="editor-timeline-mount"></div>
            </div>
          </div>
        </div>
        <div class="editor-bottom-row" id="editor-bottom-row">
          <!-- Filled by JS with resizable split (details | preview) -->
        </div>
      </div>
    </div>
  `;
}
