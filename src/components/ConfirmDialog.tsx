import { useEffect } from "react";

const GRADIENT = "linear-gradient(135deg,#ff3fa4,#a64bff)";

interface ConfirmDialogProps {
  title: string;
  /** Body copy — plain string or richer markup (e.g. a highlighted name). */
  message: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" paints the confirm button red for destructive actions. */
  tone?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A small, reusable confirmation modal in the app's glass style. Used for
 * irreversible-feeling actions (dropping a table, clearing the project).
 * Click-outside and Escape both cancel; the confirm button is autofocused so
 * Enter confirms.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-label={title}
        className="glass-strong w-[400px] max-w-full animate-pop rounded-xl border border-line/70 p-5 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="text-[14px] font-bold">{title}</div>
        <div className="mt-1.5 text-[12.5px] text-dim">{message}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] hover:border-line2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className={
              tone === "danger"
                ? "rounded-lg bg-crit px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90"
                : "rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white"
            }
            style={tone === "danger" ? undefined : { background: GRADIENT }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
