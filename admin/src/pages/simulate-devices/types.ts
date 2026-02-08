export interface SimulatedClient {
  id: string;
  deviceId: string;
  connectionEnabled: boolean;
  serverTimeEstimate: number | null;
  currentDisplayColor: string | null;
  pingsEverySecDist: Record<string, unknown>;
  clientToServerDelayDist: Record<string, unknown>;
  serverToClientDelayDist: Record<string, unknown>;
  timeBetweenLagSpikesDist: Record<string, unknown>;
  lagSpikeDurationDist: Record<string, unknown>;
}
