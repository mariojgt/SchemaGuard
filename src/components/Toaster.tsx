import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect } from "react";

import type { Toast, ToastKind } from "../stores/toasts";
import { useToasts } from "../stores/toasts";

const STYLE: Record<ToastKind, { border: string; icon: React.ReactNode }> = {
  success: { border: "border-low/50", icon: <CheckCircle2 size={15} className="text-low" /> },
  error: { border: "border-crit/50", icon: <AlertTriangle size={15} className="text-crit" /> },
  info: { border: "border-acc2/50", icon: <Info size={15} className="text-acc2" /> },
};

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  // Errors linger longer (6s) so they can be read; others auto-dismiss at 3.5s.
  useEffect(() => {
    const id = setTimeout(onDismiss, toast.kind === "error" ? 6000 : 3500);
    return () => {
      clearTimeout(id);
    };
  }, [toast.kind, onDismiss]);

  const s = STYLE[toast.kind];
  return (
    <div
      className={`glass-strong pointer-events-auto flex animate-slideup items-start gap-2.5 rounded-xl border ${s.border} px-3.5 py-2.5 shadow-2xl`}
    >
      <span className="mt-0.5 flex-none">{s.icon}</span>
      <span className="flex-1 whitespace-pre-wrap break-words text-[12.5px] leading-snug text-ink">
        {toast.message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="flex-none text-faint hover:text-ink"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
