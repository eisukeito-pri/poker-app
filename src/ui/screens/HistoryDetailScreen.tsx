/**
 * 記録の詳細画面：保存済みの対局1件の収支と受け渡しを表示する。
 * 精算画面の「保存して完了」から遷移してくるほか、対局の記録一覧（History画面。次のステップで作る）
 * からも遷移してくる想定。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { ScreenHeader } from "../components/ScreenHeader";
import type { GameRecord } from "../../domain/roster/types";

export interface HistoryDetailScreenProps {
  readonly gameId: string;
}

function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

function formatPlayedAt(iso: string): string {
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

export function HistoryDetailScreen(props: HistoryDetailScreenProps): ReactNode {
  const { services, navigate, notifyError } = useShell();
  const [record, setRecord] = useState<GameRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await services.history.getRecord(props.gameId);
        if (!cancelled) setRecord(r);
      } catch (error) {
        if (!cancelled) {
          notifyError(error);
          navigate({ name: "History" }, { replace: true });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // gameId は画面の生存中は変わらない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.gameId]);

  const goToHistory = () => navigate({ name: "History" });

  if (loading || !record) {
    return (
      <div className="screen">
        <ScreenHeader title="記録の詳細" onBack={goToHistory} />
        <p className="loading-text">読み込み中…</p>
      </div>
    );
  }

  const nameOf = (id: string): string =>
    record.players.find((p) => p.id === id)?.name ?? "?";

  return (
    <div className="screen screen-history-detail">
      <ScreenHeader title="記録の詳細" onBack={goToHistory} />

      <p className="section-hint">
        {formatPlayedAt(record.playedAt)}・{record.handsPlayed}ハンド・
        {record.players.length}人・
        {record.settledAt === null ? (
          <span className="badge badge-pending">未精算</span>
        ) : (
          `精算済み（${formatPlayedAt(record.settledAt)}）`
        )}
      </p>

      <section className="setup-section">
        <h2 className="setup-section-title">収支</h2>
        <ul className="settlement-result-list">
          {record.results.map((result) => (
            <li key={result.playerId} className="settlement-result-item">
              <span className="settlement-result-name">{nameOf(result.playerId)}</span>
              <span
                className={`settlement-result-amount${
                  result.netYen > 0
                    ? " is-positive"
                    : result.netYen < 0
                      ? " is-negative"
                      : ""
                }`}
              >
                {result.netYen > 0 ? "+" : ""}
                {formatYen(result.netYen)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="setup-section">
        <h2 className="setup-section-title">
          受け渡し（この対局単体の参考値。実際の支払いは精算の記録を参照）
        </h2>
        {record.transfers.length === 0 ? (
          <p className="section-hint">受け渡しはありません。</p>
        ) : (
          <ul className="settlement-transfer-list">
            {record.transfers.map((transfer, index) => (
              <li key={index} className="settlement-transfer-item">
                <span>{nameOf(transfer.from)}</span>
                <span className="settlement-transfer-arrow">→</span>
                <span>{nameOf(transfer.to)}</span>
                <span className="settlement-transfer-amount">{formatYen(transfer.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {record.bountyTransfers.length > 0 && (
        <section className="setup-section">
          <h2 className="setup-section-title">
            脱落ボーナスの内訳（上記の収支・受け渡しに含まれています）
          </h2>
          <ul className="settlement-transfer-list">
            {record.bountyTransfers.map((transfer, index) => (
              <li key={index} className="settlement-transfer-item">
                <span>{nameOf(transfer.from)}</span>
                <span className="settlement-transfer-arrow">→</span>
                <span>{nameOf(transfer.to)}</span>
                <span className="settlement-transfer-amount">{formatYen(transfer.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
