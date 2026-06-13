# HQHB · SignFlow — FAQ

**Help:** it@hqhb.in

---

## Account and sign-in

**Q: How do I sign in?**
A: Go to https://onesign.devhqhb.online and enter the email and password from your welcome email.

**Q: I never got the welcome email. Now what?**
A: Check your spam folder first. If still missing, email it@hqhb.in — admin can share your credentials directly.

**Q: Can I change my password to something I'll actually remember?**
A: Yes. After signing in, click **Password** (key icon) in the top nav. Enter your current password, then your new one (twice). Done.

**Q: I forgot my password.**
A: On the sign-in screen, click **Forgot password?** → enter your email → check inbox for a new password. Sign in with that, then change it to something memorable.

**Q: Can I sign in on my phone?**
A: Yes — fully supported. On iPhone, you can also add it to your home screen for a standalone app feel: Safari → Share → Add to Home Screen.

**Q: What if I share a computer? How do I sign out?**
A: Top nav → **Sign out** (logout icon, far right). Then close the browser tab.

---

## Signatures

**Q: Why does SignFlow ask for my signature on first sign-in?**
A: Because that's what gets stamped onto every document you approve. It's like signing on paper — but a one-time setup.

**Q: I don't have a stylus / touch screen. Can I just upload my signature?**
A: Yes. In the **Add your signature** modal, click the **Upload image** tab → choose a PNG or JPG. SignFlow auto-crops the empty whitespace so it fits the box.

**Q: My signature looks terrible. Can I redo it?**
A: Top nav → **Signature** → draw or upload a new one. Replaces the previous version everywhere.

**Q: Will my old signature stay on documents I already signed?**
A: Yes. Existing signed PDFs are immutable — they keep whatever was stamped on them at the time. Only future approvals use your new signature.

---

## Requests (Requestors)

**Q: What file types can I upload?**
A: PDF or Excel (`.xlsx`, `.xls`), up to 14 MB.

**Q: What's the difference between single approver and workflow?**
A: **Single approver** = any one approver on the target team can sign. First one wins. Fast for routine docs.
**Workflow** = specific people sign in order. Step 2 only starts after Step 1 finishes. Use this when you need a hierarchy (e.g. Manager → Director → CFO).

**Q: How do I place the signature box?**
A: After uploading, click and drag on the PDF preview. A dashed box appears. You can resize, move, or delete it. The approver's signature stamps exactly inside this box.

**Q: I submitted but my approver hasn't responded. Can I poke them?**
A: After 24 h, a **Send reminder** button appears on your pending request. Click it once per day. The approver gets an email titled *Reminder: [your doc] awaiting approval*.

**Q: Where do I see my history?**
A: Tiles on your dashboard — **Pending**, **Approved**, **Rejected** counts. Plus a **Recent activity** strip with your last 4 submissions.

**Q: Can I edit a request after submitting?**
A: No. Withdraw it (or have it rejected) and submit a new one. This preserves the audit trail.

**Q: What's the leave form?**
A: A pre-filled HQHB leave application that appears when you pick *Leave Approval* as the request type. Editable cells inline. Current date auto-stamped on application date fields.

---

## Approvals (Approvers)

**Q: I'm an approver. How do I know when a doc needs me?**
A: Three ways:
1. Email titled *New signature request: [name]*
2. The **Pending approvals** tile on your home screen shows a badge with the count
3. The doc appears at the top of your Pending list when you log in

**Q: What if I want to think before approving?**
A: Just leave it pending. There's no time limit. Until you click *Confirm approval* or *Reject*, the doc waits for you.

**Q: I clicked Preview & approve by accident.**
A: That step *shows* the preview but doesn't actually sign yet. Click **Go back** to escape. **Confirm approval** is the actual sign action.

**Q: I approved but changed my mind.**
A: You have **1 hour** to withdraw silently. Go to **Approved requests** → click the row → **Withdraw** button. After 1 hour the doc is finalised and you can only contact the requestor directly.

**Q: What's "Reject with reason" vs just "Reject"?**
A: Same action — both send the doc back as rejected. The reason field is optional but recommended so the requestor knows what to fix.

**Q: Instant approval?**
A: Optional toggle the *requestor* set when they submitted. If on, the moment all signers sign, the doc is finalised — no 1-hour cooling window. If off, the 1-hour window applies.

**Q: Why don't I see a request from someone in [team]?**
A: You only see requests routed to teams where you have **signing authority**. Admin → Teams & authority → confirm you're listed under that team's Approvers. If not, ping IT.

---

## Documents and signing

**Q: Where do I find the signed PDF?**
A: As a requestor → **Approved requests** → click the row → **Download** or **Print**.
As an approver → **Approved** → same.

**Q: Does the signed PDF show all signatures (multi-step)?**
A: Yes. Each signer's signature is stamped at their marker position. A "Digitally signed by … · [date]" caption is added beneath each.

**Q: Can I print directly?**
A: Yes. **Print** button next to Download. Opens your system print dialog. Works on mobile too (AirPrint / Mopria).

**Q: 63-page PDF wouldn't load on my phone.**
A: Hard refresh. The viewer now lazy-loads pages — only the visible ones render. Look at the "X / Y loaded" indicator at the top.

---

## Notifications

**Q: I'm getting too many emails.**
A: Sorry — currently every notification fires. We're tracking this for a future preference setting.

**Q: I'm not getting any emails.**
A: Check spam. If still nothing, IT may not have configured SendGrid yet for production delivery — meanwhile your admin can read passwords / receipts from the in-app **Email log** and share manually.

---

## Mobile

**Q: Can I do everything on my phone?**
A: Yes. Submitting, reviewing, approving, signing, downloading. All works on iOS Safari and Chrome on Android.

**Q: Where's the menu on mobile?**
A: The top bar collapses to icons-only on small screens. Pen = Signature. Key = Password. Logout = Sign out. Tap the SignFlow logo at the top-left to return to your dashboard.

**Q: The screen shifts when I tap an input.**
A: That's iOS zooming because the input was previously rendered too small. We've fixed input font size to 16 px on mobile to prevent this. Hard refresh if you still see it.

**Q: PDF won't scroll smoothly.**
A: Try after a hard refresh. The lazy-loading kicks in only after the initial render.

---

## Security

**Q: Can the admin see my password?**
A: Yes — but only for support reasons (when email delivery isn't set up). You can change your password at any time to invalidate what the admin sees. This is an internal HQHB-only tool.

**Q: What about my signature image?**
A: Stored as a regular image file, served only over authenticated requests, never exposed publicly.

**Q: Can other employees see my requests?**
A: No. Only:
- You (your own)
- The approvers on your target team
- The IT admin (for audit / support)

**Q: Is there an audit trail?**
A: Yes. Admin can see every request, every approver, every timestamp, every status change. Reports → Download full CSV gives the raw audit.

---

## Bugs and feedback

**Q: I found a bug. Where do I report it?**
A: it@hqhb.in with:
- What you were trying to do
- What happened
- A screenshot if possible
- The URL of the page

**Q: I have an idea for an improvement.**
A: Same email. Beta is the time to shape the product.

---

*Beta 1.0 — June 2026.*
