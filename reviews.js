// Voices of the Collective: verified, invitation-only reviews with manual approval. No dependencies.
// Flow: the owner sends an invitation from the admin page -> the customer opens a private one-time link ->
// the review waits in "pending" -> the owner approves it -> only then does it appear on the website.
// Private (never public): email, full name unless the customer chose to show it, invitations, rejected or pending reviews.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { CATEGORIES, OFFERINGS } = require("./offerings");

const DAY = 86400000;
const INVITE_DAYS = 30;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const oneLine = (s) => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
const offeringById = (id) => OFFERINGS.find((o) => o.id === id);
const categoryById = (id) => CATEGORIES.find((c) => c.id === id);
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const MAILING = "Rooted & Crowned Collective LLC · Business Mailing Address: 8735 Dunwoody Place #13729, Atlanta, GA 30350";

module.exports = function createReviews({ dataDir, sendMail, siteOrigin, notifyTo, retentionDays }) {
  const RETAIN = (Number(retentionDays) > 0 ? Number(retentionDays) : 730) * DAY;
  const file = path.join(dataDir, "reviews.json");
  let db = { invitations: [], reviews: [], audit: [] };
  let persistent = true;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (j && Array.isArray(j.invitations)) db = { invitations: j.invitations, reviews: j.reviews || [], audit: j.audit || [] };
    }
    fs.accessSync(dataDir, fs.constants.W_OK);
  } catch (e) {
    persistent = false;
    console.error("reviews: cannot use", dataDir, "(", e.message, ") - keeping reviews in memory only");
  }
  const byHash = new Map();
  const reindex = () => { byHash.clear(); db.invitations.forEach((i) => { if (i.tokenHash) byHash.set(i.tokenHash, i); }); };
  reindex();

  function save() {
    if (!persistent) return;
    try {
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, file);
    } catch (e) { console.error("reviews: could not save:", e.message); }
  }
  const nid = () => crypto.randomBytes(8).toString("hex");
  const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
  const newToken = () => crypto.randomBytes(32).toString("base64url");
  function audit(action, ref, reason) {
    db.audit.push({ at: new Date().toISOString(), action, ref: ref || null, reason: reason ? String(reason).slice(0, 300) : null });
    if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
  }
  const effective = (inv) => (inv.status === "pending" && Date.now() > Date.parse(inv.expiresAt) ? "expired" : inv.status);
  const firstName = (name) => oneLine(name).split(" ")[0] || "there";
  function displayName(name, mode) {
    const parts = oneLine(name).split(" ").filter(Boolean);
    if (mode === "full") return parts.join(" ");
    if (mode === "anon") return "Anonymous Verified Customer";
    return parts.length > 1 ? parts[0] + " " + parts[parts.length - 1][0].toUpperCase() + "." : parts[0] || "Verified Customer";
  }
  const maskEmail = (e) => String(e).replace(/^(.).*(@.*)$/, "$1***$2");

  // ---------- email ----------
  const shell = (heading, body) => `<!doctype html><html><body style="margin:0;background:#f7f1e8;padding:24px 12px">
<table role="presentation" width="100%" style="max-width:580px;margin:0 auto;border-collapse:separate;border-spacing:0">
<tr><td style="background:#25072F;color:#E5BE65;padding:22px 24px;border-radius:10px 10px 0 0;text-align:center"><div style="font:12px Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase">Rooted &amp; Crowned Collective</div><div style="font:600 26px Georgia,serif;color:#f7f1e8;margin-top:6px">${esc(heading)}</div></td></tr>
<tr><td style="background:#ffffff;padding:26px 28px;border:1px solid #e6dcc9;border-top:0;font:15px/1.7 Arial,sans-serif;color:#25072F">${body}</td></tr>
<tr><td style="font:12px/1.6 Arial,sans-serif;color:#7a6482;padding:14px 8px;text-align:center">${esc(MAILING)}</td></tr>
</table></body></html>`;
  const button = (href, label) => `<p style="text-align:center;margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:#D4A64A;color:#25072F;font:600 14px Arial,sans-serif;letter-spacing:.08em;text-decoration:none;padding:14px 26px;border-radius:999px">${esc(label)}</a></p>`;
  const SIGN_TEXT = "With gratitude,\nCoach Kia\nFounder | Life Coach | Visionary\nRooted & Crowned Collective\nGrounded Roots. Crown Driven.";
  const SIGN_HTML = '<p style="margin-top:24px">With gratitude,<br><b>Coach Kia</b><br>Founder | Life Coach | Visionary<br>Rooted &amp; Crowned Collective<br><i>Grounded Roots. Crown Driven.</i></p>';
  const linkFor = (token) => `${siteOrigin}/review/${token}`;

  function inviteEmail(inv, token, isEdit, note) {
    const off = offeringById(inv.offeringId), what = off ? off.name : "your experience";
    const detail = inv.detail ? ` (${inv.detail})` : "";
    const link = linkFor(token), first = firstName(inv.name);
    if (isEdit) {
      const subject = "Update your review: Rooted & Crowned Collective";
      const text = `Hello ${first},\n\n${note ? note + "\n\n" : ""}You can update your review of ${what}${detail} using your private link below. After you save it, it will be checked again before it appears on our website.\n\nUpdate your review: ${link}\n\n${SIGN_TEXT}\n\nThis link is private to you and expires in ${INVITE_DAYS} days. Please don't forward it.\n${MAILING}`;
      const html = shell("Update Your Review", `<p>Hello ${esc(first)},</p>${note ? `<p style="border-left:3px solid #D4A64A;padding-left:12px;color:#5B4263">${esc(note)}</p>` : ""}<p>You can update your review of <b>${esc(what)}</b>${esc(detail)} using your private link below. After you save it, it will be checked again before it appears on our website.</p>${button(link, "Update Your Review")}${SIGN_HTML}<p style="font-size:12px;color:#7a6482">This link is private to you and expires in ${INVITE_DAYS} days. Please don't forward it.</p>`);
      return { subject, text, html };
    }
    const subject = "Your voice matters: share your experience with Rooted & Crowned Collective";
    const text = `Hello ${first},\n\nThank you for being part of the Rooted & Crowned Collective.\n\nYour experience with ${what}${detail} is an important part of our growing community.\n\nWe invite you to share your authentic thoughts about your experience. Whether your journey brought new insights, meaningful questions, or opportunities for growth, your perspective matters.\n\nShare your experience: ${link}\n\nYour review may help others make informed decisions about their own Rooted & Crowned journey. You are never required to leave a review, and all honest feedback is welcome.\n\n${SIGN_TEXT}\n\nThis invitation is intended for ${inv.name} and expires in ${INVITE_DAYS} days. Please don't forward it. If you would rather not receive review requests, simply reply "no thank you."\n${MAILING}`;
    const html = shell("Your Voice Matters", `<p>Hello ${esc(first)},</p><p>Thank you for being part of the Rooted &amp; Crowned Collective.</p><p>Your experience with <b>${esc(what)}</b>${esc(detail)} is an important part of our growing community.</p><p>We invite you to share your authentic thoughts about your experience. Whether your journey brought new insights, meaningful questions, or opportunities for growth, your perspective matters.</p>${button(link, "Share Your Experience")}<p>Your review may help others make informed decisions about their own Rooted &amp; Crowned journey. You are never required to leave a review, and all honest feedback is welcome.</p>${SIGN_HTML}<p style="font-size:12px;color:#7a6482">This invitation is intended for ${esc(inv.name)} and expires in ${INVITE_DAYS} days. Please don't forward it. If you would rather not receive review requests, simply reply "no thank you."</p>`);
    return { subject, text, html };
  }
  async function mailInvite(inv, token, isEdit, note) {
    const m = inviteEmail(inv, token, isEdit, note);
    const r = await sendMail({ to: inv.email, replyTo: "hello@rootedandcrownedcollective.org", ...m });
    inv.emailStatus = r.ok ? "sent" : "failed";
    if (r.ok) inv.sentAt = new Date().toISOString();
    save();
    return r;
  }
  function notifyOwner(rev) {
    if (!notifyTo) return;
    const off = offeringById(rev.offeringId);
    const link = siteOrigin + "/admin/reviews";
    sendMail({
      to: notifyTo,
      subject: "A review is waiting for your approval",
      text: `A verified customer has submitted a review of ${off ? off.name : "an offering"} (${rev.rating} out of 5).\n\nIt stays private until you approve it.\nOpen the approval queue: ${link}`,
    }).catch(() => {});
  }

  // ---------- core actions ----------
  function validInvite(token) {
    const inv = token && byHash.get(sha(token));
    if (!inv || effective(inv) !== "pending") return null;
    return inv;
  }
  function makeInvitation({ name, email, offeringId, detail, type, reviewId }) {
    const token = newToken();
    const inv = {
      id: nid(), tokenHash: sha(token), type: type || "invite", offeringId, detail: oneLine(detail).slice(0, 120),
      name, email, status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + INVITE_DAYS * DAY).toISOString(),
      sentAt: null, emailStatus: "not_sent", reviewId: reviewId || null,
    };
    db.invitations.push(inv);
    byHash.set(inv.tokenHash, inv);
    return { inv, token };
  }
  async function invite(body) {
    const name = oneLine(body.name).slice(0, 100), email = oneLine(body.email).slice(0, 200).toLowerCase();
    if (!name || !EMAIL_RE.test(email)) return { code: 400, error: "Enter the customer's name and a valid email address." };
    const off = offeringById(body.offeringId);
    if (!off) return { code: 400, error: "Choose what they are being invited to review." };
    const { inv, token } = makeInvitation({ name, email, offeringId: off.id, detail: body.detail });
    audit("invitation_created", inv.id);
    const r = await mailInvite(inv, token, false);
    audit(r.ok ? "invitation_sent" : "invitation_email_failed", inv.id);
    save();
    return r.ok ? { code: 200, ok: true, id: inv.id } : { code: 502, error: "The invitation was saved but the email could not be sent. Use Resend on the invitation to try again.", id: inv.id };
  }
  async function resend(id) {
    const inv = db.invitations.find((i) => i.id === id);
    if (!inv) return { code: 404, error: "Invitation not found." };
    if (inv.status === "submitted" || inv.status === "revoked") return { code: 400, error: "This invitation was already used or revoked." };
    byHash.delete(inv.tokenHash);
    const token = newToken();
    inv.tokenHash = sha(token); inv.expiresAt = new Date(Date.now() + INVITE_DAYS * DAY).toISOString(); inv.status = "pending";
    byHash.set(inv.tokenHash, inv);
    const r = await mailInvite(inv, token, inv.type === "edit");
    audit(r.ok ? "invitation_resent" : "invitation_email_failed", inv.id);
    save();
    return r.ok ? { code: 200, ok: true } : { code: 502, error: "The email could not be sent. Try again in a moment." };
  }
  function revoke(id) {
    const inv = db.invitations.find((i) => i.id === id);
    if (!inv) return { code: 404, error: "Invitation not found." };
    if (inv.status === "submitted") return { code: 400, error: "This invitation was already used." };
    inv.status = "revoked"; byHash.delete(inv.tokenHash);
    audit("invitation_revoked", inv.id); save();
    return { code: 200, ok: true };
  }
  function submit(body) {
    const inv = validInvite(String(body.token || ""));
    if (!inv) return { code: 410, error: "invalid" };
    const rating = Number(body.rating), mode = ["initial", "full", "anon"].includes(body.display) ? body.display : "initial";
    const text = String(body.text || "").replace(/\r/g, "").trim().slice(0, 2000);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { code: 400, error: "Please choose a star rating from 1 to 5." };
    if (body.consent !== true) return { code: 400, error: "Please confirm your review is genuine and that you consent to it being published once approved." };
    const off = offeringById(inv.offeringId);
    let rev = inv.type === "edit" ? db.reviews.find((r) => r.id === inv.reviewId) : null;
    if (inv.type === "edit" && !rev) return { code: 410, error: "invalid" };
    const now = new Date().toISOString();
    if (rev) {
      Object.assign(rev, { rating, text, display: mode, displayName: displayName(rev.name, mode), status: "pending", updatedAt: now, moderation: null });
      audit("review_edited", rev.id);
    } else {
      rev = {
        id: nid(), invitationId: inv.id, offeringId: inv.offeringId, category: off ? off.category : "", name: inv.name, email: inv.email,
        display: mode, displayName: displayName(inv.name, mode), rating, text, consent: true, status: "pending",
        createdAt: now, updatedAt: now, publishedAt: null, moderation: null,
      };
      db.reviews.push(rev);
      audit("review_submitted", rev.id);
    }
    inv.status = "submitted"; inv.reviewId = rev.id; byHash.delete(inv.tokenHash);
    save();
    notifyOwner(rev);
    return { code: 200, ok: true };
  }
  async function moderate(body) {
    const rev = db.reviews.find((r) => r.id === body.reviewId);
    if (!rev || rev.status === "deleted") return { code: 404, error: "Review not found." };
    const action = body.action, reason = oneLine(body.reason).slice(0, 300), now = new Date().toISOString();
    if (action === "approve") {
      rev.status = "published"; rev.publishedAt = now; rev.moderation = { action: "approved", reason: reason || null, at: now };
      audit("review_approved", rev.id, reason);
    } else if (action === "reject") {
      if (reason.length < 5) return { code: 400, error: "Please record the policy reason for rejecting this review (at least a few words)." };
      rev.status = "rejected"; rev.moderation = { action: "rejected", reason, at: now };
      audit("review_rejected", rev.id, reason);
    } else if (action === "hide") {
      if (reason.length < 5) return { code: 400, error: "Please record why this review is being taken down." };
      rev.status = "hidden"; rev.moderation = { action: "hidden", reason, at: now };
      audit("review_hidden", rev.id, reason);
    } else if (action === "clarify") {
      if (reason.length < 5) return { code: 400, error: "Write the note you want the customer to see." };
      rev.status = "clarify"; rev.moderation = { action: "clarify", reason, at: now };
      const { inv, token } = makeInvitation({ name: rev.name, email: rev.email, offeringId: rev.offeringId, type: "edit", reviewId: rev.id });
      audit("review_clarification_requested", rev.id, reason);
      const r = await mailInvite(inv, token, true, reason);
      save();
      return r.ok ? { code: 200, ok: true } : { code: 502, error: "Saved, but the email to the customer could not be sent. Use Allow edit to try again." };
    } else return { code: 400, error: "Unknown action." };
    rev.updatedAt = now; save();
    return { code: 200, ok: true };
  }
  async function allowEdit(reviewId) {
    const rev = db.reviews.find((r) => r.id === reviewId);
    if (!rev || rev.status === "deleted") return { code: 404, error: "Review not found." };
    db.invitations.filter((i) => i.reviewId === rev.id && i.type === "edit" && i.status === "pending").forEach((i) => { i.status = "revoked"; byHash.delete(i.tokenHash); });
    const { inv, token } = makeInvitation({ name: rev.name, email: rev.email, offeringId: rev.offeringId, type: "edit", reviewId: rev.id });
    audit("edit_link_issued", rev.id);
    const r = await mailInvite(inv, token, true);
    save();
    return r.ok ? { code: 200, ok: true } : { code: 502, error: "The email could not be sent. Try again in a moment." };
  }
  function removeReview(body) {
    const rev = db.reviews.find((r) => r.id === body.reviewId);
    const reason = oneLine(body.reason).slice(0, 300);
    if (!rev) return { code: 404, error: "Review not found." };
    if (reason.length < 5) return { code: 400, error: "Record why this review is being deleted, such as the customer asked for it." };
    Object.assign(rev, { status: "deleted", name: "(removed)", email: "(removed)", displayName: "", text: "", rating: 0, moderation: { action: "deleted", reason, at: new Date().toISOString() } });
    db.invitations.filter((i) => i.reviewId === rev.id).forEach((i) => { i.name = "(removed)"; i.email = "(removed)"; i.status = i.status === "pending" ? "revoked" : i.status; byHash.delete(i.tokenHash); });
    audit("review_deleted", rev.id, reason); save();
    return { code: 200, ok: true };
  }

  // ---------- public view ----------
  function publicReview(r) {
    const off = offeringById(r.offeringId), cat = categoryById(r.category);
    return { id: r.id, name: r.displayName, rating: r.rating, text: r.text, offeringId: r.offeringId, offering: off ? off.name : "", category: r.category, label: cat ? cat.verified : "Verified", date: (r.publishedAt || r.createdAt || "").slice(0, 7) };
  }
  const published = () => db.reviews.filter((r) => r.status === "published").sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const publishedCount = () => db.reviews.filter((r) => r.status === "published").length;

  // ---------- admin view ----------
  function adminData() {
    const invs = db.invitations.map((i) => ({
      id: i.id, type: i.type, name: i.name, email: i.email, offeringId: i.offeringId, detail: i.detail, status: effective(i),
      createdAt: i.createdAt, expiresAt: i.expiresAt, sentAt: i.sentAt, emailStatus: i.emailStatus, reviewId: i.reviewId,
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const revs = db.reviews.filter((r) => r.status !== "deleted").map((r) => ({ ...r })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const count = (s) => db.reviews.filter((r) => r.status === s).length;
    return {
      categories: CATEGORIES, offerings: OFFERINGS, invitations: invs, reviews: revs,
      stats: { invited: db.invitations.filter((i) => i.type === "invite").length, awaiting: count("pending"), published: count("published"), flagged: count("clarify") + count("hidden"), rejected: count("rejected") },
      retentionDays: Math.round(RETAIN / DAY), persistent, audit: db.audit.slice(-60).reverse(),
    };
  }
  const csvCell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  function exportCsv() {
    const rows = [["Record", "Created", "Customer name", "Email", "Offering", "Category", "Status", "Rating", "Shown publicly as", "Review", "Moderation note"]];
    db.reviews.forEach((r) => { const o = offeringById(r.offeringId); rows.push(["Review", r.createdAt, r.name, r.email, o ? o.name : r.offeringId, r.category, r.status, r.rating || "", r.displayName, r.text, (r.moderation && r.moderation.reason) || ""]); });
    db.invitations.forEach((i) => { const o = offeringById(i.offeringId); rows.push(["Invitation (" + i.type + ")", i.createdAt, i.name, i.email, o ? o.name : i.offeringId, "", effective(i), "", "", "", ""]); });
    return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  // ---------- retention ----------
  function purge() {
    const cutoff = Date.now() - RETAIN;
    let inv = 0, rev = 0;
    db.invitations.forEach((i) => { if (Date.parse(i.createdAt) < cutoff && i.email !== "(removed)") { i.name = "(removed)"; i.email = "(removed)"; i.status = i.status === "pending" ? "revoked" : i.status; byHash.delete(i.tokenHash); inv++; } });
    db.reviews = db.reviews.filter((r) => {
      if (Date.parse(r.createdAt) >= cutoff) return true;
      if (r.status !== "published") { rev++; return false; } // old private records are removed entirely
      if (r.email !== "(removed)") { r.name = "(removed)"; r.email = "(removed)"; rev++; } // published reviews keep their public text and name only
      return true;
    });
    if (inv || rev) { audit("retention_purge", null, `${inv} invitation records and ${rev} review records past ${Math.round(RETAIN / DAY)} days`); save(); }
  }
  purge();

  // ---------- http ----------
  const hits = new Map();
  function limited(ip) {
    const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 600000);
    if (list.length >= 40) { hits.set(ip, list); return true; }
    list.push(now); hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    return false;
  }
  const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const send = (res, code, obj, extra) => res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", ...(extra || {}) }).end(JSON.stringify(obj));
  function readJson(req, limit, cb) {
    let size = 0; const parts = [];
    req.on("data", (c) => { size += c.length; if (size > limit) req.destroy(); else parts.push(c); });
    req.on("end", () => { try { cb(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}")); } catch { cb(null); } });
  }

  // returns true when it handled the request
  function handlePublic(req, res, urlPath, params) {
    if (urlPath === "/api/reviews" && req.method === "GET") {
      const offering = params.get("offering"), category = params.get("category");
      let list = published();
      if (offering) list = list.filter((r) => r.offeringId === offering);
      if (category) list = list.filter((r) => r.category === category);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" }).end(JSON.stringify({ categories: CATEGORIES, reviews: list.slice(0, 500).map(publicReview) }));
      return true;
    }
    if (urlPath === "/api/review-invite" && req.method === "GET") {
      if (limited(ipOf(req))) { send(res, 429, { error: "rate" }); return true; }
      const inv = validInvite(params.get("token"));
      if (!inv) { send(res, 410, { error: "invalid" }); return true; }
      const off = offeringById(inv.offeringId);
      send(res, 200, { offering: off ? off.name : "your experience", detail: inv.detail, firstName: firstName(inv.name), name: inv.name, emailMasked: maskEmail(inv.email), edit: inv.type === "edit",
        choices: { initial: displayName(inv.name, "initial"), full: displayName(inv.name, "full"), anon: displayName(inv.name, "anon") } });
      return true;
    }
    if (urlPath === "/api/review-submit" && req.method === "POST") {
      if (limited(ipOf(req))) { send(res, 429, { error: "rate" }); return true; }
      readJson(req, 12000, (b) => {
        if (!b) return send(res, 400, { error: "Something went wrong. Please try again." });
        if (b.website) return send(res, 200, { ok: true }); // hidden spam-trap field
        const r = submit(b);
        send(res, r.code, r.error ? { error: r.error } : { ok: true });
      });
      return true;
    }
    return false;
  }
  function handleAdmin(req, res, urlPath, params, headers) {
    if (urlPath === "/admin/reviews/data.json" && req.method === "GET") { send(res, 200, adminData(), headers); return true; }
    if (urlPath === "/admin/reviews/export.csv" && req.method === "GET") {
      res.writeHead(200, { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="voices-of-the-collective-export.csv"' }).end(exportCsv());
      return true;
    }
    const m = /^\/admin\/reviews\/(invite|resend|revoke|moderate|allow-edit|delete)$/.exec(urlPath);
    if (m && req.method === "POST") {
      readJson(req, 12000, async (b) => {
        if (!b) return send(res, 400, { error: "Bad request." }, headers);
        let r;
        try {
          r = m[1] === "invite" ? await invite(b) : m[1] === "resend" ? await resend(b.id) : m[1] === "revoke" ? revoke(b.id)
            : m[1] === "moderate" ? await moderate(b) : m[1] === "allow-edit" ? await allowEdit(b.reviewId) : removeReview(b);
        } catch (e) { console.error("reviews: admin action failed:", e.message); r = { code: 500, error: "Something went wrong." }; }
        send(res, r.code, r.error ? { error: r.error, id: r.id } : { ok: true, id: r.id }, headers);
      });
      return true;
    }
    return false;
  }

  return { handlePublic, handleAdmin, publishedCount, purge, categories: CATEGORIES, offerings: OFFERINGS };
};
