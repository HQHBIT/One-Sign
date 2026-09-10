// ============================================================
//   EXPENSE SUBMISSION
//   ------------------------------------------------------------
//   The one request type that is not an upload. There is no document to attach
//   because the document is this form: the server fills Finance's own workbook,
//   so what prints is their sheet — merges, logos, page setup and all — rather
//   than a rendering of ours that drifts the first time they revise it.
//
//   Two consequences shape this screen. There is no file picker, and there is no
//   "place the signature box" step: the boxes already exist in the template,
//   merged across two rows each, and the server points the approver's marker at
//   the one Finance drew for them.
// ============================================================
import { useState, useMemo } from "react";
import { Plus, X, Send, ArrowLeft } from "lucide-react";
import { api } from "../api.js";
import EXPENSE_HEADS from "../lib/expense-heads.js";

const blankItem = () => ({ description: "", quantity: "", rate: "" });

// Kept in step with the server's own arithmetic (expense-template.js), so the
// figure on screen is the figure that prints. Rounded per line, not at the end:
// summing unrounded products and rounding once produces a total a person adding
// up the printed column cannot reproduce.
const money = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
};
const lineTotal = (it) => money((Number(it.quantity) || 0) * (Number(it.rate) || 0));

const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] opacity-45 mt-1">{hint}</div>}
    </label>
  );
}

export function ExpenseForm({ user, teams, notify, onDone, onBack }) {
  const [f, setF] = useState({
    submissionDate: new Date().toISOString().slice(0, 10),
    prNo: "", prDate: "", requestorIts: "", subDepartment: "",
    inBudget: "No", projectId: "", natureOfExpense: "", vendor: "",
  });
  const [items, setItems] = useState([blankItem()]);
  const [targetTeam, setTargetTeam] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const setItem = (i, k) => (e) =>
    setItems((p) => p.map((it, n) => (n === i ? { ...it, [k]: e.target.value } : it)));

  const filled = useMemo(() => items.filter(it => it.description.trim()), [items]);
  const grand = useMemo(() => money(filled.reduce((a, it) => a + lineTotal(it), 0)), [filled]);

  const submit = async () => {
    setErr("");
    if (!targetTeam) return setErr("Choose who should approve this.");
    if (!filled.length) return setErr("Add at least one line item.");
    if (!f.vendor.trim()) return setErr("Vendor name is required.");
    if (!f.natureOfExpense) return setErr("Choose the nature of the expense.");

    setBusy(true);
    try {
      await api.createRequest({
        expense: {
          ...f,
          items: filled.map(it => ({
            description: it.description.trim(),
            quantity: Number(it.quantity) || 0,
            rate: Number(it.rate) || 0,
          })),
          signatories: {
            requestor: { name: user.name, designation: user.department || "", date: f.submissionDate },
          },
        },
        targetTeamId: targetTeam,
        requestType: "expense",
        note,
      });
      notify("Expense submitted", "success");
      onDone?.();
    } catch (e) {
      setErr(e.message || "Could not submit the expense");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-16">
      <button className="btn-ghost text-xs mb-4" onClick={onBack}><ArrowLeft size={12} /> Back</button>
      <h1 className="font-display text-2xl mb-1">Expense submission</h1>
      <p className="text-sm opacity-60 mb-6">
        This prints on Finance's own form. There is nothing to upload, and the approver's
        signature box is already set aside on it.
      </p>

      <div className="card p-5 mb-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Submission date">
            <input type="date" className="w-full" value={f.submissionDate} onChange={set("submissionDate")} />
          </Field>
          <Field label="Purchase requisition no.">
            <input className="w-full" value={f.prNo} onChange={set("prNo")} placeholder="PR-2026-0000" />
          </Field>
          <Field label="PR date">
            <input type="date" className="w-full" value={f.prDate} onChange={set("prDate")} />
          </Field>
          <Field label="Requestor ID (ITS)">
            <input className="w-full" value={f.requestorIts} onChange={set("requestorIts")} inputMode="numeric" />
          </Field>
          <Field label="Sub-department">
            <input className="w-full" value={f.subDepartment} onChange={set("subDepartment")} />
          </Field>
          <Field label="Covered in annual budget?">
            <select className="w-full" value={f.inBudget} onChange={set("inBudget")}>
              <option>No</option><option>Yes</option>
            </select>
          </Field>
          <Field label="Project ID" hint="If applicable.">
            <input className="w-full" value={f.projectId} onChange={set("projectId")} />
          </Field>
          <Field label="Nature of expenses">
            <select className="w-full" value={f.natureOfExpense} onChange={set("natureOfExpense")}>
              <option value="">Choose…</option>
              {EXPENSE_HEADS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Vendor name">
              <input className="w-full" value={f.vendor} onChange={set("vendor")} />
            </Field>
          </div>
        </div>
      </div>

      <div className="card p-5 mb-4">
        <div className="text-[10px] tracking-widest uppercase opacity-50 mb-3">Goods / services received</div>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex gap-2 items-start">
              <input className="flex-1" placeholder="Description" value={it.description} onChange={setItem(i, "description")} />
              <input className="w-20" placeholder="Qty" inputMode="decimal" value={it.quantity} onChange={setItem(i, "quantity")} />
              <input className="w-28" placeholder="Rate" inputMode="decimal" value={it.rate} onChange={setItem(i, "rate")} />
              <div className="w-28 text-right text-sm tabular-nums pt-2 opacity-70">{fmt(lineTotal(it))}</div>
              <button className="opacity-40 hover:opacity-100 pt-2" title="Remove line"
                onClick={() => setItems(p => p.length === 1 ? [blankItem()] : p.filter((_, n) => n !== i))}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-3">
          <button className="btn-ghost text-xs" onClick={() => setItems(p => [...p, blankItem()])}>
            <Plus size={11} /> Add line
          </button>
          <div className="text-sm">
            <span className="opacity-50 mr-3">Total, inclusive of GST</span>
            <span className="font-medium tabular-nums">{fmt(grand)}</span>
          </div>
        </div>
      </div>

      <div className="card p-5 mb-4">
        <Field label="Route to signing authority">
          <select className="w-full" value={targetTeam} onChange={e => setTargetTeam(e.target.value)}>
            <option value="">Choose a department…</option>
            {(teams || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <div className="mt-4">
          <Field label="Note (optional)">
            <textarea className="w-full" rows={2} value={note} onChange={e => setNote(e.target.value)} />
          </Field>
        </div>
      </div>

      {err && (
        <div className="text-xs mb-3 px-3 py-2 rounded"
          style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>{err}</div>
      )}

      <button className="btn-primary" onClick={submit} disabled={busy}>
        <Send size={13} /> {busy ? "Submitting…" : "Submit expense"}
      </button>
    </div>
  );
}
