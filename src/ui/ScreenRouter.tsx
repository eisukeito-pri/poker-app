/**
 * 画面遷移の表（Screen → 表示するコンポーネント）。
 */
import type { ReactNode } from "react";
import { useShell } from "./ShellContext";
import { HomeScreen } from "./screens/HomeScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { GameScreen } from "./screens/GameScreen";
import { ResultInputScreen } from "./screens/ResultInputScreen";
import { SettlementScreen } from "./screens/SettlementScreen";
import { HistoryDetailScreen } from "./screens/HistoryDetailScreen";
import { SettlementDetailScreen } from "./screens/SettlementDetailScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { RosterScreen } from "./screens/RosterScreen";
import { BackupScreen } from "./screens/BackupScreen";

export function ScreenRouter(): ReactNode {
  const { screen } = useShell();

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
      return <HistoryScreen />;
    case "HistoryDetail":
      return <HistoryDetailScreen gameId={screen.gameId} />;
    case "SettlementDetail":
      return <SettlementDetailScreen settlementId={screen.settlementId} />;
    case "Stats":
      return <StatsScreen />;
    case "Roster":
      return <RosterScreen />;
    case "Backup":
      return <BackupScreen />;
  }
}
