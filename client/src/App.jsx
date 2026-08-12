import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import {
  FileText, Upload, CheckCircle, XCircle, Clock, Users, LogOut,
  PenTool, Download, Eye, Bell, Mail, BarChart3, Shield, UserPlus,
  FilePlus, AlertCircle, Plus, X, Check, ArrowRight, ArrowLeft, Building2,
  RefreshCw, Send, Inbox, Archive, ChevronRight, ChevronDown, ChevronUp, Undo2, Trash2,
  FileSpreadsheet, Stamp, History, Zap, GitBranch, Eye as EyeIcon, EyeOff, Printer,
  KeyRound, Wallet, Pencil, RotateCcw, GitMerge, ScanFace, Mic, Square, Calendar, Lock, Moon
} from "lucide-react";
import { api } from "./api.js";
import {
  ROLES, ROLE_LABELS, STATUS, STATUS_LABELS,
  APPROVAL_WINDOW_MS, REMINDER_COOLDOWN_MS,
  COLORS, STEP_COLORS, REQUEST_TYPES, requestTypeLabel, requestTypeColor
} from "./lib/constants.js";
import { uid, fmt, fmtShort, greetName } from "./lib/format.js";
import { isMyTurn, iSignedInWorkflow, nextPendingSigner } from "./lib/turn.js";
import { UnlockModal, UnlockCountdown, ConfidentialBadge, ConfidentialPrompt } from "./components/UnlockGate.jsx";
import { useBackHandler, useEscapeKey } from "./lib/useBackHandler.js";
import { useConfirm, useConfirmation, ConfirmContext } from "./lib/useConfirm.jsx";
import { useFocusTrap } from "./lib/useFocusTrap.js";

// Leaf components — extracted from App.jsx
import { StyleTag } from "./components/StyleTag.jsx";
import { BootScreen } from "./components/BootScreen.jsx";
import { ToastStack } from "./components/Toast.jsx";
import { StatusPill } from "./components/StatusPill.jsx";
import { Hero } from "./components/Hero.jsx";
import { Tile } from "./components/Tile.jsx";
import { Section } from "./components/Section.jsx";
import { BackHeader } from "./components/BackHeader.jsx";
import { Empty } from "./components/Empty.jsx";
import { Row } from "./components/Row.jsx";
import { Countdown } from "./components/Countdown.jsx";
import { ModalShell } from "./components/ModalShell.jsx";
import { TopBar } from "./components/TopBar.jsx";
import { enrolBiometric, biometricAvailableHere, biometricErrorMessage, rememberBiometricEmail } from "./lib/biometric.js";
import { BiometricPrompt } from "./components/BiometricPrompt.jsx";
import { DelegationSettings } from "./components/DelegationSettings.jsx";
import { RoleChangeModal } from "./components/RoleChangeModal.jsx";
import { EmailApproveScreen } from "./components/EmailApproveScreen.jsx";
import { ExecutiveAssistantView } from "./views/ExecutiveAssistantView.jsx";
import { checkForUpdate, updateAvailable } from "./lib/autoUpdate.js";
import { LoginScreen } from "./components/LoginScreen.jsx";
import { SignatureImage } from "./components/SignatureImage.jsx";
import { DownloadBtn } from "./components/DownloadBtn.jsx";
import { PrintBtn } from "./components/PrintBtn.jsx";
import { RequestRow } from "./components/RequestRow.jsx";
import { HelpGuide } from "./components/HelpGuide.jsx";
import { useInstall, InstallBanner, IosInstallSheet } from "./components/InstallPrompt.jsx";
import { WorkflowSummary } from "./components/WorkflowSummary.jsx";
import { SignatureModal } from "./components/SignatureModal.jsx";
import { ChangePasswordModal } from "./components/ChangePasswordModal.jsx";
import { PasswordResetModal } from "./components/PasswordResetModal.jsx";

// Forms — multi-step wizards and the big create flow
import { NewRequest, teamSigners, ord } from "./forms/NewRequest.jsx";
import { OnboardUserWizard } from "./forms/OnboardUserWizard.jsx";

// Lazy-loaded viewer module — pulls in pdfjs-dist (~600 kB) + xlsx (~250 kB)
// only when a document is actually previewed. Keeps the login + dashboard
// initial bundle small.
const ViewerModule = () => import("./viewer.jsx");
const DocPreview = lazy(() => ViewerModule().then(m => ({ default: m.DocPreview })));
const XlsxViewer = lazy(() => ViewerModule().then(m => ({ default: m.XlsxViewer })));
const ViewerFallback = () =>
  <div className="card p-10 text-sm opacity-50 text-center">Loading viewer…</div>;

// FileX icon shim (lucide doesn't always export it)
const FileX = (props) => <FileText {...props} />;

/* ============================================================
   HQHB SIGNFLOW — React client (talks to Node/Express + MySQL)
   ------------------------------------------------------------
   Data layer: API (see ./api.js). No browser storage except JWT.
   Constants + helpers live in ./lib/.
   ============================================================ */

// Can this user act (approve/reject) on the request right now? Mirrors the
// eligibility ApproverView uses — decides whether a deep-linked request opens the
// actionable review drawer (ApproveDrawer) or the read-only preview (PreviewDrawer).
function canActOnRequest(r, user) {
  if (!r || !user || r.status !== "pending") return false;
  if (r.approverId === user.id) return true;
  if ((r.workflow || []).some(st => (st.signers || []).some(s => s.userId === user.id))) return true;
  if (r.targetTeamId && (user.signingAuthorityTeams || []).includes(r.targetTeamId)) return true;
  return false;
}

// ============================================================
//   ROOT APP
// ============================================================
// Captured once at module load: the approve-from-email token (?approveToken=…).
// Stripped from the URL immediately so a refresh or bookmark can't replay it.
const EMAIL_APPROVE_TOKEN = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("approveToken");
    if (t) {
      params.delete("approveToken");
      window.history.replaceState({}, "", window.location.pathname + (params.toString() ? "?" + params.toString() : ""));
    }
    return t;
  } catch { return null; }
})();

export default function App() {
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState(null);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [emails, setEmails] = useState([]);
  const [toasts, setToasts] = useState([]); // queue — multiple notifications stack
  // In-app notification centre (bell in the top bar).
  const [notifs, setNotifs] = useState({ unread: 0, notifications: [] });
  const [tick, setTick] = useState(0);
  const [deepLinkReq, setDeepLinkReq] = useState(null); // request opened via an email deep link (?request=<id>)
  // Approve-from-email: the green button carries ?approveToken=… — captured once
  // at module load (state initializers can run twice under StrictMode, and the
  // URL-strip makes a second run return null) and rendered as a standalone
  // confirm screen before any auth.
  const [emailApproveToken, setEmailApproveToken] = useState(EMAIL_APPROVE_TOKEN);

  const notify = useCallback((msg, kind = "info") => {
    const id = uid("t");
    setToasts(t => [...t, { msg, kind, id }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3800);
  }, []);

  // ---- data refresh based on role ----
  const refresh = useCallback(async (forUser = user) => {
    if (!forUser) return;
    try {
      const [t, r] = await Promise.all([api.listTeams(), api.listRequests()]);
      setTeams(t || []);
      setRequests(r || []);
      api.listNotifications().then(n => setNotifs(n)).catch(() => {});
      if (forUser.role === "admin") {
        const [u, e] = await Promise.all([api.listUsers(), api.listEmails()]);
        setUsers(u || []);
        setEmails(e || []);
      } else {
        setUsers([]); setEmails([]);
      }
    } catch (e) {
      if (e.status !== 401) notify(`Refresh failed: ${e.message}`, "error");
    }
  }, [user]);

  // ---- boot: restore session if token exists ----
  useEffect(() => {
    (async () => {
      api.onAuthExpired(() => { setUser(null); notify("Session expired — please sign in again", "error"); });

      // Email deep link (?request=<id>) + oneAccess SSO landing (?token=<jwt>).
      // Stash the request id up front so it survives a login / SSO round-trip, then
      // scrub both params so a refresh or bookmark can't replay them.
      try {
        const params = new URLSearchParams(window.location.search);
        const deepReq = params.get("request");
        if (deepReq) localStorage.setItem("sf_deeplink", deepReq);
        const ssoToken = params.get("token");
        if (ssoToken) {
          try {
            const { token: sfToken } = await api.oneAccessCallback(ssoToken);
            api.setToken(sfToken);
          } catch (e) {
            notify(e.message || "oneAccess sign-in failed", "error");
          }
        }
        if (deepReq || ssoToken) {
          params.delete("request");
          params.delete("token");
          const clean = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
          window.history.replaceState({}, "", clean);
        }
      } catch { /* no-op */ }

      const token = api.init();
      if (token) {
        try {
          const me = await api.me();
          setUser(me.user);
          const [t, r] = await Promise.all([api.listTeams(), api.listRequests()]);
          setTeams(t || []); setRequests(r || []);
          api.listNotifications().then(n => setNotifs(n)).catch(() => {});
          if (me.user.role === "admin") {
            const [u, e] = await Promise.all([api.listUsers(), api.listEmails()]);
            setUsers(u || []); setEmails(e || []);
          }
        } catch {
          api.setToken(null);
        }
      }
      setBooted(true);
    })();
  }, []);

  // Open a request deep-linked from an email button, once we're signed in. The id
  // was stashed at boot so it survives the login / SSO round-trip. Fetch a fresh
  // list so we're sure the request is present, then open the right drawer.
  useEffect(() => {
    if (!user) return;
    const id = localStorage.getItem("sf_deeplink");
    if (!id) return;
    localStorage.removeItem("sf_deeplink");
    (async () => {
      try {
        const list = await api.listRequests();
        const r = (list || []).find(x => x.id === id);
        if (r) setDeepLinkReq(r);
        else notify("That document isn't available on your account.", "error");
      } catch {
        notify("Couldn't open that document — please try again.", "error");
      }
    })();
  }, [user, notify]);

  // ---- auto-update while signed out ----
  // When the app is (re)opened or resumed on the login screen, pick up any newly
  // deployed build before the user signs in — so their next login always lands on
  // the latest version. We only do this while signed out to avoid reloading over
  // a user's in-progress work; signed-in clients update on their next login.
  useEffect(() => {
    if (user) return;
    checkForUpdate();
    const onShow = () => { if (document.visibilityState === "visible") checkForUpdate(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [user]);

  // While SIGNED IN we never reload over in-progress work. Instead, when a newer
  // build ships, surface a banner — one tap refreshes to the latest version (the
  // session token persists, so they land right back where they were, signed in).
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    if (!user) { setUpdateReady(false); return; }
    const check = () => { updateAvailable().then(v => { if (v) setUpdateReady(true); }); };
    check();
    const onShow = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [user]);

  // ---- refresh strategy ----
  // The countdown for the approval-window pill needs to tick at least every
  // minute, so we keep a 1-minute tick for clock-driven UI. Data, however, is
  // refreshed only when the tab regains focus or visibility — cutting idle API
  // chatter (and mobile battery) and removing the every-30s thundering-herd.
  useEffect(() => {
    if (!user) return;
    const tickTimer = setInterval(() => setTick(x => x + 1), 60_000);
    const onActive = () => {
      if (document.visibilityState !== "visible") return;
      setTick(x => x + 1);
      refresh(user);
    };
    window.addEventListener("focus", onActive);
    document.addEventListener("visibilitychange", onActive);
    return () => {
      clearInterval(tickTimer);
      window.removeEventListener("focus", onActive);
      document.removeEventListener("visibilitychange", onActive);
    };
  }, [user, refresh]);

  // ---- auth actions ----
  const login = async (email, password) => {
    try {
      const { token, user: u } = await api.login(email, password);
      api.setToken(token);
      // If a newer build has shipped, reload now (the token is persisted, so the
      // user lands signed in on the latest version — including the current logo).
      await checkForUpdate();
      setUser(u);
      await refresh(u);
      notify(`Welcome, ${greetName(u.name)}`, "success");
      return true;
    } catch (e) {
      notify(e.message || "Sign-in failed", "error");
      return false;
    }
  };
  // Establish a session from an already-issued { token, user } — used by
  // biometric (WebAuthn) sign-in, which authenticates without a password.
  const completeSession = async ({ token, user: u }) => {
    api.setToken(token);
    await checkForUpdate();
    setUser(u);
    await refresh(u);
    notify(`Welcome, ${greetName(u.name)}`, "success");
  };
  const logout = async () => {
    api.setToken(null);
    setUser(null); setTeams([]); setUsers([]); setRequests([]); setEmails([]);
  };

  // ---- shared actions (passed to child views) ----
  const setMySignature = async dataUrl => {
    await api.setMySignature(dataUrl);
    const me = await api.me();
    setUser(me.user);
  };
  const createRequest = async payload => {
    const r = await api.createRequest(payload);
    await refresh(user);
    return r;   // the batch flow needs the created ids for its summary notice
  };
  const sendReminder = async id => {
    try { await api.remindRequest(id); notify("Reminder sent", "success"); await refresh(user); }
    catch (e) { notify(e.message, "error"); }
  };
  const approveRequest = async (id, instant, signatureId = null) => {
    try {
      await api.approveRequest(id, instant, signatureId);
      notify(instant ? "Approved!" : "Approved! You have 1 hour to change your mind.", "success");
      await refresh(user);
    }
    catch (e) { notify(e.message, "error"); }
  };
  // ---- in-app notifications ----
  const openNotification = async (n) => {
    if (!n.read) {
      api.markNotificationsRead([n.id]).catch(() => {});
      setNotifs(prev => ({ unread: Math.max(0, prev.unread - 1), notifications: prev.notifications.map(x => x.id === n.id ? { ...x, read: true } : x) }));
    }
    if (!n.requestId) return;
    let r = requests.find(x => x.id === n.requestId);
    if (!r) {
      try { const list = await api.listRequests(); setRequests(list || []); r = (list || []).find(x => x.id === n.requestId); } catch { /* ignore */ }
    }
    if (r) setDeepLinkReq(r);
    else notify("That document isn't available on your account.", "info");
  };
  const markAllNotifsRead = () => {
    api.markNotificationsRead().catch(() => {});
    setNotifs(prev => ({ unread: 0, notifications: prev.notifications.map(x => ({ ...x, read: true })) }));
  };
  const toggleEmailNotifications = async () => {
    try {
      const { user: updated } = await api.setEmailNotifications(!user.emailNotifications);
      setUser(updated);
      notify(updated.emailNotifications
        ? "Email notifications turned ON."
        : "Email notifications turned OFF — you'll still get in-app notifications here.", "success");
    } catch (e) { notify(e.message || "Could not update the setting", "error"); }
  };

  const rejectRequest = async (id, reason, voice) => {
    try { await api.rejectRequest(id, reason, voice); notify("Request rejected", "success"); await refresh(user); }
    catch (e) { notify(e.message, "error"); }
  };
  const undoApproval = async id => {
    try { await api.withdrawRequest(id); notify("Approval withdrawn", "success"); await refresh(user); }
    catch (e) { notify(e.message, "error"); }
  };
  const forceFinalize = async id => {
    try { await api.forceFinalizeRequest(id); notify("Finalised", "success"); await refresh(user); }
    catch (e) { notify(e.message, "error"); }
  };
  // Requestor withdraws their OWN still-pending request. Once an approver has
  // accepted or rejected it, withdrawal is blocked server-side (400).
  const cancelRequest = async id => {
    const ok = await confirm({
      title: "Withdraw this request?",
      message: "The request will be withdrawn and removed from pending. Approvers will no longer see it. This can't be undone.",
      confirmLabel: "Withdraw request",
      destructive: true
    });
    if (!ok) return;
    try { await api.cancelRequest(id); notify("Request withdrawn", "success"); await refresh(user); }
    catch (e) { notify(e.message || "Could not withdraw", "error"); }
  };
  const saveUsers = async () => { if (user?.role === "admin") setUsers(await api.listUsers()); };
  const saveTeams = async () => { setTeams(await api.listTeams()); };

  // Custom confirmation dialog — replaces native window.confirm()
  const { confirm, ConfirmHost } = useConfirm();

  // ---- render ----
  if (!booted) return <BootScreen />;

  // Approve-from-email takes over the whole screen — the emailed token is the
  // authentication, so this works signed-in or not.
  if (emailApproveToken) {
    return (
      <>
        <StyleTag />
        <EmailApproveScreen token={emailApproveToken} onClose={() => setEmailApproveToken(null)} />
      </>
    );
  }

  return (
    <ConfirmContext.Provider value={confirm}>
    <div className="min-h-screen" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif", backgroundColor: "var(--c-cream)", color: "var(--c-ink)" }}>
      <StyleTag />
      {!user ? (
        <LoginScreen login={login} onSession={completeSession} />
      ) : user.needsWorkEmail ? (
        <WorkEmailCapture user={user} notify={notify} onDone={setUser} />
      ) : (
        <Shell
          user={user}
          users={users} teams={teams} requests={requests} emails={emails}
          notifs={notifs} onOpenNotification={openNotification}
          onMarkAllNotifsRead={markAllNotifsRead} onToggleEmailNotifs={toggleEmailNotifications}
          logout={logout}
          setSignature={setMySignature}
          refreshUser={async () => { const me = await api.me(); setUser(me.user); }}
          saveUsers={saveUsers} saveTeams={saveTeams}
          addRequest={createRequest}
          sendReminder={sendReminder}
          cancelRequest={cancelRequest}
          approveRequest={approveRequest} rejectRequest={rejectRequest}
          undoApproval={undoApproval} forceFinalize={forceFinalize}
          notify={notify}
          refresh={() => refresh(user)}
          tick={tick}
        />
      )}
      {user && deepLinkReq && (
        canActOnRequest(deepLinkReq, user)
          ? <ApproveDrawer req={deepLinkReq} user={user} users={users} teams={teams}
              approveRequest={approveRequest} rejectRequest={rejectRequest} undoApproval={undoApproval}
              onClose={() => setDeepLinkReq(null)} notify={notify} />
          : <PreviewDrawer user={user} req={deepLinkReq} users={users} teams={teams} onClose={() => setDeepLinkReq(null)} />
      )}
      {user && updateReady && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full pl-4 pr-2 py-2 shadow-lg text-sm"
          style={{ backgroundColor: "var(--c-ink)", color: "var(--c-cream)" }}>
          <span>A new version of SignFlow is ready.</span>
          <button className="rounded-full px-3 py-1 text-xs font-medium"
            style={{ backgroundColor: "var(--c-cream)", color: "var(--c-ink)" }}
            onClick={() => window.location.reload()}>
            Refresh now
          </button>
        </div>
      )}
      <ToastStack toasts={toasts} />
      <ConfirmHost />
    </div>
    </ConfirmContext.Provider>
  );
}

// ============================================================
//   WORK-EMAIL CAPTURE — one-time, blocking prompt shown to a brand-new
//   oneAccess user so their notifications go to their work address, not
//   whatever email oneAccess signed them in with.
// ============================================================
function WorkEmailCapture({ user, notify, onDone }) {
  const isPlaceholder = /@oneaccess\.local$/i.test(user.email || "");
  const [email, setEmail] = useState(isPlaceholder ? "" : (user.email || ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async e => {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { setErr("Please enter a valid email address"); return; }
    setBusy(true); setErr(null);
    try {
      const { user: updated } = await api.setWorkEmail(v);
      notify("Work email saved — you'll get all notifications here.", "success");
      onDone(updated);
    } catch (e2) {
      setErr(e2.message || "Could not save your work email");
    } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: "var(--c-cream)" }}>
      <div className="w-full max-w-md card p-6 sm:p-8 anim-in">
        <div className="font-display text-2xl sm:text-3xl mb-2">One quick thing, {greetName(user.name)}</div>
        <div className="text-sm opacity-60 mb-8">
          Please enter your <strong>work email address</strong>. SignFlow will use it for all your notifications — document requests, approvals and reminders.
        </div>
        <form onSubmit={submit}>
          <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Work email address</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            className="w-full mb-2" placeholder="you@hqhb.in" required autoFocus disabled={busy} />
          {!isPlaceholder && (
            <div className="text-xs opacity-50 mb-5">
              Signed in via oneAccess as <span className="font-mono">{user.email}</span> — keep this or enter a different work email.
            </div>
          )}
          {isPlaceholder && <div className="mb-5" />}
          {err && (
            <div className="text-xs px-3 py-2 rounded mb-4" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>{err}</div>
          )}
          <button className="btn-primary w-full justify-center" disabled={busy || !email.trim()}>
            {busy ? "Saving…" : <>Continue <ArrowRight size={16} /></>}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
//   BIOMETRIC SIGN-IN — enrol / manage this device's Face ID / fingerprint.
//   The device does the biometric check; SignFlow stores only a public key.
// ============================================================
function BiometricModal({ user, notify, onClose }) {
  const [avail, setAvail] = useState(null);     // null = checking
  const [creds, setCreds] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEscapeKey(onClose);
  const load = () => api.webauthnCredentials().then(setCreds).catch(() => setCreds([]));
  useEffect(() => { biometricAvailableHere().then(setAvail).catch(() => setAvail(false)); load(); }, []);

  const enrol = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await enrolBiometric();
      rememberBiometricEmail(user?.email); // one-tap next time on this device
      notify(`Biometric sign-in enabled on ${r.label || "this device"}.`, "success");
      await load();
    } catch (e) { setErr(biometricErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const remove = async (id) => {
    try { await api.webauthnRemoveCredential(id); await load(); notify("Device removed.", "success"); }
    catch (e) { notify(e.message || "Could not remove device.", "error"); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(15,26,46,.6)" }} onClick={onClose}>
      <div className="card p-6 max-w-md w-full m-4" style={{ backgroundColor: "var(--c-cream)" }} onClick={e => e.stopPropagation()}>
        <div className="font-display text-2xl mb-1">Biometric sign-in</div>
        <div className="text-sm opacity-60 mb-5">
          Turn on Face ID / fingerprint sign-in for <b>this device</b>. Your face or fingerprint never leaves it — SignFlow only stores a key.
        </div>
        {avail === false && (
          <div className="text-xs px-3 py-2 rounded mb-4" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
            This device doesn't offer a built-in biometric. Try a phone, or a laptop with Face ID / Windows Hello.
          </div>
        )}
        {creds && creds.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-2">Enabled on</div>
            <div className="space-y-2">
              {creds.map(c => (
                <div key={c.id} className="flex items-center justify-between rounded p-2.5" style={{ backgroundColor: "rgba(15,26,46,.04)" }}>
                  <div className="text-sm">{c.label} <span className="opacity-40 text-xs">· {fmtShort(c.createdAt)}</span></div>
                  <button className="text-xs opacity-60 hover:opacity-100" onClick={() => remove(c.id)}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {err && <div className="text-xs px-3 py-2 rounded mb-4" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>{err}</div>}
        <div className="flex justify-end gap-3">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={enrol} disabled={busy || avail === false}>
            <ScanFace size={15} /> {busy ? "Follow your device…" : "Enable on this device"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//   SHELL (top nav + role router)
// ============================================================
function Shell(props) {
  const { user, logout, setSignature, notify } = props;
  const [needsSig, setNeedsSig] = useState(false);
  const [editSig, setEditSig] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [delegationOpen, setDelegationOpen] = useState(false);
  // PWA install ("Add to Home Screen"). On iOS there's no programmatic prompt,
  // so tapping install opens a short instructions sheet instead.
  const install = useInstall();
  const [iosSheet, setIosSheet] = useState(false);
  const handleInstall = () => { if (install.canPrompt) install.promptInstall(); else if (install.ios) setIosSheet(true); };
  // Bumped by the Home button — remounts the active role view, which resets its
  // internal tab state back to "home" (the dashboard) from any sub-view.
  const [homeKey, setHomeKey] = useState(0);

  // require signature for requestor & approver on first login
  useEffect(() => {
    if ((user.role === "requestor" || user.role === "approver" || user.role === "executive") && !user.hasSignature) setNeedsSig(true);
    else setNeedsSig(false);
  }, [user.id, user.role, user.hasSignature]);

  // Display mode: null = normal, or one of the three dark variants. Stored on
  // the server so the choice follows the user across phone and web.
  const setDisplayMode = async (variant) => {
    try { await api.setMyDarkMode(!!variant, variant || null); await props.refreshUser?.(); }
    catch (e) { notify(e.message || "Could not switch the display", "error"); }
  };

  return (
    <>
      {/* Whole-screen inversion for low-vision reading: a difference blend
          against white turns every pixel underneath into its opposite — white
          pages become black, dark text becomes light — documents, PDFs and
          spreadsheets included, on any screen size. pointer-events: none, so
          it never intercepts a tap; z-index above every drawer and modal. */}
      {user.darkModeOn && (
        <div aria-hidden="true" data-invert-layer data-variant={user.darkModeVariant} style={{
          position: "fixed", inset: 0, pointerEvents: "none", zIndex: 2147483000,
          ...(user.darkModeVariant === "natural"
            // Dark with familiar colours: invert flips luminance, the half-turn
            // hue rotation puts the hues roughly back where they were.
            ? { backdropFilter: "invert(1) hue-rotate(180deg)", WebkitBackdropFilter: "invert(1) hue-rotate(180deg)" }
            : user.darkModeVariant === "grayscale"
            // No hue at all: every kind of colour-blindness sees the same
            // picture — everything is distinguished by brightness alone.
            ? { backdropFilter: "invert(1) grayscale(1) contrast(1.2)", WebkitBackdropFilter: "invert(1) grayscale(1) contrast(1.2)" }
            // The strongest flip — the original difference-blend inversion.
            : { background: "#fff", mixBlendMode: "difference" }),
        }} />
      )}
      <TopBar user={user} logout={logout}
        notifs={props.notifs} onOpenNotification={props.onOpenNotification}
        onMarkAllNotifsRead={props.onMarkAllNotifsRead} onToggleEmailNotifs={props.onToggleEmailNotifs}
        onSetDisplayMode={user.darkModeAllowed ? setDisplayMode : null}
        onEditSignature={() => setEditSig(true)}
        onChangePassword={() => setChangingPwd(true)}
        onBiometric={() => setBioOpen(true)}
        onDelegation={(user.role === "executive" || user.role === "admin") ? () => setDelegationOpen(true) : null}
        onHome={() => setHomeKey(k => k + 1)}
        onInstall={install.supported ? handleInstall : null}
        onHelp={() => setHelpOpen(true)} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-6 sm:py-8">
        <InstallBanner install={install} onInstall={handleInstall} />
        {user.role === "requestor" && <RequestorView key={homeKey} {...props} />}
        {(user.role === "approver" || user.role === "executive") && <ApproverView key={homeKey} {...props} />}
        {user.role === "executive_assistant" && <ExecutiveAssistantView key={homeKey} PersonalView={RequestorView} {...props} />}
        {user.role === "admin" && <AdminView key={homeKey} {...props} />}
      </main>
      {needsSig && (
        <SignatureModal
          title="Add your signature"
          subtitle={user.role === "requestor"
            ? "Every requestor must register a signature before submitting documents."
            : "Every approver must register a signature before acting on requests."}
          onCancel={null}
          onLogout={logout}
          onSave={async dataUrl => { await setSignature(dataUrl); setNeedsSig(false); notify("Signature saved", "success"); }}
        />
      )}
      {editSig && (
        <SignatureModal
          manage
          title="My signatures"
          subtitle="Keep up to 5 signatures, each with a name tag. The default is used unless you pick another while signing."
          onCancel={() => setEditSig(false)}
          onChanged={() => props.refreshUser?.()}
          onSave={async dataUrl => { await setSignature(dataUrl); setEditSig(false); notify("Signature updated", "success"); }}
        />
      )}
      {changingPwd && (
        <ChangePasswordModal
          onClose={() => setChangingPwd(false)}
          notify={notify} />
      )}
      {bioOpen && <BiometricModal user={user} notify={notify} onClose={() => setBioOpen(false)} />}
      {delegationOpen && <DelegationSettings user={user} notify={notify} onClose={() => setDelegationOpen(false)} />}
      <BiometricPrompt notify={notify} hold={needsSig} />
      {helpOpen && <HelpGuide onClose={() => setHelpOpen(false)} />}
      {iosSheet && <IosInstallSheet onClose={() => setIosSheet(false)} />}
    </>
  );
}

// ============================================================
//   SIGN YOUR DOCUMENTS — personal signing utility. Upload a PDF, place your
//   own signature / date marks, download the signed copy. Stateless: nothing
//   is stored and no request or approval is created.
// ============================================================
function SelfSignDoc({ user, notify, back }) {
  const [file, setFile] = useState(null);        // { name, base64, blob, ext }
  const [marks, setMarks] = useState([]);        // [{ type: 'signature'|'date', page, x, y, w, h }]
  const [tool, setTool] = useState("signature"); // what the next click-drag places
  const [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mySigUrl, setMySigUrl] = useState(null);
  const todayDdMmYy = (() => { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`; })();

  // Live preview of the user's actual signature inside the placed boxes.
  useEffect(() => {
    if (!user.hasSignature || !file) { setMySigUrl(null); return; }
    let url = null, dead = false;
    api.getSignatureBlob(user.id).then(u => { if (dead) { if (u) URL.revokeObjectURL(u); return; } url = u; setMySigUrl(u); }).catch(() => {});
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [file, user.hasSignature, user.id]);

  const handleFile = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!["pdf", "xlsx", "xls"].includes(ext)) { notify("Only PDF or Excel files supported", "error"); return; }
    if (f.size > 14 * 1024 * 1024) { notify("File must be under 14 MB", "error"); return; }
    const kind = ext === "pdf" ? "pdf" : "xlsx";
    const reader = new FileReader();
    reader.onload = () => {
      setFile({ name: f.name, base64: reader.result, blob: f, ext: kind });
      setMarks([]); setRotation(0);
      // A dated text box has no spreadsheet equivalent, so Excel is signature-only.
      setTool(user.hasSignature || kind === "xlsx" ? "signature" : "date");
    };
    reader.readAsDataURL(f);
  };
  const isPdf = file?.ext === "pdf";

  const markers = marks.map((m, i) => ({
    id: `self-${i}`, page: m.page || 1, x: m.x, y: m.y, w: m.w, h: m.h,
    color: "#3E8E5A",
    label: m.type === "date" ? todayDdMmYy : "Your signature",
    ...(m.type === "signature" && mySigUrl ? { signedDataUrl: mySigUrl } : {}),
  }));
  const onAddMarker = (page, x, y, w, h) => {
    if (tool === "signature" && !user.hasSignature) { notify("Register a signature first (top-right menu)", "error"); return; }
    setMarks(ms => [...ms, { type: tool, page, x, y, w, h }]);
  };
  const markIdx = (id) => { const m = /^self-(\d+)$/.exec(id || ""); return m ? Number(m[1]) : -1; };
  const onUpdateMarker = (id, patch) => { const i = markIdx(id); if (i >= 0) setMarks(ms => ms.map((m, k) => k === i ? { ...m, ...patch } : m)); };
  const onDeleteMarker = (id) => { const i = markIdx(id); if (i >= 0) setMarks(ms => ms.filter((_, k) => k !== i)); };
  const fixedBox = tool === "date" ? { w: 12, h: 4.5 } : { w: 22, h: 6 };

  const download = async () => {
    setBusy(true);
    try {
      const url = await api.selfSignDocument({ file: file.blob, marks, rotation });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file.name.replace(/\.(pdf|xlsx|xls)$/i, "")}.signed.${isPdf ? "pdf" : "xlsx"}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notify(`Signed ${isPdf ? "PDF" : "workbook"} downloaded`, "success");
    } catch (e) { notify(e.message || "Could not sign the document", "error"); }
    finally { setBusy(false); }
  };

  const sigCount = marks.filter(m => m.type === "signature").length;
  const dateCount = marks.filter(m => m.type === "date").length;

  return (
    <div>
      <BackHeader back={back} title="Sign your documents" step={file ? file.name : "Upload a document"} />
      <p className="text-sm opacity-60 mt-3 max-w-2xl">
        Upload a PDF or Excel workbook, place your signature (and today's date on a PDF if you like), and download the signed copy — no approvals, nothing stored.
      </p>

      {!file ? (
        <label className="card mt-6 p-10 flex flex-col items-center justify-center gap-3 cursor-pointer tile-hover" style={{ border: "2px dashed var(--c-ink-18)" }}>
          <Upload size={22} className="opacity-50" />
          <div className="text-sm font-medium">Click to upload a PDF or Excel file</div>
          <div className="text-xs opacity-50">PDF · XLSX — up to 14 MB</div>
          <input type="file" accept=".pdf,.xlsx,.xls" className="hidden" onChange={handleFile} />
        </label>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mt-5 mb-3 text-xs">
            <span className="font-medium opacity-80 flex items-center gap-1"><Stamp size={13} style={{ color: "#3E8E5A" }} /> Place on the document:</span>
            <button type="button" disabled={!user.hasSignature}
              className={`text-xs ${tool === "signature" ? "btn-gold" : "btn-ghost"}`}
              title={user.hasSignature ? "Every click-drag adds your signature" : "Register a signature first (top-right menu)"}
              onClick={() => setTool("signature")}>
              <PenTool size={12} /> My signature
            </button>
            {/* Dates are a floating text box — PDF only. On a sheet they'd have to
                overwrite a cell, so Excel offers signatures alone. */}
            {isPdf && (
              <button type="button"
                className={`text-xs ${tool === "date" ? "btn-gold" : "btn-ghost"}`}
                onClick={() => setTool("date")}>
                <Calendar size={12} /> Date ({todayDdMmYy})
              </button>
            )}
            {marks.length > 0 && (
              <span className="opacity-60">· {sigCount} signature{sigCount === 1 ? "" : "s"} + {dateCount} date{dateCount === 1 ? "" : "s"} placed
                <button type="button" className="underline ml-2" onClick={() => setMarks([])}>clear all</button>
              </span>
            )}
            <span className="flex-1" />
            <button className="btn-ghost text-xs" onClick={() => { setFile(null); setMarks([]); }}>Change file</button>
          </div>
          {!user.hasSignature && (
            <div className="text-xs mb-3 px-3 py-2 rounded inline-block" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
              {isPdf
                ? "No registered signature yet — you can still place dates. To sign, add your signature from the top-right menu first."
                : "No registered signature yet — add your signature from the top-right menu to sign this workbook."}
            </div>
          )}
          <Suspense fallback={<ViewerFallback />}>
            <DocPreview file={file} markers={markers} editable fixedBox={fixedBox}
              onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker}
              rotation={rotation} onRotate={() => setRotation(r => (r + 90) % 360)} />
          </Suspense>
          <div className="flex justify-end mt-4">
            <button className="btn-primary" onClick={download} disabled={busy || marks.length === 0}
              title={marks.length === 0 ? "Place your signature or a date first" : ""}>
              <Download size={14} /> {busy ? "Signing…" : `Download signed ${isPdf ? "PDF" : "workbook"}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
//   MY WORKFLOWS — saved, reusable signing routes. A template stores the steps
//   and signers only; each use attaches a fresh document and places the boxes.
// ============================================================
function MyWorkflows({ teams, notify, back, onUse }) {
  const [templates, setTemplates] = useState(null);
  const [editing, setEditing] = useState(null); // { id?, name, steps: [{teamId, signers: [userId]}] }
  const [busy, setBusy] = useState(false);
  const confirm = useConfirmation();
  const load = () => api.listWorkflowTemplates().then(setTemplates).catch(e => notify(e.message || "Could not load workflows", "error"));
  useEffect(() => { load(); }, []);

  const remove = async (t) => {
    const ok = await confirm({
      title: `Delete "${t.name}"?`,
      message: "Only the saved workflow is removed — requests already raised with it are untouched.",
      confirmLabel: "Delete workflow", destructive: true
    });
    if (!ok) return;
    try { await api.deleteWorkflowTemplate(t.id); notify("Workflow deleted", "success"); load(); }
    catch (e) { notify(e.message, "error"); }
  };
  const startNew = () => setEditing({ name: "", steps: [{ teamId: "", signers: [] }] });
  const startEdit = (t) => setEditing({ id: t.id, name: t.name, steps: t.steps.map(s => ({ teamId: s.teamId, signers: s.signers.map(g => g.userId) })) });
  const save = async () => {
    if (!editing.name.trim()) { notify("Give the workflow a name", "error"); return; }
    if (!editing.steps.length || editing.steps.some(s => !s.teamId || s.signers.length === 0)) {
      notify("Every step needs a team and at least one signer", "error"); return;
    }
    setBusy(true);
    try {
      if (editing.id) await api.updateWorkflowTemplate(editing.id, { name: editing.name.trim(), steps: editing.steps });
      else await api.createWorkflowTemplate({ name: editing.name.trim(), steps: editing.steps });
      notify(`"${editing.name.trim()}" saved`, "success");
      setEditing(null); load();
    } catch (e) { notify(e.message, "error"); }
    finally { setBusy(false); }
  };
  const patchStep = (i, patch) => setEditing(ed => ({ ...ed, steps: ed.steps.map((s, j) => j === i ? { ...s, ...patch } : s) }));

  // ---- builder ----
  if (editing) {
    return (
      <div>
        <BackHeader back={() => setEditing(null)} title={editing.id ? "Edit workflow" : "New workflow"} step={`${editing.steps.length} step${editing.steps.length === 1 ? "" : "s"}`} />
        <div className="max-w-2xl mt-6 space-y-4">
          <div className="card p-4">
            <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Workflow name</label>
            <input type="text" value={editing.name} onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))}
              className="w-full" maxLength={120} placeholder='e.g. "PO approval — Finance then Director"' autoFocus />
          </div>
          {editing.steps.map((st, si) => {
            const team = teams.find(t => t.id === st.teamId);
            const pool = teamSigners(team).filter(a => !st.signers.includes(a.id));
            // Reorder within the step — signers sign in exactly this sequence.
            const moveSigner = (from, to) => {
              if (to < 0 || to >= st.signers.length) return;
              const signers = [...st.signers];
              const [m] = signers.splice(from, 1);
              signers.splice(to, 0, m);
              patchStep(si, { signers });
            };
            return (
              <div key={si} className="card p-4" style={{ borderLeft: `3px solid ${STEP_COLORS[si % STEP_COLORS.length]}` }}>
                <div className="flex items-center justify-between gap-2 mb-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-mono text-[10px] opacity-50 shrink-0">Step {si + 1}</span>
                    <select value={st.teamId} onChange={e => patchStep(si, { teamId: e.target.value, signers: [] })}
                      className="text-xs w-full min-w-0" style={{ maxWidth: 320 }}>
                      <option value="">— team —</option>
                      {/* Teams without a designated approver fall back to members. */}
                      {teams.map(t => {
                        const n = teamSigners(t).length;
                        return <option key={t.id} value={t.id}>{t.name}{n === 0 ? " — no members yet" : ""}</option>;
                      })}
                    </select>
                  </div>
                  <button className="btn-ghost text-[10px] shrink-0" onClick={() => setEditing(ed => ({ ...ed, steps: ed.steps.filter((_, j) => j !== si) }))}><Trash2 size={10} /></button>
                </div>
                {team && (
                  <>
                    {!(team.approvers || []).length && (team.members || []).length > 0 && (
                      <div className="text-[10px] mb-2 px-2 py-1 rounded inline-block" style={{ backgroundColor: "rgba(184,137,74,.12)", color: "var(--c-sand)" }}>
                        No approver designated — choosing from {team.name}'s {(team.members || []).length} member(s).
                      </div>
                    )}
                    <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1.5">Signing order</div>
                    <div className="space-y-1.5 mb-2">
                      {st.signers.map((uid2, gi) => {
                        const u = teamSigners(team).find(a => a.id === uid2);
                        return (
                          <div key={gi} className="flex items-center gap-2 px-2 py-1.5 rounded min-w-0" style={{ backgroundColor: "rgba(15,26,46,.05)" }}>
                            <span className="text-[9px] font-semibold shrink-0 px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: `${STEP_COLORS[si % STEP_COLORS.length]}22`, color: STEP_COLORS[si % STEP_COLORS.length] }}>{ord(gi + 1)}</span>
                            <span className="text-sm truncate min-w-0 flex-1" title={u?.name || ""}>{u?.name || "(removed)"}</span>
                            {u && !u.hasSignature && <span className="pill pill-rejected text-[9px] shrink-0">no signature</span>}
                            {st.signers.length > 1 && (
                              <span className="flex items-center shrink-0">
                                <button className="opacity-40 hover:opacity-100 disabled:opacity-15" title="Sign earlier" disabled={gi === 0}
                                  onClick={() => moveSigner(gi, gi - 1)}><ChevronUp size={12} /></button>
                                <button className="opacity-40 hover:opacity-100 disabled:opacity-15" title="Sign later" disabled={gi === st.signers.length - 1}
                                  onClick={() => moveSigner(gi, gi + 1)}><ChevronDown size={12} /></button>
                              </span>
                            )}
                            <button className="opacity-50 hover:opacity-100 shrink-0" onClick={() => patchStep(si, { signers: st.signers.filter((_, k) => k !== gi) })}><X size={10} /></button>
                          </div>
                        );
                      })}
                      {st.signers.length === 0 && <span className="text-xs opacity-50 italic">No signers yet</span>}
                    </div>
                    {pool.length > 0 ? (
                      <select value="" onChange={e => { if (e.target.value) patchStep(si, { signers: [...st.signers, e.target.value] }); }}
                        className="text-xs w-full min-w-0" style={{ maxWidth: 320 }}>
                        <option value="">+ Add signer{st.signers.length ? ` (signs ${ord(st.signers.length + 1)})` : ""}…</option>
                        {pool.map(a => <option key={a.id} value={a.id}>{a.name}{a.hasSignature ? "" : " (no signature yet)"}</option>)}
                      </select>
                    ) : <div className="text-[11px] opacity-50">Everyone in this team is already added.</div>}
                  </>
                )}
              </div>
            );
          })}
          <button className="btn-ghost w-full justify-center text-xs" onClick={() => setEditing(ed => ({ ...ed, steps: [...ed.steps, { teamId: "", signers: [] }] }))}><Plus size={11} /> Add step</button>
          <div className="flex justify-end gap-3">
            <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy}><Check size={14} /> {busy ? "Saving…" : "Save workflow"}</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- list ----
  return (
    <div>
      <BackHeader back={back} title="My Workflows" step={templates ? `${templates.length} saved` : "…"} />
      <p className="text-sm opacity-60 mt-3 max-w-2xl">
        Save a signing route once — the steps and the signers in order. To use it, attach a document and place each signer's boxes; everything else is already set.
      </p>
      <div className="flex justify-end mt-4 mb-4">
        <button className="btn-primary" onClick={startNew}><Plus size={14} /> New workflow</button>
      </div>
      {!templates ? <div className="card p-8 text-sm opacity-50 text-center">Loading…</div>
        : templates.length === 0 ? <Empty icon={GitBranch} text="No saved workflows yet — create your first, or save one while raising a request." />
        : (
          <div className="space-y-3">
            {templates.map(t => {
              const totalSigners = t.steps.reduce((n, s) => n + s.signers.length, 0);
              return (
                <div key={t.id} className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{t.name}</div>
                      <div className="text-xs opacity-60">{t.steps.length} step{t.steps.length === 1 ? "" : "s"} · {totalSigners} signer{totalSigners === 1 ? "" : "s"}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button className="btn-primary text-xs" disabled={!t.valid}
                        title={t.valid ? "Attach a document to this workflow" : "Contains removed or unauthorised entries — edit it first"}
                        onClick={() => onUse(t)}>
                        <FilePlus size={12} /> Use with a document
                      </button>
                      <button className="btn-ghost text-xs" onClick={() => startEdit(t)}><Pencil size={12} /> Edit</button>
                      <button className="btn-ghost text-xs" style={{ color: "var(--c-rust-deep)" }} onClick={() => remove(t)}><Trash2 size={12} /></button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    {t.steps.map((s, i) => (
                      <span key={i} className="inline-flex items-center gap-1">
                        {i > 0 && <ArrowRight size={10} className="opacity-40" />}
                        <span className="pill" style={{ backgroundColor: `${STEP_COLORS[i % STEP_COLORS.length]}1A`, color: STEP_COLORS[i % STEP_COLORS.length] }}>
                          {s.teamName}: {s.signers.map(g => g.name.split(" ")[0]).join(", ")}
                        </span>
                        {(!s.teamValid || s.signers.some(g => !g.valid)) && <span className="pill" style={{ backgroundColor: "rgba(155,44,44,.10)", color: "var(--c-rust-deep)" }}>needs attention</span>}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ============================================================
//   REQUESTOR VIEW
// ============================================================
function RequestorView(props) {
  const { user, requests } = props;
  const [tab, setTab] = useState("home");
  const [newType, setNewType] = useState(null); // pre-selected request type when opening NewRequest
  const [presetTpl, setPresetTpl] = useState(null); // saved workflow being used for a new request
  const my = requests.filter(r => r.requestorId === user.id && r.status !== "withdrawn");
  const pending = my.filter(r => r.status === "pending");
  // Two separate lists: requests I RAISED that are approved, and documents I was
  // asked to sign and signed (someone else's request).
  const iSigned = r => iSignedInWorkflow(r, user.id);
  const myApproved = my.filter(r => r.status === "approved");
  const mySigned = requests.filter(r => r.status === "approved" && r.requestorId !== user.id && iSigned(r));
  // Documents waiting on MY signature: workflow/direct steps where it's my turn,
  // plus — when an admin has appointed me an approver for a team — that team's
  // pending requests (authority, not role, confers the right to sign).
  const awaitingMySig = requests.filter(r => isMyTurn(r, user.id, user.signingAuthorityTeams));

  // Starting a new request asks, once and up front, whether the document is
  // confidential — a decision point rather than a checkbox that can be missed.
  // Skipped entirely when the server holds no key, so nobody is prompted for a
  // choice the backend cannot honour.
  const [askConfidential, setAskConfidential] = useState(false);
  const [newConfidential, setNewConfidential] = useState(false);
  const [confAvailable, setConfAvailable] = useState(false);
  useEffect(() => {
    api.authConfig().then(c => setConfAvailable(!!c.confidentialEnabled)).catch(() => setConfAvailable(false));
  }, []);
  const openNew = (type = null) => {
    setNewType(type);
    setNewConfidential(false);
    if (confAvailable) { setAskConfidential(true); return; }   // the form opens once they choose
    setTab("new");
  };
  const chooseConfidential = (yes) => {
    setNewConfidential(yes);
    setAskConfidential(false);
    setTab("new");
  };
  useBackHandler(tab !== "home", () => { setNewType(null); setPresetTpl(null); setTab("home"); });

  if (tab === "new") return <NewRequest {...props} defaultType={newType} presetWorkflow={presetTpl}
    defaultConfidential={newConfidential}
    onDone={() => { setNewType(null); setPresetTpl(null); setNewConfidential(false); setTab("home"); }} />;
  if (tab === "workflows") return <MyWorkflows {...props} back={() => setTab("home")}
    onUse={tpl => { setPresetTpl(tpl); setTab("new"); }} />;
  if (tab === "selfsign") return <SelfSignDoc user={user} notify={props.notify} back={() => setTab("home")} />;
  if (tab === "awaiting-sig") return <AwaitingSignatureList {...props} back={() => setTab("home")} items={awaitingMySig} />;
  if (tab === "pending") return <PendingList {...props} back={() => setTab("home")} items={pending.concat(my.filter(r => r.status === "approved_pending"))} />;
  if (tab === "approved") return <ApprovedList {...props} back={() => setTab("home")} items={myApproved} title="My approved requests" />;
  if (tab === "signed") return <ApprovedList {...props} back={() => setTab("home")} items={mySigned} title="My signed documents" />;
  if (tab === "rejected") return <RejectedList {...props} back={() => setTab("home")} items={my.filter(r => r.status === "rejected")} />;

  const inWindow = my.filter(r => r.status === "approved_pending").length;
  const rejectedCount = my.filter(r => r.status === "rejected").length;
  const tiles = [
    { key: "new", icon: FilePlus, title: "Make a new request", desc: "Upload a document, pick the type, place the signature boxes.", color: "var(--c-gold)" },
    { key: "workflows", icon: GitBranch, title: "My Workflows", desc: "Save your signing routes once — reuse with any document.", color: "var(--c-gold)" },
    { key: "selfsign", icon: PenTool, title: "Sign your documents", desc: "Upload a PDF or Excel file, add your signature, download it — no approvals.", color: "var(--c-gold)" },
    { key: "awaiting-sig", icon: Stamp, title: "Awaiting your signature", desc: "Requests sent directly to you to sign.", badge: awaitingMySig.length },
    { key: "pending", icon: Clock, title: "Pending requests", desc: "Track what's awaiting signature. Send reminders every 24 hours.", badge: pending.length + inWindow },
    { key: "approved", icon: CheckCircle, title: "My approved requests", desc: "Documents you raised that are signed and finalised.", badge: myApproved.length },
    { key: "signed", icon: PenTool, title: "My signed documents", desc: "Documents sent to you that you have signed.", badge: mySigned.length }
  ];

  return (
    <div>
      <Hero title={`Welcome back, ${greetName(user.name)}`}
        subtitle={awaitingMySig.length
          ? `${awaitingMySig.length} document${awaitingMySig.length === 1 ? "" : "s"} waiting for your signature.`
          : pending.length
            ? `${pending.length} of your request${pending.length === 1 ? " is" : "s are"} out for signature.`
            : "What would you like to do today?"} />

      <StatStrip stats={[
        { label: "Awaiting me", value: awaitingMySig.length, onClick: () => setTab("awaiting-sig"), color: "var(--c-gold)" },
        { label: "Pending", value: pending.length, onClick: () => setTab("pending") },
        { label: "In 1h window", value: inWindow, onClick: () => setTab("pending"), color: "#8B4A14" },
        { label: "Approved", value: myApproved.length, onClick: () => setTab("approved"), color: "var(--c-forest)" },
        { label: "Rejected", value: rejectedCount, onClick: () => setTab("rejected"), color: "var(--c-rust)" },
      ]} />

      {/* Action-first: documents waiting for MY signature come before everything */}
      {awaitingMySig.length > 0 && (
        <div className="mt-8">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="font-display text-2xl">Awaiting your signature</h3>
            {awaitingMySig.length > 3 && (
              <button className="text-xs tracking-wider uppercase opacity-60 hover:opacity-100 underline" onClick={() => setTab("awaiting-sig")}>
                See all {awaitingMySig.length}
              </button>
            )}
          </div>
          <div className="card overflow-hidden">
            {awaitingMySig.slice(0, 3).map((r, i) => (
              <RequestRow key={r.id} r={r} teams={props.teams} users={props.users} i={i}
                actions={<button className="btn-primary text-xs" onClick={() => setTab("awaiting-sig")}>Review &amp; sign <ArrowRight size={12} /></button>} />
            ))}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5 mt-8 sm:mt-10">
        {tiles.map(t => <Tile key={t.key} {...t} onClick={() => t.key === "new" ? openNew(null) : setTab(t.key)} />)}
      </div>
      {askConfidential && <ConfidentialPrompt onChoose={chooseConfidential} />}
      {rejectedCount > 0 && (
        <div className="mt-8">
          <button className="btn-ghost text-sm" onClick={() => setTab("rejected")}>
            View rejected requests ({rejectedCount})
          </button>
        </div>
      )}
      <RecentActivity my={my} teams={props.teams} />
    </div>
  );
}

// Compact glance-strip: one chip per status, tappable. Zero-value chips stay
// visible but muted so the layout is stable day to day.
function StatStrip({ stats }) {
  return (
    <div className="flex flex-wrap gap-2 sm:gap-3 mt-6">
      {stats.map((s, i) => (
        <button key={i} onClick={s.onClick}
          className="card px-3 sm:px-4 py-2 flex items-baseline gap-2 tile-hover"
          style={{ opacity: s.value ? 1 : 0.5 }}>
          <span className="font-display text-xl sm:text-2xl" style={{ color: s.value ? (s.color || "var(--c-ink)") : undefined }}>{s.value}</span>
          <span className="text-[10px] sm:text-xs tracking-wider uppercase opacity-60">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

function RecentActivity({ my, teams }) {
  const recent = [...my].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  if (recent.length === 0) return null;
  return (
    <div className="mt-14">
      <div className="flex items-baseline justify-between mb-5">
        <h3 className="font-display text-2xl">Recent activity</h3>
        <div className="text-xs tracking-wider uppercase opacity-50">Last 4 requests</div>
      </div>
      <div className="card overflow-hidden">
        {recent.map((r, i) => (
          <div key={r.id} className={`px-5 py-4 flex items-center gap-4 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "var(--c-ink-08)" }}>
            <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>
              {r.fileType === "pdf" ? <FileText size={14} /> : <FileSpreadsheet size={14} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{r.fileName}</div>
              <div className="text-xs opacity-60">{teams.find(t => t.id === r.targetTeamId)?.name} · {fmt(r.createdAt)}</div>
            </div>
            <StatusPill status={r.status} />
          </div>
        ))}
      </div>
    </div>
  );
}


// ============================================================
//   PENDING · APPROVED · REJECTED LISTS (Requestor)
// ============================================================
function PendingList({ items, teams, users, user, sendReminder, cancelRequest, back, notify, title = "Pending requests" }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <BackHeader back={back} title={title} step={`${items.length} total`} />
      {items.length === 0 ? <Empty icon={Inbox} text="Nothing pending. You're all caught up." /> : (
        <div className="card mt-8 overflow-hidden">
          {items.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={(
                <div className="flex flex-wrap gap-2">
                  <button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>
                  {r.status === "pending" && (
                    <button className="btn-gold text-xs" onClick={() => sendReminder(r.id)}>
                      <Bell size={12} /> Remind
                    </button>
                  )}
                  {/* Requestor can withdraw their own request while it's still pending. */}
                  {r.status === "pending" && cancelRequest && r.requestorId === user?.id && (
                    <button className="btn-ghost text-xs" style={{ color: "var(--c-rust-deep, #7A1F1F)" }} onClick={() => cancelRequest(r.id)}>
                      <Undo2 size={12} /> Withdraw
                    </button>
                  )}
                  {r.hasSignedFile && <DownloadBtn req={r} user={user} />}
                  {r.hasSignedFile && <PrintBtn req={r} />}
                </div>
              )} />
          ))}
        </div>
      )}
      {open && <PreviewDrawer user={user} req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
    </div>
  );
}

function ApprovedList({ items, teams, users, user, back, title = "Approved requests" }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <BackHeader back={back} title={title} step={`${items.length} signed`} />
      {items.length === 0 ? <Empty icon={Archive} text={`No ${title.replace(/^My /i, "").toLowerCase()} yet.`} /> : (
        <div className="card mt-8 overflow-hidden">
          {items.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={(
                <div className="flex flex-wrap gap-2">
                  <button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>
                  <DownloadBtn req={r} user={user} />
                  <PrintBtn req={r} />
                </div>
              )} />
          ))}
        </div>
      )}
      {open && <PreviewDrawer user={user} req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
    </div>
  );
}

function RejectedList({ items, teams, users, user, back }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <BackHeader back={back} title="Rejected requests" step={`${items.length} rejected`} />
      {items.length === 0 ? <Empty icon={FileX} text="No rejected requests." /> : (
        <div className="card mt-8 overflow-hidden">
          {items.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={(
                <div className="flex flex-wrap gap-2">
                  <button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>
                </div>
              )}
              subtitle={(r.rejectReason || r.hasRejectVoice) && (
                <>
                  {r.rejectReason && <div>Reason: {r.rejectReason}</div>}
                  {r.hasRejectVoice && <VoiceNote requestId={r.id} />}
                </>
              )} />
          ))}
        </div>
      )}
      {open && <PreviewDrawer user={user} req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
    </div>
  );
}



function buildWorkflowMarkers(req, teams, { highlightUserId } = {}) {
  // Date markers show the date that will be stamped in a signer's date field —
  // their actual signing date if already signed, otherwise today's date (a preview
  // of what lands there when they approve). isDate keeps them out of the signature
  // overlay in preview mode.
  const fmtD = (ts) => { const d = ts ? new Date(Number(ts)) : new Date(); const p = n => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`; };
  const dateMark = (d, key, ts) => ({ id: `date-${key}`, page: d.page || 1, x: d.x, y: d.y, w: d.w, h: d.h, color: "#C77D2E", label: fmtD(ts), isDate: true });

  if (!req.workflow || req.workflow.length === 0) {
    const out = [];
    // marker_json may hold one box (legacy) or an array (multi-sign approver)
    const markerList = Array.isArray(req.marker) ? req.marker : (req.marker ? [req.marker] : []);
    markerList.forEach((m, i) => out.push({
      ...m, id: `approver-${i}`, page: m.page || 1,
      label: markerList.length > 1 ? `SIGN HERE #${i + 1}` : "SIGN HERE"
    }));
    (req.signerDateFields || []).forEach((d, i) => out.push(dateMark(d, `s-${i}`, req.approvedAt)));
    return out;
  }
  const out = [];
  req.workflow.forEach((step, si) => {
    const team = teams.find(t => t.id === step.teamId);
    step.signers.forEach((s, gi) => {
      // A signer may have several signature boxes (multi-box). Hydration always
      // provides `boxes`; fall back to the single legacy marker just in case.
      const boxes = (s.boxes && s.boxes.length) ? s.boxes : [{ page: s.page || 1, x: s.x, y: s.y, w: s.w, h: s.h }];
      boxes.forEach((b, bi) => out.push({
        id: `${s.id || `s${si}-${gi}`}-b${bi}`,
        page: b.page || 1, x: b.x, y: b.y, w: b.w, h: b.h,
        color: STEP_COLORS[si % STEP_COLORS.length],
        label: `${step.order}.${s.order} ${s.userName}${boxes.length > 1 ? ` #${bi + 1}` : ""}${team ? ` · ${team.name}` : ""}${s.status === "signed" ? " ✓" : ""}`,
        highlight: highlightUserId && s.userId === highlightUserId && s.status === "pending"
      }));
      (s.dateFields || []).forEach((d, fi) => out.push(dateMark(d, `${si}-${gi}-${fi}`, s.status === "signed" ? s.signedAt : null)));
    });
  });
  return out;
}

function PreviewDrawer({ req, onClose, users, teams, user }) {
  const [file, setFile] = useState(null);
  const [leaveStyles, setLeaveStyles] = useState(null);
  // Confidential documents load only inside a live unlock window. `locked` puts
  // the code prompt up; `windowEndsAt` drives the countdown and re-locks at 0.
  const [locked, setLocked] = useState(!!req.confidential);
  const [windowEndsAt, setWindowEndsAt] = useState(null);
  useBackHandler(true, onClose);
  useEscapeKey(true, onClose);
  useEffect(() => {
    if (locked) { setFile(null); return; }
    let url = null;
    (async () => {
      try {
        const isPdf = req.fileType === "pdf";
        const kind = (req.hasSignedFile && isPdf) ? "signed" : "file";
        url = await api.getRequestFileBlob(req.id, kind);
        setFile({ name: req.fileName, base64: url, ext: req.fileType === "pdf" ? "pdf" : "xlsx" });
        if (req.requestType === "leave" && req.fileType !== "pdf") {
          fetch("/leave-template-styles.json").then(r => r.json()).then(setLeaveStyles).catch(() => {});
        }
      } catch (e) {
        // The window may have lapsed between unlocking and loading — ask again
        // rather than showing a blank drawer.
        if (e.needsUnlock) { setLocked(true); setWindowEndsAt(null); }
        else console.error(e);
      }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [req.id, req.hasSignedFile, locked]);

  // When the window lapses the document is pulled from view immediately — the
  // bytes are already in the browser, so this is about not leaving it on screen.
  const relock = useCallback(() => {
    setFile(null); setWindowEndsAt(null); setLocked(true);
  }, []);

  const markers = req.hasSignedFile ? [] : buildWorkflowMarkers(req, teams);

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end" style={{ backgroundColor: "rgba(15,26,46,.5)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-4xl overflow-auto anim-in" style={{ backgroundColor: "var(--c-cream)" }} onClick={e => e.stopPropagation()}>
        <div className="p-4 sm:p-6 flex items-center justify-between gap-2 border-b"
          style={{
            borderColor: "var(--c-ink-10)",
            paddingTop: "max(16px, env(safe-area-inset-top))"
          }}>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg sm:text-2xl truncate">{req.fileName}</div>
            <div className="text-[10px] sm:text-xs opacity-60 mt-0.5 sm:mt-1 truncate">
              {teams.find(t => t.id === req.targetTeamId)?.name} · from {users.find(u => u.id === req.requestorId)?.name || "—"} · {fmt(req.createdAt)}
            </div>
            {req.status === "approved" && req.finalizedAt && (
              <div className="text-[10px] sm:text-xs mt-0.5 font-medium" style={{ color: "var(--c-forest)" }}>
                Completed {fmt(req.finalizedAt)} IST
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-2 shrink-0">
            {req.confidential && <ConfidentialBadge />}
            {windowEndsAt && <UnlockCountdown endsAt={windowEndsAt} onExpire={relock} />}
            {/* Take the document away right here — the approved email deep-links
                into this drawer, so the download mustn't require backing out to
                hunt for the row in a list. The buttons carry their own rules
                (greyed inside the 1-hour window; confidential = requestor only,
                once fully signed, and only while unlocked). */}
            {!locked && <DownloadBtn req={req} user={user} />}
            {!locked && <PrintBtn req={req} />}
            <StatusPill status={req.status} />
            <button onClick={onClose} className="btn-ghost text-xs"><X size={14} /></button>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          {req.workflow?.length > 0 && <WorkflowSummary req={req} teams={teams} />}
          {locked ? (
            <div className="card p-8 text-center">
              <Lock size={20} className="mx-auto mb-2" style={{ color: "var(--c-gold)" }} />
              <div className="text-sm font-medium">This document is locked</div>
              <div className="text-xs opacity-60 mt-1">Enter the emailed code to view it for 2 minutes.</div>
            </div>
          ) : file ? (
            <Suspense fallback={<ViewerFallback />}>
              <DocPreview file={file} markers={markers} styleMap={leaveStyles} />
            </Suspense>
          ) : <div className="text-sm opacity-50">Loading file…</div>}
          {req.note && <div className="mt-4 card p-4 text-sm"><div className="text-xs tracking-wider uppercase opacity-50 mb-2">Requestor note</div>{req.note}</div>}
          {req.status === "rejected" && (req.rejectReason || req.hasRejectVoice) && (
            <div className="mt-4 card p-4 text-sm" style={{ borderLeft: "3px solid var(--c-rust)" }}>
              <div className="text-xs tracking-wider uppercase opacity-50 mb-2">Rejection</div>
              {req.rejectReason && <div>{req.rejectReason}</div>}
              {req.hasRejectVoice && <VoiceNote requestId={req.id} />}
            </div>
          )}
        </div>
      </div>
      {locked && (
        <UnlockModal requestId={req.id}
          onUnlocked={endsAt => { setWindowEndsAt(endsAt); setLocked(false); }}
          onCancel={onClose} />
      )}
    </div>
  );
}


// ============================================================
//   APPROVER VIEW
// ============================================================
function ApproverView(props) {
  const { user, requests, teams, users, notify, approveRequest, rejectRequest, undoApproval } = props;
  const [tab, setTab] = useState("home");
  const [newType, setNewType] = useState(null);
  const [presetTpl, setPresetTpl] = useState(null); // saved workflow being used for a new request
  // "Awaiting your approval" sits first on the home screen; this opens the
  // review drawer for an item directly from there.
  const [quickOpenId, setQuickOpenId] = useState(null);
  // Starting a new request asks, once and up front, whether the document is
  // confidential — a decision point rather than a checkbox that can be missed.
  // Skipped entirely when the server holds no key, so nobody is prompted for a
  // choice the backend cannot honour.
  const [askConfidential, setAskConfidential] = useState(false);
  const [newConfidential, setNewConfidential] = useState(false);
  const [confAvailable, setConfAvailable] = useState(false);
  useEffect(() => {
    api.authConfig().then(c => setConfAvailable(!!c.confidentialEnabled)).catch(() => setConfAvailable(false));
  }, []);
  const openNew = (type = null) => {
    setNewType(type);
    setNewConfidential(false);
    if (confAvailable) { setAskConfidential(true); return; }   // the form opens once they choose
    setTab("new");
  };
  const chooseConfidential = (yes) => {
    setNewConfidential(yes);
    setAskConfidential(false);
    setTab("new");
  };
  useBackHandler(tab !== "home", () => { setNewType(null); setPresetTpl(null); setTab("home"); });
  const isWorkflowSigner = r => (r.workflow || []).some(st => st.signers.some(s => s.userId === user.id));
  const iSigned = r => iSignedInWorkflow(r, user.id);
  // Requests routed to me to SIGN — never my own (I don't approve what I raised).
  const mine = requests.filter(r => {
    if (r.requestorId === user.id) return false;
    if (r.approverId === user.id) return true;
    if (isWorkflowSigner(r)) return true;
    if (r.status === "pending" && r.targetTeamId && (user.signingAuthorityTeams || []).includes(r.targetTeamId)) return true;
    return false;
  });
  // Requests I raised myself, to track.
  const myRequests = requests.filter(r => r.requestorId === user.id && r.status !== "withdrawn");
  const myOpen = myRequests.filter(r => r.status === "pending" || r.status === "approved_pending").length;
  // Only what I can act on NOW. Being on the route isn't enough — a request I've
  // already signed, or one sitting with an earlier signer, is not my pending work.
  const pending = mine.filter(r => isMyTurn(r, user.id, user.signingAuthorityTeams));
  // On the route, still open, but waiting on somebody else.
  const waitingOnOthers = mine.filter(r => r.status === "pending" && !isMyTurn(r, user.id, user.signingAuthorityTeams));
  const pendingApproved = mine.filter(r => r.status === "approved_pending" && (r.approverId === user.id || iSigned(r)));
  const approved = mine.filter(r => r.status === "approved" && (r.approverId === user.id || iSigned(r)));
  const rejected = mine.filter(r => r.status === "rejected" && (r.approverId === user.id || iSigned(r)));

  if (tab === "new") return <NewRequest {...props} defaultType={newType} presetWorkflow={presetTpl}
    defaultConfidential={newConfidential}
    onDone={() => { setNewType(null); setPresetTpl(null); setNewConfidential(false); setTab("home"); }} />;
  if (tab === "workflows") return <MyWorkflows {...props} back={() => setTab("home")}
    onUse={tpl => { setPresetTpl(tpl); setTab("new"); }} />;
  if (tab === "selfsign") return <SelfSignDoc user={user} notify={notify} back={() => setTab("home")} />;
  if (tab === "my-requests") return <PendingList {...props} back={() => setTab("home")} items={myRequests} title="My requests" />;
  if (tab === "pending") return <ApproverPending {...props} items={pending.concat(pendingApproved)} waiting={waitingOnOthers} back={() => setTab("home")} />;
  if (tab === "approved") return <ApproverApproved {...props} items={approved.concat(pendingApproved)} back={() => setTab("home")} />;
  if (tab === "rejected") return <ApproverRejected {...props} items={rejected} back={() => setTab("home")} />;
  if (tab === "authority") return <ApproverAuthority {...props} back={() => setTab("home")} />;

  const tiles = [
    { key: "pending", icon: Stamp, title: "Pending approvals", desc: "Review and sign documents requiring your authority.", badge: pending.length + pendingApproved.length, color: "var(--c-gold)" },
    { key: "new", icon: FilePlus, title: "Make a new request", desc: "Upload a document, pick the type, place the signature boxes.", color: "var(--c-gold)" },
    { key: "workflows", icon: GitBranch, title: "My Workflows", desc: "Save your signing routes once — reuse with any document.", color: "var(--c-gold)" },
    { key: "selfsign", icon: PenTool, title: "Sign your documents", desc: "Upload a PDF or Excel file, add your signature, download it — no approvals.", color: "var(--c-gold)" },
    { key: "approved", icon: CheckCircle, title: "Approved requests", desc: "Documents you have signed and finalised.", badge: approved.length + pendingApproved.length },
    { key: "rejected", icon: XCircle, title: "Rejected requests", desc: "Documents you have rejected.", badge: rejected.length },
    { key: "my-requests", icon: FileText, title: "My requests", desc: "Documents you've raised for signature — track their progress.", badge: myOpen },
    { key: "authority", icon: Shield, title: "Signing authority", desc: "Teams that have granted you authority to approve.", badge: (user.signingAuthorityTeams || []).length }
  ];
  const quickOpen = pending.concat(pendingApproved).find(r => r.id === quickOpenId);
  return (
    <div>
      <Hero title={`Good day, ${greetName(user.name)}`}
        subtitle={pending.length
          ? `${pending.length} document${pending.length === 1 ? "" : "s"} awaiting your approval.`
          : "Review documents routed to you — or raise a request of your own."} />

      <StatStrip stats={[
        { label: "Awaiting me", value: pending.length, onClick: () => setTab("pending"), color: "var(--c-gold)" },
        { label: "In 1h window", value: pendingApproved.length, onClick: () => setTab("pending"), color: "#8B4A14" },
        { label: "Approved", value: approved.length, onClick: () => setTab("approved"), color: "var(--c-forest)" },
        { label: "Rejected", value: rejected.length, onClick: () => setTab("rejected"), color: "var(--c-rust)" },
        { label: "My requests", value: myOpen, onClick: () => setTab("my-requests") },
      ]} />

      {/* Awaiting your approval — FIRST, so what needs action is never buried */}
      <div className="mt-8">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-display text-2xl">Awaiting your approval</h3>
          {pending.length > 0 && (
            <button className="text-xs tracking-wider uppercase opacity-60 hover:opacity-100 underline" onClick={() => setTab("pending")}>
              See all {pending.length + pendingApproved.length}
            </button>
          )}
        </div>
        {pending.length === 0 ? (
          <div className="card p-5 text-sm opacity-50 flex items-center gap-2"><CheckCircle size={15} /> Nothing waiting — you're all caught up.</div>
        ) : (
          <div className="card overflow-hidden">
            {pending.slice(0, 5).map((r, i) => (
              <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
                actions={<button className="btn-primary text-xs" onClick={() => setQuickOpenId(r.id)}>Review &amp; sign <ArrowRight size={12} /></button>} />
            ))}
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mt-8 sm:mt-10">
        {tiles.map(t => <Tile key={t.key} {...t} onClick={() => t.key === "new" ? openNew(null) : setTab(t.key)} />)}
      </div>
      {askConfidential && <ConfidentialPrompt onChoose={chooseConfidential} />}

      {quickOpen && <ApproveDrawer req={quickOpen} user={user} users={users} teams={teams}
        approveRequest={approveRequest} rejectRequest={rejectRequest} undoApproval={undoApproval}
        onClose={() => setQuickOpenId(null)} notify={notify} />}
    </div>
  );
}

// Requestor-facing list of direct requests waiting for THIS user's signature.
// Reuses the role-agnostic ApproveDrawer for the actual review + sign.
function AwaitingSignatureList({ items, user, users, teams, approveRequest, rejectRequest, undoApproval, back, notify }) {
  const [openId, setOpenId] = useState(null);
  const open = items.find(r => r.id === openId);
  return (
    <div>
      <BackHeader back={back} title="Awaiting your signature" step={`${items.length} to sign`} />
      {items.length === 0 ? (
        <Empty icon={Inbox} text="No requests are waiting for your signature." />
      ) : (
        <div className="card mt-4 overflow-hidden">
          {items.map((r, i) => (
            <div key={r.id} className={`flex items-center ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "var(--c-ink-08)" }}>
              <div className="flex-1 min-w-0">
                <RequestRow r={r} teams={teams} users={users} i={0}
                  actions={<button className="btn-primary text-xs" onClick={() => setOpenId(r.id)}>Review &amp; sign <ArrowRight size={12} /></button>} />
              </div>
            </div>
          ))}
        </div>
      )}
      {open && <ApproveDrawer req={open} user={user} users={users} teams={teams}
        approveRequest={approveRequest} rejectRequest={rejectRequest} undoApproval={undoApproval}
        onClose={() => setOpenId(null)} notify={notify} />}
    </div>
  );
}

function ApproverPending({ items, waiting = [], user, users, teams, approveRequest, rejectRequest, undoApproval, refresh, back, notify }) {
  const [openId, setOpenId] = useState(null);
  const [filterType, setFilterType] = useState("all");
  const [selected, setSelected] = useState(() => new Set());
  const [batching, setBatching] = useState(false);

  // Only rows where I'm the next signer are batch-approvable; approved_pending
  // rows (already signed, inside the 1-hour window) are excluded.
  const myTurn = (r) => isMyTurn(r, user.id, user.signingAuthorityTeams);

  const visible = items.filter(r => filterType === "all" || (r.requestType || "general") === filterType);
  const selectable = visible.filter(myTurn);
  const allSelected = selectable.length > 0 && selectable.every(r => selected.has(r.id));

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectable.map(r => r.id)));
  };

  const open = items.find(r => r.id === openId);

  const doBatchApprove = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBatching(true);
    try {
      const { approved = [], failed = [] } = await api.batchApproveRequests(ids);
      if (approved.length > 0) notify(`Approved ${approved.length} request${approved.length === 1 ? "" : "s"}`, "success");
      if (failed.length > 0) notify(`${failed.length} failed: ${failed.map(f => f.error).join(", ")}`, "error");
      setSelected(new Set());
      await refresh?.();
    } catch (e) {
      notify(e.message || "Batch approve failed", "error");
    } finally {
      setBatching(false);
    }
  };

  // Type counts for the filter chips
  const typeCounts = REQUEST_TYPES.reduce((acc, t) => {
    acc[t.key] = items.filter(r => (r.requestType || "general") === t.key).length;
    return acc;
  }, {});

  return (
    <div>
      <BackHeader back={back} title="Pending approvals" step={`${items.length} awaiting`} />

      {/* Type filter + batch action bar */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mt-6 mb-4">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFilterType("all")}
              className={`px-3 py-1.5 rounded-md text-xs tracking-wider uppercase ${filterType === "all" ? "" : "opacity-50"}`}
              style={{ backgroundColor: filterType === "all" ? "#0F1A2E" : "transparent", color: filterType === "all" ? "#F5F1E8" : "#0F1A2E", border: "1px solid rgba(15,26,46,.18)" }}>
              All · {items.length}
            </button>
            {REQUEST_TYPES.filter(t => typeCounts[t.key] > 0).map(t => (
              <button key={t.key} onClick={() => setFilterType(t.key)}
                className={`px-3 py-1.5 rounded-md text-xs tracking-wider uppercase ${filterType === t.key ? "" : "opacity-50"}`}
                style={{ backgroundColor: filterType === t.key ? t.color : "transparent", color: filterType === t.key ? "#F5F1E8" : "#0F1A2E", border: `1px solid ${t.color}66` }}>
                {t.label} · {typeCounts[t.key]}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {selectable.length > 0 && (
            <>
              <button onClick={toggleAll} className="btn-ghost text-xs">
                {allSelected ? "Deselect all" : `Select all (${selectable.length})`}
              </button>
              <button onClick={doBatchApprove} disabled={selected.size === 0 || batching} className="btn-primary text-xs">
                <CheckCircle size={13} /> {batching ? "Approving…" : `Approve selected (${selected.size})`}
              </button>
            </>
          )}
        </div>
      )}

      {visible.length === 0 ? <Empty icon={Inbox} text={items.length === 0 ? "Nothing awaiting your approval." : "No requests of this type."} /> : (
        <div className="card mt-2 overflow-hidden">
          {visible.map((r, i) => {
            const mine = myTurn(r);
            return (
              <div key={r.id} className={`flex items-center ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "var(--c-ink-08)" }}>
                {mine && (
                  <label className="pl-5 pr-2 cursor-pointer flex items-center" title="Select for batch approval">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </label>
                )}
                {!mine && <div className="pl-5 pr-2 opacity-30 text-xs">—</div>}
                <div className="flex-1 min-w-0">
                  <RequestRow r={r} teams={teams} users={users} i={0}
                    actions={r.status === "approved_pending" && r.approverId === user.id
                      ? <button className="btn-danger text-xs" onClick={() => setOpenId(r.id)} title="Still inside your 1-hour window"><XCircle size={12} /> Reject / Withdraw</button>
                      : <button className="btn-primary text-xs" onClick={() => setOpenId(r.id)}>Review <ArrowRight size={12} /></button>} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Documents I've already signed that have moved on to the next signer.
          Kept visible so signing isn't a dead end — but out of the count above,
          since none of it is mine to act on. */}
      {waiting.length > 0 && (
        <div className="mt-8">
          <div className="text-xs tracking-widest uppercase opacity-50 mb-2">
            Signed by you · waiting on others ({waiting.length})
          </div>
          <div className="card overflow-hidden" style={{ opacity: 0.75 }}>
            {waiting.map((r, i) => (
              <div key={r.id} className={i > 0 ? "border-t" : ""} style={{ borderColor: "var(--c-ink-08)" }}>
                <RequestRow r={r} teams={teams} users={users} i={0} />
              </div>
            ))}
          </div>
        </div>
      )}

      {open && <ApproveDrawer req={open} user={user} users={users} teams={teams}
        approveRequest={approveRequest} rejectRequest={rejectRequest} undoApproval={undoApproval}
        onClose={() => setOpenId(null)} notify={notify} />}
    </div>
  );
}

// Record a short voice note with the device microphone (MediaRecorder). The
// browser picks a supported container (webm on desktop/Android, mp4 on iOS).
// mm:ss for short recordings.
const fmtClock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// <audio> that self-heals bogus durations. MediaRecorder's WebM has no duration
// metadata, so browsers show garbage (a 3s note reading as 14min). New notes are
// patched at record time; this covers notes saved before the fix: when the
// reported duration is Infinity/absurd, seeking to a huge time forces the
// browser to resolve the real one.
function FixedAudio({ src, style, className }) {
  const ref = useRef(null);
  const fixedRef = useRef(false);
  useEffect(() => { fixedRef.current = false; }, [src]);
  return (
    <audio ref={ref} controls src={src} style={style} className={className}
      onClick={e => e.stopPropagation()}
      onLoadedMetadata={() => {
        const a = ref.current;
        if (!a || fixedRef.current) return;
        if (!isFinite(a.duration) || a.duration > 6 * 3600) {
          fixedRef.current = true;
          const onTU = () => { a.removeEventListener("timeupdate", onTU); a.currentTime = 0; };
          a.addEventListener("timeupdate", onTU);
          a.currentTime = 1e7;
        }
      }} />
  );
}

function VoiceRecorder({ value, onChange }) {
  const [recording, setRecording] = useState(false);
  const [err, setErr] = useState(null);
  const [url, setUrl] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [durationMs, setDurationMs] = useState(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); if (tickRef.current) clearInterval(tickRef.current); }, [url]);

  const start = async () => {
    setErr(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setErr("Voice recording isn't supported in this browser."); return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(m => MediaRecorder.isTypeSupported(m)) || "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const durMs = Date.now() - startedAtRef.current;
        let blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        stream.getTracks().forEach(t => t.stop());
        // Embed the real duration into the WebM header — without it, players
        // show nonsense lengths for MediaRecorder output.
        if ((blob.type || "").includes("webm")) {
          try {
            const { default: fixWebmDuration } = await import("fix-webm-duration");
            blob = await new Promise(res => { try { fixWebmDuration(blob, durMs, b => res(b || blob)); } catch { res(blob); } });
          } catch { /* patching is best-effort — the FixedAudio fallback still covers playback */ }
        }
        setDurationMs(durMs);
        onChange(blob);
        setUrl(u => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(blob); });
      };
      recRef.current = rec;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 500);
      rec.start();
      setRecording(true);
    } catch {
      setErr("Microphone unavailable — allow microphone access and try again.");
    }
  };
  const stop = () => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setRecording(false);
  };
  const clear = () => { onChange(null); setDurationMs(null); setUrl(u => { if (u) URL.revokeObjectURL(u); return null; }); };

  return (
    <div className="mb-4">
      <div className="text-xs tracking-wider uppercase opacity-50 mb-2">Voice note (optional)</div>
      {!value && !recording && (
        <button type="button" className="btn-ghost text-xs" onClick={start}>
          <Mic size={13} /> Record a voice note
        </button>
      )}
      {recording && (
        <button type="button" className="btn-danger text-xs" onClick={stop}>
          <Square size={12} /> Stop recording · <span className="font-mono">{fmtClock(elapsedMs)}</span>
          <span className="inline-block w-2 h-2 rounded-full ml-1 anim-pulse" style={{ backgroundColor: "#fff" }} />
        </button>
      )}
      {value && url && !recording && (
        <div className="flex items-center gap-2 flex-wrap">
          <FixedAudio src={url} style={{ height: 32, maxWidth: 230 }} />
          {durationMs != null && <span className="text-xs font-mono opacity-60">{fmtClock(durationMs)}</span>}
          <button type="button" className="text-xs underline opacity-60 hover:opacity-100" onClick={clear}>Remove</button>
          <button type="button" className="text-xs underline opacity-60 hover:opacity-100" onClick={() => { clear(); start(); }}>Re-record</button>
        </div>
      )}
      {err && <div className="text-xs mt-1" style={{ color: "var(--c-rust-deep)" }}>{err}</div>}
    </div>
  );
}

// Plays a rejection's recorded voice note (fetched with auth → blob URL).
function VoiceNote({ requestId }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u = null, dead = false;
    api.getRejectVoiceBlob(requestId)
      .then(x => { if (dead) { URL.revokeObjectURL(x); return; } u = x; setUrl(x); })
      .catch(() => {});
    return () => { dead = true; if (u) URL.revokeObjectURL(u); };
  }, [requestId]);
  if (!url) return null;
  return <FixedAudio src={url} style={{ height: 30, maxWidth: 240 }} className="mt-1" />;
}

function ApproveDrawer({ req, user, users, teams, approveRequest, rejectRequest, undoApproval, onClose, notify }) {
  const [file, setFile] = useState(null);
  const [leaveStyles, setLeaveStyles] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [voiceBlob, setVoiceBlob] = useState(null);
  const [rejBusy, setRejBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sigUrl, setSigUrl] = useState(null);
  const bodyRef = useRef(null);
  // Confidential documents need a live unlock window before they can be read —
  // and the server refuses to APPROVE without one too, so the gate has to be
  // cleared before the approve buttons can do anything.
  const [locked, setLocked] = useState(!!req.confidential);
  const [windowEndsAt, setWindowEndsAt] = useState(null);
  useBackHandler(true, onClose);
  useEscapeKey(true, onClose);
  useEffect(() => {
    if (locked) { setFile(null); return; }
    let url = null;
    (async () => {
      try {
        const isPdf = req.fileType === "pdf";
        const kind = (req.hasSignedFile && isPdf) ? "signed" : "file";
        url = await api.getRequestFileBlob(req.id, kind);
        setFile({ name: req.fileName, base64: url, ext: req.fileType === "pdf" ? "pdf" : "xlsx" });
        if (req.requestType === "leave" && req.fileType !== "pdf") {
          fetch("/leave-template-styles.json").then(r => r.json()).then(setLeaveStyles).catch(() => {});
        }
      } catch (e) {
        if (e.needsUnlock) { setLocked(true); setWindowEndsAt(null); }
        else console.error(e);
      }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [req.id, req.hasSignedFile, locked]);

  const relock = useCallback(() => { setFile(null); setWindowEndsAt(null); setLocked(true); }, []);

  // ---- which of my signatures to stamp ----
  // The default (or only) one is pre-selected; a picker appears only when the
  // signer actually has a choice to make.
  const [mySigs, setMySigs] = useState([]);
  const [sigId, setSigId] = useState(null);
  const [sigThumbs, setSigThumbs] = useState({});
  useEffect(() => {
    let dead = false;
    const urls = [];
    (async () => {
      try {
        const list = await api.mySignatures();
        if (dead) return;
        setMySigs(list);
        setSigId((list.find(s => s.isDefault) || list[0])?.id || null);
        const t = {};
        for (const s of list) {
          const u = await api.mySignatureBlob(s.id);
          if (u) { t[s.id] = u; urls.push(u); }
        }
        if (!dead) setSigThumbs(t);
      } catch { /* picker simply stays hidden */ }
    })();
    return () => { dead = true; urls.forEach(u => URL.revokeObjectURL(u)); };
  }, []);

  const pendingApproved = req.status === "approved_pending";

  // Workflow context
  const isWorkflow = (req.workflow?.length || 0) > 0;
  let mySlot = null;
  let nextPendingUser = null;
  if (isWorkflow) {
    nextPendingUser = nextPendingSigner(req);
    if (nextPendingUser?.userId === user.id) mySlot = nextPendingUser;
  }
  const canApprove = req.status === "pending" && (!isWorkflow || !!mySlot);

  const enterPreview = async () => {
    try {
      // Preview with the CHOSEN signature, not blindly the default.
      const url = (sigId && await api.mySignatureBlob(sigId)) || await api.getSignatureBlob(user.id);
      if (!url) { notify("Could not load your signature", "error"); return; }
      setSigUrl(url);
      setPreviewing(true);
    } catch { notify("Failed to load signature preview", "error"); }
  };

  // Switching signatures while previewing swaps the stamped image live.
  const pickSignature = async (id) => {
    setSigId(id);
    if (previewing) {
      const url = await api.mySignatureBlob(id);
      if (url) setSigUrl(url);
    }
  };

  // Markers: highlight my slot, hide already-applied ones (the signed PDF preview shows them in-place).
  // In preview mode, overlay the approver's signature image at the marked position.
  const baseMarkers = req.hasSignedFile ? [] : buildWorkflowMarkers(req, teams, { highlightUserId: user.id });
  const markers = (previewing && sigUrl)
    ? baseMarkers.map(m => (!m.isDate && (isWorkflow ? m.highlight : true)) ? { ...m, signedDataUrl: sigUrl } : m)
    : baseMarkers;

  const jumpToSig = () => {
    // If the page containing the signature is already rendered, scroll to the
    // highlighted marker itself. Otherwise (lazy viewer hasn't mounted that
    // page's canvas yet — common in long PDFs) scroll to the page's placeholder
    // by its data-page-num attribute. Once it's in view, the IntersectionObserver
    // in the viewer will mount the real PdfPage and the marker will appear.
    const el = bodyRef.current?.querySelector("[data-sig-jump]");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Find which page the highlighted (or first) marker lives on
    const target = markers.find(m => m.highlight) || markers[0];
    const pageNum = target?.page;
    if (pageNum != null) {
      const pageEl = bodyRef.current?.querySelector(`[data-page-num="${pageNum}"]`);
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
        // After the page renders, try to centre on the marker
        setTimeout(() => {
          const m = bodyRef.current?.querySelector("[data-sig-jump]");
          if (m) m.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 800);
        return;
      }
    }
    // Last resort: scroll to the bottom of the viewer
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end" style={{ backgroundColor: "rgba(15,26,46,.5)" }} onClick={onClose}>
      <div className="w-full max-w-4xl flex flex-col anim-in" style={{ backgroundColor: "var(--c-cream)" }} onClick={e => e.stopPropagation()}>

        {/* ── Fixed header with Jump-to-Signature ── */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-2 sm:gap-3 border-b shrink-0"
          style={{
            borderColor: "var(--c-ink-10)",
            paddingTop: "max(12px, env(safe-area-inset-top))"
          }}>
          <div className="min-w-0 flex-1">
            <div className="font-display text-base sm:text-xl truncate">{req.fileName}</div>
            <div className="text-[10px] sm:text-xs opacity-60 mt-0.5 truncate">
              {teams.find(t => t.id === req.targetTeamId)?.name} · from {users.find(u => u.id === req.requestorId)?.name || "—"} · {fmt(req.createdAt)}
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {req.confidential && <ConfidentialBadge />}
            {windowEndsAt && <UnlockCountdown endsAt={windowEndsAt} onExpire={relock} />}
            {canApprove && !locked && markers.length > 0 && (
              <button onClick={jumpToSig} className="btn-primary text-xs px-2 sm:px-3" title="Jump to signature zone"
                style={{ backgroundColor: "#B8894A" }}>
                <ChevronDown size={13} /> <span className="hidden sm:inline">Go to signature</span>
              </button>
            )}
            <StatusPill status={req.status} />
            <button onClick={onClose} className="btn-ghost text-xs"><X size={14} /></button>
          </div>
        </div>

        {/* ── Single scrollable body ── */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto p-4 sm:p-6">
          {isWorkflow && <WorkflowSummary req={req} teams={teams} />}
          {locked ? (
            <div className="card p-8 text-center">
              <Lock size={20} className="mx-auto mb-2" style={{ color: "var(--c-gold)" }} />
              <div className="text-sm font-medium">This document is locked</div>
              <div className="text-xs opacity-60 mt-1">Enter the emailed code to view and sign it.</div>
            </div>
          ) : file ? (
            <Suspense fallback={<ViewerFallback />}>
              <DocPreview file={file} markers={markers} styleMap={leaveStyles} fill />
            </Suspense>
          ) : <div className="text-sm opacity-50">Loading…</div>}
          {req.note && <div className="mt-4 card p-4 text-sm"><div className="text-xs tracking-wider uppercase opacity-50 mb-2">Requestor note</div>{req.note}</div>}
        </div>

        {/* ── Pinned action bar(s) ── */}
        {canApprove && !locked && (
          <div className="shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-t flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3"
            style={{
              borderColor: "var(--c-ink-10)",
              backgroundColor: "var(--c-cream)",
              paddingBottom: "max(12px, env(safe-area-inset-bottom))"
            }}>
            {previewing ? (
              <>
                <div className="flex flex-col gap-2 min-w-0">
                  <div className="flex items-center gap-2 text-xs" style={{ color: "var(--c-forest)" }}>
                    <Eye size={13} />
                    <span className="hidden sm:inline">How should this be approved?</span>
                    <span className="sm:hidden">Choose how to approve</span>
                  </div>
                  {/* Pick WHICH signature to stamp — shown only when there is an
                      actual choice; a single signature is auto-selected. */}
                  {mySigs.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] tracking-wider uppercase opacity-50">Sign with</span>
                      {mySigs.map(s => (
                        <button key={s.id} type="button" onClick={() => pickSignature(s.id)}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs"
                          title={s.isDefault ? `${s.label} (default)` : s.label}
                          style={{
                            border: sigId === s.id ? "2px solid var(--c-gold)" : "2px solid rgba(15,26,46,.15)",
                            backgroundColor: sigId === s.id ? "rgba(184,137,74,.10)" : "transparent",
                          }}>
                          {sigThumbs[s.id] && <img src={sigThumbs[s.id]} alt="" style={{ height: 20, maxWidth: 56, objectFit: "contain" }} />}
                          <span className="font-medium">{s.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 sm:gap-3 shrink-0 justify-end">
                  <button className="btn-ghost" onClick={() => setPreviewing(false)}><ArrowLeft size={14} /> <span className="hidden sm:inline">Go </span>back</button>
                  <button className="btn-primary" onClick={async () => { await approveRequest(req.id, true, sigId); onClose(); }}
                    title="Sign and finalise the document immediately">
                    <Zap size={14} /> Instant Approval
                  </button>
                  <button className="btn-primary" style={{ backgroundColor: "var(--c-forest)" }}
                    onClick={async () => { await approveRequest(req.id, false, sigId); onClose(); }}
                    title="Sign now — you keep 1 hour to withdraw or reject before it finalises">
                    <Clock size={14} /> Enable 1hr Rejection Window
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs opacity-60 hidden sm:block">
                  {isWorkflow
                    ? "Your signature will be stamped at the highlighted position."
                    : "Your signature will be stamped at the marked position."}
                </div>
                <div className="flex gap-2 sm:gap-3 shrink-0 justify-end">
                  <button className="btn-danger" onClick={() => setRejectOpen(true)}><XCircle size={14} /> Reject</button>
                  <button className="btn-primary" onClick={enterPreview}><Eye size={14} /> <span className="hidden sm:inline">Preview & </span>approve</button>
                </div>
              </>
            )}
          </div>
        )}
        {req.status === "pending" && isWorkflow && !mySlot && nextPendingUser && (
          <div className="shrink-0 px-6 py-4 border-t text-xs opacity-70 flex items-center gap-2"
            style={{ borderColor: "var(--c-ink-10)", backgroundColor: "var(--c-cream)" }}>
            <Clock size={12} /> Awaiting signature from <span className="font-medium">{nextPendingUser.userName}</span> before it reaches you.
          </div>
        )}
        {pendingApproved && req.approverId === user.id && !req.instantApproval && (
          <div className="shrink-0 px-6 py-4 border-t flex items-center justify-between gap-3" style={{ borderColor: "var(--c-ink-10)", backgroundColor: "var(--c-cream)" }}>
            <div className="text-xs opacity-70 flex items-center gap-2">
              <Clock size={12} /> You have until <span className="font-mono"><Countdown until={req.approvedAt + APPROVAL_WINDOW_MS} /></span> to change your mind.
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={async () => { await undoApproval(req.id); onClose(); }} title="Silently undo your approval">
                <Undo2 size={14} /> Withdraw
              </button>
              <button className="btn-danger" onClick={() => setRejectOpen(true)} title="Reject with a reason — requestor is notified by email">
                <XCircle size={14} /> Reject with reason
              </button>
            </div>
          </div>
        )}
      </div>

      {rejectOpen && (
        // stopPropagation is load-bearing: this modal lives inside the drawer's
        // click-outside-to-close root, so without it every tap on the textarea
        // bubbled up and closed the whole drawer (the "comments not working" bug).
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(15,26,46,.6)" }}
          onClick={e => e.stopPropagation()}>
          <div className="card p-6 max-w-md w-full m-4" style={{ backgroundColor: "var(--c-cream)" }} onClick={e => e.stopPropagation()}>
            <div className="font-display text-2xl mb-2">Reject request</div>
            <div className="text-sm opacity-60 mb-4">Let the requestor know why — type it, record it, or both.</div>
            <textarea rows={4} value={reason} onChange={e => setReason(e.target.value)} className="w-full mb-4" placeholder="Reason (optional)" autoFocus />
            <VoiceRecorder value={voiceBlob} onChange={setVoiceBlob} />
            <div className="flex justify-end gap-3">
              <button className="btn-ghost" onClick={() => setRejectOpen(false)} disabled={rejBusy}>Cancel</button>
              <button className="btn-danger" disabled={rejBusy}
                onClick={async () => {
                  setRejBusy(true);
                  try { await rejectRequest(req.id, reason, voiceBlob); setRejectOpen(false); onClose(); }
                  finally { setRejBusy(false); }
                }}>
                {rejBusy ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
      {locked && (
        <UnlockModal requestId={req.id}
          onUnlocked={endsAt => { setWindowEndsAt(endsAt); setLocked(false); }}
          onCancel={onClose} />
      )}
    </div>
  );
}

function ApproverApproved({ items, back, users, teams, user, approveRequest, rejectRequest, undoApproval, notify }) {
  const [open, setOpen] = useState(null);
  // Items still inside MY 1-hour rejection window open the action drawer (with
  // Reject / Withdraw) — not the read-only preview — so the option is never lost.
  const [actId, setActId] = useState(null);
  const act = items.find(r => r.id === actId);
  const inMyWindow = r => r.status === "approved_pending" && r.approverId === user.id && !r.instantApproval;
  return (
    <div>
      <BackHeader back={back} title="Approved requests" step={`${items.length} signed`} />
      {items.length === 0 ? <Empty icon={Archive} text="No approved requests yet." /> : (
        <div className="card mt-8 overflow-hidden">
          {items.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={(
                <div className="flex flex-wrap gap-2">
                  {inMyWindow(r) ? (
                    <button className="btn-danger text-xs" onClick={() => setActId(r.id)}
                      title="Still inside your 1-hour window — reject or withdraw">
                      <XCircle size={12} /> Reject / Withdraw
                    </button>
                  ) : (
                    <button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>
                  )}
                  <DownloadBtn req={r} user={user} />
                  <PrintBtn req={r} />
                </div>
              )} />
          ))}
        </div>
      )}
      {open && <PreviewDrawer user={user} req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
      {act && <ApproveDrawer req={act} user={user} users={users} teams={teams}
        approveRequest={approveRequest} rejectRequest={rejectRequest} undoApproval={undoApproval}
        onClose={() => setActId(null)} notify={notify} />}
    </div>
  );
}

function ApproverRejected({ items, back, users, teams, user }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <BackHeader back={back} title="Rejected requests" step={`${items.length} rejected`} />
      {items.length === 0 ? <Empty icon={FileX} text="No rejected requests." /> : (
        <div className="card mt-8 overflow-hidden">
          {items.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={<button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>}
              subtitle={(r.rejectReason || r.hasRejectVoice) && (
                <>
                  {r.rejectReason && <div>Reason: {r.rejectReason}</div>}
                  {r.hasRejectVoice && <VoiceNote requestId={r.id} />}
                </>
              )} />
          ))}
        </div>
      )}
      {open && <PreviewDrawer user={user} req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
    </div>
  );
}

function ApproverAuthority({ user, teams, back, users, requests }) {
  const myTeams = (user.signingAuthorityTeams || []).map(id => teams.find(t => t.id === id)).filter(Boolean);
  return (
    <div>
      <BackHeader back={back} title="Signing authority" step={`${myTeams.length} team${myTeams.length === 1 ? "" : "s"}`} />
      <p className="text-sm opacity-60 max-w-2xl mt-3">These are the teams that have granted you authority to approve their documents. If you need additional authority, speak with the administrator.</p>
      <div className="grid md:grid-cols-2 gap-5 mt-8">
        {myTeams.map(t => {
          const n = requests.filter(r => r.targetTeamId === t.id && r.approverId === user.id).length;
          return (
            <div key={t.id} className="card p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="w-10 h-10 rounded-md flex items-center justify-center mb-4 ink-grad"><Building2 size={18} color="#F5F1E8" /></div>
                  <div className="font-display text-2xl">{t.name}</div>
                  <div className="text-xs opacity-60 mt-2">You have approved <span className="font-medium">{n}</span> request{n === 1 ? "" : "s"} for this team.</div>
                </div>
                <Shield size={16} className="opacity-40" />
              </div>
            </div>
          );
        })}
      </div>
      {myTeams.length === 0 && <Empty icon={Shield} text="No signing authority granted yet." />}
    </div>
  );
}

// ============================================================
//   ADMIN VIEW
// ============================================================
function AdminView(props) {
  const [tab, setTab] = useState("home");
  const [docsTeamId, setDocsTeamId] = useState(null); // when set, opens AdminDocuments pre-filtered to this team
  const [dupCount, setDupCount] = useState(null); // count of likely-duplicate accounts, for the tile badge
  useEffect(() => { api.listDuplicateUsers().then(p => setDupCount(p.length)).catch(() => {}); }, []);
  useBackHandler(tab !== "home", () => { setDocsTeamId(null); setTab("home"); });
  if (tab === "onboard") return <OnboardTeam {...props} back={() => setTab("home")} />;
  if (tab === "users") return <AdminUsers {...props} back={() => setTab("home")} />;
  if (tab === "teams") return <AdminTeams {...props}
    onViewDocuments={(teamId) => { setDocsTeamId(teamId); setTab("documents"); }}
    back={() => setTab("home")} />;
  if (tab === "signatures") return <AdminSignatures {...props} back={() => setTab("home")} />;
  if (tab === "documents") return <AdminDocuments {...props}
    defaultTeamId={docsTeamId || "all"}
    back={() => { setDocsTeamId(null); setTab("home"); }} />;
  if (tab === "reports") return <AdminReports {...props} back={() => setTab("home")} />;
  if (tab === "emails") return <AdminEmails {...props} back={() => setTab("home")} />;
  if (tab === "registrations") return <AdminRegistrations {...props} back={() => setTab("home")} />;
  if (tab === "password-resets") return <AdminPasswordResets {...props} back={() => setTab("home")} />;
  if (tab === "duplicates") return <AdminDuplicates {...props} back={() => setTab("home")} />;
  // if (tab === "expenses") return <AdminExpenses {...props} back={() => setTab("home")} />; // DISABLED: expense feature commented out

  const { users, teams, requests, emails } = props;
  const tiles = [
    { key: "onboard", icon: UserPlus, title: "Onboard team", desc: "Add a team, bulk-upload members from Excel, then email credentials in one flow.", color: "var(--c-gold)" },
    { key: "users", icon: Users, title: "Users", desc: "Manage individual users and signing authority.", badge: users.length },
    { key: "teams", icon: Building2, title: "Teams & authority", desc: "Define teams and edit memberships.", badge: teams.length },
    { key: "signatures", icon: PenTool, title: "Signatures", desc: "Upload signatures in bulk on behalf of users." },
    { key: "documents", icon: FileText, title: "All documents", desc: "Download or audit every file, team-wise.", badge: requests.length },
    { key: "reports", icon: BarChart3, title: "Reports", desc: "Team-wise reporting, export to CSV." },
    { key: "emails", icon: Mail, title: "Email log", desc: "Inspect every notification sent by SignFlow.", badge: emails.length },
    { key: "registrations", icon: UserPlus, title: "Registrations", desc: "Approve or reject new self-sign-up requests." },
    { key: "password-resets", icon: KeyRound, title: "Password resets", desc: "Approve users' password-reset requests." },
    { key: "duplicates", icon: Users, title: "Accounts review", desc: "oneAccess sign-ins + possible duplicate accounts.", badge: dupCount ?? undefined }
    // DISABLED: expense feature commented out — Expenses dashboard tile
    // { key: "expenses", icon: Wallet, title: "Expenses", desc: "Consolidated expense submissions, with repayment tracking." }
  ];
  return (
    <div>
      <Hero title="Administration" subtitle="Everything the organisation needs to run SignFlow." />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mt-8 sm:mt-10">
        {tiles.map(t => <Tile key={t.key} {...t} onClick={() => setTab(t.key)} />)}
      </div>
    </div>
  );
}

// ============================================================
//   DUPLICATE ACCOUNTS — read-only detector (merge tool comes next)
// ============================================================
function AdminDuplicates({ back, notify }) {
  const [pairs, setPairs] = useState(null);
  const [oa, setOa] = useState(null);
  const [cands, setCands] = useState(null);      // ITS-collision merge candidates
  const [mergeTarget, setMergeTarget] = useState(null); // preview shown in the merge modal
  const [err, setErr] = useState(null);
  const reload = useCallback(() => {
    api.listDuplicateUsers().then(setPairs).catch(e => setErr(e.message || "Could not load"));
    api.oneAccessUsers().then(setOa).catch(() => {});
    api.mergeCandidates().then(setCands).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const oaWithDocs = oa ? oa.filter(u => u.raised + u.signed > 0) : [];
  return (
    <div>
      <BackHeader back={back} title="Accounts review" step={oa ? `${oa.length} via oneAccess` : "…"} />

      {/* who signs in via oneAccess + their document footprint */}
      <div className="card p-4 mt-5">
        <div className="flex items-baseline justify-between mb-1">
          <div className="text-[10px] tracking-widest uppercase opacity-50">oneAccess sign-ins</div>
          <div className="text-xs opacity-60">{oa ? `${oa.length} account${oa.length === 1 ? "" : "s"}` : "…"}</div>
        </div>
        {!oa ? <div className="text-sm opacity-50 py-2">Loading…</div>
          : oa.length === 0 ? <div className="text-sm opacity-60 py-2">No one has signed in via oneAccess yet.</div>
          : (
            <>
              <div className="text-xs opacity-70 mb-3">
                <b>{oaWithDocs.length}</b> of these own or have signed documents (handle with care); the other <b>{oa.length - oaWithDocs.length}</b> have none and are safe to link or merge freely.
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr className="text-left opacity-50 uppercase tracking-wider text-[10px]">
                      <th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Email</th><th className="py-1 pr-3">ITS</th><th className="py-1 pr-3">Role</th><th className="py-1 pr-3 text-right">Raised</th><th className="py-1 text-right">Signed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {oa.map(u => (
                      <tr key={u.id} className="border-t" style={{ borderColor: "var(--c-ink-08)" }}>
                        <td className="py-1.5 pr-3 font-medium">{u.name}</td>
                        <td className="py-1.5 pr-3 font-mono opacity-70 truncate max-w-[220px]">{u.email}</td>
                        <td className="py-1.5 pr-3 font-mono">{u.its_id || "—"}</td>
                        <td className="py-1.5 pr-3">{u.role}</td>
                        <td className="py-1.5 pr-3 text-right font-mono" style={u.raised ? { color: "var(--c-gold-deep)", fontWeight: 600 } : { opacity: 0.4 }}>{u.raised}</td>
                        <td className="py-1.5 text-right font-mono" style={u.signed ? { color: "var(--c-gold-deep)", fontWeight: 600 } : { opacity: 0.4 }}>{u.signed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
      </div>

      {/* ITS collisions ready to merge — the actionable list */}
      {cands && cands.length > 0 && (
        <div className="mt-8">
          <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Merge candidates · same ITS</div>
          <p className="text-sm opacity-70 mb-3 max-w-2xl">
            These accounts share an ITS number — the same person, two sign-ins. Merge each into the <b>@hqhb.in</b> account: its documents move over and the duplicate is deactivated (reversible).
          </p>
          <div className="space-y-3">
            {cands.map((c, i) => {
              const [a, b] = c.accounts;
              return (
                <div key={i} className="card p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="text-[10px] tracking-widest uppercase opacity-50">ITS <span className="font-mono">{c.its}</span></div>
                    <button className="btn-primary text-xs" onClick={() => setMergeTarget({ ...c, its: c.its })}><GitMerge size={12} /> Review &amp; merge</button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {[a, b].map(u => {
                      const keeper = c.survivorId === u.id;
                      return (
                        <div key={u.id} className="rounded p-3" style={{ backgroundColor: keeper ? "var(--c-gold-15)" : "rgba(15,26,46,.04)" }}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-sm truncate">{u.name}</div>
                            {keeper && <span className="pill text-[9px]" style={{ backgroundColor: "var(--c-gold)", color: "#1a1a1a" }}>keeper</span>}
                          </div>
                          <div className="text-xs font-mono opacity-60 truncate">{u.email}</div>
                          <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
                            <span className="pill" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>{u.role}</span>
                            <span className="pill" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>{u.authProvider}</span>
                            {u.isHqhb && <span className="pill" style={{ backgroundColor: "var(--c-gold-15)", color: "var(--c-sand)" }}>@hqhb.in</span>}
                          </div>
                          <div className="text-[11px] opacity-70 mt-2">{u.footprint.raised} raised · {u.footprint.approved} approved · {u.footprint.signed} signed</div>
                        </div>
                      );
                    })}
                  </div>
                  {c.ambiguous && <div className="text-[11px] mt-2" style={{ color: "var(--c-rust-deep)" }}>Neither address is @hqhb.in — you'll choose the keeper in the review.</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-[10px] tracking-widest uppercase opacity-50 mt-8 mb-1">Possible duplicates · by name</div>
      <p className="text-sm opacity-70 mb-2 max-w-2xl">
        Same person likely split across two accounts, matched by name (not yet linked by ITS). To line one up for a merge, open <b>Users</b> and add the ITS number to the <b>@hqhb.in</b> account — a matching account then appears under “Merge candidates” above.
      </p>
      {err && <div className="card p-4 mt-4 text-sm" style={{ color: "var(--c-rust)" }}>{err}</div>}
      {!pairs ? (
        <div className="card p-8 mt-6 text-sm opacity-50 text-center">Scanning accounts…</div>
      ) : pairs.length === 0 ? (
        <Empty icon={CheckCircle} text="No duplicate accounts found." />
      ) : (
        <div className="space-y-3 mt-6">
          {pairs.map((p, i) => (
            <div key={i} className="card p-4">
              <div className="text-[10px] tracking-widest uppercase opacity-50 mb-3">
                {p.reason}{p.crossProvider ? " · local + oneAccess" : ""}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {[p.a, p.b].map(u => (
                  <div key={u.id} className="rounded p-3" style={{ backgroundColor: "rgba(15,26,46,.04)" }}>
                    <div className="font-medium text-sm truncate">{u.name}</div>
                    <div className="text-xs font-mono opacity-60 truncate">{u.email}</div>
                    <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
                      <span className="pill" style={{ backgroundColor: "var(--c-gold-15)", color: "var(--c-sand)" }}>{u.role}</span>
                      <span className="pill" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>{u.auth_provider}</span>
                      {u.its_id ? <span className="pill font-mono" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>ITS {u.its_id}</span>
                                : <span className="pill" style={{ backgroundColor: "rgba(155,44,44,.10)", color: "var(--c-rust-deep)" }}>no ITS</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {mergeTarget && (
        <MergeReviewModal preview={mergeTarget} notify={notify}
          onClose={() => setMergeTarget(null)} onDone={reload} />
      )}
    </div>
  );
}

// Review + confirm merging two accounts that share an ITS. `preview` matches the
// server's shape: { its?, survivorId, ambiguous, accounts: [a, b] }. The kept
// account keeps its role + login; the other's documents move onto it and it is
// then deactivated (reversible). Reused by the Users page (on an ITS collision)
// and the Accounts-review "Merge candidates" list.
function MergeReviewModal({ preview, onClose, onDone, notify }) {
  const [a, b] = preview.accounts;
  const [keepId, setKeepId] = useState(preview.survivorId || "");
  const [busy, setBusy] = useState(false);
  useEscapeKey(onClose);
  const keeper = [a, b].find(x => x.id === keepId) || null;
  const dupe = [a, b].find(x => x.id !== keepId) || null;

  const confirmMerge = async () => {
    if (!keeper || !dupe) { notify("Choose which account to keep", "error"); return; }
    setBusy(true);
    try {
      const r = await api.mergeUsers(keeper.id, dupe.id);
      const m = r.moved || {};
      const n = (m.requestsRaised || 0) + (m.requestsApproved || 0) + (m.signerRows || 0) + (m.signingAuthorities || 0);
      notify(`Merged into ${keeper.email} — ${n} record${n === 1 ? "" : "s"} moved, duplicate deactivated`, "success");
      onDone?.(); onClose();
    } catch (e) { notify(e.message || "Merge failed", "error"); }
    finally { setBusy(false); }
  };

  const Card = ({ u }) => {
    const isKeeper = keepId === u.id;
    return (
      <button type="button" onClick={() => setKeepId(u.id)} className="text-left rounded-lg p-3 border transition"
        style={{ borderColor: isKeeper ? "var(--c-gold)" : "var(--c-ink-10)", backgroundColor: isKeeper ? "var(--c-gold-15)" : "rgba(15,26,46,.03)" }}>
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="font-medium text-sm truncate">{u.name}</div>
          {isKeeper
            ? <span className="pill" style={{ backgroundColor: "var(--c-gold)", color: "#1a1a1a" }}>KEEP</span>
            : <span className="pill" style={{ backgroundColor: "rgba(155,44,44,.10)", color: "var(--c-rust-deep)" }}>deactivate</span>}
        </div>
        <div className="text-xs font-mono opacity-60 truncate">{u.email}</div>
        <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
          <span className="pill" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>{u.role}</span>
          <span className="pill" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>{u.authProvider}</span>
          {u.isHqhb && <span className="pill" style={{ backgroundColor: "var(--c-gold-15)", color: "var(--c-sand)" }}>@hqhb.in</span>}
        </div>
        <div className="text-[11px] opacity-70 mt-2">{u.footprint.raised} raised · {u.footprint.approved} approved · {u.footprint.signed} signed</div>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(15,26,46,.6)" }} onClick={onClose}>
      <div className="card p-6 max-w-lg w-full m-4" style={{ backgroundColor: "var(--c-cream)" }} onClick={e => e.stopPropagation()}>
        <div className="font-display text-2xl mb-1">Merge duplicate accounts</div>
        <div className="text-sm opacity-60 mb-4">
          {preview.its ? <>Both accounts share ITS <span className="font-mono">{preview.its}</span>. </> : null}
          The kept account keeps its role and password login; the other's documents move onto it, then it's deactivated. This can be undone.
        </div>
        {preview.ambiguous && (
          <div className="text-xs mb-3 px-3 py-2 rounded" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
            Neither address is <b>@hqhb.in</b> — choose which account to keep.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-1"><Card u={a} /><Card u={b} /></div>
        <div className="text-[11px] opacity-50 mb-4">Tap a card to choose which account survives.</div>
        <div className="flex justify-end gap-3">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={confirmMerge} disabled={busy || !keeper}>
            <GitMerge size={14} /> {busy ? "Merging…" : "Merge & deactivate duplicate"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//   ONBOARD TEAM — 4-step bulk flow
//   Step 1: Pick or create team
//   Step 2: Upload Excel / CSV of users (auto-team-assigned)
//   Step 3: Review parsed rows, edit role per row, mark signing authority
//   Step 4: Submit → creates users → optionally batch-emails credentials
// ============================================================
function OnboardTeam({ teams, users, saveTeams, saveUsers, refresh, notify, back }) {
  const [step, setStep] = useState(0);
  // Team selection
  const [mode, setMode] = useState("existing"); // "existing" | "new"
  const [pickedTeamId, setPickedTeamId] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  // Parsed rows
  const [rows, setRows] = useState([]);   // [{ name, email, role, asApprover, password? }]
  const [fileName, setFileName] = useState("");
  // Send invites
  const [sendInvites, setSendInvites] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resultLog, setResultLog] = useState(null); // { created: [], failed: [], invited: 0, inviteErrors: [] }

  // Step 1 advance check
  const canAdvance1 = mode === "existing" ? !!pickedTeamId : !!newTeamName.trim();
  // Step 2 advance check
  const canAdvance2 = rows.length > 0 && rows.every(r => r.name.trim() && r.email.trim() && /@/.test(r.email));

  const handleFile = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const ext = f.name.split(".").pop().toLowerCase();
    try {
      let parsedRows = [];
      if (ext === "csv") {
        const text = await f.text();
        parsedRows = parseCsv(text);
      } else if (ext === "xlsx" || ext === "xls") {
        const buf = await f.arrayBuffer();
        const XLSX = await import("xlsx");
        const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        parsedRows = rawToRows(raw);
      } else {
        notify("Unsupported file — use .xlsx or .csv", "error");
        return;
      }
      // Default every row to requestor; admin can flip individual rows on step 3
      setRows(parsedRows.map(r => ({
        name: r.name || "",
        email: r.email || "",
        role: r.role && r.role.toLowerCase() === "approver" ? "approver" : "requestor",
        asApprover: r.role && r.role.toLowerCase() === "approver"
      })));
    } catch (err) {
      notify(`Could not parse file: ${err.message}`, "error");
    }
  };

  const addEmptyRow = () => setRows(rs => [...rs, { name: "", email: "", role: "requestor", asApprover: false }]);
  const updateRow = (i, patch) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeRow = (i) => setRows(rs => rs.filter((_, idx) => idx !== i));

  // Build and download a sample .xlsx with the exact column layout the parser
  // expects, plus a couple of illustrative rows. Saves the admin from having
  // to remember or copy the format from the on-screen hint.
  const downloadTemplate = async (fmt = "xlsx") => {
    const headers = ["name", "email", "role"];
    const sample = [
      ["Jane Finance",   "jane.finance@hqhb.in",   "approver"],
      ["Karim Ops",      "karim.ops@hqhb.in",      "requestor"],
      ["Priya Iyer",     "priya.iyer@hqhb.in",     "requestor"]
    ];
    try {
      if (fmt === "csv") {
        const csv = [headers, ...sample].map(r => r.join(",")).join("\r\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        triggerDownload(blob, "team-members-template.csv");
        return;
      }
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
      // Tidy column widths so the file opens nicely in Excel
      ws["!cols"] = [{ wch: 22 }, { wch: 32 }, { wch: 12 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Members");
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([new Uint8Array(out)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      triggerDownload(blob, "team-members-template.xlsx");
    } catch (err) {
      notify(`Could not build template: ${err.message}`, "error");
    }
  };

  const submit = async () => {
    setBusy(true);
    setResultLog(null);
    try {
      // 1. Resolve target team id (create new team first if needed)
      let teamId = pickedTeamId;
      if (mode === "new") {
        const { team } = await api.createTeam(newTeamName.trim());
        teamId = team.id;
        await saveTeams();
      }

      // 2. Create each user. Server generates a temp hash; the welcome email
      //    will reset to a random password and email plaintext (so we don't
      //    need to know passwords here).
      const created = [];
      const failed = [];
      for (const r of rows) {
        try {
          // Use a placeholder password; invite step will overwrite + email.
          const placeholderPwd = randomPassword();
          const payload = {
            name: r.name.trim(),
            email: r.email.trim(),
            password: placeholderPwd,
            role: r.asApprover ? "approver" : "requestor",
            ...(r.asApprover
              ? { signingAuthorityTeams: [teamId] }
              : { team: teamId })
          };
          const { user } = await api.createUser(payload);
          created.push(user);
        } catch (e) {
          failed.push({ row: r, error: e.message || "Failed" });
        }
      }
      await saveUsers();
      await refresh?.();

      // 3. Send invites in one batch (if enabled)
      let invited = 0;
      let inviteErrors = [];
      if (sendInvites && created.length > 0) {
        try {
          const { results } = await api.bulkInvite(created.map(u => u.id));
          invited = results.filter(r => r.ok).length;
          inviteErrors = results.filter(r => !r.ok);
        } catch (e) {
          inviteErrors.push({ error: e.message || "Bulk invite failed" });
        }
      }

      setResultLog({ created, failed, invited, inviteErrors });
      setStep(3);
      notify(`Onboarded ${created.length} of ${rows.length} user${rows.length === 1 ? "" : "s"}${sendInvites ? ` · ${invited} invite${invited === 1 ? "" : "s"} sent` : ""}`, "success");
    } catch (e) {
      notify(e.message || "Onboarding failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const teamLabel = mode === "existing"
    ? teams.find(t => t.id === pickedTeamId)?.name
    : newTeamName.trim();

  const steps = [
    { label: "Team" },
    { label: "Upload" },
    { label: "Review" },
    { label: "Done" }
  ];

  return (
    <div>
      <BackHeader back={back} title="Onboard a team" step={`Step ${Math.min(step + 1, steps.length)} of ${steps.length}`} />

      {/* Step indicator */}
      <div className="flex items-center gap-2 mt-6 mb-8">
        {steps.map((s, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <div key={s.label} className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium"
                  style={{
                    backgroundColor: active ? "#0F1A2E" : done ? "#B8894A" : "rgba(15,26,46,.08)",
                    color: (active || done) ? "#F5F1E8" : "rgba(15,26,46,.6)"
                  }}>
                  {done ? <Check size={11} /> : i + 1}
                </div>
                <div className="text-[10px] tracking-wider uppercase hidden sm:inline" style={{ opacity: active ? 1 : 0.5 }}>{s.label}</div>
              </div>
              {i < steps.length - 1 && <div className="flex-1 h-px" style={{ backgroundColor: done ? "#B8894A" : "rgba(15,26,46,.12)" }} />}
            </div>
          );
        })}
      </div>

      {/* ─── STEP 1: Team ─── */}
      {step === 0 && (
        <div className="card p-6 max-w-2xl anim-in">
          <div className="text-xs tracking-wider uppercase opacity-70 mb-3">Pick the team you're onboarding</div>
          <div className="grid sm:grid-cols-2 gap-3 mb-5">
            <button type="button" onClick={() => setMode("existing")}
              className={`card p-3 text-left tile-hover ${mode === "existing" ? "ring-2" : ""}`}
              style={{ borderColor: mode === "existing" ? "#B8894A" : undefined, backgroundColor: mode === "existing" ? "rgba(184,137,74,.08)" : undefined }}>
              <Building2 size={16} className="opacity-70 mb-2" />
              <div className="font-medium text-sm">Existing team</div>
              <div className="text-xs opacity-60">Add members to a team already in the system.</div>
            </button>
            <button type="button" onClick={() => setMode("new")}
              className={`card p-3 text-left tile-hover ${mode === "new" ? "ring-2" : ""}`}
              style={{ borderColor: mode === "new" ? "#B8894A" : undefined, backgroundColor: mode === "new" ? "rgba(184,137,74,.08)" : undefined }}>
              <Plus size={16} className="opacity-70 mb-2" />
              <div className="font-medium text-sm">Create new team</div>
              <div className="text-xs opacity-60">Spin up a team and add the first members in one go.</div>
            </button>
          </div>

          {mode === "existing" ? (
            <div>
              <label className="text-xs tracking-wider uppercase opacity-70 block mb-2">Choose a team</label>
              {teams.length === 0 ? (
                <div className="text-sm opacity-60">No teams exist yet — switch to "Create new team".</div>
              ) : (
                <select className="w-full" value={pickedTeamId} onChange={e => setPickedTeamId(e.target.value)}>
                  <option value="">— select —</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
            </div>
          ) : (
            <div>
              <label className="text-xs tracking-wider uppercase opacity-70 block mb-2">New team name</label>
              <input className="w-full" placeholder="e.g. Finance Team"
                value={newTeamName} onChange={e => setNewTeamName(e.target.value)} autoFocus />
            </div>
          )}

          <div className="flex justify-end mt-6 gap-2">
            <button className="btn-ghost" onClick={back}>Cancel</button>
            <button className="btn-primary" onClick={() => setStep(1)} disabled={!canAdvance1}>Continue <ArrowRight size={13} /></button>
          </div>
        </div>
      )}

      {/* ─── STEP 2: Upload ─── */}
      {step === 1 && (
        <div className="anim-in">
          <div className="card p-6 mb-5">
            <div className="text-xs tracking-wider uppercase opacity-70 mb-2">Upload member list</div>
            <div className="text-sm opacity-70 mb-4">
              File format: <span className="font-mono text-xs">.xlsx</span> or <span className="font-mono text-xs">.csv</span>.
              Required columns: <span className="font-mono text-xs">name</span>, <span className="font-mono text-xs">email</span>. Optional: <span className="font-mono text-xs">role</span> (<span className="font-mono text-xs">requestor</span> / <span className="font-mono text-xs">approver</span>) — defaults to requestor.
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="btn-primary cursor-pointer">
                <Upload size={13} /> Choose file
                <input type="file" accept=".xlsx,.xls,.csv,text/csv" className="hidden" onChange={handleFile} />
              </label>
              <button className="btn-ghost" onClick={() => downloadTemplate("xlsx")}
                title="Pre-filled Excel template with example rows">
                <Download size={13} /> Download template
              </button>
              <button className="btn-ghost" onClick={addEmptyRow}><Plus size={13} /> Add row manually</button>
              {fileName && <div className="text-xs opacity-60 font-mono">{fileName}</div>}
            </div>
            <div className="text-xs opacity-50 mt-2">
              Tip: download the template, fill it in, then upload it back.
              Need CSV instead? <button className="underline" onClick={() => downloadTemplate("csv")}>get the .csv template</button>.
            </div>
          </div>

          {rows.length > 0 && (
            <div className="card overflow-hidden">
              <div className="grid grid-cols-12 text-[10px] tracking-wider uppercase opacity-50 px-4 py-3 border-b" style={{ borderColor: "var(--c-ink-08)" }}>
                <div className="col-span-4">Name</div>
                <div className="col-span-5">Email</div>
                <div className="col-span-2">Role</div>
                <div className="col-span-1"></div>
              </div>
              {rows.map((r, i) => {
                const emailOk = r.email && /@/.test(r.email);
                return (
                  <div key={i} className="grid grid-cols-12 items-center px-4 py-2 border-b text-sm" style={{ borderColor: "rgba(15,26,46,.06)" }}>
                    <div className="col-span-4">
                      <input value={r.name} onChange={e => updateRow(i, { name: e.target.value })}
                        className="w-full text-sm" placeholder="Full name" />
                    </div>
                    <div className="col-span-5">
                      <input value={r.email} onChange={e => updateRow(i, { email: e.target.value })}
                        className="w-full text-sm font-mono"
                        style={!emailOk && r.email ? { borderColor: "#9B2C2C" } : {}}
                        placeholder="email@hqhb.in" />
                    </div>
                    <div className="col-span-2">
                      <select value={r.asApprover ? "approver" : "requestor"} className="w-full text-sm"
                        onChange={e => updateRow(i, { asApprover: e.target.value === "approver", role: e.target.value })}>
                        <option value="requestor">Requestor</option>
                        <option value="approver">Approver</option>
                      </select>
                    </div>
                    <div className="col-span-1 text-right">
                      <button className="opacity-40 hover:opacity-100" onClick={() => removeRow(i)}><X size={13} /></button>
                    </div>
                  </div>
                );
              })}
              <div className="px-4 py-3 text-xs opacity-60">{rows.length} row{rows.length === 1 ? "" : "s"} ready</div>
            </div>
          )}

          <div className="flex justify-end mt-6 gap-2">
            <button className="btn-ghost" onClick={() => setStep(0)}><ArrowLeft size={13} /> Back</button>
            <button className="btn-primary" onClick={() => setStep(2)} disabled={!canAdvance2}>Continue <ArrowRight size={13} /></button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: Review & confirm ─── */}
      {step === 2 && (
        <div className="anim-in max-w-3xl">
          <div className="card p-5 mb-5">
            <div className="text-xs tracking-wider uppercase opacity-50 mb-2">Summary</div>
            <div className="flex flex-wrap gap-4 text-sm">
              <div><Building2 size={13} className="inline-block mr-1 opacity-70" /> Team: <span className="font-medium">{teamLabel}</span>{mode === "new" && <span className="pill pill-pending text-[10px] ml-2">new</span>}</div>
              <div>· {rows.filter(r => !r.asApprover).length} requestor{rows.filter(r => !r.asApprover).length === 1 ? "" : "s"}</div>
              <div>· {rows.filter(r => r.asApprover).length} approver{rows.filter(r => r.asApprover).length === 1 ? "" : "s"}</div>
            </div>
          </div>

          <div className="card p-5 mb-5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={sendInvites} onChange={e => setSendInvites(e.target.checked)} className="mt-1" />
              <div>
                <div className="font-medium text-sm flex items-center gap-2">
                  <Mail size={13} style={{ color: "var(--c-gold)" }} /> Send welcome emails with credentials
                </div>
                <div className="text-xs opacity-60 mt-0.5">
                  Each user receives an email with a freshly generated password. You won't see the passwords — they go straight to the user.
                  If SendGrid isn't configured the emails are logged under <span className="font-mono">Email log</span> instead.
                </div>
              </div>
            </label>
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 text-xs tracking-wider uppercase opacity-60 border-b" style={{ borderColor: "var(--c-ink-08)" }}>Members to create</div>
            {rows.map((r, i) => (
              <div key={i} className="px-4 py-2.5 border-b text-sm flex items-center gap-3" style={{ borderColor: "rgba(15,26,46,.06)" }}>
                <div className="flex-1">
                  <div className="font-medium">{r.name || <span className="opacity-50">—</span>}</div>
                  <div className="text-xs opacity-60 font-mono">{r.email}</div>
                </div>
                <span className="pill" style={{
                  backgroundColor: r.asApprover ? "rgba(184,137,74,.18)" : "rgba(15,26,46,.06)",
                  color: r.asApprover ? "#8B6914" : "#0F1A2E"
                }}>{r.asApprover ? "approver" : "requestor"}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-end mt-6 gap-2">
            <button className="btn-ghost" onClick={() => setStep(1)}><ArrowLeft size={13} /> Back</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>
              {busy ? "Onboarding…" : <><Check size={13} /> {sendInvites ? "Create users & send invites" : "Create users"}</>}
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 4: Result ─── */}
      {step === 3 && resultLog && (
        <div className="anim-in max-w-3xl">
          <div className="card p-6 mb-5" style={{ borderLeft: "4px solid #2D5F2F" }}>
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle size={20} style={{ color: "var(--c-forest)" }} />
              <div className="font-display text-2xl">Team onboarded</div>
            </div>
            <div className="text-sm opacity-75">
              {resultLog.created.length} user{resultLog.created.length === 1 ? "" : "s"} created in <span className="font-medium">{teamLabel}</span>.
              {sendInvites && <> {resultLog.invited} invite email{resultLog.invited === 1 ? "" : "s"} sent.</>}
            </div>
          </div>

          {resultLog.failed.length > 0 && (
            <div className="card p-4 mb-5" style={{ borderLeft: "4px solid #9B2C2C", backgroundColor: "rgba(155,44,44,.04)" }}>
              <div className="text-sm font-medium mb-2" style={{ color: "var(--c-rust-deep)" }}>{resultLog.failed.length} failed</div>
              {resultLog.failed.map((f, i) => (
                <div key={i} className="text-xs opacity-75 mb-1">{f.row.email} — {f.error}</div>
              ))}
            </div>
          )}

          {sendInvites && resultLog.inviteErrors.length > 0 && (
            <div className="card p-4 mb-5" style={{ borderLeft: "4px solid #B8894A" }}>
              <div className="text-sm font-medium mb-2" style={{ color: "var(--c-sand)" }}>{resultLog.inviteErrors.length} invite{resultLog.inviteErrors.length === 1 ? "" : "s"} failed</div>
              {resultLog.inviteErrors.map((e, i) => (
                <div key={i} className="text-xs opacity-75 mb-1">{e.id || "(batch)"} — {e.error || "unknown"}</div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-ghost" onClick={() => {
              // Reset to start a new flow
              setStep(0); setMode("existing"); setPickedTeamId(""); setNewTeamName("");
              setRows([]); setFileName(""); setResultLog(null);
            }}>Onboard another team</button>
            <button className="btn-primary" onClick={back}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- helpers used by OnboardTeam ----

/** Tolerant CSV parser — handles quoted values, escaped quotes, CRLF, BOM. */
function parseCsv(text) {
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let i = 0, field = "", row = [], inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ""; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rawToRows(rows);
}

/** Map raw 2D array (first row = header) into [{ name, email, role }]. */
function rawToRows(raw) {
  if (!raw || raw.length < 1) return [];
  const header = raw[0].map(h => String(h || "").trim().toLowerCase());
  const nameCol = header.findIndex(h => h === "name" || h === "full name" || h === "fullname");
  const emailCol = header.findIndex(h => h === "email" || h === "e-mail" || h === "mail");
  const roleCol = header.findIndex(h => h === "role" || h === "type");
  // If no header is detected, assume order: name, email, role
  const isHeaderRow = nameCol !== -1 && emailCol !== -1;
  const startRow = isHeaderRow ? 1 : 0;
  const nC = isHeaderRow ? nameCol : 0;
  const eC = isHeaderRow ? emailCol : 1;
  const rC = isHeaderRow ? roleCol : 2;
  const out = [];
  for (let i = startRow; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r.length === 0) continue;
    const name = String(r[nC] || "").trim();
    const email = String(r[eC] || "").trim();
    if (!name && !email) continue;
    const role = rC >= 0 ? String(r[rC] || "").trim().toLowerCase() : "";
    out.push({ name, email, role });
  }
  return out;
}

/** Local-only placeholder password — server overwrites via invite step. */
function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** Fires a browser download for a Blob with the given filename. Used by the
 *  team-onboarding wizard to deliver the Excel / CSV template. */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give Safari a moment to actually start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function AdminUsers({ users, teams, saveUsers, back, notify }) {
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [invitingId, setInvitingId] = useState(null);
  // User object currently selected for reset (drives the PasswordResetModal).
  const [resetTarget, setResetTarget] = useState(null);
  // Set of userIds whose plaintext password is currently revealed in the UI.
  // Default is hidden — admins click the eye icon to reveal.
  const [revealedIds, setRevealedIds] = useState(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  // Inline ITS editing + the merge-review modal that opens when a saved ITS
  // collides with another active account.
  const [editingItsId, setEditingItsId] = useState(null);
  const [itsDraft, setItsDraft] = useState("");
  const [mergePreview, setMergePreview] = useState(null);
  // Inline email editing.
  const [editingEmailId, setEditingEmailId] = useState(null);
  const [emailDraft, setEmailDraft] = useState("");
  // Role change — target user for the RoleChangeModal.
  const [roleTarget, setRoleTarget] = useState(null);
  const confirm = useConfirmation();

  // Auto-refresh every 20 seconds while the admin is on this page. Keeps the
  // password column in sync with users who change their own password from a
  // different tab / session. Tab-focus also triggers a refresh at the App
  // level — this poll covers the "stayed on this tab" case.
  useEffect(() => {
    const id = setInterval(() => {
      saveUsers().catch(() => {});
    }, 20_000);
    return () => clearInterval(id);
  }, [saveUsers]);

  const manualRefresh = async () => {
    setRefreshing(true);
    try {
      await saveUsers();
      notify("User list refreshed", "success");
    } catch (e) {
      notify(e.message || "Refresh failed", "error");
    } finally {
      setRefreshing(false);
    }
  };

  const toggleReveal = (id) => setRevealedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const copyPwd = async (pwd, name) => {
    try {
      await navigator.clipboard.writeText(pwd);
      notify(`Copied ${name}'s password to clipboard`, "success");
    } catch {
      notify("Couldn't copy — long-press to copy manually", "error");
    }
  };

  const add = async data => {
    try { await api.createUser(data); notify("User added", "success"); await saveUsers(); return true; }
    catch (e) { notify(e.message, "error"); return false; }
  };

  // Grant or revoke the high-contrast (inverted) display for one user. The
  // feature is per-user by design; revoking also switches their screen back.
  const toggleDarkAccess = async (u) => {
    try {
      await api.setDarkModeAccess(u.id, !u.darkModeAllowed);
      notify(u.darkModeAllowed
        ? `High-contrast display revoked for ${u.name}`
        : `High-contrast display allowed for ${u.name} — they'll find the switch in their profile menu`, "success");
      await saveUsers();
    } catch (e) { notify(e.message, "error"); }
  };
  const remove = async (id, name) => {
    const ok = await confirm({
      title: `Delete ${name || "this user"}?`,
      message: "Their name will be replaced by \"(deleted user)\" on past requests, but the documents themselves stay intact. In-flight workflows where they were a pending signer will need to be re-routed.",
      confirmLabel: "Delete user",
      destructive: true
    });
    if (!ok) return;
    try { await api.deleteUser(id); notify("User removed", "success"); await saveUsers(); }
    catch (e) { notify(e.message, "error"); }
  };
  // Generates a fresh random password on the server, hashes it, and emails the
  // plaintext to the user. Use this to (re)send sign-in credentials at any time.
  const sendInvite = async (id, name, email) => {
    const ok = await confirm({
      title: `Send invite to ${name}?`,
      message: `A new random password will be generated and emailed to ${email}. Their current password will stop working.`,
      confirmLabel: "Send invite",
      destructive: false
    });
    if (!ok) return;
    setInvitingId(id);
    try {
      const r = await api.inviteUser(id);
      if (r.delivered) notify(`Invite email sent to ${email}`, "success");
      else if (r.error) notify(`Email logged but delivery failed: ${r.error}`, "error");
      else notify(`Invite logged (SendGrid not configured). New password is visible in this row.`, "info");
      // Refresh the user list so the new last_temp_password shows up
      await saveUsers();
      // Auto-reveal it so the admin sees the new password immediately
      setRevealedIds(prev => new Set(prev).add(id));
    } catch (e) {
      notify(e.message || "Failed to send invite", "error");
    } finally {
      setInvitingId(null);
    }
  };
  // Admin-initiated password reset. Opens a small modal where the admin can
  // either type a specific password OR leave it blank for a server-generated
  // random one. Server uses the reset_password email template either way.
  const submitReset = async (customPassword) => {
    if (!resetTarget) return;
    const r = await api.resetUserPassword(resetTarget.id, customPassword);
    if (r.delivered) notify(`Password reset email sent to ${resetTarget.email}`, "success");
    else if (r.error) notify(`Email logged but delivery failed: ${r.error}`, "error");
    else notify(`Reset logged (SendGrid not configured). New password is visible in this row.`, "info");
    await saveUsers();
    setRevealedIds(prev => new Set(prev).add(resetTarget.id));
    setResetTarget(null);
  };

  // Set/clear a user's ITS. If the server reports another active account with the
  // same ITS, open the merge-review modal so the admin can reconcile them.
  const startEditIts = (u) => { setEditingItsId(u.id); setItsDraft(u.itsId || ""); };
  const saveIts = async (u) => {
    const val = itsDraft.trim();
    try {
      const r = await api.setUserItsId(u.id, val);
      setEditingItsId(null);
      await saveUsers();
      if (r.collision) setMergePreview({ ...r.collision, its: val });
      else notify(val ? "ITS saved" : "ITS cleared", "success");
    } catch (e) { notify(e.message || "Could not save ITS", "error"); }
  };
  const reactivate = async (u) => {
    try { await api.reactivateUser(u.id); notify("Account reactivated", "success"); await saveUsers(); }
    catch (e) { notify(e.message || "Could not reactivate", "error"); }
  };
  // ITS display / inline editor — shared by the desktop table and mobile cards.
  const renderIts = (u) => editingItsId === u.id ? (
    <div className="flex items-center gap-1 mt-1">
      <input autoFocus value={itsDraft} onChange={e => setItsDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") saveIts(u); else if (e.key === "Escape") setEditingItsId(null); }}
        placeholder="ITS id" className="text-xs font-mono px-1.5 py-0.5 rounded border w-32" style={{ borderColor: "var(--c-ink-10)", background: "var(--c-cream)" }} />
      <button className="opacity-60 hover:opacity-100" onClick={() => saveIts(u)} title="Save ITS"><Check size={12} /></button>
      <button className="opacity-40 hover:opacity-100" onClick={() => setEditingItsId(null)} title="Cancel"><X size={12} /></button>
    </div>
  ) : (
    <button onClick={() => startEditIts(u)} className="mt-1 inline-flex items-center gap-1 text-[10px] opacity-60 hover:opacity-100"
      title="Set the ITS id used to match this person's oneAccess sign-in">
      {u.itsId ? <span className="font-mono">ITS {u.itsId}</span> : <span style={{ color: "var(--c-gold-deep)" }}>+ Add ITS</span>}
      <Pencil size={9} />
    </button>
  );

  // Change a user's primary email (sign-in + all notifications).
  const saveEmail = async (u) => {
    const val = emailDraft.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) { notify("Enter a valid email address", "error"); return; }
    try {
      await api.setUserEmail(u.id, val);
      setEditingEmailId(null);
      await saveUsers();
      notify("Email updated", "success");
    } catch (e) { notify(e.message || "Could not update email", "error"); }
  };
  // Change a user's role — opens the RoleChangeModal (role cards + spelled-out
  // side effects). A dialog is reliable everywhere the inline dropdown wasn't.
  const renderRole = (u) => (
    <span className="inline-flex items-center gap-1">
      <span className="pill pill-pending">{u.role}</span>
      <button className="opacity-40 hover:opacity-100 shrink-0" onClick={() => setRoleTarget(u)} title="Change role"><Pencil size={10} /></button>
    </span>
  );

  const renderEmail = (u) => editingEmailId === u.id ? (
    <div className="flex items-center gap-1">
      <input autoFocus type="email" value={emailDraft} onChange={e => setEmailDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") saveEmail(u); else if (e.key === "Escape") setEditingEmailId(null); }}
        className="text-xs font-mono px-1.5 py-0.5 rounded border w-full min-w-0" style={{ borderColor: "var(--c-ink-10)", background: "var(--c-cream)" }} />
      <button className="opacity-60 hover:opacity-100 shrink-0" onClick={() => saveEmail(u)} title="Save email"><Check size={12} /></button>
      <button className="opacity-40 hover:opacity-100 shrink-0" onClick={() => setEditingEmailId(null)} title="Cancel"><X size={12} /></button>
    </div>
  ) : (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="font-mono text-xs opacity-70 truncate">{u.email}</span>
      <button className="opacity-40 hover:opacity-100 shrink-0" onClick={() => { setEditingEmailId(u.id); setEmailDraft(u.email); }} title="Edit email"><Pencil size={10} /></button>
    </div>
  );

  return (
    <div>
      <BackHeader back={back} title="Users" step={`${users.length} total · auto-refresh 20s`} />
      <div className="flex flex-wrap justify-end gap-2 sm:gap-3 mt-6 mb-4">
        <button className="btn-ghost" onClick={manualRefresh} disabled={refreshing}
          title="Refresh user list now">
          <RefreshCw size={14} className={refreshing ? "anim-spin" : ""} />
          <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
        </button>
        <button className="btn-ghost" onClick={() => setBulkOpen(true)}><Upload size={14} /> <span className="hidden sm:inline">Bulk upload CSV</span><span className="sm:hidden">Bulk</span></button>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} /> Add user</button>
      </div>

      {/* Desktop table */}
      <div className="card overflow-hidden hidden md:block">
        <div className="grid grid-cols-12 text-[10px] tracking-wider uppercase opacity-50 px-5 py-3 border-b" style={{ borderColor: "var(--c-ink-08)" }}>
          <div className="col-span-3">Name</div>
          <div className="col-span-3">Email</div>
          <div className="col-span-1">Role</div>
          <div className="col-span-2">Team / Authority</div>
          <div className="col-span-2">Password</div>
          <div className="col-span-1"></div>
        </div>
        {users.map(u => {
          const revealed = revealedIds.has(u.id);
          return (
          <div key={u.id} className="grid grid-cols-12 items-center px-5 py-3 border-b text-sm" style={{ borderColor: "rgba(15,26,46,.06)", opacity: u.active === false ? 0.55 : 1 }}>
            <div className="col-span-3 font-medium flex items-center gap-2">
              {u.hasSignature && <PenTool size={11} style={{ color: "var(--c-gold)" }} />}
              <span className="truncate">{u.name}</span>
              {u.active === false && <span className="pill text-[9px]" style={{ backgroundColor: "rgba(15,26,46,.08)" }}>merged</span>}
            </div>
            <div className="col-span-3 min-w-0">
              {renderEmail(u)}
              {renderIts(u)}
            </div>
            <div className="col-span-1">{renderRole(u)}</div>
            <div className="col-span-2 text-xs opacity-70 truncate">
              {(u.role === "approver" || u.role === "executive") && ((u.signingAuthorityTeams || []).map(id => teams.find(t => t.id === id)?.name).filter(Boolean).join(", ") || "—")}
              {u.role === "requestor" && (teams.find(t => t.id === u.team)?.name || "—")}
              {u.role === "admin" && "—"}
            </div>
            <div className="col-span-2 flex items-center gap-2">
              {u.lastTempPassword ? (
                <>
                  <span className="font-mono text-xs px-2 py-1 rounded" style={{ backgroundColor: "rgba(15,26,46,.06)", letterSpacing: revealed ? 0 : ".15em" }}>
                    {revealed ? u.lastTempPassword : "•".repeat(Math.min(u.lastTempPassword.length, 10))}
                  </span>
                  <button className="opacity-50 hover:opacity-100" onClick={() => toggleReveal(u.id)}
                    title={revealed ? "Hide" : "Reveal"}>
                    {revealed ? <EyeOff size={12} /> : <EyeIcon size={12} />}
                  </button>
                  <button className="opacity-50 hover:opacity-100" onClick={() => copyPwd(u.lastTempPassword, u.name)}
                    title="Copy password">
                    <Check size={12} />
                  </button>
                </>
              ) : <span className="text-xs opacity-40 italic">— not set —</span>}
            </div>
            <div className="col-span-1 text-right flex items-center justify-end gap-2">
              {u.active === false ? (
                <button className="opacity-60 hover:opacity-100" onClick={() => reactivate(u)}
                  title="Reactivate — restore sign-in (migrated documents stay on the keeper)"><RotateCcw size={13} /></button>
              ) : (
                <>
                  {u.role !== "admin" && (
                    <button className="opacity-50 hover:opacity-100"
                      onClick={() => sendInvite(u.id, u.name, u.email)}
                      disabled={invitingId === u.id}
                      title="Send / resend invite — generates a fresh password and emails it">
                      {invitingId === u.id
                        ? <span className="text-xs">…</span>
                        : <Mail size={13} />}
                    </button>
                  )}
                  <button className="opacity-50 hover:opacity-100"
                    onClick={() => setResetTarget(u)}
                    title="Reset password — choose a new password or auto-generate">
                    <KeyRound size={13} />
                  </button>
                  <button className={u.darkModeAllowed ? "opacity-100" : "opacity-40 hover:opacity-100"}
                    onClick={() => toggleDarkAccess(u)}
                    title={u.darkModeAllowed
                      ? "High-contrast display: ALLOWED — click to revoke"
                      : "Allow the high-contrast (inverted) display for this user"}>
                    <Moon size={13} style={u.darkModeAllowed ? { color: "var(--c-gold)" } : undefined} />
                  </button>
                </>
              )}
              <button className="opacity-40 hover:opacity-100" onClick={() => remove(u.id, u.name)} title="Remove"><Trash2 size={13} /></button>
            </div>
          </div>
        );})}
      </div>

      {/* Mobile stacked cards */}
      <div className="card overflow-hidden md:hidden">
        {users.map(u => {
          const revealed = revealedIds.has(u.id);
          return (
          <div key={u.id} className="px-4 py-3 border-b" style={{ borderColor: "rgba(15,26,46,.06)", opacity: u.active === false ? 0.55 : 1 }}>
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {u.hasSignature && <PenTool size={11} style={{ color: "var(--c-gold)" }} className="shrink-0" />}
                <div className="font-medium text-sm truncate">{u.name}</div>
                {u.active === false && <span className="pill text-[9px] shrink-0" style={{ backgroundColor: "rgba(15,26,46,.08)" }}>merged</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {u.active === false ? (
                  <button className="opacity-60 hover:opacity-100" onClick={() => reactivate(u)} title="Reactivate account"><RotateCcw size={13} /></button>
                ) : (
                  <>
                    {u.role !== "admin" && (
                      <button className="opacity-50 hover:opacity-100"
                        onClick={() => sendInvite(u.id, u.name, u.email)}
                        disabled={invitingId === u.id}
                        title="Send / resend invite">
                        {invitingId === u.id ? <span className="text-xs">…</span> : <Mail size={13} />}
                      </button>
                    )}
                    <button className="opacity-50 hover:opacity-100"
                      onClick={() => setResetTarget(u)}
                      title="Reset password">
                      <KeyRound size={13} />
                    </button>
                    <button className={u.darkModeAllowed ? "opacity-100" : "opacity-40 hover:opacity-100"}
                      onClick={() => toggleDarkAccess(u)}
                      title={u.darkModeAllowed ? "High-contrast display: ALLOWED — tap to revoke" : "Allow high-contrast display"}>
                      <Moon size={13} style={u.darkModeAllowed ? { color: "var(--c-gold)" } : undefined} />
                    </button>
                  </>
                )}
                <button className="opacity-40 hover:opacity-100" onClick={() => remove(u.id, u.name)} title="Remove"><Trash2 size={13} /></button>
              </div>
            </div>
            <div className="mb-2">
              {renderEmail(u)}
              {renderIts(u)}
            </div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {renderRole(u)}
              <span className="text-xs opacity-70">
                {(u.role === "approver" || u.role === "executive") && ((u.signingAuthorityTeams || []).map(id => teams.find(t => t.id === id)?.name).filter(Boolean).join(", ") || "—")}
                {u.role === "requestor" && (teams.find(t => t.id === u.team)?.name || "—")}
                {u.role === "admin" && "—"}
              </span>
            </div>
            {u.lastTempPassword && (
              <div className="flex items-center gap-2 text-xs">
                <span className="opacity-50 uppercase tracking-wider text-[10px]">Pwd:</span>
                <span className="font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(15,26,46,.06)", letterSpacing: revealed ? 0 : ".15em" }}>
                  {revealed ? u.lastTempPassword : "•".repeat(Math.min(u.lastTempPassword.length, 10))}
                </span>
                <button className="opacity-50" onClick={() => toggleReveal(u.id)} title={revealed ? "Hide" : "Reveal"}>
                  {revealed ? <EyeOff size={12} /> : <EyeIcon size={12} />}
                </button>
                <button className="opacity-50" onClick={() => copyPwd(u.lastTempPassword, u.name)} title="Copy">
                  <Check size={12} />
                </button>
              </div>
            )}
          </div>
        );})}
      </div>

      {resetTarget && (
        <PasswordResetModal
          user={resetTarget}
          onCancel={() => setResetTarget(null)}
          onSubmit={submitReset} />
      )}
      {adding && <OnboardUserWizard teams={teams} users={users} onCancel={() => setAdding(false)} onSave={async d => { const ok = await add(d); if (ok) setAdding(false); }} />}
      {roleTarget && <RoleChangeModal target={roleTarget} notify={notify} onClose={() => setRoleTarget(null)} onSaved={saveUsers} />}
      {bulkOpen && <BulkUserModal teams={teams} onClose={() => setBulkOpen(false)} onImport={async rows => {
        try { const { imported } = await api.bulkCreateUsers(rows); notify(`Imported ${imported} user${imported === 1 ? "" : "s"}`, "success"); await saveUsers(); setBulkOpen(false); }
        catch (e) { notify(e.message, "error"); }
      }} />}
      {mergePreview && (
        <MergeReviewModal preview={mergePreview} notify={notify}
          onClose={() => setMergePreview(null)} onDone={saveUsers} />
      )}
    </div>
  );
}
// Tiny helper for the review step

function BulkUserModal({ teams, onClose, onImport }) {
  const [text, setText] = useState("name,email,password,role,team,teams\n" +
    "Jane Finance,jane.f@hqhb.in,Pass@1234,approver,,t_finance|t_it\n" +
    "Karim Ops,karim@hqhb.in,Pass@1234,requestor,t_ops,\n");
  const [parsed, setParsed] = useState([]);
  useEffect(() => {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return;
    const headers = lines[0].split(",").map(h => h.trim());
    const rows = lines.slice(1).map(l => {
      const cells = l.split(",").map(c => c.trim());
      const o = {}; headers.forEach((h, i) => o[h] = cells[i] || "");
      return o;
    });
    setParsed(rows);
  }, [text]);
  const importFile = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setText(reader.result);
    reader.readAsText(f);
  };
  return (
    <ModalShell title="Bulk upload users" onClose={onClose}>
      <div className="text-sm opacity-70 mb-3">Paste CSV text or upload a .csv file. Columns: <span className="font-mono text-xs">name,email,password,role,team,teams</span> (<code>teams</code> uses <code>|</code> to separate multiple team IDs; only for approvers).</div>
      <div className="text-xs opacity-60 mb-3 font-mono">Team IDs: {teams.map(t => `${t.id} = ${t.name}`).join(" · ")}</div>
      <input type="file" accept=".csv,text/csv" onChange={importFile} className="mb-3 text-xs" />
      <textarea rows={8} className="w-full font-mono text-xs" value={text} onChange={e => setText(e.target.value)} />
      <div className="mt-3 text-xs opacity-60">{parsed.length} row{parsed.length === 1 ? "" : "s"} ready to import.</div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onImport(parsed)} disabled={parsed.length === 0}>Import {parsed.length}</button>
      </div>
    </ModalShell>
  );
}

function AdminTeams({ teams, saveTeams, users, saveUsers, back, notify, onViewDocuments }) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const nameRef = useRef(null);
  const confirm = useConfirmation();
  const add = async () => {
    const clean = name.trim();
    // Never fail silently: an empty box used to make this button a dead click.
    if (!clean) { notify("Type a team name first", "info"); nameRef.current?.focus(); return; }
    if (teams.some(t => t.name.trim().toLowerCase() === clean.toLowerCase())) {
      notify(`"${clean}" already exists`, "error"); nameRef.current?.focus(); return;
    }
    setAdding(true);
    try {
      await api.createTeam(clean);
      setName("");
      await saveTeams();
      notify(`Team "${clean}" added — assign members and approvers below`, "success");
    }
    catch (e) { notify(e.message || "Could not add the team", "error"); }
    finally { setAdding(false); }
  };
  const remove = async (id, teamName) => {
    const ok = await confirm({
      title: `Remove ${teamName || "this team"}?`,
      message: "Approvers will lose authority over it and any members will be unassigned. Past requests are kept intact.",
      confirmLabel: "Remove team",
      destructive: true
    });
    if (!ok) return;
    try { await api.deleteTeam(id); notify("Team removed", "success"); await saveTeams(); await saveUsers(); }
    catch (e) { notify(e.message, "error"); }
  };
  return (
    <div>
      <BackHeader back={back} title="Teams & authority" step={`${teams.length} teams`} />
      <div className="flex gap-3 mt-6 max-w-md">
        <input ref={nameRef} placeholder="New team name" value={name} disabled={adding}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") add(); }}
          className="flex-1" maxLength={191} />
        <button className="btn-primary shrink-0" onClick={add} disabled={adding}>
          <Plus size={14} /> {adding ? "Adding…" : "Add team"}
        </button>
      </div>
      {teams.length === 0 && (
        <div className="card p-10 text-sm opacity-60 text-center mt-8">
          No teams yet. Create one above to get started.
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-5 mt-8">
        {teams.map(t => (
          <TeamCard key={t.id} team={t} teams={teams} users={users}
            onRemove={() => remove(t.id, t.name)}
            onChanged={async () => { await saveTeams(); await saveUsers(); }}
            onViewDocuments={onViewDocuments ? () => onViewDocuments(t.id) : null}
            notify={notify} />
        ))}
      </div>
    </div>
  );
}

// ============================================================
//   TEAM CARD — editable approvers + department members
// ============================================================
function TeamCard({ team, teams, users, onRemove, onChanged, onViewDocuments, notify }) {
  const [addApproverOpen, setAddApproverOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [approverQuery, setApproverQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [busy, setBusy] = useState(null); // userId currently being mutated
  const confirm = useConfirmation();
  // Any-role pickers can be long (every user is eligible) — searchable by name/email.
  const matches = (u, q) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (u.name || "").toLowerCase().includes(s) || (u.email || "").toLowerCase().includes(s);
  };

  // Anyone holding this team's signing authority is an approver for it —
  // whatever their role. Authority is what confers the right to sign, so an
  // admin can appoint a requestor, assistant or executive just the same.
  const approvers = users.filter(u => (u.signingAuthorityTeams || []).includes(team.id));
  const members = users.filter(u => u.team === team.id);

  // Eligible to be appointed: any active user not already authorised here.
  const eligibleApprovers = users.filter(u =>
    u.active !== false && !(u.signingAuthorityTeams || []).includes(team.id)
  );
  // Eligible as a department member: any active user not already in this team.
  const eligibleMembers = users.filter(u =>
    u.active !== false && u.team !== team.id
  );

  const grant = async (userId) => {
    setBusy(userId);
    try { await api.grantAuthority(team.id, userId); notify("Authority granted", "success"); await onChanged(); setAddApproverOpen(false); }
    catch (e) { notify(e.message || "Failed", "error"); }
    finally { setBusy(null); }
  };
  const revoke = async (userId, name) => {
    const ok = await confirm({
      title: `Revoke ${name}'s authority?`,
      message: `${name} will no longer be able to sign documents routed to ${team.name}.`,
      confirmLabel: "Revoke authority",
      destructive: true
    });
    if (!ok) return;
    setBusy(userId);
    try { await api.revokeAuthority(team.id, userId); notify("Authority revoked", "success"); await onChanged(); }
    catch (e) { notify(e.message || "Failed", "error"); }
    finally { setBusy(null); }
  };
  const assignMember = async (userId) => {
    setBusy(userId);
    try { await api.setUserTeam(userId, team.id); notify("Member assigned", "success"); await onChanged(); setAddMemberOpen(false); }
    catch (e) { notify(e.message || "Failed", "error"); }
    finally { setBusy(null); }
  };
  const removeMember = async (userId, name) => {
    const ok = await confirm({
      title: `Remove ${name} from ${team.name}?`,
      message: "They'll have no department until reassigned.",
      confirmLabel: "Remove member",
      destructive: true
    });
    if (!ok) return;
    setBusy(userId);
    try { await api.setUserTeam(userId, null); notify("Member removed", "success"); await onChanged(); }
    catch (e) { notify(e.message || "Failed", "error"); }
    finally { setBusy(null); }
  };

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Building2 size={18} className="shrink-0" />
          <div className="font-display text-lg sm:text-xl truncate">{team.name}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onViewDocuments && (
            <button onClick={onViewDocuments} className="btn-ghost text-xs" title="View this team's documents">
              <FileText size={12} /> <span className="hidden sm:inline">Documents</span>
            </button>
          )}
          <button onClick={onRemove} className="opacity-40 hover:opacity-100" title="Delete team"><Trash2 size={13} /></button>
        </div>
      </div>

      {/* Approvers section */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs tracking-wider uppercase opacity-50">Approvers ({approvers.length})</div>
          {eligibleApprovers.length > 0 && (
            <button className="btn-ghost text-xs" onClick={() => setAddApproverOpen(o => !o)}>
              <Plus size={11} /> Add
            </button>
          )}
        </div>
        {approvers.length === 0 ? (
          <div className="text-xs opacity-50 italic py-2">No approvers yet.</div>
        ) : (
          <div className="space-y-1">
            {approvers.map(a => (
              <div key={a.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded text-sm min-w-0" style={{ backgroundColor: "rgba(15,26,46,.04)" }}>
                {a.hasSignature
                  ? <PenTool size={11} className="shrink-0" style={{ color: "var(--c-gold)" }} />
                  : <PenTool size={11} className="opacity-30 shrink-0" />}
                <span className="flex-1 truncate min-w-0" title={a.email}>{a.name}</span>
                {a.role !== "approver" && (
                  <span className="pill text-[9px] shrink-0" title="Appointed as an approver for this team"
                    style={{ backgroundColor: "rgba(15,26,46,.06)" }}>{ROLE_LABELS[a.role] || a.role}</span>
                )}
                {!a.hasSignature && <span className="pill pill-rejected text-[10px] shrink-0">no sig</span>}
                <button onClick={() => revoke(a.id, a.name)} disabled={busy === a.id}
                  className="opacity-40 hover:opacity-100 text-xs" title="Revoke authority">
                  {busy === a.id ? "…" : <X size={12} />}
                </button>
              </div>
            ))}
          </div>
        )}
        {addApproverOpen && eligibleApprovers.length > 0 && (
          <div className="card p-2 mt-2" style={{ backgroundColor: "var(--c-paper)" }}>
            <input autoFocus value={approverQuery} onChange={e => setApproverQuery(e.target.value)}
              placeholder={`Search ${eligibleApprovers.length} users…`} className="w-full text-xs mb-2" />
            <div className="max-h-48 overflow-auto">
              {eligibleApprovers.filter(u => matches(u, approverQuery)).slice(0, 60).map(u => (
                <button key={u.id} className="w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:opacity-70 min-w-0"
                  onClick={() => grant(u.id)} disabled={busy === u.id}>
                  <PenTool size={11} className={`shrink-0 ${u.hasSignature ? "" : "opacity-30"}`} style={u.hasSignature ? { color: "var(--c-gold)" } : {}} />
                  <span className="flex-1 truncate min-w-0" title={u.email}>{u.name}</span>
                  <span className="pill text-[9px] shrink-0" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>{ROLE_LABELS[u.role] || u.role}</span>
                  {!u.hasSignature && <span className="pill pill-rejected text-[10px] shrink-0">no sig</span>}
                  <span className="text-xs opacity-50 shrink-0">{busy === u.id ? "…" : "+"}</span>
                </button>
              ))}
              {eligibleApprovers.filter(u => matches(u, approverQuery)).length === 0 && (
                <div className="text-xs opacity-50 italic px-2 py-2">No users match "{approverQuery}".</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Members section */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs tracking-wider uppercase opacity-50">Department members ({members.length})</div>
          {eligibleMembers.length > 0 && (
            <button className="btn-ghost text-xs" onClick={() => setAddMemberOpen(o => !o)}>
              <Plus size={11} /> Add
            </button>
          )}
        </div>
        {members.length === 0 ? (
          <div className="text-xs opacity-50 italic py-2">No members yet.</div>
        ) : (
          <div className="space-y-1">
            {members.map(m => (
              <div key={m.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded text-sm" style={{ backgroundColor: "rgba(15,26,46,.04)" }}>
                <UserPlus size={11} className="opacity-50" />
                <span className="flex-1">{m.name}</span>
                <button onClick={() => removeMember(m.id, m.name)} disabled={busy === m.id}
                  className="opacity-40 hover:opacity-100 text-xs" title="Remove from department">
                  {busy === m.id ? "…" : <X size={12} />}
                </button>
              </div>
            ))}
          </div>
        )}
        {addMemberOpen && eligibleMembers.length > 0 && (
          <div className="card p-2 mt-2" style={{ backgroundColor: "var(--c-paper)" }}>
            <input autoFocus value={memberQuery} onChange={e => setMemberQuery(e.target.value)}
              placeholder={`Search ${eligibleMembers.length} users…`} className="w-full text-xs mb-2" />
            <div className="max-h-48 overflow-auto">
              {eligibleMembers.filter(u => matches(u, memberQuery)).slice(0, 60).map(u => {
                const currentTeam = teams.find(t => t.id === u.team);
                return (
                  <button key={u.id} className="w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:opacity-70 min-w-0"
                    onClick={() => assignMember(u.id)} disabled={busy === u.id}>
                    <UserPlus size={11} className="opacity-50 shrink-0" />
                    <span className="flex-1 truncate min-w-0" title={u.email}>{u.name}</span>
                    {currentTeam && <span className="text-[10px] opacity-50 shrink-0 truncate max-w-[90px]">from {currentTeam.name}</span>}
                    <span className="text-xs opacity-50 shrink-0">{busy === u.id ? "…" : "+"}</span>
                  </button>
                );
              })}
              {eligibleMembers.filter(u => matches(u, memberQuery)).length === 0 && (
                <div className="text-xs opacity-50 italic px-2 py-2">No users match "{memberQuery}".</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function AdminSignatures({ users, saveUsers, back, notify }) {
  const [target, setTarget] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const withoutSig = users.filter(u => u.role !== "admin" && !u.hasSignature);
  const withSig = users.filter(u => u.role !== "admin" && u.hasSignature);

  const setSig = async (id, dataUrl) => {
    try {
      // Convert dataUrl to File and use admin endpoint
      const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/.exec(dataUrl);
      if (!match) throw new Error("Unsupported image");
      const ext = match[1] === "jpeg" ? "jpg" : match[1];
      const bin = atob(match[2]);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new File([u8], `${id}.${ext}`, { type: `image/${ext === "jpg" ? "jpeg" : ext}` });
      await api.setUserSignature(id, file);
      notify("Signature saved", "success");
      await saveUsers();
    } catch (e) { notify(e.message, "error"); }
  };

  return (
    <div>
      <BackHeader back={back} title="Signatures" step={`${withSig.length} / ${withSig.length + withoutSig.length} on file`} />
      <div className="flex justify-end gap-3 mt-6 mb-4">
        <button className="btn-ghost" onClick={() => setBulkOpen(true)}><Upload size={14} /> Bulk upload</button>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="card p-5 min-w-0">
          <div className="font-display text-xl mb-3">Without signature</div>
          {withoutSig.length === 0 ? <div className="text-sm opacity-50">Everyone has a signature.</div> : withoutSig.map(u => (
            <div key={u.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0 text-sm" style={{ borderColor: "rgba(15,26,46,.06)" }}>
              <div className="min-w-0">
                <div className="font-medium truncate">{u.name}</div>
                <div className="text-xs opacity-60 font-mono truncate">{u.email} · {u.role}</div>
              </div>
              <button className="btn-gold text-xs shrink-0" onClick={() => setTarget(u)}><PenTool size={12} /> Add</button>
            </div>
          ))}
        </div>
        <div className="card p-5 min-w-0">
          <div className="font-display text-xl mb-3">On file</div>
          {withSig.map(u => (
            <div key={u.id} className="flex items-center justify-between gap-3 py-3 border-b last:border-0" style={{ borderColor: "rgba(15,26,46,.06)" }}>
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{u.name}</div>
                <div className="text-xs opacity-60 font-mono">{u.role}</div>
              </div>
              <SignatureImage userId={u.id} />
              <button className="btn-ghost text-xs shrink-0" onClick={() => setTarget(u)}>Replace</button>
            </div>
          ))}
        </div>
      </div>
      {target && <SignatureModal title={`Signature — ${target.name}`} subtitle="Draw or upload an image." onCancel={() => setTarget(null)} onSave={async url => { await setSig(target.id, url); setTarget(null); }} />}
      {bulkOpen && <BulkSignatureModal users={users} onClose={() => setBulkOpen(false)} onDone={async files => {
        try { const r = await api.bulkUploadSignatures(files); notify(`Assigned ${r.matched} signature${r.matched === 1 ? "" : "s"}`, "success"); await saveUsers(); setBulkOpen(false); }
        catch (e) { notify(e.message, "error"); }
      }} />}
    </div>
  );
}

function BulkSignatureModal({ users, onClose, onDone }) {
  const [pairs, setPairs] = useState([]); // [{email, fileName, dataUrl, matched, file}]
  const onFiles = async e => {
    const files = Array.from(e.target.files || []);
    const next = [];
    for (const f of files) {
      const email = f.name.replace(/\.(png|jpg|jpeg)$/i, "").toLowerCase();
      const matched = users.find(u => u.email.toLowerCase() === email);
      const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      next.push({ email, fileName: f.name, dataUrl, matched: !!matched, file: f });
    }
    setPairs(next);
  };
  const valid = pairs.filter(p => p.matched);
  return (
    <ModalShell title="Bulk upload signatures" onClose={onClose}>
      <div className="text-sm opacity-70 mb-3">Name each image file as the user's email, e.g. <span className="font-mono text-xs">mufaddal.safdari@hqhb.in.png</span>. Supports PNG / JPG.</div>
      <input type="file" accept="image/png,image/jpeg" multiple onChange={onFiles} className="text-xs mb-3" />
      <div className="max-h-72 overflow-auto">
        {pairs.map((p, i) => (
          <div key={i} className="flex items-center gap-3 py-2 border-b text-sm" style={{ borderColor: "rgba(15,26,46,.06)" }}>
            <img src={p.dataUrl} alt="" style={{ height: 30, maxWidth: 100, objectFit: "contain" }} />
            <div className="flex-1 min-w-0 font-mono text-xs truncate">{p.email}</div>
            {p.matched ? <Check size={14} style={{ color: "var(--c-forest)" }} /> : <X size={14} style={{ color: "var(--c-rust)" }} />}
          </div>
        ))}
      </div>
      <div className="text-xs opacity-60 mt-3">{valid.length} of {pairs.length} matched to users.</div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={valid.length === 0} onClick={() => onDone(valid.map(p => p.file))}>Assign {valid.length}</button>
      </div>
    </ModalShell>
  );
}

function AdminDocuments({ requests, users, teams, user, back, defaultTeamId }) {
  const [filter, setFilter] = useState("all");
  const [teamId, setTeamId] = useState(defaultTeamId || "all");
  const teamName = teamId === "all" ? "All teams" : (teams.find(t => t.id === teamId)?.name || "—");

  const list = requests.filter(r => {
    if (teamId !== "all" && r.targetTeamId !== teamId) return false;
    if (filter === "all") return true;
    if (filter === "approved") return r.status === "approved" || r.status === "approved_pending";
    return r.status === filter;
  });

  // Stats for the chip row
  const inTeam = teamId === "all" ? requests : requests.filter(r => r.targetTeamId === teamId);
  const stats = {
    all: inTeam.length,
    pending: inTeam.filter(r => r.status === "pending" || r.status === "approved_pending").length,
    approved: inTeam.filter(r => r.status === "approved" || r.status === "approved_pending").length,
    rejected: inTeam.filter(r => r.status === "rejected").length
  };

  return (
    <div>
      <BackHeader back={back} title={teamId === "all" ? "All documents" : `${teamName} · Documents`} step={`${inTeam.length} total`} />

      {/* Team picker */}
      <div className="card p-4 mt-6 flex flex-wrap items-center gap-3">
        <Building2 size={14} className="opacity-50" />
        <label className="text-xs tracking-wider uppercase opacity-60">Team</label>
        <select value={teamId} onChange={e => setTeamId(e.target.value)} className="text-sm">
          <option value="all">All teams</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="flex-1" />
        <div className="text-xs opacity-60 hidden sm:block">
          <span className="font-mono">{stats.pending}</span> pending ·{" "}
          <span className="font-mono" style={{ color: "var(--c-forest)" }}>{stats.approved}</span> approved ·{" "}
          <span className="font-mono" style={{ color: "var(--c-rust)" }}>{stats.rejected}</span> rejected
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2 mt-4 mb-4">
        {["all", "pending", "approved", "rejected"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs tracking-wider uppercase transition ${filter === f ? "" : "opacity-50"}`}
            style={{ backgroundColor: filter === f ? "#0F1A2E" : "transparent", color: filter === f ? "#F5F1E8" : "#0F1A2E", border: "1px solid rgba(15,26,46,.18)" }}>
            {f} {stats[f] > 0 && <span className="opacity-60">· {stats[f]}</span>}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {list.length === 0 ? <div className="p-10 text-center opacity-50 text-sm">No documents.</div> :
          list.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={<div className="flex flex-wrap gap-2"><DownloadBtn req={r} user={user} /><PrintBtn req={r} /></div>} />
          ))}
      </div>
    </div>
  );
}

// Human duration: "2d 3h" / "5h 12m" / "45m" / "<1m".
function fmtDur(ms) {
  if (ms == null || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), rm = mins % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

// Build a CSV from a header + rows (arrays of cells) and trigger a download.
function downloadCsv(filename, header, rows) {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map(r => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const REPORT_TABS = [
  { key: "approver", label: "By approver" },
  { key: "department", label: "By department" },
  { key: "delays", label: "Approval delays" },
  { key: "requestor", label: "By requestor" },
];

function AdminReports({ requests, users, teams, back }) {
  const [reportType, setReportType] = useState("approver");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [approverId, setApproverId] = useState("");
  const [deptTeamId, setDeptTeamId] = useState("");

  // Date inputs are interpreted in the viewer's clock (IST for this app).
  const from = fromDate ? new Date(fromDate + "T00:00:00").getTime() : null;
  const to = toDate ? new Date(toDate + "T23:59:59.999").getTime() : null;
  const pass = (ts) => {
    if (from == null && to == null) return true;
    if (ts == null) return false;
    return (from == null || ts >= from) && (to == null || ts <= to);
  };
  const teamName = (id) => teams.find(t => t.id === id)?.name || "—";
  const userDept = (uid) => { const u = users.find(x => x.id === uid); return teams.find(t => t.id === u?.team)?.name || u?.department || "—"; };

  // Every approval action — the direct team-approver OR each workflow signature —
  // as one event per actor per request, with the time taken from raise to approve.
  const approvalEvents = useMemo(() => {
    const ev = [];
    for (const r of requests) {
      const hasWf = (r.workflow || []).some(s => s.signers.length);
      if (hasWf) {
        for (const st of r.workflow) for (const sg of st.signers) if (sg.status === "signed")
          ev.push({ userId: sg.userId, userName: sg.userName, r, ts: sg.signedAt || null });
      } else if (r.approverId && (r.status === "approved" || r.status === "approved_pending")) {
        ev.push({ userId: r.approverId, userName: r.approverName, r, ts: r.approvedAt || r.finalizedAt || null });
      }
    }
    return ev.map(e => ({ ...e, timeMs: (e.ts != null && e.r.createdAt != null) ? e.ts - e.r.createdAt : null }));
  }, [requests]);

  const approverOptions = useMemo(() => {
    const seen = new Map();
    for (const e of approvalEvents) if (e.userId && !seen.has(e.userId))
      seen.set(e.userId, e.userName || users.find(u => u.id === e.userId)?.name || e.userId);
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [approvalEvents, users]);

  const approverData = useMemo(() =>
    approverId ? approvalEvents.filter(e => e.userId === approverId && pass(e.ts)).sort((a, b) => (b.ts || 0) - (a.ts || 0)) : [],
    [approvalEvents, approverId, from, to]);
  const approverAvg = useMemo(() => {
    const t = approverData.map(e => e.timeMs).filter(v => v != null);
    return t.length ? t.reduce((a, b) => a + b, 0) / t.length : null;
  }, [approverData]);

  const deptData = useMemo(() =>
    deptTeamId ? requests.filter(r => r.targetTeamId === deptTeamId && pass(r.createdAt)).sort((a, b) => b.createdAt - a.createdAt) : [],
    [requests, deptTeamId, from, to]);
  const deptSummary = useMemo(() => ({
    total: deptData.length,
    approved: deptData.filter(r => r.status === "approved").length,
    pending: deptData.filter(r => r.status === "pending" || r.status === "approved_pending").length,
    rejected: deptData.filter(r => r.status === "rejected").length,
    withdrawn: deptData.filter(r => r.status === "withdrawn").length,
  }), [deptData]);

  const delayData = useMemo(() => {
    const map = new Map();
    for (const e of approvalEvents) {
      if (e.timeMs == null || !pass(e.ts)) continue;
      if (!map.has(e.userId)) map.set(e.userId, { id: e.userId, name: e.userName || users.find(u => u.id === e.userId)?.name || "—", times: [] });
      map.get(e.userId).times.push(e.timeMs);
    }
    return [...map.values()].map(a => {
      const n = a.times.length, sum = a.times.reduce((x, y) => x + y, 0);
      return { id: a.id, name: a.name, count: n, avg: sum / n, min: Math.min(...a.times), max: Math.max(...a.times) };
    }).sort((x, y) => y.avg - x.avg);
  }, [approvalEvents, users, from, to]);

  const requestorData = useMemo(() => {
    const map = new Map();
    for (const r of requests) {
      if (!pass(r.createdAt)) continue;
      const id = r.requestorId;
      if (!map.has(id)) map.set(id, { id, name: r.requestorName || users.find(u => u.id === id)?.name || "—", total: 0, approved: 0, pending: 0, rejected: 0 });
      const m = map.get(id); m.total++;
      if (r.status === "approved") m.approved++;
      else if (r.status === "rejected") m.rejected++;
      else m.pending++;
    }
    return [...map.values()].map(m => ({ ...m, dept: userDept(m.id) })).sort((a, b) => b.total - a.total);
  }, [requests, users, teams, from, to]);

  const activeData = reportType === "approver" ? approverData : reportType === "department" ? deptData : reportType === "delays" ? delayData : requestorData;
  const rangeTag = `${fromDate || "start"}_${toDate || "today"}`;

  const doDownload = () => {
    if (reportType === "approver") {
      const who = approverOptions.find(a => a.id === approverId)?.name || "approver";
      downloadCsv(`approver-${who}-${rangeTag}.csv`,
        ["File", "Requestor", "Approving team", "Type", "Status", "Submitted (IST)", "Approved (IST)", "Time taken"],
        approverData.map(e => [e.r.fileName, e.r.requestorName || "", teamName(e.r.targetTeamId), requestTypeLabel(e.r.requestType), e.r.status, fmt(e.r.createdAt), e.ts ? fmt(e.ts) : "", fmtDur(e.timeMs)]));
    } else if (reportType === "department") {
      downloadCsv(`department-${teamName(deptTeamId)}-${rangeTag}.csv`,
        ["File", "Requestor", "Type", "Status", "Submitted (IST)", "Completed (IST)"],
        deptData.map(r => [r.fileName, r.requestorName || "", requestTypeLabel(r.requestType), r.status, fmt(r.createdAt), r.finalizedAt ? fmt(r.finalizedAt) : ""]));
    } else if (reportType === "delays") {
      downloadCsv(`approval-delays-${rangeTag}.csv`,
        ["Approver", "Approved count", "Average time", "Fastest", "Slowest"],
        delayData.map(a => [a.name, a.count, fmtDur(a.avg), fmtDur(a.min), fmtDur(a.max)]));
    } else {
      downloadCsv(`requestor-${rangeTag}.csv`,
        ["Requestor", "Department", "Total", "Approved", "Pending", "Rejected"],
        requestorData.map(m => [m.name, m.dept, m.total, m.approved, m.pending, m.rejected]));
    }
  };

  const th = "px-3 sm:px-4 py-2 text-left text-[10px] uppercase tracking-wider opacity-50 whitespace-nowrap";
  const td = "px-3 sm:px-4 py-2 whitespace-nowrap";

  return (
    <div>
      <BackHeader back={back} title="Reports" step={REPORT_TABS.find(t => t.key === reportType)?.label} />

      <div className="card p-4 sm:p-5 mt-6">
        <div className="flex flex-wrap gap-2 mb-4">
          {REPORT_TABS.map(t => (
            <button key={t.key} onClick={() => setReportType(t.key)}
              className={`text-xs ${reportType === t.key ? "btn-primary" : "btn-ghost"}`}>{t.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] tracking-wider uppercase opacity-50 mb-1">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="text-sm" style={{ minWidth: 140 }} />
          </div>
          <div>
            <label className="block text-[10px] tracking-wider uppercase opacity-50 mb-1">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="text-sm" style={{ minWidth: 140 }} />
          </div>
          {(fromDate || toDate) && <button className="btn-ghost text-xs" onClick={() => { setFromDate(""); setToDate(""); }}>Clear</button>}
          {reportType === "approver" && (
            <div>
              <label className="block text-[10px] tracking-wider uppercase opacity-50 mb-1">Approver</label>
              <select value={approverId} onChange={e => setApproverId(e.target.value)} className="text-sm" style={{ minWidth: 200 }}>
                <option value="">Select approver…</option>
                {approverOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          {reportType === "department" && (
            <div>
              <label className="block text-[10px] tracking-wider uppercase opacity-50 mb-1">Department (approving team)</label>
              <select value={deptTeamId} onChange={e => setDeptTeamId(e.target.value)} className="text-sm" style={{ minWidth: 200 }}>
                <option value="">Select department…</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex-1" />
          <button className="btn-primary text-sm" onClick={doDownload} disabled={activeData.length === 0}>
            <Download size={14} /> Download CSV
          </button>
        </div>
        <div className="text-[11px] opacity-50 mt-2">
          {(!fromDate && !toDate) ? "All dates · times shown in IST. Pick a range to narrow." : `${fromDate || "start"} → ${toDate || "today"} · times in IST`}
        </div>
      </div>

      {/* ---- By approver ---- */}
      {reportType === "approver" && (
        !approverId ? <Empty icon={BarChart3} text="Select an approver to list everything they've approved." />
        : approverData.length === 0 ? <Empty icon={BarChart3} text="No approvals for this approver in the selected range." />
        : (
          <>
            <div className="text-sm opacity-70 mt-6 mb-2">{approverData.length} document{approverData.length === 1 ? "" : "s"} approved{approverAvg != null && <> · average <b>{fmtDur(approverAvg)}</b> to approve</>}</div>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead><tr>{["File", "Requestor", "Team", "Submitted", "Approved", "Time taken"].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {approverData.map((e, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: "var(--c-ink-08)" }}>
                      <td className={`${td} font-medium`} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{e.r.fileName}</td>
                      <td className={`${td} opacity-70`}>{e.r.requestorName || "—"}</td>
                      <td className={`${td} opacity-70`}>{teamName(e.r.targetTeamId)}</td>
                      <td className={`${td} opacity-70`}>{fmt(e.r.createdAt)}</td>
                      <td className={td}>{e.ts ? fmt(e.ts) : "—"}</td>
                      <td className={`${td} font-medium`}>{fmtDur(e.timeMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {/* ---- By department (approving team) ---- */}
      {reportType === "department" && (
        !deptTeamId ? <Empty icon={BarChart3} text="Select a department to list the requests routed to it." />
        : deptData.length === 0 ? <Empty icon={BarChart3} text="No requests for this department in the selected range." />
        : (
          <>
            <div className="text-sm opacity-70 mt-6 mb-2">
              {deptSummary.total} request{deptSummary.total === 1 ? "" : "s"} ·
              <span style={{ color: "var(--c-forest)" }}> {deptSummary.approved} approved</span> ·
              <span> {deptSummary.pending} pending</span> ·
              <span style={{ color: "var(--c-rust)" }}> {deptSummary.rejected} rejected</span>
              {deptSummary.withdrawn > 0 && <span className="opacity-60"> · {deptSummary.withdrawn} withdrawn</span>}
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead><tr>{["File", "Requestor", "Type", "Status", "Submitted", "Completed"].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {deptData.map((r, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: "var(--c-ink-08)" }}>
                      <td className={`${td} font-medium`} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{r.fileName}</td>
                      <td className={`${td} opacity-70`}>{r.requestorName || "—"}</td>
                      <td className={`${td} opacity-70`}>{requestTypeLabel(r.requestType)}</td>
                      <td className={td}><StatusPill status={r.status} /></td>
                      <td className={`${td} opacity-70`}>{fmt(r.createdAt)}</td>
                      <td className={`${td} opacity-70`}>{r.finalizedAt ? fmt(r.finalizedAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {/* ---- Approval delays ---- */}
      {reportType === "delays" && (
        delayData.length === 0 ? <Empty icon={Clock} text="No approvals in the selected range." />
        : (
          <>
            <div className="text-sm opacity-70 mt-6 mb-2">Ranked slowest → fastest by average time from request to approval.</div>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead><tr>{["Approver", "Approved", "Average", "Fastest", "Slowest"].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {delayData.map((a, i) => (
                    <tr key={a.id} className="border-t" style={{ borderColor: "var(--c-ink-08)" }}>
                      <td className={`${td} font-medium`}>
                        {a.name}
                        {delayData.length > 1 && i === 0 && <span className="pill ml-2 text-[9px]" style={{ backgroundColor: "rgba(155,44,44,.10)", color: "var(--c-rust-deep)" }}>slowest</span>}
                        {delayData.length > 1 && i === delayData.length - 1 && <span className="pill ml-2 text-[9px]" style={{ backgroundColor: "rgba(45,95,47,.10)", color: "var(--c-forest)" }}>fastest</span>}
                      </td>
                      <td className={`${td} font-mono`}>{a.count}</td>
                      <td className={`${td} font-medium`}>{fmtDur(a.avg)}</td>
                      <td className={td} style={{ color: "var(--c-forest)" }}>{fmtDur(a.min)}</td>
                      <td className={td} style={{ color: "var(--c-rust)" }}>{fmtDur(a.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {/* ---- By requestor ---- */}
      {reportType === "requestor" && (
        requestorData.length === 0 ? <Empty icon={BarChart3} text="No requests submitted in the selected range." />
        : (
          <>
            <div className="text-sm opacity-70 mt-6 mb-2">{requestorData.length} requestor{requestorData.length === 1 ? "" : "s"} · {requestorData.reduce((n, m) => n + m.total, 0)} request{requestorData.reduce((n, m) => n + m.total, 0) === 1 ? "" : "s"} total.</div>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead><tr>{["Requestor", "Department", "Total", "Approved", "Pending", "Rejected"].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {requestorData.map(m => (
                    <tr key={m.id} className="border-t" style={{ borderColor: "var(--c-ink-08)" }}>
                      <td className={`${td} font-medium`}>{m.name}</td>
                      <td className={`${td} opacity-70`}>{m.dept}</td>
                      <td className={`${td} font-mono`}>{m.total}</td>
                      <td className={`${td} font-mono`} style={{ color: "var(--c-forest)" }}>{m.approved}</td>
                      <td className={`${td} font-mono`}>{m.pending}</td>
                      <td className={`${td} font-mono`} style={{ color: "var(--c-rust)" }}>{m.rejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </div>
  );
}

function AdminEmails({ emails, back }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <BackHeader back={back} title="SendGrid log" step={`${emails.length} recorded`} />
      <div className="card p-4 mt-3 text-xs flex items-start gap-3" style={{ backgroundColor: "rgba(184,137,74,.1)" }}>
        <AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: "var(--c-sand)" }} />
        <div>Every email triggered by SignFlow is recorded here. When <span className="font-mono">SENDGRID_API_KEY</span> is set on the server, messages are actually delivered and marked as such. Otherwise they are recorded but not sent.</div>
      </div>
      <div className="card mt-4 overflow-hidden">
        {emails.length === 0 ? <div className="p-10 text-center opacity-50 text-sm">No emails sent yet.</div> : emails.map((e, i) => (
          <button key={e.id} onClick={() => setOpen(e)}
            className={`w-full text-left px-5 py-4 flex items-start gap-4 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "rgba(15,26,46,.06)" }}>
            <Mail size={15} className="opacity-50 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm truncate">{e.subject}</div>
                <div className="text-xs opacity-50">{fmtShort(e.sentAt)}</div>
              </div>
              <div className="text-xs opacity-60 font-mono mt-1">to {e.to}</div>
              <div className="text-xs mt-1 flex items-center gap-2">
                <span className="pill pill-pending">{e.template}</span>
                {e.delivered
                  ? <span className="pill pill-approved">delivered</span>
                  : e.error ? <span className="pill pill-rejected">failed</span> : <span className="pill pill-approved-pending">logged</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
      {open && (
        <ModalShell title={open.subject} onClose={() => setOpen(null)}>
          <div className="text-xs font-mono opacity-60 mb-3">to {open.to} · {fmt(open.sentAt)}</div>
          {open.error && <div className="text-xs mb-3 p-3 rounded" style={{ backgroundColor: "rgba(155,44,44,.1)", color: "var(--c-rust-deep)" }}>SendGrid error: {open.error}</div>}
          <pre className="text-sm whitespace-pre-wrap" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>{open.body}</pre>
        </ModalShell>
      )}
    </div>
  );
}

function AdminPasswordResets({ notify, back }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listPasswordResets();
      setItems(data.resets || []);
      setPending(data.pending || 0);
    } catch (e) {
      notify?.(e.message || "Could not load reset requests", "error");
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const approve = async (r) => {
    try { await api.approvePasswordReset(r.id); notify?.(`Password reset approved for ${r.userName || r.email}.`, "success"); await load(); }
    catch (e) { notify?.(e.message || "Could not approve", "error"); }
  };
  const reject = async (r) => {
    const reason = window.prompt(`Reject the reset request for ${r.userName || r.email}? Optional reason:`, "");
    if (reason === null) return;
    try { await api.rejectPasswordReset(r.id, reason); notify?.("Reset request rejected.", "info"); await load(); }
    catch (e) { notify?.(e.message || "Could not reject", "error"); }
  };

  const pillFor = s => s === "pending" ? "pill-pending" : s === "approved" ? "pill-approved" : "pill-rejected";

  return (
    <div>
      <BackHeader back={back} title="Password resets" step={`${pending} pending`} />
      <div className="card mt-4 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center opacity-50 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center opacity-50 text-sm">No password-reset requests.</div>
        ) : items.map((r, i) => (
          <div key={r.id} className={`px-5 py-4 flex items-start gap-4 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "rgba(15,26,46,.06)" }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{r.userName || "(unknown user)"}</span>
                <span className={`pill ${pillFor(r.status)}`}>{r.status}</span>
              </div>
              <div className="text-xs opacity-60 font-mono mt-1">{r.email}</div>
              <div className="text-xs opacity-60 mt-1">
                Requested password: <span className="font-mono">{r.newPassword || "—"}</span> · {fmtShort(r.createdAt)}
                {r.status === "rejected" && r.rejectReason ? ` · Reason: ${r.rejectReason}` : ""}
              </div>
            </div>
            {r.status === "pending" && (
              <div className="flex gap-2 shrink-0">
                <button className="btn-ghost text-xs" onClick={() => reject(r)}>Reject</button>
                <button className="btn-primary text-xs" onClick={() => approve(r)}><Check size={13} /> Approve</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminRegistrations({ notify, back }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listRegistrations();
      setItems(data.registrations || []);
      setPending(data.pending || 0);
    } catch (e) {
      notify?.(e.message || "Could not load registrations", "error");
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const approve = async (r) => {
    try { await api.approveRegistration(r.id); notify?.(`${r.name} approved — they can now sign in.`, "success"); await load(); }
    catch (e) { notify?.(e.message || "Could not approve", "error"); }
  };
  const reject = async (r) => {
    const reason = window.prompt(`Reject ${r.name}'s registration? Optional reason:`, "");
    if (reason === null) return;
    try { await api.rejectRegistration(r.id, reason); notify?.(`${r.name}'s registration rejected.`, "info"); await load(); }
    catch (e) { notify?.(e.message || "Could not reject", "error"); }
  };

  const pillFor = s => s === "pending" ? "pill-pending" : s === "approved" ? "pill-approved" : "pill-rejected";

  return (
    <div>
      <BackHeader back={back} title="Registrations" step={`${pending} pending`} />
      <div className="card mt-4 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center opacity-50 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center opacity-50 text-sm">No registration requests yet.</div>
        ) : items.map((r, i) => (
          <div key={r.id} className={`px-5 py-4 flex items-start gap-4 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "rgba(15,26,46,.06)" }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{r.name}</span>
                <span className={`pill ${pillFor(r.status)}`}>{r.status}</span>
              </div>
              <div className="text-xs opacity-60 font-mono mt-1">{r.email}</div>
              <div className="text-xs opacity-60 mt-1">
                Team: {r.teamName || "—"} · Manager: {r.reportingManager || "—"} · {fmtShort(r.createdAt)}
                {r.status === "rejected" && r.rejectReason ? ` · Reason: ${r.rejectReason}` : ""}
              </div>
            </div>
            {r.status === "pending" && (
              <div className="flex gap-2 shrink-0">
                <button className="btn-ghost text-xs" onClick={() => reject(r)}>Reject</button>
                <button className="btn-primary text-xs" onClick={() => approve(r)}><Check size={13} /> Approve</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// DISABLED: expense feature commented out — AdminExpenses is no longer referenced (route + tile commented out). Kept for easy re-enable.
function AdminExpenses({ notify, back }) {
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState({ count: 0, total: 0, repaid: 0, outstanding: 0 });
  const [filter, setFilter] = useState("all"); // all | outstanding | repaid

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listExpenses();
      setExpenses(data.expenses || []);
      setSummary(data.summary || { count: 0, total: 0, repaid: 0, outstanding: 0 });
    } catch (e) {
      notify?.(e.message || "Could not load expenses", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (exp) => {
    try {
      await api.setExpenseRepayment(exp.id, !exp.repaymentDone);
      await load();
    } catch (e) {
      notify?.(e.message || "Could not update repayment", "error");
    }
  };

  const inr = n => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Build + download an .xlsx of all expenses. xlsx ships in the lazy chunk, so import on demand.
  const exportXlsx = async () => {
    if (!expenses.length) return;
    const XLSX = await import("xlsx");
    const data = expenses.map(e => ({
      Date: e.date,
      "Paid By": e.paidBy,
      Description: e.description || "",
      "Amount (INR)": e.amount,
      Repayment: e.repaymentDone ? "Done" : "Outstanding",
      Submitted: new Date(e.createdAt).toLocaleString("en-IN")
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, { wch: 20 }, { wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Expenses");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([new Uint8Array(out)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const shown = expenses.filter(e =>
    filter === "all" ? true : filter === "repaid" ? e.repaymentDone : !e.repaymentDone
  );

  return (
    <div>
      <BackHeader back={back} title="Expenses" step={`${summary.count} recorded`} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div className="card p-5">
          <div className="text-[10px] tracking-wider uppercase opacity-50">Entries</div>
          <div className="font-display text-2xl mt-1">{summary.count}</div>
        </div>
        <div className="card p-5">
          <div className="text-[10px] tracking-wider uppercase opacity-50">Total</div>
          <div className="font-display text-2xl mt-1">{inr(summary.total)}</div>
        </div>
        <div className="card p-5">
          <div className="text-[10px] tracking-wider uppercase opacity-50">Repaid</div>
          <div className="font-display text-2xl mt-1" style={{ color: "var(--c-forest)" }}>{inr(summary.repaid)}</div>
        </div>
        <div className="card p-5">
          <div className="text-[10px] tracking-wider uppercase opacity-50">Outstanding</div>
          <div className="font-display text-2xl mt-1" style={{ color: "var(--c-rust)" }}>{inr(summary.outstanding)}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mt-8 mb-4">
        <div className="flex gap-2">
          {["all", "outstanding", "repaid"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded text-sm capitalize ${filter === f ? "btn-primary" : "btn-ghost"}`}>
              {f}
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={exportXlsx} disabled={!expenses.length}
          title="Download all expenses as an Excel file">
          <Download size={14} /> Download Excel
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-12 text-[10px] tracking-wider uppercase opacity-50 px-5 py-3 border-b" style={{ borderColor: "var(--c-ink-08)" }}>
          <div className="col-span-2">Date</div>
          <div className="col-span-4">Paid by</div>
          <div className="col-span-2">Amount</div>
          <div className="col-span-2">Repayment</div>
          <div className="col-span-2">Submitted</div>
        </div>
        {loading ? (
          <div className="p-10 text-center opacity-50 text-sm">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="p-10 text-center opacity-50 text-sm">No expenses{filter !== "all" ? ` (${filter})` : ""} yet.</div>
        ) : shown.map((e, i) => (
          <div key={e.id} className={`grid grid-cols-12 items-center px-5 py-4 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "rgba(15,26,46,.06)" }}>
            <div className="col-span-2 text-sm">{e.date}</div>
            <div className="col-span-4 min-w-0">
              <div className="font-medium text-sm truncate">{e.paidBy}</div>
              {e.description ? <div className="text-xs opacity-50 truncate" title={e.description}>{e.description}</div> : null}
            </div>
            <div className="col-span-2 font-mono text-sm">{inr(e.amount)}</div>
            <div className="col-span-2">
              <button onClick={() => toggle(e)}
                className={`pill ${e.repaymentDone ? "pill-approved" : "pill-rejected"}`}
                title="Click to toggle repayment">
                {e.repaymentDone ? "Repaid" : "Outstanding"}
              </button>
            </div>
            <div className="col-span-2 text-xs opacity-50">{fmtShort(e.createdAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


