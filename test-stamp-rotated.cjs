// Stamp a signature with a non-zero rotation and render the result so we can
// inspect whether the signature lands upright at the chosen viewing rotation.
const fs = require("fs");
const path = require("path");

(async () => {
  const { stampPdfMulti } = await import("./server/src/pdf.js");

  const docDir = "D:/OneSign/server/uploads/documents";
  const docs = fs.readdirSync(docDir).filter(f => f.endsWith(".pdf"))
    .map(f => ({ f, m: fs.statSync(path.join(docDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  const srcPath = path.join(docDir, docs[0].f);

  const sigDir = "D:/OneSign/server/uploads/signatures";
  const sigs = fs.readdirSync(sigDir).filter(f => /\.(png|jpg|jpeg)$/i.test(f) && !f.startsWith("."))
    .map(f => ({ f, m: fs.statSync(path.join(sigDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  const sigPath = path.join(sigDir, sigs[0].f);

  // Place a marker that was drawn at 270° viewing rotation. viewportToMediabox(270)
  // would have produced these coords for a wide-short box on the rotated canvas.
  // case 270: { x: 100 - vy - vh, y: vx, w: vh, h: vw }
  // For viewport (20, 60, 25, 8): { x: 32, y: 20, w: 8, h: 25 }
  const outName = "test-rotated-stamp.pdf";
  await stampPdfMulti({
    srcPath,
    stamps: [
      { signaturePath: sigPath, page: 1, x: 32, y: 20, w: 8, h: 25, rotation: 270, signerName: "Rotated Test", signedAt: Date.now() }
    ],
    outName
  });

  const outPath = path.join("D:/OneSign/server/uploads/signed", outName);
  fs.copyFileSync(outPath, "D:/OneSign/rotated-preview.pdf");
  console.log("Stamped (rot=270):", srcPath, "→", "D:/OneSign/rotated-preview.pdf");
})();
