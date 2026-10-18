import { FileText, CalendarDays, Wallet, Receipt, FolderKanban, ClipboardCheck, Lock, Files, ChevronRight, Hourglass } from "lucide-react";
import { requestTypesFor, retentionLabel } from "../lib/constants.js";

// ============================================================
//   TYPE PICKER — the first step of "Make a new request"
//   ------------------------------------------------------------
//   The request types as a list, each row arriving in turn: a short fade and
//   rise, staggered so the list reads top to bottom. On HQHB each row also says
//   how long that type's documents are kept once the request is decided. With
//   "reduce motion" set on the device, the rows simply appear.
// ============================================================
const ICONS = {
  document: FileText, leave: CalendarDays, expense: Wallet, invoice: Receipt,
  project: FolderKanban, workdone: ClipboardCheck, confidential: Lock, general: Files,
};
const STAGGER_MS = 70;

const CSS = `
@keyframes sf-type-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes sf-rule-in { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.sf-type-row { animation: sf-type-in .46s cubic-bezier(.2,.7,.2,1) both; transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
.sf-type-row:hover, .sf-type-row:focus-visible { transform: translateX(3px); border-color: var(--c-gold) !important; box-shadow: 0 6px 18px rgba(15,26,46,.08); outline: none; }
.sf-type-row:hover .sf-type-chev, .sf-type-row:focus-visible .sf-type-chev { transform: translateX(3px); opacity: .9; }
.sf-type-chev { transition: transform .18s ease, opacity .18s ease; opacity: .35; }
.sf-type-rule { transform-origin: left; animation: sf-rule-in .7s cubic-bezier(.2,.7,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .sf-type-row, .sf-type-rule { animation: none; } .sf-type-row:hover { transform: none; } }
`;

export function TypePicker({ org, onPick }) {
  const types = requestTypesFor(org);
  const showRetention = org === "hqhb";
  return (
    <div className="mt-6 sm:mt-8">
      <style>{CSS}</style>
      <div className="font-display text-2xl sm:text-3xl">What are you sending?</div>
      <div className="text-sm opacity-60 mt-1">
        Choose the type of request.{showRetention && " Each type's documents are kept for a set time once the request is decided — you'll be emailed your copy before it goes."}
      </div>
      <div className="sf-type-rule h-px mt-4 mb-5" style={{ backgroundColor: "var(--c-gold)", opacity: 0.5 }} />

      <div className="space-y-2.5" role="list">
        {types.map((t, i) => {
          const Icon = ICONS[t.key] || Files;
          return (
            <button key={t.key} type="button" role="listitem" onClick={() => onPick(t.key)}
              className="sf-type-row card w-full text-left px-4 py-3.5 flex items-center gap-4"
              style={{ animationDelay: `${i * STAGGER_MS}ms`, borderLeft: `4px solid ${t.color}` }}>
              <span className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${t.color}1A`, color: t.color }}>
                <Icon size={18} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-medium">{t.label}</span>
                <span className="block text-xs opacity-60 mt-0.5 truncate">{t.desc}</span>
              </span>
              {showRetention && t.retentionDays && (
                <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] tracking-wide px-2.5 py-1 rounded-full shrink-0"
                  style={{ backgroundColor: "rgba(15,26,46,.05)", color: "var(--c-ink)" }}
                  title={`Kept for ${retentionLabel(t.retentionDays)} once the request is decided`}>
                  <Hourglass size={11} style={{ color: "var(--c-gold)" }} /> Kept {retentionLabel(t.retentionDays)}
                </span>
              )}
              <ChevronRight size={16} className="sf-type-chev shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The chosen type, compact, at the top of the form — with a way back.
export function ChosenType({ org, typeKey, onChange }) {
  const t = requestTypesFor(org).find(x => x.key === typeKey) || requestTypesFor(org).at(-1);
  const Icon = ICONS[t.key] || Files;
  return (
    <div className="card px-4 py-3 flex items-center gap-3" style={{ borderLeft: `4px solid ${t.color}` }}>
      <span className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${t.color}1A`, color: t.color }}>
        <Icon size={15} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] tracking-widest uppercase opacity-50">Request type</div>
        <div className="font-medium truncate">{t.label}</div>
      </div>
      {org === "hqhb" && t.retentionDays && (
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] opacity-70 shrink-0">
          <Hourglass size={11} style={{ color: "var(--c-gold)" }} /> Kept {retentionLabel(t.retentionDays)} after it's decided
        </span>
      )}
      <button type="button" className="btn-ghost text-xs shrink-0" onClick={onChange}>Change</button>
    </div>
  );
}
