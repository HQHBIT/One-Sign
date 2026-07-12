export function StatusPill({ status }) {
  // Withdrawn: neutral gray — the requestor pulled the request before any decision.
  if (status === "withdrawn") {
    return <span className="pill" style={{ backgroundColor: "rgba(15,26,46,.08)", color: "rgba(15,26,46,.55)" }}>Withdrawn</span>;
  }
  const label = { pending: "Pending", approved: "Approved", approved_pending: "Approved · 1h window", rejected: "Rejected" }[status];
  const cls = { pending: "pill-pending", approved: "pill-approved", approved_pending: "pill-approved-pending", rejected: "pill-rejected" }[status];
  return <span className={`pill ${cls}`}>{label}</span>;
}
