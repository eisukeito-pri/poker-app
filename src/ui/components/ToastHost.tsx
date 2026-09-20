/** トースト（バナー通知）の表示。画面下に積み上げ、しばらくすると自動で消える */
import { useEffect } from "react";
import type { ReactNode } from "react";
import type { Toast } from "../ShellContext";

const AUTO_DISMISS_MS = 4000;

export interface ToastHostProps {
  readonly toasts: readonly Toast[];
  readonly onDismiss: (id: number) => void;
}

export function ToastHost(props: ToastHostProps): ReactNode {
  const { toasts, onDismiss } = props;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem(props: { toast: Toast; onDismiss: (id: number) => void }): ReactNode {
  const { toast, onDismiss } = props;

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`toast toast-${toast.kind}`}
      onClick={() => onDismiss(toast.id)}
      role="alert"
    >
      {toast.message}
    </div>
  );
}
