import { ChevronRight } from "lucide-react";

export function Tile({ icon: Icon, title, desc, badge, color = "var(--c-ink)", onClick }) {
  return (
    <button onClick={onClick} className="card tile-hover text-left p-5 sm:p-6 relative overflow-hidden block w-full">
      <div className="flex items-start justify-between mb-5 sm:mb-8">
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center" style={{ backgroundColor: color, color: "var(--c-cream)" }}>
          <Icon size={18} className="sm:hidden" />
          <Icon size={20} className="hidden sm:block" />
        </div>
        {badge != null && badge > 0 && (
          <div className="text-xl sm:text-2xl font-display" style={{ color }}>{badge}</div>
        )}
      </div>
      <div className="font-display text-lg sm:text-xl mb-1 sm:mb-1.5">{title}</div>
      <div className="text-xs sm:text-sm opacity-60 leading-relaxed">{desc}</div>
      <div className="mt-3 sm:mt-4 flex items-center gap-1 text-[10px] sm:text-xs tracking-wider uppercase opacity-50">
        Open <ChevronRight size={12} />
      </div>
    </button>
  );
}
