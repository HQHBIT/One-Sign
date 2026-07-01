import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "..", "assets");
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, "tokens.json"), "utf8"));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP = "http://localhost:5173/";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 }
});
const page = await browser.newPage();
const shot = async name => { await sleep(800); await page.screenshot({ path: path.join(ASSETS, name + ".png") }); console.log("shot:", name); };

async function authAs(token) {
  for (let i = 0; i < 4; i++) {
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(t => localStorage.setItem("sf_token", t), token);
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(2600);
    const txt = await page.evaluate(() => document.body.innerText || "");
    if (!/Use the credentials provided/i.test(txt)) { console.log("authed on attempt", i + 1); return true; }
    console.log("attempt", i + 1, "still on login, retrying");
  }
  return false;
}
async function click(substr) {
  const ok = await page.evaluate(s => { const el = [...document.querySelectorAll("button, a")].find(b => (b.innerText || "").toLowerCase().includes(s.toLowerCase())); if (el) { el.click(); return true; } return false; }, substr);
  await sleep(1600); return ok;
}

try {
  const ok = await authAs(tokens.approver.token);
  console.log("approver authed:", ok);
  await shot("20-approver-home");
  if (await click("Pending")) await shot("21-approver-pending");
} catch (e) { console.log("ERROR:", e.message); }
finally { await browser.close(); console.log("done"); }
