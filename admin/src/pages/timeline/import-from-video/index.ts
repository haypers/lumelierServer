import "./styles.css";
import { openModal as openGlobalModal } from "../../../components/modal";

export interface LayerInfo {
  id: string;
  label: string;
}

export interface VideoImportEvent {
  startSec: number;
  color: string;
}

export interface OpenModalOptions {
  getLayers: () => LayerInfo[];
  addEventsFromVideo: (events: VideoImportEvent[], layerId: string) => void;
  inBroadcastMode: () => boolean;
}

const SAMPLE_INTERVALS = [
  { value: 0.25, label: "0.25 s" },
  { value: 0.5, label: "0.5 s" },
  { value: 1, label: "1 s" },
  { value: 2, label: "2 s" },
];

const PREVIEW_STRIP_MAX_SWATCHES = 60;

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Sample average color from ImageData (region or single pixel). */
function sampleImageDataToHex(data: ImageData): string {
  const len = data.data.length;
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let i = 0; i < len; i += 4) {
    r += data.data[i];
    g += data.data[i + 1];
    b += data.data[i + 2];
    n += 1;
  }
  if (n === 0) return "#000000";
  return rgbToHex(r / n, g / n, b / n);
}

let videoObjectUrl: string | null = null;

function revokeVideoUrl(): void {
  if (videoObjectUrl) {
    URL.revokeObjectURL(videoObjectUrl);
    videoObjectUrl = null;
  }
}

export function openModal(options: OpenModalOptions): void {
  if (options.inBroadcastMode()) return;
  revokeVideoUrl();
  const { getLayers, addEventsFromVideo } = options;
  const layers = getLayers();
  if (layers.length === 0) return;

  const layerOptions = layers
    .map(
      (l) =>
        `<option value="${escapeAttr(l.id)}">${escapeHtml(l.label)}</option>`
    )
    .join("");
  const intervalOptions = SAMPLE_INTERVALS.map(
    (opt) =>
      `<option value="${opt.value}" ${opt.value === 0.5 ? "selected" : ""}>${escapeHtml(opt.label)}</option>`
  ).join("");

  const content = document.createElement("div");
  content.className = "video-import-body";
  content.innerHTML = `
    <div class="video-import-file-row">
      <label class="video-import-file-label">
        <span class="btn btn-primary">Choose video file</span>
        <input type="file" class="video-import-file-input" accept="video/mp4,video/webm" />
      </label>
      <span class="video-import-file-name">No file chosen</span>
    </div>
    <div class="video-import-preview-section" hidden>
      <div class="video-import-video-wrap">
        <video class="video-import-video" muted playsinline></video>
        <canvas class="video-import-canvas" hidden></canvas>
        <div class="video-import-picker-overlay" hidden></div>
      </div>
      <div class="video-import-scrubber-wrap" hidden>
        <input type="range" class="video-import-scrubber" min="0" max="100" value="0" step="any" aria-label="Scrub through video" />
        <span class="video-import-scrubber-time">0:00 / 0:00</span>
      </div>
      <p class="video-import-picker-hint">Scrub to a frame with the bar above, then click on the video to select a pixel or drag to select a region. The sampled color will drive one layer.</p>
      <div class="video-import-current-row">
        <span class="video-import-current-label">Current color:</span>
        <div class="video-import-current-swatch" title="#000000"></div>
        <span class="video-import-current-hex">#000000</span>
      </div>
      <div class="video-import-strip-wrap">
        <span class="video-import-strip-label">Colors over time (preview):</span>
        <div class="video-import-strip"></div>
      </div>
      <div class="video-import-settings">
        <label class="video-import-setting">
          <span>Target layer</span>
          <select class="video-import-layer-select">${layerOptions}</select>
        </label>
        <label class="video-import-setting">
          <span>Sample interval</span>
          <select class="video-import-interval-select">${intervalOptions}</select>
        </label>
        <label class="video-import-setting">
          <span>Timeline start (seconds)</span>
          <input type="number" class="video-import-start-input" min="0" step="0.5" value="0" />
        </label>
      </div>
      <div class="video-import-actions">
        <span class="video-import-generate-status"></span>
      </div>
    </div>
  `;

  const fileInput = content.querySelector(".video-import-file-input") as HTMLInputElement;
  const fileNameEl = content.querySelector(".video-import-file-name") as HTMLElement;
  const previewSection = content.querySelector(".video-import-preview-section") as HTMLElement;
  const videoEl = content.querySelector(".video-import-video") as HTMLVideoElement;
  const canvasEl = content.querySelector(".video-import-canvas") as HTMLCanvasElement;
  const pickerOverlay = content.querySelector(".video-import-picker-overlay") as HTMLElement;
  const currentSwatch = content.querySelector(".video-import-current-swatch") as HTMLElement;
  const currentHex = content.querySelector(".video-import-current-hex") as HTMLElement;
  const stripEl = content.querySelector(".video-import-strip") as HTMLElement;
  const layerSelect = content.querySelector(".video-import-layer-select") as HTMLSelectElement;
  const intervalSelect = content.querySelector(".video-import-interval-select") as HTMLSelectElement;
  const startInput = content.querySelector(".video-import-start-input") as HTMLInputElement;
  const generateStatus = content.querySelector(".video-import-generate-status") as HTMLElement;
  const scrubberWrap = content.querySelector(".video-import-scrubber-wrap") as HTMLElement;
  const scrubberInput = content.querySelector(".video-import-scrubber") as HTMLInputElement;
  const scrubberTimeEl = content.querySelector(".video-import-scrubber-time") as HTMLElement;

  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  const canvasCtx = ctx;

  let generateBtnDisabled = false;
  function setGenerateEnabled(enabled: boolean): void {
    generateBtnDisabled = !enabled;
  }

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function updateScrubberUI(): void {
    const d = videoEl.duration;
    const t = videoEl.currentTime;
    if (Number.isFinite(d) && d > 0) {
      scrubberInput.max = String(d);
      scrubberInput.value = String(t);
      scrubberTimeEl.textContent = `${formatTime(t)} / ${formatTime(d)}`;
    }
  }

  type Selection = { x: number; y: number; w: number; h: number };
  let selection: Selection | null = null;
  let dragStart: { x: number; y: number } | null = null;

  function drawFrame(): void {
    if (videoEl.readyState < 2 || !videoEl.videoWidth) return;
    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
    canvasCtx.drawImage(videoEl, 0, 0);
  }

  /** Sample using canvas (video) pixel coordinates. */
  function sampleColorAtCanvas(canvasSel: Selection): string {
    drawFrame();
    const x = Math.max(0, Math.min(canvasSel.x, canvasEl.width - 1));
    const y = Math.max(0, Math.min(canvasSel.y, canvasEl.height - 1));
    const w = Math.max(1, Math.min(canvasSel.w, canvasEl.width - x));
    const h = Math.max(1, Math.min(canvasSel.h, canvasEl.height - y));
    const data = canvasCtx.getImageData(x, y, w, h);
    return sampleImageDataToHex(data);
  }

  function updateCurrentColor(): void {
    const canvasSel = getSelectionInCanvasCoords();
    if (!canvasSel) {
      currentSwatch.style.backgroundColor = "#000";
      currentHex.textContent = "#000000";
      return;
    }
    const hex = sampleColorAtCanvas(canvasSel);
    currentSwatch.style.backgroundColor = hex;
    currentSwatch.title = hex;
    currentHex.textContent = hex;
  }

  function renderPickerOverlay(): void {
    if (!selection) {
      pickerOverlay.innerHTML = "";
      pickerOverlay.style.background = "none";
      return;
    }
    const { x, y, w, h } = selection;
    if (w <= 1 && h <= 1) {
      pickerOverlay.innerHTML = `<div class="video-import-crosshair" style="left:${x}px;top:${y}px"></div>`;
    } else {
      pickerOverlay.innerHTML = `<div class="video-import-region" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`;
    }
  }

  let stripBuildScheduled = false;
  function scheduleStripBuild(): void {
    if (stripBuildScheduled) return;
    stripBuildScheduled = true;
    requestAnimationFrame(() => {
      stripBuildScheduled = false;
      buildStrip();
    });
  }

  function buildStrip(): void {
    if (dragStart !== null) return;
    stripEl.innerHTML = "";
    if (!selection || !videoEl.videoWidth || videoEl.duration <= 0 || !Number.isFinite(videoEl.duration)) return;
    scrubberInput.disabled = true;
    const duration = videoEl.duration;
    const interval = Number(intervalSelect.value) || 0.5;
    const count = Math.min(
      PREVIEW_STRIP_MAX_SWATCHES,
      Math.max(1, Math.ceil(duration / interval))
    );
    const step = duration / count;
    let built = 0;
    const onSeeked = () => {
      if (built === 0 && videoEl.currentTime > 0.001) {
        videoEl.currentTime = 0;
        return;
      }
      const i = built;
      if (i >= count) return;
      const canvasSel = getSelectionInCanvasCoords();
      const hex = canvasSel ? sampleColorAtCanvas(canvasSel) : "#000000";
      const swatch = document.createElement("div");
      swatch.className = "video-import-strip-swatch";
      swatch.style.backgroundColor = hex;
      swatch.title = `${(i * step).toFixed(1)} s: ${hex}`;
      stripEl.appendChild(swatch);
      built++;
      if (built < count) {
        videoEl.currentTime = built * step;
      } else {
        videoEl.removeEventListener("seeked", onSeeked);
        videoEl.currentTime = 0;
        scrubberInput.disabled = false;
        updateScrubberUI();
        videoEl.addEventListener("seeked", () => {
          updateCurrentColor();
        }, { once: true });
      }
    };
    videoEl.addEventListener("seeked", onSeeked);
    videoEl.currentTime = 0.001;
  }

  function onTimeUpdate(): void {
    updateScrubberUI();
    if (selection) updateCurrentColor();
  }

  function getSelectionInCanvasCoords(): Selection | null {
    if (!selection) return null;
    const v = videoEl;
    if (!v.offsetWidth || !v.offsetHeight || !v.videoWidth || !v.videoHeight) return null;
    const scaleX = v.videoWidth / v.offsetWidth;
    const scaleY = v.videoHeight / v.offsetHeight;
    const w = Math.max(1, Math.floor(selection.w * scaleX));
    const h = Math.max(1, Math.floor(selection.h * scaleY));
    return {
      x: Math.max(0, Math.floor(selection.x * scaleX)),
      y: Math.max(0, Math.floor(selection.y * scaleY)),
      w,
      h,
    };
  }

  function finalizeSelection(): void {
    if (!selection) return;
    updateCurrentColor();
    scheduleStripBuild();
    setGenerateEnabled(true);
  }

  pickerOverlay.addEventListener("mousedown", (e) => {
    if (!videoEl.videoWidth) return;
    const rect = pickerOverlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragStart = { x, y };
    selection = { x, y, w: 1, h: 1 };
    renderPickerOverlay();
    const onDocumentMouseUp = () => {
      document.removeEventListener("mouseup", onDocumentMouseUp);
      if (dragStart !== null) {
        dragStart = null;
        finalizeSelection();
      }
    };
    document.addEventListener("mouseup", onDocumentMouseUp);
  });

  pickerOverlay.addEventListener("mousemove", (e) => {
    if (dragStart === null) return;
    const rect = pickerOverlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const x1 = Math.min(dragStart.x, x);
    const y1 = Math.min(dragStart.y, y);
    const x2 = Math.max(dragStart.x, x);
    const y2 = Math.max(dragStart.y, y);
    selection = {
      x: x1,
      y: y1,
      w: Math.max(1, x2 - x1),
      h: Math.max(1, y2 - y1),
    };
    renderPickerOverlay();
  });

  pickerOverlay.addEventListener("mouseup", () => {
    if (dragStart !== null) {
      dragStart = null;
      finalizeSelection();
    }
  });

  pickerOverlay.addEventListener("mouseleave", () => {
    dragStart = null;
  });

  videoEl.addEventListener("timeupdate", onTimeUpdate);
  videoEl.addEventListener("seeked", () => {
    if (selection) updateCurrentColor();
  });

  intervalSelect.addEventListener("change", scheduleStripBuild);

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      fileNameEl.textContent = "No file chosen";
      previewSection.hidden = true;
      revokeVideoUrl();
      return;
    }
    revokeVideoUrl();
    videoObjectUrl = URL.createObjectURL(file);
    videoEl.src = videoObjectUrl;
    fileNameEl.textContent = file.name;
    videoEl.load();
    selection = null;
    renderPickerOverlay();
    setGenerateEnabled(false);
    stripEl.innerHTML = "";
    currentSwatch.style.backgroundColor = "#000";
    currentHex.textContent = "#000000";
  });

  videoEl.addEventListener("loadedmetadata", () => {
    previewSection.hidden = false;
    scrubberWrap.hidden = false;
    scrubberInput.max = String(videoEl.duration);
    scrubberInput.value = "0";
    updateScrubberUI();
    pickerOverlay.hidden = false;
    pickerOverlay.style.width = videoEl.offsetWidth + "px";
    pickerOverlay.style.height = videoEl.offsetHeight + "px";
  });

  scrubberInput.addEventListener("input", () => {
    const t = parseFloat(scrubberInput.value);
    if (Number.isFinite(t)) videoEl.currentTime = t;
  });
  scrubberInput.addEventListener("change", () => {
    updateScrubberUI();
  });

  async function runGenerate(closeFn: () => void): Promise<void> {
    const sel = getSelectionInCanvasCoords();
    if (!sel || !videoEl.videoWidth || videoEl.duration <= 0 || !Number.isFinite(videoEl.duration)) return;
    if (generateBtnDisabled) return;
    generateBtnDisabled = true;
    generateStatus.textContent = "Generating…";
    const interval = Number(intervalSelect.value) || 0.5;
    const timelineStart = Number(startInput.value) || 0;
    const layerId = layerSelect.value || layers[0].id;
    const duration = videoEl.duration;
    const events: VideoImportEvent[] = [];
    const sampleTimes: number[] = [];
    for (let t = 0; t < duration; t += interval) {
      sampleTimes.push(t);
    }
    if (duration > 0 && (sampleTimes.length === 0 || sampleTimes[sampleTimes.length - 1] < duration - 0.001)) {
      sampleTimes.push(duration);
    }
    const processNext = (i: number): Promise<void> => {
      if (i >= sampleTimes.length) {
        addEventsFromVideo(
          events.map((ev) => ({ startSec: timelineStart + ev.startSec, color: ev.color })),
          layerId
        );
        generateStatus.textContent = `Added ${events.length} events.`;
        generateBtnDisabled = false;
        setTimeout(closeFn, 800);
        return Promise.resolve();
      }
      const t = sampleTimes[i];
      return new Promise<void>((resolve) => {
        videoEl.currentTime = t;
        const onSeeked = () => {
          videoEl.removeEventListener("seeked", onSeeked);
          drawFrame();
          const x = Math.max(0, Math.min(sel.x, canvasEl.width - 1));
          const y = Math.max(0, Math.min(sel.y, canvasEl.height - 1));
          const w = Math.max(1, Math.min(sel.w, canvasEl.width - x));
          const h = Math.max(1, Math.min(sel.h, canvasEl.height - y));
          const data = canvasCtx.getImageData(x, y, w, h);
          events.push({ startSec: t, color: sampleImageDataToHex(data) });
          resolve(processNext(i + 1));
        };
        videoEl.addEventListener("seeked", onSeeked);
      });
    };
    await processNext(0);
  }

  const { close } = openGlobalModal({
    size: "large",
    clickOutsideToClose: true,
    title: "Import from video",
    content,
    cancel: {},
    actions: [
      {
        preset: "primary",
        label: "Generate events",
        onClick: () => runGenerate(close),
      },
    ],
    onClose: revokeVideoUrl,
  });
}
