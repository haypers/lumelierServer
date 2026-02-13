import type {
  SimulatedClient,
  SimulatedClientDistKey,
  SimulatedClientWithSampleHistory,
  ClientSummaryForGrid,
  ClientSummarySummary,
} from "./types";

const BASE = "http://localhost:3003";

/** Minimal list (id, deviceId only) for pagination; use getSummaries(visibleIds) for colors/connection. */
export async function getClients(): Promise<ClientSummaryForGrid[]> {
  const res = await fetch(`${BASE}/clients`);
  if (!res.ok) throw new Error(`GET /clients failed: ${res.status}`);
  return res.json();
}

/** Fetch currentDisplayColor only for the given IDs (e.g. visible page). Same order as ids. */
export async function getSummaries(ids: string[]): Promise<ClientSummarySummary[]> {
  if (ids.length === 0) return [];
  const res = await fetch(`${BASE}/clients/summaries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`POST /clients/summaries failed: ${res.status}`);
  const data = await res.json();
  return data.summaries ?? [];
}

export async function getClient(id: string): Promise<SimulatedClientWithSampleHistory | null> {
  const res = await fetch(`${BASE}/clients/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /clients/:id failed: ${res.status}`);
  return res.json();
}

export async function postClients(clients: SimulatedClient[]): Promise<{ created: number }> {
  const res = await fetch(`${BASE}/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clients }),
  });
  if (!res.ok) throw new Error(`POST /clients failed: ${res.status}`);
  return res.json();
}

export async function patchClient(
  id: string,
  patch: Partial<Pick<SimulatedClient, "currentDisplayColor">> &
    Partial<Record<SimulatedClientDistKey, { anchors: { x: number; y: number }[] }>>
): Promise<void> {
  const res = await fetch(`${BASE}/clients/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (res.status === 404) throw new Error("Client not found");
  if (!res.ok) throw new Error(`PATCH /clients/:id failed: ${res.status}`);
}

export async function deleteClient(id: string): Promise<void> {
  const res = await fetch(`${BASE}/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.status === 404) throw new Error("Client not found");
  if (!res.ok) throw new Error(`DELETE /clients/:id failed: ${res.status}`);
}

export async function deleteAllClients(): Promise<void> {
  const res = await fetch(`${BASE}/clients`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /clients failed: ${res.status}`);
}

export async function postSample(
  id: string,
  distKey: SimulatedClientDistKey
): Promise<{ x: number; y: number }> {
  const res = await fetch(`${BASE}/clients/${encodeURIComponent(id)}/sample`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ distKey }),
  });
  if (res.status === 404) throw new Error("Client not found");
  if (!res.ok) throw new Error(`POST /clients/:id/sample failed: ${res.status}`);
  return res.json();
}
