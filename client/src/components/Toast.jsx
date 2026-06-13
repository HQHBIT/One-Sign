export function ToastStack({ toasts }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end" style={{ pointerEvents: "none" }}>
      {toasts.map(t => <Toast key={t.id} toast={t} />)}
    </div>
  );
}

function Toast({ toast }) {
  const colors = {
    success: { bg: "#2D5F2F", fg: "#F5F1E8" },
    error:   { bg: "#9B2C2C", fg: "#F5F1E8" },
    info:    { bg: "#0F1A2E", fg: "#F5F1E8" }
  }[toast.kind] || { bg: "#0F1A2E", fg: "#F5F1E8" };
  return (
    <div className="anim-in" style={{ backgroundColor: colors.bg, color: colors.fg, padding: "12px 18px", borderRadius: 8, boxShadow: "0 10px 40px -10px rgba(0,0,0,.4)", fontSize: 14, maxWidth: 360, pointerEvents: "auto" }}>
      {toast.msg}
    </div>
  );
}
