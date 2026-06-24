/** Small shared building blocks for the Database panel. */

export function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <span className="text-[11px] text-faint">{label}</span>
      {children}
    </label>
  );
}

export function Tab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press rounded-md px-2.5 py-1 text-[12px] ${active ? "bg-panel3 text-ink" : "text-dim hover:text-ink"}`}
    >
      {label}
    </button>
  );
}
