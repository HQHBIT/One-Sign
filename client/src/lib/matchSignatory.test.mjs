// Does a printed name find the right person — and refuse when it cannot?
//
//   node src/lib/matchSignatory.test.mjs
//
// The refusals matter more than the matches here. Routing an expense to the
// wrong approver sends the document to someone who should not see it and leaves
// the person who should waiting for something they never learn about, so an
// ambiguous name has to come back as a question rather than a guess.
import { matchName, score, looksLikeName, searchTermFor } from "./matchSignatory.js";

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

const users = [
  { id: "u1", name: "Huzaifa bhai Hakimuddin bhai Shakir" },
  { id: "u2", name: "Idris bhai Salebhai" },
  { id: "u3", name: "Khadija Tamboowala" },
  { id: "u4", name: "M. Murtaza Kotwala" },
  { id: "u5", name: "Mufaddal bhai Aliasgar bhai Hamid" },
];

// ---- the names this form actually prints ----
{
  ck(matchName("Huzaifa Bsb", users)?.user?.id === "u1", "\"Huzaifa Bsb\" finds Huzaifa bhai Shakir");
  ck(matchName("Idris bsb", users)?.user?.id === "u2", "\"Idris bsb\" finds Idris bhai Salebhai");
  ck(matchName("Khadija Tamboowala", users)?.user?.id === "u3", "an exact name matches");
  ck(matchName("M. Murtaza Kotwala", users)?.user?.id === "u4", "initials and full stops are ignored");
}

// ---- honorifics carry no identity ----
{
  ck(score("Huzaifa Bsb", "Huzaifa bhai Hakimuddin bhai Shakir") > 0.9,
    "bsb and bhai are stripped from both sides");
  ck(score("bhai bsb", "Idris bhai Salebhai") === 0, "a name of nothing but honorifics scores zero");
}

// ---- and it refuses when two people fit ----
{
  const twins = [
    { id: "a", name: "Huzaifa bhai Hakimuddin bhai Shakir" },
    { id: "b", name: "Huzaifa bhai Joharali bhai Kirana wala" },
  ];
  const m = matchName("Huzaifa Bsb", twins);
  ck(m && m.ambiguous === true, "two Huzaifas is a question, not a match");
  ck(m && m.user === null, "and no one is chosen on the requestor's behalf");
  ck(m && m.candidates.length === 2, "both are offered so a person can pick");
}

// ---- a name nobody carries is not forced onto the nearest person ----
{
  ck(matchName("Zainab Poonawala", users) === null, "an unknown name matches nobody");
  ck(matchName("", users) === null, "an empty name matches nobody");
  ck(matchName("Huzaifa Bsb", []) === null, "an empty directory matches nobody");
}

// ---- a shared surname alone is not enough ----
{
  const m = matchName("Fatema Kotwala", users);
  ck(!m || !m.user || m.score < 1, `a half-match does not become a confident one (${m ? m.score.toFixed(2) : "null"})`);
}

// ---- the form's own placeholder text is not a name ----
// An unfilled row prints "Please mention employee ID in B11". Searching the
// directory for that returns nothing and tells the requestor nothing, so the row
// has to be recognised as blank rather than as a person nobody can find.
{
  ck(looksLikeName("Huzaifa Bsb"), "a printed name is a name");
  ck(!looksLikeName("Please mention employee ID in B11"), "the fill-me-in placeholder is not");
  ck(!looksLikeName("-"), "a dash is not");
  ck(!looksLikeName(""), "nothing is not");
}

// ---- the directory is searched by first name ----
// The form abbreviates what the directory spells out, so the whole string finds
// nobody; the first name is the part both spellings agree on.
{
  ck(searchTermFor("Huzaifa Bsb") === "huzaifa", "\"Huzaifa Bsb\" searches for huzaifa");
  ck(searchTermFor("M. Murtaza Kotwala") === "murtaza", "a lone initial is skipped over");
  ck(searchTermFor("Please mention employee ID in B11") === "", "a placeholder searches for nothing");
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
