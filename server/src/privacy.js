// ============================================================
//   DIRECTORY PRIVACY — what one signed-in user may learn about another
//   ------------------------------------------------------------
//   Pickers need a person's id and name; they do not need their email address.
//   A full address is for admins (who manage accounts) and for the person
//   themselves. Everyone else gets at most a hint that tells two people with
//   the same name apart without giving the address away: "m•••@gmail.com".
// ============================================================

export function maskEmail(email) {
  const s = String(email || "");
  const at = s.lastIndexOf("@");
  if (at < 1) return null;
  return `${s[0]}•••${s.slice(at)}`;
}
