// ============================================================
//   PUBLIC VERIFICATION OF A SIGN NUMBER
//   ------------------------------------------------------------
//   The tag printed under a signature can be copied — it is ink, and anyone
//   can retype it. What cannot be copied is the TRUTH behind it, and this is
//   where anyone holding a document can ask for that truth.
//
//   A tag pasted onto another document still looks right. Verifying it says
//   which document it actually belongs to, who signed that one and when, and
//   gives the fingerprint of the signed file. None of that will match the page
//   in the forger's hand.
//
//   Deliberately PUBLIC and unauthenticated: the person most likely to need it
//   is a recipient outside the organisation, who has no account. That is also
//   why it answers with the least it can, and never confirms anything about a
//   confidential document beyond the fact that the signature is genuine.
// ============================================================
import { Router } from "express";
import { queryOne } from "../db.js";
import { rateLimit } from "../ratelimit.js";
import { parseSignNo, checkCodeFor, signNumbersOn } from "../signRegister.js";

const router = Router();

// Public and enumerable, so it is capped. Generous enough for someone checking
// a handful of signatures on one document, mean enough to make walking the
// whole register by hand pointless.
const verifyLimit = rateLimit({
  windowMs: 10 * 60_000,
  max: 30,
  message: "Too many verification attempts. Please wait a few minutes and try again.",
});

const asDate = (ms) => (ms ? new Date(Number(ms)).toISOString() : null);

router.get("/:signNo", verifyLimit, async (req, res, next) => {
  try {
    if (!signNumbersOn()) return res.status(404).end();

    const parsed = parseSignNo(req.params.signNo);
    // Unparseable is "not a sign number", which is a different thing from a
    // well-formed number that is not ours — and worth saying differently.
    if (!parsed) {
      return res.json({ valid: false, reason: "malformed", message: "That is not a SignFlow sign number." });
    }

    const row = await queryOne(
      `SELECT sign_no, check_code, signer_name, signed_at, document_name, requested_by_name,
              confidential, doc_sha256, source
         FROM sign_register WHERE sign_no = ?`, [parsed.signNo]);

    if (!row) {
      return res.json({ valid: false, reason: "unknown", message: "No signature carries that number." });
    }

    // The check code is the part that cannot be invented. An older row has
    // none, so a number alone still verifies — it simply proves less, and the
    // answer says so rather than overstating what was checked.
    const expected = row.check_code || null;
    if (parsed.checkCode) {
      const want = expected || (await checkCodeFor(row.sign_no));
      if (parsed.checkCode !== want) {
        return res.json({
          valid: false, reason: "bad-check-code",
          message: "That number exists, but the code beside it does not match. The tag has been altered or retyped incorrectly.",
        });
      }
    }

    // A confidential document is never named here, to anyone. Confirming the
    // signature is genuine is the whole job; naming the paper is not.
    const confidential = !!Number(row.confidential);

    res.json({
      valid: true,
      signNo: row.sign_no,
      // Says what was actually proven, so nobody reads more into a bare number
      // than it can carry.
      assurance: parsed.checkCode ? "number-and-code" : "number-only",
      checkCodePresent: !!expected,
      signedBy: row.signer_name || null,
      signedAt: asDate(row.signed_at),
      confidential,
      document: confidential ? null : (row.document_name || null),
      requestedBy: confidential ? null : (row.requested_by_name || null),
      // The fingerprint of the file this signature produced. The one check a
      // recipient can make entirely for themselves: hash the PDF in their hand
      // and compare. A pasted tag will not match.
      fileSha256: row.doc_sha256 || null,
      // Registered at start-up from a signature made before numbering existed,
      // so the record is real but was written after the fact.
      backfilled: row.source === "backfill",
    });
  } catch (e) { next(e); }
});

export default router;
