// ============================================================
//   REPORTED ISSUES
//   ------------------------------------------------------------
//   People report problems on the form IT runs at reops, not in SignFlow. That
//   form is where the detail lives and it stays the only place to submit — but
//   SignFlow is what everyone watches, so SignFlow sends the notification.
//
//   The bridge is one endpoint: reops calls it when a form is submitted, and we
//   record the report and email it on. Nothing else may call it, so it carries a
//   shared secret — without ISSUE_HOOK_SECRET set on the box the endpoint
//   refuses every call rather than accepting anonymous ones, because an open
//   endpoint that emails is a way to send mail through us.
//
//   THE ROW IS WRITTEN BEFORE THE EMAIL, and a failed send does not fail the
//   call. reops has handed the report over; answering with an error would invite
//   it to retry and send the notification twice. The row records whether the
//   email went out, so a missed one can still be found.
//
//   FIELD NAMES ARE TAKEN LOOSELY. A form builder decides what it calls things,
//   and that is not worth a deploy to follow: several plausible names are
//   accepted for each value, and anything unrecognised is kept verbatim so the
//   email still carries it.
// ============================================================
import crypto from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { query, queryOne, execute } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { sendEmail } from "../email.js";
import { deploymentOrg } from "../org.js";
import { readStored, writeStored } from "../filestore.js";

const router = Router();

// A screenshot or two, or a short screen recording. Held in memory only long
// enough to store; the ceiling is per file, and nginx caps the whole request at
// 20 MB on the live boxes, so a long recording will be refused there first —
// which is the right answer: a video that long belongs in a call, not a form.
const MAX_FILES = 3;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: MAX_FILES } });
const ALLOWED_ATTACHMENT = /^(image\/(png|jpe?g|gif|webp|heic|heif)|video\/(mp4|quicktime|webm|x-matroska))$/i;
const uid = () => `iss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// Where notifications go, and the secret reops must present. Settings rather
// than constants: the person looking after SignFlow changes, and a secret has
// to be rotatable without a release.
const REPORT_TO = (process.env.ISSUE_REPORT_EMAIL || "taha.chunawala@hqhb.in").trim();
const HOOK_SECRET = (process.env.ISSUE_HOOK_SECRET || "").trim();

const MAX_MESSAGE = 8000;
// Enough for a real burst of reports during a bad morning, low enough that one
// script cannot fill an inbox.
const RATE_LIMIT = { count: 10, windowMs: 15 * 60 * 1000 };
const clean = (v, max) => {
  if (v == null) return null;
  const s = (typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Case- and separator-insensitive lookup: "Full Name", "full_name" and
// "fullName" are the same question asked by three form builders. An exact match
// wins; failing that a key that CONTAINS the word does, because a form asks
// "Your message" and "Describe the issue" as readily as "message".
const pick = (body, names) => {
  const entries = Object.entries(body || {})
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => [norm(k), v]);
  for (const n of names) {
    const want = norm(n);
    const exact = entries.find(([k]) => k === want);
    if (exact) return exact[1];
  }
  for (const n of names) {
    const want = norm(n);
    const loose = entries.find(([k]) => k.includes(want));
    if (loose) return loose[1];
  }
  return null;
};

// Last resort for the report itself: the longest free-text answer on the form.
// A form's own wording is not worth a deploy to follow, and a report that
// arrives as "no message field" helps nobody.
const IDENTITY = ["name", "email", "token", "id", "reference", "submission", "phone", "mobile", "date", "time", "its"];
const longestText = (body) =>
  Object.entries(body || {})
    .filter(([k, v]) => typeof v === "string" && v.trim().length > 15 && !IDENTITY.some((w) => norm(k).includes(w)))
    .map(([, v]) => v.trim())
    .sort((a, b) => b.length - a.length)[0] || null;

/** Constant-time secret check, so the endpoint cannot be probed a byte at a time. */
function secretOk(req) {
  if (!HOOK_SECRET) return false;
  const given = String(req.get("x-issue-token") || req.query.token || req.body?.token || "");
  const a = Buffer.from(given);
  const b = Buffer.from(HOOK_SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// POST /api/issues/hook — called by reops when somebody submits the form.
router.post("/hook", async (req, res, next) => {
  try {
    if (!HOOK_SECRET) {
      console.error("[issues] hook called but ISSUE_HOOK_SECRET is not set on this box");
      return res.status(503).json({ error: "Issue notifications are not configured on this server" });
    }
    if (!secretOk(req)) return res.status(401).json({ error: "Bad token" });

    const body = req.body || {};
    const message = clean(
      pick(body, ["message", "description", "issue", "details", "detail", "comments", "comment", "text", "body",
        "whatHappened", "enhancement", "problem", "feedback", "suggestion", "query", "remarks"])
      || longestText(body),
      MAX_MESSAGE);
    if (!message) return res.status(400).json({ error: "Nothing to report: no message field in the submission" });

    const rawCategory = String(pick(body, ["category", "type", "kind", "requestType", "subject"]) || "");
    const category = /enhance|improve|suggest|feature|request/i.test(rawCategory) ? "enhancement" : "issue";

    // Anything we did not recognise still reaches the reader rather than being
    // dropped — a form can grow a question without us knowing.
    const known = new Set(["message", "description", "issue", "details", "detail", "comments", "comment", "text", "body",
      "whathappened", "enhancement", "category", "type", "kind", "requesttype", "subject", "name", "fullname", "reporter",
      "reportername", "submittedby", "user", "email", "emailaddress", "reporteremail", "from", "page", "url", "screen",
      "token", "id", "reference", "submissionid"]);
    const extras = Object.entries(body)
      .filter(([k, v]) => !known.has(String(k).toLowerCase().replace(/[^a-z0-9]/g, "")) && v != null && String(v).trim() !== "")
      .map(([k, v]) => `${k}: ${clean(v, 300)}`)
      .slice(0, 12);

    const at = Date.now();
    const id = uid();
    const row = {
      org_id: deploymentOrg() || null,
      reporter_name: clean(pick(body, ["name", "fullName", "reporter", "reporterName", "submittedBy", "user"]), 255),
      reporter_email: clean(pick(body, ["email", "emailAddress", "reporterEmail"]), 255),
      page: clean(pick(body, ["from", "page", "url", "screen"]), 255),
      reference: clean(pick(body, ["id", "reference", "submissionId"]), 120),
      message: extras.length ? `${message}\n\n${extras.join("\n")}` : message,
    };

    await execute(
      `INSERT INTO issue_reports
         (id, org_id, user_id, reporter_name, reporter_email, reporter_role, category, message, page, user_agent, created_at, emailed_to, emailed)
       VALUES (?, ?, NULL, ?, ?, 'form', ?, ?, ?, ?, ?, ?, 0)`,
      [id, row.org_id, row.reporter_name, row.reporter_email, category, row.message.slice(0, MAX_MESSAGE),
       row.page, clean(req.get("user-agent"), 500), at, REPORT_TO]);

    try {
      await sendEmail({
        to: REPORT_TO,
        template: "issue_report",
        ctx: {
          category,
          message: row.message,
          reporterName: row.reporter_name || "Someone",
          reporterEmail: row.reporter_email || "not given on the form",
          reporterRole: "submitted on the issues form",
          org: row.org_id || "unknown",
          page: row.page || "not given",
          userAgent: row.reference ? `Form reference ${row.reference}` : null,
          at: new Date(at).toISOString().replace("T", " ").slice(0, 16) + " UTC",
          formUrl: process.env.ISSUE_FORM_URL || null,
        },
      });
      await execute("UPDATE issue_reports SET emailed = 1 WHERE id = ?", [id]);
    } catch (e) {
      console.error("[issues] report recorded but the email failed", e?.message || e);
    }

    res.json({ ok: true, id });
  } catch (e) { next(e); }
});

// POST /api/issues  { message, category?, page?, files[] }
// Sent as multipart when screenshots or a recording are attached.
router.post("/", authRequired, upload.array("files", MAX_FILES), async (req, res, next) => {
  try {
    const message = String(req.body?.message ?? "").trim();
    if (message.length < 5) return res.status(400).json({ error: "Please describe the issue in a little more detail" });
    if (message.length > MAX_MESSAGE) return res.status(400).json({ error: `Please keep it under ${MAX_MESSAGE} characters` });
    const category = req.body?.category === "enhancement" ? "enhancement" : "issue";

    const recent = await queryOne(
      "SELECT COUNT(*) AS n FROM issue_reports WHERE user_id = ? AND created_at > ?",
      [req.user.id, Date.now() - RATE_LIMIT.windowMs]);
    if (Number(recent?.n || 0) >= RATE_LIMIT.count) {
      return res.status(429).json({ error: "That is a lot of reports in a short time — please continue in the reply to the first one." });
    }

    const id = uid();
    const at = Date.now();
    const row = {
      id,
      org_id: req.userRow?.org_id || deploymentOrg() || null,
      user_id: req.user.id,
      reporter_name: clean(req.user.name, 255),
      reporter_email: clean(req.user.email, 255),
      reporter_role: clean(req.user.role, 32),
      category,
      message: message.slice(0, MAX_MESSAGE),
      // Sent by the browser: which screen they were on. Never trusted as a URL,
      // only ever shown as text.
      page: clean(req.body?.page, 255),
      user_agent: clean(req.headers["user-agent"], 500),
      created_at: at,
    };

    // Screenshots and recordings. Stored like every other file — disk first,
    // bucket next — so they survive the box they were uploaded to. The name the
    // browser gave is kept only for display; what is stored is our own id, so a
    // file called "../../etc/passwd" is just a label.
    const attachments = [];
    for (const [i, f] of (req.files || []).entries()) {
      if (!ALLOWED_ATTACHMENT.test(f.mimetype || "")) {
        return res.status(400).json({ error: `${f.originalname}: only images and video can be attached` });
      }
      const ext = (f.originalname.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
      const stored = await writeStored("issues", `${id}.${i + 1}.${ext}`, f.buffer, { contentType: f.mimetype });
      attachments.push({ stored, name: clean(f.originalname, 120) || `attachment ${i + 1}`, type: f.mimetype, size: f.size });
    }

    await execute(
      `INSERT INTO issue_reports
         (id, org_id, user_id, reporter_name, reporter_email, reporter_role, category, message, page, user_agent, created_at, emailed_to, emailed, attachments_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [row.id, row.org_id, row.user_id, row.reporter_name, row.reporter_email, row.reporter_role,
       row.category, row.message, row.page, row.user_agent, row.created_at, REPORT_TO,
       attachments.length ? JSON.stringify(attachments) : null]);

    // The report is safe now; the email is best effort.
    try {
      await sendEmail({
        to: REPORT_TO,
        template: "issue_report",
        ctx: {
          category,
          message: row.message,
          reporterName: row.reporter_name || "Somebody",
          reporterEmail: row.reporter_email || "not recorded",
          reporterRole: row.reporter_role || "unknown",
          org: row.org_id || "unknown",
          page: row.page || "not reported",
          userAgent: row.user_agent,
          at: new Date(at).toISOString().replace("T", " ").slice(0, 16) + " UTC",
          // Named, not attached: a screen recording is far too big for an
          // email, and an admin opening it in SignFlow is one click either way.
          attachments: attachments.map((a) => `${a.name} (${Math.round(a.size / 1024)} KB)`),
          attachmentsUrl: attachments.length ? "Administration → Reported issues" : null,
        },
      });
      await execute("UPDATE issue_reports SET emailed = 1 WHERE id = ?", [id]);
    } catch (e) {
      console.error("[issues] report saved but the email failed", e?.message || e);
    }

    res.json({ ok: true, id });
  } catch (e) { next(e); }
});

// GET /api/issues/:id/attachment/:n — a screenshot or recording from a report.
// The admin who reads reports, and the person who sent it, and nobody else.
router.get("/:id/attachment/:n", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT user_id, attachments_json FROM issue_reports WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).end();
    if (req.user.role !== "admin" && row.user_id !== req.user.id) return res.status(404).end();
    let list = [];
    try { list = JSON.parse(row.attachments_json || "[]"); } catch { list = []; }
    const item = list[parseInt(req.params.n, 10)];
    if (!item) return res.status(404).end();

    let bytes;
    try { bytes = await readStored("issues", item.stored); }
    catch { return res.status(404).end(); }

    res.setHeader("Content-Type", item.type || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(item.name || "attachment")}"`);
    res.setHeader("Accept-Ranges", "bytes");
    // Video needs byte ranges, or Safari refuses to play it at all.
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    if (!m || (!m[1] && !m[2])) {
      res.setHeader("Content-Length", bytes.length);
      return res.end(bytes);
    }
    const start = m[1] ? parseInt(m[1], 10) : Math.max(0, bytes.length - parseInt(m[2], 10));
    const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), bytes.length - 1) : bytes.length - 1;
    if (start >= bytes.length || start > end) {
      res.setHeader("Content-Range", `bytes */${bytes.length}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
    res.setHeader("Content-Length", end - start + 1);
    res.end(bytes.subarray(start, end + 1));
  } catch (e) { next(e); }
});

// GET /api/issues — the admin's record of what has come in.
router.get("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, org_id, reporter_name, reporter_email, reporter_role, category, message, page, created_at, emailed, emailed_to, attachments_json
         FROM issue_reports ORDER BY created_at DESC LIMIT 200`);
    // The stored filename stays on the server; the screen only needs to know
    // how many there are, what they are called and what kind of file each is.
    const issues = rows.map(({ attachments_json, ...r }) => {
      let list = [];
      try { list = JSON.parse(attachments_json || "[]"); } catch { list = []; }
      return { ...r, attachments: list.map(({ name, type, size }) => ({ name, type, size })) };
    });
    res.json({ issues, reportTo: REPORT_TO, hookConfigured: !!HOOK_SECRET });
  } catch (e) { next(e); }
});

export default router;
