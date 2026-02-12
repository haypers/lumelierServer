const http = require("http");
const { sampleFromDistribution } = require("./sample-distribution.js");

const PORT = process.env.SIMULATED_CLIENT_SERVER_PORT || 3003;

const DIST_KEYS = [
  "pingsEverySecDist",
  "clientToServerDelayDist",
  "serverToClientDelayDist",
  "timeBetweenLagSpikesDist",
  "lagSpikeDurationDist",
];

const MAX_SAMPLE_POINTS = 100;

/** @type {Map<string, object>} */
const clients = new Map();

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalizeAnchors(anchors) {
  if (!Array.isArray(anchors)) return [];
  return anchors.map((a) => (a && typeof a.x === "number" && typeof a.y === "number" ? { x: a.x, y: a.y } : null)).filter(Boolean);
}

function normalizeCurve(curve) {
  if (!curve || typeof curve !== "object") return { anchors: [] };
  return { anchors: normalizeAnchors(curve.anchors) };
}

function initSampleHistory() {
  const sampleHistory = {};
  for (const key of DIST_KEYS) {
    sampleHistory[key] = [];
  }
  return sampleHistory;
}

function clientToSummary(record) {
  return {
    id: record.id,
    deviceId: record.deviceId,
    connectionEnabled: record.connectionEnabled,
    serverTimeEstimate: record.serverTimeEstimate,
    currentDisplayColor: record.currentDisplayColor,
  };
}

/** Minimal list for grid pagination; no color/connection to save bandwidth. */
function clientToSummaryMinimal(record) {
  return { id: record.id, deviceId: record.deviceId };
}

function addClients(incoming) {
  const list = Array.isArray(incoming) ? incoming : [];
  let created = 0;
  for (const c of list) {
    if (!c || typeof c.id !== "string") continue;
    const id = String(c.id);
    const record = {
      id,
      deviceId: typeof c.deviceId === "string" ? c.deviceId : id,
      connectionEnabled: Boolean(c.connectionEnabled),
      serverTimeEstimate: c.serverTimeEstimate != null && typeof c.serverTimeEstimate === "number" ? c.serverTimeEstimate : null,
      currentDisplayColor: typeof c.currentDisplayColor === "string" ? c.currentDisplayColor : null,
      pingsEverySecDist: normalizeCurve(c.pingsEverySecDist),
      clientToServerDelayDist: normalizeCurve(c.clientToServerDelayDist),
      serverToClientDelayDist: normalizeCurve(c.serverToClientDelayDist),
      timeBetweenLagSpikesDist: normalizeCurve(c.timeBetweenLagSpikesDist),
      lagSpikeDurationDist: normalizeCurve(c.lagSpikeDurationDist),
      sampleHistory: initSampleHistory(),
    };
    clients.set(id, record);
    created++;
  }
  return created;
}

function getClientList() {
  return Array.from(clients.values()).map(clientToSummary);
}

function getClientListMinimal() {
  return Array.from(clients.values()).map(clientToSummaryMinimal);
}

/** Return summaries (connectionEnabled, currentDisplayColor) for requested ids, same order. */
function getSummariesForIds(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => {
    const record = clients.get(id);
    if (!record) return { id, connectionEnabled: false, currentDisplayColor: null };
    return {
      id: record.id,
      connectionEnabled: record.connectionEnabled,
      currentDisplayColor: record.currentDisplayColor,
    };
  });
}

function getClientFull(id) {
  const record = clients.get(id);
  if (!record) return null;
  return {
    ...clientToSummary(record),
    pingsEverySecDist: record.pingsEverySecDist,
    clientToServerDelayDist: record.clientToServerDelayDist,
    serverToClientDelayDist: record.serverToClientDelayDist,
    timeBetweenLagSpikesDist: record.timeBetweenLagSpikesDist,
    lagSpikeDurationDist: record.lagSpikeDurationDist,
    sampleHistory: record.sampleHistory,
  };
}

function patchClient(id, body) {
  const record = clients.get(id);
  if (!record) return false;
  if (body.connectionEnabled !== undefined) record.connectionEnabled = Boolean(body.connectionEnabled);
  if (body.currentDisplayColor !== undefined) record.currentDisplayColor = body.currentDisplayColor;
  for (const key of DIST_KEYS) {
    if (body[key] && typeof body[key] === "object" && Array.isArray(body[key].anchors)) {
      record[key] = normalizeCurve(body[key]);
    }
  }
  return true;
}

function appendSample(id, distKey, point) {
  const record = clients.get(id);
  if (!record || !DIST_KEYS.includes(distKey)) return null;
  const list = record.sampleHistory[distKey];
  if (!Array.isArray(list)) return null;
  list.push({ x: point.x, y: point.y });
  record.sampleHistory[distKey] = list.slice(-MAX_SAMPLE_POINTS);
  return point;
}

// xAxis bounds per DIST_KEYS index (match admin DISTRIBUTION_CHART_PRESETS)
const CHART_BOUNDS = [
  { min: 0.25, max: 5.25 },
  { min: 0, max: 500 },
  { min: 0, max: 500 },
  { min: 5, max: 120 },
  { min: 0.25, max: 5 },
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = req.url === "/" ? "/" : req.url.replace(/\?.*$/, "");
  const pathParts = path.split("/").filter(Boolean); // ["clients"] or ["clients", ":id"]

  // GET /health or GET /
  if (req.method === "GET" && (path === "/health" || path === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Hey I'm up!" }));
    return;
  }

  // GET /clients -> minimal list (id, deviceId only) for pagination; use POST /clients/summaries for visible colors
  if (req.method === "GET" && pathParts.length === 1 && pathParts[0] === "clients") {
    sendJson(res, 200, getClientListMinimal());
    return;
  }

  // GET /clients/:id -> full client + sampleHistory
  if (req.method === "GET" && pathParts.length === 2 && pathParts[0] === "clients") {
    const id = pathParts[1];
    const full = getClientFull(id);
    if (!full) {
      res.writeHead(404);
      res.end();
      return;
    }
    sendJson(res, 200, full);
    return;
  }

  // POST /clients/summaries -> body { ids: string[] }, returns { summaries: Array<{ id, connectionEnabled, currentDisplayColor }> } for visible squares only
  if (req.method === "POST" && pathParts.length === 2 && pathParts[0] === "clients" && pathParts[1] === "summaries") {
    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)) : [];
    const summaries = getSummariesForIds(ids);
    sendJson(res, 200, { summaries });
    return;
  }

  // POST /clients -> create
  if (req.method === "POST" && pathParts.length === 1 && pathParts[0] === "clients") {
    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    const created = addClients(body.clients);
    sendJson(res, 200, { created });
    return;
  }

  // POST /clients/:id/sample -> sample from curve, append to history, return { x, y }
  if (req.method === "POST" && pathParts.length === 3 && pathParts[0] === "clients" && pathParts[2] === "sample") {
    const id = pathParts[1];
    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    const distKey = body.distKey;
    if (!distKey || !DIST_KEYS.includes(distKey)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing distKey" }));
      return;
    }
    const record = clients.get(id);
    if (!record) {
      res.writeHead(404);
      res.end();
      return;
    }
    const curve = record[distKey];
    const idx = DIST_KEYS.indexOf(distKey);
    const bounds = CHART_BOUNDS[idx] || { min: 0, max: 1 };
    const point = sampleFromDistribution(curve, bounds.min, bounds.max);
    appendSample(id, distKey, point);
    sendJson(res, 200, point);
    return;
  }

  // PATCH /clients/:id
  if (req.method === "PATCH" && pathParts.length === 2 && pathParts[0] === "clients") {
    const id = pathParts[1];
    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    if (!patchClient(id, body)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  // DELETE /clients/:id
  if (req.method === "DELETE" && pathParts.length === 2 && pathParts[0] === "clients") {
    const id = pathParts[1];
    if (!clients.has(id)) {
      res.writeHead(404);
      res.end();
      return;
    }
    clients.delete(id);
    res.writeHead(204);
    res.end();
    return;
  }

  // DELETE /clients -> delete all
  if (req.method === "DELETE" && pathParts.length === 1 && pathParts[0] === "clients") {
    clients.clear();
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Simulated client server listening on http://localhost:${PORT}`);
});
