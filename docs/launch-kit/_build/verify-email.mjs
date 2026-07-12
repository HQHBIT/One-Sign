// Render an email HTML file with images pointed at the local Vite server, and
// screenshot it (desktop 620px + mobile 380px) so we can eyeball the layout.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.join(__dirname, "..");
const PUBLIC = path.join(__dirname, "..", "..", "..", "client", "public");
const SCRATCH = process.env.SCRATCH || path.join(__dirname, "_preview");
fs.mkdirSync(SCRATCH, { recursive: true });

const srcName = process.argv[2] || "SignFlow-Launch-Email-gold.html";
const tag = srcName.includes("purple") ? "purple" : "gold";
let html = fs.readFileSync(path.join(KIT, srcName), "utf8");
html = html.replaceAll("https://signflow.devhqhb.online", "http://localhost:5173");
const previewName = "_email_preview_" + tag + ".html";
fs.writeFileSync(path.join(PUBLIC, previewName), html);

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = "http://localhost:5173/" + previewName;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
const page = await browser.newPage();
const missing = [];
page.on("requestfailed", r => { if (/\.(png|jpg|jpeg)/i.test(r.url())) missing.push(r.url()); });
page.on("response", r => { if (/\.(png|jpg|jpeg)/i.test(r.url()) && r.status() >= 400) missing.push(r.status() + " " + r.url()); });

await page.setViewport({ width: 620, height: 1000, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: "networkidle2" });
await sleep(900);
await page.screenshot({ path: path.join(SCRATCH, "email-" + tag + "-desktop.png"), fullPage: true });
console.log("desktop shot ->", path.join(SCRATCH, "email-" + tag + "-desktop.png"));

await page.setViewport({ width: 380, height: 900, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: "networkidle2" });
await sleep(700);
await page.screenshot({ path: path.join(SCRATCH, "email-" + tag + "-mobile.png"), fullPage: true });
console.log("mobile shot ->", path.join(SCRATCH, "email-" + tag + "-mobile.png"));

await browser.close();
fs.rmSync(path.join(PUBLIC, previewName)); // don't leave the temp preview in public/
console.log(missing.length ? ("MISSING IMAGES:\n" + [...new Set(missing)].join("\n")) : "all images loaded OK");
