import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { PenLine, Check } from "lucide-react";
import { api } from "../../api.js";
import { ModalShell } from "../../components/ModalShell.jsx";
import { stageColour } from "./time.js";

const DocPreview = lazy(() => import("../../viewer.jsx").then((m) => ({ default: m.DocPreview })));

// Lay out EVERY signature box on one view of the page.
//
// Placing them one stage at a time, days apart, means never seeing them
// together — and no way to tell whether the third signature will land on top of
// the second. Here each signatory gets a colour, you pick whose box you are
// placing, and the whole page shows the finished layout as you build it.
//
// Marker ids carry their stage, because the viewer hands back only an id when a
// box is dragged or deleted and we have to know whose it was.
const markerId = (stageId, i) => `${stageId}::${i}`;
const parseMarkerId = (id) => {
  const at = String(id).lastIndexOf("::");
  return at < 0 ? null : { stageId: String(id).slice(0, at), index: Number(String(id).slice(at + 2)) };
};

export function PlanSignatures({ doc, stages, onSaved, onClose }) {
  const signatureStages = useMemo(
    () => (stages || []).filter((s) => s.kind === "signature" || (!s.kind && s.requiresSignature)),
    [stages]);

  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [byStage, setByStage] = useState(() => {
    const seed = {};
    for (const s of signatureStages) seed[s.id] = (doc.plannedBoxes?.[s.id] || []).map((b) => ({ ...b }));
    return seed;
  });
  const [active, setActive] = useState(signatureStages[0]?.id || "");

  useEffect(() => {
    let url = null, dead = false;
    api.eaDocumentFileUrl(doc.id)
      .then((u) => {
        if (dead) { URL.revokeObjectURL(u); return; }
        url = u;
        setFile({ name: doc.fileName, ext: doc.fileType === "pdf" ? "pdf" : "xlsx", base64: u });
      })
      .catch((e) => setErr(e.message || "Could not open the document"));
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [doc.id]);

  // Every stage's boxes at once — that is the point of this screen. The colour
  // is the stage's own board colour, so a box here and a column there are
  // recognisably the same person.
  const markers = signatureStages.flatMap((s) => {
    const i = (stages || []).findIndex((x) => x.id === s.id);
    return (byStage[s.id] || []).map((b, n) => ({
      ...b,
      id: markerId(s.id, n),
      color: stageColour(i < 0 ? 0 : i),
      label: `${s.signer?.name || s.name}${(byStage[s.id] || []).length > 1 ? ` #${n + 1}` : ""}`,
    }));
  });

  const onAddMarker = (page, x, y, w, h) => {
    if (!active) return;
    setByStage((prev) => ({ ...prev, [active]: [...(prev[active] || []), { page, x, y, w, h }] }));
  };
  const onUpdateMarker = (id, patch) => {
    const at = parseMarkerId(id);
    if (!at) return;
    setByStage((prev) => ({
      ...prev,
      [at.stageId]: (prev[at.stageId] || []).map((b, i) => (i === at.index ? { ...b, ...patch } : b)),
    }));
  };
  const onDeleteMarker = (id) => {
    const at = parseMarkerId(id);
    if (!at) return;
    setByStage((prev) => ({ ...prev, [at.stageId]: (prev[at.stageId] || []).filter((_, i) => i !== at.index) }));
  };

  const placed = signatureStages.filter((s) => (byStage[s.id] || []).length).length;

  const save = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.eaPlanBoxes(doc.id, byStage);
      onSaved(r.document);
    } catch (e) { setErr(e.message || "Could not save the layout"); setBusy(false); }
  };

  if (!signatureStages.length) {
    return (
      <ModalShell title="Signature boxes" onClose={onClose}>
        <div className="text-sm opacity-70">
          No stage on this board asks for a signature yet, so there is nothing to lay out.
          Set a stage to <span className="font-medium">Needs a signature</span> first.
        </div>
        <div className="flex justify-end pt-4"><button className="btn-ghost" onClick={onClose}>Close</button></div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title={`Signature boxes — ${doc.title}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm opacity-70">
          Place a box for each person who will sign. They are still asked in turn, as the card
          reaches their stage — this only decides <span className="font-medium">where</span> each
          signature goes, so you can see the whole page at once.
        </div>

        {/* Whose box the next click-drag belongs to. */}
        <div className="flex flex-wrap gap-1.5">
          {signatureStages.map((s) => {
            const i = (stages || []).findIndex((x) => x.id === s.id);
            const n = (byStage[s.id] || []).length;
            const on = active === s.id;
            return (
              <button key={s.id} onClick={() => setActive(s.id)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
                style={on
                  ? { backgroundColor: "var(--c-ink)", color: "var(--c-cream)" }
                  : { backgroundColor: "rgba(15,26,46,.06)" }}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stageColour(i < 0 ? 0 : i) }} />
                <span className="max-w-[10rem] truncate">{s.signer?.name || s.name}</span>
                {n > 0 ? <Check size={12} /> : <span className="opacity-60">· none</span>}
              </button>
            );
          })}
        </div>

        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-ink-10)", minHeight: 320 }}>
          {file ? (
            <Suspense fallback={<div className="p-10 text-sm opacity-50 text-center">Opening the document…</div>}>
              <DocPreview file={file} markers={markers} editable
                onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} />
            </Suspense>
          ) : <div className="p-10 text-sm opacity-50 text-center">{err || "Opening the document…"}</div>}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs opacity-60">
            {placed} of {signatureStages.length} {signatureStages.length === 1 ? "signatory" : "signatories"} placed
            {/* A stage left empty is not an error — it will ask when the card
                gets there, exactly as it does today. */}
            {placed < signatureStages.length && " · the rest will be asked for when the card reaches them"}
          </div>
          {err && file && <div className="text-xs" style={{ color: "var(--c-rust)" }}>{err}</div>}
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-gold" disabled={busy} onClick={save}>
              <PenLine size={14} /> {busy ? "Saving…" : "Save the layout"}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
