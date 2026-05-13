// Generates a self-contained preview PDF showing how a signature looks when stamped
// using SignFlow's professional signature block. Uses Arial TTF embedded directly
// so the PDF renders correctly anywhere (including our Node-based PNG renderer).
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("./server/node_modules/pdf-lib");
const fontkitMod = require("./node_modules/@pdf-lib/fontkit");
const fontkit = fontkitMod.default || fontkitMod;

(async () => {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const arialBytes = fs.readFileSync("C:/Windows/Fonts/arial.ttf");
  const arialBoldBytes = fs.readFileSync("C:/Windows/Fonts/arialbd.ttf");
  const font = await pdf.embedFont(arialBytes);
  const fontBold = await pdf.embedFont(arialBoldBytes);

  const page = pdf.addPage([612, 792]);

  // ---- Header
  page.drawText("HQHB · Internal Memorandum", { x: 60, y: 740, size: 18, font: fontBold, color: rgb(0.06, 0.1, 0.18) });
  page.drawText("Re: Annual Leave Request — Approval Required", { x: 60, y: 718, size: 10.5, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawLine({ start: { x: 60, y: 706 }, end: { x: 552, y: 706 }, thickness: 0.6, color: rgb(0.85, 0.85, 0.85) });

  // ---- Body
  const bodyLines = [
    "Date:        13 May 2026",
    "From:        Taha Bhai Chunawala (Business Analyst, Product Development)",
    "To:           Reporting Manager · Management Approval · HR",
    "",
    "I am requesting approval for annual leave from 28 May 2026 to 11 June 2026 (10",
    "working days). Work has been handed over to Mr. Moiz Barwani for the duration.",
    "Kindly approve below as appropriate."
  ];
  let by = 670;
  for (const ln of bodyLines) {
    page.drawText(ln, { x: 60, y: by, size: 10, font, color: rgb(0.15, 0.15, 0.15) });
    by -= 16;
  }

  // ---- Signature sections
  const sections = [
    { label: "Applicant's Signature",       name: "Taha Bhai Chunawala",         y: 470 },
    { label: "Reporting Manager Approval",  name: "Murtuza Mansoor Tohfafarosh", y: 340 },
    { label: "Management Approval (HR)",    name: "Mufaddal Safdari",            y: 210 }
  ];

  // Use latest signature
  const sigDir = path.join(__dirname, "server", "uploads", "signatures");
  const sigs = fs.readdirSync(sigDir)
    .filter(f => /\.(png|jpg|jpeg)$/i.test(f) && !f.startsWith("."))
    .map(f => ({ f, mtime: fs.statSync(path.join(sigDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const sigFile = sigs[0].f;
  const sigBytes = fs.readFileSync(path.join(sigDir, sigFile));
  let sigImg;
  try { sigImg = await pdf.embedPng(sigBytes); }
  catch { sigImg = await pdf.embedJpg(sigBytes); }

  const now = Date.now();
  const dateText = new Date(now).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  for (const sec of sections) {
    // Section label
    page.drawText(sec.label, { x: 60, y: sec.y + 78, size: 11, font: fontBold, color: rgb(0.06, 0.1, 0.18) });

    // Underlines for signature + date
    page.drawLine({ start: { x: 60, y: sec.y }, end: { x: 380, y: sec.y }, thickness: 0.7, color: rgb(0.3, 0.3, 0.3) });
    page.drawText("Signature", { x: 60, y: sec.y - 12, size: 8, font, color: rgb(0.55, 0.55, 0.55) });
    page.drawLine({ start: { x: 400, y: sec.y }, end: { x: 552, y: sec.y }, thickness: 0.7, color: rgb(0.3, 0.3, 0.3) });
    page.drawText("Date", { x: 400, y: sec.y - 12, size: 8, font, color: rgb(0.55, 0.55, 0.55) });

    // === Professional signature block ===
    const boxW = 200, boxH = 70;
    const boxX = 90, boxY = sec.y - 4;
    const captionFrac = 0.28;
    const captionH = captionFrac * boxH;
    const sigBoxY = boxY + captionH;
    const sigBoxH = boxH - captionH;

    const sigRatio = sigImg.width / sigImg.height;
    const sigBoxRatio = boxW / sigBoxH;
    let fitW, fitH;
    if (sigRatio > sigBoxRatio) { fitW = boxW; fitH = boxW / sigRatio; }
    else { fitH = sigBoxH; fitW = sigBoxH * sigRatio; }
    const fitX = boxX + (boxW - fitW) / 2;
    const fitY = sigBoxY + (sigBoxH - fitH) / 2;
    page.drawImage(sigImg, { x: fitX, y: fitY, width: fitW, height: fitH });

    page.drawLine({
      start: { x: boxX + 4, y: boxY + captionH },
      end:   { x: boxX + boxW - 4, y: boxY + captionH },
      thickness: 0.4, color: rgb(0.62, 0.62, 0.62)
    });

    const nameText = `Signed by ${sec.name}`;
    const nameSize = 8;
    const nameW = fontBold.widthOfTextAtSize(nameText, nameSize);
    page.drawText(nameText, {
      x: boxX + (boxW - nameW) / 2, y: boxY + captionH - nameSize - 2,
      size: nameSize, font: fontBold, color: rgb(0.15, 0.18, 0.27)
    });

    const dateSize = 6.5;
    const dateW = font.widthOfTextAtSize(dateText, dateSize);
    page.drawText(dateText, {
      x: boxX + (boxW - dateW) / 2, y: boxY + 3,
      size: dateSize, font, color: rgb(0.45, 0.45, 0.45)
    });

    page.drawText(new Date(now).toLocaleDateString("en-IN", { dateStyle: "medium" }),
      { x: 410, y: sec.y + 4, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
  }

  // Footer
  page.drawText("This document is electronically signed via HQHB · SignFlow.",
    { x: 60, y: 110, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
  page.drawText("Each signature block includes the signer's name and exact date and time of approval.",
    { x: 60, y: 98, size: 8, font, color: rgb(0.5, 0.5, 0.5) });

  const out = await pdf.save();
  const outPath = path.join(__dirname, "signature-preview.pdf");
  fs.writeFileSync(outPath, out);
  console.log("Wrote", outPath, `(${out.length} bytes)`, "using", sigFile);
})();
