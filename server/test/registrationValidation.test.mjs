import assert from "node:assert/strict";
import { validateRegistration } from "../src/registrationValidation.js";

// valid → normalised (trimmed, email lowercased)
{
  const r = validateRegistration({ name: "  Asha Rao ", email: "Asha.Rao@HQHB.in", password: "secret1", teamName: " Finance ", reportingManager: " Moiz " });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { name: "Asha Rao", email: "asha.rao@hqhb.in", password: "secret1", teamName: "Finance", reportingManager: "Moiz" });
}
assert.equal(validateRegistration({ name: "", email: "a@b.co", password: "secret1" }).ok, false);     // name required
assert.equal(validateRegistration({ name: "A", email: "not-an-email", password: "secret1" }).ok, false); // bad email
assert.equal(validateRegistration({ name: "A", email: "a@b.co", password: "short" }).ok, false);       // < 6 chars
// team/manager optional → default to ""
{
  const r = validateRegistration({ name: "A", email: "a@b.co", password: "secret1" });
  assert.equal(r.ok, true);
  assert.equal(r.value.teamName, "");
  assert.equal(r.value.reportingManager, "");
}
console.log("registrationValidation: all tests passed");
