export function StatusPill({ status }) {
  const label = { pending: "Pending", approved: "Approved", approved_pending: "Approved · 1h window", rejected: "Rejected" }[status];
  const cls = { pending: "pill-pending", approved: "pill-approved", approved_pending: "pill-approved-pending", rejected: "pill-rejected" }[status];
  return <span className={`pill ${cls}`}>{label}</span>;
}
