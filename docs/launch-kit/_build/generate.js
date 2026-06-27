// Generates the SignFlow launch-kit Word documents with shared styling.
// Run: node docs/launch-kit/_build/generate.js   (outputs .docx to docs/launch-kit/)
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, TabStopType, ImageRun
} = require("docx");

const OUT = path.join(__dirname, "..");
const NAVY = "0F1A2E", GOLD = "B8894A", GREY = "5A6472", CODE = "7A4B10", LIGHT = "F4EFE3";
const CONTENT_W = 9360; // US Letter, 1" margins

// ---- inline mini-markup: **bold** and `code` ----
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ ...base, text: text.slice(last, m.index) }));
    const t = m[0];
    if (t.startsWith("**")) out.push(new TextRun({ ...base, text: t.slice(2, -2), bold: true }));
    else out.push(new TextRun({ ...base, text: t.slice(1, -1), font: "Consolas", color: base.color || CODE }));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(new TextRun({ ...base, text: text.slice(last) }));
  return out.length ? out : [new TextRun({ ...base, text })];
}

const numbering = {
  config: [
    { reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] },
    ...Array.from({ length: 40 }, (_, i) => ({
      reference: "n" + i,
      levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } }]
    }))
  ]
};

const styles = {
  default: { document: { run: { font: "Arial", size: 21, color: "222B36" } } },
  paragraphStyles: [
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 30, bold: true, color: NAVY, font: "Arial" }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, color: NAVY, font: "Arial" }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 } },
    { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 21, bold: true, color: GOLD, font: "Arial" }, paragraph: { spacing: { before: 160, after: 40 }, outlineLevel: 2 } }
  ]
};

// ---- block renderer ----
function render(blocks) {
  let nc = 0;
  const ch = [];
  for (const b of blocks) {
    if (b.h1) ch.push(new Paragraph({ heading: "Heading1", children: runs(b.h1) }));
    else if (b.h2) ch.push(new Paragraph({ heading: "Heading2", children: runs(b.h2) }));
    else if (b.h3) ch.push(new Paragraph({ heading: "Heading3", children: runs(b.h3) }));
    else if (b.title) {
      ch.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: b.title, bold: true, size: 44, color: NAVY })] }));
      if (b.subtitle) ch.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: b.subtitle, size: 24, color: GOLD })] }));
      ch.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 2 } }, spacing: { after: 160 }, children: [] }));
    }
    else if (b.p !== undefined) ch.push(new Paragraph({ spacing: { after: 100 }, children: runs(b.p) }));
    else if (b.bullets) for (const it of b.bullets) ch.push(new Paragraph({ numbering: { reference: "b", level: 0 }, spacing: { after: 40 }, children: runs(it) }));
    else if (b.steps) { const ref = "n" + (nc++); for (const it of b.steps) ch.push(new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 60 }, children: runs(it) })); }
    else if (b.note) ch.push(new Paragraph({ shading: { fill: LIGHT, type: ShadingType.CLEAR }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: GOLD, space: 8 } }, spacing: { before: 80, after: 120 }, indent: { left: 120 }, children: runs(b.note) }));
    else if (b.code) { for (const line of b.code) ch.push(new Paragraph({ shading: { fill: "F2F2F0", type: ShadingType.CLEAR }, spacing: { after: 0 }, children: [new TextRun({ text: line || " ", font: "Consolas", size: 19, color: "333333" })] })); ch.push(new Paragraph({ spacing: { after: 100 }, children: [] })); }
    else if (b.space) ch.push(new Paragraph({ children: [] }));
    else if (b.table) {
      const { head, rows, widths } = b.table;
      const W = widths || head.map(() => Math.floor(CONTENT_W / head.length));
      const border = { style: BorderStyle.SINGLE, size: 1, color: "D9D2C4" };
      const borders = { top: border, bottom: border, left: border, right: border };
      const mk = (txt, i, opts = {}) => new TableCell({
        borders, width: { size: W[i], type: WidthType.DXA },
        shading: opts.head ? { fill: NAVY, type: ShadingType.CLEAR } : { fill: opts.zebra ? "FBF8F1" : "FFFFFF", type: ShadingType.CLEAR },
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
        children: [new Paragraph({ children: runs(String(txt), opts.head ? { color: "FFFFFF", bold: true, size: 19 } : { size: 20 }) })]
      });
      const trs = [new TableRow({ tableHeader: true, children: head.map((h, i) => mk(h, i, { head: true })) })];
      rows.forEach((r, ri) => trs.push(new TableRow({ children: r.map((c, i) => mk(c, i, { zebra: ri % 2 === 1 })) })));
      ch.push(new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: W, rows: trs }));
      ch.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    }
    else if (b.pageBreak) ch.push(new Paragraph({ children: [new PageBreak()] }));
    else if (b.img) {
      const data = fs.readFileSync(path.join(OUT, "assets", b.img + ".png"));
      const w = b.w || 560, h = Math.round(w * 900 / 1440);
      ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: b.caption ? 20 : 160 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: "D9D2C4", space: 2 }, bottom: { style: BorderStyle.SINGLE, size: 4, color: "D9D2C4", space: 2 }, left: { style: BorderStyle.SINGLE, size: 4, color: "D9D2C4", space: 2 }, right: { style: BorderStyle.SINGLE, size: 4, color: "D9D2C4", space: 2 } }, children: [new ImageRun({ type: "png", data, transformation: { width: w, height: h }, altText: { title: b.img, desc: b.caption || b.img, name: b.img } })] }));
      if (b.caption) ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: b.caption, italics: true, size: 17, color: GREY })] }));
    }
  }
  return ch;
}

function buildDoc(shortTitle, blocks) {
  return new Document({
    styles, numbering,
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "E2D9C6", space: 4 } }, tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }], children: [new TextRun({ text: "HQHB · SignFlow", size: 16, color: GREY, bold: true }), new TextRun({ text: "\t" + shortTitle, size: 16, color: GREY })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 6, color: "E2D9C6", space: 4 } }, tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }], children: [new TextRun({ text: "HQHB Internal — onesign.devhqhb.online", size: 15, color: GREY }), new TextRun({ text: "\tPage ", size: 15, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], size: 15, color: GREY })] })] }) },
      children: render(blocks)
    }]
  });
}

// ============================ CONTENT ============================
const URL = "https://onesign.devhqhb.online/";
const docs = [];

// ---- 1. Announcement email ----
docs.push(["SignFlow-Announcement-Email", "Announcement Email", [
  { title: "SignFlow — Launch Announcement", subtitle: "Ready-to-send email for all staff" },
  { note: "Paste the body below into your email client. Attach the Quick-Start, the relevant role guide(s), and the FAQ. Send once accounts are created (or note that credentials will follow)." },
  { h2: "Subject" },
  { p: "**Introducing SignFlow — faster approvals, fully digital signatures**" },
  { h2: "Body" },
  { p: "Hi everyone," },
  { p: "We’re rolling out **SignFlow**, HQHB’s new digital signature and approval system — one place to send documents for signature, sign and approve them online, and keep a complete, auditable record of every approval." },
  { p: "**Why we’re introducing it** — Getting a document signed today means printing, scanning, chasing people over email, and hoping nothing gets lost. SignFlow replaces all of that:" },
  { bullets: [
    "Submit any PDF or Excel document for signature in seconds",
    "Route it to the right approver(s) — a single sign-off or a multi-step chain, in order",
    "Approvers review and sign digitally; every step is time-stamped and audit-ready",
    "You always know exactly what a document is waiting on"
  ] },
  { p: "**What it means for you** — Most of you will use SignFlow to submit documents for approval and download the signed copies. Approvers and authorised signatories will review and sign the documents routed to them. It runs in your web browser — there’s nothing to install." },
  { p: "**Getting started**" },
  { steps: [
    "IT will set up your account — you’ll receive your login email and a temporary password.",
    "Open " + URL + " and sign in.",
    "Change your password, then register your signature once (draw it or upload an image).",
    "That’s it — you’re ready to go."
  ] },
  { p: "**Guides & help** — Step-by-step guides are attached: a one-page Quick-Start, role-by-role walkthroughs, and an FAQ. Short demo videos are on the way. If you need a hand, contact IT at **it@hqhb.in** (or **taha.chunawala@hqhb.in**)." },
  { p: "Thank you," },
  { p: "**IT — HQHB**" }
]]);

// ---- 2. Quick-Start ----
docs.push(["SignFlow-Quick-Start", "Quick-Start", [
  { title: "SignFlow Quick-Start", subtitle: "Get signing in three steps" },
  { steps: [
    "**Sign in.** Go to " + URL + " and sign in with the email and temporary password from IT. Change your password when prompted.",
    "**Register your signature.** A one-time step — draw it with your mouse/finger or upload an image. (You can defer with “Sign out & do it later.”)",
    "**Start using it** — see your role below."
  ] },
  { img: "01-login", w: 460, caption: "The SignFlow sign-in screen — " + URL },
  { h2: "What you can do" },
  { table: { head: ["Your role", "What you do"], widths: [2600, 6760], rows: [
    ["Requestor", "New request → upload a PDF/Excel → choose the approver(s) → place the signature box → submit. Track progress and download the signed file."],
    ["Approver", "Open a pending request → review the document → Approve & sign (your signature is stamped on), or Reject with a reason."],
    ["Administrator", "Manage users, teams, signatures, documents, and reports from the admin console."]
  ] } },
  { note: "Need help? Email **it@hqhb.in** or **taha.chunawala@hqhb.in**." }
]]);

// ---- 3. Requestor guide ----
docs.push(["SignFlow-Requestor-Guide", "Requestor Guide", [
  { title: "SignFlow — Requestor Guide", subtitle: "Submitting documents for signature" },
  { h2: "Before you start" },
  { steps: [
    "Sign in at " + URL + " with your email and temporary password; change your password.",
    "Register your signature (draw or upload). This is required before your first request — you can defer it, but you’ll be asked again."
  ] },
  { img: "10-requestor-home", w: 560, caption: "Your Requestor home — quick actions and your requests at a glance." },
  { h2: "Make a new request" },
  { steps: [
    "Click **New request** and upload your document — a **PDF or Excel** file, up to **14 MB**.",
    "Choose how it should be approved: **Single approver** (any approver from one team) or **Multi-step workflow** (specific signers, in a set order).",
    "Optionally tick **Instant approval** to skip the one-hour cooling window.",
    "Place the signature box on the document and pick the team / signers (see below).",
    "Add an optional note and **submit**. Each signer is notified in turn."
  ] },
  { img: "11-requestor-new-request", w: 560, caption: "Starting a new request: choose a type, then upload your PDF or Excel." },
  { h3: "Single-approver mode" },
  { bullets: [
    "Click on the document where the signature should appear to drop one signature box.",
    "Pick the team — the request goes to any approver with authority for that team."
  ] },
  { h3: "Multi-step workflow mode" },
  { bullets: [
    "Add a step, pick the team, then **Add signer**.",
    "Click **Place signature** and drag a box on the relevant page for that signer.",
    "Repeat per signer / per step. Cross-team workflows are supported — signers are asked in order."
  ] },
  { h2: "Track your requests" },
  { bullets: [
    "**Pending** — see exactly who the request is waiting on. You can send a reminder once every 24 hours.",
    "**Approved** — preview or download the signed file.",
    "**Rejected** — see the reason given, then correct and resubmit."
  ] },
  { note: "Tip: name your files clearly before uploading — the file name is what approvers and the audit log show." }
]]);

// ---- 4. Approver guide ----
docs.push(["SignFlow-Approver-Guide", "Approver Guide", [
  { title: "SignFlow — Approver Guide", subtitle: "Reviewing and signing documents" },
  { h2: "Before you start" },
  { steps: [
    "Sign in at " + URL + " and change your password.",
    "Register your signature (draw or upload) — it’s stamped onto documents when you approve."
  ] },
  { h2: "Your home screen" },
  { p: "You’ll see four areas: **Pending approvals**, **Approved**, **Rejected**, and **Signing authority** (the teams that have granted you the right to sign)." },
  { img: "20-approver-home", w: 560, caption: "The Approver home — pending approvals, history, and your signing authority." },
  { h2: "Review & sign" },
  { steps: [
    "Open a pending request and review the document.",
    "Check the **workflow chain** — who has already signed and who is next.",
    "If it’s your turn, your slot is highlighted **“YOU SIGN HERE.”** Click **Approve & sign** to stamp your signature, or **Reject** with a reason.",
    "If it’s not your turn yet, you’ll see “Awaiting signature from [Name]” and the document is view-only until it reaches you."
  ] },
  { img: "21-approver-pending", w: 560, caption: "Open a pending request to review the document and sign when it is your turn." },
  { h2: "The one-hour window" },
  { p: "For standard (non-instant) approvals, you have **one hour** to withdraw your approval while the status shows **“Approved · 1h window.”** After the hour passes — or immediately, when Instant Approval was set — your signature is locked in." },
  { h2: "When everyone has signed" },
  { p: "Once all signers complete, the request is finalised: the requestor is emailed automatically and the signed PDF becomes downloadable. Every action is time-stamped for the audit trail." },
  { note: "Reject early if something is wrong — a clear reason helps the requestor fix and resubmit quickly." }
]]);

// ---- 5. Administrator guide ----
docs.push(["SignFlow-Administrator-Guide", "Administrator Guide", [
  { title: "SignFlow — Administrator Guide", subtitle: "Running SignFlow for your organisation" },
  { p: "The admin console gives you everything needed to run SignFlow. Sign in with an administrator account to see these modules. For the step-by-step rollout (creating teams and users), use the companion **IT Onboarding Playbook**." },
  { img: "30-admin-console", w: 580, caption: "The Administrator console — every module in one place." },
  { h2: "Users" },
  { bullets: [
    "Add users individually (3-step wizard) or in **bulk** by department.",
    "Set each person’s role — **Administrator / Requestor / Approver** — and assign a team or signing authority.",
    "Delete users when needed: their name shows as “—” in past requests, but document history is preserved."
  ] },
  { h2: "Teams & authority" },
  { bullets: [
    "Create or remove teams (business functions such as Finance, Operations, IT).",
    "View and edit who can sign for each team — this controls where requests are routed."
  ] },
  { h2: "Signatures" },
  { bullets: [
    "Upload a signature image on behalf of any user.",
    "**Bulk-upload** signatures by naming each file with the user’s email (e.g., `jane@hqhb.in.png`) — SignFlow matches them automatically."
  ] },
  { h2: "All documents" },
  { bullets: [
    "See every request across the company, filterable by status (All / Pending / Approved / Rejected).",
    "Download originals or signed copies for any audit."
  ] },
  { h2: "Reports" },
  { bullets: [
    "Team-wise totals — pending, approved, rejected.",
    "A top-approvers leaderboard.",
    "Full **CSV export** of the complete request history."
  ] },
  { h2: "Email log" },
  { p: "Audit every notification SignFlow has sent — invitations, approvals, reminders, and password resets — with delivery status." },
  { h2: "Helping users with access" },
  { bullets: [
    "Re-send an invite or reset a password from the **Users** page; a fresh temporary password is generated.",
    "Users can also self-serve via **Forgot password?** on the login screen."
  ] },
  { note: "Most day-to-day admin work is onboarding people. Keep the **IT Onboarding Playbook** handy for the first few weeks." }
]]);

// ---- 6. IT onboarding playbook & intake ----
docs.push(["SignFlow-IT-Onboarding-Playbook", "Onboarding Playbook", [
  { title: "SignFlow — IT Onboarding Playbook", subtitle: "Set up teams, create users, and get everyone signed in" },
  { h2: "Step 0 — Create your teams first" },
  { p: "SignFlow organises people into **teams** (business functions). Create these before adding users: **Admin → Teams & authority → Add team** (e.g., Finance, Operations, IT, HR, Management)." },
  { bullets: [
    "**Requestors** are assigned to one team (their department).",
    "**Approvers** are granted **signing authority** over one or more teams."
  ] },
  { h2: "The three roles" },
  { table: { head: ["Role", "What they do", "Who gets it"], widths: [1900, 4660, 2800], rows: [
    ["Requestor", "Submits documents for signature; downloads signed copies", "Most staff"],
    ["Approver", "Reviews and signs documents routed to them", "Managers, Finance, authorised signatories"],
    ["Administrator", "Full control of users, teams, signatures, reports", "IT only"]
  ] } },
  { h2: "Details to capture from each user" },
  { p: "Collect this for every person before creating accounts. It doubles as your bulk-import sheet." },
  { table: { head: ["Field", "Required?", "Notes"], widths: [2400, 1700, 5260], rows: [
    ["Full name", "Yes", "As it should appear on signatures and records"],
    ["Work email", "Yes", "This is their login — must be unique"],
    ["Role", "Yes", "Requestor / Approver / Administrator"],
    ["Department (team)", "Yes (Requestors)", "Which business function they belong to"],
    ["Signing authority", "Yes (Approvers)", "Which team(s) they may sign for"],
    ["Signature image", "Optional", "They can register it themselves on first login"]
  ] } },
  { h2: "Creating users — two ways" },
  { h3: "A. By department, in bulk (recommended for rollout)" },
  { steps: [
    "**Admin → Onboard team.**",
    "Pick or create the team (department).",
    "Upload a spreadsheet of members — columns **name, email** (optional **role**; defaults to Requestor).",
    "Review the parsed rows; adjust each person’s role and tick signing authority where needed.",
    "Create the accounts — and email everyone their credentials in one click."
  ] },
  { p: "Everyone in the upload is auto-assigned to that team, so you don’t need team IDs. A CSV you can start from:" },
  { code: ["name,email,role", "Jane Doe,jane.doe@hqhb.in,requestor", "Moiz Khan,moiz.khan@hqhb.in,approver"] },
  { img: "31-admin-onboard", w: 580, caption: "Onboard team — pick or create a team, then upload the member list." },
  { h3: "B. One person at a time" },
  { steps: [
    "**Admin → Users → Add user.**",
    "**Identity** — Full name, Work email, Initial password (at least 6 characters; they change it later).",
    "**Role & assignment** — choose the role, then the department (Requestor) or tick signing-authority teams (Approver). Admins need no assignment.",
    "**Confirm → Create user.**",
    "**Share the credentials** — this path does not auto-email; send the user their email and temporary password."
  ] },
  { h2: "What each user does on first login" },
  { steps: [
    "Go to " + URL,
    "Sign in with their email and temporary password.",
    "Change their password.",
    "Register their signature — draw it or upload an image (one-time).",
    "They’re ready to submit or sign documents."
  ] },
  { h2: "Optional — pre-load signatures" },
  { p: "**Admin → Signatures** → bulk-upload images named `<email>.png` (or `.jpg`). SignFlow matches each image to the user by email automatically, so they can skip the first-login signature step." },
  { h2: "Suggested rollout order" },
  { steps: [
    "Create teams.",
    "Add the IT administrator account(s).",
    "Onboard each department in bulk — set approvers and signing authority as you go.",
    "(Optional) Pre-load signatures.",
    "Send the announcement email.",
    "Keep it@hqhb.in / taha.chunawala@hqhb.in ready for first-week questions."
  ] }
]]);

// ---- 7. FAQ ----
const faq = [
  ["What is SignFlow?", "HQHB’s digital signature and approval system. You submit documents for signature, route them to the right approver(s), and get a signed, fully audited copy back — all online."],
  ["Do I need to install anything?", "No. SignFlow runs in your web browser. Just go to " + URL + "."],
  ["How do I get an account?", "IT creates it for you. You’ll receive a login email and a temporary password; change the password and register your signature on first sign-in."],
  ["What file types and sizes are supported?", "PDF or Excel documents, up to 14 MB each."],
  ["How do I sign a document?", "Register your signature once (draw or upload). After that, open a pending request and click Approve & sign — your signature is stamped onto the document."],
  ["What is the one-hour window?", "For standard approvals you can withdraw your approval within one hour. Set Instant approval on a request to finalise immediately and skip the wait."],
  ["Can a document need several signers in a specific order?", "Yes. Choose Multi-step workflow when creating the request, add the signers, and they’ll be asked to sign in the order you set — even across teams."],
  ["I forgot my password.", "Use Forgot password? on the login screen to get a reset by email, or contact IT and we’ll issue a new temporary password."],
  ["Is it secure and audit-ready?", "Yes. Access is role-based, every action is time-stamped, and admins can export a full audit trail. Signed PDFs preserve the complete approval history."],
  ["Who do I contact for help?", "IT at it@hqhb.in, or taha.chunawala@hqhb.in."]
];
docs.push(["SignFlow-FAQ", "FAQ", [
  { title: "SignFlow — Frequently Asked Questions", subtitle: "Quick answers for everyone" },
  ...faq.flatMap(([q, a]) => [{ h3: q }, { p: a }])
]]);

// ---- 8. Bulk onboarding guide (~250 users) ----
docs.push(["SignFlow-Bulk-Onboarding-Guide", "Bulk Onboarding", [
  { title: "SignFlow — Bulk Onboarding Guide", subtitle: "Onboard your whole organisation (≈250 users) efficiently" },
  { p: "For a large rollout, do **not** add people one at a time. SignFlow onboards a whole department from a spreadsheet and emails everyone their login in one step. This guide takes you from an empty system to ~250 signed-in users." },
  { h2: "Two prerequisites — sort these first" },
  { steps: [
    "**Email delivery (SendGrid).** SignFlow emails each new user their temporary password and sign-in link. For a bulk rollout this must be switched on at the server. If it is off, invitations are only recorded (not sent) and you would have to hand out 250 passwords manually. Confirm with IT that email delivery is live before you begin.",
    "**Your teams.** Create every department first — Admin → Teams & authority → Add team. Users are onboarded one team at a time."
  ] },
  { h2: "Step 1 — Build your master roster" },
  { p: "Capture every person once, in a single sheet. Use the roster template (SignFlow-User-Roster-Template.csv)." },
  { table: { head: ["Column", "Notes"], widths: [3000, 6360], rows: [
    ["Name", "As it should appear on signatures and records"],
    ["Work email", "Their login — must be unique"],
    ["Role", "requestor (most staff) or approver (authorised signatories)"],
    ["Department", "Which team they belong to / are onboarded under"],
    ["Signs for (extra teams)", "Approvers only — any teams beyond their own they may sign for"]
  ] } },
  { h2: "Step 2 — Split the roster by department" },
  { p: "SignFlow imports one team at a time, and everyone in an upload is assigned to that team. From your master roster, make one upload file per department with just three columns — **name, email, role** (role is optional and defaults to requestor; use “approver” where needed). See SignFlow-team-upload-example.csv, or click **Download template** on the Onboard-team screen for the exact format." },
  { h2: "Step 3 — Onboard each department" },
  { img: "31-admin-onboard", w: 560, caption: "Onboard team — pick or create the team, then upload that department’s file." },
  { steps: [
    "Admin → **Onboard team**.",
    "Pick the department (or create it).",
    "Upload that department’s file (.xlsx or .csv).",
    "Review the parsed rows — flag who is an **Approver** and fix any names/emails.",
    "Keep **Send invitations** ticked, then **Create**. Everyone is created and emailed their login in one go."
  ] },
  { note: "Repeat per department. A batch of 30–50 people imports in under a minute; split very large single teams into batches of ~100." },
  { h2: "Step 4 — Approvers who sign for multiple teams" },
  { p: "Onboarding grants an approver authority over the one team you uploaded them under. For any additional teams they must sign for, add them in **Admin → Teams & authority → grant authority**." },
  { h2: "Step 5 — (Optional) Pre-load signatures" },
  { p: "Save each person’s signature image named by their email (e.g., `jane.doe@hqhb.in.png`). Then **Admin → Signatures → bulk-upload** — up to 200 files per batch, 2 MB each (so two batches for 250). SignFlow matches each image by email, skipping everyone’s first-login signature step." },
  { h2: "Step 6 — Verify" },
  { bullets: [
    "**Admin → Users** — confirm the count (~250) and the roles look right.",
    "**Admin → Email log** — confirm the invitations were delivered.",
    "Spot-check one or two accounts by signing in."
  ] },
  { h2: "What each user receives" },
  { p: "A welcome email with their email address, a temporary password, and the link (" + URL + "). On first sign-in they change the password and register their signature." },
  { h2: "Troubleshooting" },
  { table: { head: ["Symptom", "Fix"], widths: [3400, 5960], rows: [
    ["A row didn’t import", "Duplicate email (already a user — skipped) or missing name/valid email. Fix that row and re-upload just that person; re-running is safe."],
    ["Invitations not arriving", "Email delivery (SendGrid) is likely off or the sender isn’t verified. Once live, resend via Users → invite (or bulk-invite)."],
    ["Wrong department", "Admin → Teams & authority — reassign a requestor’s team, or grant/adjust an approver’s authority."],
    ["Approver not appearing in workflows", "They have no signing authority yet — grant it in Teams & authority."]
  ] } },
  { h2: "Rollout checklist" },
  { steps: [
    "Email delivery (SendGrid) confirmed live.",
    "All departments created.",
    "Master roster complete (~250).",
    "Per-department upload files prepared.",
    "Each department onboarded, with invitations sent.",
    "Extra signing authority granted to multi-team approvers.",
    "(Optional) Signatures pre-loaded.",
    "User count and Email log verified.",
    "Announcement email sent."
  ] }
]]);

// ============================ WRITE ============================
(async () => {
  for (const [file, shortTitle, blocks] of docs) {
    const buf = await Packer.toBuffer(buildDoc(shortTitle, blocks));
    fs.writeFileSync(path.join(OUT, file + ".docx"), buf);
    console.log("wrote", file + ".docx", "(" + buf.length + " bytes)");
  }
  console.log("DONE:", docs.length, "documents");
})();
