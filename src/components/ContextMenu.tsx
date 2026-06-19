import { useEffect } from "react";

export type MenuItem =
  | "separator"
  | {
      label: string;
      icon?: React.ReactNode;
      hint?: string;
      onClick: () => void;
    };

/** A small right-click menu anchored at (x, y); closes on outside click, scroll, or Escape. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => {
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu on screen (rough clamp; menu is ~240px wide).
  const left = Math.min(x, window.innerWidth - 248);
  const top = Math.min(y, window.innerHeight - (items.length * 30 + 12));

  return (
    <div
      className="glass-strong fixed z-[60] min-w-[200px] animate-pop overflow-hidden rounded-lg border border-line/70 py-1 shadow-2xl"
      style={{ left, top }}
      onClick={(e) => {
        e.stopPropagation();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] hover:bg-acc/15"
          >
            {item.icon && <span className="flex-none text-faint">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && (
              <span className="flex-none font-mono text-[10.5px] text-faint">{item.hint}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}
