// API wrapper for SignFlow client.
// Bearer-token auth via localStorage. Sent on every request as
// Authorization: Bearer <token>. (httpOnly cookie auth was reverted
// pending diagnosis — see commit history.)

const TOKEN_KEY = "sf_token";

let _token = null;
let _onLogout = null;

export const api = {
  // -------- token management --------
  init() { _token = localStorage.getItem(TOKEN_KEY); return _token; },
  setToken(t) { _token = t; if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); },
  getToken() { return _token; },
  onAuthExpired(fn) { _onLogout = fn; },

  // -------- low-level fetch --------
  async fetch(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (_token) headers.Authorization = `Bearer ${_token}`;
    if (opts.body && !(opts.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(path, { ...opts, headers });
    const ct = res.headers.get("content-type") || "";
    // Auth endpoints return 401 for bad credentials — surface the real error message
    // instead of treating it as session expiry.
    const isAuthRequest = path.startsWith("/api/auth/login");
    if (res.status === 401 && !isAuthRequest) {
      _token = null; localStorage.removeItem(TOKEN_KEY);
      _onLogout?.();
      throw Object.assign(new Error("Session expired"), { status: 401 });
    }
    if (!res.ok) {
      let msg = res.statusText, code = null, needsUnlock = false, attemptsLeft;
      if (ct.includes("application/json")) {
        try {
          const b = await res.json();
          msg = b.error || msg; code = b.code || null;
          // A locked confidential document isn't an error to shout about — the
          // caller turns this into the unlock prompt.
          needsUnlock = b.needsUnlock === true;
          attemptsLeft = b.attemptsLeft;
        } catch {}
      }
      throw Object.assign(new Error(msg), { status: res.status, code, needsUnlock, attemptsLeft });
    }
    if (opts.raw) return res;
    if (ct.includes("application/json")) return res.json();
    return res;
  },

  // -------- auth --------
  // `org` is the organisation whose door this sign-in is at. The server checks
  // the account actually belongs to it and refuses otherwise — with a response
  // identical to a wrong password, so the form reveals nothing.
  login(email, password, org) {
    return this.fetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(org ? { email, password, org } : { email, password })
    });
  },
  // The organisations offered on the landing page. Public — it is what a visitor
  // sees before they have any identity.
  organisations() { return this.fetch("/api/auth/organisations").then(r => r.organisations || []); },
  // What the login screen should offer (oneAccess SSO vs local password form).
  // Scoped to one organisation when given: WAQF's door never offers SSO.
  authConfig(org) {
    return this.fetch(`/api/auth/config${org ? `?org=${encodeURIComponent(org)}` : ""}`);
  },
  // Exchange an oneAccess access token (from the SSO redirect ?token=) for a
  // SignFlow session. Returns { token, user }.
  oneAccessCallback(token) {
    return this.fetch("/api/auth/oneaccess/callback", { method: "POST", body: JSON.stringify({ token }) });
  },
  logout() {
    // Local-only — server has no /logout endpoint on this branch.
    this.setToken(null);
    return Promise.resolve();
  },
  me() { return this.fetch("/api/auth/me"); },
  // First-run capture of a oneAccess user's work email (becomes their primary
  // address for all notifications). Returns { user }.
  setWorkEmail(email) { return this.fetch("/api/auth/me/work-email", { method: "PUT", body: JSON.stringify({ email }) }); },

  // -------- WebAuthn / biometric sign-in --------
  webauthnRegisterOptions() { return this.fetch("/api/webauthn/register/options", { method: "POST" }); },
  webauthnRegisterVerify(body) { return this.fetch("/api/webauthn/register/verify", { method: "POST", body: JSON.stringify(body) }); },
  webauthnLoginOptions(email) { return this.fetch("/api/webauthn/login/options", { method: "POST", body: JSON.stringify(email ? { email } : {}) }); },
  webauthnLoginVerify(body) { return this.fetch("/api/webauthn/login/verify", { method: "POST", body: JSON.stringify(body) }); },
  webauthnCredentials() { return this.fetch("/api/webauthn/credentials").then(r => r.credentials); },
  webauthnRemoveCredential(id) { return this.fetch(`/api/webauthn/credentials/${id}`, { method: "DELETE" }); },

  // -------- executive ↔ assistant mapping --------
  execAssistLinks() { return this.fetch("/api/executive-assistants").then(r => r.links); },
  assistantCandidates() { return this.fetch("/api/executive-assistants/assistant-candidates").then(r => r.candidates); },
  executiveCandidates() { return this.fetch("/api/executive-assistants/executive-candidates").then(r => r.candidates); },
  createExecAssistLink(body) { return this.fetch("/api/executive-assistants", { method: "POST", body: JSON.stringify(body) }).then(r => r.link); },
  updateExecAssistLink(id, body) { return this.fetch(`/api/executive-assistants/${id}`, { method: "PUT", body: JSON.stringify(body) }).then(r => r.link); },
  deleteExecAssistLink(id) { return this.fetch(`/api/executive-assistants/${id}`, { method: "DELETE" }); },
  // -------- assistant acting on behalf --------
  assistExecutives() { return this.fetch("/api/assist/executives").then(r => r.executives); },
  assistRequests(executiveId) { return this.fetch(`/api/assist/${executiveId}/requests`); }, // { requests, scope }
  assistApprove(executiveId, id) { return this.fetch(`/api/assist/${executiveId}/requests/${id}/approve`, { method: "POST" }); },
  assistSetSignature(executiveId, dataUrl) { return this.fetch(`/api/assist/${executiveId}/signature`, { method: "PUT", body: JSON.stringify({ dataUrl }) }); },
  // -------- approve directly from the email (token-authenticated) --------
  emailApprovePreview(token) { return this.fetch("/api/email-approve/preview", { method: "POST", body: JSON.stringify({ token }) }); },
  emailApprove(token) { return this.fetch("/api/email-approve", { method: "POST", body: JSON.stringify({ token }) }); },
  forgotPassword(email) {
    return this.fetch("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
  },
  // Self-service password reset via emailed OTP (no admin approval).
  sendResetOtp(email) {
    return this.fetch("/api/auth/forgot-password/send-otp", { method: "POST", body: JSON.stringify({ email }) });
  },
  resetWithOtp({ email, otp, newPassword }) {
    return this.fetch("/api/auth/forgot-password/verify-otp", { method: "POST", body: JSON.stringify({ email, otp, newPassword }) });
  },
  changePassword(currentPassword, newPassword) {
    return this.fetch("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },

  // -------- self-registration --------
  register({ name, email, password, teamName, reportingManager }) {
    return this.fetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, teamName, reportingManager })
    });
  },
  listRegistrations() { return this.fetch("/api/registrations"); }, // { registrations, pending }
  approveRegistration(id) { return this.fetch(`/api/registrations/${id}/approve`, { method: "POST" }); },
  rejectRegistration(id, reason) {
    return this.fetch(`/api/registrations/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
  },

  // -------- password reset requests --------
  requestReset({ email, newPassword }) {
    return this.fetch("/api/auth/request-reset", { method: "POST", body: JSON.stringify({ email, newPassword }) });
  },
  listPasswordResets() { return this.fetch("/api/password-resets"); }, // { resets, pending }
  approvePasswordReset(id) { return this.fetch(`/api/password-resets/${id}/approve`, { method: "POST" }); },
  rejectPasswordReset(id, reason) {
    return this.fetch(`/api/password-resets/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
  },

  // -------- teams --------
  listTeams() { return this.fetch("/api/teams").then(r => r.teams); },
  createTeam(name) { return this.fetch("/api/teams", { method: "POST", body: JSON.stringify({ name }) }); },
  deleteTeam(id) { return this.fetch(`/api/teams/${id}`, { method: "DELETE" }); },
  grantAuthority(teamId, userId) { return this.fetch(`/api/teams/${teamId}/authority/${userId}`, { method: "PUT" }); },
  revokeAuthority(teamId, userId) { return this.fetch(`/api/teams/${teamId}/authority/${userId}`, { method: "DELETE" }); },

  // -------- users --------
  listUsers() { return this.fetch("/api/users").then(r => r.users); },
  listDuplicateUsers() { return this.fetch("/api/users/duplicates").then(r => r.pairs); },
  oneAccessUsers() { return this.fetch("/api/users/oneaccess").then(r => r.users); },
  setUserItsId(id, its) { return this.fetch(`/api/users/${id}/its-id`, { method: "PUT", body: JSON.stringify({ its }) }); }, // -> { ok, its, collision }
  setUserEmail(id, email) { return this.fetch(`/api/users/${id}/email`, { method: "PUT", body: JSON.stringify({ email }) }); },
  setUserRole(id, role) { return this.fetch(`/api/users/${id}/role`, { method: "PUT", body: JSON.stringify({ role }) }); },
  mergeCandidates() { return this.fetch("/api/users/merge-candidates").then(r => r.candidates); },
  mergeUsers(survivorId, loserId) { return this.fetch("/api/users/merge", { method: "POST", body: JSON.stringify({ survivorId, loserId }) }); },
  reactivateUser(id) { return this.fetch(`/api/users/${id}/reactivate`, { method: "PUT" }); },
  createUser(data) { return this.fetch("/api/users", { method: "POST", body: JSON.stringify(data) }); },
  bulkCreateUsers(rows) { return this.fetch("/api/users/bulk", { method: "POST", body: JSON.stringify({ rows }) }); },
  deleteUser(id) { return this.fetch(`/api/users/${id}`, { method: "DELETE" }); },
  setUserTeam(userId, teamId) {
    return this.fetch(`/api/users/${userId}/team`, { method: "PUT", body: JSON.stringify({ teamId: teamId || null }) });
  },
  inviteUser(userId) {
    return this.fetch(`/api/users/${userId}/invite`, { method: "POST" });
  },
  bulkInvite(ids) {
    return this.fetch("/api/users/bulk-invite", { method: "POST", body: JSON.stringify({ ids }) });
  },
  resetUserPassword(userId, password) {
    // Pass a password string to set explicitly; omit/empty to auto-generate.
    const body = password ? { password } : {};
    return this.fetch(`/api/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify(body)
    });
  },

  // -------- live updates (SSE) --------
  // EventSource cannot send headers, so the stream is opened with a
  // short-lived ticket fetched over the normal authenticated channel.
  eventsTicket() { return this.fetch("/api/events/ticket", { method: "POST" }); },

  // -------- high-contrast (inverted) display --------
  setMyDarkMode(on, variant = null) {
    return this.fetch("/api/users/me/dark-mode", { method: "PUT", body: JSON.stringify({ on, ...(variant ? { variant } : {}) }) });
  },
  setDarkModeAccess(userId, allowed) {
    return this.fetch(`/api/users/${userId}/dark-mode-access`, { method: "PUT", body: JSON.stringify({ allowed }) });
  },

  // -------- my signatures (multiple, tagged) --------
  mySignatures() { return this.fetch("/api/users/me/signatures").then(r => r.signatures); },
  addMySignature({ dataUrl, label }) {
    return this.fetch("/api/users/me/signatures", { method: "POST", body: JSON.stringify({ dataUrl, label }) }).then(r => r.signature);
  },
  setDefaultSignature(id) {
    return this.fetch(`/api/users/me/signatures/${id}`, { method: "PUT", body: JSON.stringify({ makeDefault: true }) }).then(r => r.signature);
  },
  renameMySignature(id, label) {
    return this.fetch(`/api/users/me/signatures/${id}`, { method: "PUT", body: JSON.stringify({ label }) }).then(r => r.signature);
  },
  deleteMySignature(id) { return this.fetch(`/api/users/me/signatures/${id}`, { method: "DELETE" }); },
  // One-time background clean of a signature saved before the cutout existed.
  // Pass { dataUrl } with the cleaned image, or { skip: true } when it was
  // inspected and left alone — either way it is not looked at again.
  markSignatureBackground(id, body) {
    return this.fetch(`/api/users/me/signatures/${id}/background`,
      { method: "POST", body: JSON.stringify(body || {}) }).then(r => r.signature);
  },
  restoreSignatureOriginal(id) {
    return this.fetch(`/api/users/me/signatures/${id}/background/revert`,
      { method: "POST", body: "{}" }).then(r => r.signature);
  },
  async mySignatureBlob(id) {
    try {
      const res = await this.fetch(`/api/users/me/signatures/${id}/image`, { raw: true });
      return URL.createObjectURL(await res.blob());
    } catch { return null; }
  },

  setMySignature(dataUrl) {
    return this.fetch("/api/users/me/signature", {
      method: "PUT", body: JSON.stringify({ dataUrl })
    });
  },
  setUserSignature(userId, file) {
    const fd = new FormData(); fd.append("signature", file);
    return this.fetch(`/api/users/${userId}/signature`, { method: "PUT", body: fd });
  },
  bulkUploadSignatures(files) {
    const fd = new FormData();
    for (const f of files) fd.append("signatures", f, f.name);
    return this.fetch("/api/users/signatures/bulk", { method: "POST", body: fd });
  },

  // -------- requests --------
  listRequests() { return this.fetch("/api/requests").then(r => r.requests); },
  createRequest({ file, targetTeamId, marker, workflow, direct, signers, selfMarks, signerDateFields, instantApproval, note, requestType, rotation, confidential, deferNotify }) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (rotation) fd.append("rotation", String(rotation));
    if (workflow) fd.append("workflow", JSON.stringify(workflow));
    if (direct) fd.append("direct", "true");
    if (signers) fd.append("signers", JSON.stringify(signers));
    if (selfMarks) fd.append("selfMarks", JSON.stringify(selfMarks));
    if (signerDateFields) fd.append("signerDateFields", JSON.stringify(signerDateFields));
    if (targetTeamId) fd.append("targetTeamId", targetTeamId);
    if (marker) fd.append("marker", JSON.stringify(marker));
    if (instantApproval) fd.append("instantApproval", "true");
    if (note) fd.append("note", note);
    if (requestType) fd.append("requestType", requestType);
    if (confidential) fd.append("confidential", "true");
    if (deferNotify) fd.append("deferNotify", "true");
    return this.fetch("/api/requests", { method: "POST", body: fd });
  },
  // After a deferred batch: one summary email per signer, every document named.
  notifyBatch(ids) {
    return this.fetch("/api/requests/notify-batch", { method: "POST", body: JSON.stringify({ ids }) });
  },
  searchUsers(q) { return this.fetch(`/api/users/search?q=${encodeURIComponent(q)}`).then(r => r.users); },
  // instant: true finalises immediately; false/omitted keeps the 1-hour
  // rejection window. The approver chooses at approval time.
  approveRequest(id, instant, signatureId = null) {
    return this.fetch(`/api/requests/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ instant: !!instant, ...(signatureId ? { signatureId } : {}) }),
    });
  },
  batchApproveRequests(ids, instant) {
    return this.fetch("/api/requests/batch-approve", { method: "POST", body: JSON.stringify({ ids, instant: !!instant }) });
  },
  // voice: optional Blob with the approver's recorded note — sent as multipart.
  rejectRequest(id, reason, voice) {
    if (voice) {
      const fd = new FormData();
      fd.append("reason", reason || "");
      fd.append("voice", voice, "voice-note");
      return this.fetch(`/api/requests/${id}/reject`, { method: "POST", body: fd });
    }
    return this.fetch(`/api/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
  },
  async getRejectVoiceBlob(id) {
    const res = await this.fetch(`/api/requests/${id}/reject-voice`, { raw: true });
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  withdrawRequest(id) { return this.fetch(`/api/requests/${id}/withdraw`, { method: "POST" }); },
  // Requestor withdraws their OWN still-pending request.
  cancelRequest(id) { return this.fetch(`/api/requests/${id}/cancel`, { method: "POST" }); },
  remindRequest(id) { return this.fetch(`/api/requests/${id}/reminder`, { method: "POST" }); },
  forceFinalizeRequest(id) { return this.fetch(`/api/requests/${id}/force-finalize`, { method: "POST" }); },

  // -------- sign your own document (stateless — returns the signed PDF) --------
  async selfSignDocument({ file, marks, rotation }) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("marks", JSON.stringify(marks));
    if (rotation) fd.append("rotation", String(rotation));
    const res = await this.fetch("/api/requests/self-sign", { method: "POST", body: fd, raw: true });
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  // -------- saved workflow templates (My Workflows) --------
  listWorkflowTemplates() { return this.fetch("/api/workflow-templates").then(r => r.templates); },
  createWorkflowTemplate({ name, steps }) {
    return this.fetch("/api/workflow-templates", { method: "POST", body: JSON.stringify({ name, steps }) });
  },
  updateWorkflowTemplate(id, { name, steps }) {
    return this.fetch(`/api/workflow-templates/${id}`, { method: "PUT", body: JSON.stringify({ name, steps }) });
  },
  deleteWorkflowTemplate(id) { return this.fetch(`/api/workflow-templates/${id}`, { method: "DELETE" }); },

  // -------- in-app notifications + email toggle --------
  listNotifications() { return this.fetch("/api/notifications"); }, // { unread, notifications }
  markNotificationsRead(ids) {
    return this.fetch("/api/notifications/read", { method: "POST", body: JSON.stringify(ids && ids.length ? { ids } : {}) });
  },
  setEmailNotifications(enabled) {
    return this.fetch("/api/auth/me/email-notifications", { method: "PUT", body: JSON.stringify({ enabled }) });
  },

  // -------- admin / reports --------
  listEmails() { return this.fetch("/api/emails").then(r => r.emails); },
  downloadReportCsv() {
    // Returns a blob URL for download
    return this.fetch("/api/reports/csv", { raw: true }).then(async res => {
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    });
  },

  /* DISABLED: expense feature commented out
  // -------- expenses --------
  // POST is public (login page) — fetch wrapper omits the auth header when no token is set.
  submitExpense({ amount, paidBy, date, repaymentDone, description }) {
    return this.fetch("/api/expenses", {
      method: "POST",
      body: JSON.stringify({ amount, paidBy, date, repaymentDone, description })
    });
  },
  listExpenses() { return this.fetch("/api/expenses"); }, // returns { expenses, summary }
  setExpenseRepayment(id, done) {
    return this.fetch(`/api/expenses/${id}/repayment`, {
      method: "PATCH",
      body: JSON.stringify({ done })
    });
  },
  */

  // -------- authenticated file blobs --------
  async getRequestFileBlob(id, kind = "file", { download = false } = {}) {
    const res = await this.fetch(`/api/requests/${id}/${kind}${download ? "?download=1" : ""}`, { raw: true });
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  // -------- confidential documents --------
  // Email a fresh unlock code, then exchange it for a 60-second viewing window.
  async requestUnlockCode(id) {
    return this.fetch(`/api/requests/${id}/unlock`, { method: "POST" });
  },
  async verifyUnlockCode(id, code) {
    return this.fetch(`/api/requests/${id}/unlock/verify`, {
      method: "POST", body: JSON.stringify({ code }),
    });
  },
  async getSignatureBlob(userId) {
    try {
      const res = await this.fetch(`/api/users/${userId}/signature`, { raw: true });
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch { return null; }
  }
};

api.init();
