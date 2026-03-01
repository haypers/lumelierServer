import "./styles.css";
import downloadIcon from "../../icons/download.svg?raw";
import copyIcon from "../../icons/copy.svg?raw";
import newtabIcon from "../../icons/newtab.svg?raw";
import QRCode from "qrcode";

const SESSION_MANAGER_EMPTY_MESSAGE =
  "Please open or create a show to manage attendee access.";

const ATTENDEE_ACCESS_NOT_LIVE_MESSAGE =
  "Set this show to Live to generate the client join URL";

interface LiveJoinUrlResponse {
  live: boolean;
  url?: string;
}

const LIVE_STATE_EVENT_NAME = "lumelier-live-state";

async function fetchLiveJoinUrl(showId: string): Promise<LiveJoinUrlResponse> {
  const res = await fetch(`/api/admin/show-workspaces/${showId}/live-join-url`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<LiveJoinUrlResponse>;
}

/** Draw QR code for `url` into the canvas. Size is relative to viewport for responsiveness. */
function drawQrToCanvas(canvas: HTMLCanvasElement, url: string): void {
  const size = Math.min(
    512,
    Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.45)
  );
  canvas.width = size;
  canvas.height = size;
  QRCode.toCanvas(
    canvas,
    url,
    {
      width: size,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    },
    (err: Error | null | undefined) => {
      if (err) console.error("QRCode.toCanvas failed:", err);
    }
  );
}

/** Trigger download of the QR code canvas as a PNG image. */
function downloadQrAsImage(
  canvas: HTMLCanvasElement,
  filename = "attendee-join-qr.png"
): void {
  const dataUrl = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function renderLiveState(container: HTMLElement, data: LiveJoinUrlResponse): void {
  const block = container.querySelector(".attendee-access-live-block") as HTMLElement | null;
  if (!block) return;

  const urlEl = block.querySelector(".attendee-access-url-row") as HTMLAnchorElement | null;
  const urlTextEl = block.querySelector(".attendee-access-url-text") as HTMLElement | null;
  const notLiveWrap = block.querySelector(".attendee-access-not-live-wrap") as HTMLElement | null;
  const canvas = block.querySelector(".attendee-access-qr-canvas") as HTMLCanvasElement | null;
  const btnDownload = block.querySelector(".attendee-access-btn-download") as HTMLButtonElement | null;
  const btnCopy = block.querySelector(".attendee-access-btn-copy") as HTMLButtonElement | null;

  if (data.live && data.url) {
    block.dataset.live = "true";
    if (urlEl) urlEl.href = data.url;
    if (urlTextEl) urlTextEl.textContent = data.url ?? "";
    if (notLiveWrap) notLiveWrap.hidden = true;

    if (canvas && data.url) {
      drawQrToCanvas(canvas, data.url);
    }

    if (btnDownload && canvas) {
      btnDownload.onclick = () => downloadQrAsImage(canvas);
    }

    if (btnCopy && data.url) {
      btnCopy.onclick = () => {
        navigator.clipboard.writeText(data.url!).catch((err) => {
          console.error("Copy failed:", err);
        });
      };
    }
  } else {
    block.dataset.live = "false";
    if (urlEl) urlEl.removeAttribute("href");
    if (urlTextEl) urlTextEl.textContent = "";
    if (notLiveWrap) {
      notLiveWrap.hidden = false;
      const msg = notLiveWrap.querySelector(".show-required-empty-state-message");
      if (msg) msg.textContent = ATTENDEE_ACCESS_NOT_LIVE_MESSAGE;
    }
    if (btnDownload) btnDownload.onclick = null;
    if (btnCopy) btnCopy.onclick = null;
  }
}

/** Refreshes the page content from the server and re-renders. Called when live state changes (custom event or initial load). */
function refreshLiveState(container: HTMLElement, showId: string): void {
  fetchLiveJoinUrl(showId)
    .then((data) => renderLiveState(container, data))
    .catch(() => {
      const block = container.querySelector(".attendee-access-live-block") as HTMLElement | null;
      if (block) block.dataset.live = "false";
      const notLiveWrap = container.querySelector(".attendee-access-not-live-wrap");
      if (notLiveWrap) {
        (notLiveWrap as HTMLElement).hidden = false;
        const msg = notLiveWrap.querySelector(".show-required-empty-state-message");
        if (msg) msg.textContent = ATTENDEE_ACCESS_NOT_LIVE_MESSAGE;
      }
    });
}

let liveStateListener: ((e: Event) => void) | null = null;

export function render(container: HTMLElement, showId: string | null): void {
  // Remove previous live-state listener so we don't double-subscribe or react to wrong show.
  if (liveStateListener) {
    window.removeEventListener(LIVE_STATE_EVENT_NAME, liveStateListener);
    liveStateListener = null;
  }

  if (showId === null) {
    container.innerHTML = `
      <div class="show-required-empty-state">
        <p class="show-required-empty-state-message">${SESSION_MANAGER_EMPTY_MESSAGE}</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="attendee-access-page attendee-access-live-block" data-live="false">
      <div class="attendee-access-button-row">
        <button type="button" class="devices-toolbar-btn attendee-access-btn-download">
          <span class="icon-wrap">${downloadIcon}</span>
          <span>Download QR Code Image</span>
        </button>
        <button type="button" class="devices-toolbar-btn attendee-access-btn-copy">
          <span class="icon-wrap">${copyIcon}</span>
          <span>Copy URL</span>
        </button>
      </div>
      <a class="attendee-access-url-row attendee-access-url-link" href="#" target="_blank" rel="noopener noreferrer">
        <span class="attendee-access-url-text"></span>
        <span class="newtab-icon-wrap">${newtabIcon}</span>
      </a>
      <div class="attendee-access-qr-wrap">
        <canvas class="attendee-access-qr-canvas" width="256" height="256"></canvas>
      </div>
      <div class="attendee-access-not-live-wrap show-required-empty-state">
        <p class="show-required-empty-state-message">${ATTENDEE_ACCESS_NOT_LIVE_MESSAGE}</p>
      </div>
    </div>`;

  // Subscribe to live-state changes so we update when the user (or another tab) goes live or ends live.
  liveStateListener = (e: Event) => {
    const ev = e as CustomEvent<{ showId: string; live: boolean }>;
    const detail = ev.detail;
    if (detail?.showId !== showId) return;
    refreshLiveState(container, showId);
  };
  window.addEventListener(LIVE_STATE_EVENT_NAME, liveStateListener);

  refreshLiveState(container, showId);
}
