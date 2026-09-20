/**
 * まだ作っていない画面の仮置き。次のステップで、各画面ごとに専用のコンポーネントへ
 * 差し替える（ScreenRouter.tsx の該当する case を書き換えるだけでよい）。
 */
import type { ReactNode } from "react";
import { ScreenHeader } from "../components/ScreenHeader";

export interface PlaceholderScreenProps {
  readonly title: string;
  readonly onBack: () => void;
}

export function PlaceholderScreen(props: PlaceholderScreenProps): ReactNode {
  return (
    <div className="screen">
      <ScreenHeader title={props.title} onBack={props.onBack} />
      <p className="placeholder-text">この画面は、次のステップで作ります。</p>
    </div>
  );
}
