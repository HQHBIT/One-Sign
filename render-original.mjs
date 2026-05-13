import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createCanvas } from "./client/node_modules/canvas/index.js";
import * as pdfjsLib from "./client/node_modules/pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STANDARD_FONTS = path.join(__dirname, "client", "node_modules", "pdfjs-dist", "standard_fonts") + path.sep;

const pdfPath = process.argv[2];
const outPath = process.argv[3] || "D:/OneSign/original-preview.png";

const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await pdfjsLib.getDocument({
  data,
  standardFontDataUrl: pathToFileURL(STANDARD_FONTS).href
}).promise;
const page = await doc.getPage(1);
console.log("pdfjs page.rotate =", page.rotate, "  view =", page.view);
const scale = 2;
const viewport = page.getViewport({ scale });
console.log("Default viewport dims (with page.rotate applied):", viewport.width, "x", viewport.height);

const canvas = createCanvas(viewport.width, viewport.height);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#FFFFFF";
ctx.fillRect(0, 0, viewport.width, viewport.height);
await page.render({
  canvasContext: ctx, viewport,
  canvasFactory: {
    create: (w, h) => { const c = createCanvas(w, h); return { canvas: c, context: c.getContext("2d") }; },
    reset: (cf, w, h) => { cf.canvas.width = w; cf.canvas.height = h; },
    destroy: () => {}
  }
}).promise;
fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
console.log("Wrote", outPath);
