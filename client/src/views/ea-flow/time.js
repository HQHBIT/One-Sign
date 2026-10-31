// Durations the way a person reads them on a board: "3d 4h", "2h 15m", "40m".
// Nothing below a minute is worth a number.
export function fmtDuration(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return "<1m";
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  if (d > 0) return h ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return min ? `${h}h ${min}m` : `${h}h`;
  return `${min}m`;
}

export function fmtWhen(ts) {
  if (!ts) return "";
  return new Date(Number(ts)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

// The people a CC stage copies, as a phrase that fits on a card: "Ali",
// "Ali and Sara", "Ali, Sara and 2 others". A stage can copy a dozen people and
// the column header still has to be one readable line.
//
// Falls back to the single `signer` a stage reported before CC stages could
// hold a list, so a board loaded from an older server still names somebody.
export function ccNames(stage) {
  const people = stage?.ccPeople?.length ? stage.ccPeople : (stage?.signer ? [stage.signer] : []);
  const names = people.map((p) => p.name).filter(Boolean);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 === 1 ? "" : "s"}`;
}

// The picker list: Executive Management, plus anyone ALREADY on the stage who
// is not in it (chosen before the list was narrowed). Without them a dropdown
// would silently show someone else, and an untick-only reader would vanish.
export function withCurrent(executives, current) {
  const ids = new Set(executives.map((x) => x.id));
  const extra = (current || []).filter((p) => p?.id && !ids.has(p.id)).map((p) => ({ ...p, earlier: true }));
  return [...executives, ...extra];
}

// One colour per stage on the dashboard strips, cycling if a board has more.
export const STAGE_COLOURS = ["#B8894A", "#5E7E98", "#5C8A5C", "#9A6B8C", "#C27C4A", "#6B8E9E", "#8C7A5C", "#7A6B9A"];
export const stageColour = (i) => STAGE_COLOURS[i % STAGE_COLOURS.length];
