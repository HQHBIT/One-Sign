import { useEffect, useState } from "react";
import { Search, Fingerprint } from "lucide-react";
import { api } from "../api.js";
import { BackHeader } from "../components/BackHeader.jsx";
import { ModalShell } from "../components/ModalShell.jsx";

// ============================================================
//   SIGNATURE REGISTER (HQHB) — every Sign Number, searchable
//   ------------------------------------------------------------
//   Each signature on SignFlow carries a Sign Number (SF-2026-000123), printed
//   under it and on the document's audit page. This is where IT looks one up:
//   who signed, on whose behalf, when, from where, and the fingerprint of the
//   file that signature produced. Confidential documents are never named here.
// ============================================================
const PAGE = 50;
const ist = (ts) => new Date(ts).toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
});

export function AdminSignRegister({ back, notify }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null); // { enabled, total, signatures }
  const [open, setOpen] = useState(null); // sign number

  const load = async (query, offset = 0) => {
    try {
      const r = await api.adminSignRegister({ q: query, limit: PAGE, offset });
      setData((prev) => (offset && prev ? { ...r, signatures: [...prev.signatures, ...r.signatures] } : r));
    } catch (e) { notify?.(e.message || "Could not load the register", "error"); setData({ enabled: true, total: 0, signatures: [] }); }
  };
  useEffect(() => { const t = setTimeout(() => load(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  return (
    <div>
      <BackHeader back={back} title="Signature register"
        step={data ? `${data.total} signature${data.total === 1 ? "" : "s"}` : "Loading…"} />
      <div className="text-sm opacity-60 mt-2 max-w-3xl">
        Every signature made on SignFlow has its own Sign Number, printed under the signature and listed on the
        document's audit page. Search a number, a signer or a document to trace it.
      </div>

      <div className="relative mt-5 max-w-xl">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
        <input value={q} onChange={(e) => setQ(e.target.value)} className="w-full pl-9"
          placeholder="Sign Number (SF-2026-000123), signer, or document…" />
      </div>

      {data && !data.enabled ? (
        <div className="card p-8 text-sm opacity-60 text-center mt-5">Sign Numbers are not used on this site.</div>
      ) : (
        <div className="card overflow-hidden mt-5">
          {data === null ? (
            <div className="p-8 text-sm opacity-50 text-center">Loading…</div>
          ) : data.signatures.length === 0 ? (
            <div className="p-8 text-sm opacity-50 text-center">{q ? "No signature matches that." : "No signatures recorded yet."}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] tracking-widest uppercase opacity-50" style={{ borderBottom: "1px solid var(--c-ink-10)" }}>
                    <th className="px-4 py-3 font-medium">Sign No</th>
                    <th className="px-4 py-3 font-medium">Signer</th>
                    <th className="px-4 py-3 font-medium">Document</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Signed (IST)</th>
                    <th className="px-4 py-3 font-medium">Step</th>
                  </tr>
                </thead>
                <tbody>
                  {data.signatures.map((s) => (
                    <tr key={s.signNo} onClick={() => setOpen(s.signNo)} className="cursor-pointer hover:bg-black/[.03]"
                      style={{ borderBottom: "1px solid var(--c-ink-08)" }}>
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{s.signNo}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{s.signerName}</div>
                        {s.actedBy && <div className="text-[11px] opacity-60">by {s.actedBy}, on their behalf</div>}
                      </td>
                      <td className="px-4 py-3 max-w-[22rem]">
                        <div className="truncate" style={s.confidential ? { fontStyle: "italic", opacity: 0.7 } : undefined}>{s.documentName}</div>
                        <div className="text-[11px] opacity-50 truncate">from {s.requestedBy || "—"}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">{ist(s.signedAt)}</td>
                      <td className="px-4 py-3 text-xs">{s.step ? `Step ${s.step}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.signatures.length < data.total && (
            <div className="text-center py-3 border-t" style={{ borderColor: "var(--c-ink-08)" }}>
              <button className="btn-ghost text-xs" onClick={() => load(q.trim(), data.signatures.length)}>
                Show {Math.min(PAGE, data.total - data.signatures.length)} more of {data.total - data.signatures.length}
              </button>
            </div>
          )}
        </div>
      )}

      {open && <SignNumberDetail signNo={open} onClose={() => setOpen(null)} onOpenOther={setOpen} />}
    </div>
  );
}

function SignNumberDetail({ signNo, onClose, onOpenOther }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { setD(null); api.adminSignNumber(signNo).then(setD).catch((e) => setErr(e.message || "Not found")); }, [signNo]);
  const s = d?.signature;
  const row = (k, v, mono) => (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm border-b last:border-0" style={{ borderColor: "var(--c-ink-08)" }}>
      <div className="opacity-50">{k}</div>
      <div className={mono ? "font-mono text-xs break-all" : ""}>{v || "—"}</div>
    </div>
  );
  return (
    <ModalShell title={signNo} subtitle="Sign Number — full trace" onClose={onClose}>
      {err ? <div className="text-sm" style={{ color: "var(--c-rust)" }}>{err}</div> : !s ? (
        <div className="text-sm opacity-50 py-6 text-center">Loading…</div>
      ) : (
        <div className="space-y-5">
          <div>
            {row("Signer", s.signerName)}
            {s.actedBy && row("Signed by", `${s.actedBy}, on their behalf`)}
            {row("Signed", `${ist(s.signedAt)} IST`)}
            {row("Step", s.step ? `Step ${s.step}` : "Single approver")}
            {row("Address", s.ip)}
            {row("Browser", s.userAgent)}
            {row("Signed file (SHA-256)", s.docSha256, true)}
            {row("Recorded", s.source === "backfill" ? "From earlier records (signed before Sign Numbers)" : "At the moment of signing")}
          </div>
          <div>
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1.5 flex items-center gap-1.5"><Fingerprint size={12} /> The document</div>
            {row("Document", s.documentName)}
            {row("Document ID", s.requestId, true)}
            {row("Requested by", s.requestedBy)}
            {row("Status", s.documentStatus)}
          </div>
          <div>
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1.5">Every signature on it</div>
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-ink-10)" }}>
              {d.document.map((x) => (
                <button key={x.signNo} onClick={() => onOpenOther(x.signNo)} disabled={x.signNo === signNo}
                  className="w-full text-left px-3 py-2 flex items-center gap-3 text-sm border-b last:border-0 hover:bg-black/[.03]"
                  style={{ borderColor: "var(--c-ink-08)", backgroundColor: x.signNo === signNo ? "rgba(184,137,74,.10)" : undefined }}>
                  <span className="font-mono text-xs w-32 shrink-0">{x.signNo}</span>
                  <span className="flex-1 truncate">{x.signerName}{x.actedBy ? ` (by ${x.actedBy})` : ""}</span>
                  <span className="text-xs opacity-60 shrink-0">{ist(x.signedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
