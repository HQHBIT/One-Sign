// ============================================================
//   SEARCH AND FILTER, FOR EVERY DOCUMENT LIST
//   ------------------------------------------------------------
//   Pending, approved and rejected all answer the same two questions — "which
//   document was that?" and "whose is it?" — so they share one implementation
//   rather than each screen growing its own.
//
//   The person filter is per screen, because the useful question differs: a
//   requestor wants to know who approved, rejected or is holding a document,
//   while an approver looking at their own queue wants to know who raised it.
//   Each screen passes its own extractor and label.
//
//   The dropdown offers only people who appear on THESE documents, with a
//   count — never a directory of everyone in the organisation.
// ============================================================
import { useState } from "react";
import { Search, X } from "lucide-react";

/**
 * @param items   every row the screen could show
 * @param people  (r) => [{ id, name }] — who this list can be filtered by
 * @param label   the dropdown's name, e.g. "Approved by"
 */
export function useListSearch(items, { people, label = "Filter" } = {}) {
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState("");

  const on = typeof people === "function";
  const peopleOf = (r) => {
    if (!on) return [];
    try { return (people(r) || []).filter((p) => p && p.id); } catch { return []; }
  };

  // Computed each render rather than memoised: these lists are a screenful, and
  // the extractor is usually an inline arrow whose identity changes anyway.
  const options = (() => {
    if (!on) return [];
    const m = new Map();
    for (const r of items || []) {
      for (const p of peopleOf(r)) {
        const e = m.get(p.id) || { id: p.id, name: p.name || "Unknown", n: 0 };
        e.n += 1;
        m.set(p.id, e);
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  const q = query.trim().toLowerCase();
  const filtering = !!q || !!person;

  const matches = (r) => {
    if (person && !peopleOf(r).some((p) => p.id === person)) return false;
    if (!q) return true;
    const hay = [r.fileName, r.requestorName, r.requestType, r.note, r.approverName,
      ...peopleOf(r).map((p) => p.name)].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  };

  const visible = filtering ? (items || []).filter(matches) : (items || []);
  const clear = () => { setQuery(""); setPerson(""); };

  return { query, setQuery, person, setPerson, options, filtering, matches, visible, clear, label };
}

/** The bar itself. Pass the object useListSearch returned. */
export function ListSearchBar({ state, className = "" }) {
  const { query, setQuery, person, setPerson, options, filtering, clear, label } = state;
  return (
    <div className={"flex flex-col sm:flex-row gap-2 sm:items-center " + className}>
      <div className="relative flex-1 max-w-xl">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-full pl-9"
          placeholder="Search by document name, type or person…" aria-label="Search documents" />
      </div>
      {options.length > 0 && (
        <select value={person} onChange={(e) => setPerson(e.target.value)} className="sm:w-72" aria-label={label}>
          <option value="">{label}: everyone</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.n})</option>)}
        </select>
      )}
      {filtering && (
        <button className="btn-ghost text-xs shrink-0" onClick={clear}><X size={12} /> Clear</button>
      )}
    </div>
  );
}

/**
 * Nothing matched — distinct from the screen being empty, which reads
 * differently. Worded exactly as FolderedList words it, so the same situation
 * does not get two different sentences depending on which list you are on.
 */
export function NoMatches({ onClear }) {
  return (
    <div className="card p-10 text-sm opacity-60 text-center mt-8">
      Nothing matches — try another word, or clear the filter.
      <button className="btn-ghost text-xs ml-2" onClick={onClear}>Clear</button>
    </div>
  );
}
