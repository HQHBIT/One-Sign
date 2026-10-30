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
      `SELECT n.id, n.document_id, n.stage_id, n.notified_at, n.viewed_at,
              d.title, d.file_name, d.file_type,
              s.name AS stage_name, b.name AS board_name, u.name AS from_name
         FROM ea_cc_notices n
         JOIN ea_documents d ON d.id = n.document_id
         JOIN ea_stages    s ON s.id = n.stage_id
         JOIN ea_boards    b ON b.id = d.board_id
         JOIN users        u ON u.id = b.owner_id
        WHERE n.user_id = ?
        ORDER BY n.notified_at DESC`, [req.user.id]);
    res.json({
      documents: rows.map((r) => ({
        id: r.document_id, title: r.title, fileName: r.file_name, fileType: r.file_type,
        stageName: r.stage_name, boardName: r.board_name, fromName: r.from_name,
        notifiedAt: Number(r.notified_at), viewedAt: r.viewed_at ? Number(r.viewed_at) : null,
      })),
    });
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
