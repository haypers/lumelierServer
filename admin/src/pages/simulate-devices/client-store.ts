import type { SimulatedClient, SimulatedClientDistKey, DistributionAnchor } from "./types";

function uuid(): string {
  return crypto.randomUUID();
}

const DIST_KEYS_ORDER: SimulatedClientDistKey[] = [
  "pingsEverySecDist",
  "clientToServerDelayDist",
  "serverToClientDelayDist",
  "clientProcessingDelayMsDist",
  "timeBetweenLagSpikesDist",
  "lagSpikeDurationDist",
];

export interface ChartBounds {
  xMin: number;
  xMax: number;
}

/** Create one client with random distribution curves. pointCounts[i] = number of anchors for DIST_KEYS_ORDER[i]. */
export function createClientWithRandomCurves(
  bounds: ChartBounds[],
  pointCounts: number[]
): SimulatedClient {
  const id = uuid();
  const client: SimulatedClient = {
    id,
    deviceId: id,
    trackId: null,
    serverTimeEstimate: null,
    currentDisplayColor: "#888",
    pingsEverySecDist: { anchors: [] },
    clientToServerDelayDist: { anchors: [] },
    serverToClientDelayDist: { anchors: [] },
    clientProcessingDelayMsDist: { anchors: [] },
    timeBetweenLagSpikesDist: { anchors: [] },
    lagSpikeDurationDist: { anchors: [] },
  };
  const yMin = 0;
  const yMax = 100;
  for (let i = 0; i < DIST_KEYS_ORDER.length; i++) {
    const key = DIST_KEYS_ORDER[i];
    const { xMin, xMax } = bounds[i] ?? { xMin: 0, xMax: 1 };
    const n = Math.max(0, Math.floor(pointCounts[i] ?? 0));
    const anchors: DistributionAnchor[] = [];
    for (let j = 0; j < n; j++) {
      const x = xMin + Math.random() * (xMax - xMin);
      const y = yMin + Math.random() * (yMax - yMin);
      anchors.push({ x, y });
    }
    anchors.sort((a, b) => a.x - b.x);
    client[key] = { anchors };
  }
  return client;
}

export function createClient(): SimulatedClient {
  const id = uuid();
  return {
    id,
    deviceId: id,
    trackId: null,
    serverTimeEstimate: null,
    currentDisplayColor: "#888",
    pingsEverySecDist: { anchors: [] },
    clientToServerDelayDist: { anchors: [] },
    serverToClientDelayDist: { anchors: [] },
    clientProcessingDelayMsDist: { anchors: [] },
    timeBetweenLagSpikesDist: { anchors: [] },
    lagSpikeDurationDist: { anchors: [] },
  };
}

export function deleteClient(clients: SimulatedClient[], id: string): SimulatedClient[] {
  return clients.filter((c) => c.id !== id);
}

export function cloneClient(client: SimulatedClient): SimulatedClient {
  const newId = uuid();
  return {
    ...client,
    id: newId,
    deviceId: newId,
    trackId: client.trackId ?? null,
    pingsEverySecDist: { anchors: client.pingsEverySecDist.anchors.map((a) => ({ ...a })) },
    clientToServerDelayDist: { anchors: client.clientToServerDelayDist.anchors.map((a) => ({ ...a })) },
    serverToClientDelayDist: { anchors: client.serverToClientDelayDist.anchors.map((a) => ({ ...a })) },
    clientProcessingDelayMsDist: { anchors: client.clientProcessingDelayMsDist.anchors.map((a) => ({ ...a })) },
    timeBetweenLagSpikesDist: { anchors: client.timeBetweenLagSpikesDist.anchors.map((a) => ({ ...a })) },
    lagSpikeDurationDist: { anchors: client.lagSpikeDurationDist.anchors.map((a) => ({ ...a })) },
  };
}
