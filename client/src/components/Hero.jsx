export function Hero({ title, subtitle }) {
  return (
    <div>
      <div className="text-[10px] sm:text-xs tracking-widest uppercase opacity-50 mb-1.5 sm:mb-2">
        {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
      </div>
      <h1 className="font-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl leading-[1.05]">{title}</h1>
      <p className="mt-2 sm:mt-3 text-sm sm:text-base opacity-60 max-w-xl">{subtitle}</p>
    </div>
  );
}
