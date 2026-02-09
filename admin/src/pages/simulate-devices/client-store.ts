import type { SimulatedClient } from "./types";

function uuid(): string {
  return crypto.randomUUID();
}

export function createClient(): SimulatedClient {
  const id = uuid();
  return {
    id,
    deviceId: id,
    connectionEnabled: true,
    serverTimeEstimate: null,
    currentDisplayColor: "#888",
    pingsEverySecDist: { anchors: [] },
    clientToServerDelayDist: { anchors: [] },
    serverToClientDelayDist: { anchors: [] },
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
    pingsEverySecDist: { anchors: client.pingsEverySecDist.anchors.map((a) => ({ ...a })) },
    clientToServerDelayDist: { anchors: client.clientToServerDelayDist.anchors.map((a) => ({ ...a })) },
    serverToClientDelayDist: { anchors: client.serverToClientDelayDist.anchors.map((a) => ({ ...a })) },
    timeBetweenLagSpikesDist: { anchors: client.timeBetweenLagSpikesDist.anchors.map((a) => ({ ...a })) },
    lagSpikeDurationDist: { anchors: client.lagSpikeDurationDist.anchors.map((a) => ({ ...a })) },
  };
}

export function toggleConnection(client: SimulatedClient): void {
  client.connectionEnabled = !client.connectionEnabled;
}
