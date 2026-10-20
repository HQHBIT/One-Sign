// ============================================================
//   What's new: who is shown which feature video, and when.
//   Run: node client/src/lib/whatsNew.test.mjs
// ============================================================
import { FEATURES, libraryFor, toShowOnSignIn, releasedAt, LIBRARY_SIZE } from "./whatsNew.js";

let failed = 0;
const ck = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failed++; };
const ids = (list) => list.map(f => f.id).join(",");
const day = (iso) => Date.parse(`${iso}T12:00:00+05:30`);

const hqApprover = { org: "hqhb", role: "approver" };
const hqRequestor = { org: "hqhb", role: "requestor" };
const waqfApprover = { org: "waqf", role: "approver" };
const hqAdmin = { org: "hqhb", role: "admin" };

// ---- the catalogue itself ----
ck(FEATURES.every((f, i) => i === 0 || releasedAt(FEATURES[i - 1]) >= releasedAt(f)), "catalogue is newest first");
ck(new Set(FEATURES.map(f => f.id)).size === FEATURES.length, "feature ids are unique");
ck(FEATURES.every(f => /^[a-z0-9][a-z0-9-]{0,63}$/.test(f.id)), "feature ids match what the server accepts");
ck(FEATURES.every(f => f.video && f.slides?.length >= 2 && f.slides.every(s => s.src && s.caption)), "every feature has a video and captioned snapshots");

// ---- audience ----
ck(ids(libraryFor(hqApprover)) === "request-types,drag-drop-upload,recommend-changes,approver-date,supporting-documents", "HQHB approver: all five, newest first");
ck(!libraryFor(hqRequestor).some(f => f.id === "approver-date"), "HQHB requestor: no approver-only video");
ck(ids(libraryFor(waqfApprover)) === "waqf-manzuri,drag-drop-upload", "WAQF: only the features that apply to WAQF");
ck(!libraryFor(hqApprover).some(f => f.id === "waqf-manzuri"), "HQHB never sees the WAQF-only Manzuri video");
ck(ids(libraryFor(hqAdmin)) === "drag-drop-upload", "IT Admin: only what applies to admins");

const many = Array.from({ length: 8 }, (_, i) => ({ id: `f${8 - i}`, released: `2026-11-${String(18 - i).padStart(2, "0")}`, orgs: null, roles: null }));
ck(libraryFor(hqApprover, many).length === LIBRARY_SIZE && libraryFor(hqApprover, many)[0].id === "f8", "library keeps only the latest five");

// ---- sign-in ----
const veteran = { joinedAt: day("2026-08-01") };
ck(ids(toShowOnSignIn(hqApprover, veteran)) === "supporting-documents,approver-date,recommend-changes,drag-drop-upload,request-types",
  "existing user: every unseen feature since they joined, oldest first");
ck(ids(toShowOnSignIn(hqApprover, { ...veteran, seen: ["approver-date", "supporting-documents"] })) === "recommend-changes,drag-drop-upload,request-types",
  "a feature already shown is not shown again");
ck(toShowOnSignIn(hqApprover, { ...veteran, seen: FEATURES.map(f => f.id) }).length === 0, "nothing left to show → nothing plays");
ck(ids(toShowOnSignIn(hqApprover, { joinedAt: day("2026-10-15") })) === "approver-date,recommend-changes,drag-drop-upload,request-types",
  "joined mid-way: only what shipped after they joined");
ck(ids(toShowOnSignIn(hqApprover, { joinedAt: day("2026-10-20") })) === "request-types", "brand-new account: only the newest video");
ck(toShowOnSignIn(hqApprover, { joinedAt: day("2026-10-20"), seen: ["request-types"] }).length === 0, "brand-new account that has seen it: nothing");
ck(ids(toShowOnSignIn(waqfApprover, veteran)) === "drag-drop-upload,waqf-manzuri", "WAQF user: their two, never an HQHB-only video");
ck(toShowOnSignIn(hqApprover, { seen: [] }).length === 5, "unknown join date: treated as an existing user");

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log("\nALL WHAT'S-NEW RULES PASSED");
