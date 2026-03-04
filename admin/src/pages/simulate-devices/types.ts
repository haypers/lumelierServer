export interface DistributionAnchor {
  x: number;
  y: number;
  /** Chart units, ≥ 0. Used in clone modal for mutation range rect. */
  xMutationRange?: number;
  /** 0–100. Used in clone modal for mutation range rect. */
  yMutationRange?: number;
  /** 0–100 integer. Used for presets later. */
  destructionChance?: number;
}

export interface DistributionCurve {
  anchors: DistributionAnchor[];
}

export type SimulatedClientDistKey =
  | "pingsEverySecDist"
  | "clientToServerDelayDist"
  | "serverToClientDelayDist"
  | "clientProcessingDelayMsDist"
  | "timeBetweenLagSpikesDist"
  | "lagSpikeDurationDist";

export interface SimulatedClient {
  id: string;
  deviceId: string;
  /** If set, only events on this layer are used for display color (when timeline has layers). */
  trackId?: string | null;
  serverTimeEstimate: number | null;
  /** Actual server time (ms) when last estimate was recorded; for comparison. */
  serverTimeActualMs?: number | null;
  /** Estimate minus actual (ms); negative = client was behind. */
  serverTimeEstimateErrorMs?: number | null;
  currentDisplayColor: string | null;
  pingsEverySecDist: DistributionCurve;
  clientToServerDelayDist: DistributionCurve;
  serverToClientDelayDist: DistributionCurve;
  clientProcessingDelayMsDist: DistributionCurve;
  timeBetweenLagSpikesDist: DistributionCurve;
  lagSpikeDurationDist: DistributionCurve;
  /** Time until next poll (ms); only when client is in runner. */
  nextPollInMs?: number | null;
  /** Time until next lag spike (ms). */
  nextLagSpikeInMs?: number | null;
  /** Time until current lag ends (ms); 0 when not in lag. */
  lagEndsInMs?: number | null;
  /** Last round-trip time (ms) of the last completed poll. */
  lastRttMs?: number | null;
  /** Last network-only round-trip time (C2S + S2C). */
  lastNetworkRttMs?: number | null;
  /** Last sampled client-side processing delay (ms). */
  lastProcessingMs?: number | null;
  /** Last end-to-end time (network RTT + processing delay) (ms). */
  lastEffectiveRttMs?: number | null;
}

/** Response from GET /clients/:id — full client plus per-chart sample history. */
export interface SimulatedClientWithSampleHistory extends SimulatedClient {
  sampleHistory: Record<SimulatedClientDistKey, { x: number; y: number }[]>;
}

/** GET /clients returns minimal list; currentDisplayColor (and lagEndsInMs) merged from POST /clients/summaries for visible IDs only. */
export interface ClientSummaryForGrid {
  id: string;
  deviceId: string;
  /** If set, client syncs to this layer only. */
  trackId?: string | null;
  currentDisplayColor?: string | null;
  /** Time until current lag ends (ms); 0 when not in lag. */
  lagEndsInMs?: number | null;
}

export interface ClientSummarySummary {
  id: string;
  currentDisplayColor: string | null;
  /** Client clock estimate minus server actual (ms); negative = client behind. */
  serverTimeEstimateErrorMs?: number | null;
  /** Time until current lag ends (ms); 0 when not in lag. */
  lagEndsInMs?: number | null;
}
