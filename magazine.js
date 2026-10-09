// A Crowned Perspective: the monthly digital magazine. No dependencies.
// An issue stays completely private (its page images are never served) until BOTH are true:
//   1) the owner has approved it in /admin/magazine, and 2) its release time (midnight Eastern by default) has arrived.
// Page images live in private/magazine/<issue-id>/ (or MAGAZINE_DIR) and are only reachable through the gated route below.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TZ = "America/New_York";
const COUNTDOWN_DAYS = 60; // the live countdown appears this many days before release
const TYPES = { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf" };
const partsFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const clean = (s, n) => String(s ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, n);

// the exact moment a given Atlanta date and time happens, correct on both sides of daylight saving
function etInstant(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number), [hh, mm] = (timeStr || "00:00").split(":").map(Number);
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(partsFmt.formatToParts(new Date(guess)).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
    guess -= Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - want;
  }
  return guess;
}

const DEFAULT_ISSUE = {
  id: "issue-1", title: "A Crowned Perspective", tagline: "The Journey Begins In YOU.",
  edition: "The Fall Founder’s Edition", theme: "A Season of Returning to Self",
  volume: "Volume 1 · Issue 1", dateLabel: "November 2026",
  releaseDate: "2026-11-01", releaseTime: "00:00", approved: false, updatedAt: null,
};

module.exports = function createMagazine({ dataDir, mediaDir, adminSecret, uploadToken }) {
  const file = path.join(dataDir, "magazine.json");
  let db = { issues: [{ ...DEFAULT_ISSUE }] };
  let persistent = true;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (j && Array.isArray(j.issues) && j.issues.length) db = j;
    }
    fs.accessSync(dataDir, fs.constants.W_OK);
  } catch (e) {
    persistent = false;
    console.error("magazine: cannot use", dataDir, "(", e.message, ") - keeping settings in memory only");
  }
  const save = () => {
    if (!persistent) return;
    try { const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, file); }
    catch (e) { console.error("magazine: could not save:", e.message); }
  };

  const releaseMs = (it) => (it.releaseDate ? etInstant(it.releaseDate, it.releaseTime || "00:00") : null);
  const isReleased = (it) => !!it.approved && releaseMs(it) !== null && Date.now() >= releaseMs(it);
  // the issue the page shows: the newest released one, otherwise the next one coming up
  function current() {
    const released = db.issues.filter(isReleased).sort((a, b) => releaseMs(b) - releaseMs(a));
    if (released.length) return released[0];
    const upcoming = db.issues.filter((i) => i.releaseDate).sort((a, b) => releaseMs(a) - releaseMs(b));
    return upcoming[0] || db.issues[0];
  }
  function files(id) {
    try {
      return fs.readdirSync(path.join(mediaDir, id)).filter((f) => /^[A-Za-z0-9._-]+$/.test(f) && TYPES[path.extname(f).toLowerCase()]).sort(natural);
    } catch { return []; }
  }
  // Page order: private/magazine/<issue>/order.json lists page files in reading order; a null entry is a deliberate blank page
  // (an inside cover, or a filler that keeps open-book pairs side by side). Without that file, pages follow their file names.
  const pageFiles = (id) => {
    const imgs = files(id).filter((f) => !/\.pdf$/i.test(f));
    try {
      const j = JSON.parse(fs.readFileSync(path.join(mediaDir, id, "order.json"), "utf8"));
      if (Array.isArray(j) && j.every((e) => e === null || (typeof e === "string" && imgs.includes(e))) && j.some(Boolean)) return j;
    } catch {}
    return imgs;
  };
  const pdfFile = (id) => files(id).find((f) => /\.pdf$/i.test(f)) || null;

  // admin-only preview links: valid for 24 hours, signed with the admin password
  const sign = (exp) => crypto.createHmac("sha256", String(adminSecret || "no-secret")).update("magazine-preview:" + exp).digest("hex").slice(0, 32);
  const previewToken = () => { const exp = Date.now() + 24 * 3600 * 1000; return exp + "." + sign(exp); };
  function validPreview(tok) {
    if (!adminSecret || !tok) return false;
    const [exp, sig] = String(tok).split(".");
    if (!/^\d{10,15}$/.test(exp || "") || Number(exp) < Date.now() || !sig) return false;
    const a = Buffer.from(sig), b = Buffer.from(sign(exp));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function state(it, preview) {
    if (preview) return "released";
    if (isReleased(it)) return "released";
    return it.releaseDate ? "countdown" : "tba";
  }
  const isLiveNow = () => isReleased(current());

  function publicInfo(preview) {
    const it = current(), st = state(it, preview), rel = releaseMs(it);
    const out = {
      state: st, serverNow: Date.now(), preview: !!preview,
      issue: { id: it.id, title: it.title, tagline: it.tagline, edition: it.edition, theme: it.theme, volume: it.volume, dateLabel: it.dateLabel },
    };
    if (st !== "released" && rel) {
      out.releaseAt = rel;
      out.releaseLabel = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(rel));
      out.releaseTimeLabel = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(rel));
      out.showCountdown = rel - Date.now() <= COUNTDOWN_DAYS * 86400000;
      out.pendingApproval = Date.now() >= rel && !it.approved; // the date has come but the issue is not approved yet
    }
    if (st === "released") {
      const q = preview ? "?preview=" + encodeURIComponent(preview) : "";
      out.pages = pageFiles(it.id).map((f) => (f ? `/magazine-media/${it.id}/${f}${q}` : null));
      const pdf = pdfFile(it.id);
      if (pdf) out.pdf = `/magazine-media/${it.id}/${pdf}${q}`;
    }
    return out;
  }

  const send = (res, code, obj, extra) => res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", ...(extra || {}) }).end(JSON.stringify(obj));

  // public: the info feed and the gated page images. Returns true when it handled the request.
  function handlePublic(req, res, urlPath, params) {
    if (urlPath === "/api/magazine" && req.method === "GET") {
      const tok = params.get("preview");
      send(res, 200, publicInfo(validPreview(tok) ? tok : null));
      return true;
    }
    const m = /^\/magazine-media\/([a-z0-9-]{1,40})\/([A-Za-z0-9._-]{1,100})$/.exec(urlPath);
    if (m && req.method === "GET") {
      const [, id, name] = m, it = db.issues.find((i) => i.id === id), tok = params.get("preview");
      const preview = validPreview(tok);
      const ext = path.extname(name).toLowerCase();
      // only pages listed in the issue's order (and its PDF) are ever served; any other file in the folder stays unreachable
      const listed = it ? pageFiles(id).filter(Boolean) : [];
      if (!it || !TYPES[ext] || (!preview && !isReleased(it)) || !(listed.includes(name) || name === pdfFile(id))) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return true; }
      fs.readFile(path.join(mediaDir, id, name), (err, data) => {
        if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return; }
        res.writeHead(200, { "Content-Type": TYPES[ext], "Cache-Control": preview ? "no-store" : "public, max-age=3600", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": ext === ".pdf" ? "noindex" : "all" }).end(data);
      });
      return true;
    }
    return false;
  }

  // One-time page upload. It exists only while MAGAZINE_UPLOAD_TOKEN is set in Railway; with no token set, this route does not exist.
  // PUT /api/magazine-upload/<issue>/<page-NN.webp | order.json | name.pdf>, "Authorization: Bearer <token>"; GET /api/magazine-upload/<issue> lists what is stored.
  const upFails = new Map();
  const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
  function handleUpload(req, res, urlPath) {
    if (!uploadToken) return false;
    const m = /^\/api\/magazine-upload\/([a-z0-9-]{1,40})(?:\/([A-Za-z0-9._-]{1,100}))?$/.exec(urlPath);
    if (!m || (req.method !== "PUT" && req.method !== "GET")) return false;
    const [, id, name] = m;
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const now = Date.now(), recent = (upFails.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
    if (recent.length >= 10) { send(res, 429, { error: "Too many attempts." }); return true; }
    const given = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
    if (!crypto.timingSafeEqual(sha(given), sha(uploadToken))) { recent.push(now); upFails.set(ip, recent); send(res, 401, { error: "Unauthorized." }); return true; }
    if (req.method === "GET") {
      let list = [];
      try { list = fs.readdirSync(path.join(mediaDir, id)).map((f) => ({ name: f, bytes: fs.statSync(path.join(mediaDir, id, f)).size })); } catch {}
      send(res, 200, { issue: id, files: list });
      return true;
    }
    if (!name || !(name === "order.json" || /^page-\d\d\.webp$/.test(name) || /^[A-Za-z0-9._-]+\.pdf$/.test(name))) { send(res, 400, { error: "That file name is not allowed." }); return true; }
    const parts = []; let size = 0, tooBig = false;
    req.on("data", (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > 12 * 1024 * 1024) { tooBig = true; parts.length = 0; send(res, 413, { error: "File too large." }, { Connection: "close" }); return; }
      parts.push(c);
    });
    req.on("end", () => {
      if (tooBig) return;
      try {
        fs.mkdirSync(path.join(mediaDir, id), { recursive: true });
        const dest = path.join(mediaDir, id, name), tmp = dest + ".part";
        fs.writeFileSync(tmp, Buffer.concat(parts)); fs.renameSync(tmp, dest);
        send(res, 200, { ok: true, name, bytes: size });
      } catch (e) { console.error("magazine: upload failed:", e.message); send(res, 500, { error: "Could not save the file." }); }
    });
    return true;
  }

  // admin: read and save the release settings (the caller has already checked the sign-in and the safety header)
  function handleAdmin(req, res, urlPath, headers, readBody) {
    if (urlPath === "/admin/magazine/data.json" && req.method === "GET") {
      const now = Date.now();
      send(res, 200, {
        persistent, timezone: TZ, serverNow: now, previewToken: previewToken(), countdownDays: COUNTDOWN_DAYS,
        issues: db.issues.map((i) => ({ ...i, releaseAt: releaseMs(i), released: isReleased(i), pages: pageFiles(i.id).filter(Boolean), blanks: pageFiles(i.id).filter((f) => !f).length, pdf: pdfFile(i.id) })),
      }, headers);
      return true;
    }
    if (urlPath === "/admin/magazine/save" && req.method === "POST") {
      readBody((b) => {
        if (!b) return send(res, 400, { error: "Bad request." }, headers);
        const it = db.issues.find((i) => i.id === b.id);
        if (!it) return send(res, 404, { error: "Issue not found." }, headers);
        const date = clean(b.releaseDate, 10), time = clean(b.releaseTime || "00:00", 5);
        const realDate = (s) => { const [y, m, d] = s.split("-").map(Number), t = new Date(Date.UTC(y, m - 1, d)); return y >= 2024 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
        if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !realDate(date))) return send(res, 400, { error: "Choose a valid release date." }, headers);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return send(res, 400, { error: "Choose a valid release time." }, headers);
        if (b.approved === true && !date) return send(res, 400, { error: "Set a release date before approving the issue." }, headers);
        if (b.approved === true && !pageFiles(it.id).filter(Boolean).length) return send(res, 400, { error: "There are no page images for this issue yet, so it can't be approved." }, headers);
        // only the fields that were actually sent are changed
        const text = (k, n) => { if (b[k] !== undefined) it[k] = clean(b[k], n); };
        text("tagline", 160); text("edition", 120); text("theme", 160); text("volume", 80); text("dateLabel", 40);
        if (clean(b.title, 120)) it.title = clean(b.title, 120);
        Object.assign(it, { releaseDate: date, releaseTime: time, approved: b.approved === true, updatedAt: new Date().toISOString() });
        save();
        send(res, 200, { ok: true }, headers);
      });
      return true;
    }
    return false;
  }

  return { handlePublic, handleAdmin, handleUpload, isLiveNow, etInstant, current: () => current(), publicInfo };
};
