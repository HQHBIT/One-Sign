# Dumping the uploads tree for S3

How to take a complete, verifiable inventory of the files on the production
server so they can be uploaded to S3. This covers **the dump and the upload
only** — the database still points at local disk afterwards, and nothing about
the running application changes.

The schema change that records the S3 location is a separate, later step. It is
deliberately not part of this one: repointing columns before the bucket has been
proven complete would break signing with no way back.

---

## What gets dumped

Four directories under `server/uploads/`, and the eight columns that name files
in them:

| Area | Referenced by |
|---|---|
| `documents/` | `requests.file_path` |
| `signed/` | `requests.signed_file_path` |
| `signatures/` | `users.signature_path`, `user_signatures.file_path`, `user_signatures.original_path`, `requests.applied_signature_path`, `request_step_signers.signature_path` |
| `voicenotes/` | `requests.reject_voice_path` |

**S3 keys mirror the directory layout exactly** — `documents/req_abc123.pdf`.
This matters: the value already stored in each column *is* the key suffix, so
the later schema step is a concatenation rather than a lookup table, and any
file stays resolvable from the existing data even if the new columns are never
populated.

---

## Running it

On the EC2 box, from the `server/` directory:

```bash
node --env-file=.env scripts/dump-uploads.mjs --archive
```

Writes a `dump-<timestamp>/` directory containing:

- **`manifest.csv`** — one row per file on disk. This is the upload list:
  `s3_key`, `bytes`, `sha256`, `encrypted`, `db_references`.
- **`references.csv`** — one row per database reference. This is what drives the
  later `UPDATE`s: table, primary key, column, stored value, resolved `s3_key`.
- **`report.txt`** — counts, orphans, missing files.
- **`uploads-<timestamp>.tar.gz`** — the tree itself (`--archive` only).

The script is strictly read-only. It opens its own database connection rather
than calling `initDb()`, which would run the schema DDL and the seed — neither
belongs in a dump — and it issues `SELECT`s only.

---

## Reading the report

**Orphans** — on disk, referenced by no row. Expected: test fixtures, files from
deleted requests, the `gd_*` group-document parts. They are safe to upload but
carry no database reference, so nothing will ever point at them. Uploading them
costs a little storage and keeps the archive faithful; skipping them keeps the
bucket clean. Either is defensible — decide once and record which.

**Missing** — referenced by a row, absent from disk. Each one is a request whose
document cannot be served *today*, independently of S3. Worth reading before
uploading: S3 will not fix these, and the later schema step needs to know they
exist so the backfill does not treat them as failures.

**Encrypted** — confidential documents are AES-256-GCM sealed by
`server/src/confidential.js` before they ever hit disk, and are self-describing
via a `0xc1` magic byte rather than a file extension. They upload as ciphertext
and **must stay that way** — the bucket holds bytes nobody with console access
can read, which is the point. Do not decrypt to upload.

---

## Uploading

```bash
aws s3 sync uploads/ s3://<bucket>/ --exclude ".gitkeep"
```

Then verify against the manifest before treating the migration as done — the
`sha256` column exists so the S3 copy can be proven byte-identical, not merely
present. `aws s3 ls --recursive` confirms presence; only the hashes confirm
correctness.

---

## Constraints carried over from the earlier review

Recorded in `docs/OPEN-ITEMS.md` and still binding:

- **No presigned-URL redirects.** Both download routes
  ([requests.js:742](../server/src/routes/requests.js), and `:769`) stream bytes
  *through* the server after `authoriseAccess`, the confidential unlock gate and
  `logAccess`. A redirect bypasses all three, and hands back undecryptable
  ciphertext for confidential documents. The read path, when it changes, fetches
  from S3 server-side and keeps that shape.
- **Size limits must agree.** The 10 MB cap in the reviewed module conflicted
  with the 15 MB multer limit and the 14 MB client check.
- **Rotate the RustFS secret key and the `hqhbadmin` console password** before
  any of this goes live — both were pasted into a chat transcript in plaintext.
