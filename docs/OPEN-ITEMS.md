# Open items

Running list of outstanding work. Updated 2026-08-22.

---

## Multi-organisation (in progress)

Spec: `docs/superpowers/specs/2026-08-22-multi-organisation-design.md`
Live: `a79c42c` — schema, seed data and login isolation are deployed. Every
existing row is HQHB, so nothing has changed for anyone yet.

### Phase 1 remainder — **do before any real WAQF user exists**

- [ ] **Query-level organisation isolation.** `GET /users`, `GET /users/search`,
      `GET /teams`, `GET /requests` and the reports still return every row
      regardless of organisation. Harmless today because everything is HQHB;
      the moment a WAQF requestor exists they would see HQHB's people and teams
      in their pickers. This is the single most important outstanding item.
- [ ] Set `org_id` explicitly on every insert path — user creation, team
      creation, request creation — rather than leaning on the
      `DEFAULT 'hqhb'` backstop, which exists only so pre-existing INSERTs
      keep working.
- [ ] Pin the oneAccess upsert to `hqhb`, so an SSO login can never mint a user
      in another organisation.
- [ ] Scope the oneAccess department→team resolution to HQHB
      (`routes/auth.js`), or a department string could match a WAQF team.

### Phase 2 — landing picker · **blocked on assets**

- [ ] WAQF seal file. SVG strongly preferred: the fine Arabic lettering
      degrades badly scaled up from a small raster.
- [ ] A larger HQHB mark. The repo copy (`client/public/email/qh-logo.png`) is
      128×127 and will look soft at tile size.
- [ ] Landing page with one clickable logo tile per organisation; choice stored
      in `localStorage` with a visible way to switch.
- [ ] Client sends the organisation slug on login and calls
      `/auth/config?org=`. The server side of both already exists and is tested.

### Phase 3 — global users

- [ ] Admin toggle for `users.is_global`.
- [ ] Approver search returns current organisation **plus** global users.
- [ ] Confirm the organisation filter on `GET /requests` does not exclude
      cross-organisation requests a global user is a signer on — scoping applies
      to browsing, never to participation.

### Phase 4 — departments

- [ ] Render teams organisation-prefixed ("HQHB — IT").
- [ ] Department filter chips on approver queues.

---

## Signature and date rendering

- [ ] **Date font matching the document.** Not started. Dates still stamp in
      hardcoded Helvetica, navy, sized to fill the box, so they read as an
      annotation rather than part of the document. Plan: detect the font
      client-side with pdf.js, re-embed the PDF's own font server-side with
      `@pdf-lib/fontkit` (hoisted at the repo root but **not declared in
      `server/package.json`**). Needs a recursive walk of page `/Resources
      /Font` through XObjects, because `bakeOrientation` re-embeds pages and
      pushes fonts out of the page's own resource dictionary. Subset fonts can
      omit digits, so glyphs must be verified before use.
- [ ] `xlsx-sign.js` still stretches signatures via its `tl`/`br` anchors.
      `fitContain()` fixed this for PDFs only.
- [ ] Background removal is withdrawn from the UI (`bb60b7d`). The code and its
      unit tests remain in the tree, unreferenced. **It was never once verified
      against a real signature photograph** — that must happen before it is
      re-enabled.

Done and live: `fitContain()`, so signatures are no longer stretched out of
proportion.

---

## S3 / RustFS storage — **one user proven end to end**

**Working as of 2026-08-26.** Taha Chunawala's documents are served from the
bucket: 143 objects (72 documents, 43 signed, 24 signatures, 4 voice notes,
66.2 MB), and 188 database columns repointed from filenames to bucket keys.
Every column was changed only after the object was downloaded in full and its
sha256 matched the file still on disk. Rollback file on the box at
`server/repoint-rollback-2026-08-26T06-26-56.json`; `--revert` puts it all back.

Blocking the rest:

- [ ] **Bucket quota is 200 MiB; the estate is 648 MB.** Ask for 5 GB — roughly
      two years at the observed ~200 MB/month. The first full upload got 281
      files in before the quota refused the remaining 590.
- [ ] Decide whether `signflow-uat` becomes the production store or a separate
      `signflow-prod` bucket is created. Moving 648 MB twice is wasted effort.
- [ ] Enable **versioning** — 92 files were lost in May; versioning makes an
      accidental delete recoverable.
- [ ] Arrange a **backup of the bucket**. Once disk writes stop, the bucket is
      the system of record and nothing currently backs it up.
- [ ] Rotate `STORAGE_SECRET_KEY` and **delete the old key in the RustFS
      console** — replacing the GitHub secret alone revokes nothing.

Smaller, still open:

- [ ] `documents/req_mt9o6rit_3clur.pdf` — a live dual-write object belonging to
      another user, deleted during the bucket clear-out. Its row holds a key with
      no object and falls back to disk, which works but warns on every read.
      Either restore the object or repoint that row back to a filename.
- [ ] Signatures and voice notes are still written to disk only. Stamping reads
      signature images by PATH (`pdf.js` `embed()`, `xlsx-sign`), so moving them
      means reworking stamps to carry bytes.

Learned the hard way: **the manifest is a point-in-time snapshot.** Four
signature files created after the inventory ran were silently absent from the
upload list, and the repoint refused them. Inventory and upload must run close
together, or re-run inventory first.

## S3 / RustFS storage — earlier notes

Restarted 2026-08-25, dump first. `server/scripts/dump-uploads.mjs` takes a
read-only inventory of the uploads tree and pairs every file with the rows that
reference it; runbook in `docs/S3-MIGRATION-DUMP.md`. S3 keys mirror the
directory layout, so each column's existing value is already the key suffix.

- [ ] Run the dump on the production box and read `report.txt` — the orphan and
      missing lists are decisions, not noise.
- [ ] Decide whether orphaned files (no database reference) get uploaded.
- [ ] Upload, then verify against the manifest's `sha256` column.
- [ ] **Schema change deferred.** Whether the S3 URL columns are
      reference-only, a full cutover, or a backfill-now/cutover-later is still
      undecided. Nothing is repointed until the bucket is verified complete.

Earlier review findings, still binding:

- The proposed module is CommonJS; the server is `"type": "module"`.
- The presigned-redirect route must be dropped. It bypasses `authoriseAccess`,
  the confidential unlock gate and `logAccess`, and returns **undecryptable
  ciphertext** for confidential documents, which are encrypted before storage.
- Its 10 MB cap conflicts with the 15 MB multer limit and the 14 MB client check.

**Decided.** Scope is **all four areas** — documents, signed, signatures and
voicenotes (owner, 2026-08-25). Copying documents alone would give a bucket that
could never be cut over to: the signed PDFs are the legally meaningful
artefacts, and the signatures are what stamp them. All four verified
byte-for-byte against the real bucket, `voicenotes` included by planting a probe
file, since that area is empty locally and would otherwise have gone untested.

Presigned URLs are dropped and the presigner package is deliberately not
installed. Confidential files are copied still encrypted; their bytes are never
decrypted to move them.

Still needed: the six `STORAGE_*` repository secrets (only the owner can add
them — use a **rotated** key, the current one has been pasted into a chat twice),
a production bucket separate from UAT, and a backup story for the bucket once
the files stop living on the EC2 box.

---

## Unresolved report: "1hr rejection" approver visibility

Investigation paused mid-way. What was established:

- The approver's own queues are computed correctly
  (`pending.concat(pendingApproved)`), and both approve paths set `approver_id`,
  so a request they signed does not vanish.
- **Found:** the list query's team-authority clause matches only
  `status = 'pending'` (`server/src/routes/requests.js:206`). A *second*
  approver holding the same team's signing authority therefore loses sight of a
  request once a colleague signs it. This may or may not be the reported
  symptom.

Needs a concrete description of what the approver actually saw.

---

## Test-suite health

- [ ] Integration suites do not load dotenv. They need `node --env-file=.env`
      and a running API on 5001; otherwise they fail with
      `Access denied for user 'root'@'localhost'`.
- [ ] `security.integration.mjs:87` and `events.integration.mjs` use
      `path.join("server", "uploads", …)` — a path relative to the repo root,
      but the suites run from `server/`, so they write to `server/server/…`.
      The file never lands where the server looks. This is why
      `security.integration` fails its *permissive* check; the actual security
      assertion (a non-participant is blocked) passes.
- [ ] Five pre-existing integration failures, all verified against the parent
      commit: `expenses` (that feature is commented out, so expected),
      `oneaccess-upsert`, `security`, `self-sign`, `signer-date`.
- [ ] `workflow-validity.integration.mjs` is flaky — `Assertion failed:
      !(handle->flags & UV_HANDLE_CLOSING)`, a libuv teardown abort on Windows,
      not a test assertion. Measured 3 pass / 3 fail on current code versus
      1 pass / 5 fail on the parent commit, so it is environmental.

---

## Security and hygiene

- [ ] **Rotate the RustFS secret key and the `hqhbadmin` console password.**
      Both were pasted into a chat transcript in plaintext.
- [ ] **`test.js` at the repo root contains a production login in plaintext.**
      Never committed and now gitignored, but still sitting on disk. Delete it,
      and rotate that password too.
- [ ] Three logo files remain uncommitted: `fbd-logo.png`, `org-emblem.png`,
      `qh-logo.png`. `qh-logo.png` is needed once the landing picker lands.
