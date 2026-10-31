import { fmtDuration, fmtWhen } from "./time.js";

// The dashboard export, built as a pure function of the data so it can be
// tested. It used to live inside the click handler, where the only way to check
// a column was to download a file and open it.
//
// Shape follows the on-screen table: one row per document, one column per
// stage. CC readers get a column PER CC STAGE rather than one blob holding
// everybody, so the sheet can be sorted and filtered on "did the CEO read it" —
// which is the question anyone exporting this is trying to answer.
export function buildFlowCsv({ stages, documents, now = Date.now() }) {
  const ccStages = (stages || []).filter((s) => s.kind === "cc");
  const head = [
    "Document", "File", "Added", "Current stage", "In current stage",
    ...stages.map((s) => `Time in ${s.name}`),
    ...ccStages.map((s) => `Copied to ${s.name}`),
    "Stages skipped",
    "Total elapsed", "Completed",
  ];

  const rows = (documents || []).map((d) => {
    const cur = stages.find((s) => s.id === d.currentStageId);
    // Each reader on their own line INSIDE the cell. A quoted CSV field keeps
    // newlines, so one person per line stays readable however many are copied,
    // and nothing has to be split apart again later.
    const ccCell = (stageId) => (d.cc || [])
      .filter((c) => c.stageId === stageId)
      .map((c) => `${c.name || "someone"} — ${c.viewedAt ? `opened ${fmtWhen(c.viewedAt)}` : "not opened"}`)
      .join("\n");
    // Skipped stages were already on screen but missing from the export, which
    // is the half that actually gets sent upward.
    const skipped = (d.stages || [])
      .filter((s) => s.skipped)
      .map((s) => stages.find((x) => x.id === s.stageId)?.name)
      .filter(Boolean)
      .join(", ");
    return [
      d.title, d.fileName, fmtWhen(d.createdAt), cur?.name || "",
      d.completedAt ? "" : fmtDuration(now - d.enteredStageAt),
      ...(d.stages || []).map((s) => fmtDuration(s.ms)),
      ...ccStages.map((s) => ccCell(s.id)),
      skipped,
      fmtDuration(d.totalMs), d.completedAt ? fmtWhen(d.completedAt) : "",
    ];
  });

  // Every field quoted: names carry commas, and a CC cell carries newlines.
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}
