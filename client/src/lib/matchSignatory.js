// ============================================================
//   MATCHING A PRINTED NAME TO A PERSON
//   ------------------------------------------------------------
//   The form prints "Huzaifa Bsb" and the directory holds "Huzaifa bhai
//   Hakimuddin bhai Shakir". Those are the same person, and the requestor should
//   be able to confirm that in one click rather than search for them.
//
//   The hard part is not matching, it is knowing when NOT to. Routing an expense
//   to the wrong approver is worse than asking who is meant: the document goes
//   to someone who should not see it, and the person who should never learns it
//   exists. So a match is only offered when one candidate is clearly ahead of
//   the next — otherwise the field is left for a human to choose, which is the
//   honest answer to an ambiguous name.
// ============================================================

// Honorifics and titles, which carry no identity. "bsb" is bhai saheb; the form
// uses it where the directory spells the full name out.
const NOISE = new Set([
  "bhai", "bsb", "bs", "saheb", "sb", "skh", "shk", "sheikh", "shaikh",
  "mulla", "ml", "janab", "mr", "mrs", "ms", "dr", "the",
]);

const tokens = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")     // drops punctuation AND the "M." in "M. Murtaza"
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NOISE.has(t));

/**
 * How well a printed name matches a person's name, from 0 to 1.
 *
 * Scored against the PRINTED tokens rather than the directory's, because the
 * form abbreviates: every token the form gives should be accounted for, while
 * the extra names the directory carries are not evidence against a match.
 */
export function score(printed, candidate) {
  const a = tokens(printed);
  const b = new Set(tokens(candidate));
  if (!a.length || !b.size) return 0;
  const hits = a.filter((t) => b.has(t)).length;
  if (!hits) return 0;
  let s = hits / a.length;
  // A shared first name is worth more than a shared middle one: forms lead with
  // the name people are known by.
  if (a[0] && b.has(a[0])) s += 0.15;
  return Math.min(1, s);
}

/**
 * Best match for a printed name, or null when it is not clear enough to offer.
 *
 * @param {string} printed        the name as the form prints it
 * @param {Array<{id,name,email}>} users
 * @param {object} [opts]
 * @param {number} [opts.min]     lowest score worth offering
 * @param {number} [opts.margin]  how far ahead of the runner-up it must be
 * @returns {{user, score, runnerUp}|null}
 */
export function matchName(printed, users = [], { min = 0.6, margin = 0.2 } = {}) {
  if (!printed || !users.length) return null;
  const ranked = users
    .map((u) => ({ user: u, score: score(printed, u.name) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length || ranked[0].score < min) return null;
  const runnerUp = ranked[1]?.score || 0;
  // Two people who fit equally well is not a match, it is a question.
  if (ranked[0].score - runnerUp < margin) {
    return { user: null, score: ranked[0].score, runnerUp, ambiguous: true, candidates: ranked.slice(0, 4).map(r => r.user) };
  }
  return { user: ranked[0].user, score: ranked[0].score, runnerUp, ambiguous: false };
}
