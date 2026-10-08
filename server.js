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

function checkBasic(req, wantUser, wantPass) {
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
  return timingSafeEqual(user, wantUser) && timingSafeEqual(pass, wantPass);
}
const isAuthorized = (req) => checkBasic(req, SITE_USER, SITE_PASSWORD);

// Private admin page (visitor numbers). Switched on only when ADMIN_PASSWORD is set in Railway; otherwise /admin does not exist.
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const adminFails = new Map(); // ip -> failed sign-in times
let adminFailsAll = []; // every failed sign-in from anyone, so faking a visitor address cannot get around the limit
function adminLockedOut(ip) {
  const now = Date.now();
  const list = (adminFails.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  adminFails.set(ip, list);
  adminFailsAll = adminFailsAll.filter((t) => now - t < 15 * 60 * 1000);
  return list.length >= 10 || adminFailsAll.length >= 40;
}
function adminFailed(ip) {
  const list = adminFails.get(ip) || [];
  list.push(Date.now());
  adminFails.set(ip, list);
  adminFailsAll.push(Date.now());
  if (adminFails.size > 2000) adminFails.clear();
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

// Visitor counting. DATA_DIR should point at a Railway Volume (for example /data) so the numbers survive site updates.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const pageTitles = {};
for (const [slug, e] of Object.entries(SEO.routes)) pageTitles[slug === "" ? "/" : "/" + slug] = String(e.title || "").split(" | ")[0];
const analytics = require("./analytics")({
  dataDir: DATA_DIR,
  isRoute: (s) => hasRoute(s),
  siteHost: SEO.origin ? new URL(SEO.origin).hostname.replace(/^www\./, "") : "",
  titles: pageTitles,
});
setInterval(() => analytics.flush(), 30000).unref();
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { analytics.flush(); process.exit(0); });
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
    if (slug === "voices" && reviews.publishedCount() === 0) tags.push('<meta name="robots" content="noindex">'); // nothing to show yet
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
  const urls = Object.entries(SEO.routes)
    .filter(([slug, e]) => e.sitemap || (slug === "voices" && reviews.publishedCount() > 0))
    .map(([, e]) => `  <url><loc>${escText(SEO.origin + e.canonical)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

const robotsTxt = () => `User-agent: *\nAllow: /\nDisallow: /review/\n\nSitemap: ${SEO.origin}/sitemap.xml\n`;

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
// ---- Weekly summary and alert emails (same Resend account as the contact form) ----
// DIGEST_TO : where the Monday summary and alerts go. Falls back to MAIL_TO_OVERRIDE. Leave both unset to switch these emails off.
const digest = require("./digest");
const DIGEST_TO = process.env.DIGEST_TO || MAIL_TO_OVERRIDE || "";
const ADMIN_URL = (SEO.origin || "") + "/admin";
async function sendMail({ to, subject, text, html, replyTo }) {
  if (!RESEND_API_KEY || !to) return { ok: false, reason: "not_configured" };
  try {
    const r = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text, ...(html ? { html } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!r.ok) { console.error("mail: the mail service refused a summary email, status", r.status); return { ok: false, reason: "refused" }; }
    return { ok: true };
  } catch (e) {
    console.error("mail: could not reach the mail service:", e.message);
    return { ok: false, reason: "unreachable" };
  }
}
const sendWeekly = () => sendMail({ to: DIGEST_TO, ...digest.build(analytics.weekly(), ADMIN_URL) });
const maskEmail = (e) => (e ? e.replace(/^(.).*(@.*)$/, "$1***$2") : "");
async function digestTick() {
  try {
    if (!DIGEST_TO || !RESEND_API_KEY) return;
    const meta = analytics.meta(), today = analytics.dayKey(), now = Date.now(), RETRY = 3 * 3600 * 1000;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date());
    const weekday = parts.find((p) => p.type === "weekday").value, hour = Number(parts.find((p) => p.type === "hour").value);
    if (weekday === "Mon" && hour >= 8 && meta.lastDigest !== today && !(meta.digestTry && now - meta.digestTry < RETRY)) {
      meta.digestTry = now;
      const r = await sendWeekly();
      if (r.ok) { meta.lastDigest = today; console.log("digest: weekly summary sent"); }
      analytics.save();
    }
    meta.alerted = meta.alerted || {};
    for (const k of Object.keys(meta.alerted)) if (!k.startsWith(today)) delete meta.alerted[k];
    for (const alert of analytics.alerts()) {
      const key = today + ":" + alert.id, prior = meta.alerted[key];
      if (prior && (prior.ok || now - prior.t < RETRY)) continue;
      const r = await sendMail({ to: DIGEST_TO, ...digest.buildAlert(alert, ADMIN_URL) });
      meta.alerted[key] = { t: now, ok: r.ok };
      analytics.save();
    }
  } catch (e) { console.error("digest: check failed:", e.message); }
}
setInterval(digestTick, 10 * 60 * 1000).unref();
setTimeout(digestTick, 90 * 1000).unref();

// Voices of the Collective: verified, invitation-only reviews with manual approval (see reviews.js).
// RETENTION_DAYS: how long private customer details are kept (default 730 = two years).
const reviews = require("./reviews")({
  dataDir: DATA_DIR,
  sendMail,
  siteOrigin: SEO.origin || "",
  notifyTo: DIGEST_TO,
  retentionDays: process.env.RETENTION_DAYS,
});
setInterval(() => reviews.purge(), 24 * 3600 * 1000).unref();

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
    if (b.website) { analytics.blocked("spam"); return reply(res, 200, { ok: true }); } // hidden field only bots fill in: pretend it worked
    const name = oneLine(b.name), email = oneLine(b.email), topic = String(b.topic || ""), message = String(b.message || "").trim();
    if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 200 || !Object.prototype.hasOwnProperty.call(TOPIC_TO, topic) || !message || message.length > 5000) {
      return reply(res, 400, { error: "invalid" });
    }
    if (!RESEND_API_KEY) { analytics.form(topic, false); return reply(res, 503, { error: "not_configured" }); }
    if (tooMany(ip)) { analytics.blocked("rate"); return reply(res, 429, { error: "rate" }); }
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
        analytics.form(topic, false);
        return reply(res, 502, { error: "send_failed" });
      }
      analytics.form(topic, true);
      reply(res, 200, { ok: true });
    } catch (e) {
      console.error("contact: could not reach the mail service:", e.message);
      analytics.form(topic, false);
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
    // Private admin page: its own password, checked before anything else, hidden entirely until ADMIN_PASSWORD is set.
    if (urlPath === "/admin" || urlPath.startsWith("/admin/")) {
      const wantsPost = req.method === "POST";
      const isPage = urlPath === "/admin" || urlPath === "/admin/";
      const isReviewsPage = urlPath === "/admin/reviews" || urlPath === "/admin/reviews/";
      const isReviewsApi = urlPath.startsWith("/admin/reviews/") && !isReviewsPage;
      const known = isPage || isReviewsPage || isReviewsApi || urlPath === "/admin/data.json" || urlPath === "/admin/send-digest";
      const methodOk = urlPath === "/admin/send-digest" ? wantsPost : isReviewsApi ? (wantsPost || req.method === "GET") : (req.method === "GET" || req.method === "HEAD");
      if (!ADMIN_PASSWORD || !known || !methodOk) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      const adminHeaders = {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      };
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (adminLockedOut(ip)) {
        res.writeHead(429, { ...adminHeaders, "Content-Type": "text/plain" }).end("Too many attempts. Try again in a few minutes.");
        return;
      }
      if (!checkBasic(req, ADMIN_USER, ADMIN_PASSWORD)) {
        if (req.headers["authorization"]) adminFailed(ip);
        res.writeHead(401, {
          ...adminHeaders,
          "Content-Type": "text/plain; charset=utf-8",
          "WWW-Authenticate": 'Basic realm="Rooted & Crowned Admin", charset="UTF-8"',
        }).end("Sign in required.");
        return;
      }
      if (urlPath === "/admin/data.json") {
        const days = Math.min(800, Math.max(1, parseInt(new URL(req.url, "http://x").searchParams.get("days"), 10) || 30));
        const snap = analytics.snapshot(days);
        snap.digest = { on: !!(DIGEST_TO && RESEND_API_KEY), to: maskEmail(DIGEST_TO) };
        res.writeHead(200, { ...adminHeaders, "Content-Type": "application/json" }).end(JSON.stringify(snap));
        return;
      }
      if (wantsPost && req.headers["x-admin-action"] !== "1") {
        // the custom header cannot be added by another website, which blocks cross-site requests
        res.writeHead(403, { ...adminHeaders, "Content-Type": "application/json" }).end('{"error":"forbidden"}');
        return;
      }
      if (urlPath === "/admin/send-digest") {
        if (!DIGEST_TO) { res.writeHead(400, { ...adminHeaders, "Content-Type": "application/json" }).end('{"error":"no_recipient"}'); return; }
        sendWeekly().then((r) => res.writeHead(r.ok ? 200 : 502, { ...adminHeaders, "Content-Type": "application/json" }).end(JSON.stringify({ ok: r.ok, reason: r.reason || null })));
        return;
      }
      if (isReviewsApi) {
        if (!reviews.handleAdmin(req, res, urlPath, new URL(req.url, "http://x").searchParams, adminHeaders)) res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      fs.readFile(path.join(__dirname, "private", isReviewsPage ? "reviews-admin.html" : "admin.html"), (err, html) => {
        if (err) res.writeHead(500, { ...adminHeaders, "Content-Type": "text/plain" }).end("Admin page missing.");
        else res.writeHead(200, { ...adminHeaders, "Content-Type": "text/html; charset=utf-8" }).end(html);
      });
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
    if (urlPath.startsWith("/api/review")) {
      if (reviews.handlePublic(req, res, urlPath, new URL(req.url, "http://x").searchParams)) return;
    }
    // a customer's private review link: /review/<one-time token>. Never indexed, never shown in referrers.
    if (urlPath.startsWith("/review/") && /^\/review\/[A-Za-z0-9_-]{20,80}$/.test(urlPath)) {
      fs.readFile(path.join(__dirname, "private", "review.html"), (err, html) => {
        const h = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff" };
        if (err) res.writeHead(500, { ...h, "Content-Type": "text/plain" }).end("Page missing.");
        else res.writeHead(200, { ...h, "Content-Type": "text/html; charset=utf-8" }).end(html);
      });
      return;
    }
    if (urlPath === "/api/hit") {
      // the page reports each page view and button click here; answers instantly and keeps nothing personal
      if (req.method !== "POST") { res.writeHead(405).end(); return; }
      let size = 0;
      const parts = [];
      req.on("data", (c) => { size += c.length; if (size > 4000) req.destroy(); else parts.push(c); });
      req.on("end", () => {
        try { analytics.beacon(req, JSON.parse(Buffer.concat(parts).toString("utf8"))); } catch {}
        res.writeHead(204, { "Cache-Control": "no-store" }).end();
      });
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
      analytics.crawler(req, slug);
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
          analytics.notFound(urlPath, req);
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
