/**
 * 精算画面：円換算後の収支と、最小回数の送金一覧を確認して保存する。
 *
 * 「保存して完了」を押すと、記録を履歴に保存し、進行中の対局を消して
 * その記録の詳細画面に移る。押し直しても記録が二重にならない（ユースケース側で保証）。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { Button } from "../components/Button";
import { ScreenHeader } from "../components/ScreenHeader";
import type { GameView } from "../../application/types";
import type { Settlement } from "../../domain/settlement/types";

function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

export function SettlementScreen(): ReactNode {
  const { services, navigate, notify, notifyError, confirm } = useShell();

  const [game, setGame] = useState<GameView | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const g = await services.game.getCurrentGame();
        if (cancelled) return;
        if (!g || g.state.phase !== "ResultPending") {
          navigate({ name: "Home" }, { replace: true });
          return;
        }
        const s = await services.settlement.previewSettlement();
        if (cancelled) return;
        setGame(g);
        setSettlement(s);
      } catch (error) {
        notifyError(error);
        navigate({ name: "ResultInput" }, { replace: true });
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

  if (loading || !game || !settlement) {
    return (
      <div className="screen">
        <ScreenHeader title="精算" onBack={() => navigate({ name: "ResultInput" })} />
        <p className="loading-text">読み込み中…</p>
      </div>
    );
  }

  const nameOf = (id: string): string =>
    game.game.seats.find((s) => s.id === id)?.name ?? "?";

  async function handleAbandon() {
    const ok = await confirm({
      title: "対局を中断する",
      message: "進行中の対局を破棄します。記録には残りません。よろしいですか？",
      confirmLabel: "中断する",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await services.game.abandonGame();
      navigate({ name: "Home" }, { replace: true });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalize() {
    setBusy(true);
    try {
      const record = await services.settlement.finalizeGame();
      notify("保存しました。");
      navigate({ name: "HistoryDetail", gameId: record.gameId }, { replace: true });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen screen-settlement">
      <ScreenHeader
        title="精算"
        onBack={() => navigate({ name: "ResultInput" })}
        action={
          <button type="button" className="header-text-button" onClick={handleAbandon} disabled={busy}>
            中断
          </button>
        }
      />

      <section className="setup-section">
        <h2 className="setup-section-title">収支</h2>
        <ul className="settlement-result-list">
          {settlement.results.map((result) => (
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

      <Button variant="primary" fullWidth disabled={busy} onClick={handleFinalize}>
        保存して完了
      </Button>
    </div>
  );
}
