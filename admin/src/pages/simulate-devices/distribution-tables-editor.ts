import { renderDistributionChart } from "../../components/distribution-chart";
import {
  DISTRIBUTION_CHART_PRESETS,
  DIST_KEYS_BY_PRESET_INDEX,
} from "./details-pane";
import type { DistributionCurve, SimulatedClientDistKey } from "./types";

const CLONE_MODAL_CHART_SIZE = 300;

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export interface DistributionTablesEditorApi {
  getCurves(): DistributionCurve[];
  setCurves(curves: Record<SimulatedClientDistKey, DistributionCurve>): void;
  destroy(): void;
}

export interface DistributionTablesEditorOptions {
  /** Called whenever curves are updated (user edit or setCurves). */
  onCurvesChange?: () => void;
}

export function renderDistributionTablesEditor(
  container: HTMLElement,
  initialCurves: DistributionCurve[],
  options?: DistributionTablesEditorOptions
): DistributionTablesEditorApi {
  const onCurvesChange = options?.onCurvesChange;
  container.className = "distribution-tables-editor";
  const curves: DistributionCurve[] = initialCurves.map((c) => ({
    anchors: c.anchors.map((a) => ({ ...a })),
  }));
  const chartContainers: (HTMLDivElement | null)[] = [null, null, null, null, null];
  const settingsContainers: (HTMLDivElement | null)[] = [
    null,
    null,
    null,
    null,
    null,
  ];
  let selectedChartIndex: number | null = null;
  let selectedAnchorIndices: number[] = [];

  const heading = document.createElement("h4");
  heading.className = "clone-mutations-heading";
  heading.textContent = "Distribution Tables:";
  container.appendChild(heading);

  function refreshCurvePointSettings(chartIndex: number): void {
    const wrap = settingsContainers[chartIndex];
    if (!wrap) return;
    const preset = DISTRIBUTION_CHART_PRESETS[chartIndex];
    const xMax = preset.xAxis.max;
    const hasSingleSelection =
      selectedChartIndex === chartIndex && selectedAnchorIndices.length === 1;
    wrap.innerHTML = "";
    if (!hasSingleSelection) {
      const msg = document.createElement("span");
      msg.className = "clone-curve-point-settings-message";
      msg.textContent = "Select a point to set its mutation effects.";
      wrap.appendChild(msg);
      return;
    }
    const sorted = [...curves[chartIndex].anchors].sort((a, b) => a.x - b.x);
    const selIdx = selectedAnchorIndices[0];
    if (selIdx < 0 || selIdx >= sorted.length) return;
    const anchor = sorted[selIdx];

    const xVal = anchor.xMutationRange ?? 0;
    const yVal = anchor.yMutationRange ?? 0;
    const destructionVal = anchor.destructionChance ?? 0;

    const xLabel = document.createElement("label");
    xLabel.textContent = "X-cord Mutation range: ";
    const xInput = document.createElement("input");
    xInput.type = "number";
    xInput.min = "0";
    xInput.max = String(xMax);
    xInput.step = "any";
    xInput.value = String(xVal);
    xInput.className = "clone-curve-point-input";
    xLabel.appendChild(xInput);
    wrap.appendChild(xLabel);

    const yLabel = document.createElement("label");
    yLabel.textContent = "Y-cord Mutation range: ";
    const yInput = document.createElement("input");
    yInput.type = "number";
    yInput.min = "0";
    yInput.max = "100";
    yInput.step = "any";
    yInput.value = String(yVal);
    yInput.className = "clone-curve-point-input";
    yLabel.appendChild(yInput);
    wrap.appendChild(yLabel);

    const dLabel = document.createElement("label");
    dLabel.textContent = "% chance of destruction: ";
    const dInput = document.createElement("input");
    dInput.type = "number";
    dInput.min = "0";
    dInput.max = "100";
    dInput.step = "1";
    dInput.value = String(destructionVal);
    dInput.className = "clone-curve-point-input";
    dLabel.appendChild(dInput);
    const dSuffix = document.createElement("span");
    dSuffix.textContent = " %";
    dLabel.appendChild(dSuffix);
    wrap.appendChild(dLabel);

    const apply = (): void => {
      const x = Math.max(0, Math.min(xMax, Number.parseFloat(xInput.value) || 0));
      const y = Math.max(0, Math.min(100, Number.parseFloat(yInput.value) || 0));
      const d = Math.max(0, Math.min(100, Math.round(Number.parseFloat(dInput.value) || 0)));
      anchor.xMutationRange = x;
      anchor.yMutationRange = y;
      anchor.destructionChance = d;
      renderChartAt(chartIndex);
    };
    xInput.addEventListener("input", apply);
    yInput.addEventListener("input", apply);
    dInput.addEventListener("input", apply);
  }

  function renderChartAt(i: number): void {
    const chartContainer = chartContainers[i];
    if (!chartContainer) return;
    const preset = DISTRIBUTION_CHART_PRESETS[i];
    const isSelected = selectedChartIndex === i;
    renderDistributionChart(chartContainer, {
      width: CLONE_MODAL_CHART_SIZE,
      height: CLONE_MODAL_CHART_SIZE,
      xAxis: preset.xAxis,
      anchors: curves[i].anchors.map((a) => ({ ...a })),
      onAnchorsChange: (anchors) => {
        curves[i] = { anchors: anchors.map((a) => ({ ...a })) };
        onCurvesChange?.();
      },
      selectedAnchorIndices: isSelected ? selectedAnchorIndices : [],
      onAnchorSelected: (indices) => {
        const prevChart = selectedChartIndex;
        selectedChartIndex = i;
        selectedAnchorIndices = indices ?? [];
        if (prevChart != null && prevChart !== i) {
          renderChartAt(prevChart);
          refreshCurvePointSettings(prevChart);
        }
        renderChartAt(i);
        refreshCurvePointSettings(i);
      },
      drawMutationRangeRects: true,
    });
  }

  for (let i = 0; i < DISTRIBUTION_CHART_PRESETS.length; i++) {
    const preset = DISTRIBUTION_CHART_PRESETS[i];
    const row = document.createElement("div");
    row.className = "clone-mutation-row";
    row.innerHTML = `<span class="clone-mutation-label">${escapeHtml(preset.title)}</span>`;
    const chartWrap = document.createElement("div");
    chartWrap.className = "clone-mutation-chart";
    row.appendChild(chartWrap);

    const chartContainer = document.createElement("div");
    chartContainer.className = "simulate-devices-chart-container";
    chartWrap.appendChild(chartContainer);
    chartContainers[i] = chartContainer;

    const curvePointSettings = document.createElement("div");
    curvePointSettings.className = "clone-curve-point-settings";
    row.appendChild(curvePointSettings);
    settingsContainers[i] = curvePointSettings;

    container.appendChild(row);
  }

  for (let i = 0; i < DISTRIBUTION_CHART_PRESETS.length; i++) {
    renderChartAt(i);
    refreshCurvePointSettings(i);
  }

  const handleKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const active = document.activeElement;
    if (
      active &&
      (active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active as HTMLElement).isContentEditable)
    )
      return;
    if (selectedChartIndex == null || selectedAnchorIndices.length === 0) return;
    const i = selectedChartIndex;
    const sorted = [...curves[i].anchors].sort((a, b) => a.x - b.x);
    const toRemove = new Set(
      selectedAnchorIndices.map((si) => sorted[si]).filter(Boolean)
    );
    curves[i] = {
      anchors: curves[i].anchors.filter((a) => !toRemove.has(a)),
    };
    selectedChartIndex = null;
    selectedAnchorIndices = [];
    renderChartAt(i);
    refreshCurvePointSettings(i);
    onCurvesChange?.();
    e.preventDefault();
  };

  document.addEventListener("keydown", handleKeydown);

  function getCurves(): DistributionCurve[] {
    return curves.map((c) => ({
      anchors: c.anchors.map((a) => ({ ...a })),
    }));
  }

  function setCurves(
    newCurves: Record<SimulatedClientDistKey, DistributionCurve>
  ): void {
    for (let i = 0; i < DIST_KEYS_BY_PRESET_INDEX.length; i++) {
      const key = DIST_KEYS_BY_PRESET_INDEX[i];
      const c = newCurves[key];
      curves[i] = c
        ? { anchors: c.anchors.map((a) => ({ ...a })) }
        : { anchors: [] };
    }
    selectedChartIndex = null;
    selectedAnchorIndices = [];
    for (let i = 0; i < DISTRIBUTION_CHART_PRESETS.length; i++) {
      renderChartAt(i);
      refreshCurvePointSettings(i);
    }
    onCurvesChange?.();
  }

  function destroy(): void {
    document.removeEventListener("keydown", handleKeydown);
    container.innerHTML = "";
  }

  return { getCurves, setCurves, destroy };
}
