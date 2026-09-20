/**
 * 対局の記録一覧。新しい順に、日付・参加人数・一番勝った人を表示する。
 * タップで詳細画面へ、削除ボタンで記録を消す（確認ダイアログ必須）。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { ScreenHeader } from "../components/ScreenHeader";
import type { GameRecord, SettlementRecord } from "../../domain/roster/types";

function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function topWinner(record: GameRecord): { name: string; netYen: number } | null {
  if (record.results.length === 0) return null;
  const best = record.results.reduce((a, b) => (b.netYen > a.netYen ? b : a));
  if (best.netYen <= 0) return null;
  const name = record.players.find((p) => p.id === best.playerId)?.name ?? "?";
  return { name, netYen: best.netYen };
}

export function HistoryScreen(): ReactNode {
  const { services, navigate, notifyError, confirm } = useShell();
  const [records, setRecords] = useState<readonly GameRecord[] | null>(null);
  const [settlements, setSettlements] = useState<readonly SettlementRecord[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [list, settlementList] = await Promise.all([
        services.history.listRecords(),
        services.history.listSettlements(),
      ]);
      setRecords(list);
      setSettlements(settlementList);
    } catch (error) {
      notifyError(error);
    }
  }

  useEffect(() => {
    load();
    // 初回のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(gameId: string) {
    const ok = await confirm({
      title: "記録を削除する",
      message: "この対局の記録を削除します。元に戻せません。",
      confirmLabel: "削除する",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await services.history.deleteRecord(gameId);
      await load();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  const goHome = () => navigate({ name: "Home" });

  return (
    <div className="screen screen-history">
      <ScreenHeader title="対局の記録" onBack={goHome} />

      {records === null && <p className="loading-text">読み込み中…</p>}
      {records !== null && records.length === 0 && (
        <p className="placeholder-text">まだ記録がありません。</p>
      )}

      {records !== null && records.length > 0 && (
        <ul className="history-list">
          {records.map((record) => {
            const winner = topWinner(record);
            return (
              <li key={record.gameId} className="history-item">
                <button
                  type="button"
                  className="history-item-main"
                  onClick={() => navigate({ name: "HistoryDetail", gameId: record.gameId })}
                >
                  <span className="history-item-date">
                    {formatDate(record.playedAt)}
                    {record.settledAt === null && (
                      <span className="badge badge-pending">未精算</span>
                    )}
                  </span>
                  <span className="history-item-sub">
                    {record.players.length}人・{record.handsPlayed}ハンド
                    {winner && `・トップ ${winner.name}（+${formatYen(winner.netYen)}）`}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="削除"
                  disabled={busy}
                  onClick={() => handleDelete(record.gameId)}
                >
                  🗑
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {settlements !== null && settlements.length > 0 && (
        <>
          <h2 className="setup-section-title">精算の記録</h2>
          <ul className="history-list">
            {settlements.map((settlement) => (
              <li key={settlement.id} className="history-item">
                <button
                  type="button"
                  className="history-item-main"
                  onClick={() =>
                    navigate({ name: "SettlementDetail", settlementId: settlement.id })
                  }
                >
                  <span className="history-item-date">{formatDate(settlement.settledAt)}</span>
                  <span className="history-item-sub">
                    対局{settlement.gameIds.length}件・{settlement.transfers.length}回のやりとり
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
