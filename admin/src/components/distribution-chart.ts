/**
 * Distribution chart: X axis (configurable range/unit/ticks), Y axis 0–100 (Probability, Often/Never).
 * Optional interactive distribution: anchors (add on click, move on drag, delete on double-click), connected by straight lines.
 */

export interface DistributionChartXAxis {
  unit: string;
  min: number;
  max: number;
  numTicks: number;
  formatTick?: (value: number) => string;
}

export interface DistributionAnchor {
  x: number;
  y: number;
  /** Chart units, ≥ 0. When drawMutationRangeRects, draw rect/line for selected point. */
  xMutationRange?: number;
  /** 0–100. When drawMutationRangeRects, draw rect/line for selected point. */
  yMutationRange?: number;
  /** 0–100 integer. Stored in chart JSON; not rendered. */
  destructionChance?: number;
}

export interface DistributionChartOptions {
  width: number;
  height: number;
  xAxis: DistributionChartXAxis;
  anchors?: DistributionAnchor[];
  onAnchorsChange?: (anchors: DistributionAnchor[]) => void;
  /** Indices of selected anchors (highlighted); empty when none. */
  selectedAnchorIndices?: number[];
  /** Called when selection changes (add, drag, marquee, click outside, or delete). */
  onAnchorSelected?: (indices: number[] | null) => void;
  /** Debug sample points (x, y) to draw as small grey dots; not persisted. */
  samplePoints?: { x: number; y: number }[];
  /** When true and exactly one anchor selected, draw mutation range rect/lines for that anchor. */
  drawMutationRangeRects?: boolean;
}

const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 24;
const MARGIN_TOP = 32;
const MARGIN_BOTTOM = 48;
const ANCHOR_RADIUS = 6;
const SAMPLE_POINT_RADIUS = 2;

function defaultFormatTick(value: number, min: number, max: number): string {
  const range = max - min;
  if (range < 20) {
    return value % 1 === 0 ? String(value) : value.toFixed(2);
  }
  return String(Math.round(value));
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function renderDistributionChart(container: HTMLElement, options: DistributionChartOptions): void {
  const {
    width,
    height,
    xAxis,
    anchors = [],
    onAnchorsChange,
    selectedAnchorIndices = [],
    onAnchorSelected,
    samplePoints = [],
    drawMutationRangeRects = false,
  } = options;
  const formatX = xAxis.formatTick ?? ((v: number) => defaultFormatTick(v, xAxis.min, xAxis.max));

  const plotLeft = MARGIN_LEFT;
  const plotRight = width - MARGIN_RIGHT;
  const plotTop = MARGIN_TOP;
  const plotBottom = height - MARGIN_BOTTOM;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const xMin = xAxis.min;
  const xMax = xAxis.max;

  const xToSvg = (x: number) =>
    plotLeft + (plotWidth * (x - xMin)) / (xMax - xMin || 1);
  const yToSvg = (y: number) => plotBottom - (plotHeight * y) / 100;
  const svgToData = (svgX: number, svgY: number): { x: number; y: number } => {
    const x = xMin + ((svgX - plotLeft) / plotWidth) * (xMax - xMin);
    const y = (100 * (plotBottom - svgY)) / plotHeight;
    return { x: clamp(x, xMin, xMax), y: clamp(y, 0, 100) };
  };

  const xTickValues: number[] = [];
  for (let i = 0; i < xAxis.numTicks; i++) {
    const t = i / Math.max(1, xAxis.numTicks - 1);
    xTickValues.push(xMin + t * (xMax - xMin));
  }

  const yTickValues = [0, 25, 50, 75, 100];

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("class", "distribution-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Distribution chart, X: ${xAxis.unit} ${xMin} to ${xMax}, Y: Probability`);

  const defs = document.createElementNS(svgNs, "defs");
  svg.appendChild(defs);

  const g = document.createElementNS(svgNs, "g");

  const fontSize = 10;

  function addLine(x1: number, y1: number, x2: number, y2: number, className: string): void {
    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("class", className);
    g.appendChild(line);
  }

  function addText(x: number, y: number, text: string, anchor: string, cls: string): void {
    const el = document.createElementNS(svgNs, "text");
    el.setAttribute("x", String(x));
    el.setAttribute("y", String(y));
    el.setAttribute("font-size", String(fontSize));
    el.setAttribute("text-anchor", anchor);
    el.setAttribute("dominant-baseline", "middle");
    el.setAttribute("class", cls);
    el.textContent = text;
    g.appendChild(el);
  }

  const chartArea = document.createElementNS(svgNs, "rect");
  chartArea.setAttribute("x", String(plotLeft));
  chartArea.setAttribute("y", String(plotTop));
  chartArea.setAttribute("width", String(plotWidth));
  chartArea.setAttribute("height", String(plotHeight));
  chartArea.setAttribute("fill", "none");
  chartArea.setAttribute("stroke", "none");
  chartArea.setAttribute("class", "distribution-chart-area");
  g.appendChild(chartArea);

  const marqueeRect = document.createElementNS(svgNs, "rect");
  marqueeRect.setAttribute("class", "distribution-chart-marquee");
  marqueeRect.setAttribute("fill", "rgba(59, 130, 246, 0.15)");
  marqueeRect.setAttribute("stroke", "var(--color-accent, #3b82f6)");
  marqueeRect.setAttribute("stroke-width", "1");
  marqueeRect.setAttribute("stroke-dasharray", "4 2");
  marqueeRect.setAttribute("visibility", "hidden");
  g.appendChild(marqueeRect);

  for (const x of xTickValues) {
    const sx = xToSvg(x);
    addLine(sx, plotBottom, sx, plotTop, "distribution-chart-grid-v");
  }
  for (const y of yTickValues) {
    const sy = yToSvg(y);
    addLine(plotLeft, sy, plotRight, sy, "distribution-chart-grid-h");
  }

  addLine(plotLeft, plotBottom, plotRight, plotBottom, "distribution-chart-axis-x");
  addLine(plotLeft, plotTop, plotLeft, plotBottom, "distribution-chart-axis-y");

  for (const x of xTickValues) {
    const sx = xToSvg(x);
    addLine(sx, plotBottom, sx, plotBottom + 6, "distribution-chart-tick-x");
    addText(sx, plotBottom + 14, formatX(x), "middle", "distribution-chart-label-x");
  }
  addText((plotLeft + plotRight) / 2, height - 8, xAxis.unit, "middle", "distribution-chart-unit-x");

  for (const y of yTickValues) {
    const sy = yToSvg(y);
    addLine(plotLeft - 6, sy, plotLeft, sy, "distribution-chart-tick-y");
  }
  const probLabel = document.createElementNS(svgNs, "text");
  probLabel.setAttribute("x", String(plotLeft - 22));
  probLabel.setAttribute("y", String((plotTop + plotBottom) / 2));
  probLabel.setAttribute("font-size", String(fontSize));
  probLabel.setAttribute("text-anchor", "middle");
  probLabel.setAttribute("dominant-baseline", "middle");
  probLabel.setAttribute("transform", `rotate(-90, ${plotLeft - 22}, ${(plotTop + plotBottom) / 2})`);
  probLabel.setAttribute("class", "distribution-chart-label-y-axis");
  probLabel.textContent = "Probability";
  g.appendChild(probLabel);

  addText(plotLeft - 10, plotTop, "Often", "end", "distribution-chart-often");
  addText(plotLeft - 10, plotBottom, "Never", "end", "distribution-chart-never");

  // --- Curve (monotone cubic + horizontals); 2+ case created below so we can update during drag ---
  const sortedAnchors = [...anchors].sort((a, b) => a.x - b.x);
  if (sortedAnchors.length === 1) {
    const path = document.createElementNS(svgNs, "path");
    const y = yToSvg(sortedAnchors[0].y);
    path.setAttribute("d", `M ${xToSvg(xMin)} ${y} L ${xToSvg(xMax)} ${y}`);
    path.setAttribute("class", "distribution-chart-curve");
    g.appendChild(path);
  }

  // --- Mutation range rect/lines (drawMutationRangeRects: draw for every anchor with non-zero range) ---
  if (drawMutationRangeRects) {
    const mutationGroup = document.createElementNS(svgNs, "g");
    mutationGroup.setAttribute("class", "distribution-chart-mutation-range");
    for (const a of sortedAnchors) {
      const xRange = Math.max(0, a.xMutationRange ?? 0);
      const yRange = Math.max(0, a.yMutationRange ?? 0);
      if (xRange === 0 && yRange === 0) continue;
      const ax = a.x;
      const ay = a.y;
      if (xRange > 0 && yRange > 0) {
        const xLeft = xToSvg(ax - xRange / 2);
        const xRight = xToSvg(ax + xRange / 2);
        const yTop = yToSvg(ay + yRange / 2);
        const yBottom = yToSvg(ay - yRange / 2);
        const rect = document.createElementNS(svgNs, "rect");
        rect.setAttribute("x", String(xLeft));
        rect.setAttribute("y", String(yTop));
        rect.setAttribute("width", String(Math.max(0, xRight - xLeft)));
        rect.setAttribute("height", String(Math.max(0, yBottom - yTop)));
        rect.setAttribute("class", "distribution-chart-mutation-range-rect");
        mutationGroup.appendChild(rect);
      } else if (xRange > 0) {
        const line = document.createElementNS(svgNs, "line");
        line.setAttribute("x1", String(xToSvg(ax - xRange / 2)));
        line.setAttribute("y1", String(yToSvg(ay)));
        line.setAttribute("x2", String(xToSvg(ax + xRange / 2)));
        line.setAttribute("y2", String(yToSvg(ay)));
        line.setAttribute("class", "distribution-chart-mutation-range-rect");
        mutationGroup.appendChild(line);
      } else {
        const line = document.createElementNS(svgNs, "line");
        line.setAttribute("x1", String(xToSvg(ax)));
        line.setAttribute("y1", String(yToSvg(ay + yRange / 2)));
        line.setAttribute("x2", String(xToSvg(ax)));
        line.setAttribute("y2", String(yToSvg(ay - yRange / 2)));
        line.setAttribute("class", "distribution-chart-mutation-range-rect");
        mutationGroup.appendChild(line);
      }
    }
    if (mutationGroup.childNodes.length > 0) g.appendChild(mutationGroup);
  }

  // --- Sample points (debug; small grey dots) ---
  const samplePointsGroup = document.createElementNS(svgNs, "g");
  samplePointsGroup.setAttribute("class", "distribution-chart-sample-points");
  for (const pt of samplePoints) {
    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", String(xToSvg(pt.x)));
    circle.setAttribute("cy", String(yToSvg(pt.y)));
    circle.setAttribute("r", String(SAMPLE_POINT_RADIUS));
    circle.setAttribute("class", "distribution-chart-sample-point");
    samplePointsGroup.appendChild(circle);
  }

  // --- Anchors (on top, receive pointer events) ---
  const anchorsGroup = document.createElementNS(svgNs, "g");
  anchorsGroup.setAttribute("class", "distribution-chart-anchors");

  const MARQUEE_DRAG_THRESHOLD = 5;
  const ANCHOR_DRAG_THRESHOLD = 5;
  const ADD_POINT_MOVE_THRESHOLD = 3;
  let dragIndex: number | null = null;
  let potentialAnchorDrag: { index: number; startX: number; startY: number } | null = null;
  let curvePath: SVGPathElement | null = null;
  let currentAnchors = [...sortedAnchors];
  let marqueeStart: { x: number; y: number } | null = null;
  let potentialMarqueeStart: { x: number; y: number } | null = null;
  let skipNextChartClick = false;
  let lastEmptySpaceDown: { x: number; y: number } | null = null;

  function getSvgPoint(e: PointerEvent): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    return { x: (e.clientX - rect.left) / scaleX, y: (e.clientY - rect.top) / scaleY };
  }

  function hitTestAnchor(svgX: number, svgY: number, anchorsList: DistributionAnchor[]): number {
    for (let i = 0; i < anchorsList.length; i++) {
      const cx = xToSvg(anchorsList[i].x);
      const cy = yToSvg(anchorsList[i].y);
      if (Math.hypot(svgX - cx, svgY - cy) <= ANCHOR_RADIUS) return i;
    }
    return -1;
  }

  function anchorIndicesInSvgRect(
    anchorsList: DistributionAnchor[],
    left: number,
    top: number,
    right: number,
    bottom: number
  ): number[] {
    const out: number[] = [];
    for (let i = 0; i < anchorsList.length; i++) {
      const cx = xToSvg(anchorsList[i].x);
      const cy = yToSvg(anchorsList[i].y);
      if (cx >= left && cx <= right && cy >= top && cy <= bottom) out.push(i);
    }
    return out;
  }

  function buildCurvePathD(anchorsList: DistributionAnchor[]): string {
    if (anchorsList.length === 0) return "";
    if (anchorsList.length === 1) {
      const y = yToSvg(anchorsList[0].y);
      return `M ${xToSvg(xMin)} ${y} L ${xToSvg(xMax)} ${y}`;
    }
    const sorted = [...anchorsList].sort((a, b) => a.x - b.x);
    const leftY = sorted[0].y;
    const rightY = sorted[sorted.length - 1].y;
    const parts: string[] = [
      `M ${xToSvg(xMin)} ${yToSvg(leftY)}`,
      `L ${xToSvg(sorted[0].x)} ${yToSvg(sorted[0].y)}`,
    ];
    for (let i = 1; i < sorted.length; i++) {
      parts.push(`L ${xToSvg(sorted[i].x)} ${yToSvg(sorted[i].y)}`);
    }
    parts.push(`L ${xToSvg(xMax)} ${yToSvg(rightY)}`);
    return parts.join(" ");
  }

  function updateCurveAndAnchors(anchorsList: DistributionAnchor[]): void {
    const sorted = [...anchorsList].sort((a, b) => a.x - b.x);
    if (curvePath) curvePath.setAttribute("d", buildCurvePathD(sorted));
    const circles = anchorsGroup.querySelectorAll("circle");
    sorted.forEach((a, i) => {
      if (circles[i]) {
        circles[i].setAttribute("cx", String(xToSvg(a.x)));
        circles[i].setAttribute("cy", String(yToSvg(a.y)));
      }
    });
  }

  function handlePointerDown(e: PointerEvent): void {
    const pt = getSvgPoint(e);
    const idx = hitTestAnchor(pt.x, pt.y, currentAnchors);
    if (idx >= 0) {
      e.preventDefault();
      e.stopPropagation();
      if (onAnchorsChange) {
        potentialAnchorDrag = { index: idx, startX: pt.x, startY: pt.y };
        svg.setPointerCapture(e.pointerId);
        anchorsGroup.querySelectorAll("circle").forEach((circle, i) => {
          const selected = i === idx;
          circle.setAttribute(
            "class",
            "distribution-chart-anchor" + (selected ? " distribution-chart-anchor--selected" : "")
          );
        });
      }
    }
  }

  function handlePointerMove(e: PointerEvent): void {
    const pt = getSvgPoint(e);
    if (potentialMarqueeStart !== null) {
      if ((e.buttons & 1) === 0) {
        potentialMarqueeStart = null;
        svg.releasePointerCapture(e.pointerId);
        return;
      }
      const dx = pt.x - potentialMarqueeStart.x;
      const dy = pt.y - potentialMarqueeStart.y;
      if (Math.hypot(dx, dy) >= MARQUEE_DRAG_THRESHOLD) {
        lastEmptySpaceDown = null;
        marqueeStart = { x: potentialMarqueeStart.x, y: potentialMarqueeStart.y };
        potentialMarqueeStart = null;
        marqueeRect.setAttribute("x", String(marqueeStart.x));
        marqueeRect.setAttribute("y", String(marqueeStart.y));
        marqueeRect.setAttribute("width", "0");
        marqueeRect.setAttribute("height", "0");
        marqueeRect.setAttribute("visibility", "visible");
      } else {
        return;
      }
    }
    if (marqueeStart !== null) {
      if ((e.buttons & 1) === 0) {
        const x1 = Math.min(marqueeStart.x, pt.x);
        const y1 = Math.min(marqueeStart.y, pt.y);
        const x2 = Math.max(marqueeStart.x, pt.x);
        const y2 = Math.max(marqueeStart.y, pt.y);
        const indices = anchorIndicesInSvgRect(currentAnchors, x1, y1, x2, y2);
        onAnchorSelected?.(indices.length > 0 ? indices : null);
        marqueeRect.setAttribute("visibility", "hidden");
        svg.releasePointerCapture(e.pointerId);
        marqueeStart = null;
        skipNextChartClick = true;
        return;
      }
      const x1 = Math.min(marqueeStart.x, pt.x);
      const y1 = Math.min(marqueeStart.y, pt.y);
      const x2 = Math.max(marqueeStart.x, pt.x);
      const y2 = Math.max(marqueeStart.y, pt.y);
      marqueeRect.setAttribute("x", String(x1));
      marqueeRect.setAttribute("y", String(y1));
      marqueeRect.setAttribute("width", String(Math.max(0, x2 - x1)));
      marqueeRect.setAttribute("height", String(Math.max(0, y2 - y1)));
      const indices = anchorIndicesInSvgRect(currentAnchors, x1, y1, x2, y2);
      anchorsGroup.querySelectorAll("circle").forEach((circle) => {
        const idx = parseInt(circle.getAttribute("data-index") ?? "", 10);
        const selected = indices.includes(idx);
        circle.setAttribute(
          "class",
          "distribution-chart-anchor" + (selected ? " distribution-chart-anchor--selected" : "")
        );
      });
      return;
    }
    if (potentialAnchorDrag !== null) {
      if ((e.buttons & 1) === 0) {
        potentialAnchorDrag = null;
        svg.releasePointerCapture(e.pointerId);
        return;
      }
      const dx = pt.x - potentialAnchorDrag.startX;
      const dy = pt.y - potentialAnchorDrag.startY;
      if (Math.hypot(dx, dy) >= ANCHOR_DRAG_THRESHOLD) {
        dragIndex = potentialAnchorDrag.index;
        potentialAnchorDrag = null;
      } else {
        return;
      }
    }
    if (dragIndex === null) return;
    const { x, y } = svgToData(pt.x, pt.y);
    const next = [...currentAnchors];
    next[dragIndex] = { ...currentAnchors[dragIndex], x, y };
    const sorted = next.sort((a, b) => a.x - b.x);
    dragIndex = sorted.findIndex((p) => p.x === x && p.y === y);
    if (dragIndex < 0) dragIndex = 0;
    currentAnchors = sorted;
    updateCurveAndAnchors(sorted);
  }

  function handlePointerUp(e: PointerEvent): void {
    if (potentialMarqueeStart !== null) {
      lastEmptySpaceDown = { x: potentialMarqueeStart.x, y: potentialMarqueeStart.y };
      potentialMarqueeStart = null;
      svg.releasePointerCapture(e.pointerId);
      return;
    }
    if (potentialAnchorDrag !== null) {
      skipNextChartClick = true;
      onAnchorSelected?.([potentialAnchorDrag.index]);
      potentialAnchorDrag = null;
      svg.releasePointerCapture(e.pointerId);
      return;
    }
    if (marqueeStart !== null) {
      const pt = getSvgPoint(e);
      const x1 = Math.min(marqueeStart.x, pt.x);
      const y1 = Math.min(marqueeStart.y, pt.y);
      const x2 = Math.max(marqueeStart.x, pt.x);
      const y2 = Math.max(marqueeStart.y, pt.y);
      const indices = anchorIndicesInSvgRect(currentAnchors, x1, y1, x2, y2);
      onAnchorSelected?.(indices.length > 0 ? indices : null);
      marqueeRect.setAttribute("visibility", "hidden");
      svg.releasePointerCapture(e.pointerId);
      marqueeStart = null;
      skipNextChartClick = true;
      return;
    }
    if (dragIndex !== null) {
      const pt = getSvgPoint(e);
      const { x, y } = svgToData(pt.x, pt.y);
      const next = [...currentAnchors];
      next[dragIndex] = { ...currentAnchors[dragIndex], x, y };
      const sorted = next.sort((a, b) => a.x - b.x);
      const finalIndex = sorted.findIndex((p) => p.x === x && p.y === y);
      onAnchorsChange?.(sorted);
      onAnchorSelected?.(finalIndex >= 0 ? [finalIndex] : [dragIndex]);
      svg.releasePointerCapture(e.pointerId);
      dragIndex = null;
    }
  }

  function handleChartClick(e: PointerEvent): void {
    if (skipNextChartClick) {
      skipNextChartClick = false;
      lastEmptySpaceDown = null;
      return;
    }
    if (!onAnchorsChange) return;
    const pt = getSvgPoint(e);
    if (lastEmptySpaceDown !== null) {
      const dist = Math.hypot(pt.x - lastEmptySpaceDown.x, pt.y - lastEmptySpaceDown.y);
      lastEmptySpaceDown = null;
      if (dist > ADD_POINT_MOVE_THRESHOLD) return;
    }
    if (hitTestAnchor(pt.x, pt.y, currentAnchors) >= 0) return;
    if (pt.x < plotLeft || pt.x > plotRight || pt.y < plotTop || pt.y > plotBottom) return;
    const { x, y } = svgToData(pt.x, pt.y);
    const next = [...sortedAnchors, { x, y }].sort((a, b) => a.x - b.x);
    const newIndex = next.findIndex((p) => p.x === x && p.y === y);
    onAnchorsChange?.(next);
    onAnchorSelected?.(newIndex >= 0 ? [newIndex] : null);
  }

  function handleAnchorDoubleClick(e: PointerEvent, index: number): void {
    e.preventDefault();
    e.stopPropagation();
    if (!onAnchorsChange) return;
    const next = sortedAnchors.filter((_, i) => i !== index);
    onAnchorsChange?.(next);
    onAnchorSelected?.(null);
  }

  function handleChartAreaPointerDown(e: PointerEvent): void {
    const pt = getSvgPoint(e);
    if (hitTestAnchor(pt.x, pt.y, currentAnchors) >= 0) return;
    e.preventDefault();
    potentialMarqueeStart = { x: pt.x, y: pt.y };
    svg.setPointerCapture(e.pointerId);
  }

  const isSelected = (i: number) => selectedAnchorIndices.includes(i);
  for (let i = 0; i < sortedAnchors.length; i++) {
    const a = sortedAnchors[i];
    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", String(xToSvg(a.x)));
    circle.setAttribute("cy", String(yToSvg(a.y)));
    circle.setAttribute("r", String(ANCHOR_RADIUS));
    circle.setAttribute("class", "distribution-chart-anchor" + (isSelected(i) ? " distribution-chart-anchor--selected" : ""));
    circle.setAttribute("data-index", String(i));
    circle.addEventListener("pointerdown", (e) => {
      handlePointerDown(e as PointerEvent);
    });
    circle.addEventListener("dblclick", (e) => {
      handleAnchorDoubleClick(e as PointerEvent, i);
    });
    anchorsGroup.appendChild(circle);
  }

  g.appendChild(samplePointsGroup);
  g.appendChild(anchorsGroup);

  if (sortedAnchors.length >= 2) {
    curvePath = document.createElementNS(svgNs, "path");
    curvePath.setAttribute("d", buildCurvePathD(sortedAnchors));
    curvePath.setAttribute("class", "distribution-chart-curve");
    g.insertBefore(curvePath, samplePointsGroup);
  }

  chartArea.addEventListener("pointerdown", (e) => handleChartAreaPointerDown(e as PointerEvent));

  function handleSvgClick(e: MouseEvent): void {
    const target = e.target as Node;
    if (target && anchorsGroup.contains(target)) return;
    const pt = getSvgPoint(e as unknown as PointerEvent);
    if (pt.x < plotLeft || pt.x > plotRight || pt.y < plotTop || pt.y > plotBottom) return;
    handleChartClick(e as unknown as PointerEvent);
  }

  svg.addEventListener("click", handleSvgClick);
  svg.addEventListener("pointermove", (e) => handlePointerMove(e as PointerEvent));
  svg.addEventListener("pointerup", (e) => handlePointerUp(e as PointerEvent));
  svg.addEventListener("pointerleave", (e) => handlePointerUp(e as PointerEvent));

  svg.appendChild(g);
  container.innerHTML = "";
  container.appendChild(svg);
}

/**
 * Update only the sample-points layer of an existing distribution chart (e.g. after refresh).
 * Does not touch anchors, curve, or other DOM; preserves scroll and avoids full re-render.
 */
export function updateSamplePointsInPlace(
  container: HTMLElement,
  samplePoints: { x: number; y: number }[],
  xAxis: DistributionChartXAxis,
  width: number,
  height: number
): void {
  const plotLeft = MARGIN_LEFT;
  const plotRight = width - MARGIN_RIGHT;
  const plotTop = MARGIN_TOP;
  const plotBottom = height - MARGIN_BOTTOM;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const xMin = xAxis.min;
  const xMax = xAxis.max;
  const xToSvg = (x: number) =>
    plotLeft + (plotWidth * (x - xMin)) / (xMax - xMin || 1);
  const yToSvg = (y: number) => plotBottom - (plotHeight * y) / 100;

  const group = container.querySelector(".distribution-chart-sample-points");
  if (!group) return;

  const svgNs = "http://www.w3.org/2000/svg";
  group.innerHTML = "";
  for (const pt of samplePoints) {
    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", String(xToSvg(pt.x)));
    circle.setAttribute("cy", String(yToSvg(pt.y)));
    circle.setAttribute("r", String(SAMPLE_POINT_RADIUS));
    circle.setAttribute("class", "distribution-chart-sample-point");
    group.appendChild(circle);
  }
}

export { renderDistributionChart };
