// Approve-from-email. The "Approve" button in the new-request email carries a
// signed, single-purpose token (request id + approver id, 7-day expiry). The
// link opens a lightweight confirm screen in the app which calls these
// endpoints — the token IS the authentication, so the approver doesn't need to
// be signed in. A deliberate one-tap confirm stands between the email and the
// approval: mail scanners prefetch links, and a GET that signs documents would
// let a bot approve them.
import { Router } from "express";
import { queryOne, hydrateUser } from "../db.js";
import { verifyActionToken, isSigner } from "../auth.js";
import { approveRequestHandler } from "./requests.js";

const router = Router();

async function resolveToken(token) {
  const claims = verifyActionToken("email-approve", token); // throws if bad/expired
  const request = await queryOne("SELECT * FROM requests WHERE id = ?", [claims.req]);
  if (!request) throw Object.assign(new Error("This request no longer exists."), { code: 410 });
  const approver = await queryOne("SELECT * FROM users WHERE id = ?", [claims.uid]);
  if (!approver || (approver.active != null && Number(approver.active) === 0) || !isSigner(approver.role)) {
    throw Object.assign(new Error("This approval link isn't valid for your account any more."), { code: 403 });
  }
  return { request, approver };
}

// What the confirm screen shows before the user commits.
router.post("/preview", async (req, res) => {
  try {
    const { request, approver } = await resolveToken(req.body?.token);
    const requestor = request.requestor_id ? await queryOne("SELECT name FROM users WHERE id = ?", [request.requestor_id]) : null;
    res.json({
      fileName: request.file_name,
      requestorName: requestor?.name || "—",
      approverName: approver.name,
      status: request.status,
      alreadyDone: request.status !== "pending",
    });
  } catch (e) {
    res.status(e.code || 400).json({ error: e.message || "This approval link is invalid or has expired." });
  }
});

// Perform the approval — identical signing path to an in-app approval.
router.post("/", async (req, res, next) => {
  try {
    const { request, approver } = await resolveToken(req.body?.token);
    if (request.status !== "pending") return res.status(400).json({ error: "This document is no longer pending — it may already be handled." });

    const pseudoReq = {
      user: await hydrateUser(approver),
      userRow: approver,
      params: { id: request.id },
      body: {},
      headers: req.headers,
    };
    await approveRequestHandler(pseudoReq, res, next);
  } catch (e) {
    res.status(e.code || 400).json({ error: e.message || "This approval link is invalid or has expired." });
  }
});

export default router;
