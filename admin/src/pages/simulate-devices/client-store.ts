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
    pingsEverySecDist: {},
    clientToServerDelayDist: {},
    serverToClientDelayDist: {},
    timeBetweenLagSpikesDist: {},
    lagSpikeDurationDist: {},
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
    pingsEverySecDist: { ...client.pingsEverySecDist },
    clientToServerDelayDist: { ...client.clientToServerDelayDist },
    serverToClientDelayDist: { ...client.serverToClientDelayDist },
    timeBetweenLagSpikesDist: { ...client.timeBetweenLagSpikesDist },
    lagSpikeDurationDist: { ...client.lagSpikeDurationDist },
  };
}

export function toggleConnection(client: SimulatedClient): void {
  client.connectionEnabled = !client.connectionEnabled;
}
