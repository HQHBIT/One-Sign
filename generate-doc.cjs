const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, PageOrientation, BorderStyle
} = require("docx");

const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [new TextRun({ text, bold: true })],
  spacing: { before: 360, after: 200 }
});

const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text, bold: true })],
  spacing: { before: 280, after: 140 }
});

const P = (runs, opts = {}) => new Paragraph({
  children: Array.isArray(runs) ? runs : [new TextRun(runs)],
  spacing: { after: 120 },
  ...opts
});

const N = (text, level = 0) => new Paragraph({
  numbering: { reference: "numbers", level },
  children: [new TextRun(text)],
  spacing: { after: 80 }
});

const B = (text, level = 0) => new Paragraph({
  numbering: { reference: "bullets", level },
  children: [new TextRun(text)],
  spacing: { after: 80 }
});

const NB = (parts, level = 0) => new Paragraph({
  numbering: { reference: "numbers", level },
  children: parts,
  spacing: { after: 80 }
});

const sub = (text) => new Paragraph({
  numbering: { reference: "bullets", level: 1 },
  children: [new TextRun(text)],
  spacing: { after: 60 }
});

const r = (text, opts = {}) => new Roundup(text, opts);
class Roundup { constructor(t, o) { this.t = t; this.o = o; } }

const bold = (text) => new TextRun({ text, bold: true });
const plain = (text) => new TextRun(text);

const doc = new Document({
  creator: "HQHB SignFlow",
  title: "SignFlow — User Journeys",
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Calibri", color: "0F1A2E" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Calibri", color: "B8894A" },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
      { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 52, bold: true, font: "Calibri", color: "0F1A2E" },
        paragraph: { spacing: { before: 0, after: 120 } } },
      { id: "Subtitle", name: "Subtitle", basedOn: "Normal", next: "Normal",
        run: { size: 24, italics: true, font: "Calibri", color: "6B7280" },
        paragraph: { spacing: { before: 0, after: 360 } } }
    ]
  },
  numbering: {
    config: [
      { reference: "numbers",
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.LOWER_LETTER, text: "%2.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } } }
        ] },
      { reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } } }
        ] }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children: [
      new Paragraph({ style: "Title", children: [new TextRun("HQHB SignFlow")] }),
      new Paragraph({ style: "Subtitle", children: [new TextRun("User journeys by role")] }),

      // Admin
      H1("Administrator"),
      N("Sign in with administrator credentials."),
      NB([bold("Users — "), plain("add users individually or via bulk-CSV upload. Set role (Admin / Requestor / Approver), assign a team or signing authority. Delete users as needed; their name is replaced by “—” in past requests, but document history is preserved.")]),
      NB([bold("Teams & authority — "), plain("create or remove teams; view who can sign for each.")]),
      NB([bold("Signatures — "), plain("upload signature images on behalf of any user, or bulk-upload by filename = email.")]),
      NB([bold("All documents — "), plain("see every request across the company; download originals or signed copies.")]),
      NB([bold("Reports — "), plain("team-wise totals (pending / approved / rejected), top-approvers leaderboard, full CSV export.")]),
      NB([bold("SendGrid log — "), plain("audit every email the system sent.")]),
      N("Sign out."),

      // Requestor
      H1("Requestor"),
      N("Sign in."),
      NB([bold("First time only — "), plain("register a signature (draw or upload). Can be deferred via “Sign out & do it later.”")]),
      N("Make a new request:"),
      sub("Upload a PDF or Excel file (≤ 14 MB)."),
      sub("Choose Single approver (any approver from one team) or Multi-step workflow (specific signers, in order)."),
      sub("Optionally tick Instant approval to skip the 1-hour cooling window."),
      sub("Single mode: click on the document to place one signature box, then pick the team."),
      sub("Workflow mode: add a step, pick a team, click “Add signer,” then “Place signature” and drag a box on the relevant page. Repeat per signer / step. Cross-team workflows are supported."),
      sub("Add an optional note and submit. Each signer is notified in turn."),
      NB([bold("Pending requests — "), plain("track who the request is waiting on. Send a reminder once every 24 hours.")]),
      NB([bold("Approved requests — "), plain("preview or download the signed file.")]),
      NB([bold("Rejected requests — "), plain("see the rejection reason.")]),
      N("Sign out."),

      // Approver
      H1("Approver"),
      N("Sign in."),
      NB([bold("First time only — "), plain("register a signature.")]),
      N("Home shows: Pending approvals, Approved, Rejected, and Signing authority (teams that have granted you authority)."),
      N("Open a pending request, review the document, and see the workflow chain (who has signed and who is next)."),
      NB([bold("If it is your turn — "), plain("your slot is highlighted “YOU SIGN HERE.” Click Approve & sign to stamp your signature, or Reject with a reason.")]),
      NB([bold("If it is not your turn — "), plain("“Awaiting signature from [Name] before it reaches you.” View-only.")]),
      NB([bold("After approval (non-instant) — "), plain("you have one hour to withdraw while the status is “Approved · 1h window.”")]),
      NB([bold("After all signers complete (or instantly, when Instant Approval is set) — "), plain("the request is finalised; the requestor is emailed and the signed PDF becomes downloadable.")]),
      N("Sign out."),

      // Lifecycle
      H1("Behind the scenes — workflow lifecycle"),
      N("Requestor submits the request. Step 1 becomes Active and the first signer is notified by email."),
      N("Each signer signs in order; their signature box is stamped onto the PDF immediately."),
      N("When the last signer of a step signs, the step is marked Done, the next step becomes Active, and its first signer is notified."),
      P("After the final signer signs:"),
      B("Instant approval ON: the status jumps straight to Approved and the document is finalised."),
      B("Instant approval OFF: the status becomes Approved (1h window) and the scheduler finalises it after one hour, unless an admin force-finalises it earlier."),

      // Roles & permissions summary
      H1("Roles & permissions at a glance"),
      B("Admin can manage users, teams, signatures, view all documents, run reports, and inspect the email log."),
      B("Requestor can upload documents, build single or multi-step workflows, send reminders, and download finalised files."),
      B("Approver can sign or reject requests assigned to them, withdraw an approval within the cooling window, and see the teams they have authority over."),

      // Definitions
      H1("Key terms"),
      NB([bold("Single approver — "), plain("any approver with authority over the chosen team can sign; whoever signs first claims the request.")]),
      NB([bold("Multi-step workflow — "), plain("an ordered chain of specific signers, optionally crossing multiple teams. Each signer places their own signature box on a chosen page.")]),
      NB([bold("Instant approval — "), plain("skips the 1-hour cooling window; the document is finalised the moment the last signer signs.")]),
      NB([bold("Cooling window — "), plain("a one-hour grace period after the last approval during which the approver may withdraw their signature.")])
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  const out = "D:/OneSign/SignFlow-User-Journeys.docx";
  fs.writeFileSync(out, buf);
  console.log("Wrote", out, "(", buf.length, "bytes )");
});
