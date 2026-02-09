import type { DistributionChartXAxis } from "../../components/distribution-chart";
import { renderDistributionChart } from "../../components/distribution-chart";
import copyIcon from "../../icons/copy.svg?raw";
import clipboardIcon from "../../icons/clipboard.svg?raw";
import diceIcon from "../../icons/dice.svg?raw";
import { sampleFromDistribution } from "./sample-distribution";
import type { SimulatedClient, SimulatedClientDistKey, DistributionCurve } from "./types";

export interface DistributionChartPreset {
  title: string;
  xAxis: DistributionChartXAxis;
}

const CHART_SIZE = 300;

export const DISTRIBUTION_CHART_PRESETS: DistributionChartPreset[] = [
  {
    title: "Pings Server Every X Seconds",
    xAxis: { unit: "Seconds", min: 0.25, max: 5.25, numTicks: 10 },
  },
  {
    title: "Client to Server Delay",
    xAxis: { unit: "MS", min: 0, max: 500, numTicks: 10 },
  },
  {
    title: "Server to Client Delay",
    xAxis: { unit: "MS", min: 0, max: 500, numTicks: 10 },
  },
  {
    title: "Time Between Browser Lag Spikes",
    xAxis: { unit: "Seconds", min: 5, max: 120, numTicks: 10 },
  },
  {
    title: "Time of Lag Spikes",
    xAxis: { unit: "Seconds", min: 0.25, max: 5, numTicks: 10 },
  },
];

export const DIST_KEYS_BY_PRESET_INDEX: SimulatedClientDistKey[] = [
  "pingsEverySecDist",
  "clientToServerDelayDist",
  "serverToClientDelayDist",
  "timeBetweenLagSpikesDist",
  "lagSpikeDurationDist",
];

function getCurve(client: SimulatedClient, key: SimulatedClientDistKey): DistributionCurve {
  const cur = client[key];
  return cur && Array.isArray(cur.anchors) ? cur : { anchors: [] };
}

function isValidChartJson(value: unknown): value is DistributionCurve {
  if (value == null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (!Array.isArray(o.anchors)) return false;
  return o.anchors.every(
    (a) => typeof a === "object" && a != null && typeof (a as { x: unknown }).x === "number" && typeof (a as { y: unknown }).y === "number"
  );
}

export interface DistributionChartSelection {
  distKey: SimulatedClientDistKey;
  index: number;
}

export function renderDetailsPane(
  container: HTMLElement,
  client: SimulatedClient | null,
  onDistributionChange?: (distKey: SimulatedClientDistKey, curve: DistributionCurve) => void,
  selection?: DistributionChartSelection | null,
  onSelectionChange?: (selection: DistributionChartSelection | null) => void,
  getSamplePoints?: (distKey: SimulatedClientDistKey) => { x: number; y: number }[],
  recordSample?: (distKey: SimulatedClientDistKey, x: number, y: number) => void
): void {
  container.innerHTML = "";
  container.className = "simulate-devices-details-pane";

  if (client == null) {
    const p = document.createElement("p");
    p.className = "simulate-devices-details-empty";
    p.textContent = "Select a client to view or edit its attributes.";
    container.appendChild(p);
    return;
  }

  const dl = document.createElement("dl");
  dl.className = "detail-grid";

  const addRow = (label: string, value: string): void => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.className = "detail-readonly";
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  };

  addRow("Device ID", client.deviceId);
  addRow("Server time estimate", client.serverTimeEstimate != null ? String(client.serverTimeEstimate) : "—");
  addRow("Connection", client.connectionEnabled ? "Enabled" : "Disabled");

  container.appendChild(dl);

  const chartsGrid = document.createElement("div");
  chartsGrid.className = "simulate-devices-charts-grid";

  DISTRIBUTION_CHART_PRESETS.forEach((preset, index) => {
    const distKey = DIST_KEYS_BY_PRESET_INDEX[index];
    const curve = getCurve(client, distKey);
    const selectedAnchorIndex =
      selection?.distKey === distKey ? selection.index : null;
    const card = document.createElement("div");
    card.className = "simulate-devices-chart-card";
    const header = document.createElement("div");
    header.className = "simulate-devices-chart-header";
    const title = document.createElement("h4");
    title.className = "simulate-devices-chart-title";
    title.textContent = preset.title;
    header.appendChild(title);
    const actions = document.createElement("div");
    actions.className = "simulate-devices-chart-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "simulate-devices-chart-action-btn";
    copyBtn.innerHTML = copyIcon;
    copyBtn.title = "Copy chart JSON";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(JSON.stringify(curve)).catch(() => {});
    });
    const pasteBtn = document.createElement("button");
    pasteBtn.type = "button";
    pasteBtn.className = "simulate-devices-chart-action-btn";
    pasteBtn.innerHTML = clipboardIcon;
    pasteBtn.title = "Paste chart JSON";
    pasteBtn.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        const parsed = JSON.parse(text) as unknown;
        if (isValidChartJson(parsed)) {
          onDistributionChange?.(distKey, { anchors: parsed.anchors });
        } else {
          alert("No valid json detected in the clipboard.");
        }
      } catch {
        alert("No valid json detected in the clipboard.");
      }
    });
    const diceBtn = document.createElement("button");
    diceBtn.type = "button";
    diceBtn.className = "simulate-devices-chart-action-btn";
    diceBtn.innerHTML = diceIcon;
    diceBtn.title = "Roll random value";
    diceBtn.addEventListener("click", () => {
      const result = sampleFromDistribution(curve, preset.xAxis.min, preset.xAxis.max);
      recordSample?.(distKey, result.x, result.y);
      navigator.clipboard.writeText(String(result.x)).catch(() => {});
    });
    actions.appendChild(copyBtn);
    actions.appendChild(pasteBtn);
    actions.appendChild(diceBtn);
    header.appendChild(actions);
    card.appendChild(header);
    const chartContainer = document.createElement("div");
    chartContainer.className = "simulate-devices-chart-container";
    renderDistributionChart(chartContainer, {
      width: CHART_SIZE,
      height: CHART_SIZE,
      xAxis: preset.xAxis,
      anchors: curve.anchors,
      onAnchorsChange: (anchors) => onDistributionChange?.(distKey, { anchors }),
      selectedAnchorIndex: selectedAnchorIndex ?? undefined,
      onAnchorSelected: (index) =>
        onSelectionChange?.(index != null ? { distKey, index } : null),
      samplePoints: getSamplePoints?.(distKey) ?? [],
    });
    card.appendChild(chartContainer);
    chartsGrid.appendChild(card);
  });

  container.appendChild(chartsGrid);
}
