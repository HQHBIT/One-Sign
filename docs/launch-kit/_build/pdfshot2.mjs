import puppeteer from "puppeteer-core";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new", args: ["--no-sandbox"],
  defaultViewport: { width: 1000, height: 1300, deviceScaleFactor: 1 }
});
const p = await b.newPage();
await p.goto("file:///D:/OneSign/docs/launch-kit/SignFlow-Handbook.pdf", { waitUntil: "networkidle2" });
await sleep(3500);
await p.screenshot({ path: "docs/launch-kit/_build/handbook-cover.png" });
await b.close();
console.log("done");
