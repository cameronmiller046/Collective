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

// ---- SEO: real page addresses, per-page title/description, sitemap and robots ----
// public/seo.json lists every page address once. If it fails to load, the site still serves normally.
let SEO = { origin: "", siteName: "", image: "", routes: {} };
let TEMPLATE = "";
// The page file is written with hash links (#/about) and relative image paths (assets/...).
// Real addresses need real links and absolute image paths, so they are converted once at startup.
function cleanUrls(html) {
  return html
    .replace(/href="#\//g, () => 'href="/')
    .replace(/href="#\$\{h\}"/g, () => 'href="${h}"')
    .replace(/(["'(])assets\//g, (m, q) => q + "/assets/");
}
try {
  SEO = JSON.parse(fs.readFileSync(path.join(ROOT, "seo.json"), "utf8"));
  TEMPLATE = cleanUrls(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"));
} catch (e) {
  console.error("SEO setup failed; serving the page without per-address tags:", e.message);
}
const hasRoute = (slug) => Object.prototype.hasOwnProperty.call(SEO.routes, slug);
const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");

function renderPage(slug, notFound) {
  // drop the site-wide share/canonical tags written in the page file; each address gets its own
  let html = TEMPLATE
    .replace(/<meta property="og:[^>]*>\s*/g, "")
    .replace(/<meta name="twitter:[^>]*>\s*/g, "")
    .replace(/<link rel="canonical"[^>]*>\s*/g, "");
  const tags = [];
  if (notFound) {
    html = html.replace(/<title>[^<]*<\/title>/, () => `<title>Page not found | ${escText(SEO.siteName)}</title>`);
    tags.push('<meta name="robots" content="noindex">');
  } else {
    const e = SEO.routes[slug];
    const url = SEO.origin + e.canonical;
    const image = SEO.origin + SEO.image;
    html = html
      .replace(/<title>[^<]*<\/title>/, () => `<title>${escText(e.title)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escAttr(e.description)}">`);
    tags.push(
      `<link rel="canonical" href="${escAttr(url)}">`,
      '<meta property="og:type" content="website">',
      `<meta property="og:site_name" content="${escAttr(SEO.siteName)}">`,
      `<meta property="og:title" content="${escAttr(e.title)}">`,
      `<meta property="og:description" content="${escAttr(e.description)}">`,
      `<meta property="og:url" content="${escAttr(url)}">`,
      `<meta property="og:image" content="${escAttr(image)}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      `<meta property="og:image:alt" content="${escAttr(SEO.imageAlt || SEO.siteName)}">`,
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:image" content="${escAttr(image)}">`
    );
  }
  return html.replace("</head>", () => tags.join("\n") + "\n</head>");
}

function sitemapXml() {
  const urls = Object.values(SEO.routes)
    .filter((e) => e.sitemap)
    .map((e) => `  <url><loc>${escText(SEO.origin + e.canonical)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

const robotsTxt = () => `User-agent: *\nAllow: /\n\nSitemap: ${SEO.origin}/sitemap.xml\n`;

// ---- Contact form: emails each message to the right address for its topic, through Resend ----
// The API key lives only in Railway's variables (RESEND_API_KEY). It is never written into the site files.
// MAIL_FROM  : sender shown on the email. Use an address on a domain verified in Resend (until then the default only reaches the Resend account owner).
// MAIL_TO_OVERRIDE : when set, every message goes to this one address instead (for testing).
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_URL = process.env.RESEND_API_URL || "https://api.resend.com/emails";
const MAIL_FROM = process.env.MAIL_FROM || "Rooted & Crowned Website <onboarding@resend.dev>";
const MAIL_TO_OVERRIDE = process.env.MAIL_TO_OVERRIDE || "";
const MAIL_DOMAIN = "rootedandcrownedcollective.org";
const TOPIC_TO = {
  "General question": "hello",
  "Podcast guest inquiry": "podcast",
  "Suggest a podcast topic": "podcast",
  "Speaking request": "partnerships",
  "Workshop request": "partnerships",
  "Partnership / collaboration": "partnerships",
  "Vendor / community event": "community",
  "Sponsorship / community partner": "partnerships",
  "Infinite Possibilities inquiry": "infinitepossibilities",
  "Media inquiry": "podcast",
  "Customer / order assistance": "shop",
  "App technical support": "hello",
};
const sends = new Map(); // ip -> recent send times, a small guard against spam
function tooMany(ip) {
  const now = Date.now();
  const recent = (sends.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 5) { sends.set(ip, recent); return true; }
  recent.push(now);
  sends.set(ip, recent);
  if (sends.size > 5000) sends.clear();
  return false;
}
const oneLine = (s) => String(s || "").replace(/[\r\n]+/g, " ").trim();
function reply(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(obj));
}
function handleContact(req, res) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > 20000) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", async () => {
    let b;
    try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reply(res, 400, { error: "invalid" }); }
    if (b.website) return reply(res, 200, { ok: true }); // hidden field only bots fill in: pretend it worked
    const name = oneLine(b.name), email = oneLine(b.email), topic = String(b.topic || ""), message = String(b.message || "").trim();
    if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 200 || !Object.prototype.hasOwnProperty.call(TOPIC_TO, topic) || !message || message.length > 5000) {
      return reply(res, 400, { error: "invalid" });
    }
    if (!RESEND_API_KEY) return reply(res, 503, { error: "not_configured" });
    if (tooMany(ip)) return reply(res, 429, { error: "rate" });
    const to = MAIL_TO_OVERRIDE || `${TOPIC_TO[topic]}@${MAIL_DOMAIN}`;
    try {
      const r = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: MAIL_FROM,
          to: [to],
          reply_to: email,
          subject: `[${topic}] ${name}`,
          text: `New message from the website contact form\n\nName: ${name}\nEmail: ${email}\nTopic: ${topic}\n\n${message}\n`,
        }),
      });
      if (!r.ok) {
        console.error("contact: mail service refused the message, status", r.status);
        return reply(res, 502, { error: "send_failed" });
      }
      reply(res, 200, { ok: true });
    } catch (e) {
      console.error("contact: could not reach the mail service:", e.message);
      reply(res, 502, { error: "send_failed" });
    }
  });
}

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
    if (urlPath === "/api/contact") {
      if (req.method !== "POST") return void reply(res, 405, { error: "method" });
      handleContact(req, res);
      return;
    }
    const slug = urlPath.replace(/^\/+|\/+$/g, "");
    // one address per page: /index.html and trailing slashes redirect to the clean address
    if (urlPath === "/index.html" || (urlPath.length > 1 && urlPath.endsWith("/"))) {
      const search = new URL(req.url, "http://x").search;
      res.writeHead(301, { Location: (urlPath === "/index.html" ? "/" : "/" + slug) + search }).end();
      return;
    }
    if (SEO.origin && urlPath === "/robots.txt") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" }).end(robotsTxt());
      return;
    }
    if (SEO.origin && urlPath === "/sitemap.xml") {
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache" }).end(sitemapXml());
      return;
    }
    if (TEMPLATE && hasRoute(slug)) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      }).end(renderPage(slug, false));
      return;
    }
    let file = path.normalize(path.join(ROOT, urlPath));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    fs.stat(file, (err, stat) => {
      if (err || stat.isDirectory()) {
        // not a file and not a known page: a real 404 (missing images get plain text; pages still show the site)
        if (path.extname(urlPath)) {
          res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        } else if (TEMPLATE) {
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }).end(renderPage(slug, true));
        } else {
          fs.readFile(path.join(ROOT, "index.html"), (e, data) => {
            if (e) res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
            else res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" }).end(data);
          });
        }
        return;
      }
      fs.readFile(file, (err2, data) => {
        if (err2) {
          res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
          return;
        }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, {
          "Content-Type": TYPES[ext] || "application/octet-stream",
          "Cache-Control": ext === ".html" || ext === ".json" ? "no-cache" : "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(data);
      });
    });
  })
  .listen(PORT, "0.0.0.0", () => console.log(`Rooted & Crowned site on :${PORT}`));
