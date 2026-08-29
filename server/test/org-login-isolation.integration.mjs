// Integration: an account belonging to one organisation cannot sign in through
// another organisation's door — the whole point of the landing picker.
//
// Needs the API running (npm start) and a reachable database.
import "dotenv/config";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { initDb, execute, query } from "../src/db.js";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:5001";
await initDb();

const stamp = Date.now();
const PASSWORD = `Probe!${stamp}`;
const hash = bcrypt.hashSync(PASSWORD, 10);
const made = [];

async function makeUser(orgId, role = "requestor") {
  const id = `probe_${orgId}_${role}_${stamp}`;
  const email = `${id}@example.invalid`;
  await execute(
    `INSERT INTO users (id, email, password_hash, name, role, org_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, email, hash, `Probe ${orgId}`, role, orgId, Date.now()]);
  made.push(id);
  return email;
}

const login = async (email, org) => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(org === undefined ? { email, password: PASSWORD } : { email, password: PASSWORD, org })
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

try {
  const hqhbUser = await makeUser("hqhb");
  const waqfUser = await makeUser("waqf");
  const globalAdmin = await makeUser("hqhb", "admin");

  // ---- each signs in at its own door ----
  assert.equal((await login(hqhbUser, "hqhb")).status, 200, "HQHB user signs in at the HQHB door");
  assert.equal((await login(waqfUser, "waqf")).status, 200, "WAQF user signs in at the WAQF door");

  // ---- and is refused at the other ----
  const crossA = await login(hqhbUser, "waqf");
  const crossB = await login(waqfUser, "hqhb");
  assert.equal(crossA.status, 401, "HQHB user refused at the WAQF door");
  assert.equal(crossB.status, 401, "WAQF user refused at the HQHB door");

  // ---- and the refusal is indistinguishable from a wrong password ----
  // Anything more specific would confirm the address exists in the other
  // organisation, which is exactly the enumeration we avoid elsewhere.
  const wrongPassword = await (async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: hqhbUser, password: "definitely-not-it", org: "hqhb" })
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  })();
  assert.equal(crossA.status, wrongPassword.status, "same status as a bad password");
  assert.deepEqual(crossA.body, wrongPassword.body, "same body as a bad password — no organisation leak");
  assert.ok(!JSON.stringify(crossA.body).toLowerCase().includes("organis"),
    "the error text never mentions organisations");

  // ---- the global IT Admin is exempt and may use either door ----
  assert.equal((await login(globalAdmin, "hqhb")).status, 200, "admin at the HQHB door");
  assert.equal((await login(globalAdmin, "waqf")).status, 200, "admin at the WAQF door");

  // ---- omitting the organisation keeps the previous behaviour ----
  // Older clients, and the /me refresh path, send no slug at all.
  assert.equal((await login(hqhbUser, undefined)).status, 200, "no slug still signs in");

  // ---- an unknown slug is not a back door, but is not a lockout either ----
  assert.equal((await login(hqhbUser, "bogus")).status, 200, "unknown slug falls back to server defaults");

  console.log("org login isolation: all tests passed");
} finally {
  if (made.length) {
    await query(`DELETE FROM users WHERE id IN (${made.map(() => "?").join(",")})`, made);
  }
}
process.exit(0);
