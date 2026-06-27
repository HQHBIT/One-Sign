// Builds SignFlow-Handbook.pdf: a branded cover + contents, then all guide PDFs.
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const navy = rgb(0.059, 0.102, 0.180), gold = rgb(0.722, 0.537, 0.290), grey = rgb(0.353, 0.392, 0.447), cream = rgb(0.957, 0.945, 0.910);

const order = [
  ["Quick-Start", "SignFlow-Quick-Start"],
  ["Requestor Guide", "SignFlow-Requestor-Guide"],
  ["Approver Guide", "SignFlow-Approver-Guide"],
  ["Administrator Guide", "SignFlow-Administrator-Guide"],
  ["IT Onboarding Playbook", "SignFlow-IT-Onboarding-Playbook"],
  ["FAQ", "SignFlow-FAQ"]
];

const out = await PDFDocument.create();
const helv = await out.embedFont(StandardFonts.Helvetica);
const helvB = await out.embedFont(StandardFonts.HelveticaBold);

// ---- cover page (US Letter) ----
const W = 612, H = 792;
const cov = out.addPage([W, H]);
cov.drawRectangle({ x: 0, y: 0, width: W, height: H, color: cream });
cov.drawRectangle({ x: 0, y: H - 250, width: W, height: 250, color: navy });
cov.drawText("HQHB · SignFlow", { x: 56, y: H - 96, size: 15, font: helvB, color: gold });
cov.drawText("SignFlow Handbook", { x: 56, y: H - 150, size: 32, font: helvB, color: rgb(1, 1, 1) });
cov.drawText("Everything your team needs to start signing.", { x: 56, y: H - 184, size: 13, font: helv, color: rgb(0.88, 0.86, 0.80) });
cov.drawText("Contents", { x: 56, y: H - 320, size: 17, font: helvB, color: navy });
let y = H - 352;
order.forEach(([label], i) => {
  cov.drawText(String(i + 1) + ".", { x: 60, y, size: 12, font: helvB, color: gold });
  cov.drawText(label, { x: 82, y, size: 12, font: helv, color: rgb(0.18, 0.22, 0.28) });
  y -= 26;
});
cov.drawRectangle({ x: 56, y: 66, width: W - 112, height: 1, color: rgb(0.85, 0.82, 0.74) });
cov.drawText("onesign.devhqhb.online", { x: 56, y: 50, size: 10, font: helv, color: grey });
cov.drawText("Support: it@hqhb.in  ·  taha.chunawala@hqhb.in", { x: W - 56 - helv.widthOfTextAtSize("Support: it@hqhb.in  ·  taha.chunawala@hqhb.in", 10), y: 50, size: 10, font: helv, color: grey });

// ---- append each guide ----
let total = 1;
for (const [, file] of order) {
  const bytes = fs.readFileSync(path.join(DIR, file + ".pdf"));
  const src = await PDFDocument.load(bytes);
  const pages = await out.copyPages(src, src.getPageIndices());
  pages.forEach(p => out.addPage(p));
  total += pages.length;
}

fs.writeFileSync(path.join(DIR, "SignFlow-Handbook.pdf"), await out.save());
console.log("SignFlow-Handbook.pdf written:", total, "pages");
