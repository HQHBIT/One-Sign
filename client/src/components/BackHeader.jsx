import { ChevronRight } from "lucide-react";

// `actions` sits at the right of the title, beside the count — for a control
// that belongs to the whole list, such as "New folder".
export function BackHeader({ back, title, step, actions }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <button onClick={back} className="text-xs tracking-wider uppercase opacity-60 hover:opacity-100 flex items-center gap-1 mb-2">
          <ChevronRight size={12} style={{ transform: "rotate(180deg)" }} /> Back
        </button>
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl leading-tight">{title}</h1>
      </div>
      {(step || actions) && (
        <div className="flex items-center gap-3 shrink-0 pt-1">
          {step && <div className="text-[10px] sm:text-xs tracking-wider uppercase opacity-50">{step}</div>}
          {actions}
        </div>
      )}
    </div>
  );
}
