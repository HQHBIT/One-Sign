export function Empty({ icon: Icon, text }) {
  return (
    <div className="mt-16 flex flex-col items-center opacity-40">
      <Icon size={40} />
      <div className="mt-4 text-sm">{text}</div>
    </div>
  );
}
