// Built-in, privacy-friendly visitor counting for the Rooted & Crowned site. No dependencies.
// What is stored: daily totals only (page views, visits, devices, referrers, button clicks, goals, engagement, form results, crawler hits, broken links, and visits per country / U.S. state).
// What is never stored: IP addresses, names, emails, message text, cookies or any per-person record.
// A visitor is counted once per day with a throw-away fingerprint that lives only in memory and changes daily.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TZ = "America/New_York"; // days roll over at midnight Atlanta time
const KEEP_DAYS = 800;
const CAP = { pages: 80, refs: 120, clicks: 120, notFound: 100, bots: 40, botPages: 80, forms: 40, geo: 320 };
const GOALS = {
  program: "Clicked a program or sign-up button",
  books: "Clicked a book button",
  shop: "Clicked Shop",
  support: "Clicked a support or giving button",
  email: "Clicked an email link",
  social: "Clicked a social or podcast link",
};
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" });
const dayKey = (d = new Date()) => dayFmt.format(d);
const hourNow = () => Number(hourFmt.formatToParts(new Date()).find((p) => p.type === "hour").value) % 24;
const noon = (key) => new Date(key + "T12:00:00Z"); // noon UTC of an Atlanta date, so daylight-saving changes cannot repeat or skip a day
const shift = (key, days) => new Date(noon(key).getTime() + days * 86400000).toISOString().slice(0, 10);

const BOT_NAMES = [
  [/googlebot|google-inspectiontool|googleother|apis-google|adsbot-google/i, "Googlebot"],
  [/bingbot|bingpreview|msnbot/i, "Bingbot"],
  [/duckduckbot/i, "DuckDuckBot"],
  [/applebot/i, "Applebot"],
  [/yandex/i, "Yandex"],
  [/baiduspider/i, "Baidu"],
  [/facebookexternalhit|facebot/i, "Facebook link preview"],
  [/twitterbot/i, "X / Twitter link preview"],
  [/linkedinbot/i, "LinkedIn link preview"],
  [/slackbot|slack-imgproxy/i, "Slack link preview"],
  [/whatsapp/i, "WhatsApp link preview"],
  [/telegrambot/i, "Telegram link preview"],
  [/discordbot/i, "Discord link preview"],
  [/ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|amazonbot/i, "SEO / AI crawlers"],
];
const GENERIC_BOT = /bot\b|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget|python|go-http|java\/|okhttp|axios|node-fetch|scrapy|httpclient|libwww/i;

function botName(ua) {
  ua = String(ua || "");
  for (const [re, name] of BOT_NAMES) if (re.test(ua)) return name;
  if (!ua || GENERIC_BOT.test(ua)) return "Other bots & tools";
  return null;
}
function deviceOf(ua) {
  ua = String(ua || "");
  if (/ipad|tablet|playbook|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return "Tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "Phone";
  return "Computer";
}
const REF_NAMES = [
  [/(^|\.)google\./, "Google"], [/(^|\.)bing\.com$/, "Bing"], [/duckduckgo\.com$/, "DuckDuckGo"], [/(^|\.)yahoo\./, "Yahoo"],
  [/(^|\.)ecosia\.org$/, "Ecosia"], [/(^|\.)facebook\.com$|(^|\.)fb\.com$|^l\.facebook\.com$|^m\.facebook\.com$/, "Facebook"],
  [/(^|\.)instagram\.com$/, "Instagram"], [/(^|\.)t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, "X / Twitter"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"], [/(^|\.)tiktok\.com$/, "TikTok"], [/(^|\.)linkedin\.com$|^lnkd\.in$/, "LinkedIn"],
  [/(^|\.)pinterest\./, "Pinterest"], [/(^|\.)reddit\.com$/, "Reddit"], [/(^|\.)stan\.store$/, "Stan Store"],
  [/(^|\.)mail\.google\.com$|outlook\.live\.com$|outlook\.office\.com$/, "Email"],
];
function refOf(ref, utm, siteHost) {
  utm = String(utm || "").replace(/[^\w .:@/+-]/g, "").slice(0, 40).trim();
  if (utm) return "Campaign: " + utm;
  if (!ref) return "Direct or unknown";
  let host;
  try { host = new URL(String(ref)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "Direct or unknown"; }
  if (!host || host === siteHost || host.endsWith("." + siteHost) || host === "localhost") return "Direct or unknown";
  for (const [re, name] of REF_NAMES) if (re.test(host)) return name;
  return host.slice(0, 60);
}

const sum = (days, f) => days.reduce((a, d) => a + (f(d) || 0), 0);
function merge(days, key) {
  const o = {};
  days.forEach((d) => { const m = d[key] || {}; for (const k in m) o[k] = (o[k] || 0) + m[k]; });
  return o;
}
const top = (obj, n) => Object.entries(obj).filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, n);

// Everything the weekly email (and any other report) needs, for one block of days.
function aggregate(days) {
  const views = sum(days, (d) => d.views), visits = sum(days, (d) => d.visits), multi = sum(days, (d) => d.multi);
  const forms = { ok: 0, fail: 0 };
  days.forEach((d) => Object.values(d.forms || {}).forEach((f) => { forms.ok += f.ok || 0; forms.fail += f.fail || 0; }));
  const byWeekday = [0, 0, 0, 0, 0, 0, 0], byHour = new Array(24).fill(0);
  days.forEach((d) => {
    if (d.date) byWeekday[noon(d.date).getUTCDay()] += d.views || 0;
    (d.hours || []).forEach((n, h) => { byHour[h] += n || 0; });
  });
  const eng = {};
  days.forEach((d) => { for (const p in d.eng || {}) { const e = (eng[p] = eng[p] || { n: 0, sec: 0, s75: 0 }); e.n += d.eng[p].n || 0; e.sec += d.eng[p].sec || 0; e.s75 += d.eng[p].s75 || 0; } });
  const engN = Object.values(eng).reduce((a, e) => a + e.n, 0), engSec = Object.values(eng).reduce((a, e) => a + e.sec, 0);
  return {
    views, visits, multi, uniques: sum(days, (d) => d.uniques), forms,
    bounce: visits ? Math.max(0, Math.round((1 - multi / visits) * 100)) : null,
    avgSeconds: engN ? Math.round(engSec / engN) : null,
    pages: merge(days, "pages"), refs: merge(days, "refs"), clicks: merge(days, "clicks"), goals: merge(days, "goals"), geo: merge(days, "geo"),
    entries: merge(days, "entries"), bots: merge(days, "bots"), notFound: merge(days, "notFound"),
    byWeekday, byHour,
  };
}

module.exports = function createAnalytics({ dataDir, isRoute, siteHost, titles, geo }) {
  const file = path.join(dataDir, "analytics.json");
  let data = { version: 2, days: {}, meta: {} };
  let dirty = false;
  let persistent = true;
  const startedAt = new Date().toISOString();

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (j && j.days) data = j;
    }
    fs.accessSync(dataDir, fs.constants.W_OK);
  } catch (e) {
    persistent = false;
    console.error("analytics: cannot use", dataDir, "(", e.message, ") - counting in memory only");
  }
  data.meta = data.meta || {};

  const salt = crypto.randomBytes(16).toString("hex"); // lives only in memory
  let seenDay = dayKey();
  let seen = new Set();
  const recent = new Map(); // ip -> [timestamps], a light abuse guard

  function today() {
    const k = dayKey();
    if (k !== seenDay) { seenDay = k; seen = new Set(); }
    if (!data.days[k]) {
      data.days[k] = { views: 0, visits: 0, uniques: 0, multi: 0, pages: {}, entries: {}, refs: {}, devices: {}, bots: {}, botPages: {}, clicks: {}, goals: {}, eng: {}, forms: {}, notFound: {}, hours: new Array(24).fill(0), blocked: { spam: 0, rate: 0 } };
      const keys = Object.keys(data.days).sort();
      while (keys.length > KEEP_DAYS) delete data.days[keys.shift()];
    }
    const d = data.days[k];
    // days saved by the first version have no entries/goals/eng/hours yet
    d.multi = d.multi || 0; d.entries = d.entries || {}; d.goals = d.goals || {}; d.eng = d.eng || {}; d.geo = d.geo || {};
    if (!Array.isArray(d.hours)) d.hours = new Array(24).fill(0);
    return d;
  }
  function bump(map, key, cap) {
    key = String(key).slice(0, 100);
    if (!(key in map) && Object.keys(map).length >= (cap || 100)) key = "(other)";
    map[key] = (map[key] || 0) + 1;
    dirty = true;
  }
  function ipOf(req) {
    return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  }
  function limited(ip, max) {
    const now = Date.now();
    const list = (recent.get(ip) || []).filter((t) => now - t < 60000);
    if (list.length >= max) { recent.set(ip, list); return true; }
    list.push(now); recent.set(ip, list);
    if (recent.size > 5000) recent.clear();
    return false;
  }
  const labelOf = (slug) => (slug === "" ? "/" : "/" + slug);
  const dayOrEmpty = (k) => ({ date: k, ...(data.days[k] || {}) });
  const daysEnding = (endKey, n) => Array.from({ length: n }, (_, i) => dayOrEmpty(shift(endKey, -(n - 1 - i))));

  return {
    GOALS,
    persistent: () => persistent,
    meta: () => data.meta,
    save: () => { dirty = true; },
    // browser beacon: { t:"view"|"click"|"eng", p, n, m, r, u, k, g, s, d }
    beacon(req, body) {
      const ua = req.headers["user-agent"] || "";
      if (botName(ua)) return;
      const ip = ipOf(req);
      if (limited(ip, 120)) return;
      const d = today();
      if (body.t === "view") {
        const slug = String(body.p ?? "");
        if (!isRoute(slug)) return;
        d.views++;
        bump(d.pages, labelOf(slug), CAP.pages);
        d.hours[hourNow()]++;
        if (body.n) {
          d.visits++;
          bump(d.entries, labelOf(slug), CAP.pages);
          bump(d.devices, deviceOf(ua), 10);
          bump(d.refs, refOf(body.r, body.u, siteHost), CAP.refs);
          if (geo) bump(d.geo, geo.lookup(ip), CAP.geo); // the address is looked up and dropped; only the place name is kept
        }
        if (body.m) d.multi++; // the visit has now looked at a second page, so it is not a bounce
        const fp = crypto.createHash("sha256").update(salt + seenDay + ip + ua).digest("hex").slice(0, 20);
        if (!seen.has(fp)) { seen.add(fp); d.uniques++; if (seen.size > 200000) seen.clear(); }
        dirty = true;
      } else if (body.t === "click") {
        const k = String(body.k || "");
        if (/^[a-z0-9:@._-]{1,60}$/i.test(k)) bump(d.clicks, k, CAP.clicks);
        if (typeof body.g === "string" && Object.prototype.hasOwnProperty.call(GOALS, body.g)) bump(d.goals, body.g, 20);
      } else if (body.t === "eng") {
        const slug = String(body.p ?? "");
        if (!isRoute(slug)) return;
        const label = labelOf(slug);
        if (!(label in d.eng) && Object.keys(d.eng).length >= CAP.pages) return;
        const e = (d.eng[label] = d.eng[label] || { n: 0, sec: 0, s25: 0, s50: 0, s75: 0, s100: 0 });
        const sec = Math.min(1800, Math.max(0, Math.round(Number(body.d) || 0)));
        const s = Math.min(100, Math.max(0, Number(body.s) || 0));
        e.n++; e.sec += sec;
        if (s >= 25) e.s25++; if (s >= 50) e.s50++; if (s >= 75) e.s75++; if (s >= 100) e.s100++;
        dirty = true;
      }
    },
    // a crawler or link-preview robot fetched a real page
    crawler(req, slug) {
      const name = botName(req.headers["user-agent"]);
      if (!name) return;
      const d = today();
      bump(d.bots, name, CAP.bots);
      bump(d.botPages, labelOf(slug), CAP.botPages);
    },
    form(topic, ok) {
      const d = today();
      const t = String(topic).slice(0, 60);
      if (!(t in d.forms) && Object.keys(d.forms).length >= CAP.forms) return;
      d.forms[t] = d.forms[t] || { ok: 0, fail: 0 };
      d.forms[t][ok ? "ok" : "fail"]++;
      dirty = true;
    },
    blocked(kind) { const d = today(); d.blocked[kind] = (d.blocked[kind] || 0) + 1; dirty = true; },
    notFound(pathname, req) {
      if (botName(req.headers["user-agent"])) return;
      bump(today().notFound, String(pathname).slice(0, 100), CAP.notFound);
    },
    // things worth knowing about right now
    alerts() {
      const d = today(), out = [];
      const fails = Object.values(d.forms).reduce((a, f) => a + (f.fail || 0), 0);
      if (fails >= 3) out.push({ id: "form", text: fails + " contact form messages could not be sent today. Visitors were asked to email hello@ directly. Check the email service in Railway and Resend." });
      const nf = Object.entries(d.notFound).sort((a, b) => b[1] - a[1]);
      const nfTotal = nf.reduce((a, e) => a + e[1], 0);
      if (nf.length && (nf[0][1] >= 15 || nfTotal >= 40)) out.push({ id: "404", text: nfTotal + " visits hit pages that don't exist today (most often " + nf[0][0] + "). A broken link may be going around." });
      return out;
    },
    snapshot(n) {
      const keys = Object.keys(data.days).sort();
      return {
        generatedAt: new Date().toISOString(), timezone: TZ, firstDay: keys[0] || null, daysStored: keys.length,
        persistent, startedAt, titles, goals: GOALS, alerts: this.alerts(), days: daysEnding(dayKey(), n),
      };
    },
    // the 7 most recent complete days (ending yesterday) next to the 7 before them
    weekly() {
      const end = shift(dayKey(), -1);
      const cur = daysEnding(end, 7), prev = daysEnding(shift(end, -7), 7);
      return { from: cur[0].date, to: end, now: aggregate(cur), before: aggregate(prev), titles, goals: GOALS };
    },
    dayKey, shift,
    flush() {
      if (!dirty || !persistent) return;
      try {
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, file);
        dirty = false;
      } catch (e) { console.error("analytics: could not save:", e.message); }
    },
  };
};
