import { useState, useRef, useEffect } from "react";
import { PenTool, LogOut, KeyRound, HelpCircle, Home, ChevronDown } from "lucide-react";

export function TopBar({ user, logout, onEditSignature, onChangePassword, onHome }) {
  // Link to the hosted docs in this repo. Always open in a new tab so the
  // user doesn't lose any in-progress work in SignFlow.
  const docsUrl = "https://github.com/taha-chunawala/One-Sign/blob/UAT/docs/user-guide.md";
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
                <a role="menuitem" href={docsUrl} target="_blank" rel="noopener noreferrer" className={itemClass} style={itemStyle}
                  onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={() => setMenuOpen(false)}>
                  <HelpCircle size={15} className="opacity-70 shrink-0" /> Help
                </a>
                <div className="border-t" style={{ borderColor: "var(--c-ink-10)" }} />
                <button role="menuitem" className={itemClass} style={{ color: "var(--c-rust-deep, #7A1F1F)" }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                  onClick={() => { setMenuOpen(false); logout(); }}>
                  <LogOut size={15} className="opacity-80 shrink-0" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
