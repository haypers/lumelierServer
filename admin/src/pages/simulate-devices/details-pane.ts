import type { DistributionChartXAxis } from "../../components/distribution-chart";
import { renderDistributionChart } from "../../components/distribution-chart";
import type { SimulatedClient } from "./types";

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

export function renderDetailsPane(container: HTMLElement, client: SimulatedClient | null): void {
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

  for (const preset of DISTRIBUTION_CHART_PRESETS) {
    const card = document.createElement("div");
    card.className = "simulate-devices-chart-card";
    const title = document.createElement("h4");
    title.className = "simulate-devices-chart-title";
    title.textContent = preset.title;
    card.appendChild(title);
    const chartContainer = document.createElement("div");
    chartContainer.className = "simulate-devices-chart-container";
    renderDistributionChart(chartContainer, {
      width: CHART_SIZE,
      height: CHART_SIZE,
      xAxis: preset.xAxis,
    });
    card.appendChild(chartContainer);
    chartsGrid.appendChild(card);
  }

  container.appendChild(chartsGrid);
}
