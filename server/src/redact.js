// Redact secrets from an email body BEFORE it is written to the Email log.
//
// Welcome / password-reset emails necessarily contain the user's plaintext
// password (the recipient needs it to sign in), but the Email log is a broad
// admin surface and must never persist plaintext credentials. The real password
// is still delivered in the actual email that goes to the user; only the copy
// stored in the `emails` table is masked here.
//
// Admins who need a user's password read it from the Users page
// (users.last_temp_password) — this function does NOT touch that.
export function redactEmailBody(body) {
  return String(body == null ? "" : body)
    // Mask the value after a "Password:" / "New password:" label at line start,
    // keeping the label + its alignment spaces so the log still reads cleanly.
    .replace(/^(Password:\s*|New password:\s*).+$/gm, "$1••••••••");
}
