// ============================================================
//   WHAT'S NEW — the feature catalogue and who sees what
//   ------------------------------------------------------------
//   One entry per shipped feature, NEWEST FIRST. Each has a ≤30 s captioned
//   video and a few snapshots (the fallback where WebM will not play, e.g.
//   older iPhones), both in client/public/whats-new/. Only the latest five
//   that apply to a user are kept in their library.
//
//   orgs / roles: null = everyone; otherwise the deployment's organisation and
//   the user's role must be listed. Adding a feature = add an entry at the top
//   and its files; the server only stores which ids each user has seen.
// ============================================================
const SIGNERS = ["requestor", "approver", "executive"];

export const FEATURES = [
  {
    id: "request-types",
    released: "2026-10-18",
    title: "Choose the request type first",
    summary: "Eight request types, each with its own storage period — you're emailed your copy two days before a document is removed.",
    orgs: ["hqhb"],
    roles: SIGNERS,
    video: "/whats-new/request-types.webm",
    slides: [
      { src: "/whats-new/request-types-1.jpg", caption: "Make a new request now starts with the type of request" },
      { src: "/whats-new/request-types-2.jpg", caption: "Each type shows how long its documents are kept once decided" },
      { src: "/whats-new/request-types-3.jpg", caption: "Requests show “Stored until” — you're emailed your copy two days before" },
    ],
  },
  {
    id: "drag-drop-upload",
    released: "2026-10-18",
    title: "Drag files straight in",
    summary: "Drag PDFs or Excel files from Explorer onto any upload box — no need to browse.",
    orgs: null,
    roles: null,
    video: "/whats-new/drag-drop-upload.webm",
    slides: [
      { src: "/whats-new/drag-drop-upload-1.jpg", caption: "Drag a file from Explorer over the upload box — it lights up" },
      { src: "/whats-new/drag-drop-upload-2.jpg", caption: "Drop it — the document opens, ready for signature boxes" },
      { src: "/whats-new/drag-drop-upload-3.jpg", caption: "Works everywhere you upload: Sign your documents, supporting documents, signatures" },
    ],
  },
  {
    id: "recommend-changes",
    released: "2026-10-17",
    title: "Approve, Reject or Recommend changes",
    summary: "Approvers can send a document back with what to change; requestors revise, add documents and resubmit.",
    orgs: ["hqhb"],
    roles: SIGNERS,
    video: "/whats-new/recommend-changes.webm",
    slides: [
      { src: "/whats-new/recommend-changes-1.jpg", caption: "Approvers now have three choices: Reject, Recommend changes, Approve" },
      { src: "/whats-new/recommend-changes-2.jpg", caption: "Recommend changes: write what needs to change and send it back" },
      { src: "/whats-new/recommend-changes-3.jpg", caption: "The requestor sees it under “Returned for changes”" },
      { src: "/whats-new/recommend-changes-4.jpg", caption: "Revise, add supporting documents, reply — and resubmit to the same approver" },
    ],
  },
  {
    id: "approver-date",
    released: "2026-10-16",
    title: "Add today's date under your signature",
    summary: "When no date box was placed, approvers can stamp today's date under their signature. PDFs up to 30 MB.",
    orgs: ["hqhb"],
    roles: ["approver", "executive"],
    video: "/whats-new/approver-date.webm",
    slides: [
      { src: "/whats-new/approver-date-1.jpg", caption: "Open a document and choose Preview & approve" },
      { src: "/whats-new/approver-date-2.jpg", caption: "Tick “Add today's date below my signature”" },
      { src: "/whats-new/approver-date-3.jpg", caption: "The date is stamped, smaller, just under your signature" },
    ],
  },
  {
    id: "supporting-documents",
    released: "2026-10-14",
    title: "Supporting documents",
    summary: "Send documents for reading alongside the one being signed, in the order you choose.",
    orgs: ["hqhb"],
    roles: SIGNERS,
    video: "/whats-new/supporting-documents.webm",
    slides: [
      { src: "/whats-new/supporting-documents-1.jpg", caption: "Upload several files at once" },
      { src: "/whats-new/supporting-documents-2.jpg", caption: "Mark the ones that are only for reading with the paperclip" },
      { src: "/whats-new/supporting-documents-3.jpg", caption: "The approver reads them alongside the document they sign" },
    ],
  },
];

export const LIBRARY_SIZE = 5;
// Releases are dated in IST, the organisations' own time.
export const releasedAt = (f) => Date.parse(`${f.released}T00:00:00+05:30`);

const appliesTo = (f, { org, role }) =>
  (!f.orgs || f.orgs.includes(org)) && (!f.roles || f.roles.includes(role));

// The latest five features that apply to this user, newest first.
export function libraryFor(user, features = FEATURES) {
  return features.filter(f => appliesTo(f, user)).slice(0, LIBRARY_SIZE);
}

// What to play at sign-in, oldest first so the story reads in order:
//  · an existing user: every feature in their library released since they
//    joined that they have not been shown yet;
//  · a brand-new account (joined after the newest feature shipped): only the
//    newest one, so a first sign-in is not a string of videos — the rest are in
//    the library.
export function toShowOnSignIn(user, { seen = [], joinedAt = null } = {}, features = FEATURES) {
  const lib = libraryFor(user, features);
  if (!lib.length) return [];
  const unseen = (f) => !seen.includes(f.id);
  if (joinedAt && joinedAt >= releasedAt(lib[0])) return unseen(lib[0]) ? [lib[0]] : [];
  return lib.filter(f => unseen(f) && (!joinedAt || releasedAt(f) >= joinedAt)).reverse();
}
