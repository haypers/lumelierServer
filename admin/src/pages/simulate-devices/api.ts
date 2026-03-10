import type {
  SimulatedClient,
  SimulatedClientDistKey,
  SimulatedClientWithSampleHistory,
  ClientSummaryForGrid,
  ClientSummarySummary,
} from "./types";

const BASE = "http://localhost:3003";

/** Minimal list (id, deviceId, lastAssignedTrackIndex) for pagination; use getSummaries(showId, visibleIds) for colors/connection. 404 => show not live, returns []. */
export async function getClients(showId: string): Promise<ClientSummaryForGrid[]> {
  const res = await fetch(`${BASE}/shows/${encodeURIComponent(showId)}/clients`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GET /shows/:showId/clients failed: ${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>[];
  return raw.map((row) => {
    const r = row as { last_assigned_track_index?: number | null };
    const track =
      typeof row.lastAssignedTrackIndex === "number"
        ? row.lastAssignedTrackIndex
        : typeof r.last_assigned_track_index === "number"
          ? r.last_assigned_track_index
          : null;
    return {
      ...row,
      id: String(row.id ?? ""),
      deviceId: String(row.deviceId ?? row.device_id ?? ""),
      lastAssignedTrackIndex: track ?? undefined,
    } as ClientSummaryForGrid;
  });
}

/** Fetch currentDisplayColor only for the given IDs. Same order as ids. 404 => show not live, returns []. */
export async function getSummaries(
  showId: string,
  ids: string[]
): Promise<ClientSummarySummary[]> {
  if (ids.length === 0) return [];
  const res = await fetch(
    `${BASE}/shows/${encodeURIComponent(showId)}/clients/summaries`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`POST .../clients/summaries failed: ${res.status}`);
  const data = await res.json();
  return data.summaries ?? [];
}

export async function getClient(
  showId: string,
  id: string
): Promise<SimulatedClientWithSampleHistory | null> {
  const res = await fetch(
    `${BASE}/shows/${encodeURIComponent(showId)}/clients/${encodeURIComponent(id)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /shows/:showId/clients/:id failed: ${res.status}`);
  return res.json();
}

export async function postClients(
  showId: string,
  clients: SimulatedClient[]
): Promise<{ created: number }> {
  const res = await fetch(`${BASE}/shows/${encodeURIComponent(showId)}/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clients }),
  });
  if (res.status === 404) throw new Error("Show is not live");
  if (!res.ok) throw new Error(`POST .../clients failed: ${res.status}`);
  return res.json();
}

export async function patchClient(
  showId: string,
  id: string,
  patch: Partial<Pick<SimulatedClient, "currentDisplayColor">> &
    Partial<Record<SimulatedClientDistKey, { anchors: { x: number; y: number }[] }>>
): Promise<void> {
  const res = await fetch(
    `${BASE}/shows/${encodeURIComponent(showId)}/clients/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }
  );
  if (res.status === 404) throw new Error("Client not found");
  if (!res.ok) throw new Error(`PATCH .../clients/:id failed: ${res.status}`);
}

export async function deleteClient(showId: string, id: string): Promise<void> {
  const res = await fetch(
    `${BASE}/shows/${encodeURIComponent(showId)}/clients/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  if (res.status === 404) throw new Error("Client not found");
  if (!res.ok) throw new Error(`DELETE .../clients/:id failed: ${res.status}`);
}

export async function deleteAllClients(showId: string): Promise<void> {
  const res = await fetch(`${BASE}/shows/${encodeURIComponent(showId)}/clients`, {
    method: "DELETE",
  });
  if (res.status === 404) throw new Error("Show is not live");
  if (!res.ok) throw new Error(`DELETE .../clients failed: ${res.status}`);
}

export async function postSample(
  showId: string,
  id: string,
  distKey: SimulatedClientDistKey
): Promise<{ x: number; y: number }> {
  const res = await fetch(
    `${BASE}/shows/${encodeURIComponent(showId)}/clients/${encodeURIComponent(id)}/sample`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distKey }),
    }
  );
  if (res.status === 404) throw new Error("Client not found");
  if (!res.ok) throw new Error(`POST .../clients/:id/sample failed: ${res.status}`);
  return res.json();
}
