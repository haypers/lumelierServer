const DASHBOARD_EMPTY_MESSAGE =
  "Please open or create a show to view its dashboard.";

export function render(container: HTMLElement, showId: string | null): void {
  if (showId === null) {
    container.innerHTML = `
      <div class="show-required-empty-state">
        <p class="show-required-empty-state-message">${DASHBOARD_EMPTY_MESSAGE}</p>
      </div>`;
    return;
  }
  container.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">Dashboard (placeholder)</p>`;
}
