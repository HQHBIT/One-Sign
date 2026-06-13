import { PenTool, LogOut, KeyRound, HelpCircle } from "lucide-react";

export function TopBar({ user, logout, onEditSignature, onChangePassword }) {
  // Link to the hosted docs in this repo. Always open in a new tab so the
  // user doesn't lose any in-progress work in SignFlow.
  const docsUrl = "https://github.com/taha-chunawala/One-Sign/blob/UAT/docs/user-guide.md";
  const roleLabel = { admin: "Administrator", requestor: "Requestor", approver: "Approver" }[user.role];
  return (
    <header className="border-b sticky top-0 z-30"
      style={{
        borderColor: "var(--c-ink-10)",
        backgroundColor: "var(--c-paper)",
        // Honour iPhone notch + safe areas so content isn't clipped on devices
        // with display cutouts. env(safe-area-inset-*) is no-op on desktop.
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
          {onChangePassword && (
            <button onClick={onChangePassword}
              className="btn-ghost text-sm px-2 sm:px-3"
              title="Change your password">
              <KeyRound size={14} />
              <span className="hidden lg:inline">Password</span>
            </button>
          )}
          <a href={docsUrl} target="_blank" rel="noopener noreferrer"
            className="btn-ghost text-sm px-2 sm:px-3"
            title="Open the user guide in a new tab">
            <HelpCircle size={14} />
            <span className="hidden lg:inline">Help</span>
          </a>
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
