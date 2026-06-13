# HQHB · SignFlow — IT Admin Handbook

**For:** Taha Chunawala — IT Admin
**Version:** Beta 1.0
**URL:** https://onesign.devhqhb.online

---

## Table of contents

1. [The big picture](#1-the-big-picture)
2. [Your admin dashboard](#2-your-admin-dashboard)
3. [Onboarding a team end-to-end](#3-onboarding-a-team-end-to-end)
4. [Managing individual users](#4-managing-individual-users)
5. [Managing teams and signing authority](#5-managing-teams-and-signing-authority)
6. [Passwords — reset, set, change, recover](#6-passwords)
7. [Signatures](#7-signatures)
8. [Documents and audit](#8-documents-and-audit)
9. [Reports](#9-reports)
10. [Email log (and SendGrid)](#10-email-log)
11. [Daily admin checklist](#11-daily-admin-checklist)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. The big picture

SignFlow handles three primary roles. Every user is one of these:

| Role | What they do |
|------|--------------|
| **Requestor** | Uploads a document, picks who needs to sign it, submits it. Belongs to one team (their department). |
| **Approver** | Receives requests routed to them. Reviews, then either signs (approves) or rejects with a reason. Holds *signing authority* over one or more teams. |
| **Admin** | You. Sets up the org — teams, users, signatures. Sees everything. |

A typical request flow:

```
Karim (requestor in Ops)
        │  uploads a PDF + picks Finance team
        ▼
   SignFlow routes the doc to all
   approvers holding signing authority on Finance
        │
        ▼
Jane (approver on Finance) reviews → Approve / Reject
        │
        ▼
   Either Karim downloads the signed PDF
   or sees the rejection reason
```

There are two flavours of routing:

- **Single approver** — *any* approver on the target team can sign. First one wins. Useful for routine docs.
- **Multi-step workflow** — *specific* people across one or more teams sign *in order*. Step 1 must complete before Step 2 starts. Useful for sign-off chains (e.g. Manager → Director → CFO).

---

## 2. Your admin dashboard

Sign in at the URL above with your admin credentials. You land on the **Administration** home with six tiles:

| Tile | What it does |
|------|--------------|
| **Onboard team** | The fastest way to add a whole team at once — pick (or create) the team, upload an Excel/CSV of members, choose roles, send welcome emails. |
| **Users** | The master user list with passwords visible, reset / invite buttons, mobile-friendly cards. |
| **Teams & authority** | Create teams, edit who's an approver vs member, jump to that team's documents. |
| **Signatures** | Upload signatures in bulk on behalf of users (by email filename). |
| **All documents** | Every request in the system. Filter by team + status. Download or print any file. |
| **Reports** | Team-wise totals, top approvers, CSV export. |
| **Email log** | Every email SignFlow has ever tried to send — useful when SendGrid isn't configured. |

The top nav also gives you a **Password** button (change your own password) and **Add signature** (your own signature, used if you ever sign as an admin).

---

## 3. Onboarding a team end-to-end

The recommended new-team flow:

### Step 1 — Send the onboarding form
Use the file `docs/onboarding-form.csv` (open in Google Sheets and share with the department head). They fill in:
- Team name
- Department head's name + email (will be **approver**)
- Members' names + emails (will be **requestors**)

### Step 2 — Open Admin → **Onboard team**
A 4-step wizard:

```
Step 1 · TEAM          Step 2 · UPLOAD       Step 3 · REVIEW       Step 4 · DONE
  ⦿ Existing team       Choose file →         ☑ Send welcome        ✓ X created
  ○ Create new          (xlsx or csv)         emails                ✓ Y invites sent
  [pick / type name]    OR Add row manually
                        OR Download template
```

### Step 3 — Get the import file
On step 2 you have three options:

- **Download template** — gets you `team-members-template.xlsx` with the exact columns. Fill in your data, save, then **Choose file** to upload.
- **Choose file** — upload your Excel/CSV directly.
- **Add row manually** — for small teams, type rows in-line.

**Required columns:** `name`, `email`. **Optional:** `role` (defaults to `requestor`; set to `approver` to make someone a signer for this team).

### Step 4 — Review + send
On Step 3:
- See the parsed list, edit any row if needed
- Toggle **"Send welcome emails with credentials"** (default ON)
- Click **Create users & send invites**

### Step 5 — Confirmation
Step 4 shows you which users were created and how many invite emails went out. Any failures are listed individually so you can fix them.

> **Important:** the welcome email contains the generated password. The user signs in with it, then changes it from the top nav. Admins never need to know the password — but it's also stored on the user record (visible to you on the Users page) so you can share manually if SendGrid isn't delivering.

---

## 4. Managing individual users

Admin → **Users**.

### What you see per user

| Column | Meaning |
|--------|---------|
| Name | Their full name. A small ✎ next to it means they've registered a signature. |
| Email | Sign-in identifier. |
| Role | requestor / approver / admin pill. |
| Team / Authority | For a requestor, their department. For an approver, the teams they can sign for. |
| Password | Current password, masked. **👁 reveal**, **📋 copy**, auto-refreshed every 20s. |
| Actions | **📧** send invite, **🔑** reset password, **🗑** delete. |

The page **auto-refreshes every 20 seconds** so when a user changes their own password from another browser, you see the new value within 20s. Manual **Refresh** button in the toolbar forces it immediately.

### Adding a single user

Click **Add user** → a 3-step wizard:
1. **Identity** — name, email, password
2. **Role & assignment** — pick requestor / approver / admin. Approvers pick signing authority teams; requestors pick a department.
3. **Confirm** — review and create.

### Bulk-uploading users

Click **Bulk upload CSV** for the legacy CSV format. (Most of the time, **Onboard team** is the better path.)

### Sending or resending a welcome email

Click the **📧 Mail** icon on any non-admin row. A new random password is generated, hashed, and emailed using the welcome template.

### Resetting a password

Click the **🔑 Key** icon. A modal opens:

```
Reset password
  Jane Doe
  jane@hqhb.in

  NEW PASSWORD
  [_____________________]  👁  🔄
  Empty → auto-generate.

  [Cancel]  [Generate & email]
```

- Leave blank → server generates a secure random one.
- Or type whatever you want → it's set exactly as typed.
- Click submit → user gets an email titled *"Your HQHB SignFlow password has been reset"*.

### Deleting a user

**🗑 Trash** icon. A confirmation modal explains:
- Their name is replaced by "(deleted user)" on past requests.
- Documents stay intact.
- In-flight workflows where they were a pending signer need to be re-routed.

---

## 5. Managing teams and signing authority

Admin → **Teams & authority**.

### Creating a team
Type a name in the top field, click **Add team**.

### Editing membership
Each team card has two editable sections:

**Approvers** — who can sign documents routed to this team.
- ➕ **Add** → picker of any approver not yet on this team. Click → granted instantly.
- **X** on a row → revokes that approver's authority (with confirmation).

**Department members** — requestors whose department is this team.
- ➕ **Add** → picker of any requestor not in this team (shows their current team if any).
- **X** on a row → removes them (with confirmation). They become teamless until reassigned.

### Viewing a team's documents
**Documents** button in the card header → opens the Documents view pre-filtered to that team only.

### Deleting a team
🗑 in the card header → confirmation. Approvers lose authority, members are unassigned. Past requests stay intact.

---

## 6. Passwords

### How they work
Two things are stored for every user:
- `password_hash` — bcrypt hash used to authenticate sign-in.
- `last_temp_password` — the current plaintext, visible to admins only on the Users page.

The plaintext is updated **every time** the password changes:
- Admin creates a user
- Admin sends invite / resets password
- User clicks **Forgot password?** on login
- User changes their own password from the top nav

### Where to see a password
Admin → **Users** → Password column. Click 👁 to reveal, 📋 to copy.

### Self-service: when a user changes their own password
They click the **Password** button (top nav) → modal asks for current + new password (twice). Server verifies the current password against the hash; if correct, both columns update. Your Users page reflects it within 20s.

### Self-service: when they've forgotten
Login screen → **Forgot password?** → they enter their email. Server generates a new random password and emails it. (Returns generic success even if email doesn't exist — prevents account enumeration.)

### Sharing credentials manually
If SendGrid isn't configured / a user can't reach their email, you can simply:
1. Click 🔑 on their row.
2. Either let it generate, or type the password you want.
3. After the modal closes, the row auto-reveals the password.
4. Click 📋 to copy it.
5. Share via WhatsApp / Signal / in person.

---

## 7. Signatures

Admin → **Signatures**.

Every requestor and approver **must register a signature on first sign-in** — they're prompted with a draw / upload modal. Approvers can't act on requests without one.

### Uploading on someone's behalf
Two sub-sections:
- **Without signature** — lists everyone who hasn't registered yet. Click **Add** → draws/upload modal for them. Save → it's set.
- **On file** — everyone who has. Hover for **Replace**.

### Bulk-upload signatures
Click **Bulk upload** → upload PNG / JPG files **named as the user's email**, e.g. `karim.ops@hqhb.in.png`. SignFlow matches each filename to its user and assigns.

### Why this matters
A signature image is what gets stamped onto signed PDFs. SignFlow also records the image's native aspect ratio so the marker boxes on documents snap to the right shape — what the requestor draws is what the approver actually stamps.

---

## 8. Documents and audit

Admin → **All documents**.

Every request lives here, regardless of who submitted it or where it stands.

### Filters
- **Team** picker at top — `All teams` or a specific team. Shows team-wise totals on the right.
- **Status pills** — `all / pending / approved / rejected`. Each shows its count.

### Per-document actions
- **Download** — gets the file. For PDFs that have been signed, you get the **signed** version (with stamps).
- **Print** — opens a print dialog for either PDF or Excel.

### Auditing
Click on any row to drill into the workflow timeline, signers, and timestamps. Nothing is hidden from admin.

### Reaching team docs faster
Admin → **Teams & authority** → click **Documents** on any team card → goes straight to this view, pre-filtered.

---

## 9. Reports

Admin → **Reports**.

### Team-wise table
For each team:

| Metric | What it means |
|--------|---------------|
| **Total** | Every document ever routed to this team. |
| **Pending** | Awaiting signature. The "(in window)" sub-count = approved-but-not-finalised (still within the 1-hour cooling-off window). |
| **Approved** | Final state. |
| **Rejected** | With reason, visible on the document detail. |

### Top approvers
Below the table — every approver and how many documents they've signed / rejected. Useful for load-balancing.

### CSV export
**Download full CSV** in the top-right. Includes every request with every field, ready for Excel / Sheets.

---

## 10. Email log

Admin → **Email log**.

Every notification SignFlow tries to send is recorded here, whether or not SendGrid is configured.

### Status pills
- **delivered** (green) — SendGrid accepted and sent.
- **failed** (red) — SendGrid rejected. Error text on the row.
- **logged** (amber) — No SendGrid key set. Email body is here only.

### Templates
You'll see these names:

| Template | When |
|----------|------|
| `new_request` | Requestor submits → notifies the approver. |
| `approved` | Doc is finalised → notifies the requestor. |
| `rejected` | Doc is rejected → notifies the requestor with reason. |
| `reminder` | Requestor sends a reminder → notifies the approver. |
| `welcome` | New user created → contains credentials. |
| `reset_password` | Admin or self-service reset → contains new password. |

### When SendGrid isn't configured
If you don't see `SENDGRID_API_KEY` on the server, emails are still recorded here but never actually sent. **Open the email row → the body contains the password.** Use this to share credentials manually.

### Configuring SendGrid (when ready)
Set `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` in `server/.env` and restart. From the next minute onwards, every email is real.

---

## 11. Daily admin checklist

A 5-minute morning routine:

- [ ] **Email log** — any `failed` entries from yesterday? Investigate.
- [ ] **Users page** — any new users created overnight without a signature? Nudge them.
- [ ] **Reports** — pending count up significantly? Approvers might need a nudge.
- [ ] **Email log → look for `reminder`** entries — pattern of repeated reminders means an approver is unresponsive.

A weekly routine:

- [ ] **Reports → Top approvers** — load distribution OK?
- [ ] **Download full CSV** for safekeeping.
- [ ] **Email log** — clear out very old `logged`-only entries if DB is growing.

---

## 12. Troubleshooting

### "User can't sign in"
1. Admin → Users → find them → click 👁 to reveal their password. Tell them.
2. Or click 🔑 to reset. Type a fresh password. Share via WhatsApp/Signal.
3. Ask them to clear the browser cache or use an incognito window if still failing.

### "Approver doesn't see new requests"
- Confirm they have **signing authority** on the target team: Admin → Teams & authority → that team's card → are they listed under **Approvers**?
- If not: Add them.

### "Request submitted but not visible to anyone"
- Check the workflow on the request — Admin → All documents → click the row.
- If a workflow step has an inactive signer (deleted user, no signature), the workflow can stall.

### "Mobile shows error opening a PDF"
- Hard refresh (Ctrl+Shift+R or pull-down).
- 63+ page PDFs lazy-load; first open just shows placeholders that fill in as you scroll. Look at the "X / Y loaded" indicator at the top.
- If it says **Could not render PDF** with an error message — copy that exact text and reach out.

### "I broke something"
Every change is in Git. Pushed to UAT and master after each commit. Roll back via:
```bash
git log --oneline
git revert <commit>
```
Or worst case, contact the developer team.

---

*HQHB · SignFlow. Internal use only. Beta 1.0 — June 2026.*
