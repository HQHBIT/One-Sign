import { useState, useEffect } from "react";

export function Countdown({ until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);
  const ms = until - now;
  if (ms <= 0) return <span>finalising…</span>;
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return <span>finalises in {h > 0 ? `${h}h ` : ""}{m % 60}m</span>;
}
