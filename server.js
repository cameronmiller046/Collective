// Zero-dependency static server for Railway. Serves ./public on $PORT.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");

// Site-wide password gate, toggled via Railway env vars (no redeploy needed):
// set SITE_LOCKED=true + SITE_PASSWORD=... to lock the site, remove/unset to reopen it.
const SITE_LOCKED = process.env.SITE_LOCKED === "true";
const SITE_USER = process.env.SITE_USER || "rootedandcrowned";
const SITE_PASSWORD = process.env.SITE_PASSWORD || "";

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAuthorized(req) {
  const header = req.headers["authorization"] || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return false;
  let decoded;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return timingSafeEqual(user, SITE_USER) && timingSafeEqual(pass, SITE_PASSWORD);
}
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

http
  .createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    if (urlPath === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    if (SITE_LOCKED && !isAuthorized(req)) {
      res.writeHead(401, {
        "Content-Type": "text/html; charset=utf-8",
        "WWW-Authenticate": 'Basic realm="Rooted & Crowned Collective", charset="UTF-8"',
      }).end("<!doctype html><title>Site temporarily offline</title><body style=\"font-family:sans-serif;text-align:center;padding:80px 20px\"><h1>We'll be back soon.</h1><p>This site is temporarily offline. Enter the access password to continue.</p></body>");
      return;
    }
    let file = path.normalize(path.join(ROOT, urlPath));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    fs.stat(file, (err, stat) => {
      if (!err && stat.isDirectory()) file = path.join(file, "index.html");
      else if (err) file = path.join(ROOT, "index.html"); // clean URLs fall back to the site
      fs.readFile(file, (err2, data) => {
        if (err2) {
          res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
          return;
        }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, {
          "Content-Type": TYPES[ext] || "application/octet-stream",
          "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(data);
      });
    });
  })
  .listen(PORT, "0.0.0.0", () => console.log(`Rooted & Crowned site on :${PORT}`));
