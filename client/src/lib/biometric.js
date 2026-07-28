// Biometric (WebAuthn / passkey) sign-in helpers. The device performs the
// face/fingerprint check locally; we only exchange challenges + a signature.
import {
  startRegistration, startAuthentication,
  browserSupportsWebAuthn, platformAuthenticatorIsAvailable,
} from "@simplewebauthn/browser";
import { api } from "../api.js";

export const biometricSupported = () => browserSupportsWebAuthn();
// True when this device has a built-in authenticator (Face ID / Touch ID /
// Windows Hello) — used to decide whether to surface the biometric options.
export async function biometricAvailableHere() {
  try { return browserSupportsWebAuthn() && await platformAuthenticatorIsAvailable(); }
  catch { return false; }
}

// Remembers (per-browser) that this device has a biometric enrolled, so the
// login screen can offer the button only where it will actually work.
const BIO_FLAG = "sf_bio_enrolled";
export const deviceHasBiometric = () => { try { return localStorage.getItem(BIO_FLAG) === "1"; } catch { return false; } };
// Forget the local "enrolled here" hint — e.g. when the server says this device
// is no longer registered, so we stop offering a button that can't work.
export const forgetBiometricHere = () => { try { localStorage.removeItem(BIO_FLAG); } catch { /* ignore */ } };

// The proactive post-login prompt (BiometricPrompt) offers to turn biometric on.
// "Not now" sets this flag so we don't nag on every login — the option always
// stays available under the profile menu.
const BIO_PROMPT_DISMISSED = "sf_bio_prompt_dismissed";
export const biometricPromptDismissed = () => { try { return localStorage.getItem(BIO_PROMPT_DISMISSED) === "1"; } catch { return false; } };
export const dismissBiometricPrompt = () => { try { localStorage.setItem(BIO_PROMPT_DISMISSED, "1"); } catch { /* ignore */ } };

// Enrol the current (logged-in) device. Throws on failure / cancellation.
export async function enrolBiometric() {
  const { options, challengeId } = await api.webauthnRegisterOptions();
  const response = await startRegistration({ optionsJSON: options });
  const result = await api.webauthnRegisterVerify({ response, challengeId }); // { ok, label }
  try { localStorage.setItem(BIO_FLAG, "1"); } catch { /* ignore */ }
  return result;
}

// Sign in with the device biometric. With an email, the server offers that
// account's passkeys — enabling synced passkeys and the QR → phone hand-off on
// devices that never enrolled. Without one, the device's own discoverable
// passkey is used. Returns { token, user }.
export async function loginBiometric(email) {
  const { options, challengeId } = await api.webauthnLoginOptions(email);
  const response = await startAuthentication({ optionsJSON: options });
  const session = await api.webauthnLoginVerify({ response, challengeId });
  if (session?.user?.email) rememberBiometricEmail(session.user.email);
  return session;
}

// The email last used for biometric sign-in on this browser — prefills the
// "saved email + biometrics" flow so returning users are one tap from in.
const BIO_EMAIL = "sf_bio_email";
export const savedBiometricEmail = () => { try { return localStorage.getItem(BIO_EMAIL) || ""; } catch { return ""; } };
export const rememberBiometricEmail = (e) => { try { if (e) localStorage.setItem(BIO_EMAIL, e); } catch { /* ignore */ } };

// The WebAuthn browser API throws a DOMException on user cancel / no-credential;
// turn those into friendly copy for the UI.
export function biometricErrorMessage(e) {
  const name = e?.name || "";
  if (name === "NotAllowedError") return "Cancelled — no biometric was provided.";
  if (name === "InvalidStateError") return "This device is already enrolled.";
  if (name === "AbortError") return "Cancelled.";
  return e?.message || "Biometric step failed.";
}
