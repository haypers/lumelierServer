const http = require("http");

const PORT = process.env.SIMULATED_CLIENT_SERVER_PORT || 3003;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url === "/" ? "/" : req.url.replace(/\?.*$/, "");
  if ((req.method === "GET" && url === "/health") || (req.method === "GET" && url === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Hey I'm up!" }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Simulated client server listening on http://localhost:${PORT}`);
});
