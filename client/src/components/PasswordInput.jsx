// A password <input> with a show/hide eye toggle. Drop-in replacement for a plain
// password input: pass the same props (value, onChange, className, placeholder,
// required, disabled, autoFocus, autoComplete, name). The className goes on the
// wrapper (so margins still work); the field fills it and leaves room for the eye.
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordInput({ className = "", style, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className={className} style={{ position: "relative" }}>
      <input {...props} type={show ? "text" : "password"} className="w-full"
        style={{ paddingRight: 40, ...style }} />
      <button type="button" tabIndex={-1}
        onClick={() => setShow(s => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide password" : "Show password"}
        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", padding: 4, opacity: 0.55, display: "flex", alignItems: "center", color: "var(--c-ink)" }}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
