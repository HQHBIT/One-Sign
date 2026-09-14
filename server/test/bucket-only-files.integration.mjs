// Do signatures and voice notes still work when the only copy is in the bucket?
//
//   node test/bucket-only-files.integration.mjs      (from server/, MySQL running)
//
// Starts its own API on a spare port, pointed at an in-process fake S3, so it
// needs no bucket, no credentials and does not disturb a dev server on :5001.
//
// This is the precondition for moving files off the server's disk. Documents
// and signed copies already read through the filestore; signatures and voice
// notes built disk paths by hand, so a row pointing at the bucket — or a file
// that exists only there — could not be read, and stamping a document with such
// a signature failed. Every check below removes the disk copy first, so a pass
// cannot come from the disk quietly answering instead.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";
import { startFakeS3 } from "./support/fake-s3.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
const UPLOADS = path.join(SERVER, "uploads");
config({ path: path.join(SERVER, ".env") });

const s3 = await startFakeS3({ bucket: "bucket-only-test" });
const PORT = 5000 + 90 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;

// Storage env is set explicitly, overriding whatever .env holds, so this can
// never write to a real bucket.
const api = spawn(process.execPath, ["src/index.js"], {
  cwd: SERVER,
  env: {
    ...process.env,
    PORT: String(PORT),
    STORAGE_ENDPOINT: s3.endpoint,
    STORAGE_BUCKET: s3.bucket,
    STORAGE_REGION: "ap-south-1",
    STORAGE_ACCESS_KEY: "test",
    STORAGE_SECRET_KEY: "test",
    STORAGE_FORCE_PATH_STYLE: "true",
    SENDGRID_API_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let apiLog = "";
api.stdout.on("data", (d) => { apiLog += d; });
api.stderr.on("data", (d) => { apiLog += d; });

const { initDb, execute, query, queryOne } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
  if (i === 59) { console.log(apiLog); throw new Error("API did not start"); }
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });
const now = Date.now();
const T = now.toString(36);
const R = `u_bo_r_${T}`, A = `u_bo_a_${T}`, L = `u_bo_l_${T}`, TEAM = `t_bo_${T}`;

// Two distinct, valid PNGs, so "the right image came back" is a real check.
const PNG_A = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8//8/AzZgYsAB" +
  "RiwGABQeAgO9r1G0AAAAAElFTkSuQmCC", "base64");
const PNG_B = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const dataUrl = (b) => "data:image/png;base64," + b.toString("base64");
const onDisk = async (area, value) => {
  const name = String(value).replace(new RegExp(`^${area}/`), "");
  try { await fs.access(path.join(UPLOADS, area, name)); return true; } catch { return false; }
};
const dropDisk = (area, value) =>
  fs.unlink(path.join(UPLOADS, area, String(value).replace(new RegExp(`^${area}/`), ""))).catch(() => {});

const cleanup = async () => {
  const reqs = await query("SELECT id FROM requests WHERE requestor_id IN (?, ?)", [R, L]);
  for (const r of reqs) {
    await execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id WHERE st.request_id = ?", [r.id]);
    await execute("DELETE FROM request_steps WHERE request_id = ?", [r.id]);
    await execute("DELETE FROM requests WHERE id = ?", [r.id]);
  }
  await execute("DELETE FROM signing_authority WHERE team_id = ?", [TEAM]);
  await execute("DELETE FROM user_signatures WHERE user_id IN (?, ?, ?)", [R, A, L]);
  await execute("DELETE FROM users WHERE id IN (?, ?, ?)", [R, A, L]);
  await execute("DELETE FROM teams WHERE id = ?", [TEAM]);
};

try {
  const hash = bcrypt.hashSync("x", 4);
  await execute("INSERT INTO teams (id, name, created_at) VALUES (?, 'Bucket Only Team', ?)", [TEAM, now]);
  for (const [id, role] of [[R, "requestor"], [A, "approver"], [L, "requestor"]]) {
    await execute(
      "INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      [id, `${id}@bucket-only.test`, hash, `Bucket ${role} ${T}`, role, TEAM, now]);
  }
  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [A, TEAM]);

  // ---- a new signature goes to the bucket, and the row records where ----
  let r = await fetch(`${BASE}/api/users/me/signature`, {
    method: "PUT", headers: { ...auth(A), "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl: dataUrl(PNG_A) }),
  });
  ck(r.status === 200, `an approver saves a signature (${r.status})`);
  const a = await queryOne("SELECT signature_path FROM users WHERE id = ?", [A]);
  ck(a.signature_path === `signatures/${A}.png`, `the row records a bucket key (${a.signature_path})`);
  ck(s3.objects.has(`signatures/${A}.png`), "and the image is in the bucket");
  const def = await queryOne("SELECT file_path FROM user_signatures WHERE user_id = ? AND is_default = 1", [A]);
  ck(def?.file_path === a.signature_path, `the default signature row agrees (${def?.file_path})`);

  // ---- and it is read back from the bucket once the disk copy is gone ----
  await dropDisk("signatures", a.signature_path);
  ck(!(await onDisk("signatures", a.signature_path)), "(disk copy removed)");
  r = await fetch(`${BASE}/api/users/${A}/signature`, { headers: auth(A) });
  const img = Buffer.from(await r.arrayBuffer());
  ck(r.status === 200 && img.equals(PNG_A), `the owner's signature image is served from the bucket (${r.status}, ${img.length} bytes)`);
  ck(/image\/png/.test(r.headers.get("content-type") || ""), `as image/png (${r.headers.get("content-type")})`);

  // ---- a document is stamped with a signature that exists only in the bucket ----
  const pdf = await PDFDocument.create(); pdf.addPage([600, 800]);
  const pdfBytes = Buffer.from(await pdf.save());
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "bucket-only.pdf");
  fd.append("targetTeamId", TEAM);
  fd.append("marker", JSON.stringify([{ page: 1, x: 20, y: 40, w: 25, h: 8 }]));
  await fs.mkdir(path.join(UPLOADS, "signatures"), { recursive: true });
  // The requestor needs a signature to create a team request; a legacy one, on disk.
  await fs.writeFile(path.join(UPLOADS, "signatures", `${R}.png`), PNG_B);
  await execute("UPDATE users SET signature_path = ?, signature_aspect = 1 WHERE id = ?", [`${R}.png`, R]);
  r = await fetch(`${BASE}/api/requests`, { method: "POST", headers: auth(R), body: fd });
  const created = await r.json().catch(() => ({}));
  ck(r.status === 200 && created.request?.id, `a request is created (${r.status} ${created.error || ""})`);
  const reqId = created.request?.id;

  r = await fetch(`${BASE}/api/requests/${reqId}/approve`, {
    method: "POST", headers: { ...auth(A), "Content-Type": "application/json" },
    body: JSON.stringify({ instant: true }),
  });
  const approved = await r.json().catch(() => ({}));
  ck(r.status === 200, `approving stamps it with the bucket-only signature (${r.status} ${approved.error || ""})`);
  const row = await queryOne("SELECT status, signed_file_path, applied_signature_path FROM requests WHERE id = ?", [reqId]);
  ck(row?.status === "approved" && !!row.signed_file_path, `the request is approved with a signed copy (${row?.status})`);
  ck(row?.applied_signature_path === a.signature_path, `the applied signature is recorded as the key (${row?.applied_signature_path})`);

  // ---- a legacy signature, a bare filename on disk, still works unchanged ----
  r = await fetch(`${BASE}/api/users/${R}/signature`, { headers: auth(R) });
  const legacy = Buffer.from(await r.arrayBuffer());
  ck(r.status === 200 && legacy.equals(PNG_B), `a legacy on-disk signature is still served (${r.status})`);

  // ---- self-signing at creation, with a bucket-only signature ----
  r = await fetch(`${BASE}/api/users/me/signature`, {
    method: "PUT", headers: { ...auth(L), "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl: dataUrl(PNG_B) }),
  });
  const l = await queryOne("SELECT signature_path FROM users WHERE id = ?", [L]);
  await dropDisk("signatures", l.signature_path);
  const sfd = new FormData();
  sfd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "self.pdf");
  sfd.append("direct", "true");
  sfd.append("signers", JSON.stringify([{ userId: A, boxes: [{ page: 1, x: 20, y: 40, w: 25, h: 8 }] }]));
  sfd.append("selfMarks", JSON.stringify([{ type: "signature", page: 1, x: 20, y: 70, w: 25, h: 8 }]));
  r = await fetch(`${BASE}/api/requests`, { method: "POST", headers: auth(L), body: sfd });
  const selfCreated = await r.json().catch(() => ({}));
  ck(r.status === 200, `a requestor self-signs with a bucket-only signature (${r.status} ${selfCreated.error || ""})`);

  // ---- the person-to-person path: every signed signer is re-stamped from the bucket ----
  // This is the path that rebuilds the document from ALL signatures so far, so a
  // signer whose image exists only in the bucket must be readable here too.
  r = await fetch(`${BASE}/api/requests/${selfCreated.request?.id}/approve`, {
    method: "POST", headers: { ...auth(A), "Content-Type": "application/json" },
    body: JSON.stringify({ instant: true }),
  });
  const directSigned = await r.json().catch(() => ({}));
  ck(r.status === 200, `the named signer signs a direct request from the bucket (${r.status} ${directSigned.error || ""})`);
  const sg = await queryOne(
    `SELECT sg.status, sg.signature_path FROM request_step_signers sg
       JOIN request_steps st ON st.id = sg.step_id WHERE st.request_id = ?`, [selfCreated.request?.id]);
  ck(sg?.status === "signed" && sg.signature_path === a.signature_path,
    `recorded as signed with the key (${sg?.status}, ${sg?.signature_path})`);

  // ---- a named signature: stored, served, and removed from the bucket too ----
  r = await fetch(`${BASE}/api/users/me/signatures`, {
    method: "POST", headers: { ...auth(A), "Content-Type": "application/json" },
    body: JSON.stringify({ label: "Initials", dataUrl: dataUrl(PNG_B) }),
  });
  const added = await r.json().catch(() => ({}));
  ck(r.status === 200, `a second, named signature is added (${r.status} ${added.error || ""})`);
  const named = await queryOne("SELECT id, file_path FROM user_signatures WHERE user_id = ? AND label = 'Initials'", [A]);
  ck(/^signatures\//.test(named?.file_path || ""), `recorded as a key (${named?.file_path})`);
  await dropDisk("signatures", named.file_path);
  r = await fetch(`${BASE}/api/users/me/signatures/${named.id}/image`, { headers: auth(A) });
  const namedImg = Buffer.from(await r.arrayBuffer());
  ck(r.status === 200 && namedImg.equals(PNG_B), `and served from the bucket (${r.status})`);
  r = await fetch(`${BASE}/api/users/me/signatures/${named.id}`, { method: "DELETE", headers: auth(A) });
  ck(r.status === 200, `deleting it succeeds (${r.status})`);
  ck(!s3.objects.has(named.file_path), "and its image leaves the bucket");

  // ---- a rejection voice note: stored in the bucket and played back from it ----
  const vfd = new FormData();
  vfd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "voice.pdf");
  vfd.append("targetTeamId", TEAM);
  vfd.append("marker", JSON.stringify([{ page: 1, x: 20, y: 40, w: 25, h: 8 }]));
  r = await fetch(`${BASE}/api/requests`, { method: "POST", headers: auth(R), body: vfd });
  const vreq = (await r.json().catch(() => ({}))).request?.id;
  const VOICE = Buffer.from("fake-webm-voice-note-" + T);
  const rfd = new FormData();
  rfd.append("reason", "see voice note");
  rfd.append("voice", new Blob([VOICE], { type: "audio/webm" }), "note.webm");
  r = await fetch(`${BASE}/api/requests/${vreq}/reject`, { method: "POST", headers: auth(A), body: rfd });
  ck(r.status === 200, `a rejection with a voice note is saved (${r.status})`);
  const vrow = await queryOne("SELECT reject_voice_path FROM requests WHERE id = ?", [vreq]);
  ck(vrow?.reject_voice_path === `voicenotes/${vreq}.webm`, `recorded as a key (${vrow?.reject_voice_path})`);
  await dropDisk("voicenotes", vrow.reject_voice_path);
  r = await fetch(`${BASE}/api/requests/${vreq}/reject-voice`, { headers: auth(R) });
  const played = Buffer.from(await r.arrayBuffer());
  ck(r.status === 200 && played.equals(VOICE), `the requestor plays it back from the bucket (${r.status})`);
  ck(/audio\/webm/.test(r.headers.get("content-type") || ""), `as audio/webm (${r.headers.get("content-type")})`);

  // Safari on iPhone plays audio only from a server that honours Range.
  r = await fetch(`${BASE}/api/requests/${vreq}/reject-voice`, { headers: { ...auth(R), Range: "bytes=5-9" } });
  const part = Buffer.from(await r.arrayBuffer());
  ck(r.status === 206 && part.equals(VOICE.subarray(5, 10)), `a byte range is answered with 206 and those bytes (${r.status}, "${part}")`);
  ck(r.headers.get("content-range") === `bytes 5-9/${VOICE.length}`, `with a Content-Range (${r.headers.get("content-range")})`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch((e) => console.log("cleanup:", e.message));
  api.kill();
  await s3.close();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length) console.log(apiLog.split("\n").filter((l) => /error|warn|\[filestore\]/i.test(l)).slice(-20).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
