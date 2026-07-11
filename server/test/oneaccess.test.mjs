import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { _setPublicKeyForTest, verifyOneAccessToken, toLocalIdentity } from "../src/oneaccess.js";

// Generate a throwaway RSA keypair so we can sign + verify offline (no network).
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
_setPublicKeyForTest(publicKey);
const { publicKey: otherPub } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });

test("verifies a genuine RS256 oneAccess token", async () => {
  const tok = jwt.sign({ its_id: "20384756", email: "u@x.com", fullname: "Hussain B." }, privateKey, { algorithm: "RS256", expiresIn: "5m" });
  const claims = await verifyOneAccessToken(tok);
  assert.equal(claims.its_id, "20384756");
});

test("rejects a tampered token", async () => {
  const tok = jwt.sign({ its_id: "1" }, privateKey, { algorithm: "RS256", expiresIn: "5m" });
  await assert.rejects(() => verifyOneAccessToken(tok.slice(0, -4) + "AAAA"));
});

test("rejects an expired token", async () => {
  const tok = jwt.sign({ its_id: "1" }, privateKey, { algorithm: "RS256", expiresIn: -10 });
  await assert.rejects(() => verifyOneAccessToken(tok));
});

test("rejects a token signed by a different key", async () => {
  _setPublicKeyForTest(otherPub);
  const tok = jwt.sign({ its_id: "1" }, privateKey, { algorithm: "RS256", expiresIn: "5m" });
  await assert.rejects(() => verifyOneAccessToken(tok));
  _setPublicKeyForTest(publicKey);
});

test("rejects HS256 alg-confusion tokens", async () => {
  const forged = jwt.sign({ its_id: "1" }, "any-secret", { algorithm: "HS256" });
  await assert.rejects(() => verifyOneAccessToken(forged));
});

test("toLocalIdentity prefers the profile and lowercases email", () => {
  const id = toLocalIdentity({ its_id: "1", email: "A@B.com", name: "Claim" }, { its_id: "1", email: "Prof@B.com", fullname: "Profile Name" });
  assert.equal(id.email, "prof@b.com");
  assert.equal(id.name, "Profile Name");
});

test("toLocalIdentity falls back to claims when profile is missing", () => {
  const id = toLocalIdentity({ its_id: "9", email: "C@D.com", fullname: "Claim Only" }, null);
  assert.deepEqual({ its: id.its, email: id.email, name: id.name }, { its: "9", email: "c@d.com", name: "Claim Only" });
});

console.log("oneaccess: all tests passed");
