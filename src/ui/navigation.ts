/**
 * 画面遷移の型。React Router のような外部ライブラリは使わず、
 * この小さな判別共用体と、ブラウザの履歴（history API）だけで済ませる。
 */

export type Screen =
  | { readonly name: "Home" }
  | { readonly name: "Setup" }
  | { readonly name: "Game" }
  | { readonly name: "ResultInput" }
  | { readonly name: "Settlement" }
  | { readonly name: "History" }
  | { readonly name: "HistoryDetail"; readonly gameId: string }
  | { readonly name: "Stats" }
  | { readonly name: "Roster" }
  | { readonly name: "Backup" };

export const HOME_SCREEN: Screen = { name: "Home" };

export function screensEqual(a: Screen, b: Screen): boolean {
  if (a.name !== b.name) return false;
  if (a.name === "HistoryDetail" && b.name === "HistoryDetail") {
    return a.gameId === b.gameId;
  }
  return true;
}

/** ブラウザの履歴（history.state）に保存できる形か確かめる程度の、簡単な検証 */
export function isScreen(value: unknown): value is Screen {
  if (typeof value !== "object" || value === null) return false;
  const name = (value as { name?: unknown }).name;
  return (
    typeof name === "string" &&
    [
      "Home",
      "Setup",
      "Game",
      "ResultInput",
      "Settlement",
      "History",
      "HistoryDetail",
      "Stats",
      "Roster",
      "Backup",
    ].includes(name)
  );
}
