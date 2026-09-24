# Moving several documents at once — design

Date: 2026-09-24. Builds on `2026-09-24-document-folders-design.md` (live since PR #17).

## Why

Filing one document at a time is fine for a new folder with three things in it. It is not fine for someone with forty approved documents who wants "everything from Finance" in one place. They should be able to tick the documents and move them together.

## What the person sees

- A **Select** button beside **New folder** in the list's title row. On a phone the two wrap onto their own line.
- Tapping Select turns on **selection mode**: every visible row gets a checkbox at its left, where the drag grip was. The row's own actions (Preview, Download, Print, Move to…) stay where they are.
- A **bar** appears between the folder strip and the rows: `3 selected · Select all · Move to… · Cancel`.
  - *Select all* ticks every row on the current screen — the main list, or the open folder — and never rows that are not shown.
  - *Move to…* is the same menu as on a single row: the person's folders, *New folder…* (creates the folder, then moves the selection into it), and *Remove from folder* when inside one. It is disabled until at least one row is ticked.
  - *Cancel*, or the Escape key, clears the selection and turns the checkboxes off.
- After a move the ticked rows leave the current list (they now live elsewhere), the tile counts update, a toast says `3 documents moved to Finance 2026` (or `… back to the main list`), and selection mode ends.
- Dragging is unchanged outside selection mode, and unavailable inside it (the grip is replaced by the checkbox).

## Server

One new call: `PUT /api/folders/items` with body `{ requestIds: string[], folderId: number | null }`.

- Every id is checked with `authoriseAccess` **before** anything is written. If any id is not the caller's, or not visible to them, the call answers **404** and nothing moves. The move is all-or-nothing, inside one transaction.
- `folderId` must be one of the caller's folders (404 otherwise) or `null` to unfile.
- `requestIds` must be a non-empty array of at most 200 strings, de-duplicated; otherwise **400**.
- Writes are the same upsert as the single-document call, one row per id.
- Response: `{ moved: n }`.

The single-document `PUT /api/folders/items/:requestId` stays as it is; the row menu keeps using it.

## Client

- `useFolders` gains `moveMany(requestIds, folderId)`: optimistic (placements updated at once, tile counts adjusted), reverted with a toast and a reload if the server refuses.
- `FolderedList` owns selection state (`selecting`, `selected: Set<string>`), renders the Select button, the bar, and passes a `selectable` flag plus checkbox state to each row through `renderRow`.
- `RequestRow` gains `selectable` / `selected` / `onToggle`: when `selectable`, the grip is replaced by a checkbox and the row is not draggable.
- `MoveToMenu` is reused for the bar with a `disabled` prop and a label that says how many will move.

## Tests

- `server/test/folders.integration.mjs` extends: bulk move into a folder (rows land, counts right), bulk unfile, atomic refusal when one id belongs to someone else (none moved), empty list → 400, unknown folder → 404.
- Browser run-through with Playwright: Select → tick two → Move to… → counts; Select all inside a folder → Remove from folder; Cancel clears.

## Out of scope

Dragging a multi-selection as one; keyboard range selection; moving across lists (a document only ever appears in one list per person).
