// ============================================================
//   useConfirm — promise-based confirmation dialog
//   ------------------------------------------------------------
//   Replaces native window.confirm() with a styled dialog that
//   matches the app's design language. The hook owns the dialog
//   state; callers `await confirm({...})` and receive true/false.
//
//   Two integration shapes:
//
//   1. App root:
//        const { confirm, ConfirmHost } = useConfirm();
//        return (
//          <ConfirmContext.Provider value={confirm}>
//            ...app...
//            <ConfirmHost />
//          </ConfirmContext.Provider>
//        );
//
//   2. Anywhere inside the provider:
//        const confirm = useConfirmation();
//        if (await confirm({ title: "Delete?", destructive: true })) ...
// ============================================================
import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import { useFocusTrap } from "./useFocusTrap.js";

const ConfirmContext = createContext(null);
export { ConfirmContext };

/** Consumer hook — `await confirm({...})` from anywhere under the provider. */
export function useConfirmation() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    // Fallback to native confirm so the app still works if the host is missing.
    return (opts) => Promise.resolve(window.confirm(opts?.message || opts?.title || "Are you sure?"));
  }
  return confirm;
}

/**
 * @returns {{ confirm: (opts) => Promise<boolean>, ConfirmHost: () => JSX }}
 *
 * opts = {
 *   title?:         string       // bold heading (default "Are you sure?")
 *   message?:       string|JSX   // body text — supports \n for line breaks
 *   confirmLabel?:  string       // default "Confirm"
 *   cancelLabel?:   string       // default "Cancel"
 *   destructive?:   boolean      // styles confirm button in danger red
 * }
 */
export function useConfirm() {
  const [state, setState] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState({
        title: "Are you sure?",
        confirmLabel: "Confirm",
        cancelLabel: "Cancel",
        destructive: false,
        ...opts
      });
    });
  }, []);

  const handle = useCallback((result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setState(null);
  }, []);

  // Escape closes (cancel); Enter confirms when dialog is open.
  useEffect(() => {
    if (!state) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); handle(false); }
      else if (e.key === "Enter") { e.preventDefault(); handle(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, handle]);

  const ConfirmHost = () => {
    const trapRef = useFocusTrap(!!state);
    if (!state) return null;
    return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(15,26,46,.65)" }}
      onClick={() => handle(false)}>
      <div ref={trapRef} className="card p-6 max-w-md w-full anim-in"
        style={{ backgroundColor: "var(--c-cream)" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{
              backgroundColor: state.destructive ? "rgba(155,44,44,.12)" : "rgba(184,137,74,.18)",
              color: state.destructive ? "var(--c-rust)" : "var(--c-sand)"
            }}>
            <AlertCircle size={18} />
          </div>
          <div className="flex-1">
            <div className="font-display text-xl">{state.title}</div>
            {state.message && <div className="text-sm opacity-75 mt-2 whitespace-pre-line">{state.message}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button autoFocus className="btn-ghost" onClick={() => handle(false)}>
            <X size={13} /> {state.cancelLabel}
          </button>
          <button className={state.destructive ? "btn-danger" : "btn-primary"} onClick={() => handle(true)}>
            <Check size={13} /> {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
  };

  return { confirm, ConfirmHost };
}
