/**
 * Position widget for Video/Image ranges in the details pane: fixed circle + tab,
 * media (first frame or image) behind it; drag, rotate (corners), 8-handle resize.
 * Persists x, y, angle, hs, vs (position % diameter; angle degrees; horizontal/vertical scale).
 * At hs=vs=1 the media's shortest side equals the circle diameter (portrait: width=diameter; landscape: height=diameter).
 */

import type { RangePositionOverlay } from "../types";

const DEFAULT_OVERLAY: RangePositionOverlay = {
  x: 0,
  y: 0,
  angle: 0,
  hs: 1,
  vs: 1,
};

const CIRCLE_DIAMETER_RATIO = 0.55;
const TAB_LENGTH_RATIO = 1 / 15;
const HANDLE_RADIUS = 6;
/** Hit-test radius for handles (larger than draw radius for easier grabbing). */
const HANDLE_HIT_RADIUS = 10;
const CORNER_ZONE_RADIUS = 30;

export interface PositionWidgetOptions {
  container: HTMLElement;
  initial: Partial<RangePositionOverlay> | null;
  filePath: string;
  rangeType: "Video" | "Image";
  showId: string | null;
  readonly?: boolean;
  onUpdate: (overlay: RangePositionOverlay) => void;
}

function clampScale(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  return Math.max(0.1, Math.min(10, v));
}

export function renderPositionWidget(options: PositionWidgetOptions): void {
  const {
    container,
    initial,
    filePath,
    rangeType,
    showId,
    readonly = false,
    onUpdate,
  } = options;

  const overlay: RangePositionOverlay = {
    x: Number.isFinite(Number(initial?.x)) ? Number(initial!.x) : DEFAULT_OVERLAY.x,
    y: Number.isFinite(Number(initial?.y)) ? Number(initial!.y) : DEFAULT_OVERLAY.y,
    angle: Number.isFinite(Number(initial?.angle)) ? Number(initial!.angle) : DEFAULT_OVERLAY.angle,
    hs: clampScale(initial?.hs ?? DEFAULT_OVERLAY.hs),
    vs: clampScale(initial?.vs ?? DEFAULT_OVERLAY.vs),
  };

  container.innerHTML = "";
  container.className = "detail-position-widget";

  const leftCol = document.createElement("div");
  leftCol.className = "detail-position-widget-canvas-wrap";
  const canvasEl = document.createElement("canvas");
  canvasEl.className = "detail-position-widget-canvas";
  canvasEl.setAttribute("aria-label", "Position overlay");
  leftCol.appendChild(canvasEl);

  const rightCol = document.createElement("div");
  rightCol.className = "detail-position-widget-form";
  rightCol.innerHTML = `
    <label class="detail-position-label"><span class="detail-position-label-text">Media X offset</span> <input type="number" class="detail-input detail-position-input" data-field="x" step="any" value="${overlay.x}" aria-label="Media X offset" ${readonly ? "readonly" : ""} /></label>
    <label class="detail-position-label"><span class="detail-position-label-text">Media Y offset</span> <input type="number" class="detail-input detail-position-input" data-field="y" step="any" value="${overlay.y}" aria-label="Media Y offset" ${readonly ? "readonly" : ""} /></label>
    <label class="detail-position-label"><span class="detail-position-label-text">Media Angle</span> <input type="number" class="detail-input detail-position-input" data-field="angle" step="any" value="${overlay.angle}" aria-label="Media Angle" ${readonly ? "readonly" : ""} /></label>
    <label class="detail-position-label"><span class="detail-position-label-text">Media Horizontal Scale</span> <input type="number" class="detail-input detail-position-input" data-field="hs" step="any" min="0.1" value="${overlay.hs}" aria-label="Media Horizontal Scale" ${readonly ? "readonly" : ""} /></label>
    <label class="detail-position-label"><span class="detail-position-label-text">Media Vertical Scale</span> <input type="number" class="detail-input detail-position-input" data-field="vs" step="any" min="0.1" value="${overlay.vs}" aria-label="Media Vertical Scale" ${readonly ? "readonly" : ""} /></label>
  `;
  container.appendChild(leftCol);
  container.appendChild(rightCol);

  if (!canvasEl.getContext("2d")) return;

  let mediaImage: HTMLImageElement | HTMLVideoElement | null = null;
  let mediaNaturalWidth = 0;
  let mediaNaturalHeight = 0;
  let mediaReady = false;

  function getMediaUrl(): string | null {
    if (!showId || !filePath?.trim()) return null;
    const fileName = filePath.trim().replace(/^.*[/\\]/, "");
    if (!fileName) return null;
    return `/api/admin/show-workspaces/${encodeURIComponent(showId)}/timeline-media/${encodeURIComponent(fileName)}`;
  }

  function loadMedia(): void {
    const url = getMediaUrl();
    if (!url) {
      mediaReady = true;
      draw();
      return;
    }
    if (rangeType === "Image") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        mediaImage = img;
        mediaNaturalWidth = img.naturalWidth;
        mediaNaturalHeight = img.naturalHeight;
        mediaReady = true;
        draw();
      };
      img.onerror = () => {
        mediaReady = true;
        draw();
      };
      img.src = url;
    } else {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      let fallback: ReturnType<typeof setTimeout> | null = null;
      video.onloadeddata = () => {
        if (mediaReady) return;
        video.currentTime = 0;
      };
      video.onseeked = () => {
        if (fallback) clearTimeout(fallback);
        if (mediaImage) return;
        mediaImage = video;
        mediaNaturalWidth = video.videoWidth;
        mediaNaturalHeight = video.videoHeight;
        mediaReady = true;
        draw();
      };
      video.onerror = () => {
        if (fallback) clearTimeout(fallback);
        mediaReady = true;
        draw();
      };
      fallback = setTimeout(() => {
        if (mediaReady) return;
        mediaReady = true;
        draw();
      }, 5000);
      video.src = url;
    }
  }

  let canvasWidth = 320;
  let canvasHeight = 240;
  let centerX = 0;
  let centerY = 0;
  let diameter = 0;
  let radius = 0;

  function layout(): void {
    const rect = canvasEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvasEl.width !== w || canvasEl.height !== h) {
      canvasEl.width = w;
      canvasEl.height = h;
      canvasEl.style.width = `${rect.width}px`;
      canvasEl.style.height = `${rect.height}px`;
    }
    canvasWidth = w;
    canvasHeight = h;
    diameter = Math.min(w, h) * CIRCLE_DIAMETER_RATIO;
    radius = diameter / 2;
    centerX = w / 2;
    centerY = h / 2;
  }

  function draw(): void {
    layout();
    const c = canvasEl.getContext("2d");
    if (!c) return;
    c.clearRect(0, 0, canvasWidth, canvasHeight);

    const r = radius;
    const cx = centerX;
    const cy = centerY;

    if (mediaReady && mediaImage && mediaNaturalWidth > 0 && mediaNaturalHeight > 0) {
      const angleRad = (overlay.angle * Math.PI) / 180;
      const dx = (overlay.x / 100) * diameter;
      const dy = -(overlay.y / 100) * diameter;
      const baseSize = diameter;
      const nw = mediaNaturalWidth;
      const nh = mediaNaturalHeight;
      /* At hs=vs=1, shortest side of media = diameter (portrait: width=diameter; landscape: height=diameter). */
      const fit = baseSize / Math.min(nw, nh);
      const drawW = nw * fit * overlay.hs;
      const drawH = nh * fit * overlay.vs;

      c.save();
      c.translate(cx + dx, cy + dy);
      c.rotate(angleRad);
      c.translate(-drawW / 2, -drawH / 2);
      try {
        c.drawImage(mediaImage, 0, 0, nw, nh, 0, 0, drawW, drawH);
      } catch {
        /* CORS or detached */
      }
      c.restore();
    }

    c.strokeStyle = "#4a7dc7";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();

    const tabLen = r * TAB_LENGTH_RATIO;
    const dotRadius = Math.max(2, r * 0.03);
    c.strokeStyle = "#e67e22";
    c.fillStyle = "#e67e22";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx, cy - r);
    c.lineTo(cx, cy - r + tabLen);
    c.stroke();
    c.beginPath();
    c.arc(cx, cy - r, dotRadius, 0, Math.PI * 2);
    c.fill();

    /* Show handles when hovering anywhere over the position widget (canvas or form), not only over the media */
    if (hoverOverWidget && mediaReady && mediaImage && mediaNaturalWidth > 0 && mediaNaturalHeight > 0) {
      const m = getMediaRect();
      if (m) {
        const angleRad = m.angleRad;
        const hw = m.drawW / 2;
        const hh = m.drawH / 2;
        const handles: { x: number; y: number }[] = [
          { x: -hw, y: -hh },
          { x: hw, y: -hh },
          { x: hw, y: hh },
          { x: -hw, y: hh },
          { x: 0, y: -hh },
          { x: hw, y: 0 },
          { x: 0, y: hh },
          { x: -hw, y: 0 },
        ];
        c.fillStyle = "rgba(255,255,255,0.9)";
        c.strokeStyle = "#4a7dc7";
        c.lineWidth = 2;
        for (const { x, y } of handles) {
          const wx = m.cx + x * Math.cos(angleRad) - y * Math.sin(angleRad);
          const wy = m.cy + x * Math.sin(angleRad) + y * Math.cos(angleRad);
          c.beginPath();
          c.arc(wx, wy, HANDLE_RADIUS, 0, Math.PI * 2);
          c.fill();
          c.stroke();
        }
      }
    }
  }

  function syncInputs(): void {
    rightCol.querySelectorAll<HTMLInputElement>("input[data-field]").forEach((input) => {
      const field = input.dataset.field as keyof RangePositionOverlay;
      if (field in overlay) input.value = String(overlay[field]);
    });
  }

  function emit(): void {
    onUpdate({ ...overlay });
  }

  rightCol.querySelectorAll<HTMLInputElement>("input[data-field]").forEach((input) => {
    if (readonly) return;
    const field = input.dataset.field as keyof RangePositionOverlay;
    const apply = (): void => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      if (field === "hs" || field === "vs") {
        overlay[field] = clampScale(v);
      } else if (field === "x" || field === "y" || field === "angle") {
        overlay[field] = v;
      }
      draw();
      emit();
    };
    input.addEventListener("change", apply);
    input.addEventListener("blur", apply);
  });

  function clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function getMediaRect(): { cx: number; cy: number; angleRad: number; drawW: number; drawH: number } | null {
    if (!mediaReady || !mediaImage || mediaNaturalWidth <= 0 || mediaNaturalHeight <= 0) return null;
    const dx = (overlay.x / 100) * diameter;
    const dy = -(overlay.y / 100) * diameter;
    const baseSize = diameter;
    const nw = mediaNaturalWidth;
    const nh = mediaNaturalHeight;
    const fit = baseSize / Math.min(nw, nh);
    const drawW = nw * fit * overlay.hs;
    const drawH = nh * fit * overlay.vs;
    return {
      cx: centerX + dx,
      cy: centerY + dy,
      angleRad: (overlay.angle * Math.PI) / 180,
      drawW,
      drawH,
    };
  }

  function toLocal(px: number, py: number, m: { cx: number; cy: number; angleRad: number }): { lx: number; ly: number } {
    const dx = px - m.cx;
    const dy = py - m.cy;
    const c = Math.cos(-m.angleRad);
    const s = Math.sin(-m.angleRad);
    return { lx: dx * c - dy * s, ly: dx * s + dy * c };
  }

  type HandleKind = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | null;
  const CORNER_KINDS: HandleKind[] = ["nw", "ne", "sw", "se"];

  function hitHandle(localX: number, localY: number, drawW: number, drawH: number): HandleKind {
    const hw = drawW / 2;
    const hh = drawH / 2;
    const d = (x: number, y: number) => Math.hypot(localX - x, localY - y);
    const handles: { k: HandleKind; x: number; y: number }[] = [
      { k: "nw", x: -hw, y: -hh },
      { k: "ne", x: hw, y: -hh },
      { k: "sw", x: -hw, y: hh },
      { k: "se", x: hw, y: hh },
      { k: "n", x: 0, y: -hh },
      { k: "s", x: 0, y: hh },
      { k: "e", x: hw, y: 0 },
      { k: "w", x: -hw, y: 0 },
    ];
    for (const { k, x, y } of handles) {
      if (d(x, y) <= HANDLE_HIT_RADIUS) return k;
    }
    return null;
  }

  /** Local coords of a corner by kind. */
  function cornerLocal(k: HandleKind, hw: number, hh: number): { x: number; y: number } | null {
    if (k === "nw") return { x: -hw, y: -hh };
    if (k === "ne") return { x: hw, y: -hh };
    if (k === "sw") return { x: -hw, y: hh };
    if (k === "se") return { x: hw, y: hh };
    return null;
  }

  /** Opposite corner of a corner handle. */
  function oppositeCorner(k: HandleKind): HandleKind {
    if (k === "nw") return "se";
    if (k === "ne") return "sw";
    if (k === "sw") return "ne";
    if (k === "se") return "nw";
    return null;
  }

  /** If (lx,ly) is in the 20px corner zone but not on a handle, return the closest corner; else null. */
  function hitCornerZone(lx: number, ly: number, drawW: number, drawH: number): HandleKind | null {
    const hw = drawW / 2;
    const hh = drawH / 2;
    let best: HandleKind = null;
    let bestDist = CORNER_ZONE_RADIUS + 1;
    for (const k of CORNER_KINDS) {
      const c = cornerLocal(k, hw, hh);
      if (!c) continue;
      const dist = Math.hypot(lx - c.x, ly - c.y);
      if (dist <= HANDLE_HIT_RADIUS) return null; /* on handle: not zone */
      if (dist <= CORNER_ZONE_RADIUS && dist < bestDist) {
        bestDist = dist;
        best = k;
      }
    }
    return best;
  }

  let hoverOverWidget = false;
  let hoverOverMedia = false;
  let hoverHandle: HandleKind = null;
  /** When in corner zone but not on handle: rotate intent; we remember which corner for cursor. */
  let hoverCornerZone: HandleKind = null;
  let dragStart: { x: number; y: number; overlayX: number; overlayY: number } | null = null;
  let rotateStart: { angle: number; startAngle: number } | null = null;
  let resizeStart: {
    kind: HandleKind;
    initialHs: number;
    initialVs: number;
    initialLx: number;
    initialLy: number;
    initialDrawW: number;
    initialDrawH: number;
    fit: number;
    /** For corner resize: fixed (opposite) corner in local coords; diagonal scale only. */
    fixedCornerLx?: number;
    fixedCornerLy?: number;
    initialCornerLx?: number;
    initialCornerLy?: number;
    /** Initial media rect at drag start so we can convert pointer to same local space each frame. */
    initialCx?: number;
    initialCy?: number;
    initialAngleRad?: number;
    initialOverlayX?: number;
    initialOverlayY?: number;
  } | null = null;

  function onPointerDown(e: PointerEvent): void {
    if (readonly) return;
    const { x: px, y: py } = clientToCanvas(e.clientX, e.clientY);
    const m = getMediaRect();
    if (!m) return;
    const { lx, ly } = toLocal(px, py, m);
    const hw = m.drawW / 2;
    const hh = m.drawH / 2;
    const onMedia = Math.abs(lx) <= hw && Math.abs(ly) <= hh;
    const handle = hitHandle(lx, ly, m.drawW, m.drawH);
    const cornerZone = !handle ? hitCornerZone(lx, ly, m.drawW, m.drawH) : null;

    /* Corner handles: resize only (opposite corner fixed, scale along diagonal). Side handles: resize as before. */
    if (handle) {
      const nw = mediaNaturalWidth;
      const nh = mediaNaturalHeight;
      const baseSize = diameter;
      const fit = baseSize / Math.min(nw, nh);
      const drawW = nw * fit * overlay.hs;
      const drawH = nh * fit * overlay.vs;
      const isCorner = CORNER_KINDS.includes(handle);
      const fixed = isCorner ? oppositeCorner(handle) : null;
      const fixedPos = fixed ? cornerLocal(fixed, hw, hh) : null;
      const cornerPos = isCorner ? cornerLocal(handle, hw, hh) : null;
      resizeStart = {
        kind: handle,
        initialHs: overlay.hs,
        initialVs: overlay.vs,
        initialLx: lx,
        initialLy: ly,
        initialDrawW: drawW,
        initialDrawH: drawH,
        fit,
        fixedCornerLx: fixedPos?.x,
        fixedCornerLy: fixedPos?.y,
        initialCornerLx: cornerPos?.x,
        initialCornerLy: cornerPos?.y,
        initialCx: m.cx,
        initialCy: m.cy,
        initialAngleRad: m.angleRad,
        initialOverlayX: overlay.x,
        initialOverlayY: overlay.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else if (cornerZone) {
      /* In corner zone but not on handle: rotate around shape origin (center). */
      const startAngle = Math.atan2(py - m.cy, px - m.cx);
      rotateStart = { angle: overlay.angle, startAngle };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else if (onMedia) {
      dragStart = { x: px, y: py, overlayX: overlay.x, overlayY: overlay.y };
      canvasEl.style.cursor = "grabbing";
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e: PointerEvent): void {
    const { x: px, y: py } = clientToCanvas(e.clientX, e.clientY);
    const m = getMediaRect();
    if (!rotateStart && !resizeStart && !dragStart && m) {
      const { lx, ly } = toLocal(px, py, m);
      const hw = m.drawW / 2;
      const hh = m.drawH / 2;
      const onMedia = Math.abs(lx) <= hw && Math.abs(ly) <= hh;
      hoverOverMedia = onMedia;
      hoverHandle = hitHandle(lx, ly, m.drawW, m.drawH);
      hoverCornerZone = !hoverHandle ? hitCornerZone(lx, ly, m.drawW, m.drawH) : null;
      if (hoverCornerZone) {
        canvasEl.classList.add("detail-position-rotate-zone");
        canvasEl.style.cursor = ""; /* rotation cursor from CSS */
      } else {
        canvasEl.classList.remove("detail-position-rotate-zone");
        if (hoverHandle) {
          const cursors: Record<Exclude<HandleKind, null>, string> = {
            n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
            nw: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", se: "nwse-resize",
          };
          canvasEl.style.cursor = cursors[hoverHandle] ?? "default";
        } else if (hoverOverMedia) {
          canvasEl.style.cursor = "grab";
        } else {
          canvasEl.style.cursor = "default";
          hoverOverMedia = false;
          hoverHandle = null;
          hoverCornerZone = null;
        }
      }
      scheduleDraw();
    }
    if (rotateStart) {
      const m = getMediaRect();
      if (m) {
        const curAngle = Math.atan2(py - m.cy, px - m.cx);
        const deltaDeg = ((curAngle - rotateStart.startAngle) * 180) / Math.PI;
        overlay.angle = rotateStart.angle + deltaDeg;
        syncInputs();
        draw();
        emit();
      }
    } else if (resizeStart && resizeStart.kind) {
      const m = getMediaRect();
      if (m) {
        const k = resizeStart.kind;
        const nw = mediaNaturalWidth;
        const nh = mediaNaturalHeight;
        let newDrawW: number;
        let newDrawH: number;
        let centerDeltaLx = 0;
        let centerDeltaLy = 0;
        const isCorner =
          resizeStart.fixedCornerLx != null &&
          resizeStart.fixedCornerLy != null &&
          resizeStart.initialCornerLx != null &&
          resizeStart.initialCornerLy != null &&
          resizeStart.initialCx != null &&
          resizeStart.initialCy != null &&
          resizeStart.initialAngleRad != null &&
          resizeStart.initialOverlayX != null &&
          resizeStart.initialOverlayY != null;
        if (isCorner) {
          /* Opposite corner fixed; scale only along diagonal. Use initial rect so (lx,ly) is in same local space as (fx,fy) and (ix,iy). */
          const init = {
            cx: resizeStart.initialCx!,
            cy: resizeStart.initialCy!,
            angleRad: resizeStart.initialAngleRad!,
          };
          const { lx, ly } = toLocal(px, py, init);
          const fx = resizeStart.fixedCornerLx!;
          const fy = resizeStart.fixedCornerLy!;
          const ix = resizeStart.initialCornerLx!;
          const iy = resizeStart.initialCornerLy!;
          const initialDiag = Math.hypot(ix - fx, iy - fy);
          const newDiag = Math.hypot(lx - fx, ly - fy);
          const scale = initialDiag > 1e-6 ? Math.max(0.01, newDiag / initialDiag) : 1;
          newDrawW = Math.max(10, resizeStart.initialDrawW * scale);
          newDrawH = Math.max(10, resizeStart.initialDrawH * scale);
          /* Keep fixed corner pinned in world: newCenter = fixedWorld - R(fixedInNewLocal). So delta from initial center = R(fx - fx', fy - fy'). */
          const fixed = oppositeCorner(k);
          const fixedInNew = cornerLocal(fixed, newDrawW / 2, newDrawH / 2);
          const deltaLx = fx - (fixedInNew?.x ?? 0);
          const deltaLy = fy - (fixedInNew?.y ?? 0);
          centerDeltaLx = deltaLx;
          centerDeltaLy = deltaLy;
        } else {
          const { lx, ly } = toLocal(px, py, m);
          /* Side handles: independent width/height. */
          let w = resizeStart.initialDrawW;
          let h = resizeStart.initialDrawH;
          const dLx = lx - resizeStart.initialLx;
          const dLy = ly - resizeStart.initialLy;
          if (k === "e" || k === "ne" || k === "se") w = resizeStart.initialDrawW + dLx;
          if (k === "w" || k === "nw" || k === "sw") w = resizeStart.initialDrawW - dLx;
          if (k === "s" || k === "se" || k === "sw") h = resizeStart.initialDrawH + dLy;
          if (k === "n" || k === "ne" || k === "nw") h = resizeStart.initialDrawH - dLy;
          newDrawW = Math.max(10, w);
          newDrawH = Math.max(10, h);
        }
        overlay.hs = clampScale(newDrawW / (nw * resizeStart.fit));
        overlay.vs = clampScale(newDrawH / (nh * resizeStart.fit));
        if (isCorner && (centerDeltaLx !== 0 || centerDeltaLy !== 0)) {
          const percentPerPx = 100 / diameter;
          const angleRad = resizeStart.initialAngleRad!;
          const worldDx = centerDeltaLx * Math.cos(angleRad) - centerDeltaLy * Math.sin(angleRad);
          const worldDy = centerDeltaLx * Math.sin(angleRad) + centerDeltaLy * Math.cos(angleRad);
          overlay.x = resizeStart.initialOverlayX! + worldDx * percentPerPx;
          overlay.y = resizeStart.initialOverlayY! - worldDy * percentPerPx;
        }
        syncInputs();
        draw();
        emit();
      }
    } else if (dragStart) {
      const percentPerPx = 100 / diameter;
      overlay.x = dragStart.overlayX + (px - dragStart.x) * percentPerPx;
      overlay.y = dragStart.overlayY - (py - dragStart.y) * percentPerPx;
      syncInputs();
      draw();
      emit();
    }
  }

  function onPointerUp(e: PointerEvent): void {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragStart = null;
    rotateStart = null;
    resizeStart = null;
    hoverOverMedia = false;
    hoverHandle = null;
    hoverCornerZone = null;
    canvasEl.style.cursor = "default";
    scheduleDraw();
  }

  function onPointerLeave(): void {
    if (!dragStart && !rotateStart && !resizeStart) {
      hoverOverMedia = false;
      hoverHandle = null;
      hoverCornerZone = null;
      canvasEl.classList.remove("detail-position-rotate-zone");
      canvasEl.style.cursor = "default";
      scheduleDraw();
    }
  }

  function onWidgetPointerEnter(): void {
    hoverOverWidget = true;
    scheduleDraw();
  }

  function onWidgetPointerLeave(): void {
    hoverOverWidget = false;
    hoverCornerZone = null;
    scheduleDraw();
  }

  if (!readonly) {
    canvasEl.addEventListener("pointerdown", onPointerDown);
    canvasEl.addEventListener("pointermove", onPointerMove);
    canvasEl.addEventListener("pointerup", onPointerUp);
    canvasEl.addEventListener("pointerleave", onPointerLeave);
    container.addEventListener("pointerenter", onWidgetPointerEnter);
    container.addEventListener("pointerleave", onWidgetPointerLeave);
  }

  let rafId = 0;
  function scheduleDraw(): void {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      draw();
    });
  }

  const ro = new ResizeObserver(scheduleDraw);
  ro.observe(canvasEl);

  loadMedia();
  scheduleDraw();
}
