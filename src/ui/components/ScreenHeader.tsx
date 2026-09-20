/** 画面上部の見出し。戻る矢印は onBack を渡したときだけ出す */
import type { ReactNode } from "react";

export interface ScreenHeaderProps {
  readonly title: string;
  readonly onBack?: () => void;
  /** 右側に置く操作（例：設定アイコン、削除ボタン） */
  readonly action?: ReactNode;
}

export function ScreenHeader(props: ScreenHeaderProps): ReactNode {
  const { title, onBack, action } = props;
  return (
    <header className="screen-header">
      <div className="screen-header-left">
        {onBack && (
          <button type="button" className="icon-button" onClick={onBack} aria-label="戻る">
            ←
          </button>
        )}
      </div>
      <h1 className="screen-title">{title}</h1>
      <div className="screen-header-right">{action}</div>
    </header>
  );
}
