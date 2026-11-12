// ============================================================
//   PAGINATION FOR DOCUMENT LISTS
//   ------------------------------------------------------------
//   A long list is hard to work with and slow to draw, so lists come in pages
//   of 25. The size is the reader's choice though — 25, 50, 75, 100, or all of
//   them — because "how much do I want on screen at once" is not something a
//   screen should decide for someone scanning for one document.
//
//   The page is CLAMPED rather than remembered: narrowing a list with the
//   search while on page 4 would otherwise leave someone staring at an empty
//   page wondering where their documents went.
// ============================================================
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const PAGE_SIZES = [25, 50, 75, 100];
const ALL = 0;

/**
 * @param items  the rows to page through — already searched/filtered
 * @param size   starting page size; 25 unless a screen has reason to differ
 */
export function usePagination(items, { size = 25 } = {}) {
  const [perPage, setPerPage] = useState(size);
  const [page, setPage] = useState(1);

  const list = items || [];
  const total = list.length;
  const pages = perPage === ALL ? 1 : Math.max(1, Math.ceil(total / perPage));
  // Clamped, not stored: see the note above about a search shrinking the list.
  const current = Math.min(Math.max(1, page), pages);
  const start = perPage === ALL ? 0 : (current - 1) * perPage;
  const visible = perPage === ALL ? list : list.slice(start, start + perPage);

  return {
    visible, total, page: current, pages, perPage,
    from: total === 0 ? 0 : start + 1,
    to: perPage === ALL ? total : Math.min(start + perPage, total),
    setPage,
    setPerPage: (n) => { setPerPage(n); setPage(1); },
    // Below the smallest page size there is nothing to page through, and a
    // control that never does anything is just clutter.
    needed: total > PAGE_SIZES[0],
  };
}

export function Pager({ state, className = "" }) {
  const { total, page, pages, perPage, from, to, setPage, setPerPage, needed } = state;
  if (!needed) return null;

  const go = (n) => setPage(Math.min(Math.max(1, n), pages));

  return (
    <div className={"flex flex-col sm:flex-row sm:items-center gap-3 mt-4 " + className}>
      <div className="text-xs opacity-60">
        Showing {from}–{to} of {total}
      </div>

      <div className="flex items-center gap-2 sm:ml-auto">
        <label className="text-xs opacity-60" htmlFor="per-page">Per page</label>
        <select id="per-page" aria-label="Documents per page" className="text-xs"
          value={perPage}
          onChange={(e) => setPerPage(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          <option value={ALL}>All ({total})</option>
        </select>

        {perPage !== ALL && pages > 1 && (
          <div className="flex items-center gap-1">
            <button className="btn-ghost !px-2" onClick={() => go(page - 1)} disabled={page <= 1}
              aria-label="Previous page"><ChevronLeft size={14} /></button>
            <span className="text-xs opacity-70 tabular-nums">Page {page} of {pages}</span>
            <button className="btn-ghost !px-2" onClick={() => go(page + 1)} disabled={page >= pages}
              aria-label="Next page"><ChevronRight size={14} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
