require("dotenv").config();

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const API_DIR = path.join(ROOT, "api");
const PORT = Number(process.env.ADMIN_PORT || 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  if (!res.headersSent) res.setHeader("Content-Type", type);
  res.statusCode = status;
  res.end(body);
}

function decorateResponse(res) {
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = data => {
    send(res, res.statusCode || 200, JSON.stringify(data), "application/json; charset=utf-8");
  };
  res.send = body => {
    if (Buffer.isBuffer(body)) return send(res, res.statusCode || 200, body);
    send(res, res.statusCode || 200, String(body || ""));
  };
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  const type = req.headers["content-type"] || "";
  if (type.includes("application/json")) {
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }
  return raw;
}

async function handleApi(req, res, url) {
  const relative = decodeURIComponent(url.pathname.replace(/^\/api\/?/, ""));
  const apiFile = path.resolve(API_DIR, `${relative}.js`);
  if (!apiFile.startsWith(API_DIR + path.sep) || !fs.existsSync(apiFile)) {
    return send(res, 404, JSON.stringify({ error: "api route not found" }), "application/json; charset=utf-8");
  }

  decorateResponse(res);
  req.query = Object.fromEntries(url.searchParams.entries());
  req.body = await readBody(req);

  try {
    delete require.cache[require.resolve(apiFile)];
    const handler = require(apiFile);
    await handler(req, res);
    if (!res.writableEnded) res.end();
  } catch (err) {
    console.error("[ADMIN LOCAL]", err);
    if (!res.writableEnded) {
      send(res, 500, JSON.stringify({ error: err.message || "internal error" }), "application/json; charset=utf-8");
    }
  }
}

function handleStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(requested)}`);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return send(res, 404, "Not found");
  }
  res.setHeader("Content-Type", MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return handleStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`[ADMIN] Local admin panel: http://localhost:${PORT}`);
});
