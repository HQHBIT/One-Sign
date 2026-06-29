// Pure input validation for a self-registration submission. No DB, no framework.
const MAX = 191;

export function validateRegistration(body = {}) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  if (name.length > MAX) return { ok: false, error: `Name must be ${MAX} characters or fewer` };

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "A valid email is required" };
  if (email.length > MAX) return { ok: false, error: "Email is too long" };

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters" };

  const teamName = typeof body.teamName === "string" ? body.teamName.trim().slice(0, MAX) : "";
  const reportingManager = typeof body.reportingManager === "string" ? body.reportingManager.trim().slice(0, MAX) : "";

  return { ok: true, value: { name, email, password, teamName, reportingManager } };
}
