// ============================================================
//   Whose turn is it?
//   ------------------------------------------------------------
//   Signing is strictly sequential: within the ACTIVE step, the lowest
//   signer_order still pending is the only person who can act. Everyone else on
//   the route — including those who have already signed — is a bystander until
//   their turn comes round.
//
//   This mirrors the server's getNextPendingSigner() exactly. Keep the two in
//   step: if the server ever allows out-of-order signing, this must follow.
// ============================================================

/** The signer the request is currently waiting on, or null. */
export function nextPendingSigner(r) {
  if (!r?.workflow?.length) return null;
  const active = r.workflow.find(s => s.status === "active");
  if (!active) return null;
  // Hydrated signers arrive ordered by signer_order; sort defensively anyway.
  const pending = (active.signers || []).filter(s => s.status === "pending");
  if (pending.length === 0) return null;
  return pending.reduce((a, b) => (Number(a.order) <= Number(b.order) ? a : b));
}

/** The step the request is currently on, or null. */
export function activeStep(r) {
  return r?.workflow?.length ? (r.workflow.find(s => s.status === "active") || null) : null;
}

/**
 * Can this user act on this request RIGHT NOW?
 *   - never on a request they raised themselves
 *   - workflow: only if they are the next pending signer
 *   - legacy single-approver: only if they hold authority over the target team
 * `authorityTeams` is user.signingAuthorityTeams.
 */
export function isMyTurn(r, userId, authorityTeams = []) {
  if (!r || r.status !== "pending") return false;
  if (r.requestorId === userId) return false;
  if (r.workflow?.length) return nextPendingSigner(r)?.userId === userId;
  return !!r.targetTeamId && authorityTeams.includes(r.targetTeamId);
}

/** Has this user already signed somewhere on the route? */
export function iSignedInWorkflow(r, userId) {
  return (r?.workflow || []).some(st =>
    (st.signers || []).some(s => s.userId === userId && s.status === "signed"));
}
