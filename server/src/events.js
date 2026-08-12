// ============================================================
//   Live updates (SSE) — "something changed for you, re-fetch".
//   ------------------------------------------------------------
//   The client keeps one EventSource open; whenever a request or notification
//   touches a user, the server sends a tiny `changed` event and the client
//   re-runs its normal refresh. No payloads, no state reconciliation, no
//   missed-event risk: the stream is a doorbell, the existing REST endpoints
//   remain the single source of truth.
//
//   Auth: EventSource cannot send an Authorization header, and putting the
//   long-lived session JWT in a URL would write it into nginx access logs. So
//   the client first POSTs /api/events/ticket (Bearer) for a short-lived,
//   single-purpose ticket and opens the stream with that instead.
// ============================================================
import { Router } from "express";
import { authRequired, signActionToken, verifyActionToken } from "./auth.js";

const router = Router();

// userId -> Set<res> of open streams; admins also live in a role set so
// org-wide activity can nudge their dashboards.
const byUser = new Map();
const adminStreams = new Set();

function write(res, line) {
  try { res.write(line); } catch { /* dead socket — cleanup happens on close */ }
}

/** Nudge every open session of one user. */
export function pingUser(userId) {
  const set = byUser.get(String(userId));
  if (!set) return;
  for (const res of set) write(res, "data: changed\n\n");
}

/** Nudge every signed-in admin (their dashboards show org-wide activity). */
export function pingAdmins() {
  for (const res of adminStreams) write(res, "data: changed\n\n");
}

router.post("/ticket", authRequired, (req, res) => {
  // 5 minutes: enough to open (and re-open) the stream, worthless in a log.
  res.json({ ticket: signActionToken("sse", { uid: req.user.id, role: req.user.role }, "5m") });
});

router.get("/", (req, res) => {
  let claims;
  try { claims = verifyActionToken("sse", String(req.query.ticket || "")); }
  catch { return res.status(401).json({ error: "Invalid or expired ticket" }); }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    // nginx buffers proxied responses by default, which would hold events
    // hostage indefinitely — this response header switches buffering off
    // per-stream without touching the nginx config.
    "X-Accel-Buffering": "no",
  });
  write(res, "retry: 5000\n\n");
  write(res, "data: hello\n\n");

  const uid = String(claims.uid);
  if (!byUser.has(uid)) byUser.set(uid, new Set());
  byUser.get(uid).add(res);
  if (claims.role === "admin") adminStreams.add(res);

  // Keep intermediaries from idling the connection out. Comment lines are
  // invisible to EventSource.onmessage.
  const heartbeat = setInterval(() => write(res, ": hb\n\n"), 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    byUser.get(uid)?.delete(res);
    if (byUser.get(uid)?.size === 0) byUser.delete(uid);
    adminStreams.delete(res);
  });
});

export default router;
