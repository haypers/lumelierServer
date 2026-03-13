/**
 * Assets tab: upload, list, refresh, and download for TimelineMedia files.
 */

import "./styles.css";
import uploadIcon from "../../../icons/upload.svg?raw";
import refreshIcon from "../../../icons/refresh.svg?raw";
import downloadIcon from "../../../icons/download.svg?raw";

const ACCEPT_ATTR =
  ".mp3,.mp4,.wav,.mov,.aac,.ogg,.png,.jpeg,.jpg,.bmp,.webm,.mkv,.m4v,.avi";

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "aac", "ogg"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "m4v", "avi"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpeg", "jpg", "bmp"]);

function getExtensionKind(ext: string): "audio" | "video" | "image" | null {
  const lower = ext.toLowerCase();
  if (AUDIO_EXTENSIONS.has(lower)) return "audio";
  if (VIDEO_EXTENSIONS.has(lower)) return "video";
  if (IMAGE_EXTENSIONS.has(lower)) return "image";
  return null;
}

interface TimelineMediaFile {
  name: string;
  size_bytes: number;
  /** Duration in seconds for audio/video; absent for images or when unknown. */
  duration_sec?: number;
}

interface TimelineMediaListResponse {
  files: TimelineMediaFile[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(sec: number | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function renderFileList(
  listEl: HTMLElement,
  files: TimelineMediaFile[],
  showId: string
): void {
  for (const file of files) {
    const row = document.createElement("div");
    row.className = "assets-file-row";

    const nameCell = document.createElement("div");
    nameCell.className = "assets-file-name-cell";
    const lastDot = file.name.lastIndexOf(".");
    const baseName = lastDot > 0 ? file.name.slice(0, lastDot) : file.name;
    const ext = lastDot > 0 ? file.name.slice(lastDot) : ""; // includes dot, e.g. ".wav"
    const baseSpan = document.createElement("span");
    baseSpan.className = "assets-file-name-base";
    baseSpan.textContent = baseName;
    nameCell.appendChild(baseSpan);
    if (ext) {
      const kind = getExtensionKind(ext.slice(1));
      if (kind) {
        const pill = document.createElement("span");
        pill.className = `assets-file-extension-pill assets-file-extension-pill--${kind}`;
        pill.textContent = ext;
        nameCell.appendChild(pill);
      } else {
        const pill = document.createElement("span");
        pill.className = "assets-file-extension-pill assets-file-extension-pill--other";
        pill.textContent = ext;
        nameCell.appendChild(pill);
      }
    }

    const statusCell = document.createElement("div");
    statusCell.className = "assets-file-status-cell";
    // Placeholder for future: uploading, saved, loaded locally, etc.

    const durationCell = document.createElement("div");
    durationCell.className = "assets-file-duration-cell";
    durationCell.textContent = formatDuration(file.duration_sec);

    const sizeSpan = document.createElement("span");
    sizeSpan.className = "assets-file-size";
    sizeSpan.textContent = formatSize(file.size_bytes);

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "assets-download-btn";
    downloadBtn.setAttribute("aria-label", `Download ${file.name}`);
    downloadBtn.innerHTML = downloadIcon;
    downloadBtn.addEventListener("click", () => {
      const url = `/api/admin/show-workspaces/${encodeURIComponent(showId)}/timeline-media/${encodeURIComponent(file.name)}`;
      fetch(url, { credentials: "include" })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.blob();
        })
        .then((blob) => {
          const objUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = objUrl;
          a.download = file.name;
          a.click();
          URL.revokeObjectURL(objUrl);
        })
        .catch((e) => console.error("Download failed:", e));
    });

    row.appendChild(nameCell);
    row.appendChild(statusCell);
    row.appendChild(durationCell);
    row.appendChild(sizeSpan);
    row.appendChild(downloadBtn);
    listEl.appendChild(row);
  }
}

function createListHeader(): HTMLElement {
  const row = document.createElement("div");
  row.className = "assets-file-header";
  const name = document.createElement("div");
  name.className = "assets-file-header__name";
  name.textContent = "Name";
  const status = document.createElement("div");
  status.className = "assets-file-header__status";
  status.textContent = "Status";
  const duration = document.createElement("div");
  duration.className = "assets-file-header__duration";
  duration.textContent = "Duration";
  const size = document.createElement("div");
  size.className = "assets-file-header__size";
  size.textContent = "Size";
  const download = document.createElement("div");
  download.className = "assets-file-header__download";
  download.setAttribute("aria-hidden", "true");
  row.appendChild(name);
  row.appendChild(status);
  row.appendChild(duration);
  row.appendChild(size);
  row.appendChild(download);
  return row;
}

export function renderAssetsPanel(container: HTMLElement, showId: string | null): void {
  container.innerHTML = "";
  if (showId === null) {
    const empty = document.createElement("div");
    empty.className = "assets-empty-state";
    empty.textContent = "No show selected";
    container.appendChild(empty);
    return;
  }

  const sid = showId;
  const wrap = document.createElement("div");
  wrap.className = "assets-panel";
  const toolbar = document.createElement("div");
  toolbar.className = "assets-toolbar";
  const listContainer = document.createElement("div");
  listContainer.className = "assets-list-container";
  const listEl = document.createElement("div");
  listEl.className = "assets-file-list";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ACCEPT_ATTR;
  fileInput.className = "assets-file-input";
  fileInput.setAttribute("aria-hidden", "true");

  const uploadBtn = document.createElement("button");
  uploadBtn.type = "button";
  uploadBtn.className = "btn btn-icon-label";
  uploadBtn.innerHTML = uploadIcon + "<span>Upload</span>";
  uploadBtn.addEventListener("click", () => fileInput.click());

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "btn btn-icon-label";
  refreshBtn.innerHTML = refreshIcon + "<span>Refresh</span>";

  function fetchList(): Promise<TimelineMediaListResponse> {
    return fetch(`/api/admin/show-workspaces/${encodeURIComponent(sid)}/timeline-media`, {
      credentials: "include",
    }).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }

  function applyList(data: TimelineMediaListResponse): void {
    listEl.innerHTML = "";
    if (data.files.length === 0) {
      const empty = document.createElement("div");
      empty.className = "assets-list-empty";
      empty.textContent = "No Assets in this project yet.";
      listEl.appendChild(empty);
    } else {
      renderFileList(listEl, data.files, sid);
    }
  }

  function refresh(): void {
    fetchList()
      .then(applyList)
      .catch((e) => console.error("Failed to list timeline media:", e));
  }

  refreshBtn.addEventListener("click", refresh);

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fetch(`/api/admin/show-workspaces/${encodeURIComponent(sid)}/timeline-media`, {
      method: "POST",
      credentials: "include",
      body: fd,
    })
      .then(async (r) => {
        if (r.status === 201) return r.json() as Promise<TimelineMediaListResponse>;
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Upload failed (${r.status})`);
      })
      .then(applyList)
      .catch((e) => {
        console.error("Upload failed:", e);
        alert(typeof e === "object" && e?.message ? e.message : "Upload failed.");
      });
    fileInput.value = "";
  });

  toolbar.appendChild(fileInput);
  toolbar.appendChild(uploadBtn);
  toolbar.appendChild(refreshBtn);

  const headerRow = createListHeader();
  listContainer.appendChild(headerRow);
  listContainer.appendChild(listEl);
  wrap.appendChild(toolbar);
  wrap.appendChild(listContainer);
  container.appendChild(wrap);

  refresh();
}
