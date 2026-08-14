# SignFlow — Product Requirements Document (PRD)

| | |
|---|---|
| **Product** | HQHB · SignFlow — digital signature & approval workflow platform |
| **Live URL** | https://signflow.umooriqtesadiyah.org |
| **Document version** | 1.0 |
| **Date** | 27 July 2026 |
| **Owner** | IT, HQHB (it@hqhb.in) |
| **Status** | Current release documented as-built; roadmap items marked *Planned* |

---

## 1. Product overview

SignFlow is an internal web platform through which HQHB staff raise documents for
approval, route them to the right authority, capture verified digital signatures,
and maintain a complete audit trail. It replaces paper circulation and ad-hoc
email chains with a single system of record: every request has an owner, a
route, a status, timestamps (IST), and a downloadable signed file.

**One-line value:** *Request. Review. Approve. Track. All in one place.*

---

## 2. Problem statement & goals

### Problems addressed
1. Physical signatures require chasing people across offices; documents stall
   with no visibility into where or why.
2. Email-based approvals scatter the record — no single place shows what was
   approved, by whom, and when.
3. Multiple identity silos (work email accounts vs. the organisation's oneAccess
   identity) create duplicate users and inconsistent access.
4. Senior signers (executives) are frequently unavailable; their offices need a
   controlled way to keep documents moving.

### Goals
| # | Goal | Measure |
|---|------|---------|
| G1 | Every approval is digital, stamped, and traceable | % of approvals through SignFlow; audit completeness |
| G2 | Fast turnaround | Time from request to approval (per-approver delay report) |
| G3 | One identity per person | Zero duplicate active accounts (ITS reconciliation) |
| G4 | Approvals never stall on availability | Email one-tap approve; EA delegation; reminders |
| G5 | Zero credential/biometric liability | No biometric data stored; reset codes/passwords redacted from admin surfaces where user-owned |

---

## 3. Users & roles

| Role | Description | Key abilities |
|------|-------------|---------------|
| **Requestor** | Staff member who raises documents | Create requests (5 types), place signature/date boxes, track status, withdraw pending requests, view signed output |
| **Approver** | Team authority who signs | Review queue, approve/reject with reason, batch approve, sign multiple boxes, 1-hour undo window, act from email |
| **Executive** | Senior signer | Everything an Approver does, plus: owns delegation settings and can appoint Executive Assistants |
| **Executive Assistant (EA)** | Supports one or more executives | Always: view each mapped executive's pending documents. When permitted per-link: approve/sign on the executive's behalf (stamping either the executive's or their own signature, per that executive's setting) |
| **IT Admin** | System owner | Full console: users, teams & signing authority, documents, reports, email log, account reconciliation, role changes |

Identity note: a person has exactly one active account. oneAccess (the
organisation's SSO) is the standard door for users; email+password is the
admin door. Duplicate accounts are merged by ITS id (see §4.2).

---

## 4. Functional requirements (as built)

### 4.1 Authentication

- **FR-A1 · oneAccess SSO (primary).** Login page offers only "Sign in with
  oneAccess" to regular users. Redirect flow against the production oneAccess;
  tokens verified locally (RS256 public key), profile mirrored into the local
  user store. New SSO users are created as Requestors.
- **FR-A2 · oneAccess never grants admin.** An SSO login resolving to an admin
  account is refused; admin access is email+password only.
- **FR-A3 · Admin door.** "Click here to login as an Admin" (also `/superadmin`)
  reveals the email+password form. Any password-holding account may use it;
  admins can *only* use it.
- **FR-A4 · Biometric sign-in (WebAuthn/passkeys).** Optional per-device add-on:
  the user enables Face ID / Windows Hello / Touch ID from the profile menu, after
  which a "Sign in with Face / fingerprint" button signs them in without a
  password. The device performs the biometric check; the server stores only a
  public key + counter — never biometric data. Unregistered attempts receive
  "Please register on oneAccess to sign in!" and are redirected to oneAccess.
  Credentials are domain- and device-bound. A proactive prompt invites enrolment.
- **FR-A5 · Self-service password reset (email OTP).** "Forgot password?" emails
  a 6-digit one-time code (crypto-random, hashed, single-use, 10-minute expiry,
  5-attempt cap, 45-second resend cooldown, anti-enumeration). The user sets a
  new password themselves; IT is not in the loop — the code is redacted from the
  admin email log and the chosen password is not admin-visible.
- **FR-A6 · Work-email capture.** A brand-new oneAccess user is prompted once
  (blocking screen) for their work email, which becomes the account's primary
  address for all notifications; the SSO email is retained as a secondary for
  login matching. Collisions with an existing account are refused with guidance
  to contact IT.
- **FR-A7 · Session.** JWT bearer tokens (30-day), bcrypt password hashes,
  deactivated accounts cannot sign in via any method.

### 4.2 Identity reconciliation (one person, one account)

- **FR-I1 · ITS as the person key.** Admin records each user's ITS id inline on
  the Users page.
- **FR-I2 · Merge on collision (review-and-confirm).** When two active accounts
  share an ITS, a merge review opens: the @hqhb.in account is the keeper (admin
  chooses if ambiguous). On confirm, the duplicate's requests, approvals,
  signing steps, signing authority and signature migrate to the keeper; the
  keeper inherits the ITS and the duplicate's address as secondary email; the
  duplicate is **deactivated (reversible), never hard-deleted**; an audit row
  records the merge. "Accounts review" lists oneAccess sign-ins with their
  document footprint plus name-match duplicate candidates and same-ITS merge
  candidates.
- **FR-I3 · Post-merge routing.** A future oneAccess login resolves by ITS to
  the surviving account; deactivated accounts vanish from signer/approver pickers.

### 4.3 Requests & documents

- **FR-R1 · Request types.** Leave Approval, Document Approval, Expense
  Approval, Invoice/PO, Other — chosen up front, used for sorting/filtering.
- **FR-R2 · Files.** PDF and Excel (.xlsx) up to 14 MB. PDFs support lossless
  90° rotation (native page rotation; scanned documents do not degrade).
- **FR-R3 · Placement.** Requestor places signature boxes per signer — multiple
  boxes per signer supported — plus optional date fields that fill with the
  actual signing date. Placement panel sits beside the document on desktop;
  responsive on mobile. Requestors may also self-sign/date before sending.
- **FR-R4 · Routing.** Either to a **team** (any approver holding that team's
  signing authority may act) or **direct person-to-person**, including
  multi-step workflows (step 2 activates when step 1 completes; per-step,
  per-signer status).
- **FR-R5 · Lifecycle.** pending → approved_pending (1-hour undo window for the
  approver) → approved (finalized, signed file generated) | rejected (with
  reason) | withdrawn (by requestor while pending). Admin can force-finalize.
  Completion shows IST date + time (hour:minute).
- **FR-R6 · Signing output.** Signature images are stamped rotation-aware into
  the exact placed boxes; the signed PDF is downloadable/printable by the
  requestor, signers, and admin.
- **FR-R7 · Reminders.** Requestor may nudge pending approvers; 24-hour
  cooldown per request; automatic reminder scheduling server-side.
- **FR-R8 · Batch approve.** An approver can approve multiple same-type
  requests in one action.

### 4.4 Approve from email

- **FR-E1 · One-tap approve.** The new-request email carries an Approve button
  with a signed single-purpose token (request + approver, 7-day expiry). It
  opens a lightweight confirm screen — the token is the authentication, so no
  login is needed; a deliberate confirm tap prevents mail-scanner prefetch from
  approving documents. The signing path is identical to in-app approval.
- **FR-E2 · Deliverability gate.** The Approve button is only included once the
  sending domain is authenticated (SPF/DKIM), so the button never ships from an
  unauthenticated sender.

### 4.5 Executive Assistant (delegation)

- **FR-EA1 · Mapping.** Admin (or the executive) links assistants to
  executives; one EA may support many executives. Each link carries that
  executive's own settings: `can_approve` on/off and `signature_source`
  (executive's signature vs. assistant's own).
- **FR-EA2 · EA dashboard.** The EA sees each mapped executive's pending
  documents, with an account switcher; the EA also has a personal dashboard on
  their own account.
- **FR-EA3 · Approve-on-behalf.** Permitted EAs approve/sign the executive's
  documents; the stamped signature follows `signature_source`. Signature
  management for the executive is gated by `can_approve` (a view-only EA cannot
  replace a signature image).
- **FR-EA4 · Visibility.** Rights are visible at a glance in admin UI, with a
  grant-all shortcut; honorific greetings supported.

### 4.6 Notifications (email)

- **FR-N1 · Events.** New request (to approvers/signers), approved, rejected,
  reminder, welcome/invite, password reset OTP — branded HTML templates with the
  shared greeting ("Afzalus Salaam,"), deep links straight to the document, and
  personalized subjects.
- **FR-N2 · Delivery.** SendGrid, from it@hqhb.in; send-once semantics; every
  send logged.
- **FR-N3 · Email log (admin).** Full log of sends with delivery status;
  passwords and reset codes are redacted from logged bodies.

### 4.7 Administration

- **FR-AD1 · Users.** Create individually or bulk (CSV/Excel); invite emails
  with generated credentials; password reset (admin-set or generated);
  plaintext-visible current password per user (deliberate internal-tool choice);
  inline edit of email, ITS id, and role; team assignment; deactivate/reactivate
  (via merge); delete with FK-safe unlinking.
- **FR-AD2 · Teams & signing authority.** Teams double as departments; approvers
  hold signing authority per team; oneAccess departments auto-map to teams.
- **FR-AD3 · Signatures.** Bulk upload signature images matched by email;
  per-user upload; users draw/upload their own (required before signing).
- **FR-AD4 · Documents.** All-documents view with team and status filters,
  download/print.
- **FR-AD5 · Registrations & password-reset queues.** Legacy IT-approval queues
  retained (self-registration UI removed; OTP reset replaced admin approval —
  both queues are dormant).
- **FR-AD6 · Accounts review.** oneAccess sign-in inventory with document
  footprint; duplicate detection (name-token match); merge candidates by ITS.

### 4.8 Reports (admin, date-ranged, CSV)

- **FR-RP1 · By approver.** Pick an approver → every document they approved
  (direct approvals + workflow signatures), submitted/approved IST timestamps,
  time-taken per document, average.
- **FR-RP2 · By department.** Pick an approving team → all requests routed to
  it, with status and completion summary (incl. withdrawn).
- **FR-RP3 · Approval delays.** Per approver: count, average / fastest /
  slowest time from request to approval, ranked with slowest/fastest flagged.
- **FR-RP4 · By requestor.** Per person: submitted totals (approved / pending /
  rejected) with department.
- **FR-RP5 · Controls.** Shared From/To date range (IST); one-click CSV
  download per report; full-log CSV export retained.

### 4.9 Platform

- **FR-P1 · PWA.** Installable (Add to Home Screen), custom SignFlow icons,
  silent auto-update on new deploys with an in-app update banner.
- **FR-P2 · Responsive.** Desktop-first admin; fully usable phone layouts for
  request, sign, and review flows.
- **FR-P3 · Timezone.** All user-facing timestamps rendered in IST regardless of
  device timezone.

---

## 5. Non-functional requirements

| Area | Requirement |
|------|-------------|
| **Security** | JWT (30-day) bearer auth; bcrypt hashing; oneAccess tokens verified locally against cached RS256 public key (alg-confusion rejected); role-gated APIs; single-use signed action tokens for email approve; OTP hashed + attempt-capped; deactivated accounts blocked on every path |
| **Privacy** | No biometric data stored (WebAuthn public keys only — DPDP-safe); reset codes and passwords redacted from the email log; user-chosen (OTP) passwords not admin-visible; anti-enumeration on public email endpoints |
| **Intentional trade-off** | Admin-visible plaintext of admin-set/temp passwords on the Users page is a deliberate internal-tool decision by the owner (documented; not a defect). The self-service OTP path is the deliberate exception |
| **Reliability** | Idempotent boot migrations (safe re-runs); reversible merges with audit; transactional multi-step operations |
| **Performance** | Client-side report computation from already-loaded admin data; focus/visibility-based refresh instead of constant polling |
| **Compatibility** | Evergreen browsers; WebAuthn features degrade gracefully (button hidden where unsupported/unenrolled) |
| **Auditability** | Request lifecycle timestamps; user_merges audit table; email log; per-signer signed-at records |

---

## 6. Architecture & deployment (summary)

- **Client:** React 18 + Vite + Tailwind, PWA. PDF render via pdf.js; sheets via
  SheetJS.
- **Server:** Node.js (ESM) + Express; MySQL (mysql2); pdf-lib for stamping
  (rotation-aware, lossless); SendGrid mail; @simplewebauthn for passkeys;
  JWT sessions.
- **Identity:** oneAccess (production) redirect SSO; local users table is the
  system of record with `auth_provider`, `its_id`, secondary email.
- **Hosting:** AWS EC2 behind nginx, pm2 process manager. SPA fallback serves
  the client; `/api/*` routes to Express.
- **CI/CD:** Push to the `UAT` branch → GitHub Actions build & deploy to
  production. DB migrations run automatically at boot (idempotent ALTER/CREATE
  guarded by tryExec).
- **Config:** All secrets via environment/GitHub secrets (SendGrid key, JWT
  secret, oneAccess endpoints); nothing hardcoded.

---

## 7. Out of scope (current release)

- Legally-binding e-sign (Aadhaar eSign / DSC) — signatures are organisational
  stamps, not statutory signatures.
- WhatsApp/SMS notification channel.
- In-app notification centre.
- Per-document immutable audit certificate page / QR verification.
- Delegation by time-window (out-of-office auto-handover) and SLA auto-escalation.
- Reusable request templates, drafts, clone.
- Admin 2FA (TOTP) on the password door; login rate-limiting.
- Full-text search across documents.
- Settings page (runtime config without redeploy).

## 8. Roadmap (proposed order)

| Phase | Item | Rationale |
|-------|------|-----------|
| Next | Audit trail + completion certificate (+ QR verify page) | Highest-trust upgrade for a signing system of record |
| Next | Delegation windows + auto-escalation on delay | Keeps documents moving; complements EA |
| Then | In-app notification centre; WhatsApp alerts | Faster action than email alone |
| Then | Settings page; analytics dashboard on the report layer | Admin agility & insight |
| Later | Admin TOTP 2FA + rate limiting; full-text search; templates/drafts; Aadhaar eSign evaluation | Hardening & scale |

---

## 9. Success metrics

1. **Adoption:** % of organisational approvals executed in SignFlow.
2. **Turnaround:** median request→approval time (target: same business day);
   tracked via the Approval-delays report.
3. **Identity hygiene:** zero active duplicate accounts; 100% of active users
   reachable at a confirmed work email.
4. **Deliverability:** notification emails landing in inbox (SPF/DKIM/DMARC
   authenticated), measured by the email log delivery status.
5. **Self-service:** password resets completed without IT involvement.

## 10. Risks & open items

| Risk / item | Mitigation / owner |
|-------------|--------------------|
| DNS authentication (SPF/DKIM/DMARC) for hqhb.in pending completion | Owner to apply DNS records; email Approve button stays withheld until authenticated |
| oneAccess outage would block regular sign-in | Password door + biometric remain as fallbacks; local login deliberately still enabled |
| Admin password is a single factor | Roadmap: TOTP 2FA + rate limiting on `/superadmin` |
| Existing oneAccess users predate work-email capture | Admin can correct emails inline on the Users page |
| Prod duplicate merges pending owner's email↔ITS list | Merge tooling live; owner to execute via Accounts review |

---

*Prepared from the production codebase as of commit `ccb369d` (27 July 2026).*
