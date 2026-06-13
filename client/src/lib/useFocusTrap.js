// ============================================================
//   useFocusTrap — keep Tab navigation inside an open modal
//   ------------------------------------------------------------
//   When `active` is true, Tab cycles through focusable elements
//   within the ref'd container and Shift+Tab cycles backwards.
//   On activation, focus moves to the first focusable element.
//   On deactivation, focus restores to the element that was focused
//   before the trap engaged.
// ============================================================
import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

/**
 * @param {boolean} active
 * @returns React ref — attach to the root element of the modal/drawer.
 */
export function useFocusTrap(active) {
  const containerRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Remember focus so we can restore it when the trap deactivates
    restoreRef.current = document.activeElement;

    const focusables = () => Array.from(container.querySelectorAll(FOCUSABLE))
      .filter(el => el.offsetParent !== null); // visible only

    // Move focus inside on mount, unless an element inside already has it
    if (!container.contains(document.activeElement)) {
      const first = focusables()[0];
      first?.focus();
    }

    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    container.addEventListener("keydown", onKey);
    return () => {
      container.removeEventListener("keydown", onKey);
      // Restore focus to whatever had it before
      const prev = restoreRef.current;
      if (prev && typeof prev.focus === "function") {
        try { prev.focus(); } catch {}
      }
    };
  }, [active]);

  return containerRef;
}
