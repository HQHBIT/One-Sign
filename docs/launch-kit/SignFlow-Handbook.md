# SignFlow Handbook
_Everything your team needs to start signing._


# What’s New in SignFlow

Two new ways to get people in — and to get documents signed.


## Self-registration (with IT approval)

- New users can request an account themselves from the login screen — click **Create an account** and enter their name, email, password, team, and reporting manager.
- The request goes to IT under **Admin → Registrations**, which shows a pending count.
- IT **approves** (the person becomes a Requestor and signs in with the password they chose) or **rejects** with a reason.
- No one can sign in until approved — the approval is the gate. After approving, set their real role and team under **Users**.


## Send a signature request to a specific person

- When making a request, choose the new **Send to a specific person** mode (PDF documents).
- Search the directory by **name or email** and pick anyone — regardless of team or role.
- Place their signature box and submit; the recipient is notified by email.
- The recipient sees it under **Awaiting your signature** on their home screen and signs with the same Review-and-sign screen approvers use — even a plain Requestor can sign what is sent directly to them.

> Together: someone self-registers → IT approves them → they become instantly searchable by email for a direct signature request.


---

# SignFlow Quick-Start
_Get signing in three steps_

1. **Sign in.** Go to https://onesign.devhqhb.online/ and sign in with the email and temporary password from IT. Change your password when prompted.
2. **Register your signature.** A one-time step — draw it with your mouse/finger or upload an image. (You can defer with “Sign out & do it later.”)
3. **Start using it** — see your role below.

_[Screenshot: The SignFlow sign-in screen — https://onesign.devhqhb.online/]_


## What you can do

| Your role | What you do |
| --- | --- |
| Requestor | New request → upload a PDF/Excel → choose the approver(s) **or send it to a specific person by email** → place the signature box → submit. Track progress and download the signed file. |
| Approver | Open a pending request → review the document → Approve & sign (your signature is stamped on), or Reject with a reason. |
| Administrator | Manage users, teams, signatures, documents, and reports from the admin console. |

> No account yet? If self-registration is enabled, click **Create an account** on the sign-in screen, enter your details, and IT approves your request — then you sign in with the password you chose.

> Need help? Email **it@hqhb.in** or **taha.chunawala@hqhb.in**.


---

# SignFlow — Requestor Guide
_Submitting documents for signature_


## Before you start

1. Sign in at https://onesign.devhqhb.online/ with your email and temporary password; change your password.
2. Register your signature (draw or upload). This is required before your first request — you can defer it, but you’ll be asked again.

_[Screenshot: Your Requestor home — quick actions and your requests at a glance.]_


## Make a new request

1. Click **New request** and upload your document — a **PDF or Excel** file, up to **14 MB**.
2. Choose how it should be approved: **Single approver** (any approver from one team), **Multi-step workflow** (specific signers, in a set order), or **Send to a specific person** (request a signature from any individual by name or email).
3. Optionally tick **Instant approval** to skip the one-hour cooling window.
4. Place the signature box on the document and pick the team / signers (see below).
5. Add an optional note and **submit**. Each signer is notified in turn.

_[Screenshot: Starting a new request: choose a type, then upload your PDF or Excel.]_


### Single-approver mode

- Click on the document where the signature should appear to drop one signature box.
- Pick the team — the request goes to any approver with authority for that team.


### Multi-step workflow mode

- Add a step, pick the team, then **Add signer**.
- Click **Place signature** and drag a box on the relevant page for that signer.
- Repeat per signer / per step. Cross-team workflows are supported — signers are asked in order.


### Send to a specific person

- Upload a **PDF**, then choose **Send to a specific person** (this mode is PDF-only).
- Search the directory by **name or email** and pick the person — this works for **any** user, regardless of team or role.
- If no one matches, they don’t have an account yet; ask them to register first (or have IT add them).
- Place their signature box on the page and **submit**. They’re notified and the document appears in their **Awaiting your signature** area.

> Use this when you know exactly who should sign and they aren’t one of a team’s approvers — for example a colleague in another department.


## Track your requests

- **Pending** — see exactly who the request is waiting on. You can send a reminder once every 24 hours.
- **Approved** — preview or download the signed file.
- **Rejected** — see the reason given, then correct and resubmit.


## Signing a request someone sent you

If a colleague sends a document straight to you, it appears under **Awaiting your signature** on your home screen, with a count. Open it, review the document, and **Review & sign** — exactly like an approver. You’ll need a registered signature; if you don’t have one yet, you’ll be prompted to add it first.

> Tip: name your files clearly before uploading — the file name is what approvers and the audit log show.


---

# SignFlow — Approver Guide
_Reviewing and signing documents_


## Before you start

1. Sign in at https://onesign.devhqhb.online/ and change your password.
2. Register your signature (draw or upload) — it’s stamped onto documents when you approve.


## Your home screen

You’ll see four areas: **Pending approvals**, **Approved**, **Rejected**, and **Signing authority** (the teams that have granted you the right to sign).

_[Screenshot: The Approver home — pending approvals, history, and your signing authority.]_


## Review & sign

1. Open a pending request and review the document.
2. Check the **workflow chain** — who has already signed and who is next.
3. If it’s your turn, your slot is highlighted **“YOU SIGN HERE.”** Click **Approve & sign** to stamp your signature, or **Reject** with a reason.
4. If it’s not your turn yet, you’ll see “Awaiting signature from [Name]” and the document is view-only until it reaches you.

_[Screenshot: Open a pending request to review the document and sign when it is your turn.]_


## The one-hour window

For standard (non-instant) approvals, you have **one hour** to withdraw your approval while the status shows **“Approved · 1h window.”** After the hour passes — or immediately, when Instant Approval was set — your signature is locked in.


## When everyone has signed

Once all signers complete, the request is finalised: the requestor is emailed automatically and the signed PDF becomes downloadable. Every action is time-stamped for the audit trail.

> Reject early if something is wrong — a clear reason helps the requestor fix and resubmit quickly.


---

# SignFlow — Administrator Guide
_Running SignFlow for your organisation_

The admin console gives you everything needed to run SignFlow. Sign in with an administrator account to see these modules. For the step-by-step rollout (creating teams and users), use the companion **IT Onboarding Playbook**.

_[Screenshot: The Administrator console — every module in one place.]_


## Users

- Add users individually (3-step wizard) or in **bulk** by department.
- Set each person’s role — **Administrator / Requestor / Approver** — and assign a team or signing authority.
- Delete users when needed: their name shows as “—” in past requests, but document history is preserved.


## Registrations

If self-registration is enabled, people can request an account themselves from the login screen (**Create an account**). Each request lands in **Admin → Registrations** with a pending count.

- Review each request — the name, email, and the team and reporting manager they entered.
- **Approve** to create the account (as a **Requestor**) so they can sign in with the password they chose — then set their real role / team under **Users**.
- **Reject**, with an optional reason, if it isn’t a legitimate request.
- Until you approve them, a registrant cannot sign in — the approval is the gate.


## Teams & authority

- Create or remove teams (business functions such as Finance, Operations, IT).
- View and edit who can sign for each team — this controls where requests are routed.


## Signatures

- Upload a signature image on behalf of any user.
- **Bulk-upload** signatures by naming each file with the user’s email (e.g., `jane@hqhb.in.png`) — SignFlow matches them automatically.


## All documents

- See every request across the company, filterable by status (All / Pending / Approved / Rejected).
- Download originals or signed copies for any audit.


## Reports

- Team-wise totals — pending, approved, rejected.
- A top-approvers leaderboard.
- Full **CSV export** of the complete request history.


## Email log

Audit every notification SignFlow has sent — invitations, approvals, reminders, and password resets — with delivery status.


## Helping users with access

- Re-send an invite or reset a password from the **Users** page; a fresh temporary password is generated.
- Users can also self-serve via **Forgot password?** on the login screen.

> Most day-to-day admin work is onboarding people. Keep the **IT Onboarding Playbook** handy for the first few weeks.


---

# SignFlow — IT Onboarding Playbook
_Set up teams, create users, and get everyone signed in_


## Step 0 — Create your teams first

SignFlow organises people into **teams** (business functions). Create these before adding users: **Admin → Teams & authority → Add team** (e.g., Finance, Operations, IT, HR, Management).

- **Requestors** are assigned to one team (their department).
- **Approvers** are granted **signing authority** over one or more teams.


## The three roles

| Role | What they do | Who gets it |
| --- | --- | --- |
| Requestor | Submits documents for signature; downloads signed copies | Most staff |
| Approver | Reviews and signs documents routed to them | Managers, Finance, authorised signatories |
| Administrator | Full control of users, teams, signatures, reports | IT only |


## Details to capture from each user

Collect this for every person before creating accounts. It doubles as your bulk-import sheet.

| Field | Required? | Notes |
| --- | --- | --- |
| Full name | Yes | As it should appear on signatures and records |
| Work email | Yes | This is their login — must be unique |
| Role | Yes | Requestor / Approver / Administrator |
| Department (team) | Yes (Requestors) | Which business function they belong to |
| Signing authority | Yes (Approvers) | Which team(s) they may sign for |
| Signature image | Optional | They can register it themselves on first login |


## Creating users — two ways


### A. By department, in bulk (recommended for rollout)

1. **Admin → Onboard team.**
2. Pick or create the team (department).
3. Upload a spreadsheet of members — columns **name, email** (optional **role**; defaults to Requestor).
4. Review the parsed rows; adjust each person’s role and tick signing authority where needed.
5. Create the accounts — and email everyone their credentials in one click.

Everyone in the upload is auto-assigned to that team, so you don’t need team IDs. A CSV you can start from:

```
name,email,role
Jane Doe,jane.doe@hqhb.in,requestor
Moiz Khan,moiz.khan@hqhb.in,approver
```

_[Screenshot: Onboard team — pick or create a team, then upload the member list.]_


### B. One person at a time

1. **Admin → Users → Add user.**
2. **Identity** — Full name, Work email, Initial password (at least 6 characters; they change it later).
3. **Role & assignment** — choose the role, then the department (Requestor) or tick signing-authority teams (Approver). Admins need no assignment.
4. **Confirm → Create user.**
5. **Share the credentials** — this path does not auto-email; send the user their email and temporary password.

> Self-service alternative: let people request their own account from the login screen (**Create an account**). Each request appears in **Admin → Registrations** to approve or reject — handy for ad-hoc additions after the initial rollout. Approved registrants start as Requestors; adjust their role/team under Users.


## What each user does on first login

1. Go to https://onesign.devhqhb.online/
2. Sign in with their email and temporary password.
3. Change their password.
4. Register their signature — draw it or upload an image (one-time).
5. They’re ready to submit or sign documents.


## Optional — pre-load signatures

**Admin → Signatures** → bulk-upload images named `<email>.png` (or `.jpg`). SignFlow matches each image to the user by email automatically, so they can skip the first-login signature step.


## Suggested rollout order

1. Create teams.
2. Add the IT administrator account(s).
3. Onboard each department in bulk — set approvers and signing authority as you go.
4. (Optional) Pre-load signatures.
5. Send the announcement email.
6. Keep it@hqhb.in / taha.chunawala@hqhb.in ready for first-week questions.


---

# SignFlow — Bulk Onboarding Guide
_Onboard your whole organisation (≈250 users) efficiently_

For a large rollout, do **not** add people one at a time. SignFlow onboards a whole department from a spreadsheet and emails everyone their login in one step. This guide takes you from an empty system to ~250 signed-in users.


## Two prerequisites — sort these first

1. **Email delivery (SendGrid).** SignFlow emails each new user their temporary password and sign-in link. For a bulk rollout this must be switched on at the server. If it is off, invitations are only recorded (not sent) and you would have to hand out 250 passwords manually. Confirm with IT that email delivery is live before you begin.
2. **Your teams.** Create every department first — Admin → Teams & authority → Add team. Users are onboarded one team at a time.


## Step 1 — Build your master roster

Capture every person once, in a single sheet. Use the roster template (SignFlow-User-Roster-Template.csv).

| Column | Notes |
| --- | --- |
| Name | As it should appear on signatures and records |
| Work email | Their login — must be unique |
| Role | requestor (most staff) or approver (authorised signatories) |
| Department | Which team they belong to / are onboarded under |
| Signs for (extra teams) | Approvers only — any teams beyond their own they may sign for |


## Step 2 — Split the roster by department

SignFlow imports one team at a time, and everyone in an upload is assigned to that team. From your master roster, make one upload file per department with just three columns — **name, email, role** (role is optional and defaults to requestor; use “approver” where needed). See SignFlow-team-upload-example.csv, or click **Download template** on the Onboard-team screen for the exact format.


## Step 3 — Onboard each department

_[Screenshot: Onboard team — pick or create the team, then upload that department’s file.]_

1. Admin → **Onboard team**.
2. Pick the department (or create it).
3. Upload that department’s file (.xlsx or .csv).
4. Review the parsed rows — flag who is an **Approver** and fix any names/emails.
5. Keep **Send invitations** ticked, then **Create**. Everyone is created and emailed their login in one go.

> Repeat per department. A batch of 30–50 people imports in under a minute; split very large single teams into batches of ~100.


## Step 4 — Approvers who sign for multiple teams

Onboarding grants an approver authority over the one team you uploaded them under. For any additional teams they must sign for, add them in **Admin → Teams & authority → grant authority**.


## Step 5 — (Optional) Pre-load signatures

Save each person’s signature image named by their email (e.g., `jane.doe@hqhb.in.png`). Then **Admin → Signatures → bulk-upload** — up to 200 files per batch, 2 MB each (so two batches for 250). SignFlow matches each image by email, skipping everyone’s first-login signature step.


## Step 6 — Verify

- **Admin → Users** — confirm the count (~250) and the roles look right.
- **Admin → Email log** — confirm the invitations were delivered.
- Spot-check one or two accounts by signing in.


## What each user receives

A welcome email with their email address, a temporary password, and the link (https://onesign.devhqhb.online/). On first sign-in they change the password and register their signature.


## Troubleshooting

| Symptom | Fix |
| --- | --- |
| A row didn’t import | Duplicate email (already a user — skipped) or missing name/valid email. Fix that row and re-upload just that person; re-running is safe. |
| Invitations not arriving | Email delivery (SendGrid) is likely off or the sender isn’t verified. Once live, resend via Users → invite (or bulk-invite). |
| Wrong department | Admin → Teams & authority — reassign a requestor’s team, or grant/adjust an approver’s authority. |
| Approver not appearing in workflows | They have no signing authority yet — grant it in Teams & authority. |


## Rollout checklist

1. Email delivery (SendGrid) confirmed live.
2. All departments created.
3. Master roster complete (~250).
4. Per-department upload files prepared.
5. Each department onboarded, with invitations sent.
6. Extra signing authority granted to multi-team approvers.
7. (Optional) Signatures pre-loaded.
8. User count and Email log verified.
9. Announcement email sent.


---

# SignFlow — Frequently Asked Questions
_Quick answers for everyone_


### What is SignFlow?

HQHB’s digital signature and approval system. You submit documents for signature, route them to the right approver(s), and get a signed, fully audited copy back — all online.


### Do I need to install anything?

No. SignFlow runs in your web browser. Just go to https://onesign.devhqhb.online/.


### How do I get an account?

IT creates it for you — or, if self-registration is enabled, click **Create an account** on the login screen, enter your details, and IT approves the request. Either way, you set a password and register your signature on first sign-in.


### What file types and sizes are supported?

PDF or Excel documents, up to 14 MB each.


### How do I sign a document?

Register your signature once (draw or upload). After that, open a pending request and click Approve & sign — your signature is stamped onto the document.


### What is the one-hour window?

For standard approvals you can withdraw your approval within one hour. Set Instant approval on a request to finalise immediately and skip the wait.


### Can a document need several signers in a specific order?

Yes. Choose Multi-step workflow when creating the request, add the signers, and they’ll be asked to sign in the order you set — even across teams.


### I forgot my password.

Use Forgot password? on the login screen to get a reset by email, or contact IT and we’ll issue a new temporary password.


### Is it secure and audit-ready?

Yes. Access is role-based, every action is time-stamped, and admins can export a full audit trail. Signed PDFs preserve the complete approval history.


### Who do I contact for help?

IT at it@hqhb.in, or taha.chunawala@hqhb.in.
