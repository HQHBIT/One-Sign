// Building the print window's HTML, safely.
//
// A spreadsheet is printed by parsing it in the browser with SheetJS and
// rendering `sheet_to_html` output. That output is UNTRUSTED: SheetJS 0.18.5
// copies raw cell values into attributes and raw hyperlink targets into href
// without escaping, so a crafted workbook could carry `<script>`, event
// handlers or `javascript:` URLs (audit CV-01). Previously that string was
// written straight into a same-origin print window, where script could read
// the session token in localStorage.
//
// The fix: the workbook HTML is placed inside a SANDBOXED iframe with no
// `allow-scripts` and a strict Content-Security-Policy, so any injected script,
// event handler or javascript: URL is inert — while the parent print window
// still prints the iframe's rendered content. The document title (the uploaded
// file name, also attacker-influenceable) is HTML-escaped.

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The inner document that actually renders the (untrusted) table. CSP blocks
// scripts entirely and limits images to data: URIs, so even a no-script beacon
// cannot phone home; the sandbox is the primary control and this is defence in
// depth.
function innerDoc(tableHtml) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`
    + `<style>body{font-family:Calibri,Arial,sans-serif;font-size:9.5pt;margin:0;}`
    + `table{border-collapse:collapse;width:100%;page-break-inside:auto;}`
    + `td,th{border:1px solid #aaa;padding:2px 5px;vertical-align:top;word-break:break-word;}`
    + `tr{page-break-inside:avoid;}</style></head><body>${tableHtml}</body></html>`;
}

// The outer document written into the print window: a sandboxed iframe holding
// the workbook, and an escaped <title>. `sandbox` with no tokens is maximally
// locked (no scripts, opaque origin), so the iframe cannot reach the opener's
// localStorage or run any injected handler.
export function spreadsheetPrintDoc({ title, tableHtml }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>`
    + `<style>html,body{margin:0;padding:0;height:100%;}iframe{border:0;width:100%;height:100%;}`
    + `@media print{@page{margin:6mm;}}</style></head><body>`
    + `<iframe sandbox srcdoc="${escapeHtml(innerDoc(tableHtml))}"></iframe>`
    + `</body></html>`;
}
