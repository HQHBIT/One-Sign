// ============================================================
//   Whose-turn-is-it rules. Regression guard for the bug where a request
//   stayed in the FIRST signer's pending list after they had signed it and it
//   had moved on to the second signer.
//   Run: node client/src/lib/turn.test.mjs
// ============================================================
import { nextPendingSigner, isMyTurn, iSignedInWorkflow } from "./turn.js";

let failed = 0;
const ck = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failed++; };

const HUZAIFA = "u_huzaifa", IDRIS = "u_idris", RAISER = "u_muffadal";

// One step, two signers in sequence: Huzaifa (1st) has signed, Idris (2nd) has not.
const twoSignersOneStep = {
  id: "r1", status: "pending", requestorId: RAISER, targetTeamId: "t_exec",
  workflow: [{
    order: 1, teamId: "t_exec", status: "active",
    signers: [
      { order: 1, userId: HUZAIFA, userName: "Huzaifa Bs", status: "signed" },
      { order: 2, userId: IDRIS, userName: "Idris Bs", status: "pending" },
    ]
  }]
};

ck(nextPendingSigner(twoSignersOneStep)?.userId === IDRIS, "waiting on Idris, the 2nd signer");
ck(isMyTurn(twoSignersOneStep, IDRIS) === true, "Idris CAN act");
ck(isMyTurn(twoSignersOneStep, HUZAIFA) === false, "Huzaifa CANNOT act — he already signed  <-- the reported bug");
ck(iSignedInWorkflow(twoSignersOneStep, HUZAIFA) === true, "Huzaifa is recorded as having signed");

// Nobody has signed yet: only the 1st signer may act, not the 2nd.
const untouched = JSON.parse(JSON.stringify(twoSignersOneStep));
untouched.workflow[0].signers[0].status = "pending";
ck(nextPendingSigner(untouched)?.userId === HUZAIFA, "fresh request waits on the 1st signer");
ck(isMyTurn(untouched, HUZAIFA) === true, "1st signer can act");
ck(isMyTurn(untouched, IDRIS) === false, "2nd signer must wait their turn");

// Signers arriving out of order must still resolve by `order`, not array position.
const shuffled = JSON.parse(JSON.stringify(untouched));
shuffled.workflow[0].signers.reverse();
ck(nextPendingSigner(shuffled)?.userId === HUZAIFA, "order wins over array position");

// Two steps: step 1 done, step 2 active and waiting on Idris.
const twoSteps = {
  id: "r2", status: "pending", requestorId: RAISER,
  workflow: [
    { order: 1, teamId: "t_a", status: "done", signers: [{ order: 1, userId: HUZAIFA, status: "signed" }] },
    { order: 2, teamId: "t_exec", status: "active", signers: [{ order: 1, userId: IDRIS, status: "pending" }] },
  ]
};
ck(isMyTurn(twoSteps, HUZAIFA) === false, "step-1 signer is done, not pending");
ck(isMyTurn(twoSteps, IDRIS) === true, "step-2 signer is up");

// Everyone has signed — nobody's turn.
const allSigned = JSON.parse(JSON.stringify(twoSignersOneStep));
allSigned.workflow[0].signers[1].status = "signed";
ck(nextPendingSigner(allSigned) === null, "fully signed step waits on nobody");
ck(isMyTurn(allSigned, IDRIS) === false, "nobody can act once all have signed");

// Legacy single-approver requests: authority over the target team decides.
const legacy = { id: "r3", status: "pending", requestorId: RAISER, targetTeamId: "t_exec", workflow: [] };
ck(isMyTurn(legacy, HUZAIFA, ["t_exec"]) === true, "legacy: authority holder can act");
ck(isMyTurn(legacy, HUZAIFA, ["t_other"]) === false, "legacy: no authority, no action");
ck(isMyTurn(legacy, HUZAIFA, []) === false, "legacy: empty authority list");

// You never approve your own request, however you're wired in.
const own = { ...legacy, requestorId: HUZAIFA };
ck(isMyTurn(own, HUZAIFA, ["t_exec"]) === false, "never approve what you raised");

// Non-pending requests are never actionable.
for (const st of ["approved", "approved_pending", "rejected", "withdrawn"]) {
  ck(isMyTurn({ ...legacy, status: st }, HUZAIFA, ["t_exec"]) === false, `status "${st}" is not actionable`);
}

// Defensive: malformed / missing data must not throw.
ck(nextPendingSigner(null) === null, "null request");
ck(nextPendingSigner({}) === null, "no workflow key");
ck(nextPendingSigner({ workflow: [] }) === null, "empty workflow");
ck(nextPendingSigner({ workflow: [{ status: "done", signers: [] }] }) === null, "no active step");
ck(isMyTurn(null, HUZAIFA) === false, "null request is not actionable");
ck(iSignedInWorkflow(null, HUZAIFA) === false, "null request has no signatures");

console.log(failed ? `\n${failed} check(s) failed` : "\nALL TURN RULES PASSED");
process.exit(failed ? 1 : 0);
