import { useEffect, useRef } from "react";

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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Close when the user presses down anywhere outside the menu. Using
    // `mousedown` (not click) means a left-click on a menu item still fires its
    // onClick first; a right-click elsewhere closes this menu and lets the new
    // target open its own. Registered on the next tick so the very event that
    // opened the menu doesn't immediately dismiss it.
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onScroll = () => {
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", onDown, true);
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu on screen (rough clamp; menu is ~240px wide).
  const left = Math.max(8, Math.min(x, window.innerWidth - 248));
  const top = Math.max(8, Math.min(y, window.innerHeight - (items.length * 30 + 12)));

  return (
    <div
      ref={ref}
      className="glass-strong fixed z-[60] min-w-[200px] animate-pop overflow-hidden rounded-lg border border-line/70 py-1 shadow-2xl"
      style={{ left, top }}
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
