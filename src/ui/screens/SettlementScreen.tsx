/**
 * 精算画面：未精算の対局をまとめた収支と、最小回数の送金一覧を確認して確定する。
 *
 * この画面に来る時点で、直前の対局はすでに recordGame() 済み（未精算のまま履歴に保存済み）。
 * 「精算する」を押すと、未精算の対局をすべて精算済みにし、まとめの精算記録を作って
 * その詳細画面に移る。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { Button } from "../components/Button";
import { ScreenHeader } from "../components/ScreenHeader";
import type { PendingSettlementView } from "../../application/types";

function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

export function SettlementScreen(): ReactNode {
  const { services, navigate, notify, notifyError } = useShell();

  const [view, setView] = useState<PendingSettlementView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await services.settlement.getPendingSettlement();
        if (cancelled) return;
        if (v.pendingGames.length === 0) {
          notify("精算する対局がありません。", "error");
          navigate({ name: "Home" }, { replace: true });
          return;
        }
        setView(v);
      } catch (error) {
        notifyError(error);
        navigate({ name: "Home" }, { replace: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // 初回のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !view) {
    return (
      <div className="screen">
        <ScreenHeader title="精算" onBack={() => navigate({ name: "Home" })} />
        <p className="loading-text">読み込み中…</p>
      </div>
    );
  }

  const nameOf = (id: string): string =>
    view.balances.find((b) => b.playerId === id)?.name ?? "?";

  async function handleSettleUp() {
    setBusy(true);
    try {
      const settlement = await services.settlement.settleUp();
      notify("精算しました。");
      navigate({ name: "SettlementDetail", settlementId: settlement.id }, { replace: true });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen screen-settlement">
      <ScreenHeader title="精算" onBack={() => navigate({ name: "Home" })} />

      <p className="section-hint">
        未精算の対局 {view.pendingGames.length} 件分をまとめて精算します。
      </p>

      <section className="setup-section">
        <h2 className="setup-section-title">合算収支</h2>
        <ul className="settlement-result-list">
          {view.balances.map((balance) => (
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
        {view.transfers.length === 0 ? (
          <p className="section-hint">受け渡しはありません。</p>
        ) : (
          <ul className="settlement-transfer-list">
            {view.transfers.map((transfer, index) => (
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

      <Button variant="primary" fullWidth disabled={busy} onClick={handleSettleUp}>
        精算する
      </Button>
    </div>
  );
}
