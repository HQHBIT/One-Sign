// Simulate stamping on the user's actual uploaded leave form PDF, using the latest
// stampPdfMulti logic, then render the result to PNG so we can inspect it inline.
const fs = require("fs");
const path = require("path");

(async () => {
  const { stampPdfMulti } = await import("./server/src/pdf.js");

  // Pick the user's most recent uploaded leave form
  const docDir = "D:/OneSign/server/uploads/documents";
  const docs = fs.readdirSync(docDir).filter(f => f.endsWith(".pdf"))
    .map(f => ({ f, m: fs.statSync(path.join(docDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  const srcPath = path.join(docDir, docs[0].f);

  // Pick the user's most recent signature image
  const sigDir = "D:/OneSign/server/uploads/signatures";
  const sigs = fs.readdirSync(sigDir).filter(f => /\.(png|jpg|jpeg)$/i.test(f) && !f.startsWith("."))
    .map(f => ({ f, m: fs.statSync(path.join(sigDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  const sigPath = path.join(sigDir, sigs[0].f);

  // Stamp three signatures at sensible-looking positions on the page
  const outName = "test-user-stamp.pdf";
  await stampPdfMulti({
    srcPath,
    stamps: [
      { signaturePath: sigPath, page: 1, x: 22, y: 47, w: 20, h: 7, signerName: "Murtuza Tohfafarosh", signedAt: Date.now() },
      { signaturePath: sigPath, page: 1, x: 22, y: 67, w: 20, h: 7, signerName: "Huzaifa Mukkaram",     signedAt: Date.now() },
      { signaturePath: sigPath, page: 1, x: 8,  y: 90, w: 18, h: 7, signerName: "HR Verifier",          signedAt: Date.now() }
    ],
    outName
  });

  const outPath = path.join("D:/OneSign/server/uploads/signed", outName);
  fs.copyFileSync(outPath, "D:/OneSign/signature-preview.pdf");
  console.log("Stamped:", srcPath, "→", "D:/OneSign/signature-preview.pdf");
  console.log("Signature:", sigPath);
})();
