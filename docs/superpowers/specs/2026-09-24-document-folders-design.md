# Document folders — design

**Date:** 2026-09-24
**Owner:** Taha Chunawala (IT Admin, HQHB)
**Status:** approved in conversation; implementation plan to follow

## What this is

Every person who uses SignFlow builds up a list of finished documents — the ones
they raised that got approved, the ones they signed for others. Today those
lists are flat, sorted by date, and grow forever. This lets each person file
their own documents into folders they name themselves, by dragging a row onto
a folder.

## Decisions made with the owner

| Question | Decision | Why |
|---|---|---|
| Depth | **One level** — no folders inside folders | Drag-and-drop into sub-folders is fiddly; nobody has asked for nesting |
| Where | **Every approved/signed list, every role** — requestors' "My approved requests" and "My signed documents", approvers' and executives' "Approved requests" | Everyone accumulates finished documents |
| Semantics | **Move** — a document is in one folder or in the main list, never both; the main list shows only unfiled documents | Matches drag-and-drop; the point is that the main list gets shorter |
| Layout | **Folder tiles in a strip above the list**, "+ New folder" at the right of the page title | Rows keep their full width; tiles double as drop targets; works on tablets |
| Whose | **Personal** — your folders and filing are yours alone | The same document appears in several people's lists (requestor + each signer); one person's tidying must not rearrange anyone else's screen |

Out of scope: nesting, sharing a folder with someone else, colours/icons, and
the admin's "All documents" screen (a team-wise audit table, not a personal list).

## Data

Two new tables. Nothing on `requests` changes.

```
folders
  id          VARCHAR(64)  PK          ("fld_…")
  user_id     VARCHAR(64)  NOT NULL    FK users(id) ON DELETE CASCADE
  org_id      VARCHAR(32)  NULL        the deployment's organisation, for the record
  name        VARCHAR(60)  NOT NULL
  created_at  BIGINT       NOT NULL
  UNIQUE (user_id, name)               case-insensitive by collation: "Finance" == "finance"

folder_items
  user_id     VARCHAR(64)  NOT NULL    FK users(id)    ON DELETE CASCADE
  request_id  VARCHAR(64)  NOT NULL    FK requests(id) ON DELETE CASCADE
  folder_id   VARCHAR(64)  NOT NULL    FK folders(id)  ON DELETE CASCADE
  added_at    BIGINT       NOT NULL
  PRIMARY KEY (user_id, request_id)
```

Why this shape:

- **The primary key on `folder_items` is (user, request)** — that is what makes
  "one folder per document" a rule the database enforces rather than one the
  screen remembers to follow. Moving a document is an upsert on that key.
- **Per-user rows, not a column on `requests`** — the requestor and each signer
  file the same document independently.
- **Cascades do the housekeeping.** Delete a folder → its `folder_items` rows
  go, so the documents fall back into the main list. Delete a document (or a
  user) → placements vanish. No orphans, no cleanup job.
- **One folder set per person, shared across their lists.** A document
  appears in only one of a person's lists (they raised it or they signed it),
  so separate sets per list would only make someone create "Finance" twice.
- `org_id` is recorded, not enforced: a person belongs to one organisation and
  every box serves one organisation, so it is context for the record, like it
  is on `issue_reports`.

## Server

A new route file, `server/src/routes/folders.js`, mounted at `/api/folders`.
Everything is scoped to `req.user`; no call can name another person's folder.

| Call | Does | Refuses when |
|---|---|---|
| `GET /api/folders` | `{ folders: [{ id, name, count }], placements: { [requestId]: folderId } }` — everything the screen needs in one round trip | — |
| `POST /api/folders { name }` | creates; returns the folder | blank name, over 60 characters, or a name the person already uses (409 "You already have a folder called …") |
| `PUT /api/folders/:id { name }` | renames | same as create; folder not theirs (404, not 403 — do not confirm it exists) |
| `DELETE /api/folders/:id` | deletes the folder; documents return to the main list by cascade | not theirs (404) |
| `PUT /api/folders/items/:requestId { folderId }` | files the document there (`folderId: null` unfiles it) | folder not theirs (404); document not visible to them — checked with the same `authoriseAccess` rule the document itself uses — (404) |

Names are trimmed and whitespace-collapsed before the uniqueness check. Counts
in `GET` are computed on each call from `folder_items` joined to `requests`
(so a placement whose document has since gone invisible is not counted), never
cached, so they cannot drift.

`authoriseAccess` currently lives inside `routes/requests.js` unexported; it is
exported as part of this work so the folders route uses the identical rule
rather than a copy.

## Screen

The two components that render finished documents — `ApprovedList` (requestor
lists) and `ApproverApproved` (approver/executive list) — get the same folder
behaviour from one shared piece rather than each growing its own copy:

- `client/src/lib/useFolders.js` — a hook: loads `GET /api/folders`, exposes
  `folders`, `placements`, `createFolder`, `renameFolder`, `deleteFolder`,
  `moveTo(requestId, folderId|null)`. Every mutation is **optimistic**: the
  screen changes immediately and reverts, with a toast, if the server refuses.
- `client/src/components/FolderStrip.jsx` — the tiles, the "+ New folder"
  control, the inline rename, the delete confirmation, and the drop targets.
- `RequestRow` gains two optional props: `draggable` (adds a grip and makes
  the row an HTML5 drag source carrying its request id) and a `move` action
  slot (the "Move to…" button).

How it behaves, top to bottom of the page:

1. **Title row.** The existing title and "N signed" count stay. To their
   right: **"+ New folder"**. Clicking it turns the button into a text box;
   Enter creates, Escape cancels, an empty name does nothing.
2. **Folder strip.** One tile per folder: name and count. Hidden entirely when
   the person has no folders and is not creating one, so a screen that never
   uses folders looks exactly as it does today.
   - Click a tile → the list shows that folder's documents; the strip
     collapses to a breadcrumb "Main list › Finance" and a **"Main list"**
     drop target appears for dragging documents back out.
   - Hovering a dragged row over a tile highlights it; dropping files the
     document there.
   - A small "⋯" on each tile: **Rename** (inline, same rules as create) and
     **Delete**, which asks "Delete 'Finance'? Its 12 documents go back to the
     main list." — nothing but the folder name is ever deleted.
3. **The list.** In the main list, only unfiled documents. Rows are draggable
   on devices with a mouse. Every row, on every device, also has **"Move
   to…"**: a small menu listing the person's folders, "New folder…", and, when
   inside a folder, "Remove from folder". This is the only way to file on a
   phone, and a perfectly good way anywhere.
4. **Empty states.** A folder with nothing in it says so and how to add
   ("Drag documents here, or use Move to… on a document"). The main list, when
   everything has been filed, says "Everything is filed — open a folder above."

The `N signed` count in the title counts all documents, filed or not, so it
still means what it meant.

## Edge cases

- **Two folders, same name** → refused with the existing name shown.
- **A document withdrawn or deleted after filing** → its placement cascades
  away; the folder count drops by one. Nothing to do.
- **Someone loses visibility of a document** (rare: a signer removed from a
  workflow) → the placement row is harmless and invisible; counts come from a
  join against visible documents, so it does not show as a phantom.
- **Account merges** (the oneAccess reconciliation tool) → the keeper account
  must inherit the loser's folders and placements. `mergeUsers` gets two
  UPDATEs (`folders.user_id`, `folder_items.user_id`); a name clash between the
  two accounts' folders keeps both, the loser's renamed "Finance (2)".
- **Two tabs open** → the second tab's next action refetches and reconciles;
  optimistic changes are keyed by request id, so a stale placement is
  overwritten, never duplicated.
- **Very many folders** → the strip wraps; no pagination. Nobody will make
  fifty folders, and if they do, wrapping is still usable.

## Tests

`server/test/folders.integration.mjs`, against an API the test starts itself,
email and storage off:

- create, rename, delete; blank and duplicate names refused; the 60-character cap
- move a document into a folder, then into another — one placement, not two
- unfile; delete a folder and confirm its documents are back in the main list
- **isolation:** two people file the same document differently and each sees
  only their own; one person cannot read, rename, delete or file into the
  other's folder (404 every time)
- filing a document the person cannot see is refused
- counts match placements

Browser run-through (Playwright, as for earlier features): create a folder from
the title button, drag a row onto it, open it, drag it back, use "Move to…" at
phone width, rename and delete.

## Rollout

Additive only — two new tables created by the existing migration-on-boot,
nothing altered — so it deploys as a normal `master` release to HQHB and WAQF
with no data step and no downtime beyond the usual restart.
