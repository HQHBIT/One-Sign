# SignFlow — IT Onboarding Playbook & User Intake

A step-by-step guide for IT to set up teams, create user accounts, and get everyone signed in.

---

## Step 0 — Create your teams first

SignFlow organises people into **teams** (business functions). Create these before adding users:

**Admin → Teams & authority → Add team** — e.g., *Finance, Operations, IT, HR, Management*.

- **Requestors** are assigned to one team (their department).
- **Approvers** are granted **signing authority** over one or more teams.

---

## The three roles

| Role | What they do | Who gets it |
| --- | --- | --- |
| **Requestor** | Submits documents for signature; downloads signed copies | Most staff |
| **Approver** | Reviews and signs documents routed to them | Managers, Finance, authorised signatories |
| **Administrator** | Full control of users, teams, signatures, reports | IT only |

---

## Details to capture from each user (intake sheet)

Collect this for every person before you create accounts:

| # | Field | Required? | Notes |
| --- | --- | --- | --- |
| 1 | **Full name** | Yes | As it should appear on signatures and records |
| 2 | **Work email** | Yes | This is their login — must be unique |
| 3 | **Role** | Yes | Requestor / Approver / Administrator |
| 4 | **Department (team)** | Yes (Requestors) | Which business function they belong to |
| 5 | **Signing authority** | Yes (Approvers) | Which team(s) they're allowed to sign for |
| 6 | **Signature image** | Optional | They can register it themselves on first login |

> A ready-to-fill version of this table (and a CSV import template) is included in the Word/PDF kit.

---

## Creating users — two ways

### A. By department, in bulk — *Onboard Team* (recommended for rollout)

**Admin → Onboard team:**
1. Pick or create the team (department).
2. Upload a spreadsheet of members — columns: **name, email** (optional **role**; defaults to Requestor).
3. Review the parsed rows; adjust each person's role and tick signing authority where needed.
4. Create the accounts — and **email everyone their credentials in one click**.

Everyone in the upload is auto-assigned to that team, so you don't need team IDs.

### B. One person at a time — *Onboard User Wizard*

**Admin → Users → Add user** (3 steps):
1. **Identity** — Full name, Work email, Initial password (≥ 6 characters; they change it later).
2. **Role & assignment** — choose the role, then the **department** (Requestor) or tick **signing-authority teams** (Approver). Admins need no assignment.
3. **Confirm → Create user.**
4. **Share the credentials** — the wizard does *not* auto-email; send the user their email + temporary password.

---

## What each user does on first login

1. Go to **https://onesign.devhqhb.online/**
2. Sign in with their **email + temporary password**.
3. Change their password.
4. **Register their signature** — draw it or upload an image (one-time).
5. They're ready to submit or sign documents.

---

## Optional: pre-load signatures to skip first-login setup

**Admin → Signatures** → bulk-upload signature images named `<email>.png` / `.jpg`. SignFlow matches each image to the user by email automatically, so they don't have to draw one on first login.

---

## Suggested rollout order

1. Create teams.
2. Add IT admin(s).
3. Onboard each department (bulk) — set approvers + signing authority as you go.
4. (Optional) Pre-load signatures.
5. Send the announcement email.
6. Keep `it@hqhb.in` / `taha.chunawala@hqhb.in` ready for first-week questions.
