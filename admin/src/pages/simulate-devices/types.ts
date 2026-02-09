export interface DistributionAnchor {
  x: number;
  y: number;
}

export interface DistributionCurve {
  anchors: DistributionAnchor[];
}

export type SimulatedClientDistKey =
  | "pingsEverySecDist"
  | "clientToServerDelayDist"
  | "serverToClientDelayDist"
  | "timeBetweenLagSpikesDist"
  | "lagSpikeDurationDist";

export interface SimulatedClient {
  id: string;
  deviceId: string;
  connectionEnabled: boolean;
  serverTimeEstimate: number | null;
  currentDisplayColor: string | null;
  pingsEverySecDist: DistributionCurve;
  clientToServerDelayDist: DistributionCurve;
  serverToClientDelayDist: DistributionCurve;
  timeBetweenLagSpikesDist: DistributionCurve;
  lagSpikeDurationDist: DistributionCurve;
}
