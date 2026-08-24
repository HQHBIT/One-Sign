// ============================================================
//   NEW REQUEST  — supports single approver OR multi-step workflow
// ============================================================
import { useState, useEffect, useRef, useMemo, Suspense, lazy } from "react";
import {
  Upload, X, FileText, FileSpreadsheet, Stamp, GitBranch, Zap,
  Building2, Trash2, Plus, Send, Calendar, Save, ChevronUp, ChevronDown, Lock
} from "lucide-react";
import { STEP_COLORS, REQUEST_TYPES } from "../lib/constants.js";
import { SIGNATURE_HEIGHTS_MM, SIGNATURE_PRESETS, DATE_HEIGHT_MM, DATE_ASPECT, DEFAULT_SIGNATURE_ASPECT, getPreset, setPreset } from "../lib/boxSize.js";
import { BackHeader } from "../components/BackHeader.jsx";
import { Section } from "../components/Section.jsx";
import { api } from "../api.js";

// Who a requestor may pick as a signer for a team: the designated approvers,
// or — when the team has none yet — its own members. Falls back gracefully if
// an older payload only carries `approvers`.
export const teamSigners = (t) =>
  (t?.signers?.length ? t.signers : (t?.approvers?.length ? t.approvers : (t?.members || [])));
const usesMembers = (t) => !(t?.approvers?.length) && (t?.members?.length > 0);
// 1st / 2nd / 3rd / 4th … — labels the signing order within a step.
export const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };

// Lazy viewer module — same shared chunk as the rest of the app.
const ViewerModule = () => import("../viewer.jsx");
const DocPreview = lazy(() => ViewerModule().then(m => ({ default: m.DocPreview })));
const ViewerFallback = () =>
  <div className="card p-10 text-sm opacity-50 text-center">Loading viewer…</div>;

export function NewRequest({ user, teams, users, addRequest, notify, onDone, defaultType, presetWorkflow, defaultConfidential = false }) {
  const [file, setFile] = useState(null);
  const [docRotation, setDocRotation] = useState(0); // 0/90/180/270 — squared up before placing, baked in on submit
  const [mode, setMode] = useState(presetWorkflow ? "workflow" : "single"); // "single" | "workflow" | "direct"
  const [requestType, setRequestType] = useState(defaultType || "general");
  // Confidential: encrypted at rest, IT Admin locked out, and every view
  // needs a fresh emailed code. Hidden unless the server has a key configured.
  const [confidential, setConfidential] = useState(defaultConfidential);
  const [confAvailable, setConfAvailable] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // single mode — the team approver's signature box(es). Placement is armed by
  // default: every click-drag adds another box (multiple signs of the same
  // approver on one document).
  const [markers, setMarkers] = useState([]);
  const [targetTeam, setTargetTeam] = useState("");

  // workflow mode: [{teamId, signers: [{userId, boxes: [], dateFields: []}]}]
  // A saved template ("My Workflows") pre-fills the route; the requestor only
  // places each signer's boxes on the freshly attached document.
  const presetSteps = () => (presetWorkflow?.steps || []).map(st => ({
    teamId: st.teamId,
    signers: (st.signers || []).map(g => ({ userId: g.userId || g, boxes: [], dateFields: [] })),
  }));
  const [workflow, setWorkflow] = useState(() => presetWorkflow ? presetSteps() : []);
  const [placingSlot, setPlacingSlot] = useState(null); // {stepIdx, signerIdx}

  // direct mode: search the directory + pick ONE person, place ONE marker
  // direct mode: a flat list of specific people who each sign the document (in any
  // order — all must sign). Each carries its own signature box + optional date
  // fields: { userId, name, email, hasSignature, page, x, y, w, h, dateFields:[] }
  const [directSigners, setDirectSigners] = useState([]);
  const [directQuery, setDirectQuery] = useState("");
  const [directResults, setDirectResults] = useState([]);
  const [directSearching, setDirectSearching] = useState(false);

  // self-sign / date: the requestor stamps their OWN signature + date onto the SAME
  // document view where they place the signer box — one unified placement step.
  const [selfMarks, setSelfMarks] = useState([]); // [{type:'signature'|'date', page, x, y, w, h}]
  const [selfPlacing, setSelfPlacing] = useState(null); // 'signature' | 'date' | null
  const [mySigUrl, setMySigUrl] = useState(null);
  // Date field(s) for the SIGNATORY (single/direct one-signer path); each fills with
  // that person's date when THEY sign. (Workflow keeps per-signer dateFields inline.)
  const [signerDateFields, setSignerDateFields] = useState([]); // [{page,x,y,w,h}]
  const [signerDatePlacing, setSignerDatePlacing] = useState(false);
  const todayDdMmYy = (() => { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`; })();

  // Load the requestor's signature (blob URL) so it previews in the placement overlay.
  // Fetched whenever a PDF is loaded and the requestor has a signature (no toggle).
  useEffect(() => {
    if (!user.hasSignature || file?.ext !== "pdf") { setMySigUrl(null); return; }
    let url = null, cancelled = false;
    api.getSignatureBlob(user.id).then(u => { if (cancelled) { if (u) URL.revokeObjectURL(u); return; } url = u; setMySigUrl(u); }).catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [file?.ext, user.hasSignature, user.id]);

  // Is confidential storage configured on this server? If not, the toggle is
  // hidden rather than offering a guarantee the backend cannot honour.
  useEffect(() => {
    api.authConfig().then(c => setConfAvailable(!!c.confidentialEnabled)).catch(() => setConfAvailable(false));
  }, []);

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

  // Several files at once switch the form into the batch flow — each document
  // becomes its own request, so tracking, reminders and reports stay per-document.
  const [docs, setDocs] = useState([]); // [{name, base64, ext, blob, teamId, markers: []}]
  const MAX_DOCS = 10;

  const validFile = (f, errs) => {
    const ext = f.name.split(".").pop().toLowerCase();
    if (!["pdf", "xlsx", "xls"].includes(ext)) { errs.push(`${f.name}: only PDF or Excel`); return null; }
    if (f.size > 14 * 1024 * 1024) { errs.push(`${f.name}: over 14 MB`); return null; }
    return ext;
  };
  const readDoc = (f) => new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve({
      name: f.name, base64: r.result, type: f.type, blob: f,
      ext: f.name.split(".").pop().toLowerCase() === "pdf" ? "pdf" : "xlsx",
      teamId: "", markers: [],
    });
    r.readAsDataURL(f);
  });

  const handleFile = async e => {
    const list = [...(e.target.files || [])];
    e.target.value = ""; // so re-picking the same file fires again
    if (!list.length) return;
    const errs = [];
    const valid = list.filter(f => validFile(f, errs));
    if (errs.length) notify(errs.join(" · "), "error");
    if (!valid.length) return;

    // A saved workflow routes ONE document; the batch flow is single-approver.
    if (valid.length > 1 && presetWorkflow) {
      notify("A saved workflow takes one document — using the first file", "error");
      valid.length = 1;
    }

    if (valid.length === 1 && docs.length === 0) {
      const f = valid[0];
      const ext = f.name.split(".").pop().toLowerCase();
      const reader = new FileReader();
      reader.onload = () => {
        setFile({ name: f.name, base64: reader.result, type: f.type, ext, blob: f });
        setDocRotation(0);
        setMarkers([]);
        setWorkflow(presetWorkflow ? presetSteps() : []); // keep the saved route across file (re)loads
        setPlacingSlot(null);
        setDirectSigners([]);
        setSelfMarks([]); setSelfPlacing(null);
        setSignerDateFields([]); setSignerDatePlacing(false);
      };
      reader.readAsDataURL(f);
      return;
    }

    const loaded = await Promise.all(valid.map(readDoc));
    setFile(null);
    setDocs(prev => {
      const next = [...prev, ...loaded];
      if (next.length > MAX_DOCS) notify(`Up to ${MAX_DOCS} documents per batch`, "error");
      return next.slice(0, MAX_DOCS);
    });
  };

  // Rotate the document 90° clockwise per tap (0→90→180→270→0). Markers re-flow
  // with the page in the viewer; the final angle is baked into the file on submit.
  const rotate = () => setDocRotation(r => (r + 90) % 360);

  // ---------- aspect ratio to lock the marker rectangle to ----------
  // When placing a signer's marker in workflow mode, snap the rectangle to that
  // signer's signature aspect so the requestor sees the exact footprint that will
  // be stamped on approval. Single mode and unknown aspects fall back to free-form.
  const lockedAspect = useMemo(() => {
    if (mode !== "workflow" || !placingSlot) return null;
    if (placingSlot.kind === "date") return null; // date boxes are free-form
    const step = workflow[placingSlot.stepIdx];
    if (!step) return null;
    const signerSlot = step.signers?.[placingSlot.signerIdx];
    if (!signerSlot) return null;
    const team = teams.find(t => t.id === step.teamId);
    const approver = teamSigners(team).find(a => a.id === signerSlot.userId);
    const a = approver?.signatureAspect;
    return (a && a > 0 && isFinite(a)) ? a : null;
  }, [mode, placingSlot, workflow, teams]);

  // Whose signature is going in the next box? Its shape decides the box's shape.
  // A box that does not match leaves slack once the stamp is contain-fitted, and
  // that slack is what used to send requestors dragging corners.
  const activeAspect = useMemo(() => {
    const ok = a => (a && a > 0 && isFinite(a)) ? a : null;
    // The requestor placing their OWN signature.
    if (selfPlacing === "signature") return ok(user?.signatureAspect) || DEFAULT_SIGNATURE_ASPECT;
    if (lockedAspect) return lockedAspect;                       // workflow signer
    const di = placingSlot?.directIdx;                           // named individual
    if (mode === "direct" && di != null) {
      return ok(directSigners[di]?.signatureAspect) || DEFAULT_SIGNATURE_ASPECT;
    }
    // Single mode routes to a team, so the eventual signer is not known yet.
    return DEFAULT_SIGNATURE_ASPECT;
  }, [selfPlacing, user, lockedAspect, mode, placingSlot, directSigners]);

  // ---------- how big should the box be? ----------
  // The requestor chooses a HEIGHT; the width follows from the signature above.
  // Height is the only dimension that means anything for a signature, the same
  // way type is sized by height — and one control beats two.
  const [preset, setPresetState] = useState(getPreset);
  const choosePreset = (k) => { setPreset(k); setPresetState(k); };
  const placingDates = selfPlacing === "date" || signerDatePlacing || placingSlot?.kind === "date";
  const boxSpec = useMemo(() => placingDates
    ? { heightMm: DATE_HEIGHT_MM, aspect: DATE_ASPECT }
    : { heightMm: SIGNATURE_HEIGHTS_MM[preset], aspect: activeAspect },
    [placingDates, preset, activeAspect]);

  // ---------- markers shown on the doc ----------
  // The signer box(es) for the approver(s) AND the requestor's own self-signature /
  // date marks share ONE overlay so everything is placed on the same document view.
  // Self marks are green (`self-N` ids); signer boxes are gold / step-coloured.
  const allMarkers = useMemo(() => {
    const base = [];
    if (mode === "single") {
      markers.forEach((m, i) => base.push({
        ...m, id: `approver-${i}`,
        label: markers.length > 1 ? `SIGN HERE #${i + 1}` : "APPROVER SIGNS HERE"
      }));
    } else if (mode === "direct") {
      directSigners.forEach((s, di) => {
        (s.boxes || []).forEach((b, bi) => base.push({
          id: `d${di}-b${bi}`, page: b.page || 1, x: b.x, y: b.y, w: b.w, h: b.h,
          color: STEP_COLORS[di % STEP_COLORS.length],
          label: `${di + 1}. ${s.name}${(s.boxes.length > 1) ? ` #${bi + 1}` : ""}`
        }));
        (s.dateFields || []).forEach((d, fi) => base.push({
          id: `dd-${di}-${fi}`, page: d.page || 1, x: d.x, y: d.y, w: d.w, h: d.h,
          color: "#C77D2E", label: "date on signing"
        }));
      });
    } else {
      workflow.forEach((step, si) => {
        const team = teams.find(t => t.id === step.teamId);
        step.signers.forEach((s, gi) => {
          const u = teamSigners(team).find(a => a.id === s.userId);
          (s.boxes || []).forEach((b, bi) => base.push({
            id: `s${si}-${gi}-b${bi}`, page: b.page || 1, x: b.x, y: b.y, w: b.w, h: b.h,
            color: STEP_COLORS[si % STEP_COLORS.length],
            label: `${si + 1}.${gi + 1} ${u?.name || "?"}${(s.boxes.length > 1) ? ` #${bi + 1}` : ""}${team ? ` · ${team.name}` : ""}`
          }));
          // this signer's own date field(s), filled when THEY sign
          (s.dateFields || []).forEach((d, fi) => base.push({
            id: `sdw-${si}-${gi}-${fi}`, page: d.page || 1, x: d.x, y: d.y, w: d.w, h: d.h,
            color: "#C77D2E", label: "date on signing"
          }));
        });
      });
    }
    // signatory date field(s) for the single-approver path (direct dates are
    // per-signer, handled in the direct branch above)
    const sigDates = (mode === "single")
      ? signerDateFields.map((d, i) => ({
          id: `sd-${i}`, page: d.page || 1, x: d.x, y: d.y, w: d.w, h: d.h,
          color: "#C77D2E", label: "date on signing"
        }))
      : [];
    const self = selfMarks.map((s, i) => ({
      id: `self-${i}`, page: s.page || 1, x: s.x, y: s.y, w: s.w, h: s.h,
      color: "#3E8E5A",
      label: s.type === "date" ? todayDdMmYy : "Your signature",
      ...(s.type === "signature" && mySigUrl ? { signedDataUrl: mySigUrl } : {})
    }));
    return [...base, ...sigDates, ...self];
  }, [mode, markers, workflow, teams, directSigners, selfMarks, signerDateFields, mySigUrl, todayDdMmYy]);

  // ---------- click handler from PDF viewer ----------
  const onAddMarker = (page, x, y, w, h) => {
    // 1) requestor's own signature / date — stays active so you can drop many.
    if (selfPlacing) {
      setSelfMarks(ms => [...ms, { type: selfPlacing, page, x, y, w, h }]);
      return;
    }
    // 2) signatory's date field(s) on the SINGLE-approver path — also multi-place.
    if (signerDatePlacing && mode === "single") {
      setSignerDateFields(ds => [...ds, { page, x, y, w, h }]);
      return;
    }
    // 3) team-approver boxes — placement is armed by default; every click-drag
    //    ADDS a box so the approver can sign in several places.
    if (mode === "single") {
      setMarkers(ms => [...ms, { page, x, y, w, h }]);
      return;
    }
    // 3b) direct: place the currently-selected person's box / date fields. The
    //     person is auto-selected when added; clicking their row re-selects them.
    if (mode === "direct") {
      if (!placingSlot || placingSlot.directIdx == null) {
        notify("Add a person below — placing starts automatically", "info");
        return;
      }
      const { directIdx, kind } = placingSlot;
      if (kind === "date") {
        setDirectSigners(list => list.map((s, i) => i !== directIdx ? s : { ...s, dateFields: [...(s.dateFields || []), { page, x, y, w, h }] }));
        return; // keep active so multiple dates can be dropped
      }
      setDirectSigners(list => list.map((s, i) => i !== directIdx ? s : { ...s, boxes: [...(s.boxes || []), { page, x, y, w, h }] }));
      return; // keep active so several signature boxes can be dropped for this person
    }
    // 4) workflow: place either a signer's box or one of their date fields. The
    //    signer is auto-selected when added; each click-drag ADDS another box.
    if (!placingSlot) {
      notify("Pick a signer first — placing starts automatically when you add one", "info");
      return;
    }
    const { stepIdx, signerIdx, kind } = placingSlot;
    if (kind === "date") {
      setWorkflow(wf => wf.map((st, i) => i !== stepIdx ? st : {
        ...st,
        signers: st.signers.map((s, j) => j !== signerIdx ? s : { ...s, dateFields: [...(s.dateFields || []), { page, x, y, w, h }] })
      }));
      return; // keep the slot active to drop more dates
    }
    setWorkflow(wf => wf.map((st, i) => i !== stepIdx ? st : {
      ...st,
      signers: st.signers.map((s, j) => j !== signerIdx ? s : { ...s, boxes: [...(s.boxes || []), { page, x, y, w, h }] })
    }));
    // stays armed — several signature boxes for the same signer
  };

  // ---------- update / delete existing markers (drag handles + X button) ----------
  // Self marks (`self-N`) are checked first so they can be dragged / removed on the
  // same overlay as the signer boxes.
  const onUpdateMarker = (markerId, patch) => {
    const sm = /^self-(\d+)$/.exec(markerId || "");
    if (sm) { setSelfMarks(ms => ms.map((s, i) => i === Number(sm[1]) ? { ...s, ...patch } : s)); return; }
    const sd = /^sd-(\d+)$/.exec(markerId || "");
    if (sd) { setSignerDateFields(ds => ds.map((d, i) => i === Number(sd[1]) ? { ...d, ...patch } : d)); return; }
    const sdw = /^sdw-(\d+)-(\d+)-(\d+)$/.exec(markerId || "");
    if (sdw) {
      const si = Number(sdw[1]), gi = Number(sdw[2]), fi = Number(sdw[3]);
      setWorkflow(wf => wf.map((st, i) => i !== si ? st : {
        ...st,
        signers: st.signers.map((s, j) => j !== gi ? s : { ...s, dateFields: (s.dateFields || []).map((d, k) => k !== fi ? d : { ...d, ...patch }) })
      }));
      return;
    }
    // direct signer box (d{di}) and their date fields (dd-{di}-{fi})
    const ddm = /^dd-(\d+)-(\d+)$/.exec(markerId || "");
    if (ddm) {
      const di = Number(ddm[1]), fi = Number(ddm[2]);
      setDirectSigners(list => list.map((s, i) => i !== di ? s : { ...s, dateFields: (s.dateFields || []).map((d, k) => k !== fi ? d : { ...d, ...patch }) }));
      return;
    }
    const dbm = /^d(\d+)-b(\d+)$/.exec(markerId || "");
    if (dbm) {
      const di = Number(dbm[1]), bi = Number(dbm[2]);
      setDirectSigners(list => list.map((s, i) => i !== di ? s : { ...s, boxes: (s.boxes || []).map((b, k) => k !== bi ? b : { ...b, ...patch }) }));
      return;
    }
    const am = /^approver-(\d+)$/.exec(markerId || "");
    if (am) { setMarkers(ms => ms.map((m, i) => i === Number(am[1]) ? { ...m, ...patch } : m)); return; }
    // markerId is in form "s{stepIdx}-{signerIdx}-b{boxIdx}"
    const match = /^s(\d+)-(\d+)-b(\d+)$/.exec(markerId || "");
    if (!match) return;
    const stepIdx = Number(match[1]), signerIdx = Number(match[2]), boxIdx = Number(match[3]);
    setWorkflow(wf => wf.map((st, i) => i !== stepIdx ? st : {
      ...st,
      signers: st.signers.map((s, j) => j !== signerIdx ? s : { ...s, boxes: (s.boxes || []).map((b, k) => k !== boxIdx ? b : { ...b, ...patch }) })
    }));
  };
  const onDeleteMarker = (markerId) => {
    const sm = /^self-(\d+)$/.exec(markerId || "");
    if (sm) { setSelfMarks(ms => ms.filter((_, i) => i !== Number(sm[1]))); return; }
    const sd = /^sd-(\d+)$/.exec(markerId || "");
    if (sd) { setSignerDateFields(ds => ds.filter((_, i) => i !== Number(sd[1]))); return; }
    const sdw = /^sdw-(\d+)-(\d+)-(\d+)$/.exec(markerId || "");
    if (sdw) {
      const si = Number(sdw[1]), gi = Number(sdw[2]), fi = Number(sdw[3]);
      setWorkflow(wf => wf.map((st, i) => i !== si ? st : {
        ...st,
        signers: st.signers.map((s, j) => j !== gi ? s : { ...s, dateFields: (s.dateFields || []).filter((_, k) => k !== fi) })
      }));
      return;
    }
    // direct signer box (d{di}) / date (dd-{di}-{fi})
    const ddm = /^dd-(\d+)-(\d+)$/.exec(markerId || "");
    if (ddm) { const di = Number(ddm[1]), fi = Number(ddm[2]); setDirectSigners(list => list.map((s, i) => i !== di ? s : { ...s, dateFields: (s.dateFields || []).filter((_, k) => k !== fi) })); return; }
    const dbm = /^d(\d+)-b(\d+)$/.exec(markerId || "");
    if (dbm) { const di = Number(dbm[1]), bi = Number(dbm[2]); setDirectSigners(list => list.map((s, i) => i !== di ? s : { ...s, boxes: (s.boxes || []).filter((_, k) => k !== bi) })); return; }
    const am = /^approver-(\d+)$/.exec(markerId || "");
    if (am) { setMarkers(ms => ms.filter((_, i) => i !== Number(am[1]))); return; }
    const match = /^s(\d+)-(\d+)-b(\d+)$/.exec(markerId || "");
    if (!match) return;
    const stepIdx = Number(match[1]), signerIdx = Number(match[2]), boxIdx = Number(match[3]);
    setWorkflow(wf => wf.map((st, i) => i !== stepIdx ? st : {
      ...st,
      signers: st.signers.map((s, j) => j !== signerIdx ? s : { ...s, boxes: (s.boxes || []).filter((_, k) => k !== boxIdx) })
    }));
  };

  // --- "add your own" toolbar, rendered inside each mode's placement section so the
  //     requestor signs / dates the SAME document view where they place the signer box.
  //     Available for PDFs and Excel workbooks alike; only the Date box is PDF-only,
  //     since a floating dated text box has no spreadsheet equivalent.
  // Size control. Deliberately one dimension: pick how tall the signature should
  // be, and the width follows the signer's own signature so the fit is exact.
  // Date boxes size themselves from the text, so this is hidden while placing one.
  const sizeBar = (file && !placingDates) ? (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium opacity-80">Signature size:</span>
      {SIGNATURE_PRESETS.map(p => (
        <button key={p.key} type="button"
          className={`text-xs ${preset === p.key ? "btn-gold" : "btn-ghost"}`}
          title={`${SIGNATURE_HEIGHTS_MM[p.key]} mm tall on the page`}
          onClick={() => choosePreset(p.key)}>
          {p.label}
        </button>
      ))}
      <span className="opacity-50">
        {SIGNATURE_HEIGHTS_MM[preset]} mm tall — the width follows each signer&apos;s own signature,
        so it never stretches and never leaves a gap. Drag a corner to fine-tune.
      </span>
    </div>
  ) : null;

  const selfBar = file ? (
    <div className="mt-4 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium opacity-80 flex items-center gap-1">
          <Stamp size={13} style={{ color: "#3E8E5A" }} /> Add your own to this document:
        </span>
        <button type="button" disabled={!user.hasSignature}
          className={`text-xs ${selfPlacing === "signature" ? "btn-gold" : "btn-ghost"}`}
          title={user.hasSignature ? "" : "Register a signature first (top-right menu)"}
          onClick={() => { setPlacingSlot(null); setSignerDatePlacing(false); setSelfPlacing(selfPlacing === "signature" ? null : "signature"); }}>
          + My signature
        </button>
        {file.ext === "pdf" && (
          <button type="button"
            className={`text-xs ${selfPlacing === "date" ? "btn-gold" : "btn-ghost"}`}
            onClick={() => { setPlacingSlot(null); setSignerDatePlacing(false); setSelfPlacing(selfPlacing === "date" ? null : "date"); }}>
            + Date ({todayDdMmYy})
          </button>
        )}
        {selfMarks.length > 0 && (
          <span className="opacity-60">
            · {selfMarks.filter(m => m.type !== "date").length} signature + {selfMarks.filter(m => m.type === "date").length} date placed (green)
            <button type="button" className="underline ml-2" onClick={() => { setSelfMarks([]); setSelfPlacing(null); }}>clear</button>
          </span>
        )}
      </div>
      {selfPlacing && (
        <div className="mt-2 text-xs px-3 py-2 rounded" style={{ backgroundColor: "rgba(62,142,90,.18)", color: "var(--c-sand)" }}>
          Now press and hold — or click-drag — on the document above to place your {selfPlacing === "date" ? `date (${todayDdMmYy})` : "signature"}. You can place as many as you like.
          <button type="button" className="underline ml-2" onClick={() => setSelfPlacing(null)}>Cancel</button>
        </div>
      )}
      {!user.hasSignature && (
        <div className="mt-2 text-[11px] opacity-55">No registered signature yet — you can still add a date. To sign, register a signature from the top-right menu first.</div>
      )}
    </div>
  ) : null;

  // --- place date field(s) for the SIGNATORY (single / direct one-signer paths).
  //     Each stays blank until that person signs, then shows THEIR signing date.
  const signerDateBar = (mode === "single" && file?.ext === "pdf") ? (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium opacity-80 flex items-center gap-1">
        <Calendar size={13} style={{ color: "#C77D2E" }} /> Date for the signer:
      </span>
      <button type="button"
        className={`text-xs ${signerDatePlacing ? "btn-gold" : "btn-ghost"}`}
        onClick={() => { setSelfPlacing(null); setSignerDatePlacing(v => !v); }}>
        + Date field
      </button>
      {signerDateFields.length > 0 && (
        <span className="opacity-60">· {signerDateFields.length} placed (amber)
          <button type="button" className="underline ml-2" onClick={() => { setSignerDateFields([]); setSignerDatePlacing(false); }}>clear</button>
        </span>
      )}
      {signerDatePlacing && (
        <div className="w-full mt-1 text-xs px-3 py-2 rounded" style={{ backgroundColor: "rgba(199,125,46,.18)", color: "var(--c-sand)" }}>
          Press and hold — or click-drag — on the document to drop a date box. It stays blank until they sign, then shows their signing date. Place as many as you like.
          <button type="button" className="underline ml-2" onClick={() => setSignerDatePlacing(false)}>Cancel</button>
        </div>
      )}
    </div>
  ) : null;

  // ---------- workflow editing ----------
  const addStep = () => setWorkflow(wf => [...wf, { teamId: "", signers: [] }]);
  const removeStep = (i) => setWorkflow(wf => wf.filter((_, idx) => idx !== i));
  const setStepTeam = (i, teamId) => setWorkflow(wf => wf.map((s, idx) => idx === i ? { teamId, signers: [] } : s));
  // Adding a signer immediately arms signature placement for them — the requestor
  // just click-drags on the document; every drag adds another box for that signer.
  const addSigner = (stepIdx, userId) => {
    const newIdx = workflow[stepIdx]?.signers.length ?? 0;
    setWorkflow(wf => wf.map((s, i) => i !== stepIdx ? s : {
      ...s, signers: [...s.signers, { userId, boxes: [], dateFields: [] }]
    }));
    setSelfPlacing(null); setSignerDatePlacing(false);
    setPlacingSlot({ stepIdx, signerIdx: newIdx, kind: "signature" });
  };
  const removeSigner = (stepIdx, signerIdx) => setWorkflow(wf => wf.map((s, i) => i !== stepIdx ? s : {
    ...s, signers: s.signers.filter((_, j) => j !== signerIdx)
  }));
  // Signing SEQUENCE within a step: signers sign strictly in this order (the
  // server stores the index as signer_order and only activates the next one
  // after the previous has signed). Moving a signer keeps the placement
  // selection pointing at the same person.
  const moveSigner = (stepIdx, from, to) => {
    setWorkflow(wf => wf.map((st, i) => {
      if (i !== stepIdx) return st;
      if (to < 0 || to >= st.signers.length) return st;
      const signers = [...st.signers];
      const [moved] = signers.splice(from, 1);
      signers.splice(to, 0, moved);
      return { ...st, signers };
    }));
    setPlacingSlot(p => {
      if (!p || p.stepIdx !== stepIdx) return p;
      if (p.signerIdx === from) return { ...p, signerIdx: to };
      if (p.signerIdx === to) return { ...p, signerIdx: from };
      return p;
    });
  };

  // ---------- submit ----------
  const effectiveFile = !!file;
  const canSubmitSingle = effectiveFile && markers.length > 0 && targetTeam;
  const canSubmitWorkflow = effectiveFile && workflow.length > 0
    && workflow.every(st => st.teamId && st.signers.length > 0
        && st.signers.every(s => s.userId && (s.boxes || []).length > 0));
  const canSubmitDirect = effectiveFile && file?.ext === "pdf"
    && directSigners.length > 0 && directSigners.every(s => (s.boxes || []).length > 0);

  const submit = async () => {
    setBusy(true);
    try {
      const submitFile = file.blob;
      const selfArg = selfMarks.length > 0 ? selfMarks : undefined;
      const sdArg = signerDateFields.length > 0 ? signerDateFields : undefined;
      if (mode === "single") {
        if (!canSubmitSingle) { notify("Complete all steps first", "error"); return; }
        await addRequest({ file: submitFile, targetTeamId: targetTeam, marker: markers, selfMarks: selfArg, signerDateFields: sdArg, note, requestType, rotation: docRotation, confidential });
      } else if (mode === "direct") {
        if (!canSubmitDirect) { notify("Add at least one person and place each of their signature boxes", "error"); return; }
        await addRequest({ file: submitFile, direct: true, signers: directSigners.map(s => ({ userId: s.userId, boxes: s.boxes || [], dateFields: s.dateFields || [] })), selfMarks: selfArg, note, requestType, rotation: docRotation, confidential });
      } else {
        if (!canSubmitWorkflow) { notify("Complete the workflow — every signer needs a placed signature", "error"); return; }
        // Legacy x/y/w/h carries the first box for back-compat; boxes[] is the full list.
        const wfPayload = workflow.map(st => ({
          teamId: st.teamId,
          signers: st.signers.map(s => {
            const b0 = (s.boxes || [])[0];
            return { userId: s.userId, page: b0.page || 1, x: b0.x, y: b0.y, w: b0.w, h: b0.h, boxes: s.boxes, dateFields: s.dateFields || [] };
          })
        }));
        await addRequest({ file: submitFile, workflow: wfPayload, selfMarks: selfArg, note, requestType, rotation: docRotation, confidential });
      }
      notify("Request submitted", "success");
      onDone();
    } catch (e) {
      notify(e.message || "Submit failed", "error");
    } finally { setBusy(false); }
  };

  // Shared by the single-document form and the batch flow.
  const typeSection = (
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

            {/* Confidential — encrypted at rest, admin locked out, code needed to
                view. Hidden entirely when the server holds no key, so we never
                promise protection the backend cannot deliver. */}
            {confAvailable && (
              <label className="card p-4 mt-3 flex items-start gap-3 cursor-pointer tile-hover"
                style={{ borderLeft: "4px solid var(--c-gold)", backgroundColor: confidential ? "rgba(184,137,74,.08)" : undefined }}>
                <input type="checkbox" className="mt-1" checked={confidential}
                  onChange={e => setConfidential(e.target.checked)} />
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <Lock size={13} style={{ color: "var(--c-gold)" }} /> Confidential document
                  </div>
                  <div className="text-xs opacity-60 mt-0.5">
                    {confidential
                      ? "The approver will need MFA through an OTP to view this document. Stored encrypted — IT support cannot view or recover it. Untick to make this an ordinary request."
                      : "Stored encrypted. Only you and the signers can open it — IT support cannot view or recover it. Opening it needs a one-time code emailed to the viewer."}
                  </div>
                </div>
              </label>
            )}
          </Section>
  );

  // ---------- BATCH: several documents in one go ----------
  if (docs.length > 0) {
    return (
      <MultiDocFlow
        docs={docs} setDocs={setDocs} teams={teams} typeSection={typeSection}
        addRequest={addRequest} notify={notify} onDone={onDone}
        requestType={requestType} confidential={confidential}
        onAddFiles={handleFile} maxDocs={MAX_DOCS}
        onStartOver={() => setDocs([])}
      />
    );
  }

  return (
    <div>
      <BackHeader back={onDone} title="Make a new request" />
      <div className="card p-4 mt-6 sm:mt-8">
        <div className="text-[10px] tracking-widest uppercase opacity-50 mb-2">How this works</div>
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-2 text-xs sm:text-sm opacity-80">
          <li className="flex gap-2"><span className="font-mono opacity-50">01</span> Upload one document — or several at once.</li>
          <li className="flex gap-2"><span className="font-mono opacity-50">02</span> Choose single approver or multi-step workflow.</li>
          <li className="flex gap-2"><span className="font-mono opacity-50">03</span> Place each signer's box where it should appear.</li>
          <li className="flex gap-2"><span className="font-mono opacity-50">04</span> Submit. Each signer is notified in turn.</li>
        </ol>
      </div>
      <div className="space-y-6 mt-6 min-w-0">

          {/* 0. type */}
          {typeSection}

          {/* 1. upload (every request type, including leave, uploads its own document) */}
          <Section n="01" title="Upload documents" desc="PDF or Excel (.xlsx) up to 14 MB each. Pick several files to send a batch.">
            {!file ? (
              <label className="card p-10 flex flex-col items-center justify-center text-center cursor-pointer" style={{ borderStyle: "dashed" }}>
                <Upload size={24} className="opacity-50 mb-3" />
                <div className="font-medium">Click to select one or more files</div>
                <div className="text-xs opacity-60 mt-1">PDF · XLSX — up to {MAX_DOCS} at once</div>
                <input type="file" multiple className="hidden" accept=".pdf,.xlsx,.xls" onChange={handleFile} />
              </label>
            ) : (
              <div className="card p-5 flex items-center gap-4">
                {file.ext === "pdf" ? <FileText size={22} /> : <FileSpreadsheet size={22} />}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{file.name}</div>
                  <div className="text-xs opacity-60 uppercase tracking-wider">{file.ext}</div>
                </div>
                <button className="btn-ghost text-xs" onClick={() => { setFile(null); setDocRotation(0); setMarkers([]); setWorkflow([]); }}>
                  <X size={12} /> Remove
                </button>
              </div>
            )}
          </Section>

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
                  <div className="text-xs opacity-60 mt-1">Search one or more people and request their signatures directly.</div>
                </button>
              </div>
              {/* Instant vs 1-hour window is the APPROVER's choice at signing time,
                  not the requestor's — the old checkbox lived here. */}
            </Section>
          )}

          {/* 3a. single mode: pick team + place marker */}
          {effectiveFile && mode ==="single" && (
            <Section n="03" title="Mark the signature field" desc="Placing is on by default — every click-drag (or press-and-hold on a phone) adds a signature box, so the approver can sign in several places.">
              <div className="flex flex-col xl:flex-row gap-4">
                <div className="flex-1 min-w-0">
                  <Suspense fallback={<ViewerFallback />}>
                    <DocPreview file={file} markers={allMarkers} editable boxSpec={boxSpec}
                      onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} rotation={docRotation} onRotate={rotate} />
                  </Suspense>
                </div>
                <div className="w-full xl:w-72 shrink-0 space-y-3 xl:sticky xl:top-4 xl:self-start">
                  <div className="card p-4 space-y-3">
                    <div className="text-[10px] tracking-widest uppercase opacity-50">Placement</div>
                    {markers.length > 0 ? (
                      <div className="text-xs font-mono opacity-60">
                        {markers.length} signature box{markers.length > 1 ? "es" : ""} placed · click-drag adds more
                        <button className="ml-3 underline" onClick={() => setMarkers([])}>Clear all</button>
                      </div>
                    ) : (
                      <div className="text-xs opacity-60">Click-drag or press and hold on the document — each drag adds a signature box. Drag a box to move it, ✕ to remove.</div>
                    )}
                    {signerDateBar}
                    {sizeBar}
                    {selfBar}
                  </div>
                </div>
              </div>
            </Section>
          )}

          {effectiveFile && mode === "single" && markers.length > 0 && (
            <Section n="04" title="Route to signing authority" desc="Everyone with authority on this team will be notified.">
              <div className="grid sm:grid-cols-3 gap-3">
                {teams.map(t => {
                  const active = targetTeam === t.id;
                  const nApprovers = (t.approvers || []).length;
                  const nMembers = (t.members || []).length;
                  // "Any approver signs" needs a designated approver. A team with only
                  // members is still usable — via Multi-step workflow, where the
                  // requestor names the signers and their order.
                  const dead = nApprovers === 0;
                  return (
                    <button key={t.id} onClick={() => dead ? setMode("workflow") : setTargetTeam(t.id)}
                      title={dead ? "No approver designated yet — switch to Multi-step workflow to pick signers from this team" : ""}
                      className={`card p-4 text-left tile-hover ${active ? "ring-2" : ""}`}
                      style={{
                        borderColor: active ? "#B8894A" : undefined,
                        backgroundColor: active ? "rgba(184,137,74,.08)" : undefined,
                        opacity: dead ? 0.7 : 1
                      }}>
                      <Building2 size={18} className="mb-3 opacity-70" />
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs mt-1" style={dead ? { color: "var(--c-gold-deep)" } : { opacity: 0.6 }}>
                        {dead
                          ? (nMembers ? `${nMembers} member(s) — pick signers in workflow →` : "No members yet")
                          : `${nApprovers} approver(s)`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          {/* 3c. direct mode: add one or more specific people, each with a box */}
          {effectiveFile && mode ==="direct" && (
            <Section n="03" title="Choose who should sign" desc="Add one or more people — the same person can be added multiple times for multiple signatures.">
              {/* search + add people */}
              <input type="text" value={directQuery} onChange={e => setDirectQuery(e.target.value)}
                className="w-full mb-2" placeholder="Search by name or email to add a signer (min 2 characters)…" />
              {directSearching && <div className="text-xs opacity-50 px-1 mb-2">Searching…</div>}
              {(() => {
                const avail = directResults;
                if (!directSearching && directQuery.trim().length >= 2 && avail.length === 0)
                  return <div className="text-xs opacity-50 px-1 mb-2">No users found for "{directQuery}".</div>;
                if (avail.length === 0) return null;
                return (
                  <div className="space-y-1 mb-4">
                    {avail.map(u => (
                      <button key={u.id}
                        onClick={() => {
                          // adding a person immediately arms signature placement for them
                          const newIdx = directSigners.length;
                          setDirectSigners(list => [...list, { userId: u.id, name: u.name, email: u.email, hasSignature: u.hasSignature, signatureAspect: u.signatureAspect, boxes: [], dateFields: [] }]);
                          setDirectQuery("");
                          setSelfPlacing(null); setSignerDatePlacing(false);
                          setPlacingSlot({ directIdx: newIdx, kind: "signature" });
                        }}
                        className="w-full text-left px-3 py-2 rounded card tile-hover flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{u.name}</div>
                          <div className="text-xs opacity-60 font-mono truncate">{u.email}</div>
                        </div>
                        <span className="flex items-center gap-2 shrink-0">
                          {!u.hasSignature && <span className="pill pill-rejected text-[10px]">no signature yet</span>}
                          <span className="btn-ghost text-xs"><Plus size={11} /> Add</span>
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })()}

              {directSigners.length > 0 && (
                <div className="flex flex-col xl:flex-row gap-4">
                  <div className="flex-1 min-w-0">
                    <Suspense fallback={<ViewerFallback />}>
                      <DocPreview file={file} markers={allMarkers} editable boxSpec={boxSpec}
                        onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} rotation={docRotation} onRotate={rotate} />
                    </Suspense>
                  </div>
                  <div className="w-full xl:w-72 shrink-0 space-y-3 xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
                    {placingSlot?.directIdx != null && (
                      <div className="text-xs px-3 py-2 rounded" style={{ backgroundColor: placingSlot.kind === "date" ? "rgba(199,125,46,.18)" : "rgba(184,137,74,.18)", color: "var(--c-sand)" }}>
                        {placingSlot.kind === "date"
                          ? <span>Every click-drag drops a <b>date box</b> for {directSigners[placingSlot.directIdx]?.name}.{" "}
                              <button className="underline" onClick={() => setPlacingSlot(p => ({ ...p, kind: "signature" }))}>Back to signatures</button></span>
                          : <span>Every click-drag adds a <b>signature box</b> for {directSigners[placingSlot.directIdx]?.name} — add as many as they should sign. Tap another name to switch.</span>}
                      </div>
                    )}

                    <div className="card p-3">
                      <div className="text-[10px] tracking-widest uppercase opacity-50 mb-2">Signers</div>
                      <div className="space-y-2">
                        {directSigners.map((s, di) => {
                          const boxCount = (s.boxes || []).length;
                          const dfCount = (s.dateFields || []).length;
                          const here = placingSlot?.directIdx === di;
                          const isPlacingSig = here && placingSlot?.kind !== "date";
                          const isPlacingDate = here && placingSlot?.kind === "date";
                          const color = STEP_COLORS[di % STEP_COLORS.length];
                          return (
                            <div key={di} className="px-2 py-2 rounded cursor-pointer" role="button" tabIndex={0}
                              onClick={() => { setSelfPlacing(null); setSignerDatePlacing(false); setPlacingSlot({ directIdx: di, kind: "signature" }); }}
                              style={{
                                borderLeft: `3px solid ${color}`,
                                backgroundColor: here ? (isPlacingDate ? "rgba(199,125,46,.14)" : "rgba(184,137,74,.14)") : "rgba(15,26,46,.04)",
                                outline: here ? `1px solid ${isPlacingDate ? "#C77D2E" : "#B8894A"}` : "none",
                              }}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono text-[10px] opacity-50 shrink-0">{di + 1}</span>
                                <span className="text-xs font-medium truncate min-w-0 flex-1">{s.name}</span>
                                {isPlacingSig && <span className="text-[9px] shrink-0" style={{ color: "#B8894A", fontWeight: 600 }}>placing signs</span>}
                                {isPlacingDate && <span className="text-[9px] shrink-0" style={{ color: "#C77D2E", fontWeight: 600 }}>placing dates</span>}
                                <button className="opacity-40 hover:opacity-100 shrink-0" title="Remove"
                                  onClick={e => { e.stopPropagation(); setDirectSigners(list => list.filter((_, i) => i !== di)); setPlacingSlot(null); }}><X size={10} /></button>
                              </div>
                              {!s.hasSignature && <span className="pill pill-rejected text-[9px] mt-1 inline-block">no signature</span>}
                              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                {boxCount
                                  ? <span className="text-[10px] opacity-60 font-mono">{boxCount} sign{boxCount > 1 ? "s" : ""}{dfCount ? ` · ${dfCount} date` : ""}</span>
                                  : <span className="text-[10px] opacity-50">click-drag the document to add signs</span>}
                                {file.ext === "pdf" && (
                                  <button className={`text-[10px] ${isPlacingDate ? "btn-gold" : "btn-ghost"} !px-1.5 !py-0.5`}
                                    title="Switch to placing date field(s) for this signer"
                                    onClick={e => { e.stopPropagation(); setSelfPlacing(null); setSignerDatePlacing(false); setPlacingSlot(isPlacingDate ? { directIdx: di, kind: "signature" } : { directIdx: di, kind: "date" }); }}>
                                    Date
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {sizeBar}
                    {selfBar}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* 3b. workflow mode */}
          {effectiveFile && mode ==="workflow" && (
            <Section n="03" title="Build the workflow" desc="Add steps in the order they should sign. Within a step, list the signers in order.">
              <div className="flex flex-col xl:flex-row gap-4">
                <div className="flex-1 min-w-0">
                  <Suspense fallback={<ViewerFallback />}>
                    <DocPreview file={file} markers={allMarkers} editable boxSpec={boxSpec}
                      onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} rotation={docRotation} onRotate={rotate} />
                  </Suspense>
                </div>
                <div className="w-full xl:w-72 shrink-0 space-y-3 xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
                  {presetWorkflow && (
                    <div className="text-xs px-3 py-2 rounded flex items-center gap-2" style={{ backgroundColor: "rgba(45,95,47,.14)", color: "var(--c-sand)" }}>
                      <GitBranch size={12} className="shrink-0" />
                      <span>Using saved workflow <b>{presetWorkflow.name}</b> — tap each signer and place their boxes on the document.</span>
                    </div>
                  )}
                  {placingSlot && (
                    <div className="text-xs px-3 py-2 rounded" style={{ backgroundColor: placingSlot.kind === "date" ? "rgba(199,125,46,.18)" : "rgba(184,137,74,.18)", color: "var(--c-sand)" }}>
                      {placingSlot.kind === "date"
                        ? <span>Every click-drag drops a <b>date box</b> — it fills with their signing date.{" "}
                            <button className="underline" onClick={() => setPlacingSlot(p => ({ ...p, kind: "signature" }))}>Back to signatures</button></span>
                        : <>Every click-drag adds a <b>signature box</b> for the selected signer — add as many as they should sign.{" "}
                          {lockedAspect
                            ? <span>Aspect locked to the signer's signature.</span>
                            : <span>(Aspect locks once signer uploads a signature.)</span>}</>}
                    </div>
                  )}
                  {sizeBar}
                  {selfBar}

                  <div className="space-y-3">
                    {workflow.map((step, si) => {
                      const team = teams.find(t => t.id === step.teamId);
                      const stepColor = STEP_COLORS[si % STEP_COLORS.length];
                      return (
                        <div key={si} className="card p-3" style={{ borderLeft: `3px solid ${stepColor}` }}>
                          <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="font-mono text-[10px] opacity-50 shrink-0">Step {si + 1}</span>
                              {/* w-full + min-w-0 lets the select SHRINK inside the narrow side
                                  panel — its intrinsic width (longest team name) otherwise
                                  bursts the card and forces a horizontal scrollbar. */}
                              <select value={step.teamId} onChange={e => setStepTeam(si, e.target.value)}
                                className="text-xs w-full min-w-0" style={{ maxWidth: "100%" }}>
                                <option value="">— team —</option>
                                {/* Every team is selectable: those without a designated
                                    approver fall back to their own members as signers. */}
                                {teams.map(t => {
                                  const n = teamSigners(t).length;
                                  return <option key={t.id} value={t.id}>{t.name}{n === 0 ? " — no members yet" : ""}</option>;
                                })}
                              </select>
                            </div>
                            <button className="btn-ghost text-[10px] shrink-0" onClick={() => removeStep(si)}><Trash2 size={10} /></button>
                          </div>
                          {team && usesMembers(team) && (
                            <div className="text-[10px] mb-2 px-2 py-1 rounded" style={{ backgroundColor: "rgba(184,137,74,.12)", color: "var(--c-sand)" }}>
                              No approver designated for {team.name} — choosing from its {(team.members || []).length} member(s).
                            </div>
                          )}

                          {team && (
                            <div className="space-y-1.5">
                              {step.signers.map((s, gi) => {
                                const u = teamSigners(team).find(a => a.id === s.userId);
                                const boxCount = (s.boxes || []).length;
                                const dfCount = (s.dateFields || []).length;
                                const here = placingSlot?.stepIdx === si && placingSlot?.signerIdx === gi;
                                const isPlacingSig = here && placingSlot?.kind !== "date";
                                const isPlacingDate = here && placingSlot?.kind === "date";
                                return (
                                  <div key={gi} className="px-2 py-1.5 rounded cursor-pointer" role="button" tabIndex={0}
                                    onClick={() => { setSelfPlacing(null); setSignerDatePlacing(false); setPlacingSlot({ stepIdx: si, signerIdx: gi, kind: "signature" }); }}
                                    style={{
                                      backgroundColor: here ? (isPlacingDate ? "rgba(199,125,46,.14)" : "rgba(184,137,74,.14)") : "rgba(15,26,46,.04)",
                                      outline: here ? `1px solid ${isPlacingDate ? "#C77D2E" : "#B8894A"}` : "none",
                                    }}>
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {/* signing order within this step — 1st signs, then 2nd… */}
                                      <span className="text-[9px] font-semibold shrink-0 px-1.5 py-0.5 rounded"
                                        title={`Signs ${ord(gi + 1)} in step ${si + 1}`}
                                        style={{ backgroundColor: `${stepColor}22`, color: stepColor }}>{ord(gi + 1)}</span>
                                      <span className="text-xs font-medium truncate min-w-0 flex-1" title={u?.name || ""}>{u?.name || "?"}</span>
                                      {isPlacingSig && <span className="text-[9px] shrink-0" style={{ color: "#B8894A", fontWeight: 600 }}>placing signs</span>}
                                      {isPlacingDate && <span className="text-[9px] shrink-0" style={{ color: "#C77D2E", fontWeight: 600 }}>placing dates</span>}
                                      {step.signers.length > 1 && (
                                        <span className="flex items-center shrink-0">
                                          <button className="opacity-40 hover:opacity-100 disabled:opacity-15" title="Sign earlier"
                                            disabled={gi === 0}
                                            onClick={e => { e.stopPropagation(); moveSigner(si, gi, gi - 1); }}><ChevronUp size={11} /></button>
                                          <button className="opacity-40 hover:opacity-100 disabled:opacity-15" title="Sign later"
                                            disabled={gi === step.signers.length - 1}
                                            onClick={e => { e.stopPropagation(); moveSigner(si, gi, gi + 1); }}><ChevronDown size={11} /></button>
                                        </span>
                                      )}
                                      <button className="opacity-40 hover:opacity-100 shrink-0" onClick={e => { e.stopPropagation(); removeSigner(si, gi); setPlacingSlot(null); }}><X size={10} /></button>
                                    </div>
                                    {!u?.hasSignature && <span className="pill pill-rejected text-[9px] mt-0.5 inline-block">no signature</span>}
                                    <div className="flex flex-wrap items-center gap-1 mt-1">
                                      {boxCount
                                        ? <span className="text-[10px] opacity-60 font-mono">{boxCount} sign{boxCount > 1 ? "s" : ""}{dfCount ? ` · ${dfCount} date` : ""}</span>
                                        : <span className="text-[10px] opacity-50">click-drag the document to add signs</span>}
                                      {file.ext === "pdf" && (
                                        <button className={`text-[10px] ${isPlacingDate ? "btn-gold" : "btn-ghost"} !px-1.5 !py-0.5`}
                                          title="Switch to placing date field(s) for this signer"
                                          onClick={e => { e.stopPropagation(); setSelfPlacing(null); setSignerDatePlacing(false); setPlacingSlot(isPlacingDate ? { stepIdx: si, signerIdx: gi, kind: "signature" } : { stepIdx: si, signerIdx: gi, kind: "date" }); }}>
                                          Date
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                              <AddSignerControl team={team} existing={step.signers.map(s => s.userId)} onAdd={uid => addSigner(si, uid)} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button className="btn-ghost w-full justify-center text-xs" onClick={addStep}><Plus size={11} /> Add step</button>
                    {workflow.length > 0 && workflow.every(st => st.teamId && st.signers.length > 0) && (
                      <button className="btn-ghost w-full justify-center text-xs" style={{ color: "var(--c-forest)" }}
                        title="Save these steps and signers as a reusable workflow (boxes are placed per document)"
                        onClick={async () => {
                          const name = window.prompt("Name this workflow (e.g. \"PO approval — 5 steps\"):", presetWorkflow?.name || "");
                          if (!name || !name.trim()) return;
                          try {
                            await api.createWorkflowTemplate({ name: name.trim(), steps: workflow.map(st => ({ teamId: st.teamId, signers: st.signers.map(s => s.userId) })) });
                            notify(`"${name.trim()}" saved to My Workflows`, "success");
                          } catch (e) { notify(e.message || "Could not save the workflow", "error"); }
                        }}>
                        <Save size={11} /> Save as My Workflow
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Section>
          )}

          {/* 5. submit */}
          {effectiveFile && (mode === "single" ? (markers.length > 0 && targetTeam) : mode === "direct" ? directSigners.length > 0 : workflow.length > 0) && (
            <Section n={mode === "single" ? "05" : "04"} title="Add a note (optional)" desc="">
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
    </div>
  );
}

function AddSignerControl({ team, existing, onAdd }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Designated approvers, or the team's own members when none are designated.
  const all = teamSigners(team);
  const available = all.filter(a => !existing.includes(a.id));
  // Only a team with nobody at all is a dead end.
  if (all.length === 0) return (
    <div className="text-xs px-3 py-2 rounded" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
      <b>{team.name}</b> has no approvers or members yet — pick a different team, or ask the administrator to assign people to it under <b>Teams &amp; authority</b>.
    </div>
  );
  if (available.length === 0) return <div className="text-xs opacity-50 italic px-3">Everyone in this team is already added.</div>;
  return (
    <div className="relative">
      <button className="btn-ghost text-xs w-full justify-center" onClick={() => setPickerOpen(o => !o)}>
        <Plus size={11} /> Add signer{existing.length > 0 ? ` (signs ${ord(existing.length + 1)})` : ""}
      </button>
      {pickerOpen && (
        <div className="absolute left-0 right-0 mt-1 z-10 card p-2 shadow-lg" style={{ backgroundColor: "var(--c-paper)" }}>
          {available.map(a => (
            <button key={a.id} className="w-full text-left px-3 py-2 hover:opacity-70 text-sm flex items-center justify-between gap-2 min-w-0"
              onClick={() => { onAdd(a.id); setPickerOpen(false); }}>
              <span className="truncate min-w-0" title={a.name}>{a.name}</span>
              {!a.hasSignature && <span className="pill pill-rejected text-[10px] shrink-0">no signature</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
//   BATCH — several documents in one submission.
//   ------------------------------------------------------------
//   Each document becomes its own request through the existing create API, so
//   tracking, reminders, reports and the approver's tools stay per-document —
//   including batch approve (checkboxes on Pending approvals) and rejecting
//   any single document on its own.
// ============================================================
// A debounced directory search that resolves to ONE person — the batch flow
// routes to people, not teams, so any user can be the approver (matching the
// any-role-approver rule set earlier). Excludes the caller server-side.
function UserPick({ value, onPick, onClear, placeholder }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { setResults(await api.searchUsers(query)); }
      catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="card px-3 py-2 inline-flex items-center gap-2" style={{ backgroundColor: "rgba(184,137,74,.08)" }}>
        <span className="text-sm font-medium">{value.name}</span>
        <span className="text-xs opacity-50">{value.email}</span>
        <button className="btn-ghost !p-0.5" title="Choose someone else" onClick={onClear}><X size={12} /></button>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 420 }}>
      <input type="text" value={q} onChange={e => setQ(e.target.value)} className="w-full text-sm"
        placeholder={placeholder || "Search any user by name or email (min 2 characters)…"} />
      {searching && <div className="text-xs opacity-50 px-1 mt-1">Searching…</div>}
      {!searching && q.trim().length >= 2 && results.length === 0 && (
        <div className="text-xs opacity-50 px-1 mt-1">No users found.</div>
      )}
      {results.length > 0 && (
        <div className="card mt-1 divide-y" style={{ borderColor: "var(--c-ink-08)" }}>
          {results.map(u => (
            <button key={u.id} className="w-full text-left px-3 py-2 text-sm hover:opacity-80 flex items-center justify-between gap-2"
              onClick={() => { onPick({ userId: u.id, name: u.name, email: u.email }); setQ(""); setResults([]); }}>
              <span className="font-medium truncate">{u.name}</span>
              <span className="text-xs opacity-50 truncate">{u.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MultiDocFlow({ docs, setDocs, typeSection, addRequest, notify, onDone, requestType, confidential, onAddFiles, maxDocs, onStartOver }) {
  const [routing, setRouting] = useState(null);   // null | "same" | "different"
  const [approverAll, setApproverAll] = useState(null); // {userId, name, email}
  const [active, setActive] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const doc = docs[Math.min(active, docs.length - 1)];

  const removeDoc = (i) => {
    setDocs(prev => prev.filter((_, k) => k !== i));
    setActive(a => Math.max(0, Math.min(i <= a ? a - 1 : a, docs.length - 2)));
  };

  const patchDoc = (i, patch) => setDocs(prev => prev.map((d, k) => k === i ? { ...d, ...patch } : d));

  // ---- placement on the active document ----
  const markers = (doc?.markers || []).map((m, i) => ({
    id: "mm-" + i, page: m.page || 1, x: m.x, y: m.y, w: m.w, h: m.h,
    color: "#B8894A", label: "Approver sign #" + (i + 1),
  }));
  const idx = (id) => { const m = /^mm-(\d+)$/.exec(id || ""); return m ? Number(m[1]) : -1; };
  const onAddMarker = (page, x, y, w, h) =>
    patchDoc(active, { markers: [...doc.markers, { page, x, y, w, h }] });
  const onUpdateMarker = (id, patch) => {
    const i = idx(id); if (i < 0) return;
    patchDoc(active, { markers: doc.markers.map((m, k) => k === i ? { ...m, ...patch } : m) });
  };
  const onDeleteMarker = (id) => {
    const i = idx(id); if (i < 0) return;
    patchDoc(active, { markers: doc.markers.filter((_, k) => k !== i) });
  };

  const approverFor = (d) => routing === "same" ? approverAll : d.approver;
  const docReady = (d) => d.markers.length > 0 && !!(approverFor(d) && approverFor(d).userId);
  const allReady = routing && docs.length > 0 && docs.every(docReady);
  const notReadyCount = docs.filter(d => !docReady(d)).length;

  // ---- submit: one request per document; failures stay in the queue ----
  const submit = async () => {
    setBusy(true);
    const failed = [];
    const okIdx = new Set();
    const createdIds = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      setProgress("Sending " + (i + 1) + " of " + docs.length + "…");
      try {
        const person = approverFor(d);
        // deferNotify: the per-document email is held back; after the loop one
        // summary email per signer lists every document by name.
        const r = await addRequest({
          file: d.blob, direct: true,
          signers: [{ userId: person.userId,
            boxes: d.markers.map(m => ({ page: m.page || 1, x: m.x, y: m.y, w: m.w, h: m.h })),
            dateFields: [] }],
          note, requestType, confidential, deferNotify: true,
        });
        if (r?.request?.id) createdIds.push(r.request.id);
        okIdx.add(i);
      } catch (e) { failed.push(d.name + ": " + (e.message || "failed")); }
    }
    // One summary notice per signer, listing their documents by name. If this
    // fails the requests still exist and show in the approver's Awaiting list —
    // only the notification is lost, so warn rather than fail the batch.
    if (createdIds.length > 0) {
      try { await api.notifyBatch(createdIds); }
      catch { notify("Requests sent, but the notification email may not have gone out", "error"); }
    }
    setProgress("");
    setBusy(false);
    if (failed.length === 0) {
      notify(docs.length + " request" + (docs.length === 1 ? "" : "s") + " sent", "success");
      onDone();
    } else {
      // Successful ones leave the queue; the rest stay so they can be resent.
      setDocs(prev => prev.filter((_, i) => !okIdx.has(i)));
      setActive(0);
      notify("Sent " + okIdx.size + " of " + docs.length + ". Still here — " + failed.join(" · "), "error");
    }
  };

  return (
    <div>
      <BackHeader back={onDone} title="Make a new request" step={docs.length + " document" + (docs.length === 1 ? "" : "s")} />
      <div className="space-y-6 mt-6 min-w-0">
        {typeSection}

        {/* 01 — the batch */}
        <Section n="01" title={"Documents (" + docs.length + "/" + maxDocs + ")"} desc="Each document becomes its own request with its own tracking.">
          <div className="flex flex-wrap items-center gap-2">
            {docs.map((d, i) => (
              <div key={i}
                className={"card px-3 py-2 flex items-center gap-2 cursor-pointer " + (i === active ? "ring-2" : "")}
                style={{ backgroundColor: i === active ? "rgba(184,137,74,.08)" : undefined }}
                onClick={() => setActive(i)}>
                {d.ext === "pdf" ? <FileText size={14} /> : <FileSpreadsheet size={14} />}
                <span className="text-sm truncate" style={{ maxWidth: 180 }}>{d.name}</span>
                {docReady(d)
                  ? <span className="text-[10px] font-mono" style={{ color: "var(--c-forest)" }}>✓ {d.markers.length}</span>
                  : <span className="text-[10px] opacity-50 font-mono">{d.markers.length || "–"}</span>}
                <button className="btn-ghost !p-0.5" title="Remove this document"
                  onClick={e => { e.stopPropagation(); removeDoc(i); }}><X size={12} /></button>
              </div>
            ))}
            {docs.length < maxDocs && (
              <label className="card px-3 py-2 flex items-center gap-2 cursor-pointer tile-hover" style={{ borderStyle: "dashed" }}>
                <Plus size={14} className="opacity-60" /><span className="text-sm opacity-70">Add more</span>
                <input type="file" multiple className="hidden" accept=".pdf,.xlsx,.xls" onChange={onAddFiles} />
              </label>
            )}
            <button className="btn-ghost text-xs" onClick={onStartOver}>Start over</button>
          </div>
        </Section>

        {/* 02 — the question: one approver for everything, or per document? */}
        <Section n="02" title="Who approves these documents?" desc="Will the batch go to a single approver, or a different one per document? Search by name or email — any user can approve.">
          <div className="grid sm:grid-cols-2 gap-3">
            <button onClick={() => setRouting("same")}
              className={"card p-4 text-left tile-hover " + (routing === "same" ? "ring-2" : "")}
              style={{ borderLeft: "4px solid var(--c-gold)", backgroundColor: routing === "same" ? "rgba(184,137,74,.08)" : undefined }}>
              <div className="text-sm font-medium flex items-center gap-1.5"><Building2 size={14} /> A single approver for all</div>
              <div className="text-xs opacity-60 mt-0.5">Pick one person once — then just place the signature boxes on each document.</div>
            </button>
            <button onClick={() => setRouting("different")}
              className={"card p-4 text-left tile-hover " + (routing === "different" ? "ring-2" : "")}
              style={{ borderLeft: "4px solid #0F1A2E", backgroundColor: routing === "different" ? "rgba(15,26,46,.05)" : undefined }}>
              <div className="text-sm font-medium flex items-center gap-1.5"><GitBranch size={14} /> A different approver per document</div>
              <div className="text-xs opacity-60 mt-0.5">Choose a person for each document as you place its boxes.</div>
            </button>
          </div>
          {routing === "same" && (
            <div className="mt-3">
              <UserPick value={approverAll} onPick={setApproverAll} onClear={() => setApproverAll(null)} />
            </div>
          )}
        </Section>

        {/* 03 — placement, one document at a time */}
        {routing && doc && (
          <Section n="03" title={"Place the signature boxes — " + doc.name}
            desc={"Document " + Math.min(active + 1, docs.length) + " of " + docs.length + ". Click-drag on the document; every drag adds another box."}>
            {routing === "different" && (
              <div className="mb-3">
                <UserPick value={doc.approver || null}
                  onPick={p => patchDoc(active, { approver: p })}
                  onClear={() => patchDoc(active, { approver: null })}
                  placeholder={"Who signs " + doc.name + "? Search by name or email…"} />
              </div>
            )}
            <Suspense fallback={<ViewerFallback />}>
              <DocPreview key={active + "-" + doc.name} file={doc} markers={markers} editable
                boxSpec={{ heightMm: SIGNATURE_HEIGHTS_MM.standard, aspect: DEFAULT_SIGNATURE_ASPECT }}
                onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} />
            </Suspense>
            <div className="flex items-center justify-between mt-3 text-xs">
              <button className="btn-ghost" disabled={active === 0} onClick={() => setActive(a => a - 1)}>&lsaquo; Previous document</button>
              <span className="opacity-60">{doc.markers.length} box{doc.markers.length === 1 ? "" : "es"} on this document</span>
              <button className="btn-ghost" disabled={active >= docs.length - 1} onClick={() => setActive(a => a + 1)}>Next document &rsaquo;</button>
            </div>
          </Section>
        )}

        {/* 04 — note + send */}
        {routing && (
          <Section n="04" title="Send the batch" desc="One note goes on every request in this batch.">
            <input type="text" value={note} onChange={e => setNote(e.target.value)} maxLength={300}
              placeholder="Optional note for the approver(s)…" className="w-full mb-3" />
            {!allReady && (
              <div className="text-xs mb-3 px-3 py-2 rounded inline-block" style={{ backgroundColor: "rgba(184,137,74,.10)", color: "#8B6914" }}>
                {notReadyCount} document{notReadyCount === 1 ? " still needs" : "s still need"} an approver and at least one signature box.
              </div>
            )}
            <div className="flex justify-end">
              <button className="btn-primary" disabled={!allReady || busy} onClick={submit}>
                <Send size={14} /> {busy ? (progress || "Sending…") : "Send " + docs.length + " request" + (docs.length === 1 ? "" : "s")}
              </button>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
