/**
 * 結果入力画面：生存者の±チップを入力する。
 *
 * - 脱落者は −開始チップで自動確定（編集不可）。
 * - 生存者のうち、入力が残り1人になった時点で、その人が自動入力になる
 *   （座席順ではなく、最後まで入力しなかった人が対象）。
 * - この画面でも脱落／復帰ができる（対局画面に戻らなくてよい）。
 * - 「元に戻す」は対局に戻る操作なので、必ず確認ダイアログを出す。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { Button } from "../components/Button";
import { ScreenHeader } from "../components/ScreenHeader";
import type { GameView } from "../../application/types";
import type { ResultSheet } from "../../domain/settlement/types";

function localValuesFrom(sheet: ResultSheet): Record<string, string> {
  const values: Record<string, string> = {};
  for (const entry of sheet.entries) {
    if (entry.kind === "Input") {
      values[entry.playerId] = entry.netChips === null ? "" : String(entry.netChips);
    }
  }
  return values;
}

function rangeText(startingChips: number, playerCount: number): string {
  const min = -startingChips;
  const max = (playerCount - 1) * startingChips;
  return `${min}〜${max}の範囲で入力してください。`;
}

export function ResultInputScreen(): ReactNode {
  const { services, navigate, notify, notifyError, confirm } = useShell();

  const [game, setGame] = useState<GameView | null>(null);
  const [sheet, setSheet] = useState<ResultSheet | null>(null);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** 脱落ボーナスのルールが有効なとき、脱落させる相手を選ぶために保留中の脱落対象 */
  const [pendingEliminate, setPendingEliminate] = useState<string | null>(null);

  async function refreshAll() {
    const [g, s] = await Promise.all([
      services.game.getCurrentGame(),
      services.settlement.getResultSheet(),
    ]);
    setGame(g);
    setSheet(s);
    setLocalValues(localValuesFrom(s));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const g = await services.game.getCurrentGame();
        if (cancelled) return;
        if (!g) {
          notify("進行中の対局がありません。", "error");
          navigate({ name: "Home" }, { replace: true });
          return;
        }
        if (g.state.phase !== "ResultPending") {
          navigate({ name: "Game" }, { replace: true });
          return;
        }
        const s = await services.settlement.getResultSheet();
        if (cancelled) return;
        setGame(g);
        setSheet(s);
        setLocalValues(localValuesFrom(s));
      } catch (error) {
        notifyError(error);
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

  if (loading || !game || !sheet) {
    return (
      <div className="screen">
        <ScreenHeader title="結果の入力" />
        <p className="loading-text">読み込み中…</p>
      </div>
    );
  }

  const nameOf = (id: string): string =>
    game.game.seats.find((s) => s.id === id)?.name ?? "?";
  const issueOf = (id: string) => sheet.issues.find((i) => i.playerId === id) ?? null;
  const playerCount = game.game.seats.length;

  async function commitValue(playerId: string, raw: string) {
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || !Number.isFinite(value))) {
      notify("整数で入力してください。", "error");
      setLocalValues(localValuesFrom(sheet!));
      return;
    }
    setBusy(true);
    try {
      const updated = await services.settlement.enterResult(playerId, value);
      setSheet(updated);
      setLocalValues(localValuesFrom(updated));
    } catch (error) {
      notifyError(error);
      setLocalValues(localValuesFrom(sheet!));
    } finally {
      setBusy(false);
    }
  }

  async function toggleElimination(playerId: string, eliminated: boolean, eliminatedById?: string | null) {
    setBusy(true);
    try {
      if (eliminated) {
        await services.game.reinstatePlayer(playerId);
      } else {
        await services.game.eliminatePlayer(playerId, eliminatedById ?? null);
      }
      await refreshAll();
      setExpandedId(null);
      setPendingEliminate(null);
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  function requestEliminate(playerId: string) {
    if (game!.game.settings.bountyRule !== null) {
      setPendingEliminate(playerId);
    } else {
      void toggleElimination(playerId, false);
    }
  }

  async function handleUndo() {
    const ok = await confirm({
      title: "元に戻す",
      message: "結果入力を取り消して対局に戻ります。入力途中の値は消えます。",
      confirmLabel: "対局に戻る",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await services.game.undo();
      navigate({ name: "Game" }, { replace: true });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

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

  async function handleNextGame() {
    setBusy(true);
    try {
      await services.settlement.recordGame();
      notify("この対局の結果を保存しました。");
      navigate({ name: "Setup" }, { replace: true });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleSettleUp() {
    setBusy(true);
    try {
      await services.settlement.recordGame();
      navigate({ name: "Settlement" }, { replace: true });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen screen-result-input">
      <ScreenHeader
        title="結果の入力"
        action={
          <button type="button" className="header-text-button" onClick={handleAbandon} disabled={busy}>
            中断
          </button>
        }
      />
      <p className="section-hint">
        開始チップ {sheet.startingChips} からの増減を入力してください。数えやすい人から入力していくと、最後に残った1人は自動で埋まります。
      </p>

      <ul className="result-entry-list">
        {sheet.entries.map((entry) => {
          const isEliminated = entry.kind === "Eliminated";
          const isAuto = entry.kind === "AutoFilled";
          const issue = issueOf(entry.playerId);
          const expanded = expandedId === entry.playerId;

          return (
            <li key={entry.playerId} className="result-entry-item-wrap">
              <div className={`result-entry-item${isEliminated ? " is-eliminated" : ""}`}>
                <button
                  type="button"
                  className="result-entry-name"
                  onClick={() => setExpandedId(expanded ? null : entry.playerId)}
                  disabled={busy}
                >
                  {isEliminated && <span className="game-player-mark">×</span>}
                  {nameOf(entry.playerId)}
                </button>

                {isEliminated || isAuto ? (
                  <span className="result-entry-value result-entry-value-readonly">
                    {entry.netChips === null ? "計算中" : entry.netChips}
                    {isAuto && <span className="result-entry-auto-label">自動</span>}
                  </span>
                ) : (
                  <input
                    className="field-input result-entry-input"
                    type="number"
                    inputMode="numeric"
                    value={localValues[entry.playerId] ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      setLocalValues((v) => ({ ...v, [entry.playerId]: e.target.value }))
                    }
                    onBlur={(e) => commitValue(entry.playerId, e.target.value)}
                  />
                )}
              </div>

              {issue && (
                <p className="result-entry-issue">
                  {nameOf(entry.playerId)}さんの値が範囲外です。{rangeText(sheet.startingChips, playerCount)}
                </p>
              )}

              {expanded && (
                <div className="game-player-actions">
                  {isEliminated ? (
                    <Button
                      variant="secondary"
                      fullWidth
                      disabled={busy}
                      onClick={() => toggleElimination(entry.playerId, true)}
                    >
                      復帰させる
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      fullWidth
                      disabled={busy}
                      onClick={() => requestEliminate(entry.playerId)}
                    >
                      脱落させる
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {pendingEliminate && (
        <div className="dialog-overlay" role="presentation" onClick={() => setPendingEliminate(null)}>
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            onClick={(event: { stopPropagation: () => void }) => event.stopPropagation()}
          >
            <h2 className="dialog-title">誰が脱落させましたか？</h2>
            <p className="dialog-message">
              {nameOf(pendingEliminate)}さんが、脱落ボーナスを渡す相手（そのハンドの勝者）を選んでください。
            </p>
            <div className="dealer-select-row">
              {sheet.entries
                .filter((e) => e.playerId !== pendingEliminate && e.kind !== "Eliminated")
                .map((e) => (
                  <button
                    key={e.playerId}
                    type="button"
                    className="dealer-select-item"
                    disabled={busy}
                    onClick={() => toggleElimination(pendingEliminate, false, e.playerId)}
                  >
                    {nameOf(e.playerId)}
                  </button>
                ))}
            </div>
            <div className="dialog-actions">
              <Button variant="ghost" onClick={() => setPendingEliminate(null)}>
                キャンセル
              </Button>
            </div>
          </div>
        </div>
      )}

      <Button variant="primary" fullWidth disabled={busy || !sheet.canSettle} onClick={handleNextGame}>
        次の対局へ
      </Button>
      <Button variant="secondary" fullWidth disabled={busy || !sheet.canSettle} onClick={handleSettleUp}>
        精算して支払いへ
      </Button>
      <Button variant="ghost" fullWidth disabled={busy} onClick={handleUndo}>
        元に戻す（対局に戻る）
      </Button>
    </div>
  );
}
