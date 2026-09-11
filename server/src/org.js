// ============================================================
//   WHICH ORGANISATION IS THIS DEPLOYMENT?
//   ------------------------------------------------------------
//   One box serves one organisation. ORG_SLUG in .env says which, written by
//   that box's own deploy workflow, and /auth/config uses it to decide which
//   sign-in door to show. Every row created on this box belongs to the same
//   organisation, so every INSERT should carry it explicitly.
//
//   Explicitly matters: users.org_id has a DEFAULT of 'hqhb', so an INSERT that
//   omits the column does not fail — it quietly writes an HQHB row. On the WAQF
//   box that produced accounts nobody could sign in with, because the login
//   check refuses an account whose organisation is not the door's, and refuses
//   it with a response identical to a wrong password.
//
//   The 'hqhb' fallback matches that column default, so a box without ORG_SLUG
//   behaves exactly as it did before this existed.
// ============================================================

export function deploymentOrg() {
  return process.env.ORG_SLUG || "hqhb";
}

/**
 * Whether this deployment records documents being sent on for Manzoori.
 *
 * A WAQF practice, so it is off elsewhere rather than sitting unused in every
 * other deployment's interface. MANZOORI_ENABLED overrides it per box.
 *
 * Keyed on ORG_SLUG, which the box's own deploy writes, and deliberately NOT on
 * the org_id stored against a request: requests raised on the WAQF box are still
 * written with org_id 'hqhb', so gating on that column would gate on a value
 * already known to be wrong.
 */
export function manzooriEnabled() {
  const set = process.env.MANZOORI_ENABLED;
  if (set != null && String(set).trim() !== "") {
    return String(set).trim().toLowerCase() === "true";
  }
  return deploymentOrg() === "waqf";
}
