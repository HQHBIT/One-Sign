import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "..", "assets");
fs.mkdirSync(ASSETS, { recursive: true });
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, "tokens.json"), "utf8"));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP = "http://localhost:5173/";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 }
});
const page = await browser.newPage();
const done = [];

async function shot(name) {
  await sleep(800);
  await page.screenshot({ path: path.join(ASSETS, name + ".png") });
  done.push(name);
  console.log("shot:", name);
}
async function setRole(token) {
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate(t => localStorage.setItem("sf_token", t), token);
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(2200);
}
async function clearAuth() {
  await page.goto(APP, { waitUntil: "networkidle2" });
  await page.evaluate(() => localStorage.removeItem("sf_token"));
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1600);
}
async function click(substr) {
  const ok = await page.evaluate(s => {
    const el = [...document.querySelectorAll("button, a")].find(b => (b.innerText || "").toLowerCase().includes(s.toLowerCase()));
    if (el) { el.click(); return true; }
    return false;
  }, substr);
  await sleep(1600);
  return ok;
}

try {
  // 1) Login page
  await clearAuth();
  await shot("01-login");

  // 2) Requestor
  await setRole(tokens.requestor.token);
  await shot("10-requestor-home");
  if (await click("New request")) await shot("11-requestor-new-request");

  // 3) Approver
  await setRole(tokens.approver.token);
  await shot("20-approver-home");

  // 4) Administrator
  await setRole(tokens.admin.token);
  await shot("30-admin-console");
  if (await click("Onboard team")) await shot("31-admin-onboard");
  await setRole(tokens.admin.token);
  if (await click("Users")) { await shot("32-admin-users"); if (await click("Add user")) await shot("33-admin-add-user"); }
  await setRole(tokens.admin.token);
  if (await click("Teams")) await shot("34-admin-teams");
  await setRole(tokens.admin.token);
  if (await click("Reports")) await shot("35-admin-reports");
} catch (e) {
  console.log("ERROR:", e.message);
} finally {
  await browser.close();
  console.log("DONE:", done.length, "shots ->", done.join(", "));
}
