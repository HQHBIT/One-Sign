// What's new: which feature videos a user has been shown.
//
//   node test/whats-new.integration.mjs      (from server/, MySQL running)
//
// Verifies: sign-in is required; a new user has seen nothing and gets their
// join date; marking a feature seen sticks and is idempotent; ids are
// validated; one user's views never show up for another; it works on both
// organisations' boxes. Spawns its own APIs on spare ports.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 190 + Math.floor(Math.random() * 4);
const BASE = `http://127.0.0.1:${PORT}`;
const WAQF_BASE = `http://127.0.0.1:${PORT + 5}`;
const { initDb, execute } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

function startApi(port, env) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: SERVER, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), SENDGRID_API_KEY: "", STORAGE_BUCKET: "", ...env },
  });
  child.log = ""; child.stdout.on("data", d => (child.log += d)); child.stderr.on("data", d => (child.log += d));
  return child;
}
async function waitFor(base, child) {
  for (let i = 0; i < 180; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 500)); }
  console.log(child.log); throw new Error("API did not start on " + base);
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36), JOINED = Date.parse("2026-09-01T10:00:00+05:30");
const U1 = `u_wn1_${T}`, U2 = `u_wn2_${T}`;
const hdr = (id) => ({ Authorization: "Bearer " + signToken(id), "Content-Type": "application/json" });
const j = async r => { try { return await r.json(); } catch { return {}; } };
const get = (base, id) => fetch(`${base}/api/whats-new`, { headers: hdr(id) });
const mark = (base, id, fid) => fetch(`${base}/api/whats-new/seen`, { method: "POST", headers: hdr(id), body: JSON.stringify({ id: fid }) });

const cleanup = async () => {
  await execute("DELETE FROM feature_views WHERE user_id IN (?, ?)", [U1, U2]).catch(() => {});
  await execute("DELETE FROM users WHERE id IN (?, ?)", [U1, U2]).catch(() => {});
};

let hqhb = null, waqf = null;
try {
  await cleanup();
  for (const u of [U1, U2]) await execute(
    "INSERT INTO users (id, email, password_hash, name, role, created_at, active, org_id) VALUES (?,?,?,?, 'requestor', ?, 1, 'hqhb')",
    [u, `${u}@wn.test`, bcrypt.hashSync("x", 4), "WN " + u, JOINED]);

  hqhb = startApi(PORT, { ORG_SLUG: "hqhb" }); await waitFor(BASE, hqhb);
  waqf = startApi(PORT + 5, { ORG_SLUG: "waqf" }); await waitFor(WAQF_BASE, waqf);

  ck((await fetch(`${BASE}/api/whats-new`)).status === 401, "sign-in required to read");
  ck((await fetch(`${BASE}/api/whats-new/seen`, { method: "POST" })).status === 401, "sign-in required to mark");

  let b = await j(await get(BASE, U1));
  ck(Array.isArray(b.seen) && b.seen.length === 0 && b.joinedAt === JOINED, `a user who has seen nothing, with their join date (${JSON.stringify(b)})`);

  ck((await mark(BASE, U1, "recommend-changes")).status === 200, "mark a feature seen");
  ck((await mark(BASE, U1, "recommend-changes")).status === 200, "marking it again is harmless");
  b = await j(await get(BASE, U1));
  ck(JSON.stringify(b.seen) === JSON.stringify(["recommend-changes"]), `it is remembered once (${JSON.stringify(b.seen)})`);

  for (const bad of ["", "Recommend Changes", "../etc", "x".repeat(70), "a b"]) {
    ck((await mark(BASE, U1, bad)).status === 400, `a malformed id is refused (${JSON.stringify(bad.slice(0, 12))})`);
  }

  b = await j(await get(BASE, U2));
  ck(b.seen?.length === 0, "another user's views are not shared");

  ck((await mark(WAQF_BASE, U2, "drag-drop-upload")).status === 200
    && (await j(await get(WAQF_BASE, U2))).seen?.includes("drag-drop-upload"), "works on the WAQF box too");
  ck((await fetch(`${WAQF_BASE}/api/requests`, { headers: hdr(U2) })).status === 200, "the rest of the API is untouched");
} catch (e) {
  fail.push(`the run stopped early: ${e?.message || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch(() => {});
  if (hqhb) hqhb.kill(); if (waqf) waqf.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  process.exit(fail.length ? 1 : 0);
}
