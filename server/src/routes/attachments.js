// ============================================================
//   SUPPORTING DOCUMENTS THAT NOBODY SIGNS
//   ------------------------------------------------------------
//   A requestor uploading two documents where only one needs a signature sends
//   the other as an attachment: it rides along on the signed document's request,
//   the approver reads it to decide, and one approval covers both.
//
//   The attachment is never stamped and never merged into the signed output —
//   the signed artefact stays exactly the document the approver agreed to sign.
//
//   HQHB organisation only, the same way ea-flow.js is: the routes 404 elsewhere
//   rather than existing-but-refusing, so a WAQF box does not reveal them.
// ============================================================
import express from "express";
import multer from "multer";
import { authRequired } from "../auth.js";
import { deploymentOrg } from "../org.js";
import { query, queryOne, execute } from "../db.js";
import { readStored, writeStored, deleteStored } from "../filestore.js";
import { sealIfConfidential, storedNameFor } from "../confidential.js";
import { authoriseAccess, requireUnlocked, logAccess } from "./requests.js";
import { UPLOAD_CEILING_BYTES, uploadSizeError } from "../uploadLimits.js";

const router = express.Router();

// One box serves one organisation; this is an HQHB practice.
//
// Applied PER ROUTE, never with router.use(). This router is mounted on
// /api/requests — the same path as requests.js — so router-level middleware
// would run for every request route and 404 the entire requests API on any box
// that is not HQHB. Per-route keeps non-matching paths falling through
// untouched to the router behind this one.
const hqhbOnly = (req, res, next) => (deploymentOrg() === "hqhb" ? next() : res.status(404).end());
const gate = [hqhbOnly, authRequired];

// Same ceiling as a request's own document, so an attachment cannot be used to
// get a larger file past the uploader.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_CEILING_BYTES },
});

// Large enough for a covering letter and a quotation, small enough that an
// approver is not handed a reading list before they can decide.
const MAX_ATTACHMENTS = 5;

const newId = () => "att_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const extOf = (name) => String(name || "").split(".").pop().toLowerCase();
const typeFor = (ext) => (ext === "pdf" ? "pdf" : ext === "xlsx" || ext === "xls" ? "xlsx" : null);

const contentTypeFor = (fileType) =>
  fileType === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const shape = (r) => ({
  id: r.id,
  requestId: r.request_id,
  fileName: r.file_name,
  fileType: r.file_type,
  fileSize: Number(r.file_size || 0),
  confidential: !!Number(r.confidential),
  uploadedAt: Number(r.uploaded_at),
  // Where it sits relative to the signed document, as the requestor arranged
  // them: negative renders before it, positive after.
  sortOrder: Number(r.sort_order ?? 1),
});

// The parent request, or a response already sent. Everything here hangs off a
// request, so this is the one place that decides whether the caller may see it.
async function parentOr(res, id) {
  const row = await queryOne("SELECT * FROM requests WHERE id = ?", [id]);
  if (!row) { res.status(404).end(); return null; }
  return row;
}

// ---------- POST /api/requests/:id/attachments ----------
// The requestor attaches a supporting document to their own request, while it
// is still pending. Deliberately not allowed afterwards: a document must never
// appear underneath a signature that was already given.
router.post("/:id/attachments", ...gate, upload.single("file"), async (req, res, next) => {
  try {
    const row = await parentOr(res, req.params.id);
    if (!row) return;

    if (row.requestor_id !== req.user.id) {
      return res.status(403).json({ error: "Only the requestor can attach a document" });
    }
    if (row.status !== "pending") {
      return res.status(400).json({ error: "Attachments can only be added while the request is awaiting approval" });
    }

    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const tooBig = uploadSizeError(file);
    if (tooBig) return res.status(413).json({ error: tooBig });

    const fileType = typeFor(extOf(file.originalname));
    if (!fileType) return res.status(400).json({ error: "Attachments must be PDF or Excel (.pdf, .xlsx, .xls)" });

    const [{ n }] = await query(
      "SELECT COUNT(*) AS n FROM request_attachments WHERE request_id = ?", [row.id]);
    if (Number(n) >= MAX_ATTACHMENTS) {
      return res.status(400).json({ error: `Up to ${MAX_ATTACHMENTS} attachments per request` });
    }

    // Confidentiality is the PARENT's, not the caller's claim. A confidential
    // request that leaked through its attachment would be worse than one that
    // was never marked confidential, because the marking implies protection.
    const confidential = Number(row.confidential) ? 1 : 0;
    const id = newId();
    const storedName = await writeStored(
      "documents",
      storedNameFor(`${id}.${fileType === "pdf" ? "pdf" : "xlsx"}`, confidential),
      sealIfConfidential(file.buffer, confidential),
      { contentType: contentTypeFor(fileType) }
    );

    // The requestor sends the position they arranged; anything unparseable
    // falls back to 1, which puts it after the signed document.
    const rawOrder = parseInt(req.body?.sortOrder, 10);
    const sortOrder = Number.isFinite(rawOrder) ? rawOrder : 1;

    await execute(
      `INSERT INTO request_attachments
         (id, request_id, file_name, file_path, file_type, file_size, confidential, uploaded_by, uploaded_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, row.id, file.originalname, storedName, fileType, file.buffer.length, confidential, req.user.id, Date.now(), sortOrder]
    );

    const saved = await queryOne("SELECT * FROM request_attachments WHERE id = ?", [id]);
    res.json({ attachment: shape(saved) });
  } catch (e) { next(e); }
});

// ---------- GET /api/requests/:id/attachments ----------
// Whoever may see the request may see what came with it: authoriseAccess already
// knows about the requestor, the workflow's approvers, executive assistants and
// the HOD, and a second copy of that rule here would drift from it.
router.get("/:id/attachments", ...gate, async (req, res, next) => {
  try {
    const row = await parentOr(res, req.params.id);
    if (!row) return;
    if (!(await authoriseAccess(req.user, row))) return res.status(403).end();

    const rows = await query(
      "SELECT * FROM request_attachments WHERE request_id = ? ORDER BY sort_order ASC, uploaded_at ASC", [row.id]);
    res.json({ attachments: rows.map(shape) });
  } catch (e) { next(e); }
});

// ---------- GET /api/requests/:id/attachments/:attId/file ----------
router.get("/:id/attachments/:attId/file", ...gate, async (req, res, next) => {
  try {
    const row = await parentOr(res, req.params.id);
    if (!row) return;
    if (!(await authoriseAccess(req.user, row))) return res.status(403).end();

    const att = await queryOne(
      "SELECT * FROM request_attachments WHERE id = ? AND request_id = ?",
      [req.params.attId, row.id]);
    if (!att) return res.status(404).end();

    // A confidential parent gates its attachments exactly as it gates its own
    // document — same unlock, same access log, same download restriction.
    if (Number(att.confidential)) {
      const gate = await requireUnlocked(req, row);
      if (gate) return res.status(403).json(gate);
      const wantsDownload = req.query?.download === "1";
      if (wantsDownload && !(row.requestor_id === req.user.id && row.status === "approved")) {
        return res.status(403).json({ error: "Confidential documents can only be downloaded by the requestor, once fully signed" });
      }
      await logAccess(req, row.id, wantsDownload ? "download" : "view");
    }

    res.type(contentTypeFor(att.file_type));
    res.send(await readStored("documents", att.file_path));
  } catch (e) { next(e); }
});

// ---------- DELETE /api/requests/:id/attachments/:attId ----------
// While still pending, so a wrong file is not permanent. After approval the
// attachment is part of what was decided on and stays.
router.delete("/:id/attachments/:attId", ...gate, async (req, res, next) => {
  try {
    const row = await parentOr(res, req.params.id);
    if (!row) return;
    if (row.requestor_id !== req.user.id) {
      return res.status(403).json({ error: "Only the requestor can remove an attachment" });
    }
    if (row.status !== "pending") {
      return res.status(400).json({ error: "Attachments can only be removed while the request is awaiting approval" });
    }

    const att = await queryOne(
      "SELECT * FROM request_attachments WHERE id = ? AND request_id = ?",
      [req.params.attId, row.id]);
    if (!att) return res.status(404).end();

    await execute("DELETE FROM request_attachments WHERE id = ?", [att.id]);
    // The row is the record; a file left behind would be an orphan nobody can
    // reach, so remove it after the row is gone rather than before.
    await deleteStored("documents", att.file_path).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
