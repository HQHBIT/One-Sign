// Run against a RUNNING server (default :5001) + MySQL.
// Usage: node server/test/self-sign.integration.mjs
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
const UID = "u_selfsign_" + TS.toString(36);
const EMAIL = "selfsign.test." + TS + "@hqhb.in";

let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
const j = async r => ({ status: r.status, body: await r.json().catch(() => ({})) });

const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

// demo requestor WITH a signature on disk
const SIG_DIR = path.resolve("server/uploads/signatures");
fs.mkdirSync(SIG_DIR, { recursive: true });
fs.writeFileSync(path.join(SIG_DIR, UID + ".png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"));
await conn.execute(
  "INSERT INTO users (id, email, password_hash, name, role, created_at, signature_path, signature_aspect) VALUES (?, ?, ?, 'Self Sign Test', 'requestor', ?, ?, 1)",
  [UID, EMAIL, bcrypt.hashSync("x", 10), TS, UID + ".png"]
);
const [[target]] = [await conn.execute("SELECT id FROM users WHERE id <> ? ORDER BY created_at ASC LIMIT 1", [UID])].map(x => x[0]);
const tok = jwt.sign({ sub: UID }, SECRET, { expiresIn: "1h" });

// a minimal 1-page PDF
const pdf = await PDFDocument.create(); pdf.addPage([600, 800]);
const pdfBytes = Buffer.from(await pdf.save());

// create a direct request WITH self-marks (1 signature + 1 date)
const fd = new FormData();
fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "selfsign.pdf");
fd.append("direct", "true");
fd.append("signers", JSON.stringify([{ userId: target.id, page: 1, x: 20, y: 40, w: 25, h: 8 }]));
fd.append("selfMarks", JSON.stringify([
  { type: "signature", page: 1, x: 20, y: 70, w: 25, h: 8 },
  { type: "date", page: 1, x: 50, y: 70, w: 20, h: 5 }
]));
const res = await j(await fetch(`${BASE}/api/requests`, { method: "POST", headers: { Authorization: `Bearer ${tok}` }, body: fd }));
const reqId = res.body?.request?.id;
check("create with selfMarks -> 200", res.status === 200 && !!reqId);

// the stored document should be a valid PDF, stamped (larger than the plain input)
let stored = null;
if (reqId) {
  const storedPath = path.resolve("server/uploads/documents", reqId + ".pdf");
  stored = fs.existsSync(storedPath) ? fs.readFileSync(storedPath) : null;
}
check("stored document exists + valid PDF", !!stored && (await PDFDocument.load(stored)).getPageCount() === 1);
check("stored document is stamped (bigger than plain input)", !!stored && stored.length > pdfBytes.length + 100);

// cleanup
if (reqId) {
  await conn.execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id=sg.step_id WHERE st.request_id=?", [reqId]);
  await conn.execute("DELETE FROM request_steps WHERE request_id=?", [reqId]);
  await conn.execute("DELETE FROM requests WHERE id=?", [reqId]);
  try { fs.unlinkSync(path.resolve("server/uploads/documents", reqId + ".pdf")); } catch {}
}
await conn.execute("DELETE FROM users WHERE id=?", [UID]);
try { fs.unlinkSync(path.join(SIG_DIR, UID + ".png")); } catch {}
await conn.end();

console.log(fail ? `\n${fail} check(s) failed` : "\nAll self-sign checks passed");
process.exitCode = fail ? 1 : 0;
