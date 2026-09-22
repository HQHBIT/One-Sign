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
import { query, execute } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { sendEmail } from "../email.js";
import { deploymentOrg } from "../org.js";

const router = Router();
const uid = () => `iss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// Where notifications go, and the secret reops must present. Settings rather
// than constants: the person looking after SignFlow changes, and a secret has
// to be rotatable without a release.
const REPORT_TO = (process.env.ISSUE_REPORT_EMAIL || "taha.chunawala@hqhb.in").trim();
const HOOK_SECRET = (process.env.ISSUE_HOOK_SECRET || "").trim();

const MAX_MESSAGE = 8000;
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

// GET /api/issues — the admin's record of what has come in.
router.get("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, org_id, reporter_name, reporter_email, reporter_role, category, message, page, created_at, emailed, emailed_to
         FROM issue_reports ORDER BY created_at DESC LIMIT 200`);
    res.json({ issues: rows, reportTo: REPORT_TO, hookConfigured: !!HOOK_SECRET });
  } catch (e) { next(e); }
});

export default router;
