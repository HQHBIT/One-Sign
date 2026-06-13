# SignFlow Beta — Onboarding Checklist

A step-by-step list for the IT admin to roll out SignFlow internally.
Check each item as you go.

---

## Phase 1: Before the launch (Day -3 to -1)

### Environment

- [ ] SignFlow UAT is reachable at https://onesign.devhqhb.online
- [ ] You can sign in as admin (`it@hqhb.in`)
- [ ] SendGrid is configured **or** you've decided to share passwords manually
- [ ] Database is on a server with regular backups
- [ ] HTTPS certificate is valid

### Your own setup

- [ ] You've signed in as admin and registered your own signature
- [ ] You've changed your default password to something only you know
- [ ] You've added a profile photo (optional — not yet supported)

### Documentation prep

- [ ] `docs/user-guide.md` → convert to PDF (use any markdown-to-PDF tool)
- [ ] `docs/quickref.md` → convert to PDF
- [ ] `docs/onboarding-form.csv` → upload to Google Sheets, set sharing to *Anyone with link can comment*
- [ ] `docs/launch-announcement.md` → pick the appropriate template, customise

### Team setup

- [ ] List the departments / teams that will go on SignFlow
- [ ] Identify each department head — they'll be approvers
- [ ] Decide who else in each team gets an approver role (typically 1–3 per team)

---

## Phase 2: Collect data (Day -1 to +3)

### Distribute the form

- [ ] Email each department head with:
  - Link to the Google Sheet (one per team or shared)
  - One-paragraph context: *"We're rolling out a new internal tool for document approvals. Please fill in this form with your team's members so I can create accounts."*
  - Deadline (3 days)
  - Your contact for questions

### Track responses

- [ ] Department 1 — submitted ☐
- [ ] Department 2 — submitted ☐
- [ ] Department 3 — submitted ☐
- (etc.)

### Follow up

- [ ] Day +2 — gentle reminder to anyone who hasn't replied
- [ ] Day +3 — direct ping to stragglers

---

## Phase 3: Create the teams (Day +4)

For each completed form:

- [ ] Open SignFlow → Admin → **Onboard team**
- [ ] Step 1 — choose *Create new team* + type the team name
- [ ] Step 2 — paste / upload the member list from the filled form
- [ ] Step 2 — verify roles (approvers vs requestors) match the form
- [ ] Step 3 — keep *Send welcome emails* ON (or off if you're sharing manually)
- [ ] Step 3 — click **Create users & send invites**
- [ ] Step 4 — note any failures, fix them
- [ ] Confirm the team appears under Admin → Teams & authority with the right approvers + members

### Verify each user got their welcome email

- [ ] Spot-check 1 user per team — email arrived, password works
- [ ] Any spam folder hits? Whitelist `noreply@hqhb.in` org-wide

---

## Phase 4: Launch (Day +5)

### Send the announcement

- [ ] Pick the right template from `docs/launch-announcement.md`
- [ ] Customise the URL, dates, your sign-off
- [ ] Attach `user-guide.pdf` + `quickref.pdf`
- [ ] Send to all users (BCC them — keeps the list clean)

### Update internal channels

- [ ] Post the WhatsApp / Teams short version
- [ ] Pin the announcement in your main channel

### Be available

- [ ] Block 2 hours on launch day for support questions
- [ ] Have the Admin Handbook open

---

## Phase 5: Stabilise (Day +6 to +14)

### Daily checks

- [ ] **Email log** — any `failed` entries? Investigate
- [ ] **Reports** — pending count climbing? Approvers might need a nudge
- [ ] Personal mailbox — any user questions in spam?

### After 7 days

- [ ] Pull **Reports → Download full CSV** as a baseline
- [ ] Count: how many users have actually signed in? (Low ratio = comms problem, not product problem)
- [ ] Spot-check 3 random requests end-to-end for correct routing

### After 14 days

- [ ] Send the *Day 14 retrospective* from `launch-announcement.md`
- [ ] Collect feedback in a single email thread
- [ ] Prioritise the top 3 most-requested improvements
- [ ] Bring them up with the developer team

---

## Phase 6: Steady-state (Day +15 onwards)

Move to the daily admin routine in `admin-handbook.md` → section 11.

---

## Rollback plan (just in case)

If something is fundamentally broken:

1. **Don't panic.** Past requests and signatures are persisted in the database.
2. Reach out to dev — every change is in Git, every commit is small, rollback is one command.
3. Worst case, tell users to fall back to email-the-PDF for 24h while we fix.

---

*HQHB · SignFlow. Beta 1.0 — June 2026.*
