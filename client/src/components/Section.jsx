export function Section({ n, title, desc, children }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 sm:gap-3 mb-2 sm:mb-3">
        <span className="font-mono text-xs opacity-50">{n}</span>
        <h3 className="font-display text-lg sm:text-xl">{title}</h3>
      </div>
      {desc && <p className="text-xs sm:text-sm opacity-60 mb-3 sm:mb-4 ml-6 sm:ml-8">{desc}</p>}
      <div className="ml-0 sm:ml-8">{children}</div>
    </div>
  );
}
