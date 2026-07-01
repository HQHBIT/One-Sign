// Builds SignFlow-Handbook.pdf: a branded cover + a "What's New" section + all
// guide PDFs. Also writes the standalone SignFlow-Whats-New.pdf.
// (The What's New section is rendered with pdf-lib so the handbook can be rebuilt
//  without the Word/docx→PDF toolchain.)
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const navy = rgb(0.059, 0.102, 0.180), gold = rgb(0.722, 0.537, 0.290), grey = rgb(0.353, 0.392, 0.447), cream = rgb(0.957, 0.945, 0.910), ink = rgb(0.18, 0.22, 0.28);

const order = [
  ["Quick-Start", "SignFlow-Quick-Start"],
  ["Requestor Guide", "SignFlow-Requestor-Guide"],
  ["Approver Guide", "SignFlow-Approver-Guide"],
  ["Administrator Guide", "SignFlow-Administrator-Guide"],
  ["IT Onboarding Playbook", "SignFlow-IT-Onboarding-Playbook"],
  ["Bulk Onboarding Guide (250 users)", "SignFlow-Bulk-Onboarding-Guide"],
  ["FAQ", "SignFlow-FAQ"]
];

const W = 612, H = 792, MX = 56;

// All text is WinAnsi-safe (no arrows / curly quotes) so StandardFonts can render it.
const whatsNew = {
  title: "What's New in SignFlow",
  subtitle: "Two new ways to get people in - and to get documents signed.",
  sections: [
    { h: "1.  Self-registration (with IT approval)", bullets: [
      'New users can request an account themselves from the login screen: click "Create an account" and enter their name, email, password, team, and reporting manager.',
      "The request goes to IT under Admin > Registrations, which shows a pending count.",
      "IT approves (the person becomes a Requestor and signs in with the password they chose) or rejects with a reason.",
      "No one can sign in until approved - the approval is the gate. After approving, set their real role and team under Users."
    ] },
    { h: "2.  Send a signature request to a specific person", bullets: [
      'When making a request, choose the new "Send to a specific person" mode (PDF documents).',
      "Search the directory by name or email and pick anyone - regardless of team or role.",
      "Place their signature box and submit; the recipient is notified by email.",
      'The recipient sees it under "Awaiting your signature" on their home screen and signs with the same Review-and-sign screen approvers use - even a plain Requestor can sign what is sent directly to them.'
    ] }
  ],
  footer: "Together: someone self-registers, IT approves them, and they become instantly searchable by email for a direct signature request."
};

function wrap(text, font, size, maxW) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const trial = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(trial, size) > maxW && line) { lines.push(line); line = w; }
    else line = trial;
  }
  if (line) lines.push(line);
  return lines;
}

// Render the What's New section into `doc`. Returns the page count it added.
function renderWhatsNew(doc, helv, helvB) {
  const contentW = W - MX * 2;
  let page = doc.addPage([W, H]);
  let y = H - 76;
  const start = doc.getPageCount();
  const room = (need) => { if (y - need < 64) { page = doc.addPage([W, H]); y = H - 72; } };

  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: gold });
  page.drawText("HQHB . SignFlow", { x: MX, y: H - 44, size: 11, font: helvB, color: gold });
  page.drawText(whatsNew.title, { x: MX, y: H - 76, size: 26, font: helvB, color: navy });
  y = H - 100;
  for (const l of wrap(whatsNew.subtitle, helv, 12, contentW)) { page.drawText(l, { x: MX, y, size: 12, font: helv, color: grey }); y -= 17; }
  y -= 6;
  page.drawRectangle({ x: MX, y, width: contentW, height: 1, color: rgb(0.85, 0.82, 0.74) }); y -= 24;

  for (const sec of whatsNew.sections) {
    room(40);
    page.drawText(sec.h, { x: MX, y, size: 14, font: helvB, color: navy }); y -= 22;
    for (const b of sec.bullets) {
      const lines = wrap(b, helv, 11, contentW - 18);
      room(lines.length * 15 + 6);
      page.drawText("-", { x: MX + 2, y, size: 11, font: helvB, color: gold });
      for (let i = 0; i < lines.length; i++) { page.drawText(lines[i], { x: MX + 18, y, size: 11, font: helv, color: ink }); y -= 15; }
      y -= 5;
    }
    y -= 12;
  }
  room(40);
  page.drawRectangle({ x: MX, y: y + 8, width: contentW, height: 1, color: rgb(0.85, 0.82, 0.74) }); y -= 8;
  for (const l of wrap(whatsNew.footer, helvB, 11, contentW)) { page.drawText(l, { x: MX, y, size: 11, font: helvB, color: navy }); y -= 15; }
  return doc.getPageCount() - start + 1;
}

const out = await PDFDocument.create();
const helv = await out.embedFont(StandardFonts.Helvetica);
const helvB = await out.embedFont(StandardFonts.HelveticaBold);

// ---- cover page (US Letter) ----
const cov = out.addPage([W, H]);
cov.drawRectangle({ x: 0, y: 0, width: W, height: H, color: cream });
cov.drawRectangle({ x: 0, y: H - 250, width: W, height: 250, color: navy });
cov.drawText("HQHB . SignFlow", { x: MX, y: H - 96, size: 15, font: helvB, color: gold });
cov.drawText("SignFlow Handbook", { x: MX, y: H - 150, size: 32, font: helvB, color: rgb(1, 1, 1) });
cov.drawText("Everything your team needs to start signing.", { x: MX, y: H - 184, size: 13, font: helv, color: rgb(0.88, 0.86, 0.80) });
cov.drawText("Contents", { x: MX, y: H - 320, size: 17, font: helvB, color: navy });
let cy = H - 352;
const contents = ["What's New", ...order.map(([l]) => l)];
contents.forEach((label, i) => {
  cov.drawText(String(i + 1) + ".", { x: 60, y: cy, size: 12, font: helvB, color: gold });
  cov.drawText(label, { x: 82, y: cy, size: 12, font: helv, color: ink });
  cy -= 26;
});
cov.drawRectangle({ x: MX, y: 66, width: W - MX * 2, height: 1, color: rgb(0.85, 0.82, 0.74) });
cov.drawText("onesign.devhqhb.online", { x: MX, y: 50, size: 10, font: helv, color: grey });
const sup = "Support: it@hqhb.in  .  taha.chunawala@hqhb.in";
cov.drawText(sup, { x: W - MX - helv.widthOfTextAtSize(sup, 10), y: 50, size: 10, font: helv, color: grey });

// ---- What's New section ----
renderWhatsNew(out, helv, helvB);

// ---- append each guide ----
for (const [, file] of order) {
  const bytes = fs.readFileSync(path.join(DIR, file + ".pdf"));
  const src = await PDFDocument.load(bytes);
  const pages = await out.copyPages(src, src.getPageIndices());
  pages.forEach(p => out.addPage(p));
}

fs.writeFileSync(path.join(DIR, "SignFlow-Handbook.pdf"), await out.save());
console.log("SignFlow-Handbook.pdf written:", out.getPageCount(), "pages");

// ---- standalone What's New ----
const wn = await PDFDocument.create();
const wh = await wn.embedFont(StandardFonts.Helvetica);
const whB = await wn.embedFont(StandardFonts.HelveticaBold);
renderWhatsNew(wn, wh, whB);
fs.writeFileSync(path.join(DIR, "SignFlow-Whats-New.pdf"), await wn.save());
console.log("SignFlow-Whats-New.pdf written:", wn.getPageCount(), "pages");
