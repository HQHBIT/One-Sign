import { useEffect, useMemo, useState } from "react";
import { Download, Hourglass, PenLine, CircleCheck, Timer } from "lucide-react";
import { api } from "../../api.js";
import { fmtDuration, fmtWhen, stageColour } from "./time.js";

// Where every document sat, and for how long. Everything shown here is
// computed by the server from the movement trail; this only draws it.
export function Dashboard({ board, notify }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("all");     // all | open | done
  const [signer, setSigner] = useState("all");
  const [since, setSince] = useState("");          // yyyy-mm-dd intake filter

  useEffect(() => {
    api.eaDashboard(board.id).then(setData).catch((e) => { notify(e.message || "Could not load the dashboard", "error"); setData({ stages: [], documents: [] }); });
  }, [board.id]);

  const rows = useMemo(() => {
    if (!data) return [];
    const from = since ? new Date(since).getTime() : 0;
    return data.documents.filter((d) =>
      (status === "all" || (status === "done" ? !!d.completedAt : !d.completedAt)) &&
      (signer === "all" || d.signerName === signer) &&
      (!from || d.createdAt >= from));
  }, [data, status, signer, since]);
  const signers = useMemo(() => [...new Set((data?.documents || []).map((d) => d.signerName).filter(Boolean))], [data]);

  const exportCsv = () => {
    const stages = data.stages;
    const head = ["Document", "File", "Added", "Current stage", "In current stage", ...stages.map((s) => `Time in ${s.name}`), "Total elapsed", "Completed"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")];
    for (const d of rows) {
      const cur = stages.find((s) => s.id === d.currentStageId);
      lines.push([d.title, d.fileName, fmtWhen(d.createdAt), cur?.name || "", d.completedAt ? "" : fmtDuration(Date.now() - d.enteredStageAt),
        ...d.stages.map((s) => fmtDuration(s.ms)), fmtDuration(d.totalMs), d.completedAt ? fmtWhen(d.completedAt) : ""].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${board.name.replace(/[^\w-]+/g, "_")}-flow-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  if (!data) return <div className="card p-10 text-sm opacity-50 text-center">Loading…</div>;
  const stages = data.stages;
  const open = data.documents.filter((d) => !d.completedAt);

  return (
    <div className="space-y-5">
      {/* headline numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="On the board" value={open.length} sub={`${data.documents.length - open.length} completed`} />
        <Stat label="Waiting for a signature" value={open.filter((d) => d.requestStatus === "pending").length} icon={PenLine} />
        <Stat label="Average time to complete" value={avgTotal(data.documents.filter((d) => d.completedAt))} icon={Timer} />
        <Stat label="Longest wait right now" value={longestOpen(open, stages)} icon={Hourglass} />
      </div>

      {/* per-stage summary */}
      <div className="card p-4">
        <div className="text-[10px] tracking-widest uppercase opacity-50 mb-3">By stage</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(stages.length, 6)}, minmax(0, 1fr))` }}>
          {stages.map((s, i) => (
            <div key={s.id} className="rounded-lg p-3" style={{ backgroundColor: "rgba(15,26,46,.035)", borderTop: `3px solid ${stageColour(i)}` }}>
              <div className="text-sm font-medium truncate flex items-center gap-1">{s.name}{s.requiresSignature && <PenLine size={11} className="opacity-50" />}</div>
              <div className="font-display text-2xl leading-tight mt-1">{s.count}<span className="text-xs opacity-50 font-sans ml-1">now</span></div>
              <div className="text-[11px] opacity-60 mt-1">avg {fmtDuration(s.avgMs)} · longest {fmtDuration(s.maxMs)}</div>
              {s.oldestMs > 0 && <div className="text-[11px] mt-0.5" style={{ color: "var(--c-rust)" }}>oldest waiting {fmtDuration(s.oldestMs)}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* filters + table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2 flex-wrap border-b" style={{ borderColor: "var(--c-ink-08)" }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-xs">
            <option value="all">All documents</option><option value="open">On the board</option><option value="done">Completed</option>
          </select>
          {signers.length > 0 && (
            <select value={signer} onChange={(e) => setSigner(e.target.value)} className="text-xs">
              <option value="all">Any executive</option>{signers.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <label className="text-xs opacity-70 inline-flex items-center gap-1">Added since <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="text-xs" /></label>
          <span className="text-xs opacity-50 ml-auto">{rows.length} shown</span>
          <button className="btn-ghost text-xs" onClick={exportCsv} disabled={!rows.length}><Download size={12} /> Export CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] tracking-widest uppercase opacity-50 text-left">
                <th className="px-4 py-2 font-medium">Document</th>
                <th className="px-2 py-2 font-medium" style={{ minWidth: 260 }}>Where it sat, and how long</th>
                <th className="px-2 py-2 font-medium">Now</th>
                <th className="px-2 py-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const cur = stages.find((s) => s.id === d.currentStageId); const ci = stages.findIndex((s) => s.id === d.currentStageId);
                const total = Math.max(1, d.stages.reduce((n, s) => n + s.ms, 0));
                return (
                  <tr key={d.id} className="border-t" style={{ borderColor: "var(--c-ink-08)" }}>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium">{d.title}</div>
                      <div className="text-[11px] opacity-50">added {fmtWhen(d.createdAt)}{d.signerName ? ` · ${d.signerName}` : ""}</div>
                    </td>
                    <td className="px-2 py-3 align-top">
                      <div className="flex h-4 rounded overflow-hidden" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>
                        {d.stages.map((s, i) => s.ms > 0 && (
                          <div key={s.stageId} title={`${stages[i].name}: ${fmtDuration(s.ms)}`} style={{ width: `${Math.max(2, (s.ms / total) * 100)}%`, backgroundColor: stageColour(i), opacity: i === ci && !d.completedAt ? 1 : 0.75 }} />
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] opacity-70">
                        {d.stages.map((s, i) => s.ms > 0 && <span key={s.stageId}><span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ backgroundColor: stageColour(i) }} />{stages[i].name} {fmtDuration(s.ms)}</span>)}
                      </div>
                    </td>
                    <td className="px-2 py-3 align-top whitespace-nowrap">
                      {d.completedAt
                        ? <span className="pill pill-approved"><CircleCheck size={10} /> Completed {fmtWhen(d.completedAt)}</span>
                        : <><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: stageColour(ci) }} />{cur?.name} <span className="opacity-50">· {fmtDuration(Date.now() - d.enteredStageAt)}</span></>}
                    </td>
                    <td className="px-2 py-3 align-top text-right whitespace-nowrap font-medium">{fmtDuration(d.totalMs)}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm opacity-50">Nothing to show for these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] tracking-widest uppercase opacity-50 flex items-center gap-1">{Icon && <Icon size={11} />}{label}</div>
      <div className="font-display text-3xl leading-tight mt-1">{value}</div>
      {sub && <div className="text-[11px] opacity-50 mt-0.5">{sub}</div>}
    </div>
  );
}
function avgTotal(done) { if (!done.length) return "—"; return fmtDuration(done.reduce((n, d) => n + d.totalMs, 0) / done.length); }
function longestOpen(open, stages) {
  if (!open.length) return "—";
  const d = open.reduce((a, b) => (Date.now() - a.enteredStageAt > Date.now() - b.enteredStageAt ? a : b));
  return `${fmtDuration(Date.now() - d.enteredStageAt)}`;
}
