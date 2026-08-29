// ============================================================
//   High-contrast display — admin-gated per user.
//   Needs the API on :5001.  Run: node server/test/dark-mode.integration.mjs
// ============================================================
import { config } from "dotenv"; config({ path: "server/.env" });
import bcrypt from "bcryptjs";
const { initDb, queryOne, execute } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

const B = "http://127.0.0.1:5001";
const fail = []; const ck = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail.push(m); };
const J = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const H = (id) => ({ Authorization: "Bearer " + signToken(id), "Content-Type": "application/json" });

await execute("DELETE FROM users WHERE id IN ('u_dm_x','u_dm_adm')");
const now = Date.now();
await execute("INSERT INTO users (id,email,password_hash,name,role,created_at,active) VALUES ('u_dm_x','u_dm_x@hqhb.in',?,'Dim Executive','executive',?,1)", [bcrypt.hashSync("x", 4), now]);
await execute("INSERT INTO users (id,email,password_hash,name,role,created_at,active) VALUES ('u_dm_adm','u_dm_adm@hqhb.in',?,'Dm Admin','admin',?,1)", [bcrypt.hashSync("x", 4), now]);

// 1. without the admin grant, the user cannot switch it on
let r = await J(await fetch(B + "/api/users/me/dark-mode", { method: "PUT", headers: H("u_dm_x"), body: JSON.stringify({ on: true }) }));
ck(r.status === 403, "user without the grant is refused (" + r.status + ")");

// 2. non-admins cannot grant
r = await J(await fetch(B + "/api/users/u_dm_x/dark-mode-access", { method: "PUT", headers: H("u_dm_x"), body: JSON.stringify({ allowed: true }) }));
ck(r.status === 403, "only an admin can grant access (" + r.status + ")");

// 3. admin grants -> flag appears on the profile
r = await J(await fetch(B + "/api/users/u_dm_x/dark-mode-access", { method: "PUT", headers: H("u_dm_adm"), body: JSON.stringify({ allowed: true }) }));
ck(r.status === 200 && r.body.allowed === true, "admin grants access");
let me = await J(await fetch(B + "/api/auth/me", { headers: H("u_dm_x") }));
ck(me.body.user?.darkModeAllowed === true && me.body.user?.darkModeOn === false, "profile shows allowed, still off");

// 4. the user switches it on; the choice persists server-side (follows devices)
r = await J(await fetch(B + "/api/users/me/dark-mode", { method: "PUT", headers: H("u_dm_x"), body: JSON.stringify({ on: true }) }));
ck(r.status === 200 && r.body.on === true, "user switches it on");
me = await J(await fetch(B + "/api/auth/me", { headers: H("u_dm_x") }));
ck(me.body.user?.darkModeOn === true, "…and it persists on the profile");

// 4b. the user picks a variant; it persists, and junk variants are ignored
r = await J(await fetch(B + "/api/users/me/dark-mode", { method: "PUT", headers: H("u_dm_x"), body: JSON.stringify({ on: true, variant: "grayscale" }) }));
ck(r.status === 200, "user picks the greyscale (colour-blind-safe) variant");
me = await J(await fetch(B + "/api/auth/me", { headers: H("u_dm_x") }));
ck(me.body.user?.darkModeVariant === "grayscale", "…and the variant persists on the profile");
r = await J(await fetch(B + "/api/users/me/dark-mode", { method: "PUT", headers: H("u_dm_x"), body: JSON.stringify({ on: true, variant: "sepia" }) }));
me = await J(await fetch(B + "/api/auth/me", { headers: H("u_dm_x") }));
ck(me.body.user?.darkModeVariant === "grayscale", "an unknown variant is ignored, not stored");

// 5. revoking also switches the display back off — never stranded
r = await J(await fetch(B + "/api/users/u_dm_x/dark-mode-access", { method: "PUT", headers: H("u_dm_adm"), body: JSON.stringify({ allowed: false }) }));
ck(r.status === 200, "admin revokes");
const row = await queryOne("SELECT dark_mode_allowed, dark_mode_on FROM users WHERE id='u_dm_x'");
ck(Number(row.dark_mode_allowed) === 0 && Number(row.dark_mode_on) === 0, "revoke also turns the display off");
me = await J(await fetch(B + "/api/auth/me", { headers: H("u_dm_x") }));
ck(me.body.user?.darkModeAllowed === false && me.body.user?.darkModeOn === false, "profile reflects the revoke");

console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nDARK MODE GATE E2E PASSED");
await execute("DELETE FROM users WHERE id IN ('u_dm_x','u_dm_adm')");
process.exit(fail.length ? 1 : 0);
