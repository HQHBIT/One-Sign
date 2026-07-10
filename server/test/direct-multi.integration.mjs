// Direct request to MULTIPLE specific people — all sign (one team-less step, N signers).
// Run against a RUNNING server (:5001) + MySQL, from repo root:
//   node server/test/direct-multi.integration.mjs
import { config } from "dotenv";
config({ path: "server/.env" });
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { PDFDocument } from "pdf-lib";

const BASE = process.env.API_BASE || "http://localhost:5001";
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TS = Date.now();
let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
const j = async r => ({ status: r.status, body: await r.json().catch(() => ({})) });
const tokenFor = id => jwt.sign({ sub: id }, SECRET, { expiresIn: "1h" });

const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const [[sender]] = [await conn.execute("SELECT id FROM users WHERE role='requestor' ORDER BY created_at ASC LIMIT 1")].map(x => x[0]);
const A = "u_dm_a_" + TS.toString(36), B = "u_dm_b_" + TS.toString(36);
await conn.execute("INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,?,?,?,?)", [A, "dm.a." + TS + "@hqhb.in", "x", "Signer A", "requestor", TS]);
await conn.execute("INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,?,?,?,?)", [B, "dm.b." + TS + "@hqhb.in", "x", "Signer B", "requestor", TS]);
const senderTok = tokenFor(sender.id);

// create a direct request naming BOTH people, each with their own box (A also gets a date field)
const pdf = await PDFDocument.create(); pdf.addPage([600, 800]);
const bytes = await pdf.save();
const fd = new FormData();
fd.append("file", new Blob([bytes], { type: "application/pdf" }), "dm.pdf");
fd.append("direct", "true");
fd.append("signers", JSON.stringify([
  { userId: A, page: 1, x: 15, y: 70, w: 25, h: 8, dateFields: [{ page: 1, x: 15, y: 60, w: 15, h: 5 }] },
  { userId: B, page: 1, x: 55, y: 70, w: 25, h: 8 },
]));
fd.append("requestType", "general");
const create = await j(await fetch(`${BASE}/api/requests`, { method: "POST", headers: { Authorization: `Bearer ${senderTok}` }, body: fd }));
const reqId = create.body?.request?.id;
const wf = create.body?.request?.workflow || [];

check("create direct with 2 signers -> ok", create.status === 200 && !!reqId);
check("ONE team-less step containing BOTH signers", wf.length === 1 && wf[0].teamId == null && wf[0].signers?.length === 2);
const ids = (wf[0]?.signers || []).map(s => s.userId).sort();
check("both recipients are on that step", JSON.stringify(ids) === JSON.stringify([A, B].sort()));
check("both signers start pending (nobody has signed)", (wf[0]?.signers || []).every(s => s.status === "pending"));
check("request is not finalised while signers are pending", create.body?.request?.status !== "approved");

const aList = await j(await fetch(`${BASE}/api/requests`, { headers: { Authorization: `Bearer ${tokenFor(A)}` } }));
const bList = await j(await fetch(`${BASE}/api/requests`, { headers: { Authorization: `Bearer ${tokenFor(B)}` } }));
check("recipient A sees the request", (aList.body.requests || []).some(r => r.id === reqId));
check("recipient B sees the request", (bList.body.requests || []).some(r => r.id === reqId));

const [[cnt]] = [await conn.execute("SELECT COUNT(*) n FROM request_step_signers sg JOIN request_steps st ON st.id=sg.step_id WHERE st.request_id=?", [reqId])].map(x => x[0]);
check("DB persisted 2 signer rows", Number(cnt.n) === 2);
const [[da]] = [await conn.execute("SELECT date_fields_json FROM request_step_signers sg JOIN request_steps st ON st.id=sg.step_id WHERE st.request_id=? AND sg.user_id=?", [reqId, A])].map(x => x[0]);
let daLen = 0; try { daLen = JSON.parse(da?.date_fields_json || "[]").length; } catch {}
check("signer A's date field persisted", daLen === 1);

// cleanup
if (reqId) {
  await conn.execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id=sg.step_id WHERE st.request_id=?", [reqId]);
  await conn.execute("DELETE FROM request_steps WHERE request_id=?", [reqId]);
  await conn.execute("DELETE FROM requests WHERE id=?", [reqId]);
}
await conn.execute("DELETE FROM users WHERE id IN (?,?)", [A, B]);
await conn.end();
console.log(fail ? `\n${fail} check(s) failed` : "\nAll direct-multi checks passed");
process.exitCode = fail ? 1 : 0;
