// ============================================================
//   EXPENSE SUBMISSION
//   ------------------------------------------------------------
//   The one request type that is not an upload. There is no document to attach
//   because the document is this form: the server fills Finance's own workbook,
//   so what prints is their sheet rather than a rendering of ours.
//
//   The screen therefore looks like the sheet. Filling a form that resembles the
//   app and then printing something that resembles a spreadsheet makes people
//   check the output every time; when the two match, what you typed is visibly
//   what you will sign. The palette here is the WORKBOOK's, not the app's —
//   white cells, an E7E6E6 band, hairline black rules, and F8CBAD (Orange
//   Accent 2, Lighter 60%) exactly where Finance marks a cell auto-populated.
//   The app's own colours are deliberately kept off it.
//
//   Two things are missing from this screen by design. There is no file picker,
//   and there is no "place the signature box" step: the boxes already exist in
//   the template, merged across two rows each, and the server points the
//   approver's marker at the one Finance drew.
// ============================================================
import { useState, useMemo } from "react";
import { Send, ArrowLeft, Paperclip, X } from "lucide-react";
import { api } from "../api.js";
import EXPENSE_HEADS from "../lib/expense-heads.js";
import { ExpensePdfBoxes } from "./ExpensePdfBoxes.jsx";
import { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES } from "../lib/constants.js";

// The form's own page-1 capacity. Anything beyond these continues on page 2 of
// the printed sheet, which is what its instruction line refers to.
const PAGE1_ROWS = 8;

const blankItem = () => ({ description: "", quantity: "", rate: "" });

// Kept in step with the server's arithmetic (expense-template.js): rounded per
// line, not once at the end, so the figure on screen is the figure that prints
// and someone adding up the printed column reaches the same number.
const money = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
};
const lineTotal = (it) => money((Number(it.quantity) || 0) * (Number(it.rate) || 0));
const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SHEET_CSS = `
.xl { width:100%; max-width:820px; margin:0 auto; background:#fff; color:#000;
      border:1px solid #000; font-family:Calibri,Carlito,"Segoe UI",sans-serif; font-size:11pt; }
.xl table { border-collapse:collapse; width:100%; table-layout:fixed; }
.xl td { border:1px solid #000; padding:3px 6px; vertical-align:middle; height:26px; }
.xl .band { background:#E7E6E6; font-weight:bold; text-align:center;
            border-top:2px solid #000; border-bottom:2px solid #000; height:30px; }
.xl .auto { background:#F8CBAD; font-weight:bold; font-size:9pt; text-align:center; }
.xl .hdr { font-weight:bold; text-align:center; }
.xl .num { text-align:right; }
.xl .note { font-size:8pt; }
.xl .sign { height:46px; }
.xl .instr { font-size:9pt; line-height:1.45; padding:8px; }
.xl input, .xl select { width:100%; border:0; background:transparent; font:inherit;
                        color:inherit; outline:none; padding:0; }
.xl input:focus, .xl select:focus { background:#FFF8E1; }
.xl .p2 td { background:#FFFDF5; }
/* The logo band. Finance's print area starts at row 4, which is this band, and
   ends at row 49 — so this is genuinely the top of the printed page, not
   decoration added around it. The two images are the workbook's own, served as
   files rather than bundled: the left one is a 1.2 MB PNG and has no business
   inside the JavaScript. */
.xl .logos { display:flex; align-items:center; justify-content:space-between;
             padding:6px 14px; height:92px; box-sizing:border-box;
             border-bottom:1px solid #000; background:#fff; }
.xl .logos img { max-height:80px; width:auto; display:block; }
`;

export function ExpenseForm({ user, teams, users = [], notify, onDone, onBack }) {
  const [f, setF] = useState({
    submissionDate: new Date().toISOString().slice(0, 10),
    prNo: "", prDate: "", requestorIts: "", subDepartment: "",
    inBudget: "No", projectId: "", natureOfExpense: "", vendor: "",
  });
  const [items, setItems] = useState(() => Array.from({ length: PAGE1_ROWS }, blankItem));
  const [targetTeam, setTargetTeam] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // An already-printed form can be attached instead of filling this one. When
  // there is a PDF it becomes the document, and the fields above are not sent —
  // submitting both would put two versions of the same expense into one request.
  const [pdf, setPdf] = useState(null);
  const [pdfMarkers, setPdfMarkers] = useState([]);
  const [pdfSigners, setPdfSigners] = useState([]);

  const attach = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) return setErr("Attach a PDF.");
    if (file.size > MAX_UPLOAD_BYTES) return setErr(`That file is over ${MAX_UPLOAD_MB} MB.`);
    setErr("");
    setPdf(file);
  };

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const setItem = (i, k) => (e) =>
    setItems((p) => p.map((it, n) => (n === i ? { ...it, [k]: e.target.value } : it)));

  const filled = useMemo(() => items.filter((it) => it.description.trim()), [items]);
  const grand = useMemo(() => money(filled.reduce((a, it) => a + lineTotal(it), 0)), [filled]);

  const submit = async () => {
    setErr("");
    // A department is only needed when nobody has been named. Demanding one for
    // a form that already says who signs would make the requestor answer a
    // question the document has answered.
    const goingDirect = !!pdf && pdfSigners.length > 0;
    if (!goingDirect && !targetTeam) return setErr("Choose who should approve this.");

    // The attached PDF wins: it is a form somebody already filled and printed,
    // and the boxes read off it are where its own signature cells are.
    if (pdf) {
      setBusy(true);
      try {
        // When the form names its signatories and they have been confirmed, the
        // request goes straight to those people, each into the box beside their
        // own name. Otherwise it falls back to the department, which is what a
        // form with no names printed on it can support.
        const direct = pdfSigners.length > 0;
        await api.createRequest({
          file: pdf,
          requestType: "expense",
          ...(direct
            ? { direct: true, signers: pdfSigners }
            : { targetTeamId: targetTeam, marker: pdfMarkers.length ? pdfMarkers : undefined }),
          note,
        });
        notify("Expense submitted", "success");
        onDone?.();
      } catch (e) {
        setErr(e.message || "Could not submit the expense");
      } finally { setBusy(false); }
      return;
    }

    if (!filled.length) return setErr("Add at least one line item.");
    if (!f.vendor.trim()) return setErr("Vendor name is required.");
    if (!f.natureOfExpense) return setErr("Choose the nature of the expense.");

    setBusy(true);
    try {
      await api.createRequest({
        expense: {
          ...f,
          items: filled.map((it) => ({
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

  // Each signatory occupies two rows on the sheet, with Sign and Date merged
  // across both. Left empty here because they are filled by signing, not typing.
  const SignatoryRows = ({ particular, name, designation }) => (
    <>
      <tr>
        <td className="hdr" rowSpan={2}>{particular}</td>
        <td className="hdr">{name}</td>
        <td className="sign" rowSpan={2} />
        <td rowSpan={2} />
      </tr>
      <tr><td className="note">{designation}</td></tr>
    </>
  );

  return (
    <div className="pb-16">
      <style>{SHEET_CSS}</style>

      <div className="max-w-4xl mx-auto mb-4 flex items-center justify-between">
        <button className="btn-ghost text-xs" onClick={onBack}><ArrowLeft size={12} /> Back</button>
        <div className="text-xs opacity-55">
          {pdf ? "Using the attached form." : "This is the form Finance prints. Fill it here and it prints exactly like this."}
        </div>
      </div>

      {/* Attaching an already-printed form is the alternative to filling this
          one, not an addition to it — so when a PDF is present the sheet below
          is hidden rather than sent alongside it. */}
      <div className="max-w-4xl mx-auto mb-4">
        {!pdf ? (
          <label className="btn-ghost text-xs" style={{ cursor: "pointer", display: "inline-flex" }}>
            <Paperclip size={12} /> Attach a printed form (PDF) instead
            <input type="file" accept="application/pdf,.pdf" onChange={attach} className="hidden" />
          </label>
        ) : (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm truncate" title={pdf.name}>
                <Paperclip size={12} /> {pdf.name}
              </div>
              <button className="btn-ghost text-xs"
                onClick={() => { setPdf(null); setPdfMarkers([]); }}>
                <X size={12} /> Remove and fill the form instead
              </button>
            </div>
            <ExpensePdfBoxes file={pdf} users={users} onChange={({ markers, signers }) => { setPdfMarkers(markers); setPdfSigners(signers); }} />
          </div>
        )}
      </div>

      <div className="xl" style={pdf ? { display: "none" } : undefined}>
        <div className="logos">
          <img src="/expense/logo-left.png" alt="" />
          <img src="/expense/logo-right.png" alt="" />
        </div>
        <table>
          <colgroup>
            <col style={{ width: "33.6%" }} /><col style={{ width: "27.5%" }} />
            <col style={{ width: "16.8%" }} /><col style={{ width: "22.1%" }} />
          </colgroup>
          <tbody>
            <tr><td className="band" colSpan={4}>EXPENSE SUBMISSION</td></tr>

            <tr><td>Department (accounts team to select)</td>
                <td className="hdr" colSpan={3}>DAWAT E HADIYAH</td></tr>

            <tr><td>Submission Date</td>
                <td colSpan={3}><input type="date" value={f.submissionDate} onChange={set("submissionDate")} /></td></tr>

            <tr><td>Purchase Requisition No.</td>
                <td><input value={f.prNo} onChange={set("prNo")} /></td>
                <td className="note">PR Date</td>
                <td><input type="date" value={f.prDate} onChange={set("prDate")} /></td></tr>

            <tr><td>Requestors ID (ITS)</td>
                <td colSpan={3}><input inputMode="numeric" value={f.requestorIts} onChange={set("requestorIts")} /></td></tr>

            {/* Auto-populated on Finance's sheet, and auto-populated here too —
                taken from the session rather than typed, which is also what the
                server writes onto the form. */}
            <tr><td>Requestors Name</td>
                <td className="auto" colSpan={3}>{user.name}</td></tr>

            <tr><td>Sub-Department</td>
                <td colSpan={3}><input value={f.subDepartment} onChange={set("subDepartment")} /></td></tr>

            <tr><td>Is covered in annual Budget?</td>
                <td className="hdr">
                  <select value={f.inBudget} onChange={set("inBudget")}>
                    <option>No</option><option>Yes</option>
                  </select>
                </td>
                <td className="auto" colSpan={2}>{f.inBudget === "Yes" ? "Budget ID" : ""}</td></tr>

            <tr><td>Project Id (If applicable)</td>
                <td colSpan={3}><input value={f.projectId} onChange={set("projectId")} /></td></tr>

            <tr><td>Nature of Expenses</td>
                <td colSpan={3}>
                  <select value={f.natureOfExpense} onChange={set("natureOfExpense")}>
                    <option value="">Choose…</option>
                    {EXPENSE_HEADS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </td></tr>

            <tr><td>Vendor Name</td>
                <td colSpan={3}><input value={f.vendor} onChange={set("vendor")} /></td></tr>

            <tr><td className="band" colSpan={4} style={{ borderTop: "1px solid #000" }}>Goods/Services Received</td></tr>

            <tr><td className="hdr">DESCRIPTION</td><td className="hdr">QUANTITY</td>
                <td className="hdr">RATE</td><td className="hdr">TOTAL VALUE</td></tr>

            {items.map((it, i) => (
              <tr key={i} className={i >= PAGE1_ROWS ? "p2" : undefined}>
                <td><input value={it.description} onChange={setItem(i, "description")} /></td>
                <td><input className="num" inputMode="decimal" value={it.quantity} onChange={setItem(i, "quantity")} /></td>
                <td><input className="num" inputMode="decimal" value={it.rate} onChange={setItem(i, "rate")} /></td>
                <td className="num">{fmt(lineTotal(it))}</td>
              </tr>
            ))}

            <tr><td className="note">Mention total bill amount, inclusive of GST</td>
                <td />
                <td className="hdr">Total</td>
                <td className="num" style={{ fontWeight: "bold" }}>{fmt(grand)}</td></tr>

            <tr><td className="hdr">Particular</td><td className="hdr">Name &amp; Designation</td>
                <td className="hdr">Sign</td><td className="hdr">Date</td></tr>

            <SignatoryRows particular="Requestor" name={user.name} designation={user.department || ""} />
            <SignatoryRows particular="Reviewer" name="" designation="" />
            <SignatoryRows particular="Approver 1" name="Huzaifa Bsb" designation="Finance HOD" />
            <SignatoryRows particular="Approver 2" name="Idris bsb" designation="Executive Management" />

            <tr><td className="instr" colSpan={4}>
              - Attach all required documents: invoice, GR/work completion certificate, and PO/work order.
              - Missing documents will result in delays in processing.
              - Ensure invoice matches the PO/work order terms, including price, quantity, and payment terms, before submission.
              - categorize the expense as per the predefined budget heads and provide the necessary details for proper accounting.
              - Ensure submitted documents align with the DOA guidelines and include any prior approvals required for the expense.
              - Submit the expense form and supporting documents within the stipulated time frame to avoid payment delays.
            </td></tr>

            <tr><td className="band" colSpan={4} style={{ borderTop: "1px solid #000" }}>For Finance team only</td></tr>
            <tr><td className="hdr">Budgeted to</td><td colSpan={3} /></tr>
            <tr><td className="hdr">Budgeted amount</td><td colSpan={3} /></tr>
            <tr><td className="hdr">Budgeted Balance</td><td colSpan={3} /></tr>
          </tbody>
        </table>
      </div>

      {/* Below the sheet, and deliberately in the app's own styling: routing and
          the note are how SignFlow moves the document, not part of the form
          Finance prints. */}
      <div className="max-w-4xl mx-auto mt-6">
        <div className="card p-5">
          <label className="block mb-4">
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Route to signing authority</div>
            <select className="w-full" value={targetTeam} onChange={(e) => setTargetTeam(e.target.value)}>
              <option value="">Choose a department…</option>
              {(teams || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Note (optional)</div>
            <textarea className="w-full" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        {err && (
          <div className="text-xs mt-3 px-3 py-2 rounded"
            style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>{err}</div>
        )}

        <div className="flex items-center gap-3 mt-4">
          <button className="btn-primary" onClick={submit} disabled={busy}>
            <Send size={13} /> {busy ? "Submitting…" : "Submit expense"}
          </button>
          <button className="btn-ghost text-xs"
            onClick={() => setItems((p) => [...p, blankItem()])}>
            Add a line beyond the {PAGE1_ROWS} above (prints on page 2)
          </button>
        </div>
      </div>
    </div>
  );
}
