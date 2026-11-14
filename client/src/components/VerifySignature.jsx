// ============================================================
//   CHECK A SIGNATURE TAG
//   ------------------------------------------------------------
//   Public, and deliberately usable by someone with no account: the person who
//   most needs to check a signature is the one who RECEIVED the document.
//
//   What this can and cannot do is worth being honest about on the page
//   itself. The tag under a signature is ink and anyone can retype it. What
//   cannot be retyped is the record behind it — so a pasted tag still verifies
//   as a real signature, but names a different document, and the fingerprint
//   will not match the file in the reader's hand. The screen says so plainly
//   rather than showing a green tick and letting someone over-read it.
// ============================================================
import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Search } from "lucide-react";

/** The number out of /verify/SF-2026-000123-A7F3 or #verify/SF-… */
export function signNoFromUrl() {
  const hay = `${window.location.pathname} ${window.location.hash}`;
  const m = /(SF-\d{4}-\d{6}(?:-[0-9A-Fa-f]{4})?)/.exec(hay);
  return m ? m[1].toUpperCase() : "";
}

export function isVerifyUrl() {
  return /verify/i.test(window.location.pathname) || /verify/i.test(window.location.hash);
}

const Row = ({ label, children }) => (
  <div className="flex flex-col sm:flex-row sm:gap-3 py-1.5">
    <div className="text-xs uppercase tracking-wider opacity-50 sm:w-44 shrink-0">{label}</div>
    <div className="text-sm break-all">{children}</div>
  </div>
);

export function VerifySignature() {
  const [input, setInput] = useState(signNoFromUrl());
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const check = async (no) => {
    const value = String(no || "").trim().toUpperCase();
    if (!value) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const res = await fetch(`/api/verify/${encodeURIComponent(value)}`);
      if (res.status === 404) { setErr("Signature checking is not available here."); return; }
      if (res.status === 429) { setErr("Too many checks from this network. Please wait a few minutes."); return; }
      setResult(await res.json());
    } catch {
      setErr("Could not reach SignFlow to check that number.");
    } finally { setBusy(false); }
  };

  // A link straight to a number checks it on arrival; nobody should have to
  // press a button when the number is already in the address.
  useEffect(() => { const n = signNoFromUrl(); if (n) check(n); /* eslint-disable-next-line */ }, []);

  const good = result?.valid === true;

  return (
    <div className="min-h-screen flex flex-col items-center p-6" style={{ backgroundColor: "var(--c-cream)", color: "var(--c-ink)" }}>
      <div className="w-full" style={{ maxWidth: 620 }}>
        <div className="font-display text-3xl mt-10 mb-1">SignFlow</div>
        <div className="text-sm opacity-60 mb-8">Check a signature</div>

        <div className="flex gap-2 mb-6">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") check(input); }}
              placeholder="SF-2026-000123-A7F3" aria-label="Sign number"
              className="w-full pl-9" />
          </div>
          <button className="btn-primary shrink-0" onClick={() => check(input)} disabled={busy}>
            {busy ? "Checking…" : "Check"}
          </button>
        </div>

        {err && <div className="card p-4 text-sm mb-4" style={{ borderLeft: "3px solid var(--c-rust)" }}>{err}</div>}

        {result && (
          <div className="card p-5" style={{ borderLeft: `3px solid ${good ? "var(--c-forest)" : "var(--c-rust)"}` }}>
            <div className="flex items-center gap-2 mb-3">
              {good ? <ShieldCheck size={18} style={{ color: "var(--c-forest)" }} />
                    : <ShieldAlert size={18} style={{ color: "var(--c-rust)" }} />}
              <span className="font-medium">
                {good ? "This is a genuine SignFlow signature" : "This does not check out"}
              </span>
            </div>

            {!good && <div className="text-sm opacity-75">{result.message}</div>}

            {good && (
              <>
                <Row label="Sign number">{result.signNo}</Row>
                <Row label="Signed by">{result.signedBy || "—"}</Row>
                <Row label="Signed at">{result.signedAt ? new Date(result.signedAt).toLocaleString() : "—"}</Row>
                <Row label="Document">
                  {result.confidential
                    ? <span className="opacity-60">Confidential — not named here</span>
                    : (result.document || "—")}
                </Row>
                {!result.confidential && result.requestedBy && <Row label="Requested by">{result.requestedBy}</Row>}
                <Row label="Signed file (SHA-256)"><code className="text-xs">{result.fileSha256 || "—"}</code></Row>

                {/* The honest part. A green tick alone would be read as "this
                    document is genuine", which is not what was checked. */}
                <div className="text-xs opacity-70 mt-4 pt-3" style={{ borderTop: "1px solid var(--c-ink-10)" }}>
                  This confirms the signature <strong>number</strong> is real and shows what it belongs to.
                  {result.assurance === "number-only" && " The four-character code was not supplied, so only the number itself was checked."}
                  {" "}Make sure the document named above is the document in front of you — a tag copied onto
                  another file still checks out, but will name the document it really came from.
                  {result.fileSha256 && " To be certain, compare the SHA-256 above with the file you hold."}
                  {result.backfilled && " This signature pre-dates sign numbering and was recorded afterwards."}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
