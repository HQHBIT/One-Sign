// Tiny helper for review-style key/value rows. Used by OnboardUserWizard
// and friends. Keep the API minimal — just label + value.
export function Row({ label, value }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <div className="text-[10px] tracking-wider uppercase opacity-50 w-32 shrink-0 mt-1">{label}</div>
      <div className="flex-1">{value || <span className="opacity-50">—</span>}</div>
    </div>
  );
}
