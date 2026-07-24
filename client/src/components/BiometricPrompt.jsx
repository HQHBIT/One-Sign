import { useState, useEffect } from "react";
import { ScanFace } from "lucide-react";
import {
  enrolBiometric, biometricAvailableHere, biometricErrorMessage,
  deviceHasBiometric, biometricPromptDismissed, dismissBiometricPrompt,
} from "../lib/biometric.js";

// A one-time invite, shown after login on a device that supports Face ID /
// fingerprint / Windows Hello where the user hasn't enrolled yet. It reuses the
// exact same secure enrolment as the profile-menu option — this only changes when
// the option is surfaced, so every user is actively offered it on every capable
// device instead of having to find it in a menu.
//
//   hold  — suppress while a higher-priority modal is up (e.g. the mandatory
//           "add your signature" step), so prompts don't stack.
export function BiometricPrompt({ notify, hold = false }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hold) return;
    // Already enrolled here, or already said "not now" → never show.
    if (deviceHasBiometric() || biometricPromptDismissed()) return;
    let alive = true;
    biometricAvailableHere()
      .then(available => { if (alive && available) setShow(true); })
      .catch(() => { /* capability check failed — just don't offer */ });
    return () => { alive = false; };
  }, [hold]);

  if (!show) return null;

  const enable = async () => {
    setBusy(true);
    try {
      const r = await enrolBiometric();
      notify(`Biometric sign-in enabled on ${r.label || "this device"}.`, "success");
      setShow(false);
    } catch (e) {
      // Cancelled or failed — leave the prompt up so they can retry or dismiss.
      notify(biometricErrorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const notNow = () => { dismissBiometricPrompt(); setShow(false); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(15,26,46,.6)" }}>
      <div className="card p-6 max-w-md w-full" style={{ backgroundColor: "var(--c-cream)" }}>
        <div className="flex items-center gap-3 mb-2">
          <div className="rounded-full p-2 shrink-0" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>
            <ScanFace size={22} />
          </div>
          <div className="font-display text-2xl">Sign in faster next time?</div>
        </div>
        <div className="text-sm opacity-60 mb-5">
          Use your fingerprint or Face ID to sign in on <b>this device</b> — no password to type.
          Your face or fingerprint never leaves the device; SignFlow only stores a key.
        </div>
        <div className="flex justify-end gap-3">
          <button className="btn-ghost" onClick={notNow} disabled={busy}>Not now</button>
          <button className="btn-primary" onClick={enable} disabled={busy}>
            <ScanFace size={15} /> {busy ? "Follow your device…" : "Enable now"}
          </button>
        </div>
      </div>
    </div>
  );
}
