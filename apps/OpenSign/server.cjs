#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console */
// Unified server for the production build.
// - Proxies /api/* requests to the backend Parse server (strips /api prefix)
// - Serves real files from ./build (including dotfile dirs like .well-known)
// - Falls back to /index.html only when the requested path does not exist
//   (SPA client-side routing).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "build");
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

// Backend server for API proxying — strip /api prefix when forwarding
const API_HOST = process.env.API_HOST || "server";
const API_PORT = Number(process.env.API_PORT) || 8085;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".wasm": "application/wasm",
  ".xml": "application/xml; charset=utf-8"
};

function contentType(filePath) {
  return mime[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function safeJoin(reqPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(reqPath.split("?")[0].split("#")[0]);
    if (decoded.indexOf('\0') !== -1) return null;
  } catch {
    return null;
  }
  const resolved = path.normalize(path.join(root, decoded));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function cacheControl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const relativePath = path.relative(root, filePath);
  const isBuildAsset =
    relativePath === "assets" ||
    relativePath.startsWith(`assets${path.sep}`);

  if (ext === ".html" || ext === "") {
    return "no-cache";
  }

  return isBuildAsset
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

function streamFile(req, res, filePath, stats) {
  const headers = {
    "Content-Type": contentType(filePath),
    "Content-Length": stats.size,
    "Last-Modified": stats.mtime.toUTCString(),
    "Cache-Control": cacheControl(filePath)
  };
  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    return res.end();
  }
  const stream = fs.createReadStream(filePath);
  stream.on("error", (err) => {
    console.error("Stream error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    } else {
      res.destroy();
    }
  });
  res.on("close", () => {
    if (!stream.destroyed) stream.destroy();
  });
  res.on("error", (err) => {
    console.error("Response error:", err);
    if (!stream.destroyed) stream.destroy();
  });
  res.writeHead(200, headers);
  stream.pipe(res);
}

function sendIndex(req, res) {
  const indexPath = path.join(root, "index.html");
  fs.stat(indexPath, (err, stats) => {
    if (err || !stats || !stats.isFile()) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      return res.end("index.html not found");
    }
    streamFile(req, res, indexPath, stats);
  });
}

// Forward /api/* requests to the backend server, stripping the /api prefix.
// e.g. /api/app/classes/User → http://server:8085/app/classes/User
function proxyToBackend(req, res) {
  const targetPath = req.url.slice(4); // strip leading '/api'
  const headers = { ...req.headers };
  delete headers["host"];
  delete headers["connection"];

  const options = {
    hostname: API_HOST,
    port: API_PORT,
    path: targetPath,
    method: req.method,
    headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const responseHeaders = { ...proxyRes.headers };
    delete responseHeaders["transfer-encoding"];
    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error("Proxy error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway");
    }
  });

  req.pipe(proxyReq, { end: true });
}

const server = http.createServer((req, res) => {
  const reqUrl = req.url || "/";

  // Proxy all /api/* traffic to the backend
  if (reqUrl.startsWith("/api/") || reqUrl === "/api") {
    return proxyToBackend(req, res);
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD, OPTIONS" });
    return res.end();
  }

  const filePath = safeJoin(reqUrl);
  if (!filePath) {
    res.writeHead(400);
    return res.end("Bad Request");
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      // No file at this path → SPA fallback to index.html
      return sendIndex(req, res);
    }
    if (stats.isFile()) {
      return streamFile(req, res, filePath, stats);
    }
    if (stats.isDirectory()) {
      const indexInDir = path.join(filePath, "index.html");
      return fs.stat(indexInDir, (dirErr, dirStats) => {
        if (!dirErr && dirStats && dirStats.isFile()) {
          return streamFile(req, res, indexInDir, dirStats);
        }
        return sendIndex(req, res);
      });
    }
    // Path exists but is neither file nor directory → SPA fallback
    return sendIndex(req, res);
  });
});

server.listen(port, host, () => {
  console.log(`Serving ${root} on http://${host}:${port}`);
  console.log(`Proxying /api/* → http://${API_HOST}:${API_PORT}`);
});