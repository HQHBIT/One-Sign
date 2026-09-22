// ============================================================
//   REPORTED ISSUES
//   ------------------------------------------------------------
//   Anyone signed in can report a problem or ask for an improvement from the
//   header. Each report is recorded and emailed to whoever looks after
//   SignFlow — ISSUE_REPORT_EMAIL, so the address changes without a deploy.
//
//   THE ROW IS WRITTEN BEFORE THE EMAIL IS SENT, and the send failing does not
//   fail the request. A reporter has done their bit the moment they press send;
//   telling them "could not report" because SendGrid was briefly unavailable
//   would teach them not to bother next time, and the report would be lost. The
//   row carries whether the email went out, so a missed one can be found.
// ============================================================
import { Router } from "express";
import { query, queryOne, execute } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { sendEmail } from "../email.js";
import { deploymentOrg } from "../org.js";

const router = Router();
const uid = () => `iss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// Where reports go. A setting rather than a constant: the person looking after
// SignFlow changes, and that should not need a release.
const REPORT_TO = (process.env.ISSUE_REPORT_EMAIL || "taha.chunawala@hqhb.in").trim();

const MAX_MESSAGE = 4000;
// Enough for a real burst of reports during a bad morning, low enough that one
// script cannot fill an inbox.
const RATE_LIMIT = { count: 10, windowMs: 15 * 60 * 1000 };

const clean = (v, max) => (v == null ? null : String(v).replace(/\s+/g, " ").trim().slice(0, max) || null);

// POST /api/issues  { message, category?, page? }
router.post("/", authRequired, async (req, res, next) => {
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
    await execute(
      `INSERT INTO issue_reports
         (id, org_id, user_id, reporter_name, reporter_email, reporter_role, category, message, page, user_agent, created_at, emailed_to, emailed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [row.id, row.org_id, row.user_id, row.reporter_name, row.reporter_email, row.reporter_role,
       row.category, row.message, row.page, row.user_agent, row.created_at, REPORT_TO]);

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
        },
      });
      await execute("UPDATE issue_reports SET emailed = 1 WHERE id = ?", [id]);
    } catch (e) {
      console.error("[issues] report saved but the email failed", e?.message || e);
    }

    res.json({ ok: true, id });
  } catch (e) { next(e); }
});

// GET /api/issues — the admin's record of what has been reported.
router.get("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, org_id, reporter_name, reporter_email, reporter_role, category, message, page, created_at, emailed, emailed_to
         FROM issue_reports ORDER BY created_at DESC LIMIT 200`);
    res.json({ issues: rows, reportTo: REPORT_TO });
  } catch (e) { next(e); }
});

export default router;
