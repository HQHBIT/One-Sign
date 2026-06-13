import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import {
  FileText, Upload, CheckCircle, XCircle, Clock, Users, LogOut,
  PenTool, Download, Eye, Bell, Mail, BarChart3, Shield, UserPlus,
  FilePlus, AlertCircle, Plus, X, Check, ArrowRight, ArrowLeft, Building2,
  RefreshCw, Send, Inbox, Archive, ChevronRight, ChevronDown, Undo2, Trash2,
  FileSpreadsheet, Stamp, History, Zap, GitBranch, Eye as EyeIcon, EyeOff, Printer
} from "lucide-react";
import { api } from "./api.js";
import {
  ROLES, ROLE_LABELS, STATUS, STATUS_LABELS,
  APPROVAL_WINDOW_MS, REMINDER_COOLDOWN_MS,
  COLORS, STEP_COLORS, REQUEST_TYPES, requestTypeLabel, requestTypeColor
} from "./lib/constants.js";
import { uid, fmt, fmtShort } from "./lib/format.js";
import { useBackHandler, useEscapeKey } from "./lib/useBackHandler.js";
import { useConfirm, useConfirmation, ConfirmContext } from "./lib/useConfirm.jsx";

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

// ============================================================
//   ROOT APP
// ============================================================
export default function App() {
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState(null);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [emails, setEmails] = useState([]);
  const [toasts, setToasts] = useState([]); // queue — multiple notifications stack
  const [tick, setTick] = useState(0);

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
      const token = api.init();
      if (token) {
        try {
          const me = await api.me();
          setUser(me.user);
          const [t, r] = await Promise.all([api.listTeams(), api.listRequests()]);
          setTeams(t || []); setRequests(r || []);
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
      setUser(u);
      await refresh(u);
      notify(`Welcome, ${u.name.split(" ")[0]}`, "success");
      return true;
    } catch (e) {
      notify(e.message || "Sign-in failed", "error");
      return false;
    }
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
    await api.createRequest(payload);
    await refresh(user);
  };
  const sendReminder = async id => {
    try { await api.remindRequest(id); notify("Reminder sent", "success"); await refresh(user); }
    catch (e) { notify(e.message, "error"); }
  };
  const approveRequest = async id => {
    try { await api.approveRequest(id); notify("Approved — 1 hour reject window active", "success"); await refresh(user); }
    catch (e) { notify(e.message, "error"); }
  };
  const rejectRequest = async (id, reason) => {
    try { await api.rejectRequest(id, reason); notify("Request rejected", "success"); await refresh(user); }
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
  const saveUsers = async () => { if (user?.role === "admin") setUsers(await api.listUsers()); };
  const saveTeams = async () => { setTeams(await api.listTeams()); };

  // Custom confirmation dialog — replaces native window.confirm()
  const { confirm, ConfirmHost } = useConfirm();

  // ---- render ----
  if (!booted) return <BootScreen />;

  return (
    <ConfirmContext.Provider value={confirm}>
    <div className="min-h-screen" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif", backgroundColor: "#F5F1E8", color: "#0F1A2E" }}>
      <StyleTag />
      {!user ? (
        <LoginScreen login={login} />
      ) : (
        <Shell
          user={user}
          users={users} teams={teams} requests={requests} emails={emails}
          logout={logout}
          setSignature={setMySignature}
          saveUsers={saveUsers} saveTeams={saveTeams}
          addRequest={createRequest}
          sendReminder={sendReminder}
          approveRequest={approveRequest} rejectRequest={rejectRequest}
          undoApproval={undoApproval} forceFinalize={forceFinalize}
          notify={notify}
          refresh={() => refresh(user)}
          tick={tick}
        />
      )}
      <ToastStack toasts={toasts} />
      <ConfirmHost />
    </div>
    </ConfirmContext.Provider>
  );
}

// ============================================================
//   GLOBAL STYLE
// ============================================================
function StyleTag() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..800&family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
      .font-display { font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto; letter-spacing: -0.01em; }
      .font-mono { font-family: 'IBM Plex Mono', monospace; }
      .grain::before {
        content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.035;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      }
      .sig-canvas { touch-action: none; cursor: crosshair; background: #FAF7F0; }
      .tile-hover { transition: transform .2s ease, box-shadow .2s ease; }
      .tile-hover:hover { transform: translateY(-2px); box-shadow: 0 14px 40px -14px rgba(15,26,46,.25); }
      .ink-grad { background: linear-gradient(135deg, #0F1A2E 0%, #1B2A4A 100%); }
      input[type="text"], input[type="email"], input[type="password"], textarea, select {
        background: #FAF7F0; border: 1px solid rgba(15,26,46,.18); border-radius: 6px;
        padding: 10px 12px; font-size: 14px; color: #0F1A2E; outline: none;
      }
      input:focus, textarea:focus, select:focus { border-color: #B8894A; box-shadow: 0 0 0 3px rgba(184,137,74,.15); }
      .btn-primary { background: #0F1A2E; color: #F5F1E8; padding: 10px 18px; border-radius: 6px; font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; transition: all .15s; border: 1px solid #0F1A2E; }
      .btn-primary:hover:not(:disabled) { background: #1B2A4A; }
      .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
      .btn-ghost { background: transparent; color: #0F1A2E; padding: 8px 14px; border-radius: 6px; font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 6px; transition: all .15s; border: 1px solid rgba(15,26,46,.18); }
      .btn-ghost:hover { background: rgba(15,26,46,.05); }
      .btn-gold { background: #B8894A; color: #F5F1E8; padding: 10px 18px; border-radius: 6px; font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; transition: all .15s; border: 1px solid #B8894A; }
      .btn-gold:hover:not(:disabled) { background: #A3763D; }
      .btn-danger { background: #9B2C2C; color: #F5F1E8; padding: 10px 18px; border-radius: 6px; font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid #9B2C2C; }
      .btn-danger:hover { background: #7F2323; }
      .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 500; letter-spacing: .02em; text-transform: uppercase; }
      .pill-pending { background: #F4E4C1; color: #8B6914; }
      .pill-approved { background: #C8D9C5; color: #2D5F2F; }
      .pill-approved-pending { background: #E8D4B8; color: #8B4A14; }
      .pill-rejected { background: #E8C5C5; color: #7A2222; }
      .card { background: #FAF7F0; border: 1px solid rgba(15,26,46,.1); border-radius: 10px; }
      .divider-rule { height: 1px; background: linear-gradient(to right, transparent, rgba(15,26,46,.18), transparent); }
      @keyframes slideIn { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .anim-in { animation: slideIn .3s ease; }
      @keyframes logoGlow {
        0%, 100% { filter: drop-shadow(0 0 20px rgba(184,137,74,.2)); }
        50% { filter: drop-shadow(0 0 40px rgba(184,137,74,.5)); }
      }
      .logo-glow { animation: logoGlow 4s ease-in-out infinite; }
      @keyframes fadeUp {
        from { transform: translateY(18px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .fade-up { animation: fadeUp .7s ease both; }
      .fade-up-d1 { animation-delay: .12s; }
      .fade-up-d2 { animation-delay: .24s; }
      .fade-up-d3 { animation-delay: .36s; }
    `}</style>
  );
}

// ============================================================
//   SCREENS
// ============================================================
function BootScreen() {
  return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F5F1E8", fontFamily: "'Fraunces', serif" }}>
    <div className="text-sm tracking-widest uppercase opacity-50">Loading SignFlow…</div>
  </div>;
}

function ToastStack({ toasts }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end" style={{ pointerEvents: "none" }}>
      {toasts.map(t => <Toast key={t.id} toast={t} />)}
    </div>
  );
}

function Toast({ toast }) {
  const colors = {
    success: { bg: "#2D5F2F", fg: "#F5F1E8" },
    error:   { bg: "#9B2C2C", fg: "#F5F1E8" },
    info:    { bg: "#0F1A2E", fg: "#F5F1E8" }
  }[toast.kind] || { bg: "#0F1A2E", fg: "#F5F1E8" };
  return (
    <div className="anim-in" style={{ backgroundColor: colors.bg, color: colors.fg, padding: "12px 18px", borderRadius: 8, boxShadow: "0 10px 40px -10px rgba(0,0,0,.4)", fontSize: 14, maxWidth: 360, pointerEvents: "auto" }}>
      {toast.msg}
    </div>
  );
}

function LoginScreen({ login }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true);
    await login(email, password); setBusy(false);
  };
  return (
    <div className="min-h-screen grid md:grid-cols-2">
      {/* left panel */}
      <div className="ink-grad text-white relative grain flex flex-col items-center justify-center px-6 py-8 sm:px-8 sm:py-12 md:p-14 text-center gap-4 sm:gap-6" style={{ color: "#F5F1E8" }}>
        {/* Logo badge */}
        <div className="logo-glow fade-up">
          <img src="/signflow-logo.png" alt="HQHB · SignFlow" className="w-52 sm:w-64 md:w-80 mx-auto" />
        </div>

        {/* Gold divider */}
        <div className="fade-up fade-up-d1" style={{ width: 120, height: 1, background: "linear-gradient(to right, transparent, rgba(184,137,74,.45), transparent)" }} />

        {/* Hero copy */}
        <div className="relative z-10 fade-up fade-up-d2">
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl leading-[1.1]">
            Request. Review.<br />
            <span style={{ color: "#B8894A" }}>Approve. Track.</span><br />
            All in one place.
          </h1>
          <p className="mt-4 text-sm opacity-55 max-w-xs md:max-w-sm mx-auto leading-relaxed">
            Route to the right authority, capture verified digital signatures, and maintain a complete audit trail at every step.
          </p>
        </div>

        <div className="text-[10px] opacity-30 tracking-widest uppercase fade-up fade-up-d3 mt-auto pt-4">HQHB - Internal Build</div>
      </div>
      {/* right panel */}
      <div className="flex items-center justify-center p-6 sm:p-8 md:p-16">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="font-display text-2xl sm:text-3xl mb-2">Sign in</div>
          <div className="text-sm opacity-60 mb-8">Use the credentials provided by your administrator.</div>
          <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full mb-5" required autoFocus />
          <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full mb-6" required />
          <button className="btn-primary w-full justify-center" disabled={busy}>
            {busy ? "Signing in…" : <>Continue <ArrowRight size={16} /></>}
          </button>
        </form>
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

  // require signature for requestor & approver on first login
  useEffect(() => {
    if ((user.role === "requestor" || user.role === "approver") && !user.hasSignature) setNeedsSig(true);
    else setNeedsSig(false);
  }, [user.id, user.role, user.hasSignature]);

  return (
    <>
      <TopBar user={user} logout={logout} onEditSignature={() => setEditSig(true)} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-6 sm:py-8">
        {user.role === "requestor" && <RequestorView {...props} />}
        {user.role === "approver" && <ApproverView {...props} />}
        {user.role === "admin" && <AdminView {...props} />}
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
          title={user.hasSignature ? "Update your signature" : "Add your signature"}
          subtitle="Drawing or uploading a new image will replace any existing signature on file."
          onCancel={() => setEditSig(false)}
          currentUserId={user.hasSignature ? user.id : null}
          onSave={async dataUrl => { await setSignature(dataUrl); setEditSig(false); notify("Signature updated", "success"); }}
        />
      )}
    </>
  );
}

function TopBar({ user, logout, onEditSignature }) {
  const roleLabel = { admin: "Administrator", requestor: "Requestor", approver: "Approver" }[user.role];
  return (
    <header className="border-b" style={{ borderColor: "rgba(15,26,46,.1)", backgroundColor: "#FAF7F0" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-3 sm:py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 rounded-md flex items-center justify-center overflow-hidden shrink-0">
            <svg width="32" height="32" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <rect width="48" height="48" rx="10" fill="#B8894A"/>
              <rect x="8" y="6" width="20" height="26" rx="2.5" fill="#0F1A2E"/>
              <path d="M12 13h12M12 17.5h10M12 22h7" stroke="#B8894A" strokeWidth="1.3" strokeLinecap="round" opacity="0.65"/>
              <line x1="21" y1="37" x2="38" y2="14" stroke="#0F1A2E" strokeWidth="3.2" strokeLinecap="round"/>
              <polygon points="21,37 18.5,41 23,38.5" fill="#0F1A2E"/>
              <polygon points="38,14 40,10.5 36,12.5" fill="#0F1A2E"/>
            </svg>
          </div>
          <div className="min-w-0">
            <div className="font-display text-base sm:text-lg leading-tight truncate">HQHB · SignFlow</div>
            <div className="text-[9px] sm:text-[10px] tracking-widest uppercase opacity-50">{roleLabel} console</div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 md:gap-4 shrink-0">
          <div className="text-right hidden md:block">
            <div className="text-sm font-medium truncate max-w-[180px]">{user.name}</div>
            <div className="text-xs opacity-60 font-mono truncate max-w-[180px]">{user.email}</div>
          </div>
          {onEditSignature && (
            <button onClick={onEditSignature}
              className="btn-ghost text-sm px-2 sm:px-3"
              title={user.hasSignature ? "Update your signature" : "Add your signature"}>
              <PenTool size={14} />
              <span className="hidden sm:inline">{user.hasSignature ? "Signature" : "Add signature"}</span>
            </button>
          )}
          <button onClick={logout}
            className="btn-ghost text-sm px-2 sm:px-3"
            title="Sign out">
            <LogOut size={14} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}

// ============================================================
//   REQUESTOR VIEW
// ============================================================
function RequestorView(props) {
  const { user, requests } = props;
  const [tab, setTab] = useState("home");
  const [newType, setNewType] = useState(null); // pre-selected request type when opening NewRequest
  const my = requests.filter(r => r.requestorId === user.id);
  const pending = my.filter(r => r.status === "pending");
  const approved = my.filter(r => r.status === "approved");

  const openNew = (type = null) => { setNewType(type); setTab("new"); };
  useBackHandler(tab !== "home", () => { setNewType(null); setTab("home"); });

  if (tab === "new") return <NewRequest {...props} defaultType={newType} onDone={() => { setNewType(null); setTab("home"); }} />;
  if (tab === "pending") return <PendingList {...props} back={() => setTab("home")} items={pending.concat(my.filter(r => r.status === "approved_pending"))} />;
  if (tab === "approved") return <ApprovedList {...props} back={() => setTab("home")} items={approved} />;
  if (tab === "rejected") return <RejectedList {...props} back={() => setTab("home")} items={my.filter(r => r.status === "rejected")} />;

  const tiles = [
    { key: "new", icon: FilePlus, title: "Make a new request", desc: "Upload a document, mark a signature field, choose the signing team.", color: "#B8894A" },
    { key: "pending", icon: Clock, title: "Pending requests", desc: "Track what's awaiting signature. Send reminders every 24 hours.", badge: pending.length + my.filter(r => r.status === "approved_pending").length },
    { key: "approved", icon: CheckCircle, title: "Approved requests", desc: "Signed and finalised documents, ready to download.", badge: approved.length }
  ];

  return (
    <div>
      <Hero title={`Welcome back, ${user.name.split(" ")[0]}`} subtitle="What would you like to do today?" />

      {/* Quick Actions */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-display text-2xl">Quick Actions</h3>
          <div className="text-xs tracking-wider uppercase opacity-50">Start a request by type</div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {REQUEST_TYPES.map(t => (
            <button key={t.key} onClick={() => openNew(t.key)}
              className="card p-4 text-left tile-hover"
              style={{ borderLeft: `4px solid ${t.color}` }}>
              <div className="text-sm font-medium">{t.label}</div>
              <div className="text-xs opacity-60 mt-1">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5 mt-8 sm:mt-10">
        {tiles.map(t => <Tile key={t.key} {...t} onClick={() => t.key === "new" ? openNew(null) : setTab(t.key)} />)}
      </div>
      {my.filter(r => r.status === "rejected").length > 0 && (
        <div className="mt-8">
          <button className="btn-ghost text-sm" onClick={() => setTab("rejected")}>
            View rejected requests ({my.filter(r => r.status === "rejected").length})
          </button>
        </div>
      )}
      <RecentActivity my={my} teams={props.teams} />
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
          <div key={r.id} className={`px-5 py-4 flex items-center gap-4 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "rgba(15,26,46,.08)" }}>
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

function Hero({ title, subtitle }) {
  return (
    <div>
      <div className="text-[10px] sm:text-xs tracking-widest uppercase opacity-50 mb-1.5 sm:mb-2">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
      <h1 className="font-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl leading-[1.05]">{title}</h1>
      <p className="mt-2 sm:mt-3 text-sm sm:text-base opacity-60 max-w-xl">{subtitle}</p>
    </div>
  );
}

function Tile({ icon: Icon, title, desc, badge, color = "#0F1A2E", onClick }) {
  return (
    <button onClick={onClick} className="card tile-hover text-left p-5 sm:p-6 relative overflow-hidden block w-full">
      <div className="flex items-start justify-between mb-5 sm:mb-8">
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center" style={{ backgroundColor: color, color: "#F5F1E8" }}>
          <Icon size={18} className="sm:hidden" />
          <Icon size={20} className="hidden sm:block" />
        </div>
        {badge != null && badge > 0 && (
          <div className="text-xl sm:text-2xl font-display" style={{ color }}>{badge}</div>
        )}
      </div>
      <div className="font-display text-lg sm:text-xl mb-1 sm:mb-1.5">{title}</div>
      <div className="text-xs sm:text-sm opacity-60 leading-relaxed">{desc}</div>
      <div className="mt-3 sm:mt-4 flex items-center gap-1 text-[10px] sm:text-xs tracking-wider uppercase opacity-50">
        Open <ChevronRight size={12} />
      </div>
    </button>
  );
}

function StatusPill({ status }) {
  const label = { pending: "Pending", approved: "Approved", approved_pending: "Approved · 1h window", rejected: "Rejected" }[status];
  const cls = { pending: "pill-pending", approved: "pill-approved", approved_pending: "pill-approved-pending", rejected: "pill-rejected" }[status];
  return <span className={`pill ${cls}`}>{label}</span>;
}

// ============================================================
//   NEW REQUEST  — supports single approver OR multi-step workflow
// ============================================================
function NewRequest({ user, teams, users, addRequest, notify, onDone, defaultType }) {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("single"); // "single" | "workflow"
  const [instantApproval, setInstantApproval] = useState(false);
  const [requestType, setRequestType] = useState(defaultType || "general");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // single mode
  const [marker, setMarker] = useState(null);
  const [targetTeam, setTargetTeam] = useState("");

  // workflow mode: [{teamId, signers: [{userId, page, x, y, w, h}]}]
  const [workflow, setWorkflow] = useState([]);
  const [placingSlot, setPlacingSlot] = useState(null); // {stepIdx, signerIdx}

  // Holds the live XLSX workbook so cell edits can be written back on submit
  const xlsxWbRef = useRef(null);
  const leaveTemplateCache = useRef(null);
  const [leaveStyleMap, setLeaveStyleMap] = useState(null);

  // Auto-load leave template + styles when type is "leave"
  useEffect(() => {
    if (requestType !== "leave") return;
    let cancelled = false;
    (async () => {
      try {
        const [templateU8, stylesJson] = await Promise.all([
          leaveTemplateCache.current
            ? Promise.resolve(leaveTemplateCache.current)
            : fetch("/leave-template.xlsx").then(r => r.arrayBuffer()).then(b => { const u8 = new Uint8Array(b); leaveTemplateCache.current = u8; return u8; }),
          !leaveStyleMap
            ? fetch("/leave-template-styles.json").then(r => r.json()).catch(() => null)
            : Promise.resolve(null)
        ]);
        if (cancelled) return;
        if (stylesJson) setLeaveStyleMap(stylesJson);

        // --- Clear all pre-filled data; stamp today's date on non-leave date cells ---
        // Dynamic import: xlsx ships in the lazy viewer chunk so it only loads when needed.
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(templateU8, { type: "array", cellDates: true });
        const ws = workbook.Sheets["New Format"];
        if (ws) {
          // Clear all data cells
          [
            "C4","C5","C6","C7",
            "G4","G5","G6","G7",
            "A24",
            "A10","B10","C10","D10","E10","F10","G10","H10",
            "A11","B11","C11","D11","E11","F11","G11","H11",
            "A12","B12","C12","D12","E12","F12","G12","H12",
            "A13","B13","C13","D13","E13","F13","G13","H13",
            "C14","C17","F17","A19","F19",
            "F20","H24","H26",
          ].forEach(addr => { delete ws[addr]; });

          // Stamp today's date on all date cells EXCEPT From (D10-D13) and To (E10-E13)
          const today = new Date();
          const todayDisplay = today.toLocaleDateString("en-GB");
          ["F10","F11","F12","F13","F20","H24","H26"].forEach(addr => {
            ws[addr] = { t: "d", v: today, w: todayDisplay };
          });
        }
        const modifiedU8 = new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" }));
        // --- end clear ---

        const blob = new File([modifiedU8], "Leave Approval.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const reader = new FileReader();
        reader.onload = () => {
          if (cancelled) return;
          setFile({ name: "Leave Approval.xlsx", base64: reader.result, type: blob.type, ext: "xlsx", blob });
          setMarker(null); setWorkflow([]); setPlacingSlot(null);
        };
        reader.readAsDataURL(blob);
      } catch (e) { console.error(e); notify("Failed to load leave template", "error"); }
    })();
    return () => { cancelled = true; };
  }, [requestType]);

  const buildXlsxBlob = async () => {
    const wb = xlsxWbRef.current;
    if (!wb) return null;
    const XLSX = await import("xlsx");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return new File([new Uint8Array(out)], "Leave Approval.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  };

  const handleFile = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (!["pdf", "xlsx", "xls"].includes(ext)) { notify("Only PDF or Excel files supported", "error"); return; }
    if (f.size > 14 * 1024 * 1024) { notify("File must be under 14 MB", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setFile({ name: f.name, base64: reader.result, type: f.type, ext, blob: f });
      setMarker(null);
      setWorkflow([]);
      setPlacingSlot(null);
    };
    reader.readAsDataURL(f);
  };

  // ---------- aspect ratio to lock the marker rectangle to ----------
  // When placing a signer's marker in workflow mode, snap the rectangle to that
  // signer's signature aspect so the requestor sees the exact footprint that will
  // be stamped on approval. Single mode and unknown aspects fall back to free-form.
  const lockedAspect = useMemo(() => {
    if (mode !== "workflow" || !placingSlot) return null;
    const step = workflow[placingSlot.stepIdx];
    if (!step) return null;
    const signerSlot = step.signers?.[placingSlot.signerIdx];
    if (!signerSlot) return null;
    const team = teams.find(t => t.id === step.teamId);
    const approver = (team?.approvers || []).find(a => a.id === signerSlot.userId);
    const a = approver?.signatureAspect;
    return (a && a > 0 && isFinite(a)) ? a : null;
  }, [mode, placingSlot, workflow, teams]);

  // ---------- markers shown on the doc ----------
  const allMarkers = useMemo(() => {
    if (mode === "single") {
      if (!marker) return [];
      return [{ ...marker, label: "SIGN HERE" }];
    }
    const out = [];
    workflow.forEach((step, si) => {
      const team = teams.find(t => t.id === step.teamId);
      step.signers.forEach((s, gi) => {
        if (s.x == null) return;
        const u = (team?.approvers || []).find(a => a.id === s.userId);
        out.push({
          id: `s${si}-${gi}`, page: s.page || 1, x: s.x, y: s.y, w: s.w, h: s.h,
          color: STEP_COLORS[si % STEP_COLORS.length],
          label: `${si + 1}.${gi + 1} ${u?.name || "?"}${team ? ` · ${team.name}` : ""}`
        });
      });
    });
    return out;
  }, [mode, marker, workflow, teams]);

  // ---------- click handler from PDF viewer ----------
  const onAddMarker = (page, x, y, w, h) => {
    if (mode === "single") {
      setMarker({ page, x, y, w, h });
      return;
    }
    if (!placingSlot) {
      notify("Pick a signer first, then click 'Place signature'", "info");
      return;
    }
    const { stepIdx, signerIdx } = placingSlot;
    setWorkflow(wf => {
      const next = wf.map((st, i) => i !== stepIdx ? st : {
        ...st,
        signers: st.signers.map((s, j) => j !== signerIdx ? s : { ...s, page, x, y, w, h })
      });
      return next;
    });
    setPlacingSlot(null);
  };

  // ---------- update / delete existing markers (drag handles + X button) ----------
  const onUpdateMarker = (markerId, patch) => {
    if (mode === "single") {
      setMarker(prev => prev ? { ...prev, ...patch } : prev);
      return;
    }
    // markerId is in form "s{stepIdx}-{signerIdx}"
    const match = /^s(\d+)-(\d+)$/.exec(markerId || "");
    if (!match) return;
    const stepIdx = Number(match[1]), signerIdx = Number(match[2]);
    setWorkflow(wf => wf.map((st, i) => i !== stepIdx ? st : {
      ...st,
      signers: st.signers.map((s, j) => j !== signerIdx ? s : { ...s, ...patch })
    }));
  };
  const onDeleteMarker = (markerId) => {
    if (mode === "single") { setMarker(null); return; }
    const match = /^s(\d+)-(\d+)$/.exec(markerId || "");
    if (!match) return;
    const stepIdx = Number(match[1]), signerIdx = Number(match[2]);
    setWorkflow(wf => wf.map((st, i) => i !== stepIdx ? st : {
      ...st,
      signers: st.signers.map((s, j) => j !== signerIdx ? s : { ...s, x: null, y: null, w: null, h: null })
    }));
  };

  // ---------- workflow editing ----------
  const addStep = () => setWorkflow(wf => [...wf, { teamId: "", signers: [] }]);
  const removeStep = (i) => setWorkflow(wf => wf.filter((_, idx) => idx !== i));
  const setStepTeam = (i, teamId) => setWorkflow(wf => wf.map((s, idx) => idx === i ? { teamId, signers: [] } : s));
  const addSigner = (stepIdx, userId) => setWorkflow(wf => wf.map((s, i) => i !== stepIdx ? s : {
    ...s, signers: [...s.signers, { userId, page: 1, x: null, y: null, w: null, h: null }]
  }));
  const removeSigner = (stepIdx, signerIdx) => setWorkflow(wf => wf.map((s, i) => i !== stepIdx ? s : {
    ...s, signers: s.signers.filter((_, j) => j !== signerIdx)
  }));

  // ---------- submit ----------
  const isLeave = requestType === "leave";
  const effectiveFile = !!file;
  const canSubmitSingle = isLeave ? (effectiveFile && targetTeam) : (effectiveFile && marker && targetTeam);
  const canSubmitWorkflow = effectiveFile && workflow.length > 0
    && workflow.every(st => st.teamId && st.signers.length > 0
        && st.signers.every(s => s.userId && s.x != null));

  const submit = async () => {
    setBusy(true);
    try {
      const submitFile = isLeave ? ((await buildXlsxBlob()) || file.blob) : file.blob;
      if (mode === "single") {
        if (!canSubmitSingle) { notify("Complete all steps first", "error"); return; }
        const submitMarker = isLeave ? { page: 1, x: 30, y: 85, w: 22, h: 6 } : marker;
        await addRequest({ file: submitFile, targetTeamId: targetTeam, marker: submitMarker, instantApproval, note, requestType });
      } else {
        if (!canSubmitWorkflow) { notify("Complete the workflow — every signer needs a placed signature", "error"); return; }
        await addRequest({ file: submitFile, workflow, instantApproval, note, requestType });
      }
      notify("Request submitted", "success");
      onDone();
    } catch (e) {
      notify(e.message || "Submit failed", "error");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <BackHeader back={onDone} title="Make a new request" />
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 mt-6 sm:mt-8">
        <div className="lg:col-span-2 space-y-6">

          {/* 0. type */}
          <Section n="00" title="Request type" desc="Classifying the request lets approvers batch-process documents of the same kind.">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {REQUEST_TYPES.map(t => {
                const active = requestType === t.key;
                return (
                  <button key={t.key} onClick={() => setRequestType(t.key)}
                    className={`card p-3 text-left tile-hover ${active ? "ring-2" : ""}`}
                    style={{ borderLeft: `4px solid ${t.color}`, backgroundColor: active ? "rgba(184,137,74,.08)" : undefined }}>
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="text-xs opacity-60 mt-0.5">{t.desc}</div>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* 1. upload / leave template */}
          {isLeave ? (
            <Section n="01" title="Leave Request Form" desc="Edit the cells directly in the spreadsheet below.">
              {file ? (
                <Suspense fallback={<ViewerFallback />}>
                  <XlsxViewer file={file} markers={[]} cellEditable lockedCells={new Set(["F10","F11","F12","F13","F20","H24","H26"])} onWorkbookReady={wb => { xlsxWbRef.current = wb; }} styleMap={leaveStyleMap} />
                </Suspense>
              ) : (
                <div className="card p-10 text-sm opacity-50 text-center">Loading template…</div>
              )}
            </Section>
          ) : (
            <Section n="01" title="Upload document" desc="PDF or Excel (.xlsx) up to 14 MB.">
              {!file ? (
                <label className="card p-10 flex flex-col items-center justify-center text-center cursor-pointer" style={{ borderStyle: "dashed" }}>
                  <Upload size={24} className="opacity-50 mb-3" />
                  <div className="font-medium">Click to select a file</div>
                  <div className="text-xs opacity-60 mt-1">PDF · XLSX</div>
                  <input type="file" className="hidden" accept=".pdf,.xlsx,.xls" onChange={handleFile} />
                </label>
              ) : (
                <div className="card p-5 flex items-center gap-4">
                  {file.ext === "pdf" ? <FileText size={22} /> : <FileSpreadsheet size={22} />}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{file.name}</div>
                    <div className="text-xs opacity-60 uppercase tracking-wider">{file.ext}</div>
                  </div>
                  <button className="btn-ghost text-xs" onClick={() => { setFile(null); setMarker(null); setWorkflow([]); }}>
                    <X size={12} /> Remove
                  </button>
                </div>
              )}
            </Section>
          )}

          {/* 2. mode + instant */}
          {effectiveFile && (
            <Section n="02" title="Approval flow" desc="Pick how this document should be approved.">
              <div className="grid sm:grid-cols-2 gap-3">
                <button onClick={() => setMode("single")}
                  className={`card p-4 text-left tile-hover ${mode === "single" ? "ring-2" : ""}`}
                  style={{ borderColor: mode === "single" ? "#B8894A" : undefined, backgroundColor: mode === "single" ? "rgba(184,137,74,.08)" : undefined }}>
                  <Stamp size={18} className="mb-3 opacity-70" />
                  <div className="font-medium">Single approver</div>
                  <div className="text-xs opacity-60 mt-1">Any approver from one team can sign.</div>
                </button>
                <button onClick={() => setMode("workflow")}
                  className={`card p-4 text-left tile-hover ${mode === "workflow" ? "ring-2" : ""}`}
                  style={{ borderColor: mode === "workflow" ? "#B8894A" : undefined, backgroundColor: mode === "workflow" ? "rgba(184,137,74,.08)" : undefined }}>
                  <GitBranch size={18} className="mb-3 opacity-70" />
                  <div className="font-medium">Multi-step workflow</div>
                  <div className="text-xs opacity-60 mt-1">Specific signers across one or more teams, in order.</div>
                </button>
              </div>
              <label className="flex items-start gap-3 mt-5 cursor-pointer">
                <input type="checkbox" checked={instantApproval} onChange={e => setInstantApproval(e.target.checked)} className="mt-1" />
                <div>
                  <div className="font-medium text-sm flex items-center gap-2"><Zap size={13} style={{ color: "#B8894A" }} /> Instant approval</div>
                  <div className="text-xs opacity-60">Skip the 1-hour cooling window. Once all signatures are collected, the document is finalised immediately.</div>
                </div>
              </label>
            </Section>
          )}

          {/* 3a. single mode: pick team + place marker */}
          {!isLeave && effectiveFile && mode === "single" && (
            <Section n="03" title="Mark the signature field" desc="Click and drag on the document to set the signature box.">
              <Suspense fallback={<ViewerFallback />}>
                <DocPreview file={file} markers={allMarkers} editable
                  onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} />
              </Suspense>
              {marker && (
                <div className="mt-3 text-xs font-mono opacity-60">
                  Placed on page {marker.page} · {Math.round(marker.x)}% × {Math.round(marker.y)}% · {Math.round(marker.w)}% wide
                  <button className="ml-3 underline" onClick={() => setMarker(null)}>Reset</button>
                </div>
              )}
              <div className="mt-3 text-xs opacity-60">
                The signature will fill this exact rectangle. A "Digitally signed by … · date" line is added below it automatically.
              </div>
            </Section>
          )}

          {effectiveFile && mode === "single" && (isLeave || marker) && (
            <Section n={isLeave ? "03" : "04"} title="Route to signing authority" desc="Everyone with authority on this team will be notified.">
              <div className="grid sm:grid-cols-3 gap-3">
                {teams.map(t => {
                  const active = targetTeam === t.id;
                  return (
                    <button key={t.id} onClick={() => setTargetTeam(t.id)}
                      className={`card p-4 text-left tile-hover ${active ? "ring-2" : ""}`}
                      style={{ borderColor: active ? "#B8894A" : undefined, backgroundColor: active ? "rgba(184,137,74,.08)" : undefined }}>
                      <Building2 size={18} className="mb-3 opacity-70" />
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs opacity-60 mt-1">{(t.approvers || []).length} approver(s)</div>
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          {/* 3b. workflow mode */}
          {!isLeave && effectiveFile && mode === "workflow" && (
            <Section n="03" title="Build the workflow" desc="Add steps in the order they should sign. Within a step, list the signers in order.">
              <Suspense fallback={<ViewerFallback />}>
                <DocPreview file={file} markers={allMarkers} editable lockedAspect={lockedAspect}
                  onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} />
              </Suspense>
              {placingSlot && (
                <div className="mt-2 text-xs px-3 py-2 rounded" style={{ backgroundColor: "rgba(184,137,74,.18)", color: "#8B6914" }}>
                  Click and drag on the document to place this signer's box.{" "}
                  {lockedAspect
                    ? <span>Aspect is locked to the signer's signature so what you draw is what gets stamped.</span>
                    : <span>(Once this signer uploads a signature, the box will lock to its aspect.)</span>}
                  <button className="underline ml-2" onClick={() => setPlacingSlot(null)}>Cancel</button>
                </div>
              )}

              <div className="space-y-4 mt-5">
                {workflow.map((step, si) => {
                  const team = teams.find(t => t.id === step.teamId);
                  const stepColor = STEP_COLORS[si % STEP_COLORS.length];
                  return (
                    <div key={si} className="card p-4" style={{ borderLeft: `4px solid ${stepColor}` }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs opacity-50">Step {si + 1}</span>
                          <select value={step.teamId} onChange={e => setStepTeam(si, e.target.value)} className="text-sm">
                            <option value="">— pick a team —</option>
                            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                        <button className="btn-ghost text-xs" onClick={() => removeStep(si)}><Trash2 size={11} /> Remove step</button>
                      </div>

                      {team && (
                        <div className="space-y-2">
                          {step.signers.map((s, gi) => {
                            const u = (team.approvers || []).find(a => a.id === s.userId);
                            const placed = s.x != null;
                            const isPlacing = placingSlot?.stepIdx === si && placingSlot?.signerIdx === gi;
                            return (
                              <div key={gi} className="flex items-center gap-3 px-3 py-2 rounded" style={{ backgroundColor: "rgba(15,26,46,.04)" }}>
                                <span className="font-mono text-xs opacity-50">{si + 1}.{gi + 1}</span>
                                <span className="text-sm font-medium flex-1">{u?.name || "(unknown)"}</span>
                                {!u?.hasSignature && <span className="pill pill-rejected text-[10px]">no signature</span>}
                                {placed
                                  ? <span className="text-xs opacity-60 font-mono">page {s.page} · placed</span>
                                  : <span className="text-xs opacity-60">no marker</span>}
                                <button className={`text-xs ${isPlacing ? "btn-gold" : "btn-ghost"}`}
                                  onClick={() => setPlacingSlot(isPlacing ? null : { stepIdx: si, signerIdx: gi })}>
                                  {placed ? "Re-place" : "Place signature"}
                                </button>
                                <button className="opacity-40 hover:opacity-100" onClick={() => removeSigner(si, gi)}><X size={12} /></button>
                              </div>
                            );
                          })}
                          <AddSignerControl team={team} existing={step.signers.map(s => s.userId)} onAdd={uid => addSigner(si, uid)} />
                        </div>
                      )}
                    </div>
                  );
                })}
                <button className="btn-ghost w-full justify-center" onClick={addStep}><Plus size={13} /> Add step</button>
              </div>
            </Section>
          )}

          {/* 5. submit */}
          {effectiveFile && (mode === "single" ? ((isLeave || marker) && targetTeam) : workflow.length > 0) && (
            <Section n={isLeave ? "04" : (mode === "single" ? "05" : "04")} title="Add a note (optional)" desc="">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="w-full" placeholder="Context for the approver(s)…" />
              <div className="flex justify-end mt-4 gap-3">
                <button className="btn-ghost" onClick={onDone}>Cancel</button>
                <button className="btn-primary" onClick={submit} disabled={busy || !(mode === "single" ? canSubmitSingle : canSubmitWorkflow)}>
                  <Send size={14} /> {busy ? "Submitting…" : "Submit request"}
                </button>
              </div>
            </Section>
          )}
        </div>

        {/* sidebar helper */}
        <aside className="space-y-4">
          <div className="card p-5">
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-2">How this works</div>
            <ol className="space-y-3 text-sm opacity-80">
              <li className="flex gap-3"><span className="font-mono opacity-50">01</span> Upload the document.</li>
              <li className="flex gap-3"><span className="font-mono opacity-50">02</span> Choose single approver or multi-step workflow. Optionally enable instant approval.</li>
              <li className="flex gap-3"><span className="font-mono opacity-50">03</span> Place each signer's signature box on the page where it should appear.</li>
              <li className="flex gap-3"><span className="font-mono opacity-50">04</span> Submit. Each signer is notified in turn.</li>
            </ol>
          </div>
          {mode === "workflow" && workflow.length > 0 && (
            <div className="card p-5">
              <div className="text-[10px] tracking-widest uppercase opacity-50 mb-3">Workflow summary</div>
              <ol className="space-y-2 text-sm">
                {workflow.map((st, i) => {
                  const team = teams.find(t => t.id === st.teamId);
                  const c = STEP_COLORS[i % STEP_COLORS.length];
                  return (
                    <li key={i} className="flex gap-2">
                      <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c, marginTop: 5 }} />
                      <div className="flex-1">
                        <div className="text-xs opacity-60">Step {i + 1} · {team?.name || "—"}</div>
                        <div>{st.signers.length} signer{st.signers.length === 1 ? "" : "s"}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {instantApproval && <div className="mt-4 text-xs flex items-center gap-1.5" style={{ color: "#B8894A" }}><Zap size={12} /> Instant approval enabled</div>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function AddSignerControl({ team, existing, onAdd }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const available = (team.approvers || []).filter(a => !existing.includes(a.id));
  if (available.length === 0) return <div className="text-xs opacity-50 italic px-3">All team approvers already added.</div>;
  return (
    <div className="relative">
      <button className="btn-ghost text-xs w-full justify-center" onClick={() => setPickerOpen(o => !o)}>
        <Plus size={11} /> Add signer
      </button>
      {pickerOpen && (
        <div className="absolute left-0 right-0 mt-1 z-10 card p-2 shadow-lg" style={{ backgroundColor: "#FAF7F0" }}>
          {available.map(a => (
            <button key={a.id} className="w-full text-left px-3 py-2 hover:opacity-70 text-sm flex items-center justify-between"
              onClick={() => { onAdd(a.id); setPickerOpen(false); }}>
              <span>{a.name}</span>
              {!a.hasSignature && <span className="pill pill-rejected text-[10px]">no signature</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ n, title, desc, children }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 sm:gap-3 mb-2 sm:mb-3">
        <span className="font-mono text-xs opacity-50">{n}</span>
        <h3 className="font-display text-lg sm:text-xl">{title}</h3>
      </div>
      {desc && <p className="text-xs sm:text-sm opacity-60 mb-3 sm:mb-4 ml-6 sm:ml-8">{desc}</p>}
      <div className="ml-0 sm:ml-8">{children}</div>
    </div>
  );
}

function BackHeader({ back, title, step }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <button onClick={back} className="text-xs tracking-wider uppercase opacity-60 hover:opacity-100 flex items-center gap-1 mb-2">
          <ChevronRight size={12} style={{ transform: "rotate(180deg)" }} /> Back
        </button>
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl leading-tight">{title}</h1>
      </div>
      {step && <div className="text-[10px] sm:text-xs tracking-wider uppercase opacity-50 shrink-0 pt-1">{step}</div>}
    </div>
  );
}


// ============================================================
//   PENDING · APPROVED · REJECTED LISTS (Requestor)
// ============================================================
function PendingList({ items, teams, users, sendReminder, back, notify }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <BackHeader back={back} title="Pending requests" step={`${items.length} total`} />
      {items.length === 0 ? <Empty icon={Inbox} text="Nothing pending. You're all caught up." /> : (
        <div className="card mt-8 overflow-hidden">
          {items.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={(
                <div className="flex gap-2">
                  <button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>
                  {r.status === "pending" && (
                    <button className="btn-gold text-xs" onClick={() => sendReminder(r.id)}>
                      <Bell size={12} /> Remind
                    </button>
                  )}
                  {r.hasSignedFile && <DownloadBtn req={r} />}
                  {r.hasSignedFile && <PrintBtn req={r} />}
                </div>
              )} />
          ))}
        </div>
      )}
      {open && <PreviewDrawer req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
    </div>
  );
}

function ApprovedList({ items, teams, users, back }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <BackHeader back={back} title="Approved requests" step={`${items.length} signed`} />
      {items.length === 0 ? <Empty icon={Archive} text="No approved requests yet." /> : (
        <div className="card mt-8 overflow-hidden">
          {items.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={(
                <div className="flex gap-2">
                  <button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>
                  <DownloadBtn req={r} />
                  <PrintBtn req={r} />
                </div>
              )} />
          ))}
        </div>
      )}
      {open && <PreviewDrawer req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
    </div>
  );
}

function RejectedList({ items, teams, users, back }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <BackHeader back={back} title="Rejected requests" step={`${items.length} rejected`} />
      {items.length === 0 ? <Empty icon={FileX} text="No rejected requests." /> : (
        <div className="card mt-8 overflow-hidden">
          {items.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={(
                <div className="flex gap-2">
                  <button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>
                </div>
              )}
              subtitle={r.rejectReason && `Reason: ${r.rejectReason}`} />
          ))}
        </div>
      )}
      {open && <PreviewDrawer req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
    </div>
  );
}

function Empty({ icon: Icon, text }) {
  return (
    <div className="mt-16 flex flex-col items-center opacity-40">
      <Icon size={40} />
      <div className="mt-4 text-sm">{text}</div>
    </div>
  );
}

function RequestRow({ r, teams, users, i, actions, subtitle }) {
  const requestorName = r.requestorName || users.find(u => u.id === r.requestorId)?.name || "—";
  const approverName = r.approverName || users.find(u => u.id === r.approverId)?.name;
  const team = teams.find(t => t.id === r.targetTeamId);

  // Workflow: find the next pending signer
  let workflowLine = null;
  if (r.workflow && r.workflow.length > 0) {
    const activeStep = r.workflow.find(s => s.status === "active");
    if (activeStep) {
      const next = activeStep.signers.find(s => s.status === "pending");
      const stepTeam = teams.find(t => t.id === activeStep.teamId);
      workflowLine = `Step ${activeStep.order}/${r.workflow.length} · ${stepTeam?.name || ""}${next ? ` · awaiting ${next.userName}` : ""}`;
    } else if (r.status === "approved" || r.status === "approved_pending") {
      const totalSigners = r.workflow.reduce((n, s) => n + s.signers.length, 0);
      workflowLine = `${totalSigners} signature${totalSigners === 1 ? "" : "s"} collected across ${r.workflow.length} step${r.workflow.length === 1 ? "" : "s"}`;
    }
  }

  const typeKey = r.requestType || "general";
  const typeLabel = requestTypeLabel(typeKey);
  const typeColor = requestTypeColor(typeKey);

  return (
    <div className={`px-3 sm:px-5 py-3 sm:py-4 flex items-start sm:items-center gap-3 sm:gap-4 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "rgba(15,26,46,.08)" }}>
      <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>
        {r.fileType === "pdf" ? <FileText size={15} /> : <FileSpreadsheet size={15} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm sm:text-base truncate flex items-center gap-2">
          {r.fileName}
          {r.instantApproval && <span title="Instant approval" style={{ color: "#B8894A" }}><Zap size={11} /></span>}
          {r.workflow?.length > 0 && <span title="Multi-step workflow" className="opacity-60"><GitBranch size={11} /></span>}
        </div>
        <div className="text-xs opacity-60 mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 7px", borderRadius: 4, backgroundColor: `${typeColor}1A`, color: typeColor, fontWeight: 500 }}>
            {typeLabel}
          </span>
          <span className="truncate">{team?.name} · {fmtShort(r.createdAt)}</span>
          <span className="hidden sm:inline">· from {requestorName}</span>
          {approverName && !workflowLine && <span className="hidden md:inline">· {r.status === "rejected" ? "rejected" : "approved"} by {approverName}</span>}
          {r.status === "approved_pending" && r.approvedAt && !r.instantApproval && <span>· <Countdown until={r.approvedAt + APPROVAL_WINDOW_MS} /></span>}
        </div>
        {workflowLine && <div className="text-xs mt-0.5 opacity-70 truncate">{workflowLine}</div>}
        {subtitle && <div className="text-xs mt-1" style={{ color: "#9B2C2C" }}>{subtitle}</div>}
        {/* On mobile, actions move below content. On desktop they're inline. */}
        <div className="flex sm:hidden items-center gap-2 mt-2">
          <StatusPill status={r.status} />
          <div className="flex-1" />
          {actions}
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-3 shrink-0">
        <StatusPill status={r.status} />
        {actions}
      </div>
    </div>
  );
}

function Countdown({ until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);
  const ms = until - now;
  if (ms <= 0) return <span>finalising…</span>;
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return <span>finalises in {h > 0 ? `${h}h ` : ""}{m % 60}m</span>;
}

function DownloadBtn({ req }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const isPdf = req.fileType === "pdf";
      // For xlsx, the "signed" version is a JSON manifest — always download the original file
      const kind = (req.hasSignedFile && isPdf) ? "signed" : "file";
      const url = await api.getRequestFileBlob(req.id, kind);
      const a = document.createElement("a");
      a.href = url;
      const ext = isPdf ? "pdf" : "xlsx";
      a.download = (req.hasSignedFile && isPdf) ? `${req.fileName.replace(/\.(pdf|xlsx|xls)$/i, "")}.signed.${ext}` : req.fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { alert(e.message || "Download failed"); }
    finally { setBusy(false); }
  };
  return <button className="btn-ghost text-xs" onClick={download} disabled={busy}><Download size={12} /> {busy ? "…" : "Download"}</button>;
}

function PrintBtn({ req }) {
  const [busy, setBusy] = useState(false);
  const print = async () => {
    setBusy(true);
    // Open the window SYNCHRONOUSLY before any await — this preserves the
    // user-gesture chain and prevents popup blockers from suppressing it.
    const pw = window.open("", "_blank", "width=960,height=720");
    if (!pw) { alert("Popup was blocked. Please allow popups for this site and try again."); setBusy(false); return; }
    try {
      const isPdf = req.fileType === "pdf";
      const kind = (req.hasSignedFile && isPdf) ? "signed" : "file";
      const url = await api.getRequestFileBlob(req.id, kind);

      if (isPdf) {
        // Navigate the already-open window to the PDF blob URL, then trigger print.
        // Loading a blank HTML shell that embeds the PDF via <embed> lets us call
        // pw.print() reliably without relying on the sandboxed PDF-viewer context.
        pw.document.write(`<!DOCTYPE html><html><head><style>
          *{margin:0;padding:0;} body,html{width:100%;height:100%;overflow:hidden;}
          embed{width:100%;height:100%;display:block;}
        </style></head><body>
          <embed src="${url}" type="application/pdf" />
        </body></html>`);
        pw.document.close();
        // Give the embed time to render, then trigger the system print dialog
        setTimeout(() => { try { pw.print(); } catch { pw.focus(); } }, 1200);
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } else {
        // Excel / Leave form: parse with SheetJS → render as HTML table → auto-print
        // Dynamic import keeps xlsx in the lazy viewer chunk.
        const XLSX = await import("xlsx");
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
        const visibleSheets = wb.SheetNames.filter(s => s !== "Sheet1");
        let body = "";
        (visibleSheets.length ? visibleSheets : wb.SheetNames).forEach(name => {
          const ws = wb.Sheets[name];
          if (!ws || !ws["!ref"]) return;
          body += XLSX.utils.sheet_to_html(ws, { editable: false });
        });
        pw.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
          <title>${req.fileName}</title>
          <style>
            body{font-family:Calibri,Arial,sans-serif;font-size:9.5pt;margin:10mm;}
            table{border-collapse:collapse;width:100%;page-break-inside:auto;}
            td,th{border:1px solid #aaa;padding:2px 5px;vertical-align:top;word-break:break-word;}
            tr{page-break-inside:avoid;}
            @media print{body{margin:6mm;}}
          </style></head><body>${body}</body></html>`);
        pw.document.close();
        pw.focus();
        setTimeout(() => { pw.print(); URL.revokeObjectURL(url); }, 400);
      }
    } catch (e) { pw.close(); alert(e.message || "Print failed"); }
    finally { setBusy(false); }
  };
  return <button className="btn-ghost text-xs" onClick={print} disabled={busy}><Printer size={12} /> {busy ? "…" : "Print"}</button>;
}

function buildWorkflowMarkers(req, teams, { highlightUserId } = {}) {
  if (!req.workflow || req.workflow.length === 0) {
    if (req.marker) return [{ ...req.marker, page: req.marker.page || 1, label: "SIGN HERE" }];
    return [];
  }
  const out = [];
  req.workflow.forEach((step, si) => {
    const team = teams.find(t => t.id === step.teamId);
    step.signers.forEach((s, gi) => {
      out.push({
        id: s.id || `s${si}-${gi}`,
        page: s.page || 1, x: s.x, y: s.y, w: s.w, h: s.h,
        color: STEP_COLORS[si % STEP_COLORS.length],
        label: `${step.order}.${s.order} ${s.userName}${team ? ` · ${team.name}` : ""}${s.status === "signed" ? " ✓" : ""}`,
        highlight: highlightUserId && s.userId === highlightUserId && s.status === "pending"
      });
    });
  });
  return out;
}

function PreviewDrawer({ req, onClose, users, teams }) {
  const [file, setFile] = useState(null);
  const [leaveStyles, setLeaveStyles] = useState(null);
  useBackHandler(true, onClose);
  useEscapeKey(true, onClose);
  useEffect(() => {
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
      } catch (e) { console.error(e); }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [req.id, req.hasSignedFile]);

  const markers = req.hasSignedFile ? [] : buildWorkflowMarkers(req, teams);

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end" style={{ backgroundColor: "rgba(15,26,46,.5)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-4xl overflow-auto anim-in" style={{ backgroundColor: "#F5F1E8" }} onClick={e => e.stopPropagation()}>
        <div className="p-4 sm:p-6 flex items-center justify-between gap-2 border-b" style={{ borderColor: "rgba(15,26,46,.1)" }}>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg sm:text-2xl truncate">{req.fileName}</div>
            <div className="text-[10px] sm:text-xs opacity-60 mt-0.5 sm:mt-1 truncate">
              {teams.find(t => t.id === req.targetTeamId)?.name} · from {users.find(u => u.id === req.requestorId)?.name || "—"} · {fmt(req.createdAt)}
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <StatusPill status={req.status} />
            <button onClick={onClose} className="btn-ghost text-xs"><X size={14} /></button>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          {req.workflow?.length > 0 && <WorkflowSummary req={req} teams={teams} />}
          {file ? (
            <Suspense fallback={<ViewerFallback />}>
              <DocPreview file={file} markers={markers} styleMap={leaveStyles} />
            </Suspense>
          ) : <div className="text-sm opacity-50">Loading file…</div>}
          {req.note && <div className="mt-4 card p-4 text-sm"><div className="text-xs tracking-wider uppercase opacity-50 mb-2">Requestor note</div>{req.note}</div>}
        </div>
      </div>
    </div>
  );
}

function WorkflowSummary({ req, teams }) {
  return (
    <div className="card p-4 mb-4">
      <div className="text-[10px] tracking-widest uppercase opacity-50 mb-3 flex items-center gap-2">
        <GitBranch size={11} /> Approval workflow
        {req.instantApproval && <span style={{ color: "#B8894A" }} className="flex items-center gap-1"><Zap size={10} /> Instant</span>}
      </div>
      <div className="space-y-2">
        {req.workflow.map((step, si) => {
          const team = teams.find(t => t.id === step.teamId);
          const c = STEP_COLORS[si % STEP_COLORS.length];
          return (
            <div key={step.id} className="flex gap-3">
              <div style={{ width: 4, borderRadius: 2, backgroundColor: c }} />
              <div className="flex-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Step {step.order} · {team?.name}</span>
                  <StepStatusPill status={step.status} />
                </div>
                <div className="text-xs opacity-70 mt-1">
                  {step.signers.map(s => (
                    <span key={s.id} className="inline-flex items-center gap-1 mr-3">
                      {s.status === "signed" ? <Check size={10} style={{ color: "#2D5F2F" }} /> : <Clock size={10} className="opacity-50" />}
                      {s.userName}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepStatusPill({ status }) {
  const map = {
    pending: { c: "pill-pending", l: "Waiting" },
    active: { c: "pill-approved-pending", l: "Active" },
    done: { c: "pill-approved", l: "Done" },
    rejected: { c: "pill-rejected", l: "Rejected" }
  }[status] || { c: "pill-pending", l: status };
  return <span className={`pill ${map.c} text-[9px]`}>{map.l}</span>;
}

// ============================================================
//   APPROVER VIEW
// ============================================================
function ApproverView(props) {
  const { user, requests, teams } = props;
  const [tab, setTab] = useState("home");
  useBackHandler(tab !== "home", () => setTab("home"));
  const isWorkflowSigner = r => (r.workflow || []).some(st => st.signers.some(s => s.userId === user.id));
  const iSignedInWorkflow = r => (r.workflow || []).some(st => st.signers.some(s => s.userId === user.id && s.status === "signed"));
  const mine = requests.filter(r => {
    if (r.approverId === user.id) return true;
    if (isWorkflowSigner(r)) return true;
    if (r.status === "pending" && r.targetTeamId && (user.signingAuthorityTeams || []).includes(r.targetTeamId)) return true;
    return false;
  });
  const pending = mine.filter(r => r.status === "pending");
  const pendingApproved = mine.filter(r => r.status === "approved_pending" && (r.approverId === user.id || iSignedInWorkflow(r)));
  const approved = mine.filter(r => r.status === "approved" && (r.approverId === user.id || iSignedInWorkflow(r)));
  const rejected = mine.filter(r => r.status === "rejected" && (r.approverId === user.id || iSignedInWorkflow(r)));

  if (tab === "pending") return <ApproverPending {...props} items={pending.concat(pendingApproved)} back={() => setTab("home")} />;
  if (tab === "approved") return <ApproverApproved {...props} items={approved.concat(pendingApproved)} back={() => setTab("home")} />;
  if (tab === "rejected") return <ApproverRejected {...props} items={rejected} back={() => setTab("home")} />;
  if (tab === "authority") return <ApproverAuthority {...props} back={() => setTab("home")} />;

  const tiles = [
    { key: "pending", icon: Stamp, title: "Pending approvals", desc: "Review and sign documents requiring your authority.", badge: pending.length + pendingApproved.length, color: "#B8894A" },
    { key: "approved", icon: CheckCircle, title: "Approved requests", desc: "Documents you have signed and finalised.", badge: approved.length + pendingApproved.length },
    { key: "rejected", icon: XCircle, title: "Rejected requests", desc: "Documents you have rejected.", badge: rejected.length },
    { key: "authority", icon: Shield, title: "Signing authority", desc: "Teams that have granted you authority to approve.", badge: (user.signingAuthorityTeams || []).length }
  ];
  return (
    <div>
      <Hero title={`Good day, ${user.name.split(" ")[0]}`} subtitle="Documents are routed to you based on the teams you sign for." />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mt-8 sm:mt-10">
        {tiles.map(t => <Tile key={t.key} {...t} onClick={() => setTab(t.key)} />)}
      </div>
    </div>
  );
}

function ApproverPending({ items, user, users, teams, approveRequest, rejectRequest, undoApproval, refresh, back, notify }) {
  const [openId, setOpenId] = useState(null);
  const [filterType, setFilterType] = useState("all");
  const [selected, setSelected] = useState(() => new Set());
  const [batching, setBatching] = useState(false);

  // Only "pending" rows (where I'm the next signer) are batch-approvable. approved_pending rows are excluded.
  const isMyTurn = (r) => {
    if (r.status !== "pending") return false;
    if (r.workflow && r.workflow.length > 0) {
      const active = r.workflow.find(s => s.status === "active");
      const next = active?.signers.find(s => s.status === "pending");
      return next?.userId === user.id;
    }
    // Legacy: any approver with authority for the team can claim it
    return (user.signingAuthorityTeams || []).includes(r.targetTeamId);
  };

  const visible = items.filter(r => filterType === "all" || (r.requestType || "general") === filterType);
  const selectable = visible.filter(isMyTurn);
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
            const myTurn = isMyTurn(r);
            return (
              <div key={r.id} className={`flex items-center ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "rgba(15,26,46,.08)" }}>
                {myTurn && (
                  <label className="pl-5 pr-2 cursor-pointer flex items-center" title="Select for batch approval">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </label>
                )}
                {!myTurn && <div className="pl-5 pr-2 opacity-30 text-xs">—</div>}
                <div className="flex-1">
                  <RequestRow r={r} teams={teams} users={users} i={0}
                    actions={<button className="btn-primary text-xs" onClick={() => setOpenId(r.id)}>Review <ArrowRight size={12} /></button>} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && <ApproveDrawer req={open} user={user} users={users} teams={teams}
        approveRequest={approveRequest} rejectRequest={rejectRequest} undoApproval={undoApproval}
        onClose={() => setOpenId(null)} notify={notify} />}
    </div>
  );
}

function ApproveDrawer({ req, user, users, teams, approveRequest, rejectRequest, undoApproval, onClose, notify }) {
  const [file, setFile] = useState(null);
  const [leaveStyles, setLeaveStyles] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [sigUrl, setSigUrl] = useState(null);
  const bodyRef = useRef(null);
  useBackHandler(true, onClose);
  useEscapeKey(true, onClose);
  useEffect(() => {
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
      } catch (e) { console.error(e); }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [req.id, req.hasSignedFile]);

  const pendingApproved = req.status === "approved_pending";

  // Workflow context
  const isWorkflow = (req.workflow?.length || 0) > 0;
  let mySlot = null;
  let nextPendingUser = null;
  if (isWorkflow) {
    const activeStep = req.workflow.find(s => s.status === "active");
    if (activeStep) {
      const next = activeStep.signers.find(s => s.status === "pending");
      nextPendingUser = next;
      if (next?.userId === user.id) mySlot = next;
    }
  }
  const canApprove = req.status === "pending" && (!isWorkflow || !!mySlot);

  const enterPreview = async () => {
    try {
      const url = await api.getSignatureBlob(user.id);
      if (!url) { notify("Could not load your signature", "error"); return; }
      setSigUrl(url);
      setPreviewing(true);
    } catch { notify("Failed to load signature preview", "error"); }
  };

  // Markers: highlight my slot, hide already-applied ones (the signed PDF preview shows them in-place).
  // In preview mode, overlay the approver's signature image at the marked position.
  const baseMarkers = req.hasSignedFile ? [] : buildWorkflowMarkers(req, teams, { highlightUserId: user.id });
  const markers = (previewing && sigUrl)
    ? baseMarkers.map(m => (isWorkflow ? m.highlight : true) ? { ...m, signedDataUrl: sigUrl } : m)
    : baseMarkers;

  const jumpToSig = () => {
    const el = bodyRef.current?.querySelector("[data-sig-jump]");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    else bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end" style={{ backgroundColor: "rgba(15,26,46,.5)" }} onClick={onClose}>
      <div className="w-full max-w-4xl flex flex-col anim-in" style={{ backgroundColor: "#F5F1E8" }} onClick={e => e.stopPropagation()}>

        {/* ── Fixed header with Jump-to-Signature ── */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-2 sm:gap-3 border-b shrink-0" style={{ borderColor: "rgba(15,26,46,.1)" }}>
          <div className="min-w-0 flex-1">
            <div className="font-display text-base sm:text-xl truncate">{req.fileName}</div>
            <div className="text-[10px] sm:text-xs opacity-60 mt-0.5 truncate">
              {teams.find(t => t.id === req.targetTeamId)?.name} · from {users.find(u => u.id === req.requestorId)?.name || "—"} · {fmt(req.createdAt)}
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {canApprove && markers.length > 0 && (
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
          {file ? (
            <Suspense fallback={<ViewerFallback />}>
              <DocPreview file={file} markers={markers} styleMap={leaveStyles} fill />
            </Suspense>
          ) : <div className="text-sm opacity-50">Loading…</div>}
          {req.note && <div className="mt-4 card p-4 text-sm"><div className="text-xs tracking-wider uppercase opacity-50 mb-2">Requestor note</div>{req.note}</div>}
        </div>

        {/* ── Pinned action bar(s) ── */}
        {canApprove && (
          <div className="shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-t flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3" style={{ borderColor: "rgba(15,26,46,.1)", backgroundColor: "#F5F1E8" }}>
            {previewing ? (
              <>
                <div className="flex items-center gap-2 text-xs" style={{ color: "#2D5F2F" }}>
                  <Eye size={13} />
                  <span className="hidden sm:inline">Review how your signature will appear on the document.</span>
                  <span className="sm:hidden">Preview your signature</span>
                </div>
                <div className="flex gap-2 sm:gap-3 shrink-0">
                  <button className="btn-ghost" onClick={() => setPreviewing(false)}><ArrowLeft size={14} /> <span className="hidden sm:inline">Go </span>back</button>
                  <button className="btn-primary" onClick={async () => { await approveRequest(req.id); onClose(); }}><CheckCircle size={14} /> <span className="hidden sm:inline">Confirm </span>approval</button>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs opacity-60 hidden sm:block">
                  {isWorkflow
                    ? <>Your signature will be stamped at the highlighted position.{req.instantApproval && " Document finalises immediately."}</>
                    : <>Your signature will be stamped at the marked position.{req.instantApproval && " Document finalises immediately."}</>}
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
            style={{ borderColor: "rgba(15,26,46,.1)", backgroundColor: "#F5F1E8" }}>
            <Clock size={12} /> Awaiting signature from <span className="font-medium">{nextPendingUser.userName}</span> before it reaches you.
          </div>
        )}
        {pendingApproved && req.approverId === user.id && !req.instantApproval && (
          <div className="shrink-0 px-6 py-4 border-t flex items-center justify-between gap-3" style={{ borderColor: "rgba(15,26,46,.1)", backgroundColor: "#F5F1E8" }}>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(15,26,46,.6)" }}>
          <div className="card p-6 max-w-md w-full m-4" style={{ backgroundColor: "#F5F1E8" }}>
            <div className="font-display text-2xl mb-2">Reject request</div>
            <div className="text-sm opacity-60 mb-4">Let the requestor know why.</div>
            <textarea rows={4} value={reason} onChange={e => setReason(e.target.value)} className="w-full mb-4" placeholder="Reason (optional)" />
            <div className="flex justify-end gap-3">
              <button className="btn-ghost" onClick={() => setRejectOpen(false)}>Cancel</button>
              <button className="btn-danger" onClick={async () => { await rejectRequest(req.id, reason); setRejectOpen(false); onClose(); }}>Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ApproverApproved({ items, back, users, teams }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <BackHeader back={back} title="Approved requests" step={`${items.length} signed`} />
      {items.length === 0 ? <Empty icon={Archive} text="No approved requests yet." /> : (
        <div className="card mt-8 overflow-hidden">
          {items.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={(
                <div className="flex gap-2">
                  <button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>
                  <DownloadBtn req={r} />
                  <PrintBtn req={r} />
                </div>
              )} />
          ))}
        </div>
      )}
      {open && <PreviewDrawer req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
    </div>
  );
}

function ApproverRejected({ items, back, users, teams }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <BackHeader back={back} title="Rejected requests" step={`${items.length} rejected`} />
      {items.length === 0 ? <Empty icon={FileX} text="No rejected requests." /> : (
        <div className="card mt-8 overflow-hidden">
          {items.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={<button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>}
              subtitle={r.rejectReason && `Reason: ${r.rejectReason}`} />
          ))}
        </div>
      )}
      {open && <PreviewDrawer req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
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

  const { users, teams, requests, emails } = props;
  const tiles = [
    { key: "onboard", icon: UserPlus, title: "Onboard team", desc: "Add a team, bulk-upload members from Excel, then email credentials in one flow.", color: "#B8894A" },
    { key: "users", icon: Users, title: "Users", desc: "Manage individual users and signing authority.", badge: users.length },
    { key: "teams", icon: Building2, title: "Teams & authority", desc: "Define teams and edit memberships.", badge: teams.length },
    { key: "signatures", icon: PenTool, title: "Signatures", desc: "Upload signatures in bulk on behalf of users." },
    { key: "documents", icon: FileText, title: "All documents", desc: "Download or audit every file, team-wise.", badge: requests.length },
    { key: "reports", icon: BarChart3, title: "Reports", desc: "Team-wise reporting, export to CSV." },
    { key: "emails", icon: Mail, title: "Email log", desc: "Inspect every notification sent by SignFlow.", badge: emails.length }
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
              <button className="btn-ghost" onClick={addEmptyRow}><Plus size={13} /> Add row manually</button>
              {fileName && <div className="text-xs opacity-60 font-mono">{fileName}</div>}
            </div>
          </div>

          {rows.length > 0 && (
            <div className="card overflow-hidden">
              <div className="grid grid-cols-12 text-[10px] tracking-wider uppercase opacity-50 px-4 py-3 border-b" style={{ borderColor: "rgba(15,26,46,.08)" }}>
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
                  <Mail size={13} style={{ color: "#B8894A" }} /> Send welcome emails with credentials
                </div>
                <div className="text-xs opacity-60 mt-0.5">
                  Each user receives an email with a freshly generated password. You won't see the passwords — they go straight to the user.
                  If SendGrid isn't configured the emails are logged under <span className="font-mono">Email log</span> instead.
                </div>
              </div>
            </label>
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 text-xs tracking-wider uppercase opacity-60 border-b" style={{ borderColor: "rgba(15,26,46,.08)" }}>Members to create</div>
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
              <CheckCircle size={20} style={{ color: "#2D5F2F" }} />
              <div className="font-display text-2xl">Team onboarded</div>
            </div>
            <div className="text-sm opacity-75">
              {resultLog.created.length} user{resultLog.created.length === 1 ? "" : "s"} created in <span className="font-medium">{teamLabel}</span>.
              {sendInvites && <> {resultLog.invited} invite email{resultLog.invited === 1 ? "" : "s"} sent.</>}
            </div>
          </div>

          {resultLog.failed.length > 0 && (
            <div className="card p-4 mb-5" style={{ borderLeft: "4px solid #9B2C2C", backgroundColor: "rgba(155,44,44,.04)" }}>
              <div className="text-sm font-medium mb-2" style={{ color: "#7F2323" }}>{resultLog.failed.length} failed</div>
              {resultLog.failed.map((f, i) => (
                <div key={i} className="text-xs opacity-75 mb-1">{f.row.email} — {f.error}</div>
              ))}
            </div>
          )}

          {sendInvites && resultLog.inviteErrors.length > 0 && (
            <div className="card p-4 mb-5" style={{ borderLeft: "4px solid #B8894A" }}>
              <div className="text-sm font-medium mb-2" style={{ color: "#8B6914" }}>{resultLog.inviteErrors.length} invite{resultLog.inviteErrors.length === 1 ? "" : "s"} failed</div>
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

function AdminUsers({ users, teams, saveUsers, back, notify }) {
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const confirm = useConfirmation();

  const add = async data => {
    try { await api.createUser(data); notify("User added", "success"); await saveUsers(); return true; }
    catch (e) { notify(e.message, "error"); return false; }
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

  return (
    <div>
      <BackHeader back={back} title="Users" step={`${users.length} total`} />
      <div className="flex flex-wrap justify-end gap-2 sm:gap-3 mt-6 mb-4">
        <button className="btn-ghost" onClick={() => setBulkOpen(true)}><Upload size={14} /> <span className="hidden sm:inline">Bulk upload CSV</span><span className="sm:hidden">Bulk</span></button>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} /> Add user</button>
      </div>

      {/* Desktop table */}
      <div className="card overflow-hidden hidden md:block">
        <div className="grid grid-cols-12 text-[10px] tracking-wider uppercase opacity-50 px-5 py-3 border-b" style={{ borderColor: "rgba(15,26,46,.08)" }}>
          <div className="col-span-3">Name</div>
          <div className="col-span-3">Email</div>
          <div className="col-span-2">Role</div>
          <div className="col-span-3">Authority / Team</div>
          <div className="col-span-1"></div>
        </div>
        {users.map(u => (
          <div key={u.id} className="grid grid-cols-12 items-center px-5 py-3 border-b text-sm" style={{ borderColor: "rgba(15,26,46,.06)" }}>
            <div className="col-span-3 font-medium flex items-center gap-2">
              {u.hasSignature && <PenTool size={11} style={{ color: "#B8894A" }} />}
              {u.name}
            </div>
            <div className="col-span-3 font-mono text-xs opacity-70 truncate">{u.email}</div>
            <div className="col-span-2"><span className="pill pill-pending">{u.role}</span></div>
            <div className="col-span-3 text-xs opacity-70">
              {u.role === "approver" && ((u.signingAuthorityTeams || []).map(id => teams.find(t => t.id === id)?.name).filter(Boolean).join(", ") || "—")}
              {u.role === "requestor" && (teams.find(t => t.id === u.team)?.name || "—")}
              {u.role === "admin" && "—"}
            </div>
            <div className="col-span-1 text-right">
              <button className="opacity-40 hover:opacity-100" onClick={() => remove(u.id, u.name)} title="Remove"><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Mobile stacked cards */}
      <div className="card overflow-hidden md:hidden">
        {users.map(u => (
          <div key={u.id} className="px-4 py-3 border-b" style={{ borderColor: "rgba(15,26,46,.06)" }}>
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {u.hasSignature && <PenTool size={11} style={{ color: "#B8894A" }} className="shrink-0" />}
                <div className="font-medium text-sm truncate">{u.name}</div>
              </div>
              <button className="opacity-40 hover:opacity-100 shrink-0" onClick={() => remove(u.id, u.name)} title="Remove"><Trash2 size={13} /></button>
            </div>
            <div className="text-xs font-mono opacity-70 truncate mb-2">{u.email}</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="pill pill-pending">{u.role}</span>
              <span className="text-xs opacity-70">
                {u.role === "approver" && ((u.signingAuthorityTeams || []).map(id => teams.find(t => t.id === id)?.name).filter(Boolean).join(", ") || "—")}
                {u.role === "requestor" && (teams.find(t => t.id === u.team)?.name || "—")}
                {u.role === "admin" && "—"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {adding && <OnboardUserWizard teams={teams} users={users} onCancel={() => setAdding(false)} onSave={async d => { const ok = await add(d); if (ok) setAdding(false); }} />}
      {bulkOpen && <BulkUserModal teams={teams} onClose={() => setBulkOpen(false)} onImport={async rows => {
        try { const { imported } = await api.bulkCreateUsers(rows); notify(`Imported ${imported} user${imported === 1 ? "" : "s"}`, "success"); await saveUsers(); setBulkOpen(false); }
        catch (e) { notify(e.message, "error"); }
      }} />}
    </div>
  );
}

// ============================================================
//   ONBOARD USER WIZARD — replaces the single-modal user form
//   Step 1: Identity (name / email / password)
//   Step 2: Role + assignment (signing authority for approvers,
//           department for requestors, nothing for admins)
//   Step 3: Review & confirm
// ============================================================
function OnboardUserWizard({ teams, users, onCancel, onSave }) {
  const [step, setStep] = useState(0);
  useEscapeKey(true, onCancel);
  const [f, setF] = useState({
    name: "", email: "", password: "",
    role: "requestor",
    signingAuthorityTeams: [],
    team: ""
  });
  const [touched, setTouched] = useState({});
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  const mark = k => setTouched(t => ({ ...t, [k]: true }));
  const missing = ["name", "email", "password"].filter(k => !f[k].trim());
  const canAdvanceIdentity = missing.length === 0;

  const Req = () => <span style={{ color: "#9B2C2C" }}>*</span>;
  const errStyle = (k) => (touched[k] && !f[k].trim())
    ? { borderColor: "#9B2C2C", boxShadow: "0 0 0 3px rgba(155,44,44,.12)" } : {};

  const next = () => {
    if (step === 0) {
      setTouched({ name: true, email: true, password: true });
      if (!canAdvanceIdentity) return;
    }
    setStep(s => Math.min(s + 1, 2));
  };
  const prev = () => setStep(s => Math.max(s - 1, 0));

  const save = async () => {
    setBusy(true);
    try { await onSave(f); }
    finally { setBusy(false); }
  };

  const steps = [
    { n: "01", label: "Identity" },
    { n: "02", label: "Role & assignment" },
    { n: "03", label: "Confirm" }
  ];

  const roleCards = [
    { key: "requestor", icon: UserPlus, label: "Requestor",  desc: "Submits documents for approval. Belongs to a single department." },
    { key: "approver",  icon: Stamp,    label: "Approver",   desc: "Signs documents. Can hold signing authority over multiple teams." },
    { key: "admin",     icon: Shield,   label: "Administrator", desc: "Full control of users, teams, signatures, and audit." }
  ];

  // Team preview info for the assignment step
  const teamMembers = (teamId) => users.filter(u => u.team === teamId).length;
  const teamApprovers = (teamId) => users.filter(u => u.role === "approver" && (u.signingAuthorityTeams || []).includes(teamId)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(15,26,46,.65)" }} onClick={onCancel}>
      <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-auto" style={{ backgroundColor: "#F5F1E8" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[10px] tracking-widest uppercase opacity-50">Onboard a user</div>
            <div className="font-display text-2xl">{steps[step].label}</div>
          </div>
          <button onClick={onCancel} className="btn-ghost text-xs"><X size={14} /></button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mt-4 mb-6">
          {steps.map((s, i) => {
            const active = i === step;
            const done = i < step;
            return (
              <div key={s.n} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium"
                    style={{
                      backgroundColor: active ? "#0F1A2E" : done ? "#B8894A" : "rgba(15,26,46,.08)",
                      color: (active || done) ? "#F5F1E8" : "rgba(15,26,46,.6)"
                    }}>
                    {done ? <Check size={11} /> : i + 1}
                  </div>
                  <div className="text-[10px] tracking-wider uppercase" style={{ opacity: active ? 1 : 0.5 }}>{s.label}</div>
                </div>
                {i < steps.length - 1 && <div className="flex-1 h-px" style={{ backgroundColor: done ? "#B8894A" : "rgba(15,26,46,.12)" }} />}
              </div>
            );
          })}
        </div>

        <form autoComplete="off" onSubmit={e => e.preventDefault()}>
          {/* Honeypot to absorb browser autofill */}
          <input type="text" name="username" autoComplete="username" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />
          <input type="password" name="password" autoComplete="current-password" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />

          {/* ─── STEP 1: Identity ─── */}
          {step === 0 && (
            <div className="space-y-3 anim-in">
              <div>
                <label className="text-xs tracking-wider uppercase opacity-70 block mb-1">Full name <Req /></label>
                <input autoFocus className="w-full" name="wiz_name" autoComplete="off"
                  value={f.name} onChange={e => setF({ ...f, name: e.target.value })}
                  onBlur={() => mark("name")} style={errStyle("name")} />
              </div>
              <div>
                <label className="text-xs tracking-wider uppercase opacity-70 block mb-1">Work email <Req /></label>
                <input className="w-full" type="email" name="wiz_email" autoComplete="off"
                  value={f.email} onChange={e => setF({ ...f, email: e.target.value })}
                  onBlur={() => mark("email")} style={errStyle("email")} />
              </div>
              <div>
                <label className="text-xs tracking-wider uppercase opacity-70 block mb-1">Initial password <Req /></label>
                <div style={{ position: "relative" }}>
                  <input className="w-full" type={showPwd ? "text" : "password"} name="wiz_password" autoComplete="new-password"
                    value={f.password} onChange={e => setF({ ...f, password: e.target.value })}
                    onBlur={() => mark("password")} style={{ ...errStyle("password"), paddingRight: 40 }}
                    placeholder="At least 6 characters" />
                  <button type="button" onClick={() => setShowPwd(s => !s)}
                    title={showPwd ? "Hide password" : "Show password"}
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", padding: 4, opacity: 0.6, display: "flex", alignItems: "center" }}>
                    {showPwd ? <EyeOff size={15} /> : <EyeIcon size={15} />}
                  </button>
                </div>
                <div className="text-xs opacity-60 mt-1">They can change this once they sign in.</div>
              </div>
              {missing.length > 0 && Object.keys(touched).length > 0 && (
                <div className="text-xs px-3 py-2 rounded" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "#7F2323" }}>
                  Required: {missing.join(", ")}
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 2: Role + assignment ─── */}
          {step === 1 && (
            <div className="anim-in">
              <div className="text-xs tracking-wider uppercase opacity-70 mb-2">Role</div>
              <div className="grid sm:grid-cols-3 gap-2 mb-5">
                {roleCards.map(rc => {
                  const active = f.role === rc.key;
                  const Icon = rc.icon;
                  return (
                    <button key={rc.key} type="button"
                      onClick={() => setF({ ...f, role: rc.key, signingAuthorityTeams: [], team: "" })}
                      className={`card p-3 text-left tile-hover ${active ? "ring-2" : ""}`}
                      style={{
                        borderColor: active ? "#B8894A" : undefined,
                        backgroundColor: active ? "rgba(184,137,74,.08)" : undefined
                      }}>
                      <Icon size={16} className="opacity-70 mb-2" />
                      <div className="font-medium text-sm">{rc.label}</div>
                      <div className="text-xs opacity-60 mt-0.5">{rc.desc}</div>
                    </button>
                  );
                })}
              </div>

              {/* Approver — multi-select signing authority */}
              {f.role === "approver" && (
                <div>
                  <div className="text-xs tracking-wider uppercase opacity-70 mb-2">Approver's list — sign for which teams?</div>
                  {teams.length === 0 ? (
                    <div className="card p-4 text-sm opacity-60">No teams exist yet. Create teams from the "Teams & authority" tab first.</div>
                  ) : (
                    <div className="space-y-2">
                      {teams.map(t => {
                        const checked = f.signingAuthorityTeams.includes(t.id);
                        return (
                          <label key={t.id} className="card p-3 flex items-center gap-3 cursor-pointer tile-hover"
                            style={{ borderColor: checked ? "#B8894A" : undefined, backgroundColor: checked ? "rgba(184,137,74,.08)" : undefined }}>
                            <input type="checkbox" checked={checked} onChange={e => {
                              const v = e.target.checked
                                ? [...f.signingAuthorityTeams, t.id]
                                : f.signingAuthorityTeams.filter(x => x !== t.id);
                              setF({ ...f, signingAuthorityTeams: v });
                            }} />
                            <Building2 size={16} className="opacity-70" />
                            <div className="flex-1">
                              <div className="font-medium text-sm">{t.name}</div>
                              <div className="text-xs opacity-60">{teamApprovers(t.id)} approver(s) · {teamMembers(t.id)} member(s)</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <div className="text-xs opacity-60 mt-3">Without any signing authority, this approver won't appear in workflows.</div>
                </div>
              )}

              {/* Requestor — pick department */}
              {f.role === "requestor" && (
                <div>
                  <div className="text-xs tracking-wider uppercase opacity-70 mb-2">Department</div>
                  {teams.length === 0 ? (
                    <div className="card p-4 text-sm opacity-60">No teams exist yet. Create teams first.</div>
                  ) : (
                    <div className="space-y-2">
                      <label className="card p-3 flex items-center gap-3 cursor-pointer tile-hover"
                        style={{ borderColor: f.team === "" ? "#B8894A" : undefined, backgroundColor: f.team === "" ? "rgba(184,137,74,.08)" : undefined }}>
                        <input type="radio" name="team_pick" checked={f.team === ""} onChange={() => setF({ ...f, team: "" })} />
                        <div className="flex-1">
                          <div className="font-medium text-sm">No department</div>
                          <div className="text-xs opacity-60">Can be assigned later from the team page.</div>
                        </div>
                      </label>
                      {teams.map(t => (
                        <label key={t.id} className="card p-3 flex items-center gap-3 cursor-pointer tile-hover"
                          style={{ borderColor: f.team === t.id ? "#B8894A" : undefined, backgroundColor: f.team === t.id ? "rgba(184,137,74,.08)" : undefined }}>
                          <input type="radio" name="team_pick" checked={f.team === t.id} onChange={() => setF({ ...f, team: t.id })} />
                          <Building2 size={16} className="opacity-70" />
                          <div className="flex-1">
                            <div className="font-medium text-sm">{t.name}</div>
                            <div className="text-xs opacity-60">{teamMembers(t.id)} current member(s)</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Admin — nothing to assign */}
              {f.role === "admin" && (
                <div className="card p-4 text-sm opacity-70">
                  <Shield size={14} className="inline-block mr-1.5 opacity-70" />
                  Administrators have full access — no team assignment needed.
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 3: Review ─── */}
          {step === 2 && (
            <div className="anim-in">
              <div className="text-xs tracking-wider uppercase opacity-70 mb-3">Review and confirm</div>
              <div className="card p-5 space-y-3">
                <Row label="Name" value={f.name} />
                <Row label="Email" value={<span className="font-mono text-xs">{f.email}</span>} />
                <Row label="Password" value={<span className="font-mono text-xs">{"•".repeat(Math.min(f.password.length, 12))}</span>} />
                <Row label="Role" value={<span className="pill pill-pending">{f.role}</span>} />
                {f.role === "approver" && (
                  <Row label="Signing authority" value={
                    f.signingAuthorityTeams.length === 0
                      ? <span className="opacity-60">— none yet —</span>
                      : <div className="flex flex-wrap gap-1.5">
                          {f.signingAuthorityTeams.map(id => {
                            const t = teams.find(x => x.id === id);
                            return <span key={id} className="pill" style={{ backgroundColor: "rgba(184,137,74,.18)", color: "#8B6914" }}>{t?.name || id}</span>;
                          })}
                        </div>
                  } />
                )}
                {f.role === "requestor" && (
                  <Row label="Department" value={
                    f.team
                      ? <span className="pill" style={{ backgroundColor: "rgba(184,137,74,.18)", color: "#8B6914" }}>{teams.find(t => t.id === f.team)?.name || f.team}</span>
                      : <span className="opacity-60">— none —</span>
                  } />
                )}
              </div>
              <div className="text-xs opacity-60 mt-3">An email is not auto-sent — share the credentials with the user manually.</div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-6 gap-2">
            <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
            <div className="flex gap-2">
              {step > 0 && <button type="button" className="btn-ghost" onClick={prev}><ArrowLeft size={13} /> Back</button>}
              {step < 2
                ? <button type="button" className="btn-primary" onClick={next} disabled={step === 0 && !canAdvanceIdentity}
                    title={step === 0 && !canAdvanceIdentity ? `Fill in: ${missing.join(", ")}` : "Continue"}>
                    Continue <ArrowRight size={13} />
                  </button>
                : <button type="button" className="btn-primary" onClick={save} disabled={busy}>
                    {busy ? "Creating…" : <><Check size={13} /> Create user</>}
                  </button>}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// Tiny helper for the review step
function Row({ label, value }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <div className="text-[10px] tracking-wider uppercase opacity-50 w-32 shrink-0 mt-1">{label}</div>
      <div className="flex-1">{value || <span className="opacity-50">—</span>}</div>
    </div>
  );
}

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
  const confirm = useConfirmation();
  const add = async () => {
    if (!name.trim()) return;
    try { await api.createTeam(name.trim()); setName(""); notify("Team added", "success"); await saveTeams(); }
    catch (e) { notify(e.message, "error"); }
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
        <input placeholder="New team name" value={name} onChange={e => setName(e.target.value)} className="flex-1" />
        <button className="btn-primary" onClick={add}><Plus size={14} /> Add team</button>
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
  const [busy, setBusy] = useState(null); // userId currently being mutated
  const confirm = useConfirmation();

  const approvers = users.filter(u => u.role === "approver" && (u.signingAuthorityTeams || []).includes(team.id));
  const members = users.filter(u => u.team === team.id);

  // Eligible to grant approver authority on this team:
  //   any approver not already authorised here
  const eligibleApprovers = users.filter(u =>
    u.role === "approver" && !(u.signingAuthorityTeams || []).includes(team.id)
  );

  // Eligible to assign as a department member:
  //   any requestor not already in this team
  const eligibleMembers = users.filter(u =>
    u.role === "requestor" && u.team !== team.id
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
              <div key={a.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded text-sm" style={{ backgroundColor: "rgba(15,26,46,.04)" }}>
                {a.hasSignature
                  ? <PenTool size={11} style={{ color: "#B8894A" }} />
                  : <PenTool size={11} className="opacity-30" />}
                <span className="flex-1">{a.name}</span>
                {!a.hasSignature && <span className="pill pill-rejected text-[10px]">no sig</span>}
                <button onClick={() => revoke(a.id, a.name)} disabled={busy === a.id}
                  className="opacity-40 hover:opacity-100 text-xs" title="Revoke authority">
                  {busy === a.id ? "…" : <X size={12} />}
                </button>
              </div>
            ))}
          </div>
        )}
        {addApproverOpen && eligibleApprovers.length > 0 && (
          <div className="card p-2 mt-2 max-h-48 overflow-auto" style={{ backgroundColor: "#FAF7F0" }}>
            {eligibleApprovers.map(u => (
              <button key={u.id} className="w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:opacity-70"
                onClick={() => grant(u.id)} disabled={busy === u.id}>
                <PenTool size={11} className={u.hasSignature ? "" : "opacity-30"} style={u.hasSignature ? { color: "#B8894A" } : {}} />
                <span className="flex-1">{u.name}</span>
                {!u.hasSignature && <span className="pill pill-rejected text-[10px]">no sig</span>}
                <span className="text-xs opacity-50">{busy === u.id ? "…" : "+"}</span>
              </button>
            ))}
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
          <div className="card p-2 mt-2 max-h-48 overflow-auto" style={{ backgroundColor: "#FAF7F0" }}>
            {eligibleMembers.map(u => {
              const currentTeam = teams.find(t => t.id === u.team);
              return (
                <button key={u.id} className="w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:opacity-70"
                  onClick={() => assignMember(u.id)} disabled={busy === u.id}>
                  <UserPlus size={11} className="opacity-50" />
                  <span className="flex-1">{u.name}</span>
                  {currentTeam && <span className="text-[10px] opacity-50">from {currentTeam.name}</span>}
                  <span className="text-xs opacity-50">{busy === u.id ? "…" : "+"}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SignatureImage({ userId, height = 34, maxWidth = 140 }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u = null;
    (async () => { u = await api.getSignatureBlob(userId); setUrl(u); })();
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [userId]);
  if (!url) return <span className="inline-block opacity-40"><PenTool size={12} /></span>;
  return <img src={url} alt="signature" style={{ height, maxWidth, objectFit: "contain" }} />;
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
        <div className="card p-5">
          <div className="font-display text-xl mb-3">Without signature</div>
          {withoutSig.length === 0 ? <div className="text-sm opacity-50">Everyone has a signature.</div> : withoutSig.map(u => (
            <div key={u.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm" style={{ borderColor: "rgba(15,26,46,.06)" }}>
              <div>
                <div className="font-medium">{u.name}</div>
                <div className="text-xs opacity-60 font-mono">{u.email} · {u.role}</div>
              </div>
              <button className="btn-gold text-xs" onClick={() => setTarget(u)}><PenTool size={12} /> Add</button>
            </div>
          ))}
        </div>
        <div className="card p-5">
          <div className="font-display text-xl mb-3">On file</div>
          {withSig.map(u => (
            <div key={u.id} className="flex items-center justify-between py-3 border-b last:border-0" style={{ borderColor: "rgba(15,26,46,.06)" }}>
              <div>
                <div className="font-medium text-sm">{u.name}</div>
                <div className="text-xs opacity-60 font-mono">{u.role}</div>
              </div>
              <SignatureImage userId={u.id} />
              <button className="btn-ghost text-xs" onClick={() => setTarget(u)}>Replace</button>
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
            {p.matched ? <Check size={14} style={{ color: "#2D5F2F" }} /> : <X size={14} style={{ color: "#9B2C2C" }} />}
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

function AdminDocuments({ requests, users, teams, back, defaultTeamId }) {
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
          <span className="font-mono" style={{ color: "#2D5F2F" }}>{stats.approved}</span> approved ·{" "}
          <span className="font-mono" style={{ color: "#9B2C2C" }}>{stats.rejected}</span> rejected
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
              actions={<div className="flex gap-2"><DownloadBtn req={r} /><PrintBtn req={r} /></div>} />
          ))}
      </div>
    </div>
  );
}

function AdminReports({ requests, users, teams, back }) {
  const byTeam = useMemo(() => teams.map(t => {
    const rs = requests.filter(r => r.targetTeamId === t.id);
    return {
      team: t.name,
      total: rs.length,
      pending: rs.filter(r => r.status === "pending").length,
      approved: rs.filter(r => r.status === "approved").length,
      pending_finalise: rs.filter(r => r.status === "approved_pending").length,
      rejected: rs.filter(r => r.status === "rejected").length
    };
  }), [requests, teams]);

  const exportCsv = async () => {
    try {
      const url = await api.downloadReportCsv();
      const a = document.createElement("a");
      a.href = url;
      a.download = `signflow-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { alert(e.message); }
  };

  return (
    <div>
      <BackHeader back={back} title="Reports" step="Team-wise" />
      <div className="flex justify-end mt-6 mb-4">
        <button className="btn-primary" onClick={exportCsv}><Download size={14} /> Download full CSV</button>
      </div>
      <div className="card overflow-hidden">
        <div className="grid grid-cols-6 text-[10px] tracking-wider uppercase opacity-50 px-5 py-3 border-b" style={{ borderColor: "rgba(15,26,46,.08)" }}>
          <div className="col-span-2">Team</div>
          <div>Total</div><div>Pending</div><div>Approved</div><div>Rejected</div>
        </div>
        {byTeam.map((b, i) => (
          <div key={i} className="grid grid-cols-6 items-center px-5 py-4 border-b" style={{ borderColor: "rgba(15,26,46,.06)" }}>
            <div className="col-span-2 font-medium">{b.team}</div>
            <div className="font-display text-xl">{b.total}</div>
            <div className="text-sm"><span className="font-mono">{b.pending}</span> <span className="opacity-40 text-xs">({b.pending_finalise} in window)</span></div>
            <div className="text-sm font-mono" style={{ color: "#2D5F2F" }}>{b.approved}</div>
            <div className="text-sm font-mono" style={{ color: "#9B2C2C" }}>{b.rejected}</div>
          </div>
        ))}
      </div>

      {/* Top approvers */}
      <div className="mt-10">
        <div className="font-display text-2xl mb-4">Top approvers</div>
        <div className="card overflow-hidden">
          {users.filter(u => u.role === "approver").map((u, i) => {
            const n = requests.filter(r => r.approverId === u.id && r.status === "approved").length;
            const rej = requests.filter(r => r.approverId === u.id && r.status === "rejected").length;
            return (
              <div key={u.id} className={`px-5 py-4 flex items-center justify-between ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "rgba(15,26,46,.06)" }}>
                <div className="flex items-center gap-3">
                  {u.hasSignature ? <SignatureImage userId={u.id} height={28} maxWidth={80} /> : <PenTool size={14} className="opacity-30" />}
                  <div>
                    <div className="font-medium text-sm">{u.name}</div>
                    <div className="text-xs opacity-60">{(u.signingAuthorityTeams || []).map(id => teams.find(t => t.id === id)?.name).filter(Boolean).join(", ")}</div>
                  </div>
                </div>
                <div className="flex gap-6 text-sm">
                  <div><span className="font-display text-lg" style={{ color: "#2D5F2F" }}>{n}</span> <span className="opacity-60 text-xs">approved</span></div>
                  <div><span className="font-display text-lg" style={{ color: "#9B2C2C" }}>{rej}</span> <span className="opacity-60 text-xs">rejected</span></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AdminEmails({ emails, back }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <BackHeader back={back} title="SendGrid log" step={`${emails.length} recorded`} />
      <div className="card p-4 mt-3 text-xs flex items-start gap-3" style={{ backgroundColor: "rgba(184,137,74,.1)" }}>
        <AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: "#8B6914" }} />
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
          {open.error && <div className="text-xs mb-3 p-3 rounded" style={{ backgroundColor: "rgba(155,44,44,.1)", color: "#7F2323" }}>SendGrid error: {open.error}</div>}
          <pre className="text-sm whitespace-pre-wrap" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>{open.body}</pre>
        </ModalShell>
      )}
    </div>
  );
}

// ============================================================
//   SIGNATURE CAPTURE (canvas + image upload)
// ============================================================
/**
 * Returns a new canvas tightly cropped to the signature's actual content,
 * with a small padding. Treats transparent and near-white pixels as background.
 * Returns null if the canvas is empty.
 */
function trimSignatureCanvas(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  if (w === 0 || h === 0) return null;
  const ctx = srcCanvas.getContext("2d");
  let data;
  try { data = ctx.getImageData(0, 0, w, h).data; }
  catch { return null; } // cross-origin tainted canvas — skip trim
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      // Background = fully transparent OR near-white opaque
      const isBg = a < 16 || (r > 240 && g > 240 && b > 240);
      if (!isBg) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  // Small padding so the strokes don't kiss the edge
  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.01));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = cropW; out.height = cropH;
  out.getContext("2d").drawImage(srcCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
  return out;
}

function SignatureModal({ title, subtitle, onCancel, onSave, onLogout, currentUserId }) {
  useEscapeKey(!!onCancel, onCancel);
  const canvasRef = useRef(null);
  const [mode, setMode] = useState("draw"); // draw | upload
  const [uploaded, setUploaded] = useState(null);
  const [empty, setEmpty] = useState(true);
  const drawingRef = useRef(false);
  const pointsRef = useRef([]);
  const lastVelRef = useRef(0);
  const lastWidthRef = useRef(2.0);
  const [currentSigUrl, setCurrentSigUrl] = useState(null);

  // Fetch the current signature image, if any, so the user can see what's stored.
  useEffect(() => {
    if (!currentUserId) return;
    let url = null;
    (async () => {
      try {
        url = await api.getSignatureBlob(currentUserId);
        setCurrentSigUrl(url);
      } catch { /* ignore */ }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [currentUserId]);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = r.width * 3; c.height = r.height * 3;
    c.getContext("2d").scale(3, 3);
  }, [mode]);

  const pos = e => {
    const r = canvasRef.current.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top, t: Date.now() };
  };

  const start = e => {
    if (e.touches) e.preventDefault();
    drawingRef.current = true;
    const p = pos(e);
    pointsRef.current = [p];
    lastVelRef.current = 0;
    lastWidthRef.current = 2.0;
    const ctx = canvasRef.current.getContext("2d");
    ctx.fillStyle = "#0F1A2E";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
    ctx.fill();
    setEmpty(false);
  };

  const move = e => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const p = pos(e);
    const pts = pointsRef.current;
    const prev = pts[pts.length - 1];
    const dx = p.x - prev.x, dy = p.y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1.5) return;
    const dt = Math.max(1, p.t - prev.t);
    const vel = (dist / dt) * 1000;
    const sVel = lastVelRef.current * 0.4 + vel * 0.6;
    lastVelRef.current = sVel;
    const frac = Math.min(sVel / 800, 1);
    const rawW = 3.2 - 2.6 * frac;
    const w = lastWidthRef.current * 0.55 + rawW * 0.45;
    lastWidthRef.current = w;
    pts.push(p);
    const ctx = canvasRef.current.getContext("2d");
    ctx.strokeStyle = "#0F1A2E";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = w;
    if (pts.length >= 3) {
      const a = pts[pts.length - 3], b = pts[pts.length - 2];
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.quadraticCurveTo(b.x, b.y, (b.x + p.x) / 2, (b.y + p.y) / 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    setEmpty(false);
  };

  const end = () => {
    if (drawingRef.current && pointsRef.current.length >= 2) {
      const pts = pointsRef.current;
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      const ctx = canvasRef.current.getContext("2d");
      ctx.strokeStyle = "#0F1A2E";
      ctx.lineCap = "round";
      ctx.lineWidth = lastWidthRef.current;
      ctx.beginPath();
      ctx.moveTo((prev.x + last.x) / 2, (prev.y + last.y) / 2);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    drawingRef.current = false;
    pointsRef.current = [];
  };

  const clear = () => {
    const c = canvasRef.current;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    lastWidthRef.current = 2.0;
    lastVelRef.current = 0;
  };

  const handleUpload = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => setUploaded(r.result); r.readAsDataURL(f);
  };

  const save = () => {
    if (mode === "draw") {
      if (empty) return;
      const trimmed = trimSignatureCanvas(canvasRef.current);
      onSave((trimmed || canvasRef.current).toDataURL("image/png"));
    } else {
      if (!uploaded) return;
      // For uploaded files, trim transparent / near-white edges so the signature fills
      // the marker box without surrounding whitespace.
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        const trimmed = trimSignatureCanvas(c);
        onSave((trimmed || c).toDataURL("image/png"));
      };
      img.onerror = () => onSave(uploaded);
      img.src = uploaded;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(15,26,46,.65)" }}>
      <div className="card p-6 max-w-lg w-full" style={{ backgroundColor: "#F5F1E8" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="font-display text-2xl">{title}</div>
          {onCancel && <button onClick={onCancel} className="btn-ghost text-xs"><X size={14} /></button>}
        </div>
        {subtitle && <div className="text-sm opacity-60 mb-4">{subtitle}</div>}

        {currentSigUrl && (
          <div className="mb-4">
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-2">Current signature on file</div>
            <div className="card p-3 flex items-center justify-center" style={{ backgroundColor: "#FAF7F0", minHeight: 90 }}>
              <img src={currentSigUrl} alt="Current signature" style={{ maxHeight: 110, maxWidth: "100%", objectFit: "contain", display: "block" }} />
            </div>
            <div className="text-xs opacity-60 mt-2">Draw or upload below to replace it. The new version is auto-cropped to its content.</div>
          </div>
        )}

        <div className="flex gap-2 mb-4 text-xs">
          <button onClick={() => setMode("draw")} className={`px-3 py-1.5 rounded-md ${mode === "draw" ? "btn-primary" : "btn-ghost"}`}>Draw</button>
          <button onClick={() => setMode("upload")} className={`px-3 py-1.5 rounded-md ${mode === "upload" ? "btn-primary" : "btn-ghost"}`}>Upload image</button>
        </div>

        {mode === "draw" ? (
          <div>
            <canvas ref={canvasRef}
              onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
              onTouchStart={start} onTouchMove={move} onTouchEnd={end}
              className="sig-canvas w-full rounded-md border"
              style={{ borderColor: "rgba(15,26,46,.18)", height: 180 }} />
            <div className="flex justify-between items-center mt-3">
              <button className="btn-ghost text-xs" onClick={clear}><RefreshCw size={12} /> Clear</button>
              <div className="text-xs opacity-60">Sign with your mouse, stylus, or finger.</div>
            </div>
          </div>
        ) : (
          <div>
            <input type="file" accept="image/png,image/jpeg" onChange={handleUpload} className="text-sm" />
            {uploaded && (
              <div className="mt-4 card p-4" style={{ backgroundColor: "#FAF7F0" }}>
                <img src={uploaded} alt="signature" style={{ maxHeight: 100, maxWidth: "100%", objectFit: "contain", display: "block", margin: "0 auto" }} />
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between items-center gap-2 mt-6">
          <div>
            {onLogout && (
              <button className="btn-ghost text-xs" onClick={onLogout} title="Sign out and add your signature later">
                <LogOut size={12} /> Sign out & do it later
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {onCancel && <button className="btn-ghost" onClick={onCancel}>Cancel</button>}
            <button className="btn-primary" onClick={save} disabled={mode === "draw" ? empty : !uploaded}>
              <Check size={14} /> Save signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//   MODAL SHELL
// ============================================================
function ModalShell({ title, onClose, children }) {
  useEscapeKey(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(15,26,46,.65)" }} onClick={onClose}>
      <div className="card p-6 max-w-xl w-full max-h-[90vh] overflow-auto" style={{ backgroundColor: "#F5F1E8" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-2xl pr-4">{title}</div>
          <button onClick={onClose} className="btn-ghost text-xs"><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
