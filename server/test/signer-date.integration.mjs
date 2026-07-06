// Run against a RUNNING server (default :5001) + MySQL.
// Usage: node server/test/signer-date.integration.mjs
// Verifies: a date field placed for the SIGNATORY is stored on create, and fills
// (stamps) when that signer approves.
import { config } from "dotenv";
config({ path: "server/.env" });
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.API_BASE || "http://localhost:5001";
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TS = Date.now();
const RID = "u_sdreq_" + TS.toString(36);
const SID = "u_sdsign_" + TS.toString(36);

let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
const j = async r => ({ status: r.status, body: await r.json().catch(() => ({})) });

const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

const SIG_DIR = path.resolve("server/uploads/signatures");
fs.mkdirSync(SIG_DIR, { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
fs.writeFileSync(path.join(SIG_DIR, RID + ".png"), PNG);
fs.writeFileSync(path.join(SIG_DIR, SID + ".png"), PNG);

await conn.execute("INSERT INTO users (id,email,password_hash,name,role,created_at,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,?,1)",
  [RID, "sdreq." + TS + "@hqhb.in", bcrypt.hashSync("x", 10), "SD Requestor", "requestor", TS, RID + ".png"]);
await conn.execute("INSERT INTO users (id,email,password_hash,name,role,created_at,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,?,1)",
  [SID, "sdsign." + TS + "@hqhb.in", bcrypt.hashSync("x", 10), "SD Signer", "approver", TS, SID + ".png"]);

const reqTok = jwt.sign({ sub: RID }, SECRET, { expiresIn: "1h" });
const signTok = jwt.sign({ sub: SID }, SECRET, { expiresIn: "1h" });

const pdf = await PDFDocument.create(); pdf.addPage([600, 800]);
const pdfBytes = Buffer.from(await pdf.save());

// direct request: signer's box + a date field for the signer
const fd = new FormData();
fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "sd.pdf");
fd.append("direct", "true");
fd.append("signers", JSON.stringify([{ userId: SID, page: 1, x: 20, y: 30, w: 25, h: 8, dateFields: [{ page: 1, x: 20, y: 50, w: 20, h: 5 }] }]));
const res = await j(await fetch(`${BASE}/api/requests`, { method: "POST", headers: { Authorization: `Bearer ${reqTok}` }, body: fd }));
const reqId = res.body?.request?.id;
check("create direct with signer date field -> 200", res.status === 200 && !!reqId);

// date field stored on the signer row
let dfStored = false;
if (reqId) {
  const [[sgRow]] = [await conn.execute("SELECT sg.date_fields_json AS d FROM request_step_signers sg JOIN request_steps st ON st.id=sg.step_id WHERE st.request_id=?", [reqId])].map(x => x[0]);
  try { const a = JSON.parse(sgRow?.d || "[]"); dfStored = Array.isArray(a) && a.length === 1; } catch {}
}
check("signer date field stored on create", dfStored);

// signer approves -> signature + date stamping runs
const appr = await j(await fetch(`${BASE}/api/requests/${reqId}/approve`, { method: "POST", headers: { Authorization: `Bearer ${signTok}` } }));
check("signer approve -> 200", appr.status === 200);

const signedPath = path.resolve("server/uploads/signed", reqId + ".signed.pdf");
const signed = (reqId && fs.existsSync(signedPath)) ? fs.readFileSync(signedPath) : null;
check("signed doc exists + valid PDF", !!signed && (await PDFDocument.load(signed)).getPageCount() === 1);
check("signed doc is stamped (bigger than plain input)", !!signed && signed.length > pdfBytes.length + 100);

// cleanup
if (reqId) {
  await conn.execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id=sg.step_id WHERE st.request_id=?", [reqId]);
  await conn.execute("DELETE FROM request_steps WHERE request_id=?", [reqId]);
  await conn.execute("DELETE FROM requests WHERE id=?", [reqId]);
  try { fs.unlinkSync(path.resolve("server/uploads/documents", reqId + ".pdf")); } catch {}
  try { fs.unlinkSync(signedPath); } catch {}
}
await conn.execute("DELETE FROM users WHERE id IN (?,?)", [RID, SID]);
try { fs.unlinkSync(path.join(SIG_DIR, RID + ".png")); } catch {}
try { fs.unlinkSync(path.join(SIG_DIR, SID + ".png")); } catch {}
await conn.end();

console.log(fail ? `\n${fail} check(s) failed` : "\nAll signer-date checks passed");
process.exitCode = fail ? 1 : 0;
