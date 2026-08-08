// ============================================================
//   Confidential envelope — crypto boundary unit tests.
//   Run: node server/test/confidential.test.mjs
// ============================================================
const KEY = Buffer.alloc(32, 7).toString("base64");
process.env.CONFIDENTIAL_KEY = KEY;

const C = await import("../src/confidential.js");
let failed = 0;
const ck = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failed++; };
const threw = (fn) => { try { fn(); return false; } catch { return true; } };

ck(C.isEnabled() === true, "enabled with a valid 32-byte key");

// --- round trip ---
const plain = Buffer.from("%PDF-1.7\nconfidential board minutes\n%%EOF");
const sealed = C.encryptBuffer(plain);
ck(C.decryptBuffer(sealed).equals(plain), "round-trips byte for byte");
ck(C.looksEncrypted(sealed) === true, "envelope is recognisable");
ck(C.looksEncrypted(plain) === false, "plaintext PDF is not mistaken for an envelope");
ck(!sealed.includes(Buffer.from("board minutes")), "plaintext does not survive in the ciphertext");
ck(sealed.subarray(0, 8).toString().includes("%PDF") === false, "sealed bytes are not a PDF");

// --- every seal is unique (fresh IV) ---
const again = C.encryptBuffer(plain);
ck(!again.equals(sealed), "same input seals differently each time (random IV)");
ck(C.decryptBuffer(again).equals(plain), "…and both decrypt correctly");

// --- tamper detection ---
const flipped = Buffer.from(sealed); flipped[30] ^= 0xff;
ck(threw(() => C.decryptBuffer(flipped)), "a flipped ciphertext byte is rejected");
const badTag = Buffer.from(sealed); badTag[badTag.length - 1] ^= 0xff;
ck(threw(() => C.decryptBuffer(badTag)), "a tampered auth tag is rejected");
ck(threw(() => C.decryptBuffer(sealed.subarray(0, sealed.length - 4))), "a truncated file is rejected");
ck(threw(() => C.decryptBuffer(plain)), "decrypting a non-envelope is rejected");

// --- wrong key cannot read ---
process.env.CONFIDENTIAL_KEY = Buffer.alloc(32, 9).toString("base64");
ck(threw(() => C.decryptBuffer(sealed)), "a different key cannot open the document");
process.env.CONFIDENTIAL_KEY = KEY;
ck(C.decryptBuffer(sealed).equals(plain), "the right key still opens it");

// --- version / key-id guards ---
const futureVer = Buffer.from(sealed); futureVer[1] = 0x02;
ck(threw(() => C.decryptBuffer(futureVer)), "unknown envelope version is rejected");
const otherKeyId = Buffer.from(sealed); otherKeyId[2] = 0x05;
ck(threw(() => C.decryptBuffer(otherKeyId)), "unknown key id is rejected, not silently mis-decrypted");

// --- fail closed ---
delete process.env.CONFIDENTIAL_KEY;
ck(C.isEnabled() === false, "disabled when the key is absent");
ck(C.keyStatus() === "not_set", "status says not_set");
ck(threw(() => C.encryptBuffer(plain)), "refuses to encrypt without a key (never silent plaintext)");
process.env.CONFIDENTIAL_KEY = "tooshort";
ck(C.isEnabled() === false, "disabled when the secret is too short to be safe");
ck(/^too_short_8_/.test(C.keyStatus()), "status explains why: " + C.keyStatus());
process.env.CONFIDENTIAL_KEY = KEY;
ck(C.isEnabled() === true, "re-enabled once a usable secret returns");
ck(C.keyStatus() === "ok", "status says ok");

// --- the secret is DERIVED, so real-world paste damage no longer breaks it ---
// These are the exact failures seen in production: a BOM from PowerShell
// redirection, wrapping quotes, and trailing whitespace/newlines.
const base = "a".repeat(20) + "Zx9/+Qw=";
const variants = {
  "plain":            base,
  "UTF-8 BOM":        "﻿" + base,
  "double quoted":    '"' + base + '"',
  "single quoted":    "'" + base + "'",
  "trailing newline": base + String.fromCharCode(10),
  "leading space":    "  " + base,
  "CRLF":             base + String.fromCharCode(13, 10),
};
process.env.CONFIDENTIAL_KEY = base;
const canonical = C.encryptBuffer(plain);
for (const [label, v] of Object.entries(variants)) {
  process.env.CONFIDENTIAL_KEY = v;
  ck(C.isEnabled() === true, `accepts a secret with ${label}`);
  let ok = false;
  try { ok = C.decryptBuffer(canonical).equals(plain); } catch { ok = false; }
  ck(ok, `${label} derives the SAME key (no silent data loss)`);
}

// A different secret must NOT open it — derivation isn't collapsing inputs.
process.env.CONFIDENTIAL_KEY = "b".repeat(20) + "Zx9/+Qw=";
ck(threw(() => C.decryptBuffer(canonical)), "a different secret cannot open the document");
process.env.CONFIDENTIAL_KEY = KEY;

// --- pass-through helpers ---
ck(C.sealIfConfidential(plain, false).equals(plain), "non-confidential content is stored as-is");
ck(C.looksEncrypted(C.sealIfConfidential(plain, true)), "confidential content is sealed");
ck(C.storedNameFor("req_1.pdf", true) === "req_1.pdf.enc", "confidential files carry .enc");
ck(C.storedNameFor("req_1.pdf", false) === "req_1.pdf", "ordinary files keep their name");

// --- unlock code ---
const codes = new Set();
for (let i = 0; i < 400; i++) {
  const c = C.newUnlockCode();
  if (!/^\d{6}$/.test(c)) { ck(false, `code is not 6 digits: ${c}`); break; }
  codes.add(c);
}
ck(codes.size > 300, `codes are well spread (${codes.size} distinct in 400)`);

// --- email masking ---
ck(C.maskEmail("taha.chunawala@hqhb.in").startsWith("t"), "mask keeps the first letter");
ck(C.maskEmail("taha.chunawala@hqhb.in").endsWith("@hqhb.in"), "mask keeps the domain");
ck(!C.maskEmail("taha.chunawala@hqhb.in").includes("chunawala"), "mask hides the local part");
ck(C.maskEmail("") === "your registered address", "mask copes with a missing address");

console.log(failed ? `\n${failed} check(s) failed` : "\nCONFIDENTIAL ENVELOPE TESTS PASSED");
process.exit(failed ? 1 : 0);
