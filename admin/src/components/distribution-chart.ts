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
}

export interface DistributionChartOptions {
  width: number;
  height: number;
  xAxis: DistributionChartXAxis;
  anchors?: DistributionAnchor[];
  onAnchorsChange?: (anchors: DistributionAnchor[]) => void;
  /** Index of the selected anchor (highlighted); null when none. */
  selectedAnchorIndex?: number | null;
  /** Called when selection changes (add, drag start, click outside, or delete). */
  onAnchorSelected?: (index: number | null) => void;
  /** Debug sample points (x, y) to draw as small grey dots; not persisted. */
  samplePoints?: { x: number; y: number }[];
}

const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 24;
const MARGIN_TOP = 32;
const MARGIN_BOTTOM = 48;
const ANCHOR_RADIUS = 4;
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
  const { width, height, xAxis, anchors = [], onAnchorsChange, selectedAnchorIndex = null, onAnchorSelected, samplePoints = [] } = options;
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

  let dragIndex: number | null = null;
  let curvePath: SVGPathElement | null = null;
  let currentAnchors = [...sortedAnchors];

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
      if (onAnchorsChange) {
        dragIndex = idx;
        svg.setPointerCapture(e.pointerId);
        const el = e.currentTarget as SVGElement;
        if (el) el.setAttribute("class", "distribution-chart-anchor distribution-chart-anchor--selected");
      }
    }
  }

  function handlePointerMove(e: PointerEvent): void {
    if (dragIndex === null) return;
    const pt = getSvgPoint(e);
    const { x, y } = svgToData(pt.x, pt.y);
    const next = [...currentAnchors];
    next[dragIndex] = { x, y };
    const sorted = next.sort((a, b) => a.x - b.x);
    dragIndex = sorted.findIndex((p) => p.x === x && p.y === y);
    if (dragIndex < 0) dragIndex = 0;
    currentAnchors = sorted;
    updateCurveAndAnchors(sorted);
  }

  function handlePointerUp(e: PointerEvent): void {
    if (dragIndex !== null) {
      const pt = getSvgPoint(e);
      const { x, y } = svgToData(pt.x, pt.y);
      const next = [...currentAnchors];
      next[dragIndex] = { x, y };
      const sorted = next.sort((a, b) => a.x - b.x);
      const finalIndex = sorted.findIndex((p) => p.x === x && p.y === y);
      onAnchorsChange?.(sorted);
      onAnchorSelected?.(finalIndex >= 0 ? finalIndex : dragIndex);
      svg.releasePointerCapture(e.pointerId);
      dragIndex = null;
    }
  }

  function handleChartClick(e: PointerEvent): void {
    if (!onAnchorsChange) return;
    const pt = getSvgPoint(e);
    if (hitTestAnchor(pt.x, pt.y, currentAnchors) >= 0) return;
    if (pt.x < plotLeft || pt.x > plotRight || pt.y < plotTop || pt.y > plotBottom) return;
    const { x, y } = svgToData(pt.x, pt.y);
    const next = [...sortedAnchors, { x, y }].sort((a, b) => a.x - b.x);
    const newIndex = next.findIndex((p) => p.x === x && p.y === y);
    onAnchorsChange?.(next);
    onAnchorSelected?.(newIndex >= 0 ? newIndex : null);
  }

  function handleAnchorDoubleClick(e: PointerEvent, index: number): void {
    e.preventDefault();
    e.stopPropagation();
    if (!onAnchorsChange) return;
    const next = sortedAnchors.filter((_, i) => i !== index);
    onAnchorsChange?.(next);
    onAnchorSelected?.(null);
  }

  for (let i = 0; i < sortedAnchors.length; i++) {
    const a = sortedAnchors[i];
    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", String(xToSvg(a.x)));
    circle.setAttribute("cy", String(yToSvg(a.y)));
    circle.setAttribute("r", String(ANCHOR_RADIUS));
    circle.setAttribute("class", "distribution-chart-anchor" + (i === selectedAnchorIndex ? " distribution-chart-anchor--selected" : ""));
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

  chartArea.addEventListener("pointerdown", (e) => handlePointerDown(e as PointerEvent));
  chartArea.addEventListener("click", (e) => handleChartClick(e as PointerEvent));

  svg.addEventListener("pointermove", (e) => handlePointerMove(e as PointerEvent));
  svg.addEventListener("pointerup", (e) => handlePointerUp(e as PointerEvent));
  svg.addEventListener("pointerleave", (e) => handlePointerUp(e as PointerEvent));

  svg.appendChild(g);
  container.innerHTML = "";
  container.appendChild(svg);
}

export { renderDistributionChart };
