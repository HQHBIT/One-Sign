// ============================================================
//   NEW REQUEST  — supports single approver OR multi-step workflow
// ============================================================
import { useState, useEffect, useRef, useMemo, Suspense, lazy } from "react";
import {
  Upload, X, FileText, FileSpreadsheet, Stamp, GitBranch, Zap,
  Building2, Trash2, Plus, Send
} from "lucide-react";
import { STEP_COLORS, REQUEST_TYPES } from "../lib/constants.js";
import { BackHeader } from "../components/BackHeader.jsx";
import { Section } from "../components/Section.jsx";
import { api } from "../api.js";

// Lazy viewer module — same shared chunk as the rest of the app.
const ViewerModule = () => import("../viewer.jsx");
const DocPreview = lazy(() => ViewerModule().then(m => ({ default: m.DocPreview })));
const XlsxViewer = lazy(() => ViewerModule().then(m => ({ default: m.XlsxViewer })));
const ViewerFallback = () =>
  <div className="card p-10 text-sm opacity-50 text-center">Loading viewer…</div>;

export function NewRequest({ user, teams, users, addRequest, notify, onDone, defaultType }) {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("single"); // "single" | "workflow"
  const [instantApproval, setInstantApproval] = useState(false);
  const [requestType, setRequestType] = useState(defaultType || "general");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // single mode
  const [marker, setMarker] = useState(null);
  const [targetTeam, setTargetTeam] = useState("");

  // workflow mode: [{teamId, signers: [{userId, page, x, y, w, h}]}]
  const [workflow, setWorkflow] = useState([]);
  const [placingSlot, setPlacingSlot] = useState(null); // {stepIdx, signerIdx}

  // direct mode: search the directory + pick ONE person, place ONE marker
  const [directSigner, setDirectSigner] = useState(null); // {id, name, email, hasSignature}
  const [directQuery, setDirectQuery] = useState("");
  const [directResults, setDirectResults] = useState([]);
  const [directSearching, setDirectSearching] = useState(false);

  // Debounced directory search for "send to a specific person".
  useEffect(() => {
    if (mode !== "direct") return;
    const q = directQuery.trim();
    if (q.length < 2) { setDirectResults([]); setDirectSearching(false); return; }
    setDirectSearching(true);
    const t = setTimeout(async () => {
      try { setDirectResults(await api.searchUsers(q)); }
      catch { setDirectResults([]); }
      finally { setDirectSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [directQuery, mode]);

  // Holds the live XLSX workbook so cell edits can be written back on submit
  const xlsxWbRef = useRef(null);
  const leaveTemplateCache = useRef(null);
  const [leaveStyleMap, setLeaveStyleMap] = useState(null);

  // Auto-load leave template + styles when type is "leave"
  useEffect(() => {
    if (requestType !== "leave") return;
    let cancelled = false;
    (async () => {
      try {
        const [templateU8, stylesJson] = await Promise.all([
          leaveTemplateCache.current
            ? Promise.resolve(leaveTemplateCache.current)
            : fetch("/leave-template.xlsx").then(r => r.arrayBuffer()).then(b => { const u8 = new Uint8Array(b); leaveTemplateCache.current = u8; return u8; }),
          !leaveStyleMap
            ? fetch("/leave-template-styles.json").then(r => r.json()).catch(() => null)
            : Promise.resolve(null)
        ]);
        if (cancelled) return;
        if (stylesJson) setLeaveStyleMap(stylesJson);

        // --- Clear all pre-filled data; stamp today's date on non-leave date cells ---
        // Dynamic import: xlsx ships in the lazy viewer chunk so it only loads when needed.
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(templateU8, { type: "array", cellDates: true });
        const ws = workbook.Sheets["New Format"];
        if (ws) {
          // Clear all data cells
          [
            "C4","C5","C6","C7",
            "G4","G5","G6","G7",
            "A24",
            "A10","B10","C10","D10","E10","F10","G10","H10",
            "A11","B11","C11","D11","E11","F11","G11","H11",
            "A12","B12","C12","D12","E12","F12","G12","H12",
            "A13","B13","C13","D13","E13","F13","G13","H13",
            "C14","C17","F17","A19","F19",
            "F20","H24","H26",
          ].forEach(addr => { delete ws[addr]; });

          // Stamp today's date on all date cells EXCEPT From (D10-D13) and To (E10-E13)
          const today = new Date();
          const todayDisplay = today.toLocaleDateString("en-GB");
          ["F10","F11","F12","F13","F20","H24","H26"].forEach(addr => {
            ws[addr] = { t: "d", v: today, w: todayDisplay };
          });
        }
        const modifiedU8 = new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" }));
        // --- end clear ---

        const blob = new File([modifiedU8], "Leave Approval.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const reader = new FileReader();
        reader.onload = () => {
          if (cancelled) return;
          setFile({ name: "Leave Approval.xlsx", base64: reader.result, type: blob.type, ext: "xlsx", blob });
          setMarker(null); setWorkflow([]); setPlacingSlot(null);
        };
        reader.readAsDataURL(blob);
      } catch (e) { console.error(e); notify("Failed to load leave template", "error"); }
    })();
    return () => { cancelled = true; };
  }, [requestType]);

  const buildXlsxBlob = async () => {
    const wb = xlsxWbRef.current;
    if (!wb) return null;
    const XLSX = await import("xlsx");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return new File([new Uint8Array(out)], "Leave Approval.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  };

  const handleFile = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (!["pdf", "xlsx", "xls"].includes(ext)) { notify("Only PDF or Excel files supported", "error"); return; }
    if (f.size > 14 * 1024 * 1024) { notify("File must be under 14 MB", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setFile({ name: f.name, base64: reader.result, type: f.type, ext, blob: f });
      setMarker(null);
      setWorkflow([]);
      setPlacingSlot(null);
      setDirectSigner(null);
    };
    reader.readAsDataURL(f);
  };

  // ---------- aspect ratio to lock the marker rectangle to ----------
  // When placing a signer's marker in workflow mode, snap the rectangle to that
  // signer's signature aspect so the requestor sees the exact footprint that will
  // be stamped on approval. Single mode and unknown aspects fall back to free-form.
  const lockedAspect = useMemo(() => {
    if (mode !== "workflow" || !placingSlot) return null;
    const step = workflow[placingSlot.stepIdx];
    if (!step) return null;
    const signerSlot = step.signers?.[placingSlot.signerIdx];
    if (!signerSlot) return null;
    const team = teams.find(t => t.id === step.teamId);
    const approver = (team?.approvers || []).find(a => a.id === signerSlot.userId);
    const a = approver?.signatureAspect;
    return (a && a > 0 && isFinite(a)) ? a : null;
  }, [mode, placingSlot, workflow, teams]);

  // ---------- markers shown on the doc ----------
  const allMarkers = useMemo(() => {
    if (mode === "single") {
      if (!marker) return [];
      return [{ ...marker, label: "SIGN HERE" }];
    }
    if (mode === "direct") {
      if (!marker) return [];
      return [{ ...marker, label: directSigner ? directSigner.name : "SIGN HERE" }];
    }
    const out = [];
    workflow.forEach((step, si) => {
      const team = teams.find(t => t.id === step.teamId);
      step.signers.forEach((s, gi) => {
        if (s.x == null) return;
        const u = (team?.approvers || []).find(a => a.id === s.userId);
        out.push({
          id: `s${si}-${gi}`, page: s.page || 1, x: s.x, y: s.y, w: s.w, h: s.h,
          color: STEP_COLORS[si % STEP_COLORS.length],
          label: `${si + 1}.${gi + 1} ${u?.name || "?"}${team ? ` · ${team.name}` : ""}`
        });
      });
    });
    return out;
  }, [mode, marker, workflow, teams, directSigner]);

  // ---------- click handler from PDF viewer ----------
  const onAddMarker = (page, x, y, w, h) => {
    if (mode === "single" || mode === "direct") {
      setMarker({ page, x, y, w, h });
      return;
    }
    if (!placingSlot) {
      notify("Pick a signer first, then click 'Place signature'", "info");
      return;
    }
    const { stepIdx, signerIdx } = placingSlot;
    setWorkflow(wf => {
      const next = wf.map((st, i) => i !== stepIdx ? st : {
        ...st,
        signers: st.signers.map((s, j) => j !== signerIdx ? s : { ...s, page, x, y, w, h })
      });
      return next;
    });
    setPlacingSlot(null);
  };

  // ---------- update / delete existing markers (drag handles + X button) ----------
  const onUpdateMarker = (markerId, patch) => {
    if (mode === "single" || mode === "direct") {
      setMarker(prev => prev ? { ...prev, ...patch } : prev);
      return;
    }
    // markerId is in form "s{stepIdx}-{signerIdx}"
    const match = /^s(\d+)-(\d+)$/.exec(markerId || "");
    if (!match) return;
    const stepIdx = Number(match[1]), signerIdx = Number(match[2]);
    setWorkflow(wf => wf.map((st, i) => i !== stepIdx ? st : {
      ...st,
      signers: st.signers.map((s, j) => j !== signerIdx ? s : { ...s, ...patch })
    }));
  };
  const onDeleteMarker = (markerId) => {
    if (mode === "single" || mode === "direct") { setMarker(null); return; }
    const match = /^s(\d+)-(\d+)$/.exec(markerId || "");
    if (!match) return;
    const stepIdx = Number(match[1]), signerIdx = Number(match[2]);
    setWorkflow(wf => wf.map((st, i) => i !== stepIdx ? st : {
      ...st,
      signers: st.signers.map((s, j) => j !== signerIdx ? s : { ...s, x: null, y: null, w: null, h: null })
    }));
  };

  // ---------- workflow editing ----------
  const addStep = () => setWorkflow(wf => [...wf, { teamId: "", signers: [] }]);
  const removeStep = (i) => setWorkflow(wf => wf.filter((_, idx) => idx !== i));
  const setStepTeam = (i, teamId) => setWorkflow(wf => wf.map((s, idx) => idx === i ? { teamId, signers: [] } : s));
  const addSigner = (stepIdx, userId) => setWorkflow(wf => wf.map((s, i) => i !== stepIdx ? s : {
    ...s, signers: [...s.signers, { userId, page: 1, x: null, y: null, w: null, h: null }]
  }));
  const removeSigner = (stepIdx, signerIdx) => setWorkflow(wf => wf.map((s, i) => i !== stepIdx ? s : {
    ...s, signers: s.signers.filter((_, j) => j !== signerIdx)
  }));

  // ---------- submit ----------
  const isLeave = requestType === "leave";
  const effectiveFile = !!file;
  const canSubmitSingle = isLeave ? (effectiveFile && targetTeam) : (effectiveFile && marker && targetTeam);
  const canSubmitWorkflow = effectiveFile && workflow.length > 0
    && workflow.every(st => st.teamId && st.signers.length > 0
        && st.signers.every(s => s.userId && s.x != null));
  const canSubmitDirect = effectiveFile && file?.ext === "pdf" && !!directSigner && !!marker;

  const submit = async () => {
    setBusy(true);
    try {
      const submitFile = isLeave ? ((await buildXlsxBlob()) || file.blob) : file.blob;
      if (mode === "single") {
        if (!canSubmitSingle) { notify("Complete all steps first", "error"); return; }
        const submitMarker = isLeave ? { page: 1, x: 30, y: 85, w: 22, h: 6 } : marker;
        await addRequest({ file: submitFile, targetTeamId: targetTeam, marker: submitMarker, instantApproval, note, requestType });
      } else if (mode === "direct") {
        if (!canSubmitDirect) { notify("Pick a person and place their signature box", "error"); return; }
        await addRequest({ file: submitFile, direct: true, signers: [{ userId: directSigner.id, page: marker.page, x: marker.x, y: marker.y, w: marker.w, h: marker.h }], instantApproval, note, requestType });
      } else {
        if (!canSubmitWorkflow) { notify("Complete the workflow — every signer needs a placed signature", "error"); return; }
        await addRequest({ file: submitFile, workflow, instantApproval, note, requestType });
      }
      notify("Request submitted", "success");
      onDone();
    } catch (e) {
      notify(e.message || "Submit failed", "error");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <BackHeader back={onDone} title="Make a new request" />
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 mt-6 sm:mt-8">
        <div className="lg:col-span-2 space-y-6">

          {/* 0. type */}
          <Section n="00" title="Request type" desc="Classifying the request lets approvers batch-process documents of the same kind.">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {REQUEST_TYPES.map(t => {
                const active = requestType === t.key;
                return (
                  <button key={t.key} onClick={() => setRequestType(t.key)}
                    className={`card p-3 text-left tile-hover ${active ? "ring-2" : ""}`}
                    style={{ borderLeft: `4px solid ${t.color}`, backgroundColor: active ? "rgba(184,137,74,.08)" : undefined }}>
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="text-xs opacity-60 mt-0.5">{t.desc}</div>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* 1. upload / leave template */}
          {isLeave ? (
            <Section n="01" title="Leave Request Form" desc="Edit the cells directly in the spreadsheet below.">
              {file ? (
                <Suspense fallback={<ViewerFallback />}>
                  <XlsxViewer file={file} markers={[]} cellEditable lockedCells={new Set(["F10","F11","F12","F13","F20","H24","H26"])} onWorkbookReady={wb => { xlsxWbRef.current = wb; }} styleMap={leaveStyleMap} />
                </Suspense>
              ) : (
                <div className="card p-10 text-sm opacity-50 text-center">Loading template…</div>
              )}
            </Section>
          ) : (
            <Section n="01" title="Upload document" desc="PDF or Excel (.xlsx) up to 14 MB.">
              {!file ? (
                <label className="card p-10 flex flex-col items-center justify-center text-center cursor-pointer" style={{ borderStyle: "dashed" }}>
                  <Upload size={24} className="opacity-50 mb-3" />
                  <div className="font-medium">Click to select a file</div>
                  <div className="text-xs opacity-60 mt-1">PDF · XLSX</div>
                  <input type="file" className="hidden" accept=".pdf,.xlsx,.xls" onChange={handleFile} />
                </label>
              ) : (
                <div className="card p-5 flex items-center gap-4">
                  {file.ext === "pdf" ? <FileText size={22} /> : <FileSpreadsheet size={22} />}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{file.name}</div>
                    <div className="text-xs opacity-60 uppercase tracking-wider">{file.ext}</div>
                  </div>
                  <button className="btn-ghost text-xs" onClick={() => { setFile(null); setMarker(null); setWorkflow([]); }}>
                    <X size={12} /> Remove
                  </button>
                </div>
              )}
            </Section>
          )}

          {/* 2. mode + instant */}
          {effectiveFile && (
            <Section n="02" title="Approval flow" desc="Pick how this document should be approved.">
              <div className="grid sm:grid-cols-3 gap-3">
                <button onClick={() => setMode("single")}
                  className={`card p-4 text-left tile-hover ${mode === "single" ? "ring-2" : ""}`}
                  style={{ borderColor: mode === "single" ? "#B8894A" : undefined, backgroundColor: mode === "single" ? "rgba(184,137,74,.08)" : undefined }}>
                  <Stamp size={18} className="mb-3 opacity-70" />
                  <div className="font-medium">Single approver</div>
                  <div className="text-xs opacity-60 mt-1">Any approver from one team can sign.</div>
                </button>
                <button onClick={() => setMode("workflow")}
                  className={`card p-4 text-left tile-hover ${mode === "workflow" ? "ring-2" : ""}`}
                  style={{ borderColor: mode === "workflow" ? "#B8894A" : undefined, backgroundColor: mode === "workflow" ? "rgba(184,137,74,.08)" : undefined }}>
                  <GitBranch size={18} className="mb-3 opacity-70" />
                  <div className="font-medium">Multi-step workflow</div>
                  <div className="text-xs opacity-60 mt-1">Specific signers across one or more teams, in order.</div>
                </button>
                <button onClick={() => setMode("direct")}
                  className={`card p-4 text-left tile-hover ${mode === "direct" ? "ring-2" : ""}`}
                  style={{ borderColor: mode === "direct" ? "#B8894A" : undefined, backgroundColor: mode === "direct" ? "rgba(184,137,74,.08)" : undefined }}>
                  <Send size={18} className="mb-3 opacity-70" />
                  <div className="font-medium">Send to a specific person</div>
                  <div className="text-xs opacity-60 mt-1">Search any user and request their signature directly.</div>
                </button>
              </div>
              <label className="flex items-start gap-3 mt-5 cursor-pointer">
                <input type="checkbox" checked={instantApproval} onChange={e => setInstantApproval(e.target.checked)} className="mt-1" />
                <div>
                  <div className="font-medium text-sm flex items-center gap-2"><Zap size={13} style={{ color: "var(--c-gold)" }} /> Instant approval</div>
                  <div className="text-xs opacity-60">Skip the 1-hour cooling window. Once all signatures are collected, the document is finalised immediately.</div>
                </div>
              </label>
            </Section>
          )}

          {/* 3a. single mode: pick team + place marker */}
          {!isLeave && effectiveFile && mode === "single" && (
            <Section n="03" title="Mark the signature field" desc="Click and drag on the document to set the signature box.">
              <Suspense fallback={<ViewerFallback />}>
                <DocPreview file={file} markers={allMarkers} editable
                  onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} />
              </Suspense>
              {marker && (
                <div className="mt-3 text-xs font-mono opacity-60">
                  Placed on page {marker.page} · {Math.round(marker.x)}% × {Math.round(marker.y)}% · {Math.round(marker.w)}% wide
                  <button className="ml-3 underline" onClick={() => setMarker(null)}>Reset</button>
                </div>
              )}
              <div className="mt-3 text-xs opacity-60">
                The signature will fill this exact rectangle. A "Digitally signed by … · date" line is added below it automatically.
              </div>
            </Section>
          )}

          {effectiveFile && mode === "single" && (isLeave || marker) && (
            <Section n={isLeave ? "03" : "04"} title="Route to signing authority" desc="Everyone with authority on this team will be notified.">
              <div className="grid sm:grid-cols-3 gap-3">
                {teams.map(t => {
                  const active = targetTeam === t.id;
                  return (
                    <button key={t.id} onClick={() => setTargetTeam(t.id)}
                      className={`card p-4 text-left tile-hover ${active ? "ring-2" : ""}`}
                      style={{ borderColor: active ? "#B8894A" : undefined, backgroundColor: active ? "rgba(184,137,74,.08)" : undefined }}>
                      <Building2 size={18} className="mb-3 opacity-70" />
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs opacity-60 mt-1">{(t.approvers || []).length} approver(s)</div>
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          {/* 3c. direct mode: pick a person + place marker */}
          {!isLeave && effectiveFile && mode === "direct" && (
            <Section n="03" title="Choose who should sign" desc="Search any user by name or email, then place their signature box.">
              {file.ext !== "pdf" ? (
                <div className="card p-4 text-sm" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
                  Direct requests support PDF documents only. Upload a PDF to use this mode.
                </div>
              ) : (
                <>
                  {!directSigner ? (
                    <div>
                      <input type="text" value={directQuery} onChange={e => setDirectQuery(e.target.value)}
                        className="w-full mb-3" placeholder="Search by name or email (min 2 characters)…" autoFocus />
                      {directSearching && <div className="text-xs opacity-50 px-1 mb-2">Searching…</div>}
                      {!directSearching && directQuery.trim().length >= 2 && directResults.length === 0 && (
                        <div className="text-xs opacity-50 px-1 mb-2">No user found for "{directQuery}".</div>
                      )}
                      <div className="space-y-1">
                        {directResults.map(u => (
                          <button key={u.id} onClick={() => { setDirectSigner(u); setDirectResults([]); setDirectQuery(""); }}
                            className="w-full text-left px-3 py-2 rounded card tile-hover flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{u.name}</div>
                              <div className="text-xs opacity-60 font-mono truncate">{u.email}</div>
                            </div>
                            {!u.hasSignature && <span className="pill pill-rejected text-[10px] shrink-0">no signature yet</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="card p-4 flex items-center gap-3 mb-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{directSigner.name}</div>
                        <div className="text-xs opacity-60 font-mono truncate">{directSigner.email}</div>
                      </div>
                      {!directSigner.hasSignature && <span className="pill pill-rejected text-[10px] shrink-0">no signature yet</span>}
                      <button className="btn-ghost text-xs shrink-0" onClick={() => { setDirectSigner(null); setMarker(null); }}>Change</button>
                    </div>
                  )}

                  {directSigner && (
                    <>
                      <Suspense fallback={<ViewerFallback />}>
                        <DocPreview file={file} markers={allMarkers} editable
                          onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} />
                      </Suspense>
                      {marker
                        ? <div className="mt-3 text-xs font-mono opacity-60">Signature box placed on page {marker.page}.<button className="ml-2 underline" onClick={() => setMarker(null)}>Reset</button></div>
                        : <div className="mt-3 text-xs opacity-60">Click and drag on the document to place {directSigner.name}'s signature box.</div>}
                    </>
                  )}
                </>
              )}
            </Section>
          )}

          {/* 3b. workflow mode */}
          {!isLeave && effectiveFile && mode === "workflow" && (
            <Section n="03" title="Build the workflow" desc="Add steps in the order they should sign. Within a step, list the signers in order.">
              <Suspense fallback={<ViewerFallback />}>
                <DocPreview file={file} markers={allMarkers} editable lockedAspect={lockedAspect}
                  onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} />
              </Suspense>
              {placingSlot && (
                <div className="mt-2 text-xs px-3 py-2 rounded" style={{ backgroundColor: "rgba(184,137,74,.18)", color: "var(--c-sand)" }}>
                  Click and drag on the document to place this signer's box.{" "}
                  {lockedAspect
                    ? <span>Aspect is locked to the signer's signature so what you draw is what gets stamped.</span>
                    : <span>(Once this signer uploads a signature, the box will lock to its aspect.)</span>}
                  <button className="underline ml-2" onClick={() => setPlacingSlot(null)}>Cancel</button>
                </div>
              )}

              <div className="space-y-4 mt-5">
                {workflow.map((step, si) => {
                  const team = teams.find(t => t.id === step.teamId);
                  const stepColor = STEP_COLORS[si % STEP_COLORS.length];
                  return (
                    <div key={si} className="card p-4" style={{ borderLeft: `4px solid ${stepColor}` }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs opacity-50">Step {si + 1}</span>
                          <select value={step.teamId} onChange={e => setStepTeam(si, e.target.value)} className="text-sm">
                            <option value="">— pick a team —</option>
                            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                        <button className="btn-ghost text-xs" onClick={() => removeStep(si)}><Trash2 size={11} /> Remove step</button>
                      </div>

                      {team && (
                        <div className="space-y-2">
                          {step.signers.map((s, gi) => {
                            const u = (team.approvers || []).find(a => a.id === s.userId);
                            const placed = s.x != null;
                            const isPlacing = placingSlot?.stepIdx === si && placingSlot?.signerIdx === gi;
                            return (
                              <div key={gi} className="flex items-center gap-3 px-3 py-2 rounded" style={{ backgroundColor: "rgba(15,26,46,.04)" }}>
                                <span className="font-mono text-xs opacity-50">{si + 1}.{gi + 1}</span>
                                <span className="text-sm font-medium flex-1">{u?.name || "(unknown)"}</span>
                                {!u?.hasSignature && <span className="pill pill-rejected text-[10px]">no signature</span>}
                                {placed
                                  ? <span className="text-xs opacity-60 font-mono">page {s.page} · placed</span>
                                  : <span className="text-xs opacity-60">no marker</span>}
                                <button className={`text-xs ${isPlacing ? "btn-gold" : "btn-ghost"}`}
                                  onClick={() => setPlacingSlot(isPlacing ? null : { stepIdx: si, signerIdx: gi })}>
                                  {placed ? "Re-place" : "Place signature"}
                                </button>
                                <button className="opacity-40 hover:opacity-100" onClick={() => removeSigner(si, gi)}><X size={12} /></button>
                              </div>
                            );
                          })}
                          <AddSignerControl team={team} existing={step.signers.map(s => s.userId)} onAdd={uid => addSigner(si, uid)} />
                        </div>
                      )}
                    </div>
                  );
                })}
                <button className="btn-ghost w-full justify-center" onClick={addStep}><Plus size={13} /> Add step</button>
              </div>
            </Section>
          )}

          {/* 5. submit */}
          {effectiveFile && (mode === "single" ? ((isLeave || marker) && targetTeam) : mode === "direct" ? (directSigner && marker) : workflow.length > 0) && (
            <Section n={isLeave ? "04" : (mode === "single" ? "05" : "04")} title="Add a note (optional)" desc="">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="w-full" placeholder="Context for the signer(s)…" />
              <div className="flex justify-end mt-4 gap-3">
                <button className="btn-ghost" onClick={onDone}>Cancel</button>
                <button className="btn-primary" onClick={submit} disabled={busy || !(mode === "single" ? canSubmitSingle : mode === "direct" ? canSubmitDirect : canSubmitWorkflow)}>
                  <Send size={14} /> {busy ? "Submitting…" : "Submit request"}
                </button>
              </div>
            </Section>
          )}
        </div>

        {/* sidebar helper */}
        <aside className="space-y-4">
          <div className="card p-5">
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-2">How this works</div>
            <ol className="space-y-3 text-sm opacity-80">
              <li className="flex gap-3"><span className="font-mono opacity-50">01</span> Upload the document.</li>
              <li className="flex gap-3"><span className="font-mono opacity-50">02</span> Choose single approver or multi-step workflow. Optionally enable instant approval.</li>
              <li className="flex gap-3"><span className="font-mono opacity-50">03</span> Place each signer's signature box on the page where it should appear.</li>
              <li className="flex gap-3"><span className="font-mono opacity-50">04</span> Submit. Each signer is notified in turn.</li>
            </ol>
          </div>
          {mode === "workflow" && workflow.length > 0 && (
            <div className="card p-5">
              <div className="text-[10px] tracking-widest uppercase opacity-50 mb-3">Workflow summary</div>
              <ol className="space-y-2 text-sm">
                {workflow.map((st, i) => {
                  const team = teams.find(t => t.id === st.teamId);
                  const c = STEP_COLORS[i % STEP_COLORS.length];
                  return (
                    <li key={i} className="flex gap-2">
                      <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c, marginTop: 5 }} />
                      <div className="flex-1">
                        <div className="text-xs opacity-60">Step {i + 1} · {team?.name || "—"}</div>
                        <div>{st.signers.length} signer{st.signers.length === 1 ? "" : "s"}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {instantApproval && <div className="mt-4 text-xs flex items-center gap-1.5" style={{ color: "var(--c-gold)" }}><Zap size={12} /> Instant approval enabled</div>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function AddSignerControl({ team, existing, onAdd }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const available = (team.approvers || []).filter(a => !existing.includes(a.id));
  if (available.length === 0) return <div className="text-xs opacity-50 italic px-3">All team approvers already added.</div>;
  return (
    <div className="relative">
      <button className="btn-ghost text-xs w-full justify-center" onClick={() => setPickerOpen(o => !o)}>
        <Plus size={11} /> Add signer
      </button>
      {pickerOpen && (
        <div className="absolute left-0 right-0 mt-1 z-10 card p-2 shadow-lg" style={{ backgroundColor: "var(--c-paper)" }}>
          {available.map(a => (
            <button key={a.id} className="w-full text-left px-3 py-2 hover:opacity-70 text-sm flex items-center justify-between"
              onClick={() => { onAdd(a.id); setPickerOpen(false); }}>
              <span>{a.name}</span>
              {!a.hasSignature && <span className="pill pill-rejected text-[10px]">no signature</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
