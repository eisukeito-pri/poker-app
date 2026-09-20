/**
 * 精算の記録の詳細画面：確定した精算（複数対局分のまとめ払い）1件の合算収支と
 * 送金一覧を表示する。ここに載っている送金額が、実際に支払うべき金額。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { ScreenHeader } from "../components/ScreenHeader";
import type { SettlementRecord } from "../../domain/roster/types";

export interface SettlementDetailScreenProps {
  readonly settlementId: string;
}

function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

function formatSettledAt(iso: string): string {
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

export function SettlementDetailScreen(props: SettlementDetailScreenProps): ReactNode {
  const { services, navigate, notifyError } = useShell();
  const [settlement, setSettlement] = useState<SettlementRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await services.history.getSettlement(props.settlementId);
        if (!cancelled) setSettlement(s);
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
    // settlementId は画面の生存中は変わらない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.settlementId]);

  const goToHistory = () => navigate({ name: "History" });

  if (loading || !settlement) {
    return (
      <div className="screen">
        <ScreenHeader title="精算の記録" onBack={goToHistory} />
        <p className="loading-text">読み込み中…</p>
      </div>
    );
  }

  const nameOf = (id: string): string =>
    settlement.balances.find((b) => b.playerId === id)?.name ?? "?";

  return (
    <div className="screen screen-history-detail">
      <ScreenHeader title="精算の記録" onBack={goToHistory} />

      <p className="section-hint">
        {formatSettledAt(settlement.settledAt)}・対局{settlement.gameIds.length}件分
      </p>

      <section className="setup-section">
        <h2 className="setup-section-title">合算収支</h2>
        <ul className="settlement-result-list">
          {settlement.balances.map((balance) => (
            <li key={balance.playerId} className="settlement-result-item">
              <span className="settlement-result-name">
                {balance.name}
                {balance.bountyNetYen !== 0 && (
                  <span className="section-hint">
                    {" "}
                    （うち脱落ボーナス：{balance.bountyNetYen > 0 ? "+" : ""}
                    {formatYen(balance.bountyNetYen)}）
                  </span>
                )}
              </span>
              <span
                className={`settlement-result-amount${
                  balance.netYen > 0
                    ? " is-positive"
                    : balance.netYen < 0
                      ? " is-negative"
                      : ""
                }`}
              >
                {balance.netYen > 0 ? "+" : ""}
                {formatYen(balance.netYen)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="setup-section">
        <h2 className="setup-section-title">受け渡し（最小回数）</h2>
        {settlement.transfers.length === 0 ? (
          <p className="section-hint">受け渡しはありません。</p>
        ) : (
          <ul className="settlement-transfer-list">
            {settlement.transfers.map((transfer, index) => (
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

      <ul className="history-list">
        {settlement.gameIds.map((gameId) => (
          <li key={gameId} className="history-item">
            <button
              type="button"
              className="history-item-main"
              onClick={() => navigate({ name: "HistoryDetail", gameId })}
            >
              <span className="history-item-sub">対局の記録を見る（{gameId}）</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
