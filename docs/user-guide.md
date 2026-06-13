# HQHB · SignFlow — User Guide

**For:** Everyone (Requestors + Approvers)
**Version:** Beta 1.0
**URL:** https://onesign.devhqhb.online

---

## Welcome

SignFlow is HQHB's new internal tool for document approvals. Instead of:
- WhatsApping PDFs around
- Emailing scanned signatures
- Chasing signatures over coffee

…you submit, you wait for the approval (or rejection), and you download the signed copy. **Audit trail included.**

---

## Table of contents

1. [Signing in for the first time](#1-signing-in-for-the-first-time)
2. [Setting up your signature](#2-setting-up-your-signature)
3. [If you're a Requestor](#3-if-youre-a-requestor)
4. [If you're an Approver](#4-if-youre-an-approver)
5. [Using SignFlow on your phone](#5-using-signflow-on-your-phone)
6. [Changing your password](#6-changing-your-password)
7. [Forgot your password?](#7-forgot-your-password)
8. [Printing and downloading](#8-printing-and-downloading)
9. [Notifications](#9-notifications)
10. [Privacy and security](#10-privacy-and-security)

---

## 1. Signing in for the first time

You'll receive a welcome email from **HQHB SignFlow** with three things:

```
Sign-in URL:  https://onesign.devhqhb.online
Email:        your.name@hqhb.in
Password:     a 10-character random string
```

1. Open the URL on your laptop or phone.
2. Enter the email + password exactly as in the welcome email.
3. Click **Continue**.

If you don't see the welcome email, check your spam folder. Still nothing? Ping IT (it@hqhb.in) and ask them to share your credentials directly.

---

## 2. Setting up your signature

If you're a Requestor or Approver, the first thing SignFlow asks you to do after signing in is **register your signature**.

You'll see a modal called **"Add your signature"** with two tabs:

### Draw it
Use your mouse, stylus, or finger (on phone) to draw your signature directly in the canvas. The system auto-smooths pen pressure as you go. Sign as close to how you actually sign on paper as possible — this is what gets stamped onto every document you approve.

- Tap **Clear** to start over.
- Once you're happy, tap **Save signature**.

### Upload an image
Already have a scanned signature? Upload it instead.
- **Choose file** → pick a PNG or JPG.
- Preview appears below.
- Tap **Save signature**.

SignFlow automatically crops the empty whitespace around your signature so it fills the signature box on documents exactly.

### Updating it later
Top nav → **Signature** button. Same modal, your current signature shown at the top. Draw or upload to replace.

---

## 3. If you're a Requestor

You belong to one department (your "team"). You can submit documents for approval and track them through to completion.

### Your dashboard

```
Welcome back, [Your name]

Quick Actions:
  Leave Approval    Document Approval    Expense Approval
  Invoice / PO      Other

Tiles:
  + Make a new request
  ⏱ Pending requests       (badge: count)
  ✓ Approved requests      (badge: count)
```

Plus a small **View rejected requests** button if you have any, and **Recent activity** showing your last 4 submissions.

### Submitting a new request

1. Click any **Quick Action** type, or click **Make a new request** and pick the type yourself.
2. **Upload your document** (PDF or Excel, up to 14 MB). For Leave requests, the leave-application form opens directly with editable cells.
3. **Pick an approval flow:**
   - **Single approver** — *any* approver on the target team can sign. First one wins. Faster.
   - **Multi-step workflow** — specific people sign in order. Useful for chains like *Manager → Director → CFO*.
4. **Mark where the signature goes** — click and drag on the document. A box appears showing where the approver's signature will be stamped.
5. **Choose the target team** (or workflow steps).
6. Optionally add a **note for the approver**.
7. **Submit request**.

You'll see it appear instantly under **Pending requests**.

### Tracking what you've submitted

Click **Pending requests**. You see:
- The document name
- Who's expected to sign next (in workflow mode)
- A *Send reminder* button (limited to once every 24 hours)

When it's approved, it moves to **Approved requests**. Click any row to **Download** or **Print** the signed copy.

### What if it's rejected?
You'll get an email. The request moves to *Rejected* with the reason the approver gave. You can fix it and submit a new request.

### The leave-request form
A special case. When you pick **Leave Approval** as the type, SignFlow loads an editable leave-application form directly. Fill in:
- Personal info (name, designation, dept, manager, etc.)
- Leave dates (From / To)
- Reason

The current date is auto-stamped on application date fields. Submit when ready.

### The 1-hour cooling-off window
After an approver approves your document, there's a **1-hour window** before it's truly finalised. During this window the approver can withdraw their approval. The status shows as *Approved · 1h window* with a countdown.

To skip this, ask your approver to enable **Instant approval** when reviewing — it finalises immediately.

---

## 4. If you're an Approver

You can approve documents routed to teams where you hold *signing authority*. You can also be a requestor.

### Your dashboard

```
Good day, [Your name]

Tiles:
  ⏱ Pending approvals         (badge: count)
  ✓ Approved requests
  ✗ Rejected requests
  🛡 Signing authority        (which teams you sign for)
```

### Reviewing a request

Click **Pending approvals** → click any request → it opens in a side drawer with the document, a workflow summary at the top (if workflow), and pinned action bar at the bottom.

### The "Go to signature" button
Top-right of the drawer header. **One click takes you straight to where your signature is supposed to go**, even on long documents (works great with 60+ page PDFs).

### Two-step confirmation

1. Click **Preview & approve** — your signature appears in the marker box so you can verify how it'll look on the final document.
2. Either click **Confirm approval** (signs it) or **Go back** (cancels the preview).

### Rejecting
**Reject** button → optional reason → submit. The requestor gets an email with your reason.

### Batch approving
If you have a stack of same-type requests:
1. Open **Pending approvals**.
2. Filter by type using the chips at the top (`Leave Approval`, `Document Approval`, etc.).
3. Tick the boxes on rows where it's your turn.
4. Click **Approve selected (N)** at the top.

Workflow approvals can't be batch-approved (each needs to be confirmed individually).

### Withdrawing an approval
If you change your mind within the 1-hour cooling window:
1. **Approved requests** → click the row.
2. Bottom action bar shows the countdown.
3. Click **Withdraw** (silent) or **Reject with reason** (notifies the requestor).

### Instant approval
If the requestor opted in to instant approval when submitting, you'll see a small ⚡ icon. Once all signers sign, the document is finalised immediately — no 1-hour wait.

---

## 5. Using SignFlow on your phone

SignFlow is built mobile-first. Everything works on phones and tablets.

### Tips
- **Pinch + zoom** on PDF previews to read smaller text.
- The top nav collapses to icons only. Hit them to access *Signature*, *Password*, *Sign out*.
- Drawers (when reviewing a doc) take the full screen. The **X** closes them.
- The Esc key (Bluetooth keyboard) also closes any modal.

### iPhone-specific
- **Add to Home Screen** — Safari → Share → Add to Home Screen. SignFlow runs in a standalone app-like window with the navy theme bar.
- Notch / Dynamic Island won't clip the close buttons.
- The home indicator at the bottom won't cover the Approve / Reject buttons.

### Performance
Large PDFs (50+ pages) lazy-load on mobile — only the pages you're scrolling near actually render. A small **X / Y LOADED** indicator at the top shows progress. This keeps memory in check and prevents the browser from hanging.

---

## 6. Changing your password

1. Top nav → **Password** (key icon, between *Signature* and *Sign out*).
2. Modal opens:

```
Change your password
  CURRENT PASSWORD       [_________________]
  NEW PASSWORD           [_________________]  👁
  CONFIRM NEW PASSWORD   [_________________]
  
  [Cancel]  [Change password]
```

3. Enter your current password (the one you signed in with).
4. Enter a new password — at least 6 characters.
5. Type it again to confirm.
6. Click **Change password**.

The change takes effect immediately. Your next sign-in uses the new password.

> Pro tip: pick something memorable but not obvious. Avoid your name, "password", or "qwerty". A two-word combo + a number works well: e.g. `bridge-honey-83`.

---

## 7. Forgot your password?

1. On the sign-in screen, click **Forgot password?** (under the password field).
2. Type your work email.
3. Click **Send reset email**.
4. Check your inbox — a new password arrives titled *"Your HQHB SignFlow password has been reset"*.
5. Click **← Back to sign-in** → enter the new password from the email.
6. Once in, change it to something memorable from the top nav.

If you don't get the email after a few minutes, ping IT (it@hqhb.in) — they can read your current password from the dashboard and share it directly.

---

## 8. Printing and downloading

Every approved document has two buttons:

| Action | What happens |
|--------|--------------|
| **Download** | Saves the file. PDFs include all signature stamps. |
| **Print** | Opens a print preview in a new window. Use Cmd/Ctrl+P or pick your printer. |

This works from your *Approved requests* (requestor) and from the approver's *Approved* list.

### Tips
- Printing on mobile uses your phone's system print dialog. AirPrint on iPhone, Mopria on Android.
- The print preview is a fresh window — if pop-ups are blocked, you'll see an alert. Allow pop-ups for SignFlow and try again.

---

## 9. Notifications

SignFlow emails you when relevant things happen:

| Event | Email subject |
|-------|---------------|
| Your request was approved | *Approved: [document name]* |
| Your request was rejected | *Rejected: [document name]* |
| A request needs your signature | *New signature request: [document name]* |
| Someone sent you a reminder | *Reminder: "[document name]" awaiting approval* |
| Your password changed | *Welcome…* or *Your HQHB SignFlow password has been reset* |

In-app notifications:
- A small green / red / navy toast in the bottom-right confirming any action (Approved, Rejected, Saved, etc.).
- The dashboard tile badges update in real time (count of pending, approved, rejected).

---

## 10. Privacy and security

### What's stored
- Your name, email, work department / signing authority.
- A bcrypt hash of your password (one-way — not even IT can read it).
- Your signature image.
- Every document you've requested or approved, with timestamps.

### Who sees what
- **You** — your own requests, your own signature, anything routed to you for approval.
- **Approvers on your team** — requests routed to them.
- **IT Admin** — everything, including the current plaintext of your password (for support purposes, since SendGrid isn't always available). This is acceptable because this is an internal-only HQHB system. **You can change your password any time** to invalidate the value the admin sees.

### Best practices
- Don't share your password — change it instead.
- Sign out when using a shared computer.
- Spot a request you didn't expect? Reject it with a reason.

---

## Getting help

| Issue | Reach out |
|-------|-----------|
| Can't sign in | it@hqhb.in |
| Need a new signature uploaded | it@hqhb.in |
| Request stuck pending | Send a reminder first (24h cooldown), then contact the approver directly. |
| Bug or weird behaviour | it@hqhb.in with a screenshot + URL |

*Welcome aboard. Happy signing.*
