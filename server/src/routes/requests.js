import { Router } from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getPool, query, queryOne, execute, hydrateRequest } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { sendEmail } from "../email.js";
import { stampPdf, stampPdfMulti, writeXlsxSignatureManifest, bakeOrientation } from "../pdf.js";
import { rotateMarker90CW } from "../pdf-rotation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC_DIR = path.join(__dirname, "..", "..", "uploads", "documents");
const SIG_DIR = path.join(__dirname, "..", "..", "uploads", "signatures");
const SIGNED_DIR = path.join(__dirname, "..", "..", "uploads", "signed");

const router = Router();
const uid = (p = "req") => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const APPROVAL_WINDOW_MS = parseInt(process.env.APPROVAL_WINDOW_MS || "3600000", 10);
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

function parseOrientation(raw) {
  const v = (raw || "").toString().toLowerCase();
  return v === "landscape" ? "landscape" : v === "portrait" ? "portrait" : null;
}

// Bake the orientation into the uploaded PDF bytes and return the new buffer
// plus the per-page rotation plan. Non-PDFs and missing orientation pass through.
async function bakeRequestFile({ buffer, fileType, orientation }) {
  if (fileType !== "pdf" || !orientation) {
    return { bakedBuffer: buffer, pageRotations: [] };
  }
  const { bakedBytes, pageRotations } = await bakeOrientation(buffer, orientation);
  return { bakedBuffer: Buffer.from(bakedBytes), pageRotations };
}

// Apply the per-page rotation plan to a marker. If the marker's page was rotated
// 90° CW during the bake, rotate the marker the same way; otherwise return as-is.
function transformMarkerForBake(marker, pageRotations) {
  const pageIdx = (marker.page || 1) - 1;
  if (pageRotations[pageIdx] !== 90) return marker;
  const r = rotateMarker90CW({ x: marker.x, y: marker.y, w: marker.w, h: marker.h });
  return { ...marker, ...r };
}

// ============================================================
//   list (role-scoped)
// ============================================================
router.get("/", authRequired, async (req, res, next) => {
  try {
    const u = req.user;
    let rows;
    if (u.role === "admin") {
      rows = await query("SELECT * FROM requests ORDER BY created_at DESC");
    } else if (u.role === "requestor") {
      // Own requests PLUS any request where they are an assigned signer (direct requests).
      rows = await query(`
        SELECT DISTINCT r.* FROM requests r
        LEFT JOIN request_steps st ON st.request_id = r.id
        LEFT JOIN request_step_signers sg ON sg.step_id = st.id
        WHERE r.requestor_id = ? OR sg.user_id = ?
        ORDER BY r.created_at DESC
      `, [u.id, u.id]);
    } else {
      // Approver: any request where they are an assigned signer (workflow), OR legacy claim path
      rows = await query(`
        SELECT DISTINCT r.* FROM requests r
        LEFT JOIN request_steps st ON st.request_id = r.id
        LEFT JOIN request_step_signers sg ON sg.step_id = st.id
        WHERE r.approver_id = ?
           OR sg.user_id = ?
           OR (r.status = 'pending'
               AND r.target_team_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM signing_authority sa WHERE sa.user_id = ? AND sa.team_id = r.target_team_id))
        ORDER BY r.created_at DESC
      `, [u.id, u.id, u.id]);
    }
    const requests = await Promise.all(rows.map(hydrateRequest));
    res.json({ requests });
  } catch (e) { next(e); }
});

// ============================================================
//   create — supports legacy single-team OR multi-step workflow
// ============================================================
router.post("/", authRequired, requireRole("requestor"), upload.single("file"), async (req, res, next) => {
  try {
    const isDirect = req.body?.direct === "true" || req.body?.direct === true;
    // A direct request only routes a document to someone else to sign — the
    // sender isn't signing, so they don't need a signature of their own.
    if (!isDirect && !req.user.hasSignature) return res.status(400).json({ error: "Add your signature first" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "file is required" });

    const ext = (file.originalname.split(".").pop() || "").toLowerCase();
    if (!["pdf", "xlsx", "xls"].includes(ext)) return res.status(400).json({ error: "Only PDF or Excel accepted" });
    const fileType = ext === "pdf" ? "pdf" : "xlsx";

    const note = req.body?.note || "";
    const instantApproval = req.body?.instantApproval === "true" || req.body?.instantApproval === true ? 1 : 0;
    const allowedTypes = ["leave", "document", "expense", "invoice", "general"];
    const rawType = (req.body?.requestType || "general").toString().toLowerCase();
    const requestType = allowedTypes.includes(rawType) ? rawType : "general";

    // ---------- branch: workflow vs legacy ----------
    let workflow = null;
    if (req.body?.workflow) {
      try { workflow = JSON.parse(req.body.workflow); }
      catch { return res.status(400).json({ error: "workflow must be valid JSON" }); }
    }

    if (Array.isArray(workflow) && workflow.length > 0) {
      return await createWorkflowRequest({ req, res, file, ext, fileType, note, instantApproval, workflow, requestType });
    }

    // ---------- direct (person-to-person) path ----------
    if (isDirect) {
      let signers = null;
      try { signers = JSON.parse(req.body.signers || "[]"); }
      catch { return res.status(400).json({ error: "signers must be valid JSON" }); }
      return await createDirectRequest({ req, res, file, ext, fileType, note, instantApproval, signers, requestType });
    }

    // ---------- legacy single-marker single-team path ----------
    const { targetTeamId, marker } = req.body || {};
    if (!targetTeamId || !marker) return res.status(400).json({ error: "Provide either workflow or targetTeamId+marker" });
    let markerObj;
    try { markerObj = JSON.parse(marker); } catch { return res.status(400).json({ error: "marker must be valid JSON" }); }
    if (markerObj && "rotation" in markerObj) delete markerObj.rotation;

    const team = await queryOne("SELECT * FROM teams WHERE id = ?", [targetTeamId]);
    if (!team) return res.status(400).json({ error: "Unknown team" });

    const approvers = await query(`
      SELECT u.* FROM users u JOIN signing_authority sa ON sa.user_id = u.id
      WHERE u.role = 'approver' AND sa.team_id = ?
    `, [targetTeamId]);
    if (approvers.length === 0) return res.status(400).json({ error: "No approvers configured for this team" });

    const orientation = parseOrientation(req.body?.orientation);
    let bakedBuffer, pageRotations;
    try {
      ({ bakedBuffer, pageRotations } = await bakeRequestFile({
        buffer: file.buffer, fileType, orientation
      }));
    } catch (e) {
      console.error("[create] bake failed", e);
      return res.status(400).json({ error: "Could not process PDF orientation" });
    }
    const bakedMarker = transformMarkerForBake(markerObj, pageRotations);

    const id = uid();
    const storedName = `${id}.${ext}`;
    await fs.mkdir(DOC_DIR, { recursive: true });
    await fs.writeFile(path.join(DOC_DIR, storedName), bakedBuffer);

    await execute(`
      INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, target_team_id, marker_json, note, status, created_at, instant_approval, current_step, request_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?)
    `, [id, req.user.id, file.originalname, storedName, fileType, targetTeamId, JSON.stringify(bakedMarker), note, Date.now(), instantApproval, requestType]);

    for (const a of approvers) {
      sendEmail({
        to: a.email, template: "new_request",
        ctx: { approverName: a.name, requestorName: req.user.name, fileName: file.originalname, teamName: team.name }
      }).catch(e => console.error("email fail", e));
    }

    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [id]);
    res.json({ request: await hydrateRequest(row), notifiedApprovers: approvers.length });
  } catch (e) { next(e); }
});

async function createWorkflowRequest({ req, res, file, ext, fileType, note, instantApproval, workflow, requestType = "general" }) {
  // Validate workflow shape
  for (const [i, step] of workflow.entries()) {
    if (!step?.teamId) return res.status(400).json({ error: `Step ${i + 1}: teamId required` });
    if (!Array.isArray(step.signers) || step.signers.length === 0) {
      return res.status(400).json({ error: `Step ${i + 1}: at least one signer required` });
    }
    for (const [j, s] of step.signers.entries()) {
      if (!s.userId) return res.status(400).json({ error: `Step ${i + 1} signer ${j + 1}: userId required` });
      if (typeof s.x !== "number" || typeof s.y !== "number" || typeof s.w !== "number" || typeof s.h !== "number") {
        return res.status(400).json({ error: `Step ${i + 1} signer ${j + 1}: marker x/y/w/h required` });
      }
    }
  }

  // Validate teams exist + signers belong to team + have signatures
  const teamIds = [...new Set(workflow.map(s => s.teamId))];
  const userIds = [...new Set(workflow.flatMap(s => s.signers.map(g => g.userId)))];
  const teamRows = await query(`SELECT * FROM teams WHERE id IN (${teamIds.map(() => "?").join(",")})`, teamIds);
  if (teamRows.length !== teamIds.length) return res.status(400).json({ error: "One or more teams unknown" });
  const teamById = Object.fromEntries(teamRows.map(t => [t.id, t]));

  const userRows = await query(`SELECT * FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`, userIds);
  const userById = Object.fromEntries(userRows.map(u => [u.id, u]));
  for (const step of workflow) {
    for (const s of step.signers) {
      const u = userById[s.userId];
      if (!u) return res.status(400).json({ error: `Unknown signer: ${s.userId}` });
      if (u.role !== "approver") return res.status(400).json({ error: `${u.name} is not an approver` });
      if (!u.signature_path) return res.status(400).json({ error: `${u.name} has no signature on file` });
      const auth = await queryOne("SELECT 1 AS ok FROM signing_authority WHERE user_id = ? AND team_id = ?", [s.userId, step.teamId]);
      if (!auth) return res.status(400).json({ error: `${u.name} has no signing authority for ${teamById[step.teamId].name}` });
    }
  }

  const orientation = parseOrientation(req.body?.orientation);
  let bakedBuffer, pageRotations;
  try {
    ({ bakedBuffer, pageRotations } = await bakeRequestFile({
      buffer: file.buffer, fileType, orientation
    }));
  } catch (e) {
    console.error("[create workflow] bake failed", e);
    return res.status(400).json({ error: "Could not process PDF orientation" });
  }
  for (const step of workflow) {
    for (const s of step.signers) {
      const baked = transformMarkerForBake(
        { x: s.x, y: s.y, w: s.w, h: s.h, page: s.page || 1 },
        pageRotations
      );
      s.x = baked.x; s.y = baked.y; s.w = baked.w; s.h = baked.h;
      delete s.rotation;
    }
  }

  const id = uid();
  const storedName = `${id}.${ext}`;
  await fs.mkdir(DOC_DIR, { recursive: true });
  await fs.writeFile(path.join(DOC_DIR, storedName), bakedBuffer);

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`
      INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, target_team_id, marker_json, note, status, created_at, instant_approval, current_step, request_type)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'pending', ?, ?, 1, ?)
    `, [id, req.user.id, file.originalname, storedName, fileType, workflow[0].teamId, note, Date.now(), instantApproval, requestType]);

    for (let i = 0; i < workflow.length; i++) {
      const step = workflow[i];
      const stepId = uid("st");
      const status = i === 0 ? "active" : "pending";
      await conn.execute(
        "INSERT INTO request_steps (id, request_id, step_order, team_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [stepId, id, i + 1, step.teamId, status, Date.now()]
      );
      for (let j = 0; j < step.signers.length; j++) {
        const s = step.signers[j];
        await conn.execute(
          `INSERT INTO request_step_signers (id, step_id, signer_order, user_id, page, marker_x, marker_y, marker_w, marker_h, rotation, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [uid("sg"), stepId, j + 1, s.userId, s.page || 1, s.x, s.y, s.w, s.h, 0]
        );
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  // Notify the first signer
  await notifyNextSigner(id, file.originalname, req.user.name);

  const row = await queryOne("SELECT * FROM requests WHERE id = ?", [id]);
  res.json({ request: await hydrateRequest(row) });
}

// Direct request: one step, no team, one (or more) arbitrary signers. Unlike the
// team-workflow path it does NOT require the signer to be an approver, to have
// team signing authority, or to already have a signature on file — the recipient
// adds a signature when they go to sign. PDF only (the signing path stamps PDFs).
async function createDirectRequest({ req, res, file, ext, fileType, note, instantApproval, signers, requestType = "general" }) {
  if (fileType !== "pdf") return res.status(400).json({ error: "Direct requests support PDF documents only" });
  if (!Array.isArray(signers) || signers.length === 0) return res.status(400).json({ error: "Add at least one recipient" });
  for (const [i, s] of signers.entries()) {
    if (!s.userId) return res.status(400).json({ error: `Recipient ${i + 1}: userId required` });
    if (typeof s.x !== "number" || typeof s.y !== "number" || typeof s.w !== "number" || typeof s.h !== "number") {
      return res.status(400).json({ error: `Recipient ${i + 1}: signature box not placed` });
    }
  }

  const userIds = [...new Set(signers.map(s => s.userId))];
  if (userIds.includes(req.user.id)) return res.status(400).json({ error: "You can't request a signature from yourself" });
  const userRows = await query(`SELECT id FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`, userIds);
  if (userRows.length !== userIds.length) return res.status(400).json({ error: "One or more recipients no longer exist" });

  const orientation = parseOrientation(req.body?.orientation);
  let bakedBuffer, pageRotations;
  try {
    ({ bakedBuffer, pageRotations } = await bakeRequestFile({ buffer: file.buffer, fileType, orientation }));
  } catch (e) {
    console.error("[create direct] bake failed", e);
    return res.status(400).json({ error: "Could not process PDF orientation" });
  }
  for (const s of signers) {
    const baked = transformMarkerForBake({ x: s.x, y: s.y, w: s.w, h: s.h, page: s.page || 1 }, pageRotations);
    s.x = baked.x; s.y = baked.y; s.w = baked.w; s.h = baked.h;
  }

  const id = uid();
  const storedName = `${id}.${ext}`;
  await fs.mkdir(DOC_DIR, { recursive: true });
  await fs.writeFile(path.join(DOC_DIR, storedName), bakedBuffer);

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`
      INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, target_team_id, marker_json, note, status, created_at, instant_approval, current_step, request_type)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 'pending', ?, ?, 1, ?)
    `, [id, req.user.id, file.originalname, storedName, fileType, note, Date.now(), instantApproval, requestType]);

    const stepId = uid("st");
    await conn.execute(
      "INSERT INTO request_steps (id, request_id, step_order, team_id, status, created_at) VALUES (?, ?, 1, NULL, 'active', ?)",
      [stepId, id, Date.now()]
    );
    for (let j = 0; j < signers.length; j++) {
      const s = signers[j];
      await conn.execute(
        `INSERT INTO request_step_signers (id, step_id, signer_order, user_id, page, marker_x, marker_y, marker_w, marker_h, rotation, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [uid("sg"), stepId, j + 1, s.userId, s.page || 1, s.x, s.y, s.w, s.h, 0]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  await notifyNextSigner(id, file.originalname, req.user.name);
  const row = await queryOne("SELECT * FROM requests WHERE id = ?", [id]);
  res.json({ request: await hydrateRequest(row) });
}

async function notifyNextSigner(requestId, fileName, requestorName) {
  const next = await getNextPendingSigner(requestId);
  if (!next) return;
  const u = await queryOne("SELECT * FROM users WHERE id = ?", [next.user_id]);
  if (!u) return;
  sendEmail({
    to: u.email, template: "new_request",
    ctx: { approverName: u.name, requestorName, fileName, teamName: "(workflow step)" }
  }).catch(e => console.error("email fail", e));
}

async function getNextPendingSigner(requestId) {
  return await queryOne(`
    SELECT sg.* FROM request_step_signers sg
    JOIN request_steps st ON st.id = sg.step_id
    WHERE st.request_id = ? AND st.status = 'active' AND sg.status = 'pending'
    ORDER BY sg.signer_order ASC LIMIT 1
  `, [requestId]);
}

// ============================================================
//   authorise access
// ============================================================
async function authoriseAccess(user, row) {
  if (!row) return false;
  if (user.role === "admin") return true;
  if (user.id === row.requestor_id) return true;
  if (user.id === row.approver_id) return true;
  // Workflow signer access
  const sg = await queryOne(`
    SELECT 1 AS ok FROM request_step_signers sg
    JOIN request_steps st ON st.id = sg.step_id
    WHERE st.request_id = ? AND sg.user_id = ?
  `, [row.id, user.id]);
  if (sg) return true;
  if (user.role === "approver" && row.status === "pending" && row.target_team_id) {
    const auth = await queryOne(
      "SELECT 1 AS ok FROM signing_authority WHERE user_id = ? AND team_id = ?",
      [user.id, row.target_team_id]
    );
    if (auth) return true;
  }
  return false;
}

// ============================================================
//   preview / download
// ============================================================
router.get("/:id/file", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).end();
    if (!(await authoriseAccess(req.user, row))) return res.status(403).end();
    res.sendFile(path.join(DOC_DIR, row.file_path));
  } catch (e) { next(e); }
});

router.get("/:id/signed", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).end();
    if (!(await authoriseAccess(req.user, row))) return res.status(403).end();
    if (!row.signed_file_path) return res.status(404).json({ error: "Signed version not available" });
    res.sendFile(path.join(SIGNED_DIR, row.signed_file_path));
  } catch (e) { next(e); }
});

// ============================================================
//   approve  — handles both legacy and workflow paths
// ============================================================
router.post("/:id/approve", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.status !== "pending") return res.status(400).json({ error: "Not pending" });
    if (!req.user.hasSignature) return res.status(400).json({ error: "Add your signature first" });

    // Workflow path?
    const next = await getNextPendingSigner(row.id);
    if (next) return await approveWorkflowStep({ req, res, row, signer: next });

    // Legacy single-marker (team path) — still approver-only + team authority.
    if (req.user.role !== "approver") return res.status(403).json({ error: "Not authorised to sign this request" });
    if (!row.target_team_id || !row.marker_json) return res.status(400).json({ error: "Request misconfigured" });
    const auth = await queryOne("SELECT 1 AS ok FROM signing_authority WHERE user_id = ? AND team_id = ?", [req.user.id, row.target_team_id]);
    if (!auth) return res.status(403).json({ error: "No signing authority for this team" });

    const sigPathFull = path.join(SIG_DIR, req.userRow.signature_path);
    const marker = JSON.parse(row.marker_json);
    marker.signerName = req.user.name;
    marker.signedAt = Date.now();

    let signedPath = null;
    try {
      if (row.file_type === "pdf") {
        const outName = `${row.id}.signed.pdf`;
        await stampPdf({ srcPath: path.join(DOC_DIR, row.file_path), signaturePath: sigPathFull, marker, outName });
        signedPath = outName;
      } else {
        const manifest = await writeXlsxSignatureManifest({
          srcPath: path.join(DOC_DIR, row.file_path), signaturePath: sigPathFull, marker, outName: row.id
        });
        signedPath = path.basename(manifest);
      }
    } catch (e) {
      console.error("[approve] stamp failed", e);
      return res.status(500).json({ error: "Failed to stamp signature" });
    }

    if (row.instant_approval) {
      await execute(`
        UPDATE requests SET status = 'approved', approver_id = ?, approved_at = ?, finalized_at = ?,
          applied_signature_path = ?, signed_file_path = ?
        WHERE id = ?
      `, [req.user.id, Date.now(), Date.now(), req.userRow.signature_path, signedPath, row.id]);
    } else {
      await execute(`
        UPDATE requests SET status = 'approved_pending', approver_id = ?, approved_at = ?,
          applied_signature_path = ?, signed_file_path = ?
        WHERE id = ?
      `, [req.user.id, Date.now(), req.userRow.signature_path, signedPath, row.id]);
    }

    const updated = await queryOne("SELECT * FROM requests WHERE id = ?", [row.id]);
    res.json({ request: await hydrateRequest(updated), approvalWindowMs: row.instant_approval ? 0 : APPROVAL_WINDOW_MS });
  } catch (e) { next(e); }
});

async function approveWorkflowStep({ req, res, row, signer }) {
  if (signer.user_id !== req.user.id) {
    const u = await queryOne("SELECT name FROM users WHERE id = ?", [signer.user_id]);
    return res.status(403).json({ error: `Awaiting signature from ${u?.name || "another signer"}` });
  }

  // Stamp the PDF: re-build from original applying ALL signed signers + this one
  if (row.file_type !== "pdf") {
    return res.status(400).json({ error: "Workflow currently supports PDF only" });
  }

  // Mark this signer as signed FIRST so the rebuild includes it
  await execute(
    "UPDATE request_step_signers SET status = 'signed', signed_at = ?, signature_path = ? WHERE id = ?",
    [Date.now(), req.userRow.signature_path, signer.id]
  );

  // Collect all signed signers in order to stamp
  const allSigned = await query(`
    SELECT sg.*, u.name AS user_name FROM request_step_signers sg
    JOIN request_steps st ON st.id = sg.step_id
    JOIN users u ON u.id = sg.user_id
    WHERE st.request_id = ? AND sg.status = 'signed'
    ORDER BY st.step_order, sg.signer_order
  `, [row.id]);

  const stamps = allSigned.map(s => ({
    signaturePath: path.join(SIG_DIR, s.signature_path),
    page: s.page, x: Number(s.marker_x), y: Number(s.marker_y),
    w: Number(s.marker_w), h: Number(s.marker_h),
    signerName: s.user_name,
    signedAt: s.signed_at ? Number(s.signed_at) : Date.now()
  }));

  let signedPath;
  try {
    const outName = `${row.id}.signed.pdf`;
    await stampPdfMulti({ srcPath: path.join(DOC_DIR, row.file_path), stamps, outName });
    signedPath = outName;
  } catch (e) {
    console.error("[approve workflow] stamp failed", e);
    // Roll back the signer status so it can be retried
    await execute("UPDATE request_step_signers SET status = 'pending', signed_at = NULL, signature_path = NULL WHERE id = ?", [signer.id]);
    return res.status(500).json({ error: "Failed to stamp signature" });
  }

  // Are there more pending signers in this step?
  const remainingInStep = await queryOne(
    "SELECT 1 AS ok FROM request_step_signers WHERE step_id = ? AND status = 'pending'",
    [signer.step_id]
  );

  if (remainingInStep) {
    // Same step still active — just update signed file path
    await execute("UPDATE requests SET signed_file_path = ?, applied_signature_path = ? WHERE id = ?",
      [signedPath, req.userRow.signature_path, row.id]);
    await notifyNextSigner(row.id, row.file_name, "");
  } else {
    // Mark step done
    await execute("UPDATE request_steps SET status = 'done' WHERE id = ?", [signer.step_id]);
    // Activate next step?
    const nextStep = await queryOne(
      "SELECT * FROM request_steps WHERE request_id = ? AND status = 'pending' ORDER BY step_order ASC LIMIT 1",
      [row.id]
    );
    if (nextStep) {
      await execute("UPDATE request_steps SET status = 'active' WHERE id = ?", [nextStep.id]);
      await execute("UPDATE requests SET signed_file_path = ?, applied_signature_path = ?, current_step = ? WHERE id = ?",
        [signedPath, req.userRow.signature_path, nextStep.step_order, row.id]);
      await notifyNextSigner(row.id, row.file_name, "");
    } else {
      // All steps done — finalize (instant) or enter cooling window
      if (row.instant_approval) {
        await execute(`
          UPDATE requests SET status = 'approved', approver_id = ?, approved_at = ?, finalized_at = ?,
            applied_signature_path = ?, signed_file_path = ?
          WHERE id = ?
        `, [req.user.id, Date.now(), Date.now(), req.userRow.signature_path, signedPath, row.id]);
      } else {
        await execute(`
          UPDATE requests SET status = 'approved_pending', approver_id = ?, approved_at = ?,
            applied_signature_path = ?, signed_file_path = ?
          WHERE id = ?
        `, [req.user.id, Date.now(), req.userRow.signature_path, signedPath, row.id]);
      }
      // Notify requestor
      const requestor = await queryOne("SELECT * FROM users WHERE id = ?", [row.requestor_id]);
      sendEmail({
        to: requestor?.email, template: "approved",
        ctx: { requestorName: requestor?.name, fileName: row.file_name, approverName: req.user.name }
      }).catch(() => {});
    }
  }

  const updated = await queryOne("SELECT * FROM requests WHERE id = ?", [row.id]);
  res.json({ request: await hydrateRequest(updated), approvalWindowMs: row.instant_approval ? 0 : APPROVAL_WINDOW_MS });
}

// ============================================================
//   batch approve — one signature, many requests
// ============================================================
router.post("/batch-approve", authRequired, requireRole("approver"), async (req, res, next) => {
  try {
    if (!req.user.hasSignature) return res.status(400).json({ error: "Add your signature first" });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: "ids required" });

    const results = { approved: [], failed: [] };
    for (const id of ids) {
      try {
        // Reuse the same single-approve logic by simulating a per-request approve call.
        const row = await queryOne("SELECT * FROM requests WHERE id = ?", [id]);
        if (!row) { results.failed.push({ id, error: "Not found" }); continue; }
        if (row.status !== "pending") { results.failed.push({ id, error: "Not pending" }); continue; }

        const next = await getNextPendingSigner(row.id);
        if (next) {
          if (next.user_id !== req.user.id) {
            const u = await queryOne("SELECT name FROM users WHERE id = ?", [next.user_id]);
            results.failed.push({ id, error: `Awaiting ${u?.name || "another signer"}` });
            continue;
          }
          // Manually run the workflow-step approval inline (avoid res manipulation).
          const ok = await approveWorkflowStepInline({ req, row, signer: next });
          if (ok.error) results.failed.push({ id, error: ok.error });
          else results.approved.push(id);
        } else {
          // Legacy single-marker path
          if (!row.target_team_id || !row.marker_json) {
            results.failed.push({ id, error: "Misconfigured" });
            continue;
          }
          const auth = await queryOne("SELECT 1 AS ok FROM signing_authority WHERE user_id = ? AND team_id = ?", [req.user.id, row.target_team_id]);
          if (!auth) { results.failed.push({ id, error: "No authority" }); continue; }
          const sigPathFull = path.join(SIG_DIR, req.userRow.signature_path);
          const marker = JSON.parse(row.marker_json);
    marker.signerName = req.user.name;
    marker.signedAt = Date.now();
          let signedPath;
          try {
            if (row.file_type === "pdf") {
              const outName = `${row.id}.signed.pdf`;
              await stampPdf({ srcPath: path.join(DOC_DIR, row.file_path), signaturePath: sigPathFull, marker, outName });
              signedPath = outName;
            } else {
              const manifest = await writeXlsxSignatureManifest({
                srcPath: path.join(DOC_DIR, row.file_path), signaturePath: sigPathFull, marker, outName: row.id
              });
              signedPath = path.basename(manifest);
            }
          } catch (e) {
            results.failed.push({ id, error: "Stamp failed" });
            continue;
          }
          if (row.instant_approval) {
            await execute(`UPDATE requests SET status = 'approved', approver_id = ?, approved_at = ?, finalized_at = ?, applied_signature_path = ?, signed_file_path = ? WHERE id = ?`,
              [req.user.id, Date.now(), Date.now(), req.userRow.signature_path, signedPath, row.id]);
          } else {
            await execute(`UPDATE requests SET status = 'approved_pending', approver_id = ?, approved_at = ?, applied_signature_path = ?, signed_file_path = ? WHERE id = ?`,
              [req.user.id, Date.now(), req.userRow.signature_path, signedPath, row.id]);
          }
          results.approved.push(id);
        }
      } catch (e) {
        results.failed.push({ id, error: e.message || String(e) });
      }
    }

    res.json(results);
  } catch (e) { next(e); }
});

// Inline workflow-step approval used by batch-approve. Returns { error?: string }.
async function approveWorkflowStepInline({ req, row, signer }) {
  await execute(
    "UPDATE request_step_signers SET status = 'signed', signed_at = ?, signature_path = ? WHERE id = ?",
    [Date.now(), req.userRow.signature_path, signer.id]
  );

  const allSigned = await query(`
    SELECT sg.*, u.name AS user_name FROM request_step_signers sg
    JOIN request_steps st ON st.id = sg.step_id
    JOIN users u ON u.id = sg.user_id
    WHERE st.request_id = ? AND sg.status = 'signed'
    ORDER BY st.step_order, sg.signer_order
  `, [row.id]);

  const stamps = allSigned.map(s => ({
    signaturePath: path.join(SIG_DIR, s.signature_path),
    page: s.page, x: Number(s.marker_x), y: Number(s.marker_y),
    w: Number(s.marker_w), h: Number(s.marker_h),
    signerName: s.user_name,
    signedAt: s.signed_at ? Number(s.signed_at) : Date.now()
  }));

  let signedPath;
  try {
    const outName = `${row.id}.signed.pdf`;
    await stampPdfMulti({ srcPath: path.join(DOC_DIR, row.file_path), stamps, outName });
    signedPath = outName;
  } catch (e) {
    await execute("UPDATE request_step_signers SET status = 'pending', signed_at = NULL, signature_path = NULL WHERE id = ?", [signer.id]);
    return { error: "Stamp failed" };
  }

  const remainingInStep = await queryOne(
    "SELECT 1 AS ok FROM request_step_signers WHERE step_id = ? AND status = 'pending'",
    [signer.step_id]
  );

  if (remainingInStep) {
    await execute("UPDATE requests SET signed_file_path = ?, applied_signature_path = ? WHERE id = ?",
      [signedPath, req.userRow.signature_path, row.id]);
    await notifyNextSigner(row.id, row.file_name, "");
  } else {
    await execute("UPDATE request_steps SET status = 'done' WHERE id = ?", [signer.step_id]);
    const nextStep = await queryOne(
      "SELECT * FROM request_steps WHERE request_id = ? AND status = 'pending' ORDER BY step_order ASC LIMIT 1",
      [row.id]
    );
    if (nextStep) {
      await execute("UPDATE request_steps SET status = 'active' WHERE id = ?", [nextStep.id]);
      await execute("UPDATE requests SET signed_file_path = ?, applied_signature_path = ?, current_step = ? WHERE id = ?",
        [signedPath, req.userRow.signature_path, nextStep.step_order, row.id]);
      await notifyNextSigner(row.id, row.file_name, "");
    } else {
      if (row.instant_approval) {
        await execute(`UPDATE requests SET status = 'approved', approver_id = ?, approved_at = ?, finalized_at = ?, applied_signature_path = ?, signed_file_path = ? WHERE id = ?`,
          [req.user.id, Date.now(), Date.now(), req.userRow.signature_path, signedPath, row.id]);
      } else {
        await execute(`UPDATE requests SET status = 'approved_pending', approver_id = ?, approved_at = ?, applied_signature_path = ?, signed_file_path = ? WHERE id = ?`,
          [req.user.id, Date.now(), req.userRow.signature_path, signedPath, row.id]);
      }
      const requestor = await queryOne("SELECT * FROM users WHERE id = ?", [row.requestor_id]);
      sendEmail({
        to: requestor?.email, template: "approved",
        ctx: { requestorName: requestor?.name, fileName: row.file_name, approverName: req.user.name }
      }).catch(() => {});
    }
  }
  return {};
}

// ============================================================
//   reject  — any signer or admin/team-authority can reject
// ============================================================
router.post("/:id/reject", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (!["pending", "approved_pending"].includes(row.status)) return res.status(400).json({ error: "Cannot reject in current status" });

    // Workflow: only the next pending signer can reject
    const next = await getNextPendingSigner(row.id);
    let allowed = false;
    if (next && next.user_id === req.user.id) allowed = true;
    if (!allowed && row.target_team_id) {
      const auth = await queryOne("SELECT 1 AS ok FROM signing_authority WHERE user_id = ? AND team_id = ?", [req.user.id, row.target_team_id]);
      if (auth) allowed = true;
    }
    if (!allowed && row.approver_id === req.user.id) allowed = true;
    if (!allowed) return res.status(403).json({ error: "No authority to reject" });

    const reason = req.body?.reason || "";
    await execute(
      "UPDATE requests SET status = 'rejected', approver_id = ?, rejected_at = ?, reject_reason = ?, applied_signature_path = NULL, signed_file_path = NULL WHERE id = ?",
      [req.user.id, Date.now(), reason, row.id]
    );
    // Mark current step rejected
    await execute("UPDATE request_steps SET status = 'rejected' WHERE request_id = ? AND status = 'active'", [row.id]);

    const requestor = await queryOne("SELECT * FROM users WHERE id = ?", [row.requestor_id]);
    sendEmail({
      to: requestor?.email, template: "rejected",
      ctx: { requestorName: requestor?.name, fileName: row.file_name, approverName: req.user.name, reason }
    }).catch(() => {});

    const updated = await queryOne("SELECT * FROM requests WHERE id = ?", [row.id]);
    res.json({ request: await hydrateRequest(updated) });
  } catch (e) { next(e); }
});

// ============================================================
//   withdraw (within window — only when not instant)
// ============================================================
router.post("/:id/withdraw", authRequired, requireRole("approver"), async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.status !== "approved_pending") return res.status(400).json({ error: "Not in withdraw window" });
    if (row.approver_id !== req.user.id) return res.status(403).json({ error: "Not your approval" });
    if (Date.now() - Number(row.approved_at) > APPROVAL_WINDOW_MS) return res.status(400).json({ error: "Withdraw window has expired" });

    await execute(
      "UPDATE requests SET status = 'rejected', rejected_at = ?, reject_reason = ?, applied_signature_path = NULL, signed_file_path = NULL WHERE id = ?",
      [Date.now(), "Withdrawn within 1h window", row.id]
    );

    const requestor = await queryOne("SELECT * FROM users WHERE id = ?", [row.requestor_id]);
    sendEmail({
      to: requestor?.email, template: "rejected",
      ctx: { requestorName: requestor?.name, fileName: row.file_name, approverName: req.user.name, reason: "Withdrawn within 1h window" }
    }).catch(() => {});

    const updated = await queryOne("SELECT * FROM requests WHERE id = ?", [row.id]);
    res.json({ request: await hydrateRequest(updated) });
  } catch (e) { next(e); }
});

// ============================================================
//   reminder
// ============================================================
router.post("/:id/reminder", authRequired, requireRole("requestor"), async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.requestor_id !== req.user.id) return res.status(403).json({ error: "Not your request" });
    if (row.status !== "pending") return res.status(400).json({ error: "Only pending requests can be reminded" });

    const last = await queryOne("SELECT sent_at FROM reminders WHERE request_id = ? ORDER BY sent_at DESC LIMIT 1", [row.id]);
    if (last && Date.now() - Number(last.sent_at) < REMINDER_COOLDOWN_MS) {
      const hrs = Math.ceil((REMINDER_COOLDOWN_MS - (Date.now() - Number(last.sent_at))) / 3600000);
      return res.status(429).json({ error: `Next reminder allowed in ${hrs} hour(s)` });
    }

    await execute("INSERT INTO reminders (request_id, sent_at) VALUES (?, ?)", [row.id, Date.now()]);

    // Workflow: notify next signer; legacy: all team approvers
    const next = await getNextPendingSigner(row.id);
    let count = 0;
    if (next) {
      const u = await queryOne("SELECT * FROM users WHERE id = ?", [next.user_id]);
      if (u) {
        sendEmail({ to: u.email, template: "reminder", ctx: { approverName: u.name, requestorName: req.user.name, fileName: row.file_name } }).catch(() => {});
        count = 1;
      }
    } else if (row.target_team_id) {
      const approvers = await query(`
        SELECT u.* FROM users u JOIN signing_authority sa ON sa.user_id = u.id
        WHERE u.role = 'approver' AND sa.team_id = ?
      `, [row.target_team_id]);
      for (const a of approvers) {
        sendEmail({ to: a.email, template: "reminder", ctx: { approverName: a.name, requestorName: req.user.name, fileName: row.file_name } }).catch(() => {});
      }
      count = approvers.length;
    }
    res.json({ ok: true, notified: count });
  } catch (e) { next(e); }
});

// ============================================================
//   admin force finalize
// ============================================================
router.post("/:id/force-finalize", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [req.params.id]);
    if (!row || row.status !== "approved_pending") return res.status(400).json({ error: "Not in pending-approval state" });
    await execute("UPDATE requests SET status = 'approved', finalized_at = ? WHERE id = ?", [Date.now(), row.id]);
    const requestor = await queryOne("SELECT * FROM users WHERE id = ?", [row.requestor_id]);
    const approver  = await queryOne("SELECT * FROM users WHERE id = ?", [row.approver_id]);
    sendEmail({
      to: requestor?.email, template: "approved",
      ctx: { requestorName: requestor?.name, fileName: row.file_name, approverName: approver?.name }
    }).catch(() => {});
    const updated = await queryOne("SELECT * FROM requests WHERE id = ?", [row.id]);
    res.json({ request: await hydrateRequest(updated) });
  } catch (e) { next(e); }
});

export default router;
