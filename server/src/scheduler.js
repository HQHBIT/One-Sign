import { query, execute, queryOne } from "./db.js";
import { sendEmail } from "./email.js";

const WINDOW_MS = parseInt(process.env.APPROVAL_WINDOW_MS || "3600000", 10);

async function tick() {
  const cutoff = Date.now() - WINDOW_MS;
  const rows = await query(
    "SELECT * FROM requests WHERE status = 'approved_pending' AND approved_at <= ?",
    [cutoff]
  );
  if (rows.length === 0) return;

  const nowTs = Date.now();
  for (const r of rows) {
    await execute("UPDATE requests SET status = 'approved', finalized_at = ? WHERE id = ?", [nowTs, r.id]);
    const requestor = await queryOne("SELECT * FROM users WHERE id = ?", [r.requestor_id]);
    const approver  = await queryOne("SELECT * FROM users WHERE id = ?", [r.approver_id]);
    try {
      await sendEmail({
        to: requestor?.email,
        template: "approved",
        ctx: {
          requestorName: requestor?.name,
          fileName: r.file_name,
          approverName: approver?.name
        }
      });
    } catch (e) { console.error("[scheduler] email failure", e); }
    console.log(`[scheduler] Finalised request ${r.id}`);
  }
}

export function startScheduler() {
  setInterval(() => { tick().catch(e => console.error("[scheduler]", e)); }, 30_000);
  tick().catch(e => console.error("[scheduler]", e));
  console.log(`[scheduler] Running. Approval window: ${WINDOW_MS / 1000}s`);
}
