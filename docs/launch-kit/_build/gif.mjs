import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, "tokens.json"), "utf8"));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP = "http://localhost:5173/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = 1100, H = 690;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const frames = [];
const cap = async () => { await sleep(700); const buf = await page.screenshot({ type: "png" }); const p = PNG.sync.read(Buffer.from(buf)); frames.push(p); console.log("frame", frames.length, p.width + "x" + p.height); };
async function authAs(token) {
  for (let i = 0; i < 4; i++) {
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(t => localStorage.setItem("sf_token", t), token);
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(2400);
    const txt = await page.evaluate(() => document.body.innerText || "");
    if (!/Use the credentials provided/i.test(txt)) return;
  }
}
async function clearAuth() { await page.goto(APP, { waitUntil: "networkidle2" }); await page.evaluate(() => localStorage.removeItem("sf_token")); await page.reload({ waitUntil: "networkidle2" }); await sleep(1600); }
async function click(s) { await page.evaluate(x => { const e = [...document.querySelectorAll("button,a")].find(b => (b.innerText || "").toLowerCase().includes(x.toLowerCase())); if (e) e.click(); }, s); await sleep(1600); }

try {
  await clearAuth(); await cap();                    // 1 login
  await authAs(tokens.requestor.token); await cap();  // 2 requestor home
  await click("New request"); await cap();            // 3 new request
  await authAs(tokens.approver.token); await cap();    // 4 approver home
  await authAs(tokens.admin.token); await cap();       // 5 admin console
} finally { await browser.close(); }

const enc = GIFEncoder();
frames.forEach((f, i) => {
  const palette = quantize(f.data, 256);
  const index = applyPalette(f.data, palette);
  enc.writeFrame(index, f.width, f.height, { palette, delay: 2000, repeat: i === 0 ? 0 : undefined });
});
enc.finish();
fs.writeFileSync(path.join(__dirname, "..", "SignFlow-Demo.gif"), enc.bytes());
console.log("GIF written:", frames.length, "frames");
