/** 確認ダイアログの表示。中身（ConfirmOptions）は AppShell が state で持つ */
import type { ReactNode } from "react";
import type { ConfirmOptions } from "../ShellContext";
import { Button } from "./Button";

export interface ConfirmRequest {
  readonly options: ConfirmOptions;
  readonly resolve: (confirmed: boolean) => void;
}

export interface ConfirmDialogHostProps {
  readonly request: ConfirmRequest | null;
}

export function ConfirmDialogHost(props: ConfirmDialogHostProps): ReactNode {
  const { request } = props;
  if (!request) return null;
  const { options, resolve } = request;

  return (
    <div className="dialog-overlay" role="presentation" onClick={() => resolve(false)}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        onClick={(event: { stopPropagation: () => void }) => event.stopPropagation()}
      >
        {options.title && <h2 className="dialog-title">{options.title}</h2>}
        <p className="dialog-message">{options.message}</p>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => resolve(false)}>
            {options.cancelLabel ?? "キャンセル"}
          </Button>
          <Button variant={options.danger ? "danger" : "primary"} onClick={() => resolve(true)}>
            {options.confirmLabel ?? "OK"}
          </Button>
        </div>
      </div>
    </div>
  );
}
