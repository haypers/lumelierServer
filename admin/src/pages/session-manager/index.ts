const SESSION_MANAGER_EMPTY_MESSAGE =
  "Please open or create a show to manage attendee access.";

interface LiveJoinUrlResponse {
  live: boolean;
  url?: string;
}

async function fetchLiveJoinUrl(showId: string): Promise<LiveJoinUrlResponse> {
  const res = await fetch(`/api/admin/show-workspaces/${showId}/live-join-url`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<LiveJoinUrlResponse>;
}

function renderLiveState(container: HTMLElement, data: LiveJoinUrlResponse): void {
  const block = container.querySelector(".attendee-access-live-block");
  if (!block) return;
  const urlEl = block.querySelector(".attendee-access-url");
  const notLiveEl = block.querySelector(".attendee-access-not-live");
  if (data.live && data.url) {
    if (urlEl) {
      (urlEl as HTMLAnchorElement).href = data.url;
      (urlEl as HTMLAnchorElement).textContent = data.url;
      (urlEl as HTMLElement).hidden = false;
    }
    if (notLiveEl) (notLiveEl as HTMLElement).hidden = true;
  } else {
    if (urlEl) (urlEl as HTMLElement).hidden = true;
    if (notLiveEl) (notLiveEl as HTMLElement).hidden = false;
  }
}

export function render(container: HTMLElement, showId: string | null): void {
  if (showId === null) {
    container.innerHTML = `
      <div class="show-required-empty-state">
        <p class="show-required-empty-state-message">${SESSION_MANAGER_EMPTY_MESSAGE}</p>
      </div>`;
    return;
  }
  container.innerHTML = `
    <div class="attendee-access-live-block">
      <p class="attendee-access-label">Join URL for attendees (when this show is live):</p>
      <a class="attendee-access-url" href="#" target="_blank" rel="noopener noreferrer" hidden></a>
      <p class="attendee-access-not-live" style="color:var(--text-muted);" hidden>Not live</p>
    </div>`;
  fetchLiveJoinUrl(showId)
    .then((data) => renderLiveState(container, data))
    .catch(() => {
      const notLiveEl = container.querySelector(".attendee-access-not-live");
      if (notLiveEl) {
        (notLiveEl as HTMLElement).hidden = false;
        (notLiveEl as HTMLElement).textContent = "Not live";
      }
      const urlEl = container.querySelector(".attendee-access-url");
      if (urlEl) (urlEl as HTMLElement).hidden = true;
    });
}
