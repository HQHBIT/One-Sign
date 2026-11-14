// ============================================================
//   "For your information" — the reading side of a CC stage
//   ------------------------------------------------------------
//   A CC stage on an assistant's board tells someone to LOOK at a document.
//   That person is an executive or an approver, never the assistant, so these
//   routes CANNOT live in ea-flow.js: that router carries
//   `router.use(hqhbOnly, authRequired, requireRole("executive_assistant"))`
//   over every route in the file, and adding an exemption inside it is the
//   mount-path trap that nearly 404'd WAQF once already. A second small router
//   with its own guard is the honest shape.
//
//   Access is granted by the NOTICE, not by a role: you may read a document
//   here only while a row in ea_cc_notices names you for it. An executive with
//   every role in the system still cannot open a board document they were not
//   sent, and the assistant's own board routes are untouched.
// ============================================================
import { Router } from "express";
import { query, queryOne, execute } from "../db.js";
import { authRequired } from "../auth.js";
import { deploymentOrg } from "../org.js";
import { currentBytes } from "./ea-flow.js";

const router = Router();

// Same gate as the flow itself: on any other deployment these routes do not
// exist, rather than existing and refusing.
const hqhbOnly = (req, res, next) => (deploymentOrg() === "hqhb" ? next() : res.status(404).end());
router.use(hqhbOnly, authRequired);

// The notice that lets THIS person read THIS document, if there is one.
const noticeFor = (userId, documentId) => queryOne(
  "SELECT * FROM ea_cc_notices WHERE user_id = ? AND document_id = ? ORDER BY notified_at DESC LIMIT 1",
  [userId, documentId]);

// ---------- everything sent to me for information ----------
router.get("/", async (req, res, next) => {
  try {
    const rows = await query(
      // LEFT JOIN on the stage, not an inner one: a document sent for review by
      // hand has NO stage, and an inner join would silently drop exactly those
      // rows — the ask would be recorded, and the reader would never see it.
      `SELECT n.id, n.document_id, n.stage_id, n.notified_at, n.viewed_at, n.source, n.signed_off_at,
              d.title, d.file_name, d.file_type,
              s.name AS stage_name, s.stage_kind, b.name AS board_name, u.name AS from_name
         FROM ea_cc_notices n
         JOIN ea_documents d ON d.id = n.document_id
         LEFT JOIN ea_stages s ON s.id = n.stage_id
         JOIN ea_boards    b ON b.id = d.board_id
         JOIN users        u ON u.id = b.owner_id
        WHERE n.user_id = ?
        ORDER BY n.notified_at DESC`, [req.user.id]);
    res.json({
      documents: rows.map((r) => ({
        id: r.document_id, title: r.title, fileName: r.file_name, fileType: r.file_type,
        // A one-off review says so rather than naming a step it never had.
        stageName: r.source === "adhoc" ? "Sent for review" : r.stage_name,
        boardName: r.board_name, fromName: r.from_name,
        notifiedAt: Number(r.notified_at), viewedAt: r.viewed_at ? Number(r.viewed_at) : null,
        // What is being asked of them. "cc" is for information and needs
        // nothing; review and a held approval both want an answer, and the
        // card does not move until they give it.
        asks: r.source === "adhoc" ? "cc" : (r.stage_kind === "review" || r.stage_kind === "approval" ? r.stage_kind : "cc"),
        signedOffAt: r.signed_off_at ? Number(r.signed_off_at) : null,
      })),
    });
  } catch (e) { next(e); }
});

// ---------- done: read and signed off ----------
// The answer to a review or a held approval. One row is the ask and the
// answer both, so this is an UPDATE rather than a second table.
router.post("/:id/signoff", async (req, res, next) => {
  try {
    const n = await noticeFor(req.user.id, req.params.id);
    if (!n) return res.status(404).end();

    const stage = n.stage_id ? await queryOne("SELECT * FROM ea_stages WHERE id = ?", [n.stage_id]) : null;
    const kind = stage?.stage_kind || "cc";
    if (kind !== "review" && kind !== "approval") {
      return res.status(400).json({ error: "Nothing to sign off here — this was sent for information." });
    }
    if (n.signed_off_at) return res.json({ ok: true, signedOffAt: Number(n.signed_off_at) });

    const at = Date.now();
    // Reading it is implied by signing it off; a reader who went straight here
    // should not be recorded as never having opened it.
    await execute("UPDATE ea_cc_notices SET signed_off_at = ?, viewed_at = COALESCE(viewed_at, ?) WHERE id = ?",
      [at, at, n.id]);

    // An approval stage ALSO stamps the card, which is the thing that makes it
    // an approval rather than a reading. A review deliberately stamps nothing.
    if (kind === "approval") {
      await execute(
        `INSERT INTO ea_approvals (id, document_id, stage_id, approved_at, approved_by) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE approved_at = VALUES(approved_at), approved_by = VALUES(approved_by)`,
        ["eaa_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), n.document_id, n.stage_id, at, req.user.id]);
    }
    res.json({ ok: true, signedOffAt: at, stamped: kind === "approval" });
  } catch (e) { next(e); }
});

// ---------- the bytes ----------
// Serves the card's CURRENT file, so someone CC'd after a signature stage sees
// the signed copy rather than the draft that was uploaded.
router.get("/:id/file", async (req, res, next) => {
  try {
    const n = await noticeFor(req.user.id, req.params.id);
    if (!n) return res.status(404).json({ error: "Not found" });
    const d = await queryOne("SELECT * FROM ea_documents WHERE id = ?", [req.params.id]);
    if (!d) return res.status(404).json({ error: "Not found" });
    // Opening it IS reading it — stamping here is what makes the assistant's
    // report say "seen" rather than only "sent".
    if (!n.viewed_at) {
      await execute("UPDATE ea_cc_notices SET viewed_at = ? WHERE id = ?", [Date.now(), n.id]);
    }
    const { bytes } = await currentBytes(d);
    res.setHeader("Content-Type", d.file_type === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(d.file_name)}`);
    res.send(bytes);
  } catch (e) { next(e); }
});

// ---------- mark it read without opening it ----------
// For the person who has already seen the paper elsewhere and just wants it off
// their list. Never un-marks: "seen" is a fact about the past.
router.post("/:id/seen", async (req, res, next) => {
  try {
    const n = await noticeFor(req.user.id, req.params.id);
    if (!n) return res.status(404).json({ error: "Not found" });
    if (!n.viewed_at) await execute("UPDATE ea_cc_notices SET viewed_at = ? WHERE id = ?", [Date.now(), n.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
