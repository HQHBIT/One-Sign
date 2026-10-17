import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Play, SkipForward } from "lucide-react";
import { api } from "../api.js";
import { deploymentOrg } from "../lib/deployment.js";
import { libraryFor, toShowOnSignIn } from "../lib/whatsNew.js";
import { useEscapeKey, useScrollLock } from "../lib/useBackHandler.js";

// ============================================================
//   WHAT'S NEW — feature videos on sign-in, and a library of the last five
//   ------------------------------------------------------------
//   On sign-in each unseen feature that applies to the user plays once
//   (≤30 s, muted, captions burned in). Skip unlocks after 5 seconds;
//   finishing or skipping marks it seen on the server, so it does not repeat
//   on another device. Where WebM will not play (older iPhones) the same
//   feature is shown as captioned snapshots instead.
// ============================================================
const SKIP_AFTER_S = 5;
const SLIDE_MS = 6000;

const canPlayWebm = (() => {
  try { return !!document.createElement("video").canPlayType('video/webm; codecs="vp8"'); }
  catch { return false; }
})();

// Plays a list of features one after another. `gated`: the sign-in run, where
// Skip waits SKIP_AFTER_S seconds; from the library it is free to close.
function FeaturePlayer({ items, gated, onSeen, onClose }) {
  useScrollLock();
  const [i, setI] = useState(0);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [slides, setSlides] = useState(!canPlayWebm);
  const [slide, setSlide] = useState(0);
  const videoRef = useRef(null);
  const f = items[i];
  const canSkip = !gated || elapsed >= SKIP_AFTER_S;

  // Per feature: reset the clock and the slide.
  useEffect(() => {
    setProgress(0); setElapsed(0); setSlide(0); setSlides(!canPlayWebm);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    return () => clearInterval(tick);
  }, [i]);

  const next = () => {
    onSeen?.(f);
    if (i + 1 < items.length) setI(i + 1); else onClose();
  };
  useEscapeKey(true, () => { if (canSkip) next(); });

  // Snapshot mode: advance on a timer; the last slide ends the feature.
  useEffect(() => {
    if (!slides) return;
    const total = f.slides.length;
    setProgress(slide / total);
    const t = setTimeout(() => { if (slide + 1 < total) setSlide(slide + 1); else next(); }, SLIDE_MS);
    return () => clearTimeout(t);
  }, [slides, slide, i]);

  const s = f.slides[slide];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6" style={{ backgroundColor: "rgba(10,16,30,.82)" }}
      role="dialog" aria-modal="true" aria-label={`What's new: ${f.title}`}>
      <div className="w-full max-w-4xl rounded-xl overflow-hidden shadow-2xl anim-in" style={{ backgroundColor: "var(--c-cream)" }}>
        <div className="px-4 sm:px-5 py-3 flex items-center gap-3 border-b" style={{ borderColor: "var(--c-ink-10)" }}>
          <Sparkles size={16} style={{ color: "var(--c-gold)" }} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] tracking-widest uppercase opacity-50">
              What's new{items.length > 1 ? ` · ${i + 1} of ${items.length}` : ""}
            </div>
            <div className="font-display text-lg sm:text-xl truncate">{f.title}</div>
          </div>
          {gated ? (
            <button className="btn-ghost text-xs shrink-0" disabled={!canSkip} onClick={next}
              title={canSkip ? "Skip this video" : "You can skip in a moment"}>
              <SkipForward size={13} /> {canSkip ? "Skip" : `Skip in ${Math.max(1, Math.ceil(SKIP_AFTER_S - elapsed))}s`}
            </button>
          ) : (
            <button className="btn-ghost text-xs shrink-0" onClick={onClose} aria-label="Close"><X size={14} /></button>
          )}
        </div>

        <div className="bg-black relative" style={{ aspectRatio: "16 / 10" }}>
          {slides ? (
            <img key={s.src} src={s.src} alt={s.caption} className="w-full h-full object-contain anim-in" />
          ) : (
            <video key={f.id} ref={videoRef} src={f.video} poster={f.slides[0]?.src}
              className="w-full h-full object-contain" autoPlay muted playsInline
              onTimeUpdate={e => { const v = e.currentTarget; if (v.duration) setProgress(v.currentTime / v.duration); }}
              onEnded={next}
              onError={() => setSlides(true)} />
          )}
        </div>
        {slides && <div className="px-5 py-3 text-sm text-center font-medium">{s.caption}</div>}

        <div className="h-1" style={{ backgroundColor: "var(--c-ink-08)" }}>
          <div className="h-full transition-all duration-300" style={{ width: `${Math.round(progress * 100)}%`, backgroundColor: "var(--c-gold)" }} />
        </div>
        <div className="px-4 sm:px-5 py-3 flex items-center gap-3">
          <div className="text-xs opacity-70 flex-1">{f.summary}</div>
          {(!gated || canSkip) && (
            <button className="btn-primary text-xs shrink-0" onClick={gated ? next : onClose}>
              {gated && i + 1 < items.length ? "Next" : "Done"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Sign-in: fetch what this user has seen and play whatever is due. Waits while
// `hold` (e.g. the mandatory signature step) and reports when it is playing so
// lower-priority prompts can wait their turn.
export function WhatsNewOnSignIn({ user, hold = false, onActive }) {
  const [queue, setQueue] = useState(null);

  useEffect(() => {
    if (hold || queue) return;
    let alive = true;
    api.whatsNew()
      .then(({ seen, joinedAt }) => {
        if (!alive) return;
        setQueue(toShowOnSignIn({ org: deploymentOrg(), role: user.role }, { seen, joinedAt }));
      })
      .catch(() => alive && setQueue([])); // never block sign-in on this
    return () => { alive = false; };
  }, [hold, user.id]);

  const active = !hold && !!queue?.length;
  useEffect(() => { onActive?.(active); }, [active]);
  if (!active) return null;
  return (
    <FeaturePlayer items={queue} gated
      onSeen={(f) => api.markFeatureSeen(f.id).catch(() => {})}
      onClose={() => setQueue([])} />
  );
}

// The profile menu's "What's new": the latest five features for this user.
export function WhatsNewLibrary({ user, onClose }) {
  useScrollLock();
  useEscapeKey(true, onClose);
  const items = libraryFor({ org: deploymentOrg(), role: user.role });
  const [playing, setPlaying] = useState(null);
  if (playing) return <FeaturePlayer items={[playing]} gated={false} onClose={() => setPlaying(null)} />;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6" style={{ backgroundColor: "rgba(10,16,30,.6)" }}
      onClick={onClose} role="dialog" aria-modal="true" aria-label="What's new">
      <div className="w-full max-w-3xl rounded-xl overflow-hidden shadow-2xl anim-in max-h-full flex flex-col" style={{ backgroundColor: "var(--c-cream)" }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center gap-3 border-b shrink-0" style={{ borderColor: "var(--c-ink-10)" }}>
          <Sparkles size={18} style={{ color: "var(--c-gold)" }} />
          <div className="flex-1">
            <div className="font-display text-2xl">What's new</div>
            <div className="text-xs opacity-60">The latest features on SignFlow — each a short video.</div>
          </div>
          <button className="btn-ghost text-xs" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        {/* The scroller wraps the grid: a grid that scrolls itself squeezes its
            rows to the modal height and clips the cards. */}
        <div className="overflow-y-auto">
        <div className="p-4 sm:p-5 grid sm:grid-cols-2 gap-4">
          {items.length === 0 && <div className="text-sm opacity-60">Nothing new yet.</div>}
          {items.map(f => (
            <div key={f.id} role="button" tabIndex={0} className="card text-left overflow-hidden tile-hover cursor-pointer flex flex-col"
              onClick={() => setPlaying(f)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPlaying(f); } }}>
              <div className="relative bg-black" style={{ aspectRatio: "16 / 10" }}>
                <img src={f.slides[0]?.src} alt="" className="w-full h-full object-cover opacity-90" loading="lazy" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="rounded-full p-3 shadow-lg" style={{ backgroundColor: "rgba(15,26,46,.75)", color: "#fff" }}><Play size={20} /></span>
                </div>
              </div>
              <div className="p-3">
                <div className="font-medium">{f.title}</div>
                <div className="text-xs opacity-60 mt-0.5">{f.summary}</div>
                <div className="text-[10px] tracking-wider uppercase opacity-40 mt-2">
                  {new Date(`${f.released}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </div>
              </div>
            </div>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}
