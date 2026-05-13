const fs = require("fs");
const { PDFDocument } = require("./server/node_modules/pdf-lib");

(async () => {
  const file = process.argv[2];
  if (!file) { console.error("usage: node inspect-pdf.cjs <path>"); process.exit(1); }
  const bytes = fs.readFileSync(file);
  const pdf = await PDFDocument.load(bytes);
  console.log("Pages:", pdf.getPageCount());
  pdf.getPages().forEach((p, i) => {
    const { width, height } = p.getSize();
    const rot = p.getRotation().angle;
    console.log(`Page ${i+1}: ${width}x${height}, /Rotate ${rot}, landscape=${width > height}`);
  });
})();
