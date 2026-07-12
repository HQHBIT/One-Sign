// Run against a RUNNING server (default :5001) + MySQL.
// Usage: node server/test/withdraw.integration.mjs
//
// Covers the requestor-withdraw feature: a requestor can withdraw their OWN
// request while it is still pending; once accepted/rejected they cannot; a
// non-owner never can; and a withdrawn request is no longer approvable.
import { config } from "dotenv";
config({ path: "server/.env" });
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { PDFDocument } from "pdf-lib";

const BASE = process.env.API_BASE || "http://localhost:5001";
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TS = Date.now();
const TARGET_ID = "u_wdtgt_" + TS.toString(36);
const TARGET_EMAIL = "withdraw.target." + TS + "@hqhb.in";

let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
const j = async r => ({ status: r.status, body: await r.json().catch(() => ({})) });
const tokenFor = id => jwt.sign({ sub: id }, SECRET, { expiresIn: "1h" });

const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

// A seeded requestor (the owner/sender) + a fresh recipient (non-owner).
const [[sender]] = [await conn.execute("SELECT id FROM users WHERE role='requestor' ORDER BY created_at ASC LIMIT 1")].map(x => x[0]);
await conn.execute(
  "INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', 'Withdraw Target', 'requestor', ?)",
  [TARGET_ID, TARGET_EMAIL, TS]
);
const senderTok = tokenFor(sender.id);
const targetTok = tokenFor(TARGET_ID);

// Helper: create a direct request from sender -> target, return its id + workflow.
async function createReq(label) {
  const pdf = await PDFDocument.create(); pdf.addPage([600, 800]);
  const pdfBytes = await pdf.save();
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), `${label}.pdf`);
  fd.append("direct", "true");
  fd.append("signers", JSON.stringify([{ userId: TARGET_ID, page: 1, x: 20, y: 70, w: 25, h: 8 }]));
  fd.append("requestType", "general");
  const create = await j(await fetch(`${BASE}/api/requests`, { method: "POST", headers: { Authorization: `Bearer ${senderTok}` }, body: fd }));
  return create;
}

// ── Request A: happy path + guards ─────────────────────────────────────────
const createA = await createReq("withdraw-A");
const idA = createA.body?.request?.id;
check("create request A -> ok + pending", createA.status === 200 && !!idA && createA.body.request.status === "pending");

// A non-owner cannot withdraw someone else's pending request.
const foreign = await j(await fetch(`${BASE}/api/requests/${idA}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${targetTok}` } }));
check("non-owner withdraw -> 403", foreign.status === 403);

// Still pending after the rejected attempt.
const [[stillA]] = [await conn.execute("SELECT status FROM requests WHERE id=?", [idA])].map(x => x[0]);
check("request A untouched by foreign attempt (still pending)", stillA.status === "pending");

// The owner withdraws their own pending request.
const wd = await j(await fetch(`${BASE}/api/requests/${idA}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${senderTok}` } }));
check("owner withdraw -> 200 + status 'withdrawn'", wd.status === 200 && wd.body?.request?.status === "withdrawn");

// withdrawn_at timestamp recorded.
const [[rowA]] = [await conn.execute("SELECT status, withdrawn_at FROM requests WHERE id=?", [idA])].map(x => x[0]);
check("withdrawn_at timestamp set", rowA.status === "withdrawn" && Number(rowA.withdrawn_at) > 0);

// No step/signer is left in an actionable (pending/active) state.
const [[stepCount]] = [await conn.execute(
  "SELECT COUNT(*) AS n FROM request_steps WHERE request_id=? AND status IN ('pending','active')", [idA]
)].map(x => x[0]);
const [[sigCount]] = [await conn.execute(
  "SELECT COUNT(*) AS n FROM request_step_signers sg JOIN request_steps st ON st.id=sg.step_id WHERE st.request_id=? AND sg.status='pending'", [idA]
)].map(x => x[0]);
check("no lingering actionable steps/signers", Number(stepCount.n) === 0 && Number(sigCount.n) === 0);

// Cannot withdraw twice.
const wd2 = await j(await fetch(`${BASE}/api/requests/${idA}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${senderTok}` } }));
check("second withdraw -> 400", wd2.status === 400);

// A withdrawn request is no longer approvable (approve gate returns 400 'Not pending').
const appr = await j(await fetch(`${BASE}/api/requests/${idA}/approve`, { method: "POST", headers: { Authorization: `Bearer ${targetTok}` } }));
check("approve of withdrawn -> 400 'Not pending'", appr.status === 400 && /not pending/i.test(appr.body.error || ""));

// ── Request B: cannot withdraw AFTER a decision ────────────────────────────
const createB = await createReq("withdraw-B");
const idB = createB.body?.request?.id;
check("create request B -> ok", createB.status === 200 && !!idB);

// Simulate an approver having already accepted it.
await conn.execute("UPDATE requests SET status='approved' WHERE id=?", [idB]);
const wdB = await j(await fetch(`${BASE}/api/requests/${idB}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${senderTok}` } }));
check("withdraw after acceptance -> 400 (locked)", wdB.status === 400 && /pending/i.test(wdB.body.error || ""));

// cleanup
for (const id of [idA, idB].filter(Boolean)) {
  await conn.execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id=sg.step_id WHERE st.request_id=?", [id]);
  await conn.execute("DELETE FROM request_steps WHERE request_id=?", [id]);
  await conn.execute("DELETE FROM requests WHERE id=?", [id]);
}
await conn.execute("DELETE FROM users WHERE id=?", [TARGET_ID]);
await conn.end();

console.log(fail ? `\n${fail} check(s) failed` : "\nAll withdraw checks passed");
process.exitCode = fail ? 1 : 0;
