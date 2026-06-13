export function StyleTag() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..800&family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

      /* ─── Design tokens ─────────────────────────────────────────
         Use var(--c-*) anywhere in CSS or inline styles. Constants
         in src/lib/constants.js mirror these for JS-side use. */
      :root {
        --c-ink:        #0F1A2E;
        --c-ink-soft:   #1B2A4A;
        --c-cream:      #F5F1E8;
        --c-paper:      #FAF7F0;
        --c-paper-2:    #E8E3D5;
        --c-gold:       #B8894A;
        --c-gold-deep:  #A3763D;
        --c-forest:     #2D5F2F;
        --c-rust:       #9B2C2C;
        --c-rust-deep:  #7F2323;
        --c-sand:       #8B6914;
        --c-earth:      #8B4A14;

        --c-ink-08:     rgba(15,26,46,.08);
        --c-ink-10:     rgba(15,26,46,.10);
        --c-ink-18:     rgba(15,26,46,.18);
        --c-ink-25:     rgba(15,26,46,.25);
        --c-gold-15:    rgba(184,137,74,.15);
        --c-gold-18:    rgba(184,137,74,.18);
        --c-gold-35:    rgba(184,137,74,.35);

        --pill-pending-bg:           #F4E4C1;
        --pill-approved-bg:          #C8D9C5;
        --pill-approved-pending-bg:  #E8D4B8;
        --pill-rejected-bg:          #E8C5C5;
      }

      .font-display { font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto; letter-spacing: -0.01em; }
      .font-mono { font-family: 'IBM Plex Mono', monospace; }
      .grain::before {
        content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.035;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      }
      .sig-canvas { touch-action: none; cursor: crosshair; background: var(--c-paper); }
      .tile-hover { transition: transform .2s ease, box-shadow .2s ease; }
      .tile-hover:hover { transform: translateY(-2px); box-shadow: 0 14px 40px -14px var(--c-ink-25); }
      .ink-grad { background: linear-gradient(135deg, var(--c-ink) 0%, var(--c-ink-soft) 100%); }
      /* font-size 16px on small screens so iOS Safari doesn't auto-zoom
         when an input is focused. Scaled down for tighter desktop layout. */
      input[type="text"], input[type="email"], input[type="password"], textarea, select {
        background: var(--c-paper); border: 1px solid var(--c-ink-18); border-radius: 6px;
        padding: 10px 12px; font-size: 16px; color: var(--c-ink); outline: none;
      }
      @media (min-width: 640px) {
        input[type="text"], input[type="email"], input[type="password"], textarea, select {
          font-size: 14px;
        }
      }
      input:focus, textarea:focus, select:focus { border-color: var(--c-gold); box-shadow: 0 0 0 3px var(--c-gold-15); }
      .btn-primary { background: var(--c-ink); color: var(--c-cream); padding: 10px 18px; border-radius: 6px; font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; transition: all .15s; border: 1px solid var(--c-ink); }
      .btn-primary:hover:not(:disabled) { background: var(--c-ink-soft); }
      .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
      .btn-ghost { background: transparent; color: var(--c-ink); padding: 8px 14px; border-radius: 6px; font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 6px; transition: all .15s; border: 1px solid var(--c-ink-18); }
      .btn-ghost:hover { background: rgba(15,26,46,.05); }
      .btn-gold { background: var(--c-gold); color: var(--c-cream); padding: 10px 18px; border-radius: 6px; font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; transition: all .15s; border: 1px solid var(--c-gold); }
      .btn-gold:hover:not(:disabled) { background: var(--c-gold-deep); }
      .btn-danger { background: var(--c-rust); color: var(--c-cream); padding: 10px 18px; border-radius: 6px; font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--c-rust); }
      .btn-danger:hover { background: var(--c-rust-deep); }
      .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 500; letter-spacing: .02em; text-transform: uppercase; }
      .pill-pending { background: var(--pill-pending-bg); color: var(--c-sand); }
      .pill-approved { background: var(--pill-approved-bg); color: var(--c-forest); }
      .pill-approved-pending { background: var(--pill-approved-pending-bg); color: var(--c-earth); }
      .pill-rejected { background: var(--pill-rejected-bg); color: #7A2222; }
      .card { background: var(--c-paper); border: 1px solid var(--c-ink-10); border-radius: 10px; }
      /* Smooth scrolling everywhere — feels better on iOS */
      html, body { -webkit-overflow-scrolling: touch; overflow-x: hidden; }
      /* Prevent layout shift caused by scrollbar appear/disappear on desktop */
      html { scrollbar-gutter: stable; }
      /* Remove tap-highlight blue flash on iOS */
      * { -webkit-tap-highlight-color: transparent; }
      /* Ensure images never overflow their container */
      img { max-width: 100%; height: auto; }
      /* Buttons should be at least 40x40 px so they're easy to hit on touch */
      @media (max-width: 639px) {
        button:not([class*="opacity-"]):not(.font-mono):not([style*="position: absolute"]) {
          min-height: 40px;
        }
      }
      .divider-rule { height: 1px; background: linear-gradient(to right, transparent, var(--c-ink-18), transparent); }
      @keyframes slideIn { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .anim-in { animation: slideIn .3s ease; }
      @keyframes logoGlow {
        0%, 100% { filter: drop-shadow(0 0 20px rgba(184,137,74,.2)); }
        50% { filter: drop-shadow(0 0 40px var(--c-gold-35)); }
      }
      .logo-glow { animation: logoGlow 4s ease-in-out infinite; }
      @keyframes fadeUp {
        from { transform: translateY(18px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .fade-up { animation: fadeUp .7s ease both; }
      .fade-up-d1 { animation-delay: .12s; }
      .fade-up-d2 { animation-delay: .24s; }
      .fade-up-d3 { animation-delay: .36s; }
      @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
      .anim-spin { animation: spin 1s linear infinite; }
    `}</style>
  );
}
