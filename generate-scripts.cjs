const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, PageOrientation, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageBreak
} = require("docx");

const INK = "0F1A2E";
const GOLD = "B8894A";
const BG_GOLD = "F4E4C1";
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const cellBorders = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const para = (text, opts = {}) => new Paragraph({
  children: Array.isArray(text) ? text : [new TextRun(text)],
  spacing: { after: 80 }, ...opts
});
const bold = (text) => new TextRun({ text, bold: true });
const plain = (text) => new TextRun(text);
const small = (text) => new TextRun({ text, size: 18, color: "555555" });

function H1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true })],
    spacing: { before: 360, after: 220 }
  });
}
function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true })],
    spacing: { before: 280, after: 140 }
  });
}
function H3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true })],
    spacing: { before: 200, after: 100 }
  });
}

function headerCell(text, w) {
  return new TableCell({
    borders: cellBorders,
    width: { size: w, type: WidthType.DXA },
    shading: { fill: INK, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: [para([new TextRun({ text, bold: true, color: "FFFFFF", size: 18 })])]
  });
}
function bodyCell(text, w, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun({ text, size: 20 })];
  return new TableCell({
    borders: cellBorders,
    width: { size: w, type: WidthType.DXA },
    shading: opts.shade ? { fill: opts.shade, type: ShadingType.CLEAR } : undefined,
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: [para(runs)]
  });
}

// Column widths in DXA. Total = 9360 (US Letter content width with 1" margins)
const COLS = [900, 1100, 2900, 2280, 2180];
const COL_HEADERS = ["Scene", "Time", "Visual on screen", "Subtitle", "Voiceover"];

function sceneTable(scenes) {
  const headerRow = new TableRow({
    children: COL_HEADERS.map((h, i) => headerCell(h, COLS[i])),
    tableHeader: true
  });
  const bodyRows = scenes.map((s, i) => new TableRow({
    children: [
      bodyCell(String(i + 1), COLS[0], { shade: BG_GOLD }),
      bodyCell(s.time, COLS[1]),
      bodyCell(s.visual, COLS[2]),
      bodyCell(s.subtitle, COLS[3]),
      bodyCell(s.vo, COLS[4])
    ]
  }));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: COLS,
    rows: [headerRow, ...bodyRows]
  });
}

// =============================================================
// SCRIPTS
// =============================================================
const ADMIN_SCENES = [
  { time: "0:00–0:08", visual: "Logo splash — gold dot on cream backdrop, SignFlow wordmark fades in.",
    subtitle: "HQHB · SignFlow",
    vo: "SignFlow — the system of record for every signature, every approval, fully accountable." },
  { time: "0:08–0:18", visual: "Login screen, fill it@hqhb.in + password, click Continue. Cut to admin home.",
    subtitle: "Sign in as Administrator",
    vo: "Administrators control users, teams, and signing authority across the company." },
  { time: "0:18–0:32", visual: "Admin dashboard. Slow pan across the six tiles (Users, Teams, Signatures, Documents, Reports, Email log).",
    subtitle: "Six modules — everything you need to run SignFlow",
    vo: "Six modules cover everything the organisation needs — people, teams, signatures, documents, reports, and the email log." },
  { time: "0:32–0:46", visual: "Click Users → Add user. Fill Name, Email, Password (toggle eye to reveal). Pick Approver. Tick IT Team. Save.",
    subtitle: "Add an approver and grant signing authority",
    vo: "Create users in seconds, with role and team authority captured in one form." },
  { time: "0:46–0:58", visual: "Bulk upload CSV button → paste sample CSV with 3 rows → Import. Toast confirms.",
    subtitle: "Onboard whole departments via CSV",
    vo: "For large teams, bulk-upload from a spreadsheet imports everyone in one click." },
  { time: "0:58–1:12", visual: "Back. Open Teams & authority. Add a team. Highlight an existing team showing approvers + members.",
    subtitle: "Teams represent the business functions that own approval rights",
    vo: "Teams represent business functions — Finance, IT, Operations. Each team has its own list of signers." },
  { time: "1:12–1:26", visual: "Open Signatures tile. Two panels: Without signature / On file. Drag-drop bulk image upload — matched indicators light up.",
    subtitle: "Bulk-upload signatures · matched by email filename",
    vo: "Pre-load every user's signature on day one. Match-by-email automates the legwork." },
  { time: "1:26–1:40", visual: "All documents tile. Filter row (All / Pending / Approved / Rejected). Click Download on a finalised row.",
    subtitle: "Every document. Every status. Audit-ready.",
    vo: "The full document register — searchable, filterable, downloadable for any audit." },
  { time: "1:40–1:55", visual: "Reports tile. Team-wise totals table. Top approvers leaderboard. Click Download full CSV.",
    subtitle: "Team-wise reporting · one-click CSV export",
    vo: "Reports answer the leadership question — who has approved what, where are the bottlenecks." },
  { time: "1:55–2:08", visual: "SendGrid log. Scroll through entries. Click one. Modal shows the rendered email body.",
    subtitle: "Every notification archived and inspectable",
    vo: "Every email the system sends is logged here — proof of communication, every time." },
  { time: "2:08–2:22", visual: "Documents → open a multi-step request. Preview drawer shows workflow summary with done / active / pending statuses per signer.",
    subtitle: "Multi-step workflows · fully traceable",
    vo: "Admins see who's signed, who's pending, and exactly where any document sits in its approval chain." },
  { time: "2:22–2:38", visual: "Top-right Signature button. Modal shows the admin's own current signature with auto-crop note. Close.",
    subtitle: "Update your own signature anytime",
    vo: "Even the administrator can refresh their own signature without leaving the console." },
  { time: "2:38–2:50", visual: "Fade to logo on cream backdrop, gold tagline appears.",
    subtitle: "SignFlow · Administrator Console",
    vo: "SignFlow — sign every approval, audit every action." }
];

const REQUESTOR_SCENES = [
  { time: "0:00–0:08", visual: "Logo splash — gold dot on cream backdrop, SignFlow wordmark fades in.",
    subtitle: "HQHB · SignFlow",
    vo: "SignFlow makes raising documents for signature effortless." },
  { time: "0:08–0:18", visual: "Login screen, fill mufaddal.safdari@hqhb.in + password, click Continue.",
    subtitle: "Sign in as Requestor",
    vo: "Requestors are the people who submit documents for signature — everyone, from HR to operations." },
  { time: "0:18–0:32", visual: "First-login signature modal pops up. Switch Draw / Upload tabs. Draw a signature with cursor. Click Save signature.",
    subtitle: "First time? Register your signature.",
    vo: "Every requestor signs once — drawn or uploaded — and the system stores it for every future request." },
  { time: "0:32–0:44", visual: "Welcome dashboard. Three tiles: New request, Pending, Approved. Recent activity panel below.",
    subtitle: "Three actions · recent activity always in view",
    vo: "Your home shows what's new, what's waiting, and what's done." },
  { time: "0:44–0:58", visual: "Click New request. Drag-drop a PDF leave form into the upload zone. File card appears.",
    subtitle: "Step 1 — Upload PDF or Excel · up to 14 MB",
    vo: "Drop in a PDF or Excel file. Up to fourteen megabytes." },
  { time: "0:58–1:12", visual: "Approval flow section. Two tiles. Select Multi-step workflow. Tick Instant approval checkbox.",
    subtitle: "Single signer · or multi-step workflow · instant or 1-hour window",
    vo: "Pick a single approver, or build a chain of specific signers across teams. Instant approval skips the one-hour cooling window." },
  { time: "1:12–1:28", visual: "Step 1 added · choose Finance Team. Add signer Mufaddal Safdari. Click 'Place signature' → drag a tight box on the document's signature line.",
    subtitle: "Step 1 — Finance team approver, signature placed",
    vo: "Add a step, pick the team, then place each signer's signature box exactly where it belongs." },
  { time: "1:28–1:44", visual: "Step 2 added · choose IT Team · two signers added in order. Place each signature box on different lines. Resize one box by dragging the corner handle.",
    subtitle: "Step 2 — IT team, two signers in order · resizable",
    vo: "Within a step, signers approve in the order you list them. Drag any corner to resize until the box matches the signature line." },
  { time: "1:44–1:54", visual: "Click the Rotate button at top right. Document spins 90°, text becomes upright. Markers rotate with content.",
    subtitle: "Rotate the page to suit any layout",
    vo: "Rotate the document for comfortable viewing — markers stay anchored to the content." },
  { time: "1:54–2:08", visual: "Add an optional note. Click Submit request. Toast: 'Request submitted'. Cut to pending list — first row.",
    subtitle: "Submit — the first signer is notified instantly",
    vo: "Submit, and the first signer receives an email the same second." },
  { time: "2:08–2:24", visual: "Pending requests list. Row shows 'Step 1/2 · Finance Team · awaiting Mufaddal Safdari'. Click Remind. Toast: 'Reminder sent'.",
    subtitle: "Track every signer · 24-hour reminders",
    vo: "Watch each step move forward in real time, and nudge any signer with a reminder once a day." },
  { time: "2:24–2:38", visual: "Approved requests list. Click Download on a finalised row. Browser shows the downloaded signed PDF.",
    subtitle: "Download the signed PDF anytime",
    vo: "Once everyone signs, the final signed PDF is yours to download, share, or archive." },
  { time: "2:38–2:48", visual: "Rejected requests link. Open a rejected request. Reason text shows in red beneath the file.",
    subtitle: "Rejected? See the reason and resubmit.",
    vo: "If a request is rejected, the reason is captured plainly. Fix, and resubmit." },
  { time: "2:48–2:55", visual: "Fade to logo on cream backdrop, gold tagline appears.",
    subtitle: "SignFlow · Requestor Console",
    vo: "From upload to signed PDF — all in one place." }
];

const APPROVER_SCENES = [
  { time: "0:00–0:08", visual: "Logo splash — gold dot on cream backdrop, SignFlow wordmark fades in.",
    subtitle: "HQHB · SignFlow",
    vo: "Approvers review and sign the documents routed to them — quickly and accountably." },
  { time: "0:08–0:18", visual: "Login screen, fill moiz.barwani@hqhb.in + password, click Continue.",
    subtitle: "Sign in as Approver",
    vo: "Approvers are the people who put pen to paper — or in this case, click to sign." },
  { time: "0:18–0:32", visual: "First-login signature modal. Draw a signature with the cursor. Click Save signature. Toast: 'Signature saved'.",
    subtitle: "Register your signature once · auto-cropped on save",
    vo: "Like requestors, every approver registers a signature on first login. Drawn or uploaded — and auto-cropped so it always looks sharp." },
  { time: "0:32–0:46", visual: "Approver dashboard. Four tiles: Pending approvals, Approved, Rejected, Signing authority.",
    subtitle: "Pending · Approved · Rejected · Authority",
    vo: "The approver console shows exactly what's waiting on you, and what you've already actioned." },
  { time: "0:46–1:02", visual: "Pending approvals tile → list. A row reads 'Step 2 of 3 · IT Team · awaiting Moiz Barwani'. Click Review.",
    subtitle: "Documents routed by team and step order",
    vo: "Requests appear in your queue the moment it becomes your turn. Click Review to open." },
  { time: "1:02–1:18", visual: "Approve drawer opens. Workflow summary panel: step 1 done, step 2 active with your name. Doc preview shows multiple marker boxes — yours pulses gold 'YOU SIGN HERE'.",
    subtitle: "See who's signed. Your slot is highlighted.",
    vo: "You see the full chain — who's signed, who's next. Your signature box pulses so there's no mistaking where to land." },
  { time: "1:18–1:32", visual: "Click Approve & sign. Drawer closes. Status pill updates to 'Approved · 1h window'.",
    subtitle: "One click — your signature is stamped",
    vo: "One click stamps your signature at the marked spot. Your saved signature does all the work." },
  { time: "1:32–1:48", visual: "Reopen the same request. Bottom bar: 'You have until finalises in 58m to change your mind'. Withdraw and Reject with reason buttons.",
    subtitle: "One-hour grace window · withdraw or reject with reason",
    vo: "Approved by mistake? You have one hour to withdraw, or reject with a written reason — the requestor is notified immediately." },
  { time: "1:48–2:00", visual: "Show another row marked with the lightning icon. Status: Approved, no countdown.",
    subtitle: "Instant-approval requests skip the window",
    vo: "Some requests are marked instant — those finalise the moment the last signer approves." },
  { time: "2:00–2:14", visual: "Open a landscape PDF in approve drawer. Click Rotate button. Page spins; signature box stays anchored to the signature line.",
    subtitle: "Rotate the page · markers stay anchored",
    vo: "Rotate the document for easy reading. Signature placement is accurate at any angle." },
  { time: "2:14–2:28", visual: "Back. Signing authority tile. Cards show each team you sign for and how many docs you've approved for it.",
    subtitle: "Know exactly which teams you sign for",
    vo: "See at a glance which teams have granted you authority — and how many of their documents you've signed." },
  { time: "2:28–2:42", visual: "Approved tile → list of signed docs. Click Download on one row. Browser shows the downloaded file.",
    subtitle: "Download anything you've approved",
    vo: "Every document you've signed is available to download — useful for personal records or quick re-sharing." },
  { time: "2:42–2:50", visual: "Fade to logo on cream backdrop, gold tagline appears.",
    subtitle: "SignFlow · Approver Console",
    vo: "Approve fast. Stay accountable." }
];

// =============================================================
// PRODUCTION NOTES
// =============================================================
const PRODUCTION_NOTES = [
  ["Resolution", "1920×1080, 30 fps. Export H.264 .mp4 for the executive deck; H.265 if you want smaller files."],
  ["Aspect ratio", "16:9 throughout. No letter-boxing."],
  ["Subtitle font", "IBM Plex Sans or Inter, 32pt, lower-third placement. Ink colour 0F1A2E on a 95% opacity cream pill, gold (B8894A) underline accent."],
  ["Cursor", "Use CleanShot X, ScreenFlow, or Camtasia 'cursor highlight + click ring' so the viewer can follow the pointer."],
  ["Pacing", "Cross-dissolve transitions of 200ms between scenes. Hold each scene at least 6 seconds even if the action is faster — viewers need to read."],
  ["Voiceover", "Warm middle voice, conversational pace ~150 wpm. Record at 48 kHz mono. Quick noise reduction in DaVinci Resolve Fairlight or Audacity."],
  ["Music", "Single corporate-piano underbed at -22 LUFS so the VO sits at -16 LUFS. Subtle swell over the outro logo (last 6 seconds), then fade to silence."],
  ["Suggested tracks (royalty-free)",
    "YouTube Audio Library — “Reverie” (Audionautix) · Pixabay Music — “Inspiring Cinematic Ambient” by AlexiAction · Bensound — “Cinematic Documentary”. " +
    "If budget allows: Epidemic Sound “Glassy Stones” or Artlist “Sunday Morning”."],
  ["Recording app", "Loom Pro, Camtasia, or OBS Studio. For pixel-perfect captures, use a fresh Chrome window at 100% zoom, sized to 1920×1080 (Chrome devtools > device toolbar > custom size)."],
  ["Browser setup",
    "Hide bookmarks bar (Ctrl+Shift+B), full-screen (F11) only after navigating to localhost:5173. Clear notifications and Slack before recording."],
  ["Data prep",
    "Before recording, seed a couple of pending and approved requests so the dashboard isn't empty. Reset the demo each time with: stop dev server, drop & re-create signflow DB, restart."],
  ["Subtitle file",
    "Burn-in via editor, or attach a .srt/.vtt for accessibility. Each subtitle line max 42 characters."],
  ["Outro card",
    "Cream background (F5F1E8), HQHB SignFlow wordmark in IBM Plex Sans, gold tagline “Every signature. Every approval.”"]
];

function productionTable() {
  const colW = [2600, 6760];
  const head = new TableRow({
    children: [headerCell("Item", colW[0]), headerCell("Spec", colW[1])],
    tableHeader: true
  });
  const rows = PRODUCTION_NOTES.map(([k, v]) => new TableRow({
    children: [
      bodyCell([new TextRun({ text: k, bold: true, size: 20 })], colW[0]),
      bodyCell([new TextRun({ text: v, size: 20 })], colW[1])
    ]
  }));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colW,
    rows: [head, ...rows]
  });
}

// =============================================================
// DOCUMENT
// =============================================================
const doc = new Document({
  creator: "HQHB SignFlow",
  title: "SignFlow — Video Scripts",
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 52, bold: true, font: "Calibri", color: INK },
        paragraph: { spacing: { before: 0, after: 120 } } },
      { id: "Subtitle", name: "Subtitle", basedOn: "Normal", next: "Normal",
        run: { size: 24, italics: true, font: "Calibri", color: "6B7280" },
        paragraph: { spacing: { before: 0, after: 320 } } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Calibri", color: INK },
        paragraph: { spacing: { before: 360, after: 220 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Calibri", color: GOLD },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Calibri", color: INK },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 }
      }
    },
    children: [
      new Paragraph({ style: "Title", children: [new TextRun("SignFlow")] }),
      new Paragraph({ style: "Subtitle", children: [new TextRun("Executive video scripts — Administrator, Requestor, Approver")] }),

      para("Three videos, each under three minutes, designed for a CEO-level audience. Hand this document to whoever records and edits — every scene below has the visual, the on-screen subtitle, and the voiceover line, with timing locked."),
      para([small("Total runtime per video: 2 min 50 sec (Admin), 2 min 55 sec (Requestor), 2 min 50 sec (Approver). All under the 3-minute cap.")]),

      // --- Admin ---
      H1("Video 1 — Administrator Console"),
      para([bold("Total runtime: "), plain("2:50  ·  "), bold("Login: "), plain("it@hqhb.in  ·  "), bold("Goal: "), plain("show the admin's full operational reach in one minute and fifty seconds of demo, sandwiched by intro/outro.")]),
      sceneTable(ADMIN_SCENES),

      new Paragraph({ children: [new PageBreak()] }),

      // --- Requestor ---
      H1("Video 2 — Requestor Console"),
      para([bold("Total runtime: "), plain("2:55  ·  "), bold("Login: "), plain("mufaddal.safdari@hqhb.in  ·  "), bold("Goal: "), plain("show the end-to-end submission journey, with the workflow builder as the hero moment.")]),
      sceneTable(REQUESTOR_SCENES),

      new Paragraph({ children: [new PageBreak()] }),

      // --- Approver ---
      H1("Video 3 — Approver Console"),
      para([bold("Total runtime: "), plain("2:50  ·  "), bold("Login: "), plain("moiz.barwani@hqhb.in  ·  "), bold("Goal: "), plain("show the approver's daily reality — one-click sign, withdraw safety net, transparent workflow context.")]),
      sceneTable(APPROVER_SCENES),

      new Paragraph({ children: [new PageBreak()] }),

      // --- Production ---
      H1("Production notes (apply to all three videos)"),
      productionTable(),

      H2("Suggested shoot order"),
      para([bold("1. "), plain("Record voice-overs first. Lock the line readings, then trim each clip to its scene's duration.")]),
      para([bold("2. "), plain("Capture the screen takes second, matching the VO pacing. Move slowly — viewers need time to read subtitles.")]),
      para([bold("3. "), plain("Edit in DaVinci Resolve (free), Camtasia, or Premiere. Apply subtitles as text layers (not burned-in until final export) for easy revisions.")]),
      para([bold("4. "), plain("Lay the music underbed last, automate ducking under the VO, push a 2 dB swell on the outro logo.")]),

      H2("Deliverables"),
      para([bold("Per role: "), plain("one .mp4 (H.264, 1080p), one .srt subtitle sidecar, one thumbnail PNG at 1920×1080.")]),
      para([bold("Combined: "), plain("optional 'all three' supercut for the broader town-hall — same scripts, no intro/outro repetition between segments.")])
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  const out = "D:/OneSign/SignFlow-Video-Scripts.docx";
  fs.writeFileSync(out, buf);
  console.log("Wrote", out, "(", buf.length, "bytes )");
});
