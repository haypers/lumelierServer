import type { DistributionChartXAxis } from "../../components/distribution-chart";
import { renderDistributionChart } from "../../components/distribution-chart";
import { createRefreshEvery, type RefreshEveryApi } from "../../components/refresh-every";
import { createInfoBubble } from "../../components/info-bubble";
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
  indices: number[];
}

export interface DetailsPaneRefreshEveryOptions {
  name: string;
  defaultMs: number;
  onIntervalChange: (ms: number) => void;
  /** If set, show an info icon with this tooltip (e.g. "Refreshing often can cause UI lag."). */
  infoTooltip?: string;
}

export function renderDetailsPane(
  container: HTMLElement,
  client: SimulatedClient | null,
  onDistributionChange?: (distKey: SimulatedClientDistKey, curve: DistributionCurve) => void,
  selection?: DistributionChartSelection | null,
  onSelectionChange?: (selection: DistributionChartSelection | null) => void,
  getSamplePoints?: (distKey: SimulatedClientDistKey) => { x: number; y: number }[],
  recordSample?: (distKey: SimulatedClientDistKey, x: number, y: number) => void,
  refreshEveryOptions?: DetailsPaneRefreshEveryOptions
): RefreshEveryApi | undefined {
  container.innerHTML = "";
  container.className = "simulate-devices-details-pane";

  let detailsRefreshApi: RefreshEveryApi | undefined = undefined;
  if (refreshEveryOptions) {
    detailsRefreshApi = createRefreshEvery({
      name: refreshEveryOptions.name,
      defaultMs: refreshEveryOptions.defaultMs,
      onIntervalChange: refreshEveryOptions.onIntervalChange,
      infoTooltip: refreshEveryOptions.infoTooltip,
    });
    const refreshWrap = document.createElement("div");
    refreshWrap.className = "simulate-devices-details-refresh-wrap";
    if (client == null) refreshWrap.classList.add("simulate-devices-details-refresh-wrap--hidden");
    refreshWrap.appendChild(detailsRefreshApi.root);
    container.appendChild(refreshWrap);
  }

  if (client == null) {
    const p = document.createElement("p");
    p.className = "simulate-devices-details-empty";
    p.textContent = "Select a client to view or edit its attributes.";
    container.appendChild(p);
    return detailsRefreshApi;
  }

  const dl = document.createElement("dl");
  dl.className = "detail-grid";

  const addRow = (label: string, value: string, tooltip?: string): void => {
    const dt = document.createElement("dt");
    if (tooltip != null && tooltip !== "") {
      const wrap = document.createElement("span");
      wrap.className = "detail-grid-dt-content";
      wrap.appendChild(
        createInfoBubble({ tooltipText: tooltip, ariaLabel: "Info" })
      );
      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      wrap.appendChild(labelSpan);
      dt.appendChild(wrap);
    } else {
      dt.textContent = label;
    }
    const dd = document.createElement("dd");
    dd.className = "detail-readonly";
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  };

  addRow(
    "Device ID",
    client.deviceId,
    "The device identifier sent to the main server on each poll."
  );
  const serverTimeStr =
    client.serverTimeEstimate != null &&
    client.serverTimeActualMs != null &&
    client.serverTimeEstimateErrorMs != null
      ? `${client.serverTimeEstimate} (actual was ${client.serverTimeActualMs}) ${client.serverTimeEstimateErrorMs >= 0 ? "+" : ""}${client.serverTimeEstimateErrorMs}ms`
      : client.serverTimeEstimate != null
        ? String(client.serverTimeEstimate)
        : "—";
  addRow(
    "Server time estimate",
    serverTimeStr,
    "The client's estimate of server time from clock sync; when available, actual server time and the error in ms are shown."
  );
  addRow(
    "Next poll in",
    client.nextPollInMs != null ? `${client.nextPollInMs} ms` : "—",
    "Time until the next poll request is sent (ms)."
  );
  addRow(
    "Next lag spike in",
    client.nextLagSpikeInMs != null ? `${client.nextLagSpikeInMs} ms` : "—",
    "Time until the next simulated lag spike starts (ms)."
  );
  addRow(
    "Lag ends in",
    client.lagEndsInMs != null ? `${client.lagEndsInMs} ms` : "—",
    "Time until the current lag spike ends (ms); 0 when not in lag."
  );
  addRow(
    "Last calculated RTT",
    client.lastRttMs != null ? `${client.lastRttMs} ms` : "—",
    "Round-trip time (C2S + S2C) of the last completed poll (ms)."
  );

  container.appendChild(dl);

  const chartsLabelWrap = document.createElement("div");
  chartsLabelWrap.className = "simulate-devices-charts-label-wrap";
  chartsLabelWrap.appendChild(
    createInfoBubble({
      tooltipText:
        "These distribution charts determine how random network delays are calculated. Higher peaks result in that x value being randomly chosen more often.",
      ariaLabel: "Info",
    })
  );
  const chartsLabel = document.createElement("span");
  chartsLabel.className = "simulate-devices-charts-label";
  chartsLabel.textContent = "Distribution Tables:";
  chartsLabelWrap.appendChild(chartsLabel);
  container.appendChild(chartsLabelWrap);

  const chartsGrid = document.createElement("div");
  chartsGrid.className = "simulate-devices-charts-grid";

  DISTRIBUTION_CHART_PRESETS.forEach((preset, index) => {
    const distKey = DIST_KEYS_BY_PRESET_INDEX[index];
    const curve = getCurve(client, distKey);
    const selectedAnchorIndices =
      selection?.distKey === distKey ? selection.indices : [];
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
      selectedAnchorIndices,
      onAnchorSelected: (indices) =>
        onSelectionChange?.(indices != null && indices.length > 0 ? { distKey, indices } : null),
      samplePoints: getSamplePoints?.(distKey) ?? [],
    });
    card.appendChild(chartContainer);
    chartsGrid.appendChild(card);
  });

  container.appendChild(chartsGrid);
  return detailsRefreshApi;
}
