// Can a person file their finished documents into folders of their own — and
// only their own?
//
//   node test/folders.integration.mjs          (from server/, MySQL running)
//
// Starts its own API on a spare port with email and storage off. Requests are
// inserted directly: what is under test is filing, not the request lifecycle.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 80 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;

// Migrations first, from here, so the API is not running the same DDL at the
// same moment — two processes migrating at once wait on each other's locks.
const { initDb, query, execute, queryOne } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
const { mergeUsers } = await import("../src/routes/users.js");
await initDb();

const api = spawn(process.execPath, ["src/index.js"], {
  cwd: SERVER,
  env: { ...process.env, PORT: String(PORT), SENDGRID_API_KEY: "", STORAGE_BUCKET: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
api.stdout.on("data", (d) => { log += d; });
api.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
  if (i === 59) { console.log(log); throw new Error("API did not start"); }
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36);
const U = `u_fld_req_${T}`, A = `u_fld_app_${T}`, O = `u_fld_other_${T}`, TEAM = `t_fld_${T}`;
const REQ1 = `req_fld1_${T}`, REQ2 = `req_fld2_${T}`, REQ_HIDDEN = `req_fldh_${T}`;
const json = (id) => ({ Authorization: "Bearer " + signToken(id), "Content-Type": "application/json" });
const call = (id, method, url, body) =>
  fetch(`${BASE}${url}`, { method, headers: json(id), body: body === undefined ? undefined : JSON.stringify(body) });
const folders = async (id) => (await call(id, "GET", "/api/folders")).json();

const cleanup = async () => {
  await execute("DELETE FROM folder_items WHERE user_id IN (?, ?, ?)", [U, A, O]);
  await execute("DELETE FROM folders WHERE user_id IN (?, ?, ?)", [U, A, O]);
  await execute("DELETE FROM requests WHERE id IN (?, ?, ?)", [REQ1, REQ2, REQ_HIDDEN]);
  await execute("DELETE FROM users WHERE id IN (?, ?, ?)", [U, A, O]);
  await execute("DELETE FROM teams WHERE id = ?", [TEAM]);
};

try {
  const hash = bcrypt.hashSync("x", 4);
  await execute("INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)", [TEAM, `Folder Probe ${T}`, Date.now()]);
  for (const [id, role, name] of [[U, "requestor", "Folder Requestor"], [A, "approver", "Folder Approver"], [O, "requestor", "Folder Outsider"]]) {
    await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      [id, `${id}@folder.test`, hash, name, role, TEAM, Date.now()]);
  }
  // Two approved documents U raised and A signed, and one U has nothing to do with.
  for (const [id, requestor] of [[REQ1, U], [REQ2, U], [REQ_HIDDEN, O]]) {
    await execute(
      `INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, target_team_id, marker_json, note, status, created_at, approver_id, approved_at, finalized_at)
       VALUES (?, ?, ?, ?, 'pdf', ?, '[]', '', 'approved', ?, ?, ?, ?)`,
      [id, requestor, `${id}.pdf`, `${id}.pdf`, TEAM, Date.now(), A, Date.now(), Date.now()]);
  }

  // ---- nothing yet ----
  let r = await call(U, "GET", "/api/folders");
  let b = await r.json();
  ck(r.status === 200 && Array.isArray(b.folders) && b.folders.length === 0, `a new person has no folders (${r.status})`);
  ck(b.placements && Object.keys(b.placements).length === 0, "and nothing filed");

  // ---- create ----
  r = await call(U, "POST", "/api/folders", { name: "  Finance   2026 " });
  b = await r.json();
  ck(r.status === 200 && b.folder?.id, `a folder is created (${r.status} ${b.error || ""})`);
  ck(b.folder?.name === "Finance 2026", `with its name tidied (${b.folder?.name})`);
  const FIN = b.folder?.id;
  ck((await call(U, "POST", "/api/folders", { name: "   " })).status === 400, "a blank name is refused");
  ck((await call(U, "POST", "/api/folders", { name: "x".repeat(61) })).status === 400, "a 61-character name is refused");
  r = await call(U, "POST", "/api/folders", { name: "finance 2026" });
  ck(r.status === 409, `the same name in different case is refused (${r.status})`);
  ck(/Finance 2026/.test((await r.json()).error || ""), "and the existing name is shown");
  r = await call(U, "POST", "/api/folders", { name: "Leave" });
  const LEAVE = (await r.json()).folder?.id;
  ck(!!LEAVE, "a second folder is created");

  // ---- file, move, unfile ----
  r = await call(U, "PUT", `/api/folders/items/${REQ1}`, { folderId: FIN });
  ck(r.status === 200, `a document is filed (${r.status})`);
  b = await folders(U);
  ck(b.placements[REQ1] === FIN, "and the placement is reported");
  ck(b.folders.find((f) => f.id === FIN)?.count === 1, `and the folder counts it (${b.folders.find((f) => f.id === FIN)?.count})`);

  await call(U, "PUT", `/api/folders/items/${REQ1}`, { folderId: LEAVE });
  b = await folders(U);
  ck(b.placements[REQ1] === LEAVE, "moving it to another folder replaces the placement");
  ck(b.folders.find((f) => f.id === FIN)?.count === 0 && b.folders.find((f) => f.id === LEAVE)?.count === 1, "and the counts follow");
  ck((await queryOne("SELECT COUNT(*) AS n FROM folder_items WHERE user_id = ? AND request_id = ?", [U, REQ1])).n === 1, "one placement row, not two");

  await call(U, "PUT", `/api/folders/items/${REQ1}`, { folderId: null });
  b = await folders(U);
  ck(!(REQ1 in b.placements), "unfiling removes the placement");

  // ---- delete a folder: documents return to the main list ----
  await call(U, "PUT", `/api/folders/items/${REQ1}`, { folderId: FIN });
  await call(U, "PUT", `/api/folders/items/${REQ2}`, { folderId: FIN });
  r = await call(U, "DELETE", `/api/folders/${FIN}`);
  ck(r.status === 200, `a folder is deleted (${r.status})`);
  b = await folders(U);
  ck(!b.folders.some((f) => f.id === FIN), "and is gone");
  ck(!(REQ1 in b.placements) && !(REQ2 in b.placements), "and its documents are back in the main list");
  ck((await queryOne("SELECT COUNT(*) AS n FROM requests WHERE id IN (?, ?)", [REQ1, REQ2])).n === 2, "the documents themselves are untouched");

  // ---- rename ----
  r = await call(U, "PUT", `/api/folders/${LEAVE}`, { name: "Leave forms" });
  ck(r.status === 200 && (await r.json()).folder?.name === "Leave forms", `a folder is renamed (${r.status})`);
  await call(U, "POST", "/api/folders", { name: "Travel" });
  ck((await call(U, "PUT", `/api/folders/${LEAVE}`, { name: "travel" })).status === 409, "renaming onto an existing name is refused");

  // ---- isolation: the same document, filed differently by two people ----
  r = await call(A, "POST", "/api/folders", { name: "Signed for Finance" });
  const A_FOLDER = (await r.json()).folder?.id;
  await call(A, "PUT", `/api/folders/items/${REQ1}`, { folderId: A_FOLDER });
  await call(U, "PUT", `/api/folders/items/${REQ1}`, { folderId: LEAVE });
  const uView = await folders(U), aView = await folders(A);
  ck(uView.placements[REQ1] === LEAVE && aView.placements[REQ1] === A_FOLDER, "the requestor and the signer file the same document differently");
  ck(!uView.folders.some((f) => f.id === A_FOLDER) && !aView.folders.some((f) => f.id === LEAVE), "and neither sees the other's folders");
  ck((await call(A, "PUT", `/api/folders/${LEAVE}`, { name: "Mine now" })).status === 404, "renaming someone else's folder is refused as not found");
  ck((await call(A, "DELETE", `/api/folders/${LEAVE}`)).status === 404, "deleting someone else's folder is refused as not found");
  ck((await call(A, "PUT", `/api/folders/items/${REQ2}`, { folderId: LEAVE })).status === 404, "filing into someone else's folder is refused as not found");
  ck((await folders(U)).placements[REQ1] === LEAVE, "and nothing of theirs changed");

  // ---- a document you cannot see cannot be filed ----
  ck((await call(U, "PUT", `/api/folders/items/${REQ_HIDDEN}`, { folderId: LEAVE })).status === 404, "filing a document you cannot see is refused");
  ck((await call(U, "PUT", `/api/folders/items/req_does_not_exist`, { folderId: LEAVE })).status === 404, "filing a document that does not exist is refused");

  // ---- signing in is required ----
  ck((await fetch(`${BASE}/api/folders`)).status === 401, "folders need a session");

  // ---- account merge carries folders and filing to the keeper ----
  await call(O, "POST", "/api/folders", { name: "Travel" });        // clashes with U's "Travel"
  r = await call(O, "POST", "/api/folders", { name: "Outsider only" });
  const O_ONLY = (await r.json()).folder?.id;
  await call(O, "PUT", `/api/folders/items/${REQ_HIDDEN}`, { folderId: O_ONLY });
  await mergeUsers(U, O);
  const merged = await folders(U);
  ck(merged.folders.some((f) => f.name === "Outsider only"), "the keeper inherits the duplicate's folders");
  ck(merged.folders.some((f) => f.name === "Travel") && merged.folders.some((f) => f.name === "Travel (2)"), "a clashing name is kept as '(2)' rather than lost");
  ck(merged.placements[REQ_HIDDEN] === O_ONLY, "and the duplicate's filing comes across");
  ck(merged.placements[REQ1] === LEAVE, "while the keeper's own filing is untouched");
} catch (e) {
  fail.push(`the run stopped early: ${e?.message || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch((e) => console.log("cleanup:", e.message));
  api.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length) console.log(log.split("\n").filter((l) => /error|folders/i.test(l)).slice(-10).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
