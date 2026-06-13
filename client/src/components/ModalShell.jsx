import { X } from "lucide-react";
import { useEscapeKey } from "../lib/useBackHandler.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";

export function ModalShell({ title, onClose, children }) {
  useEscapeKey(true, onClose);
  const trapRef = useFocusTrap(true);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(15,26,46,.65)" }} onClick={onClose}>
      <div ref={trapRef} className="card p-6 max-w-xl w-full max-h-[90vh] overflow-auto" style={{ backgroundColor: "var(--c-cream)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-2xl pr-4">{title}</div>
          <button onClick={onClose} className="btn-ghost text-xs"><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
