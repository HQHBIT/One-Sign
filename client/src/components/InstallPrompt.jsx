import { useState, useEffect, useCallback } from "react";
import { Download, X, Share, Plus, Smartphone } from "lucide-react";

// Already running as an installed app (home-screen / standalone window)?
function standalone() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
    || window.navigator.standalone === true;
}
// iOS Safari never fires beforeinstallprompt — detect it so we can show manual steps.
function detectIOS() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS 13+
}
function mobileViewport() {
  return !!window.matchMedia && (
    window.matchMedia("(max-width: 820px)").matches ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

// Central install state. Reads the beforeinstallprompt event stashed on
// window.__bipEvent by the inline script in index.html.
export function useInstall() {
  const [canPrompt, setCanPrompt] = useState(!!window.__bipEvent);
  const [installed, setInstalled] = useState(standalone());
  const ios = detectIOS();
  const mobile = mobileViewport();

  useEffect(() => {
    const onAvail = () => setCanPrompt(true);
    const onInstalled = () => { setInstalled(true); setCanPrompt(false); };
    window.addEventListener("bip-available", onAvail);
    window.addEventListener("bip-installed", onInstalled);
    const mq = window.matchMedia && window.matchMedia("(display-mode: standalone)");
    const onMode = () => setInstalled(standalone());
    mq && mq.addEventListener && mq.addEventListener("change", onMode);
    return () => {
      window.removeEventListener("bip-available", onAvail);
      window.removeEventListener("bip-installed", onInstalled);
      mq && mq.removeEventListener && mq.removeEventListener("change", onMode);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const e = window.__bipEvent;
    if (!e) return "unavailable";
    e.prompt();
    const choice = await e.userChoice;
    window.__bipEvent = null;
    setCanPrompt(false);
    return choice && choice.outcome; // "accepted" | "dismissed"
  }, []);

  // Something we can actually offer the user: a native prompt, or iOS manual steps.
  const supported = !installed && (canPrompt || ios);
  return { installed, canPrompt, ios, mobile, supported, promptInstall };
}

// Slim, dismissible banner nudging mobile users to install. One-time (dismissal
// is remembered); hidden once installed or when there's nothing to offer.
export function InstallBanner({ install, onInstall }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("sf_install_dismissed") === "1"; } catch { return false; }
  });
  if (dismissed || !install.supported || !install.mobile) return null;
  const dismiss = () => {
    try { localStorage.setItem("sf_install_dismissed", "1"); } catch { /* ignore */ }
    setDismissed(true);
  };
  return (
    <div className="mb-5 rounded-xl flex items-center gap-3 px-4 py-3"
      style={{ backgroundColor: "var(--c-paper)", border: "1px solid var(--c-ink-10)", borderLeft: "4px solid #B8894A", boxShadow: "0 4px 16px rgba(15,26,46,.06)" }}>
      <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: "rgba(184,137,74,.14)", color: "#B8894A" }}>
        <Smartphone size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight">Install HQHB SignFlow</div>
        <div className="text-xs opacity-60 leading-snug">Add it to your home screen for quick, full-screen access.</div>
      </div>
      <button type="button" className="btn-primary text-xs shrink-0" onClick={onInstall}>
        <Download size={13} /> Install
      </button>
      <button type="button" aria-label="Dismiss" className="btn-ghost text-xs px-2 shrink-0" onClick={dismiss}>
        <X size={14} />
      </button>
    </div>
  );
}

// iOS can't trigger the install dialog — walk the user through Share → Add to Home Screen.
export function IosInstallSheet({ onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const Step = ({ n, children, icon }) => (
    <div className="flex items-start gap-3">
      <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
        style={{ backgroundColor: "#B8894A", color: "#FAF7F0" }}>{n}</span>
      <div className="text-sm leading-relaxed flex items-center gap-1.5 flex-wrap">{children}{icon}</div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: "rgba(15,26,46,.45)" }} onClick={onClose}>
      <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5"
        style={{ backgroundColor: "var(--c-paper)", paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(184,137,74,.14)", color: "#B8894A" }}>
              <Smartphone size={16} />
            </span>
            <div className="font-display text-lg leading-tight">Install on iPhone</div>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={onClose}><X size={15} /></button>
        </div>
        <p className="text-xs opacity-60 mb-4">In Safari, add HQHB SignFlow to your home screen — it opens full-screen like an app.</p>
        <div className="space-y-3">
          <Step n="1" icon={<Share size={16} style={{ color: "#B8894A" }} />}>Tap the <span className="font-medium">Share</span> button</Step>
          <Step n="2" icon={<Plus size={16} style={{ color: "#B8894A" }} />}>Choose <span className="font-medium">Add to Home Screen</span></Step>
          <Step n="3">Tap <span className="font-medium">Add</span> — you'll find HQHB SignFlow on your home screen.</Step>
        </div>
        <button type="button" className="btn-primary w-full mt-6 justify-center" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
