import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { PenLine, Check, Eye, Minus, ChevronDown } from "lucide-react";
import { api } from "../../api.js";
import { ModalShell } from "../../components/ModalShell.jsx";
import { ROLE_LABELS } from "../../lib/constants.js";
import { stageColour } from "./time.js";

const DocPreview = lazy(() => import("../../viewer.jsx").then((m) => ({ default: m.DocPreview })));

// Lay out EVERY signature box on one view of the page.
//
// Placing them one stage at a time, days apart, means never seeing them
// together — and no way to tell whether the third signature will land on top of
// the second. Here each signatory gets a colour, you pick whose box you are
// placing, and the whole page shows the finished layout as you build it.
//
// It also decides, per stage, WHETHER a signature is wanted at all: a column
// that asks nobody has no box to place, and the commonest reason a signatory
// looks "missing" from this screen is that their column was never set to ask
// for one. Answering that here, rather than in a separate stage editor, means
// the question is settled where it is actually being asked.
//
// Marker ids carry their stage, because the viewer hands back only an id when a
// box is dragged or deleted and we have to know whose it was.
const markerId = (stageId, i) => `${stageId}::${i}`;
const parseMarkerId = (id) => {
  const at = String(id).lastIndexOf("::");
  return at < 0 ? null : { stageId: String(id).slice(0, at), index: Number(String(id).slice(at + 2)) };
};

const kindOf = (s) => s?.kind || (s?.requiresSignature ? "signature" : "plain");

// The three things a column can ask of a person, in the words this screen uses.
// "Reads" is the CC stage: shown the document, never asked to sign.
const ASKS = [
  ["plain", "No one", Minus],
  ["signature", "Signs", PenLine],
  ["cc", "Reads", Eye],
];

export function PlanSignatures({ doc, stages, executives, onSaved, onStagesChanged, onClose }) {
  const signatureStages = useMemo(
    () => (stages || []).filter((s) => kindOf(s) === "signature"), [stages]);

  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savingStage, setSavingStage] = useState(null);
  // Which stage's reader list is open. Tick boxes for several people need room,
  // so only one stage shows them at a time.
  const [openCc, setOpenCc] = useState(null);
  const [byStage, setByStage] = useState(() => {
    const seed = {};
    for (const s of signatureStages) seed[s.id] = (doc.plannedBoxes?.[s.id] || []).map((b) => ({ ...b }));
    return seed;
  });
  const [active, setActive] = useState(signatureStages[0]?.id || "");

  // A stage can stop asking for a signature while this is open. Keep the chip
  // selection on one that still has somewhere to put a box.
  useEffect(() => {
    if (!signatureStages.some((s) => s.id === active)) setActive(signatureStages[0]?.id || "");
  }, [signatureStages, active]);

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

  // Changing what a stage asks for changes the BOARD, not this document, so it
  // is saved there and then — the layout's own Save button covers the boxes.
  const setAsk = async (stage, kind, extra) => {
    if (savingStage) return;
    if (kind === "cc" && !extra?.ccIds?.length && !(stage.ccPeople || []).length) {
      // A reading stage with nobody on it would be refused by the server. Open
      // the list instead of failing, so the next click is the useful one.
      setOpenCc(stage.id);
      return;
    }
    setSavingStage(stage.id); setErr(null);
    try {
      await api.eaUpdateStage(stage.id, {
        name: stage.name,
        kind,
        // Still sent, so a server mid-deploy that knows only this flag cannot
        // read a reading stage as one that demands a signature.
        requiresSignature: kind === "signature",
        signerId: kind === "signature" ? (extra?.signerId || stage.signer?.id || executives[0]?.id || null) : null,
        ccUserIds: kind === "cc" ? (extra?.ccIds || (stage.ccPeople || []).map((p) => p.id)) : [],
      });
      // Boxes for a stage that no longer signs are not a layout any more. Drop
      // them here rather than letting the save be refused later.
      if (kind !== "signature") setByStage((prev) => { const next = { ...prev }; delete next[stage.id]; return next; });
      if (kind !== "cc") setOpenCc((id) => (id === stage.id ? null : id));
      await onStagesChanged();
    } catch (e) { setErr(e.message || "Could not change what that stage asks for"); }
    finally { setSavingStage(null); }
  };

  const toggleReader = (stage, userId) => {
    const current = new Set((stage.ccPeople || []).map((p) => p.id));
    if (current.has(userId)) current.delete(userId); else current.add(userId);
    if (!current.size) { setErr("A reading stage needs at least one person on it"); return; }
    setAsk(stage, "cc", { ccIds: [...current] });
  };

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

  return (
    <ModalShell title={`Signature boxes — ${doc.title}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm opacity-70">
          Say what each stage asks for, then place a box for everyone who signs. They are still
          asked in turn, as the card reaches their stage — this only decides{" "}
          <span className="font-medium">where</span> each signature goes, so you can see the whole
          page at once.
        </div>

        {/* Every stage, not only the ones that sign: the usual reason a name is
            missing from this screen is a column that was never asked to sign. */}
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-ink-10)" }}>
          <div className="px-3 py-2 text-[10px] tracking-widest uppercase opacity-50"
            style={{ borderBottom: "1px solid var(--c-ink-08)" }}>
            What each stage asks for · saved as you change it
          </div>
          {(stages || []).map((s, i) => {
            const kind = kindOf(s);
            const saving = savingStage === s.id;
            const readers = s.ccPeople || [];
            return (
              <div key={s.id} className="border-b last:border-0" style={{ borderColor: "var(--c-ink-08)" }}>
                <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stageColour(i) }} />
                  <span className="text-sm truncate flex-1 min-w-[6rem]">{s.name}</span>
                  <div className="inline-flex rounded-full overflow-hidden shrink-0" style={{ border: "1px solid var(--c-ink-10)" }}>
                    {ASKS.map(([value, label, Icon]) => {
                      // Nobody to name means nothing to ask: offering it would
                      // only produce a refusal on save.
                      const blocked = value !== "plain" && executives.length === 0;
                      const on = kind === value;
                      return (
                        <button key={value} disabled={saving || blocked}
                          title={blocked ? "No active Approver or Executive to name" : undefined}
                          onClick={() => (on ? value === "cc" && setOpenCc(openCc === s.id ? null : s.id) : setAsk(s, value))}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] disabled:opacity-40"
                          style={on
                            ? { backgroundColor: "var(--c-ink)", color: "var(--c-cream)" }
                            : { backgroundColor: "transparent" }}>
                          <Icon size={11} /> {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Who it asks. One signer is a dropdown; readers are ticked,
                    because a paper is routinely shown to several at once. */}
                {kind === "signature" && (
                  <div className="px-3 pb-2 pl-8">
                    <select className="w-full text-sm" disabled={saving} value={s.signer?.id || ""}
                      onChange={(e) => setAsk(s, "signature", { signerId: e.target.value })}>
                      {!s.signer?.id && <option value="">Choose whose signature</option>}
                      {executives.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}{x.role && x.role !== "executive" ? ` · ${ROLE_LABELS[x.role] || x.role}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {kind === "cc" && (
                  <div className="px-3 pb-2 pl-8">
                    <button className="text-xs opacity-70 inline-flex items-center gap-1"
                      onClick={() => setOpenCc(openCc === s.id ? null : s.id)}>
                      <ChevronDown size={12} style={{ transform: openCc === s.id ? "none" : "rotate(-90deg)" }} />
                      {readers.length ? `${readers.length} ${readers.length === 1 ? "person" : "people"} read it` : "Nobody chosen yet"}
                    </button>
                    {openCc === s.id && (
                      <div className="rounded-lg mt-1.5 max-h-40 overflow-auto" style={{ border: "1px solid var(--c-ink-10)" }}>
                        {executives.map((x) => (
                          <label key={x.id} className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer text-sm border-b last:border-0"
                            style={{ borderColor: "var(--c-ink-08)" }}>
                            <input type="checkbox" disabled={saving} checked={readers.some((p) => p.id === x.id)}
                              onChange={() => toggleReader(s, x.id)} style={{ accentColor: "var(--c-gold)" }} />
                            <span className="truncate">{x.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {err && <div className="text-xs" style={{ color: "var(--c-rust)" }}>{err}</div>}

        {signatureStages.length === 0 ? (
          <div className="text-sm opacity-70 rounded-lg p-3" style={{ backgroundColor: "rgba(15,26,46,.04)" }}>
            No stage on this board asks for a signature yet, so there is no box to place.
            Set one to <span className="font-medium">Signs</span> above and its signatory appears here.
          </div>
        ) : (
          <>
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
          </>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs opacity-60">
            {placed} of {signatureStages.length} {signatureStages.length === 1 ? "signatory" : "signatories"} placed
            {/* A stage left empty is not an error — it will ask when the card
                gets there, exactly as it does today. */}
            {placed < signatureStages.length && " · the rest will be asked for when the card reaches them"}
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>Close</button>
            <button className="btn-gold" disabled={busy || !signatureStages.length} onClick={save}>
              <PenLine size={14} /> {busy ? "Saving…" : "Save the layout"}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
