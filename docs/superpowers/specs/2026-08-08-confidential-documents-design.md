# Confidential Documents — Design

**Status:** approved for implementation (Phase 1)
**Date:** 2026-08-08
**Supersedes:** nothing. **Deferred successor:** Phase 2, true end-to-end encryption (separate spec).

---

## 1. Problem

Some documents routed through SignFlow — HR actions, legal matters, board papers — must not be
readable by anyone outside their approval route. The owner's requirement, verbatim:

> "…so that the documents cannot be viewed by anyone not even Admin or the database."

Today every document is stored as plaintext on disk, and `authoriseAccess` grants any `admin`
unconditional access to every file.

## 2. What this phase does and does not achieve

This is the single most important section. It must not be softened later.

**Defends against:**

- A database dump or SQL export — documents are not in the database, and the key is not either.
- A stolen backup, disk image or EC2 snapshot — files at rest are ciphertext.
- The IT Admin opening the document in the UI — admins are locked out in code.
- Any authenticated user who is not on the approval route.
- Leakage through the request list, reports, CSV exports, notification emails and the email log.
- A stolen session token or an unattended logged-in laptop — an emailed code is required at the
  moment of viewing, not merely at sign-in.

**Does NOT defend against:**

- Anyone with shell access to the EC2 instance. They can read `CONFIDENTIAL_KEY` from the
  environment and decrypt at will. The unlock code gates the API, not the mathematics.
- A photograph of the screen. No software control prevents this; the watermark deters and
  attributes it.

Phase 2 (client-side encryption) is what removes the server from the trust boundary. Phase 1 is
deliberately not that, and the UI copy must not claim otherwise.

### 2.1 Why the unlock code cannot be the encryption key

A six-digit code is one million possibilities — anyone holding the ciphertext exhausts that range
in well under a second. A secret strong enough to be a key factor is too long to retype from an
email. This is why Phase 2 uses a user-chosen passphrase rather than a code.

## 3. Decisions taken

| Decision | Choice | Rationale |
|---|---|---|
| Key custody | Server-held, in `CONFIDENTIAL_KEY` env var | Phase 1 scope; Phase 2 moves it to the user. |
| Step-up factor | Emailed 6-digit code only | Owner's choice. Passkey step-up was offered and declined; it remains available for Phase 2. |
| Unlock window | 120 seconds (raised from 60 on 2026-08-10) | Owner's choice. The original 60s kept expiring mid-read in real use — the flagged risk materialised — and was doubled at the owner's request. |
| Download | Requestor only, and only once `status = 'approved'` | A downloaded copy escapes every control here. |
| Printing | Disabled entirely for confidential documents | Printing is a copy. |
| Executive Assistants | Excluded, even with `can_view` delegated | Widening the circle undermines the guarantee. |
| IT Admin | Excluded from file access and from file names | This is the point of the feature. |

**The owner is the IT Admin.** Enabling this locks the owner out of these documents too. That is
intended, not a side effect.

## 4. Architecture

Five units, each independently testable.

### 4.1 `server/src/confidential.js` — the crypto boundary

The only module that knows about encryption. Everything else calls it.

```
encryptBuffer(plain)  -> Buffer   // self-describing envelope
decryptBuffer(stored) -> Buffer
looksEncrypted(buf)   -> boolean  // magic-byte check
isEnabled()           -> boolean  // CONFIDENTIAL_KEY present and 32 bytes
readMaybe(fullPath)   -> Buffer   // decrypts if encrypted, else returns as-is
```

**Envelope layout**, written as a single file — no companion metadata column to fall out of sync:

```
byte 0        magic 0xC1
byte 1        version (0x01)
byte 2        key id  (0x01)          -- lets a future key rotation identify the wrapping key
bytes 3..14   IV (12 bytes, random per file)
bytes 15..N   ciphertext
last 16 bytes GCM authentication tag
```

Cipher: **AES-256-GCM** via `node:crypto`. The auth tag means tampering is detected on read, not
silently decrypted into garbage.

**Fail closed.** If `CONFIDENTIAL_KEY` is missing or not 32 bytes, `isEnabled()` is false, the
Confidential toggle is hidden in the UI, and the API rejects `confidential=true` with an explicit
error. A misconfigured deploy must never quietly store a "confidential" document as plaintext.

### 4.2 Storage

Encrypted files keep the existing directories and gain a `.enc` suffix
(`uploads/documents/<id>.pdf.enc`). The suffix plus the magic byte make detection unambiguous, and
legacy plaintext files continue to work untouched — `readMaybe` handles both.

Schema additions (idempotent `tryExec`, per the existing migration pattern):

```sql
ALTER TABLE requests ADD COLUMN confidential TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS confidential_unlocks (
  id              VARCHAR(64) NOT NULL PRIMARY KEY,
  request_id      VARCHAR(64) NOT NULL,
  user_id         VARCHAR(64) NOT NULL,
  code_hash       VARCHAR(255) NOT NULL,   -- bcrypt; never the code itself
  issued_at       BIGINT NOT NULL,
  code_expires_at BIGINT NOT NULL,         -- issued_at + 5 min, to enter the code
  consumed_at     BIGINT DEFAULT NULL,
  window_ends_at  BIGINT DEFAULT NULL,     -- consumed_at + UNLOCK_WINDOW_MS (120s)
  attempts        INT NOT NULL DEFAULT 0,
  INDEX idx_cu_req_user (request_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS confidential_access_log (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  user_id    VARCHAR(64) NOT NULL,
  action     VARCHAR(24) NOT NULL,   -- 'unlock_sent' | 'unlock_ok' | 'unlock_fail' | 'view' | 'sign' | 'download'
  at         BIGINT NOT NULL,
  ip         VARCHAR(64) DEFAULT NULL,
  INDEX idx_cal_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Two deliberate exclusions: the plaintext code is never stored, and the access log records *that* a
document was opened, never any of its content.

### 4.3 Signing without plaintext on disk

The stamping pipeline currently reads a path and writes a path. For confidential documents it must
work entirely in memory.

- `stampPdfMulti({ srcPath, ... })` gains a sibling `stampPdfMultiBytes({ srcBytes, stamps })`
  returning `Uint8Array`; the path-based function becomes a thin wrapper so PDF behaviour is
  provably unchanged.
- `signXlsxBuffer({ buffer, stamps })` already exists (added with Excel signing) and needs nothing.
- Approve handlers become: `readMaybe` → stamp in memory → `encryptBuffer` → write.

At no point does a decrypted confidential document touch the filesystem.

### 4.4 The unlock gate

Three endpoints, all restricted to participants of a confidential request.

**`POST /api/requests/:id/unlock`** — issues a code.
Generates six digits with `crypto.randomInt(100000, 1000000)`, bcrypt-hashes it, stores the row,
and emails the code. Rate limit: **5 issues per user per request per 15 minutes**; beyond that,
429. Returns `{ sent: true, to: "t••••@hqhb.in" }` — masked, so the response cannot be used to
enumerate addresses.

**`POST /api/requests/:id/unlock/verify`** `{ code }` — opens the window.
Rejects if the code has expired (5 minutes), is already consumed, or `attempts >= 5`. Every failure
increments `attempts` and logs `unlock_fail`. On success sets `consumed_at` and
`window_ends_at = now + 120_000`, returns `{ windowEndsAt }`.

**Every read of a confidential document** — `GET /:id/file`, `GET /:id/signed`, and the approve
route — requires a live window for that user:

```sql
SELECT 1 FROM confidential_unlocks
 WHERE request_id = ? AND user_id = ? AND consumed_at IS NOT NULL AND window_ends_at > ?
```

Without one: `403 { error: "locked", needsUnlock: true }`, which the client turns into the unlock
prompt rather than a generic failure.

Approving requires a live window too — you cannot sign what you are not currently permitted to see.

**The clock starts at verification**, immediately before the document loads, so the window is
120 seconds of actual visibility rather than being partly consumed by the email round trip.

**The requestor is not exempt.** Re-opening their own confidential document later requires a code
just as an approver does — otherwise the guarantee is only as strong as the raiser's session.
Creating the request is the one exception: the file is being uploaded from their own machine and
they already hold it, so placing signature boxes during creation needs no unlock.

**Composition with the 1-hour rejection window is unchanged.** The two are independent: the
approval window governs when a document is final, the unlock window governs whether it can be
displayed right now. A confidential document inside its rejection hour still needs a code to view.

### 4.5 Access control and redaction

`authoriseAccess` gains one line, placed **above** the admin shortcut:

```js
if (row.confidential && user.role === "admin") return false;
```

Admins keep operational visibility — that a confidential request exists, its status, participants
and timestamps — because they must still be able to support the system. They lose the file and the
file name. A name like `PR Termination - <person>.pdf` leaks the substance, so for any viewer who
is not a participant the name is replaced with **"Confidential document"** and the note is dropped.

This redaction happens once, in a helper applied at the route layer after `hydrateRequest`, so
there is a single place to audit. It covers the request list, reports, and CSV exports.

Executive Assistants are excluded: confidential requests are filtered out of EA views entirely,
regardless of `can_view`.

### 4.6 Notifications

Confidential requests use dedicated templates that never name the document:

- `confidential_new_request`, `confidential_your_turn`, `confidential_approved`,
  `confidential_rejected` — "A confidential document requires your signature", plus a link.
- `confidential_unlock_code` — the code on its own line, labelled `Unlock code:`.

`redactEmailBody` gains `Unlock code:` alongside the existing `Reset code:` / `OTP:` patterns, so a
live code is never persisted in the email log.

The one-tap email Approve button is **disabled** for confidential documents: approving from an
email would bypass the unlock gate entirely.

### 4.7 Client

- **NewRequest** — a Confidential toggle beside the request type, shown only when the server
  reports the feature enabled. Its warning text: *"Only you and the signers will ever be able to
  open this. IT support cannot view or recover it."*
- **UnlockModal** — "A 6-digit code has been sent to t••••@hqhb.in", code input, resend,
  and the remaining-attempts count on failure.
- **Viewer** — a countdown pill; at zero the document blanks and offers a new code. A watermark
  across the view carries the viewer's name and the timestamp.
- **RequestRow** — a lock badge on confidential rows.
- **DownloadBtn / PrintBtn** — hidden for confidential unless the viewer is the requestor and the
  status is `approved`; the server enforces the same rule independently.

## 5. Key management

`CONFIDENTIAL_KEY` is a **secret string, not a raw key**. The AES key is derived
from it with scrypt, so any sufficiently long random value works — at least 24
characters. Demanding an exact 32-byte base64 blob proved fragile in practice: a
BOM from PowerShell redirection, a trailing newline or wrapping quotes silently
produced the wrong bytes and the feature simply stayed off. A BOM, quotes and
surrounding whitespace are now stripped before derivation.

Generate:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Store as the GitHub Actions secret `CONFIDENTIAL_KEY`, added to the three places in
`.github/workflows/deploy-uat.yml` that carry `SENDGRID_API_KEY` (the step `env:`, the `envs:`
list, and the `.env` sync script).

**Losing this key destroys every confidential document irrecoverably.** It must be backed up in a
password manager before the feature is switched on. This is the operational cost of the guarantee.

## 6. Error handling

| Situation | Behaviour |
|---|---|
| `CONFIDENTIAL_KEY` absent | Toggle hidden; `confidential=true` rejected with a clear error. Existing confidential documents return 503, never plaintext. |
| Wrong or rotated key | GCM tag check fails; 500 with "Could not open this document". Never a partial or garbled file. |
| Code expired (5 min) | 400 `code_expired`; client offers resend. |
| Window expired (120 s) | 403 `locked`; viewer blanks, client offers a new code. |
| 5 failed attempts | Row is dead; a new code must be issued. Logged as `unlock_fail`. |
| More than 5 codes / 15 min | 429. |
| Legacy plaintext file | `readMaybe` returns it unchanged — no migration needed. |

## 7. Testing

Server, as integration tests beside the existing suite:

1. Envelope round-trip: `decryptBuffer(encryptBuffer(x)) === x`; a flipped ciphertext byte throws.
2. An uploaded confidential file on disk is **not** a valid PDF — assert the magic byte, proving it
   is genuinely encrypted rather than merely flagged.
3. The signed output is encrypted too, and no plaintext file is left in `uploads/`.
4. Admin gets 403 on the file and sees "Confidential document" instead of the name.
5. A participant without a live window gets 403 `needsUnlock`; with one, 200.
6. The window expires when window_ends_at passes — same request, 403 afterwards.
7. Wrong code increments attempts; the 6th attempt is refused.
8. A 6th code request inside 15 minutes returns 429.
9. Approve is refused without a live window.
10. The notification email body contains neither the file name nor the code; the logged copy has the
    code masked.
11. Download: refused for an approver; refused for the requestor while pending; allowed for the
    requestor once approved.
12. The requestor also needs a live window to re-open their own confidential document.
13. A non-confidential request is completely unaffected — the existing suites must still pass.

Client unit tests for the countdown and lock states.

## 8. Out of scope

Client-side encryption, passkey step-up, SMS codes, and key-rotation tooling. The envelope reserves
a key-id byte so rotation is possible later without re-designing storage.

## 9. Risks

- ~~60 seconds may prove too short~~ It was: the window kept expiring mid-read, and was raised
  to 120 seconds on 2026-08-10. If two minutes also proves short, the next step is an in-window
  one-click extension rather than a longer default.
- **The code shares a channel with sign-in.** oneAccess authenticates against the same mailbox, so
  whoever controls the email controls both factors. Accepted; passkey step-up in Phase 2 fixes it.
- **Phase 1 does not meet the literal "not even Admin" bar** against someone with server access.
  The UI must not overstate the guarantee.
