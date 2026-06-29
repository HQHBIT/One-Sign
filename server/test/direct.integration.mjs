// Run against a RUNNING server (default :5001) + MySQL.
// Usage: node server/test/direct.integration.mjs
import { config } from "dotenv";
config({ path: "server/.env" });
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { PDFDocument } from "pdf-lib";

const BASE = process.env.API_BASE || "http://localhost:5001";
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TS = Date.now();
const TARGET_ID = "u_directtgt_" + TS.toString(36);
const TARGET_EMAIL = "direct.target." + TS + "@hqhb.in";

let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
const j = async r => ({ status: r.status, body: await r.json().catch(() => ({})) });
const tokenFor = id => jwt.sign({ sub: id }, SECRET, { expiresIn: "1h" });

const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

// A requestor sender (seeded) + a fresh requestor recipient with NO signature.
const [[sender]] = [await conn.execute("SELECT id FROM users WHERE role='requestor' ORDER BY created_at ASC LIMIT 1")].map(x => x[0]);
await conn.execute(
  "INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', 'Direct Target', 'requestor', ?)",
  [TARGET_ID, TARGET_EMAIL, TS]
);
const senderTok = tokenFor(sender.id);
const targetTok = tokenFor(TARGET_ID);

// 1) search finds the new user
const search = await j(await fetch(`${BASE}/api/users/search?q=direct.target`, { headers: { Authorization: `Bearer ${senderTok}` } }));
const found = (search.body.users || []).some(u => u.id === TARGET_ID);
check("search finds the recipient", search.status === 200 && found);

// 2) create a direct request (minimal 1-page PDF) to the target
const pdf = await PDFDocument.create(); pdf.addPage([600, 800]);
const pdfBytes = await pdf.save();
const fd = new FormData();
fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "direct-test.pdf");
fd.append("direct", "true");
fd.append("signers", JSON.stringify([{ userId: TARGET_ID, page: 1, x: 20, y: 70, w: 25, h: 8 }]));
fd.append("requestType", "general");
const create = await j(await fetch(`${BASE}/api/requests`, { method: "POST", headers: { Authorization: `Bearer ${senderTok}` }, body: fd }));
const reqId = create.body?.request?.id;
const wf = create.body?.request?.workflow || [];
check("create direct -> ok with one team-less step+signer",
  create.status === 200 && !!reqId && wf.length === 1 && wf[0].teamId == null
  && wf[0].signers?.length === 1 && wf[0].signers[0].userId === TARGET_ID);

// 3) the target sees it in their list; an unrelated approver does not
const targetList = await j(await fetch(`${BASE}/api/requests`, { headers: { Authorization: `Bearer ${targetTok}` } }));
check("recipient sees the request", (targetList.body.requests || []).some(r => r.id === reqId));

const [[approver]] = [await conn.execute("SELECT id FROM users WHERE role='approver' ORDER BY created_at ASC LIMIT 1")].map(x => x[0]);
if (approver) {
  const approverList = await j(await fetch(`${BASE}/api/requests`, { headers: { Authorization: `Bearer ${tokenFor(approver.id)}` } }));
  check("unrelated approver does NOT see it", !(approverList.body.requests || []).some(r => r.id === reqId));
}

// 4) the recipient (a requestor, no signature) reaches the sign logic -> 400 "signature",
//    NOT 403 Forbidden. This proves the approver-only gate was relaxed.
const tryApprove = await j(await fetch(`${BASE}/api/requests/${reqId}/approve`, { method: "POST", headers: { Authorization: `Bearer ${targetTok}` } }));
check("recipient reaches sign logic (400 signature, not 403)",
  tryApprove.status === 400 && /signature/i.test(tryApprove.body.error || ""));

// cleanup
if (reqId) {
  await conn.execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id=sg.step_id WHERE st.request_id=?", [reqId]);
  await conn.execute("DELETE FROM request_steps WHERE request_id=?", [reqId]);
  await conn.execute("DELETE FROM requests WHERE id=?", [reqId]);
}
await conn.execute("DELETE FROM users WHERE id=?", [TARGET_ID]);
await conn.end();

console.log(fail ? `\n${fail} check(s) failed` : "\nAll direct-request checks passed");
process.exitCode = fail ? 1 : 0;
