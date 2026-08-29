// ============================================================
//   WHICH ORGANISATION'S DOOR AM I AT?
//   ------------------------------------------------------------
//   SignFlow serves more than one organisation, each with its own people and
//   its own login. The choice is made on the landing page and remembered, so a
//   returning user goes straight to their own sign-in rather than picking every
//   time. It is only a convenience: the server independently checks that the
//   account belongs to the organisation being signed in to, so tampering with
//   this value cannot get anyone into a space they don't belong to.
// ============================================================

const KEY = "signflow.org";

export function getChosenOrg() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setChosenOrg(id) {
  try { if (id) localStorage.setItem(KEY, id); } catch { /* private mode — the picker just reappears */ }
}

export function clearChosenOrg() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
