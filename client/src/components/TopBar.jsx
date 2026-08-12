import { useState, useRef, useEffect } from "react";
import { PenTool, LogOut, KeyRound, HelpCircle, Home, ChevronDown, Download, ScanFace, UserCog, Bell, Mail, CheckCircle, XCircle, Clock, FileText, Moon } from "lucide-react";

// Relative "2h ago"-style stamp for the notification list.
function ago(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return `${d}d ago`;
}
const NOTIF_ICONS = { new_request: FileText, approved: CheckCircle, rejected: XCircle, reminder: Clock };

export function TopBar({ user, logout, notifs, onOpenNotification, onMarkAllNotifsRead, onToggleEmailNotifs, onToggleDarkMode, onEditSignature, onChangePassword, onBiometric, onDelegation, onHome, onHelp, onInstall }) {
  const roleLabel = { admin: "Administrator", requestor: "Requestor", approver: "Approver", executive: "Executive", executive_assistant: "Executive Assistant" }[user.role];
  // Initials from the first letter/digit of each word (skips punctuation like the
  // "(" in "Taha (Admin)"), capped at two.
  const initials = (user.name || "")
    .split(/\s+/)
    .map(w => (w.match(/[A-Za-z0-9]/) || [""])[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  // Profile dropdown: open state + click-outside / Escape to close.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = e => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocClick); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  // Notification bell: same open/close behaviour as the profile menu.
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  useEffect(() => {
    if (!bellOpen) return;
    const onDocClick = e => { if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false); };
    const onKey = e => { if (e.key === "Escape") setBellOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocClick); document.removeEventListener("keydown", onKey); };
  }, [bellOpen]);
  const unread = notifs?.unread || 0;
  const items = notifs?.notifications || [];

  const itemClass = "w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors";
  const itemStyle = { color: "var(--c-ink, #0F1A2E)" };
  const hoverOn = e => { e.currentTarget.style.backgroundColor = "rgba(15,26,46,.06)"; };
  const hoverOff = e => { e.currentTarget.style.backgroundColor = "transparent"; };

  return (
    <header className="border-b sticky top-0 z-30"
      style={{
        borderColor: "var(--c-ink-10)",
        backgroundColor: "var(--c-paper)",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)"
      }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-3 sm:py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 flex items-center justify-center shrink-0">
            <svg width="34" height="34" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 6 H29 L36 13 V37 Q36 42 31 42 H13 Q8 42 8 37 V11 Q8 6 13 6 Z" fill="#ffffff" stroke="#12233F" strokeWidth="2.4" strokeLinejoin="round"/>
              <path d="M29 6 V11 Q29 13 31 13 H36" fill="none" stroke="#12233F" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M13 30.5 C 13 24.5, 19.5 21.5, 20.5 25.5 C 21.3 28.7, 17 30, 17 26.8 C 17 22.8, 23 20.5, 30 18" fill="none" stroke="#12274B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M16 30.5 C 22 28.3, 27.5 27.3, 32 27" fill="none" stroke="#E8792E" strokeWidth="2.3" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="min-w-0">
            <div className="font-display text-base sm:text-lg leading-tight truncate">HQHB · SignFlow</div>
            <div className="text-[9px] sm:text-[10px] tracking-widest uppercase opacity-50">{roleLabel} console</div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Home — back to the dashboard from anywhere */}
          {onHome && (
            <button onClick={onHome} className="btn-ghost text-sm px-2 sm:px-3" title="Back to dashboard">
              <Home size={16} />
              <span className="hidden sm:inline">Home</span>
            </button>
          )}

          {/* Notification bell */}
          {notifs && (
            <div className="relative" ref={bellRef}>
              <button onClick={() => setBellOpen(o => !o)} className="btn-ghost text-sm px-2 relative"
                title="Notifications" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
                <Bell size={17} />
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-semibold flex items-center justify-center"
                    style={{ backgroundColor: "#9B2C2C", color: "#FAF7F0" }}>{unread > 99 ? "99+" : unread}</span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 mt-2 w-80 max-w-[92vw] rounded-xl overflow-hidden z-40"
                  style={{ backgroundColor: "var(--c-paper)", border: "1px solid var(--c-ink-10)", boxShadow: "0 10px 30px rgba(15,26,46,.18)" }}>
                  <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--c-ink-10)" }}>
                    <div className="text-sm font-medium">Notifications</div>
                    {unread > 0 && (
                      <button className="text-[11px] underline opacity-60 hover:opacity-100" onClick={() => onMarkAllNotifsRead?.()}>
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-[60vh] overflow-y-auto">
                    {items.length === 0 ? (
                      <div className="px-4 py-8 text-center text-xs opacity-50">Nothing yet — approvals and updates land here.</div>
                    ) : items.map(n => {
                      const Icon = NOTIF_ICONS[n.type] || Bell;
                      return (
                        <button key={n.id} className="w-full text-left px-4 py-3 border-b flex items-start gap-3 transition-colors"
                          style={{ borderColor: "rgba(15,26,46,.06)", backgroundColor: n.read ? "transparent" : "rgba(184,137,74,.07)" }}
                          onMouseEnter={hoverOn} onMouseLeave={e => { e.currentTarget.style.backgroundColor = n.read ? "transparent" : "rgba(184,137,74,.07)"; }}
                          onClick={() => { setBellOpen(false); onOpenNotification?.(n); }}>
                          <Icon size={15} className="shrink-0 mt-0.5"
                            style={{ color: n.type === "approved" ? "#2D5F2F" : n.type === "rejected" ? "#9B2C2C" : "#B8894A" }} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-medium truncate">{n.title}</span>
                            {n.body && <span className="block text-[11px] opacity-60 truncate">{n.body}</span>}
                            <span className="block text-[10px] opacity-40 mt-0.5">{ago(n.createdAt)}</span>
                          </span>
                          {!n.read && <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: "#B8894A" }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Profile + vertical dropdown menu */}
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 transition-colors"
              style={{ border: "1px solid var(--c-ink-10)" }}
              aria-haspopup="menu" aria-expanded={menuOpen} title="Profile menu">
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                style={{ backgroundColor: "#B8894A", color: "#FAF7F0" }}>{initials}</span>
              <span className="hidden sm:block text-sm font-medium truncate max-w-[160px]">{user.name}</span>
              <ChevronDown size={14} className="opacity-60 transition-transform shrink-0" style={{ transform: menuOpen ? "rotate(180deg)" : "none" }} />
            </button>

            {menuOpen && (
              <div role="menu"
                className="absolute right-0 mt-2 w-60 rounded-xl overflow-hidden z-40"
                style={{ backgroundColor: "var(--c-paper)", border: "1px solid var(--c-ink-10)", boxShadow: "0 10px 30px rgba(15,26,46,.18)" }}>
                <div className="px-4 py-3 border-b" style={{ borderColor: "var(--c-ink-10)" }}>
                  <div className="text-sm font-medium truncate">{user.name}</div>
                  <div className="text-xs opacity-60 font-mono truncate">{user.email}</div>
                  <div className="text-[10px] tracking-widest uppercase opacity-50 mt-1">{roleLabel}</div>
                </div>

                {onEditSignature && (
                  <button role="menuitem" className={itemClass} style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                    onClick={() => { setMenuOpen(false); onEditSignature(); }}>
                    <PenTool size={15} className="opacity-70 shrink-0" /> {user.hasSignature ? "Update signature" : "Add a signature"}
                  </button>
                )}
                {onChangePassword && (
                  <button role="menuitem" className={itemClass} style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                    onClick={() => { setMenuOpen(false); onChangePassword(); }}>
                    <KeyRound size={15} className="opacity-70 shrink-0" /> Password
                  </button>
                )}
                {onBiometric && (
                  <button role="menuitem" className={itemClass} style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                    onClick={() => { setMenuOpen(false); onBiometric(); }}>
                    <ScanFace size={15} className="opacity-70 shrink-0" /> Biometric sign-in
                  </button>
                )}
                {onDelegation && (
                  <button role="menuitem" className={itemClass} style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                    onClick={() => { setMenuOpen(false); onDelegation(); }}>
                    <UserCog size={15} className="opacity-70 shrink-0" /> {user.role === "admin" ? "Assistants" : "My assistant"}
                  </button>
                )}
                {onToggleEmailNotifs && (
                  <button role="menuitem" className={itemClass} style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                    title="Workflow emails (new request / approved / rejected / reminders). In-app notifications always arrive."
                    onClick={() => onToggleEmailNotifs()}>
                    <Mail size={15} className="opacity-70 shrink-0" />
                    <span className="flex-1">Email notifications</span>
                    <span className="relative inline-flex items-center shrink-0" aria-hidden="true"
                      style={{ width: 34, height: 18, borderRadius: 999, transition: "background .15s",
                        backgroundColor: user.emailNotifications !== false ? "#2D5F2F" : "rgba(15,26,46,.18)" }}>
                      <span style={{ position: "absolute", top: 2, left: user.emailNotifications !== false ? 18 : 2,
                        width: 14, height: 14, borderRadius: 999, backgroundColor: "#FAF7F0", transition: "left .15s" }} />
                    </span>
                  </button>
                )}
                {/* Only rendered when the admin has granted this account the
                    high-contrast display — the feature is per-user, not global. */}
                {onToggleDarkMode && user.darkModeAllowed && (
                  <button role="menuitem" className={itemClass} style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                    title="Inverts the whole screen — white becomes black — for easier reading, documents included."
                    onClick={() => onToggleDarkMode()}>
                    <Moon size={15} className="opacity-70 shrink-0" />
                    <span className="flex-1">High-contrast display</span>
                    <span className="relative inline-flex items-center shrink-0" aria-hidden="true"
                      style={{ width: 34, height: 18, borderRadius: 999, transition: "background .15s",
                        backgroundColor: user.darkModeOn ? "#2D5F2F" : "rgba(15,26,46,.18)" }}>
                      <span style={{ position: "absolute", top: 2, left: user.darkModeOn ? 18 : 2,
                        width: 14, height: 14, borderRadius: 999, backgroundColor: "#FAF7F0", transition: "left .15s" }} />
                    </span>
                  </button>
                )}
                {onHelp && (
                  <button role="menuitem" className={itemClass} style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                    onClick={() => { setMenuOpen(false); onHelp(); }}>
                    <HelpCircle size={15} className="opacity-70 shrink-0" /> Help
                  </button>
                )}
                {onInstall && (
                  <button role="menuitem" className={itemClass} style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                    onClick={() => { setMenuOpen(false); onInstall(); }}>
                    <Download size={15} className="opacity-70 shrink-0" /> Install app
                  </button>
                )}
                <div className="border-t" style={{ borderColor: "var(--c-ink-10)" }} />
                <button role="menuitem" className={itemClass} style={{ color: "var(--c-rust-deep, #7A1F1F)" }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                  onClick={() => { setMenuOpen(false); logout(); }}>
                  <LogOut size={15} className="opacity-80 shrink-0" /> Sign out
                </button>
              </div>
            )}
          </div>

          {/* Direct Sign out — icon only, one tap (no menu needed) */}
          <button onClick={logout} className="btn-ghost text-sm px-2" title="Sign out" aria-label="Sign out"
            style={{ color: "var(--c-rust-deep, #7A1F1F)" }}>
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
