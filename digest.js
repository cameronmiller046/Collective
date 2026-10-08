// Builds the weekly summary email (plain text plus a simple styled version) from analytics.weekly().
const NF = new Intl.NumberFormat("en-US");
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const CLICK_LABELS = {
  "ext:stan7week": "7-Week Experience sign-up", "ext:stanJournalClub": "Journal Club sign-up", "ext:stanEmail": "Newsletter sign-up",
  "ext:stanBooks": "Books (Stan Store)", "ext:stanApp": "App waitlist", "ext:shopify": "Shop (Shopify)", "ext:support": "Support the Collective",
  "ext:sponsorFamily": "Sponsor a Family", "ext:scholarship": "Fund a Scholarship", "ext:sponsorInitiative": "Sponsor an Initiative",
  "ext:podcast": "Listen on a podcast app", "ext:instagram": "Instagram", "ext:tiktok": "TikTok", "ext:youtube": "YouTube", "ext:facebook": "Facebook",
};
const clickLabel = (k) => CLICK_LABELS[k] || (k.startsWith("mail:") ? "Email: " + k.slice(5) + "@" : k.replace(/^ext:/, ""));
const dateLabel = (key) => { const [, m, d] = key.split("-"); return MONTHS[Number(m) - 1] + " " + Number(d); };
const hourLabel = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? " AM" : " PM");
const change = (cur, prev) => (prev ? (cur >= prev ? "▲ " : "▼ ") + Math.abs(Math.round(((cur - prev) / prev) * 100)) + "%" : "");
const top = (obj, n) => Object.entries(obj).filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
const peak = (arr) => { const m = Math.max(...arr); return m > 0 ? arr.indexOf(m) : -1; };
const mmss = (s) => (s == null ? "n/a" : Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s");

function build(w, adminUrl) {
  const a = w.now, b = w.before, t = w.titles || {};
  const range = dateLabel(w.from) + " to " + dateLabel(w.to);
  const subject = "Weekly site summary: " + range;
  const pageName = (p) => t[p] || p;
  const wd = peak(a.byWeekday), hr = peak(a.byHour);
  const goals = Object.entries(w.goals).map(([id, label]) => [label, a.goals[id] || 0]).filter((g) => g[1] > 0);
  const lines = [
    ["Page views", NF.format(a.views), change(a.views, b.views)],
    ["Visits", NF.format(a.visits), change(a.visits, b.visits)],
    ["Daily visitors", NF.format(a.uniques), change(a.uniques, b.uniques)],
    ["Pages per visit", a.visits ? (a.views / a.visits).toFixed(1) : "n/a", ""],
    ["Bounce rate (left after one page)", a.bounce == null ? "n/a" : a.bounce + "%", ""],
    ["Average time on a page", mmss(a.avgSeconds), ""],
    ["Contact messages sent", NF.format(a.forms.ok) + (a.forms.fail ? " (" + a.forms.fail + " failed)" : ""), ""],
  ];
  const lists = [
    ["Most viewed pages", top(a.pages, 5).map(([p, n]) => [pageName(p), n])],
    ["Where visits begin", top(a.entries, 5).map(([p, n]) => [pageName(p), n])],
    ["Where visitors came from", top(a.refs, 5)],
    ["What people clicked", top(a.clicks, 6).map(([k, n]) => [clickLabel(k), n])],
    ["Goals reached (visits)", goals.map(([l, n]) => [l, n + (a.visits ? " (" + (n / a.visits * 100).toFixed(1) + "% of visits)" : "")])],
    ["Search engines and link previews", top(a.bots, 5)],
    ["Broken links people hit", top(a.notFound, 5)],
  ].filter(([, rows]) => rows.length);
  const busiest = (wd >= 0 ? "Busiest day: " + WEEKDAYS[wd] : "") + (hr >= 0 ? (wd >= 0 ? " · " : "") + "Busiest hour: " + hourLabel(hr) + " (Atlanta time)" : "");

  const text = [
    "Rooted & Crowned Collective: weekly summary", range + " (compared with the week before)", "",
    ...lines.map(([l, v, c]) => l + ": " + v + (c ? "  " + c : "")), "",
    ...(busiest ? [busiest, ""] : []),
    ...lists.flatMap(([title, rows]) => [title, ...rows.map(([k, v]) => "  " + k + ": " + v), ""]),
    "Full dashboard: " + adminUrl,
  ].join("\n");

  const card = (l, v, c) => `<td style="padding:14px 16px;border:1px solid #e6dcc9;background:#fffaf0;border-radius:8px;vertical-align:top"><div style="font:600 26px Georgia,serif;color:#25072F">${esc(v)}</div><div style="font:13px Arial,sans-serif;color:#5B4263">${esc(l)}</div><div style="font:12px Arial,sans-serif;color:${c.startsWith("▲") ? "#2a7d4f" : "#a8483c"}">${esc(c)}</div></td>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f7f1e8;padding:24px 12px">
<table role="presentation" width="100%" style="max-width:600px;margin:0 auto;border-collapse:separate;border-spacing:0">
<tr><td style="background:#25072F;color:#f7f1e8;padding:22px 24px;border-radius:10px 10px 0 0"><div style="font:600 22px Georgia,serif">Weekly site summary</div><div style="font:13px Arial,sans-serif;color:#E5BE65;margin-top:4px">${esc(range)} &middot; compared with the week before</div></td></tr>
<tr><td style="background:#ffffff;padding:20px 20px 8px;border:1px solid #e6dcc9;border-top:0">
<table role="presentation" width="100%" style="border-collapse:separate;border-spacing:8px"><tr>${card(lines[0][0], lines[0][1], lines[0][2])}${card(lines[1][0], lines[1][1], lines[1][2])}</tr><tr>${card(lines[2][0], lines[2][1], lines[2][2])}${card(lines[3][0], lines[3][1], lines[3][2])}</tr></table>
<p style="font:14px/1.7 Arial,sans-serif;color:#25072F;margin:10px 8px">${esc(lines[4][0])}: <b>${esc(lines[4][1])}</b><br>${esc(lines[5][0])}: <b>${esc(lines[5][1])}</b><br>${esc(lines[6][0])}: <b>${esc(lines[6][1])}</b>${busiest ? "<br>" + esc(busiest) : ""}</p>
${lists.map(([title, rows]) => `<h3 style="font:600 12px Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8a6410;margin:18px 8px 6px">${esc(title)}</h3><table role="presentation" width="100%" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="font:14px Arial,sans-serif;color:#25072F;padding:4px 8px;border-bottom:1px solid #f0e8d8">${esc(k)}</td><td align="right" style="font:14px Arial,sans-serif;color:#25072F;padding:4px 8px;border-bottom:1px solid #f0e8d8">${esc(v)}</td></tr>`).join("")}</table>`).join("")}
<p style="margin:22px 8px 18px"><a href="${esc(adminUrl)}" style="display:inline-block;background:#D4A64A;color:#25072F;font:600 13px Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;padding:12px 18px;border-radius:999px">Open the dashboard</a></p>
</td></tr>
<tr><td style="font:12px Arial,sans-serif;color:#7a6482;padding:12px 6px">Counts come from the site itself: no cookies, no names, no IP addresses. Robots are kept separate from visitors.</td></tr>
</table></body></html>`;
  return { subject, text, html };
}

function buildAlert(alert, adminUrl) {
  return {
    subject: alert.id === "form" ? "Attention: the contact form is failing" : "Heads up: visitors are hitting broken links",
    text: alert.text + "\n\nOpen the dashboard: " + adminUrl,
  };
}

module.exports = { build, buildAlert };
