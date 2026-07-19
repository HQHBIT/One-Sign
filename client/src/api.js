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
      let msg = res.statusText;
      if (ct.includes("application/json")) { try { msg = (await res.json()).error || msg; } catch {} }
      throw Object.assign(new Error(msg), { status: res.status });
    }
    if (opts.raw) return res;
    if (ct.includes("application/json")) return res.json();
    return res;
  },

  // -------- auth --------
  login(email, password) {
    return this.fetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  },
  // What the login screen should offer (oneAccess SSO vs local password form).
  authConfig() { return this.fetch("/api/auth/config"); },
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
  createRequest({ file, targetTeamId, marker, workflow, direct, signers, selfMarks, signerDateFields, instantApproval, note, requestType, rotation }) {
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
    return this.fetch("/api/requests", { method: "POST", body: fd });
  },
  searchUsers(q) { return this.fetch(`/api/users/search?q=${encodeURIComponent(q)}`).then(r => r.users); },
  approveRequest(id) { return this.fetch(`/api/requests/${id}/approve`, { method: "POST" }); },
  batchApproveRequests(ids) {
    return this.fetch("/api/requests/batch-approve", { method: "POST", body: JSON.stringify({ ids }) });
  },
  rejectRequest(id, reason) { return this.fetch(`/api/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }); },
  withdrawRequest(id) { return this.fetch(`/api/requests/${id}/withdraw`, { method: "POST" }); },
  // Requestor withdraws their OWN still-pending request.
  cancelRequest(id) { return this.fetch(`/api/requests/${id}/cancel`, { method: "POST" }); },
  remindRequest(id) { return this.fetch(`/api/requests/${id}/reminder`, { method: "POST" }); },
  forceFinalizeRequest(id) { return this.fetch(`/api/requests/${id}/force-finalize`, { method: "POST" }); },

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
  async getRequestFileBlob(id, kind = "file") {
    const res = await this.fetch(`/api/requests/${id}/${kind}`, { raw: true });
    const blob = await res.blob();
    return URL.createObjectURL(blob);
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
