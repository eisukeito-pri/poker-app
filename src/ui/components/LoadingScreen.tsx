import type { ReactNode } from "react";

export function LoadingScreen(): ReactNode {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      読み込み中…
    </div>
  );
}
