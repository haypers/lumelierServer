/**
 * Distribution chart: X axis (configurable range/unit/ticks), Y axis 0–100 (Probability, Often/Never).
 * Renders axes and grid only; no distribution data yet.
 */

export interface DistributionChartXAxis {
  unit: string;
  min: number;
  max: number;
  numTicks: number;
  formatTick?: (value: number) => string;
}

export interface DistributionChartOptions {
  width: number;
  height: number;
  xAxis: DistributionChartXAxis;
}

const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 24;
const MARGIN_TOP = 32;
const MARGIN_BOTTOM = 48;

function defaultFormatTick(value: number, min: number, max: number): string {
  const range = max - min;
  if (range < 20) {
    return value % 1 === 0 ? String(value) : value.toFixed(2);
  }
  return String(Math.round(value));
}

function renderDistributionChart(container: HTMLElement, options: DistributionChartOptions): void {
  const { width, height, xAxis } = options;
  const formatX = xAxis.formatTick ?? ((v: number) => defaultFormatTick(v, xAxis.min, xAxis.max));

  const plotLeft = MARGIN_LEFT;
  const plotRight = width - MARGIN_RIGHT;
  const plotTop = MARGIN_TOP;
  const plotBottom = height - MARGIN_BOTTOM;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const xTickValues: number[] = [];
  for (let i = 0; i < xAxis.numTicks; i++) {
    const t = i / Math.max(1, xAxis.numTicks - 1);
    xTickValues.push(xAxis.min + t * (xAxis.max - xAxis.min));
  }

  const yTickValues = [0, 25, 50, 75, 100];

  const xToSvg = (x: number) =>
    plotLeft + (plotWidth * (x - xAxis.min)) / (xAxis.max - xAxis.min || 1);
  const yToSvg = (y: number) => plotBottom - (plotHeight * y) / 100;

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("class", "distribution-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Distribution chart, X: ${xAxis.unit} ${xAxis.min} to ${xAxis.max}, Y: Probability`);

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

  svg.appendChild(g);
  container.innerHTML = "";
  container.appendChild(svg);
}

export { renderDistributionChart };
