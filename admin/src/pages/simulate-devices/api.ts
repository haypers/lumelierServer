import type { SimulatedClient, SimulatedClientDistKey, SimulatedClientWithSampleHistory } from "./types";

const BASE = "http://localhost:3003";

export async function getClients(): Promise<SimulatedClient[]> {
  const res = await fetch(`${BASE}/clients`);
  if (!res.ok) throw new Error(`GET /clients failed: ${res.status}`);
  return res.json();
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
  patch: Partial<Pick<SimulatedClient, "connectionEnabled" | "currentDisplayColor">> &
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
