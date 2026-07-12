// Verify the hosted preview page WITH images by pointing the email copies'
// image URLs at the local Vite server (sandbox can't reach the live domain).
// Creates temp *_local files, screenshots, then deletes them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAIL = path.join(__dirname, "..", "..", "..", "client", "public", "email");
const SCRATCH = process.env.SCRATCH || __dirname;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sub = s => s.replaceAll("https://signflow.devhqhb.online", "http://localhost:5173");

// temp local-image copies
fs.writeFileSync(path.join(EMAIL, "_lg.html"), sub(fs.readFileSync(path.join(EMAIL, "gold.html"), "utf8")));
fs.writeFileSync(path.join(EMAIL, "_lp.html"), sub(fs.readFileSync(path.join(EMAIL, "purple.html"), "utf8")));
let prev = fs.readFileSync(path.join(EMAIL, "preview.html"), "utf8")
  .replaceAll("/email/gold.html", "/email/_lg.html")
  .replaceAll("/email/purple.html", "/email/_lp.html");
fs.writeFileSync(path.join(EMAIL, "_preview_local.html"), prev);

const URL = "http://localhost:5173/email/_preview_local.html";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
const page = await browser.newPage();
const bad = [];
page.on("requestfailed", r => { if (/\.(png|jpg|jpeg)/i.test(r.url())) bad.push("FAIL " + r.url()); });
page.on("response", r => { if (/\.(png|jpg|jpeg)/i.test(r.url()) && r.status() >= 400) bad.push(r.status() + " " + r.url()); });
try {
  await page.setViewport({ width: 1100, height: 950, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await sleep(1600);
  await page.screenshot({ path: path.join(SCRATCH, "preview-gold.png") });
  console.log("shot preview-gold");
  await page.evaluate(() => document.querySelector('#ver button[data-v=purple]').click());
  await sleep(400);
  await page.evaluate(() => document.querySelector('#wid button[data-w="380"]').click());
  await sleep(1600);
  await page.screenshot({ path: path.join(SCRATCH, "preview-purple-mobile.png") });
  console.log("shot preview-purple-mobile");
} finally {
  await browser.close();
  for (const f of ["_lg.html", "_lp.html", "_preview_local.html"]) fs.rmSync(path.join(EMAIL, f), { force: true });
  console.log(bad.length ? ("IMAGE ISSUES:\n" + [...new Set(bad)].join("\n")) : "all email images loaded OK");
}
