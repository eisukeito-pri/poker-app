/**
 * 画面遷移の表（Screen → 表示するコンポーネント）。
 * 各画面を作るたびに、対応する case を PlaceholderScreen から差し替えていく。
 */
import type { ReactNode } from "react";
import { useShell } from "./ShellContext";
import { HOME_SCREEN } from "./navigation";
import { HomeScreen } from "./screens/HomeScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";

export function ScreenRouter(): ReactNode {
  const { screen, navigate } = useShell();
  const goHome = () => navigate(HOME_SCREEN);

  switch (screen.name) {
    case "Home":
      return <HomeScreen />;
    case "Setup":
      return <PlaceholderScreen title="対局の設定" onBack={goHome} />;
    case "Game":
      // 進行中の対局がある前提の画面なので、戻る先はホーム
      return <PlaceholderScreen title="対局" onBack={goHome} />;
    case "ResultInput":
      return <PlaceholderScreen title="結果の入力" onBack={goHome} />;
    case "Settlement":
      return <PlaceholderScreen title="精算" onBack={goHome} />;
    case "History":
      return <PlaceholderScreen title="対局の記録" onBack={goHome} />;
    case "HistoryDetail":
      return (
        <PlaceholderScreen
          title="記録の詳細"
          onBack={() => navigate({ name: "History" })}
        />
      );
    case "Stats":
      return <PlaceholderScreen title="通算成績" onBack={goHome} />;
    case "Roster":
      return <PlaceholderScreen title="参加者の名簿" onBack={goHome} />;
    case "Backup":
      return <PlaceholderScreen title="バックアップ・データの管理" onBack={goHome} />;
  }
}
