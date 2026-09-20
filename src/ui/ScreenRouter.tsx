/**
 * 画面遷移の表（Screen → 表示するコンポーネント）。
 * 各画面を作るたびに、対応する case を PlaceholderScreen から差し替えていく。
 */
import type { ReactNode } from "react";
import { useShell } from "./ShellContext";
import { HOME_SCREEN } from "./navigation";
import { HomeScreen } from "./screens/HomeScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { GameScreen } from "./screens/GameScreen";
import { ResultInputScreen } from "./screens/ResultInputScreen";
import { SettlementScreen } from "./screens/SettlementScreen";
import { HistoryDetailScreen } from "./screens/HistoryDetailScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";

export function ScreenRouter(): ReactNode {
  const { screen, navigate } = useShell();
  const goHome = () => navigate(HOME_SCREEN);

  switch (screen.name) {
    case "Home":
      return <HomeScreen />;
    case "Setup":
      return <SetupScreen />;
    case "Game":
      return <GameScreen />;
    case "ResultInput":
      return <ResultInputScreen />;
    case "Settlement":
      return <SettlementScreen />;
    case "History":
      return <PlaceholderScreen title="対局の記録" onBack={goHome} />;
    case "HistoryDetail":
      return <HistoryDetailScreen gameId={screen.gameId} />;
    case "Stats":
      return <PlaceholderScreen title="通算成績" onBack={goHome} />;
    case "Roster":
      return <PlaceholderScreen title="参加者の名簿" onBack={goHome} />;
    case "Backup":
      return <PlaceholderScreen title="バックアップ・データの管理" onBack={goHome} />;
  }
}
