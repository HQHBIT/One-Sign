// ============================================================
//   Browser-back handler for SPA navigation
//   ------------------------------------------------------------
//   The app uses state-based navigation (no React Router). Without
//   this hook, clicking the browser back button leaves the site
//   entirely. Instead, the hook intercepts back navigation and
//   closes the topmost sub-view / drawer / modal first — only
//   leaving the site once the user is back at the home dashboard.
// ============================================================
import { useEffect, useRef } from "react";

const __backStack = [];
let __suppressNextPop = false;

if (typeof window !== "undefined" && !window.__sfBackInit) {
  window.__sfBackInit = true;
  window.addEventListener("popstate", () => {
    if (__suppressNextPop) { __suppressNextPop = false; return; }
    const top = __backStack.pop();
    if (top) top.handler();
  });
}

/**
 * Listen for the Escape key while `active` is true and run `onEscape`.
 * Lightweight alternative for closing modals / drawers via the keyboard.
 */
export function useEscapeKey(active, onEscape) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); handlerRef.current?.(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}

/**
 * Register an onBack handler while `active` is true. The hook pushes a
 * sentinel into window.history, and on browser-back pops the top of an
 * internal stack and calls its handler. When the component closes via
 * its own UI (X / in-app back), cleanup splices itself out and pops the
 * sentinel without re-triggering the global popstate listener.
 */
export function useBackHandler(active, onBack) {
  const handlerRef = useRef(onBack);
  handlerRef.current = onBack;
  useEffect(() => {
    if (!active) return;
    const entry = { handler: () => handlerRef.current?.() };
    __backStack.push(entry);
    window.history.pushState({ sf: true }, "");
    return () => {
      const idx = __backStack.indexOf(entry);
      if (idx === -1) return; // already popped by browser-back
      __backStack.splice(idx, 1);
      if (idx === __backStack.length) {
        // We were on top — pop our sentinel without re-triggering the global handler
        __suppressNextPop = true;
        window.history.back();
      }
    };
  }, [active]);
}

// Locks the WEBSITE scroll while a full-screen drawer is open, so the only
// scrollbar on screen is the drawer's own. The page scroller here is <html>,
// not <body> — index.css sets overflow-x:hidden on html, which makes html the
// viewport scroller, so a body-only lock leaves the website scrollbar alive.
// Compensates for the vanished scrollbar's width so content doesn't jump.
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement, body = document.body;
    const gutter = window.innerWidth - html.clientWidth;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPad: body.style.paddingRight,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (gutter > 0) body.style.paddingRight = gutter + "px";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.paddingRight = prev.bodyPad;
    };
  }, [active]);
}
