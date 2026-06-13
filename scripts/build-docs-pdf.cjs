#!/usr/bin/env node
// ============================================================
//   Build PDFs from the markdown docs in /docs.
//   Styles them with the HQHB SignFlow brand palette + typography.
//   ------------------------------------------------------------
//   Usage:   node scripts/build-docs-pdf.cjs
//   Output:  docs/pdf/<name>.pdf for every .md file in docs/
//
//   Dependencies (installed by npm install in this folder):
//     - marked         (markdown -> HTML)
//     - puppeteer      (HTML -> PDF, ships its own Chromium)
// ============================================================
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const puppeteer = require("puppeteer");

const DOCS_DIR = path.resolve(__dirname, "..", "docs");
const OUT_DIR = path.join(DOCS_DIR, "pdf");

// Brand palette + typography — mirrors client/src/components/StyleTag.jsx
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..800&family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

  :root {
    --c-ink:        #0F1A2E;
    --c-ink-soft:   #1B2A4A;
    --c-cream:      #F5F1E8;
    --c-paper:      #FAF7F0;
    --c-gold:       #B8894A;
    --c-forest:     #2D5F2F;
    --c-rust:       #9B2C2C;
    --c-sand:       #8B6914;
  }

  * { box-sizing: border-box; }

  html, body {
    font-family: 'IBM Plex Sans', -apple-system, sans-serif;
    color: var(--c-ink);
    background: var(--c-cream);
    line-height: 1.55;
    font-size: 11pt;
    margin: 0;
  }

  .page {
    background: var(--c-cream);
    padding: 18mm 18mm 22mm 18mm;
  }

  /* ── Cover header ───────────────────────────────────── */
  .cover {
    border-bottom: 2px solid var(--c-gold);
    margin-bottom: 24px;
    padding-bottom: 16px;
  }
  .cover-brand {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9pt;
    letter-spacing: .25em;
    text-transform: uppercase;
    color: var(--c-gold);
  }
  .cover-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 28pt;
    line-height: 1.05;
    letter-spacing: -0.01em;
    margin: 6px 0 0 0;
  }
  .cover-sub {
    font-size: 10pt;
    opacity: 0.6;
    margin-top: 6px;
  }

  /* ── Typography ─────────────────────────────────────── */
  h1, h2, h3, h4, h5, h6 {
    font-family: 'Fraunces', Georgia, serif;
    letter-spacing: -0.01em;
    color: var(--c-ink);
    page-break-after: avoid;
    page-break-inside: avoid;
  }
  h1 { font-size: 22pt; margin: 28px 0 12px; }
  h2 { font-size: 16pt; margin: 24px 0 10px;
       border-bottom: 1px solid rgba(15,26,46,.1);
       padding-bottom: 4px; }
  h3 { font-size: 13pt; margin: 18px 0 8px; color: var(--c-ink-soft); }
  h4 { font-size: 11pt; margin: 14px 0 6px; }
  p  { margin: 6px 0 10px; }

  /* ── Links ──────────────────────────────────────────── */
  a {
    color: var(--c-gold);
    text-decoration: none;
    border-bottom: 1px solid rgba(184,137,74,.4);
  }

  /* ── Code ───────────────────────────────────────────── */
  code {
    font-family: 'IBM Plex Mono', monospace;
    background: rgba(15,26,46,.06);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 9.5pt;
  }
  pre {
    font-family: 'IBM Plex Mono', monospace;
    background: var(--c-paper);
    border: 1px solid rgba(15,26,46,.1);
    border-left: 3px solid var(--c-gold);
    border-radius: 4px;
    padding: 10px 14px;
    overflow-x: auto;
    font-size: 9pt;
    line-height: 1.45;
    page-break-inside: avoid;
  }
  pre code { background: transparent; padding: 0; font-size: 9pt; }

  /* ── Tables ─────────────────────────────────────────── */
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    font-size: 10pt;
    page-break-inside: avoid;
  }
  th, td {
    padding: 7px 10px;
    text-align: left;
    border-bottom: 1px solid rgba(15,26,46,.1);
    vertical-align: top;
  }
  th {
    background: var(--c-paper);
    font-weight: 600;
    border-bottom: 2px solid var(--c-gold);
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--c-ink-soft);
  }

  /* ── Lists ──────────────────────────────────────────── */
  ul, ol { padding-left: 22px; margin: 8px 0; }
  li { margin: 4px 0; }

  /* ── Blockquotes ────────────────────────────────────── */
  blockquote {
    border-left: 3px solid var(--c-gold);
    background: rgba(184,137,74,.06);
    padding: 8px 14px;
    margin: 12px 0;
    color: var(--c-ink);
    font-style: italic;
  }
  blockquote p { margin: 4px 0; }

  /* ── Horizontal rules ───────────────────────────────── */
  hr {
    border: none;
    border-top: 1px solid rgba(15,26,46,.12);
    margin: 22px 0;
  }

  /* ── Strong / emphasis ──────────────────────────────── */
  strong { color: var(--c-ink); }

  /* ── Page-break utility ─────────────────────────────── */
  .page-break { page-break-before: always; }
`;

// Cover-page metadata per file. Falls back to derived from filename if missing.
const COVERS = {
  "admin-handbook.md":      { brand: "HQHB · SignFlow",      title: "IT Admin Handbook",          sub: "Complete reference · Beta 1.0 · June 2026" },
  "user-guide.md":          { brand: "HQHB · SignFlow",      title: "User Guide",                  sub: "For requestors and approvers · Beta 1.0 · June 2026" },
  "quickref.md":            { brand: "HQHB · SignFlow",      title: "Quick Reference",             sub: "One-page cheat sheet · Beta 1.0 · June 2026" },
  "faq.md":                 { brand: "HQHB · SignFlow",      title: "Frequently Asked Questions",  sub: "Common questions answered · Beta 1.0 · June 2026" },
  "launch-announcement.md": { brand: "HQHB · SignFlow",      title: "Launch Announcement Templates", sub: "Email + chat templates · Beta 1.0" },
  "onboarding-checklist.md":{ brand: "HQHB · SignFlow",      title: "Beta Onboarding Checklist",   sub: "Day -3 through day +14 plan · Beta 1.0" },
  "README.md":              { brand: "HQHB · SignFlow",      title: "Documentation Index",         sub: "Read me first · Beta 1.0" }
};

async function buildOne(browser, mdName) {
  const mdPath = path.join(DOCS_DIR, mdName);
  if (!fs.existsSync(mdPath)) {
    console.warn(`  · skip ${mdName} (not found)`);
    return;
  }
  const md = fs.readFileSync(mdPath, "utf8");
  // Strip the first H1 title (we'll show our own cover) — but only the FIRST
  // header so internal sections keep their original h1s if present.
  const mdBody = md.replace(/^#\s+.*\n+/, "");
  const html = marked.parse(mdBody);

  const cover = COVERS[mdName] || {
    brand: "HQHB · SignFlow",
    title: mdName.replace(/\.md$/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    sub: "Beta 1.0 · June 2026"
  };

  const fullHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${cover.title}</title>
        <style>${css}</style>
      </head>
      <body>
        <div class="page">
          <div class="cover">
            <div class="cover-brand">${cover.brand}</div>
            <h1 class="cover-title">${cover.title}</h1>
            <div class="cover-sub">${cover.sub}</div>
          </div>
          ${html}
        </div>
      </body>
    </html>
  `;

  const outName = mdName.replace(/\.md$/, ".pdf");
  const outPath = path.join(OUT_DIR, outName);

  const page = await browser.newPage();
  await page.setContent(fullHtml, { waitUntil: "networkidle0" });
  await page.pdf({
    path: outPath,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    margin: { top: "0mm", right: "0mm", bottom: "16mm", left: "0mm" },
    headerTemplate: `<div></div>`,
    footerTemplate: `
      <div style="font-family: 'IBM Plex Mono', monospace; font-size: 8pt; color: #0F1A2E; opacity: 0.5; width: 100%; padding: 0 18mm; display: flex; justify-content: space-between;">
        <span>${cover.brand} · ${cover.title}</span>
        <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>
    `
  });
  await page.close();

  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`  ✓ ${outName} (${kb} kB)`);
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("Building PDFs from docs/*.md → docs/pdf/");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const files = fs.readdirSync(DOCS_DIR)
    .filter(f => f.endsWith(".md"))
    .sort();

  for (const f of files) {
    try { await buildOne(browser, f); }
    catch (e) { console.error(`  ✗ ${f}: ${e.message}`); }
  }

  await browser.close();
  console.log("\nDone. PDFs are in docs/pdf/");
})();
