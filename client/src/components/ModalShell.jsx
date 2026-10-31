import { X } from "lucide-react";
import { useEscapeKey } from "../lib/useBackHandler.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";

// `size="xl"` is for dialogs that hold a document beside their controls.
// `subtitle` takes a long name (a file name, say) off the title line.
const WIDTHS = { md: "max-w-xl", xl: "max-w-6xl" };

export function ModalShell({ title, subtitle, size = "md", onClose, children }) {
  useEscapeKey(true, onClose);
  const trapRef = useFocusTrap(true);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(15,26,46,.65)" }} onClick={onClose}>
      <div ref={trapRef} className={`card p-6 ${WIDTHS[size] || WIDTHS.md} w-full max-h-[90vh] overflow-y-auto overflow-x-hidden`} style={{ backgroundColor: "var(--c-cream)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          {/* min-w-0 + anywhere-wrapping: a long unbroken file name used to push
              the dialog wider than the screen and cut its left side off. */}
          <div className="min-w-0 flex-1" style={{ overflowWrap: "anywhere" }}>
            <div className="font-display text-2xl">{title}</div>
            {subtitle && <div className="text-sm opacity-60 mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="btn-ghost text-xs shrink-0" aria-label="Close"><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
