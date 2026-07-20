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

// Enrol the current (logged-in) device. Throws on failure / cancellation.
export async function enrolBiometric() {
  const { options, challengeId } = await api.webauthnRegisterOptions();
  const response = await startRegistration({ optionsJSON: options });
  const result = await api.webauthnRegisterVerify({ response, challengeId }); // { ok, label }
  try { localStorage.setItem(BIO_FLAG, "1"); } catch { /* ignore */ }
  return result;
}

// Sign in with the device biometric (usernameless). Returns { token, user }.
export async function loginBiometric() {
  const { options, challengeId } = await api.webauthnLoginOptions();
  const response = await startAuthentication({ optionsJSON: options });
  return api.webauthnLoginVerify({ response, challengeId });
}

// The WebAuthn browser API throws a DOMException on user cancel / no-credential;
// turn those into friendly copy for the UI.
export function biometricErrorMessage(e) {
  const name = e?.name || "";
  if (name === "NotAllowedError") return "Cancelled — no biometric was provided.";
  if (name === "InvalidStateError") return "This device is already enrolled.";
  if (name === "AbortError") return "Cancelled.";
  return e?.message || "Biometric step failed.";
}
