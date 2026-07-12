import { useState, useRef, useEffect } from "react";
import { PenTool, LogOut, KeyRound, HelpCircle, Home, ChevronDown, Download } from "lucide-react";

export function TopBar({ user, logout, onEditSignature, onChangePassword, onHome, onHelp, onInstall }) {
  const roleLabel = { admin: "Administrator", requestor: "Requestor", approver: "Approver" }[user.role];
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
              <path d="M13 6 H29 L36 13 V37 Q36 42 31 42 H13 Q8 42 8 37 V11 Q8 6 13 6 Z" fill="#ffffff" stroke="#0F1A2E" strokeWidth="2.4" strokeLinejoin="round"/>
              <path d="M29 6 V11 Q29 13 31 13 H36" fill="none" stroke="#0F1A2E" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M14 27 C 17 20, 20 21, 22 26 C 23 29, 25 24, 28 20" fill="none" stroke="#12274B" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 31 C 19 34, 25 32, 31 26" fill="none" stroke="#E8792E" strokeWidth="2.4" strokeLinecap="round"/>
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
