// Unit: stampPdfMulti draws a `type:'date'` stamp alongside a signature stamp.
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { stampPdfMulti } from "../src/pdf.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const doc = await PDFDocument.create(); doc.addPage([600, 800]);
const srcPath = path.join(here, "_stampsrc.pdf");
fs.writeFileSync(srcPath, await doc.save());

const sigPath = path.join(here, "_stampsig.png");
fs.writeFileSync(sigPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"));

// signature + date together
const outName = "_stamp-date-test.signed.pdf";
const outPath = await stampPdfMulti({
  srcPath,
  stamps: [
    { signaturePath: sigPath, page: 1, x: 20, y: 20, w: 25, h: 8, signerName: "Test Signer", signedAt: Date.now() },
    { type: "date", text: "06/07/26", page: 1, x: 20, y: 40, w: 20, h: 5 }
  ],
  outName
});
const out = fs.readFileSync(outPath);
assert.equal((await PDFDocument.load(out)).getPageCount(), 1, "output is a valid 1-page PDF");

// date-only stamp (no signature) must also work — needs no signaturePath / embed
const outName2 = "_stamp-date-only.signed.pdf";
const outPath2 = await stampPdfMulti({
  srcPath,
  stamps: [{ type: "date", text: "06/07/26", page: 1, x: 10, y: 10, w: 20, h: 5 }],
  outName: outName2
});
assert.ok((await PDFDocument.load(fs.readFileSync(outPath2))).getPageCount() === 1, "date-only valid");

fs.unlinkSync(srcPath); fs.unlinkSync(sigPath);
try { fs.unlinkSync(outPath); } catch {}
try { fs.unlinkSync(outPath2); } catch {}
console.log("stampPdfMulti date: all tests passed");
