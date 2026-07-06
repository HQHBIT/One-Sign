import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { applySelfMarks } from "../src/pdf.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// minimal 1-page PDF
const doc = await PDFDocument.create(); doc.addPage([600, 800]);
const inputBytes = await doc.save();

// a tiny valid PNG signature on disk
const tmpSig = path.join(here, "_tmpsig.png");
fs.writeFileSync(tmpSig, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"));

// apply a date + a signature
const out = await applySelfMarks(inputBytes, [
  { type: "date", text: "04/07/26", page: 1, x: 20, y: 70, w: 25, h: 6 },
  { type: "signature", signaturePath: tmpSig, page: 1, x: 20, y: 80, w: 25, h: 8 }
]);

const reloaded = await PDFDocument.load(out);
assert.equal(reloaded.getPageCount(), 1, "page count preserved");
assert.ok(out.length > inputBytes.length, "stamps added content (output larger than input)");

// date-only (no signature) also works + needs no signaturePath
const dateOnly = await applySelfMarks(inputBytes, [{ type: "date", text: "04/07/26", page: 1, x: 10, y: 10, w: 20, h: 5 }]);
assert.ok((await PDFDocument.load(dateOnly)).getPageCount() === 1, "date-only valid");

fs.unlinkSync(tmpSig);
console.log("applySelfMarks: all tests passed");
