// ============================================================
//   "Recommend changes" — the approver sends a document back (HQHB)
//   ------------------------------------------------------------
//   Instead of approving or rejecting, the approver whose turn it is writes what
//   must change. The request moves to `changes_requested` and returns to the
//   requestor, who may reply, replace the main document (only while nobody has
//   signed it yet) and add supporting documents (see attachments.js), then
//   resubmits. The route is untouched throughout, so a resubmitted request lands
//   back with the approver who asked; earlier signatures stand.
//
//   Why the main document is locked once anyone has signed: signed copies are
//   rebuilt from the main document on every signature, so replacing it would put
//   an earlier signer's signature on a version they never saw.
//
//   Gated PER ROUTE, never router.use(): this router shares the /api/requests
//   mount with requests.js, and router-level middleware would run for every
//   request route (the trap attachments.js documents).
// ============================================================
import express from "express";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import { authRequired } from "../auth.js";
import { deploymentOrg } from "../org.js";
import { query, queryOne, execute, hydrateRequest } from "../db.js";
import { writeStored } from "../filestore.js";
import { sealIfConfidential, storedNameFor } from "../confidential.js";
import { notifyUser } from "../notify.js";
import { canReject, getNextPendingSigner, requireUnlocked } from "./requests.js";
import { parseBoxes } from "./attachments.js";
import { UPLOAD_CEILING_BYTES, uploadSizeError } from "../uploadLimits.js";

const router = express.Router();
const hqhbOnly = (req, res, next) => (deploymentOrg() === "hqhb" ? next() : res.status(404).end());
const gate = [hqhbOnly, authRequired];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_CEILING_BYTES } });

const MAX_TEXT = 4000;
const newId = () => "rec_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Has anyone already signed this request? Single-team requests are only ever
// signed at approval, so for them the answer while undecided is always no.
async function anyoneSigned(requestId) {
  return !!(await queryOne(
    `SELECT 1 AS ok FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id
      WHERE st.request_id = ? AND sg.status = 'signed' LIMIT 1`, [requestId]));
}

// ---------- POST /api/requests/:id/recommend ----------
// body: { recommendation } — whoever may reject right now may recommend changes.
// Exported so an executive assistant can recommend changes ON BEHALF of an
// executive through this same code (routes/assist.js).
router.post("/:id/recommend", ...gate, (req, res, next) => recommendHandler(req, res, next));
export async function recommendHandler(req, res, next) {
  try {
    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.status !== "pending") {
      return res.status(400).json({ error: "Only a document awaiting approval can be sent back for changes" });
    }
    if (!(await canReject(req.user, row))) {
      return res.status(403).json({ error: "Only the approver whose turn it is can recommend changes" });
    }
    // You cannot ask for changes to what you are not permitted to read.
    if (row.confidential) {
      const locked = await requireUnlocked(req, row);
      if (locked) return res.status(403).json(locked);
    }
    const recommendation = String(req.body?.recommendation || "").trim();
    if (!recommendation) return res.status(400).json({ error: "Write what needs to change" });
    if (recommendation.length > MAX_TEXT) return res.status(400).json({ error: `Keep it under ${MAX_TEXT} characters` });

    // Guarded on status so two approvers acting at once cannot both send it back.
    const moved = await execute(
      "UPDATE requests SET status = 'changes_requested' WHERE id = ? AND status = 'pending'", [row.id]);
    if (!moved.affectedRows) return res.status(409).json({ error: "This document was just acted on by someone else" });

    const [{ n }] = await query("SELECT COUNT(*) AS n FROM request_recommendations WHERE request_id = ?", [row.id]);
    await execute(
      `INSERT INTO request_recommendations (id, request_id, round, requested_by, requested_at, recommendation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), row.id, Number(n) + 1, req.user.id, Date.now(), recommendation]
    );

    const requestor = await queryOne("SELECT * FROM users WHERE id = ?", [row.requestor_id]);
    notifyUser({
      user: requestor, requestId: row.id, template: "changes_requested",
      ctx: {
        requestorName: requestor?.name, approverName: req.user.name, fileName: row.file_name,
        recommendation, confidential: !!row.confidential, requestId: row.id,
      },
    }).catch(() => {});

    const updated = await queryOne("SELECT * FROM requests WHERE id = ?", [row.id]);
    res.json({ request: await hydrateRequest(updated) });
  } catch (e) { next(e); }
}

// ---------- POST /api/requests/:id/resubmit ----------
// multipart: file? (a revised main document), reply?, boxes? (JSON — the current
// approver's signature boxes on the revised document; kept as they were if absent).
router.post("/:id/resubmit", ...gate, upload.single("file"), async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.requestor_id !== req.user.id) return res.status(403).json({ error: "Only the requestor can resubmit" });
    if (row.status !== "changes_requested") {
      return res.status(400).json({ error: "Only a document returned for changes can be resubmitted" });
    }
    const reply = String(req.body?.reply || "").trim();
    if (reply.length > MAX_TEXT) return res.status(400).json({ error: `Keep the reply under ${MAX_TEXT} characters` });

    const open = await queryOne(
      "SELECT * FROM request_recommendations WHERE request_id = ? AND resubmitted_at IS NULL ORDER BY round DESC LIMIT 1",
      [row.id]);

    let replaced = false;
    if (req.file) {
      const tooBig = uploadSizeError(req.file);
      if (tooBig) return res.status(413).json({ error: tooBig });
      const ext = (req.file.originalname.split(".").pop() || "").toLowerCase();
      const type = ext === "pdf" ? "pdf" : ["xlsx", "xls"].includes(ext) ? "xlsx" : null;
      if (!type) return res.status(400).json({ error: "Only PDF or Excel accepted" });
      if (type !== row.file_type) {
        return res.status(400).json({ error: `The revised document must be a ${row.file_type === "pdf" ? "PDF" : "Excel file"}, like the original` });
      }
      if (await anyoneSigned(row.id)) {
        return res.status(409).json({ error: "Someone has already signed this document, so it can't be replaced. Add a supporting document instead." });
      }
      if (type === "pdf") {
        try { await PDFDocument.load(req.file.buffer, { ignoreEncryption: true }); }
        catch { return res.status(400).json({ error: "That PDF could not be opened — please check the file" }); }
      }
      let boxes = null;
      if (req.body?.boxes) {
        boxes = parseBoxes(req.body.boxes);
        if (!boxes) return res.status(400).json({ error: "The signature boxes on the revised document are not valid" });
      }

      // A new stored name per round: the original stays on file as the record of
      // what was first submitted.
      const round = open ? Number(open.round) : 0;
      const storedName = await writeStored(
        "documents",
        storedNameFor(`${row.id}.r${round}.${type}`, row.confidential),
        sealIfConfidential(req.file.buffer, row.confidential),
        { contentType: type === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
      );
      await execute(
        "UPDATE requests SET file_path = ?, file_name = ?, signed_file_path = NULL, applied_signature_path = NULL WHERE id = ?",
        [storedName, req.file.originalname, row.id]);

      if (boxes) {
        const signer = await getNextPendingSigner(row.id);
        if (signer) {
          const first = boxes[0];
          await execute(
            `UPDATE request_step_signers SET boxes_json = ?, page = ?, marker_x = ?, marker_y = ?, marker_w = ?, marker_h = ? WHERE id = ?`,
            [boxes.length > 1 ? JSON.stringify(boxes) : null, first.page, first.x, first.y, first.w, first.h, signer.id]);
        } else {
          // Single-team request: the boxes are the team approver's marker.
          await execute("UPDATE requests SET marker_json = ? WHERE id = ?", [JSON.stringify(boxes), row.id]);
        }
      }
      replaced = true;
    }

    if (open) {
      await execute(
        "UPDATE request_recommendations SET resubmitted_at = ?, reply = ?, document_replaced = ? WHERE id = ?",
        [Date.now(), reply || null, replaced ? 1 : 0, open.id]);
    }
    const moved = await execute(
      "UPDATE requests SET status = 'pending' WHERE id = ? AND status = 'changes_requested'", [row.id]);
    if (!moved.affectedRows) return res.status(409).json({ error: "This document changed while you were resubmitting — refresh and try again" });

    // Back to the approver who asked.
    const asker = open ? await queryOne("SELECT * FROM users WHERE id = ?", [open.requested_by]) : null;
    if (asker) {
      const fresh = await queryOne("SELECT file_name FROM requests WHERE id = ?", [row.id]);
      notifyUser({
        user: asker, requestId: row.id, template: "resubmitted",
        ctx: {
          approverName: asker.name, requestorName: req.user.name, fileName: fresh?.file_name || row.file_name,
          reply, documentReplaced: replaced, confidential: !!row.confidential, requestId: row.id,
        },
      }).catch(() => {});
    }

    const updated = await queryOne("SELECT * FROM requests WHERE id = ?", [row.id]);
    res.json({ request: await hydrateRequest(updated) });
  } catch (e) { next(e); }
});

export default router;
