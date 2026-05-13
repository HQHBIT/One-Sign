// API wrapper for SignFlow client.
// All requests go through api.fetch(), which attaches the Bearer token
// and throws a structured error on non-2xx responses.

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
  me() { return this.fetch("/api/auth/me"); },

  // -------- teams --------
  listTeams() { return this.fetch("/api/teams").then(r => r.teams); },
  createTeam(name) { return this.fetch("/api/teams", { method: "POST", body: JSON.stringify({ name }) }); },
  deleteTeam(id) { return this.fetch(`/api/teams/${id}`, { method: "DELETE" }); },
  grantAuthority(teamId, userId) { return this.fetch(`/api/teams/${teamId}/authority/${userId}`, { method: "PUT" }); },
  revokeAuthority(teamId, userId) { return this.fetch(`/api/teams/${teamId}/authority/${userId}`, { method: "DELETE" }); },

  // -------- users --------
  listUsers() { return this.fetch("/api/users").then(r => r.users); },
  createUser(data) { return this.fetch("/api/users", { method: "POST", body: JSON.stringify(data) }); },
  bulkCreateUsers(rows) { return this.fetch("/api/users/bulk", { method: "POST", body: JSON.stringify({ rows }) }); },
  deleteUser(id) { return this.fetch(`/api/users/${id}`, { method: "DELETE" }); },

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
  createRequest({ file, targetTeamId, marker, workflow, instantApproval, note, requestType, orientation }) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (workflow) fd.append("workflow", JSON.stringify(workflow));
    if (targetTeamId) fd.append("targetTeamId", targetTeamId);
    if (marker) fd.append("marker", JSON.stringify(marker));
    if (instantApproval) fd.append("instantApproval", "true");
    if (note) fd.append("note", note);
    if (requestType) fd.append("requestType", requestType);
    if (orientation) fd.append("orientation", orientation);
    return this.fetch("/api/requests", { method: "POST", body: fd });
  },
  approveRequest(id) { return this.fetch(`/api/requests/${id}/approve`, { method: "POST" }); },
  batchApproveRequests(ids) {
    return this.fetch("/api/requests/batch-approve", { method: "POST", body: JSON.stringify({ ids }) });
  },
  rejectRequest(id, reason) { return this.fetch(`/api/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }); },
  withdrawRequest(id) { return this.fetch(`/api/requests/${id}/withdraw`, { method: "POST" }); },
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
