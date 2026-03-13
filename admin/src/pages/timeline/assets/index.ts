/**
 * Assets tab: upload, list, refresh, and download for TimelineMedia files.
 */

import "./styles.css";
import uploadIcon from "../../../icons/upload.svg?raw";
import refreshIcon from "../../../icons/refresh.svg?raw";
import downloadIcon from "../../../icons/download.svg?raw";
import uploadingIcon from "../../../icons/uploading.svg?raw";
import uploadedIcon from "../../../icons/uploaded.svg?raw";
import trashIcon from "../../../icons/trash.svg?raw";
import { attachTooltipWhen } from "../../../components/popup-tooltip";
import { createDragHandleCell, type ExtensionKind } from "./asset-drag";

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

/** Per-file upload progress for tooltip and status. */
interface UploadProgress {
  loaded: number;
  total: number;
  startTime: number;
}

function formatTimeRemaining(remainingSec: number): string {
  if (!Number.isFinite(remainingSec) || remainingSec < 0) return "—";
  if (remainingSec < 60) return `${Math.round(remainingSec)} s`;
  const m = Math.floor(remainingSec / 60);
  const s = Math.round(remainingSec % 60);
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

function renderFileList(
  listEl: HTMLElement,
  files: TimelineMediaFile[],
  showId: string,
  uploadingState: Map<string, UploadProgress>,
  onDeleteSuccess: (data: TimelineMediaListResponse) => void
): void {
  for (const file of files) {
    const row = document.createElement("div");
    row.className = "assets-file-row";

    const isUploading = uploadingState.has(file.name);
    const lastDot = file.name.lastIndexOf(".");
    const extensionKind: ExtensionKind =
      lastDot > 0 ? getExtensionKind(file.name.slice(lastDot + 1)) : null;
    const dragHandleCell = createDragHandleCell(isUploading, file.name, extensionKind);

    const nameCell = document.createElement("div");
    nameCell.className = "assets-file-name-cell";
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
    const statusWrap = document.createElement("span");
    statusWrap.className = "assets-status-icon-wrap";
    if (isUploading) {
      statusWrap.classList.add("assets-status-icon-wrap--uploading");
      statusWrap.innerHTML = uploadingIcon;
      statusWrap.setAttribute("aria-label", "Uploading");
      attachTooltipWhen(statusWrap, () => {
        const u = uploadingState.get(file.name);
        if (!u) return "";
        const pct = u.total > 0 ? Math.round((u.loaded / u.total) * 100) : 0;
        let remSec = 0;
        if (u.loaded > 0 && u.total > u.loaded) {
          const elapsedSec = (Date.now() - u.startTime) / 1000;
          const rate = u.loaded / elapsedSec;
          remSec = (u.total - u.loaded) / rate / 1000;
        }
        return `Your file is currently uploading\n${pct}% - ${formatTimeRemaining(remSec)} Remaining`;
      });
    } else {
      statusWrap.classList.add("assets-status-icon-wrap--uploaded");
      statusWrap.innerHTML = uploadedIcon;
      statusWrap.setAttribute("aria-label", "Saved on server");
      attachTooltipWhen(statusWrap, () => "This file is saved on the Lumelier Server");
    }
    statusCell.appendChild(statusWrap);

    const durationCell = document.createElement("div");
    durationCell.className = "assets-file-duration-cell";
    durationCell.textContent = formatDuration(file.duration_sec);

    const sizeSpan = document.createElement("span");
    sizeSpan.className = "assets-file-size";
    sizeSpan.textContent = formatSize(file.size_bytes);

    const actionsCell = document.createElement("div");
    actionsCell.className = "assets-file-actions";
    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "assets-download-btn";
    downloadBtn.setAttribute("aria-label", `Download ${file.name}`);
    downloadBtn.innerHTML = downloadIcon;
    if (isUploading) {
      downloadBtn.disabled = true;
      downloadBtn.setAttribute("aria-label", "Download (available when upload completes)");
    } else {
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
    }
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "assets-delete-btn";
    deleteBtn.setAttribute("aria-label", `Delete ${file.name}`);
    deleteBtn.innerHTML = trashIcon;
    if (!isUploading) {
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`Remove "${file.name}" from this project? This cannot be undone.`)) return;
        const url = `/api/admin/show-workspaces/${encodeURIComponent(showId)}/timeline-media/${encodeURIComponent(file.name)}`;
        fetch(url, { method: "DELETE", credentials: "include" })
          .then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.json() as Promise<TimelineMediaListResponse>;
          })
          .then(onDeleteSuccess)
          .catch((e) => console.error("Delete failed:", e));
      });
    } else {
      deleteBtn.disabled = true;
    }
    actionsCell.appendChild(downloadBtn);
    actionsCell.appendChild(deleteBtn);

    row.appendChild(dragHandleCell);
    row.appendChild(nameCell);
    row.appendChild(statusCell);
    row.appendChild(durationCell);
    row.appendChild(sizeSpan);
    row.appendChild(actionsCell);
    listEl.appendChild(row);
  }
}

function createListHeader(): HTMLElement {
  const row = document.createElement("div");
  row.className = "assets-file-header";
  const drag = document.createElement("div");
  drag.className = "assets-file-header__drag";
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
  const actions = document.createElement("div");
  actions.className = "assets-file-header__actions";
  actions.setAttribute("aria-hidden", "true");
  row.appendChild(drag);
  row.appendChild(name);
  row.appendChild(status);
  row.appendChild(duration);
  row.appendChild(size);
  row.appendChild(actions);
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

  let serverFiles: TimelineMediaFile[] = [];
  const uploadingState = new Map<string, UploadProgress>();

  function fetchList(): Promise<TimelineMediaListResponse> {
    return fetch(`/api/admin/show-workspaces/${encodeURIComponent(sid)}/timeline-media`, {
      credentials: "include",
    }).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }

  function buildDisplayList(): TimelineMediaFile[] {
    const list = [...serverFiles];
    for (const name of uploadingState.keys()) {
      if (!list.some((f) => f.name === name)) {
        list.push({ name, size_bytes: 0 });
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  function renderList(): void {
    listEl.innerHTML = "";
    const displayFiles = buildDisplayList();
    if (displayFiles.length === 0) {
      const empty = document.createElement("div");
      empty.className = "assets-list-empty";
      empty.textContent = "No Assets in this project yet.";
      listEl.appendChild(empty);
    } else {
      renderFileList(listEl, displayFiles, sid, uploadingState, applyList);
    }
  }

  function applyList(data: TimelineMediaListResponse): void {
    serverFiles = data.files;
    renderList();
  }

  function refresh(): void {
    fetchList()
      .then(applyList)
      .catch((e) => console.error("Failed to list timeline media:", e));
  }

  function uploadOneFile(file: File): Promise<TimelineMediaListResponse> {
    const name = file.name;
    uploadingState.set(name, { loaded: 0, total: file.size, startTime: Date.now() });
    renderList();

    const url = `/api/admin/show-workspaces/${encodeURIComponent(sid)}/timeline-media`;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append("file", file);

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const prev = uploadingState.get(name);
          if (prev) uploadingState.set(name, { ...prev, loaded: e.loaded, total: e.total });
        }
      });

      xhr.addEventListener("load", () => {
        uploadingState.delete(name);
        if (xhr.status === 201) {
          try {
            const data = JSON.parse(xhr.responseText) as TimelineMediaListResponse;
            applyList(data);
            resolve(data);
          } catch {
            reject(new Error("Invalid response"));
          }
        } else {
          let msg = `Upload failed (${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            /* ignore */
          }
          reject(new Error(msg));
        }
      });
      xhr.addEventListener("error", () => {
        uploadingState.delete(name);
        renderList();
        reject(new Error("Network error"));
      });
      xhr.addEventListener("abort", () => {
        uploadingState.delete(name);
        renderList();
        reject(new Error("Upload aborted"));
      });

      xhr.open("POST", url);
      xhr.withCredentials = true;
      xhr.send(fd);
    });
  }

  refreshBtn.addEventListener("click", refresh);

  fileInput.multiple = true;
  fileInput.addEventListener("change", () => {
    const files = fileInput.files;
    if (!files?.length) return;
    const fileArray = Array.from(files);
    fileInput.value = "";

    const toUpload = fileArray.filter((file) => {
      const exists = serverFiles.some((f) => f.name === file.name);
      if (!exists) return true;
      return confirm(`A file named "${file.name}" already exists. Overwrite?`);
    });
    if (toUpload.length === 0) return;

    Promise.all(toUpload.map((file) => uploadOneFile(file))).catch((e) => {
        console.error("Upload failed:", e);
        alert(typeof e === "object" && e?.message ? e.message : "Upload failed.");
    });
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
