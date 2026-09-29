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

// One colour per stage on the dashboard strips, cycling if a board has more.
export const STAGE_COLOURS = ["#B8894A", "#5E7E98", "#5C8A5C", "#9A6B8C", "#C27C4A", "#6B8E9E", "#8C7A5C", "#7A6B9A"];
export const stageColour = (i) => STAGE_COLOURS[i % STAGE_COLOURS.length];
