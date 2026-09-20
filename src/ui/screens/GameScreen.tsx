/**
 * 対局画面：進行中の対局の状態を表示し、ハンドを進める／脱落・復帰を記録する。
 *
 * - 参加者をタップすると、その人向けの操作（脱落／復帰）ボタンが現れる（もう一度タップで閉じる）。
 * - 主ボタンは状況に応じて「次のハンドへ」／「結果入力へ」に変わる。
 * - 「元に戻す」は必ず確認ダイアログを出す。
 * - 「対局を中断する」はヘッダーに置き、確認ダイアログを出す（記録には残らない）。
 * - ブラインドが上がったハンドに進んだときは、数字表示に加えてトースト通知も出す。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { Button } from "../components/Button";
import { ScreenHeader } from "../components/ScreenHeader";
import type { GameView } from "../../application/types";
import type { GameEvent } from "../../domain/game/types";
import { CIRCLE_LAYOUT_MAX_PLAYERS, seatCirclePosition } from "../seatCircle";

function describeLastEvent(event: GameEvent | null, nameOf: (id: string) => string): string {
  if (!event) return "";
  switch (event.type) {
    case "HandAdvanced":
      return "直前の「次のハンドへ」を取り消します。";
    case "PlayerEliminated":
      return `${nameOf(event.playerId)}さんの脱落を取り消します。`;
    case "PlayerReinstated":
      return `${nameOf(event.playerId)}さんの復帰を取り消します。`;
    case "PlayEnded":
      return "結果入力を取り消して対局に戻ります。入力途中の値は消えます。";
  }
}

export function GameScreen(): ReactNode {
  const { services, navigate, notify, notifyError, confirm } = useShell();

  const [view, setView] = useState<GameView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await services.game.getCurrentGame();
        if (cancelled) return;
        if (!current) {
          notify("進行中の対局がありません。", "error");
          navigate({ name: "Home" }, { replace: true });
          return;
        }
        setView(current);
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

  if (loading || !view) {
    return (
      <div className="screen">
        <ScreenHeader title="対局" />
        <p className="loading-text">読み込み中…</p>
      </div>
    );
  }

  const nameOf = (id: string): string =>
    view.game.seats.find((s) => s.id === id)?.name ?? "?";

  async function run(action: () => Promise<GameView>, options?: { blindToast?: boolean }) {
    setBusy(true);
    const prevBigBlind = view!.state.blinds.bigBlind;
    try {
      const next = await action();
      setView(next);
      setExpandedId(null);
      if (options?.blindToast && next.state.blinds.bigBlind !== prevBigBlind) {
        notify(
          `ブラインドが上がりました：SB ${next.state.blinds.smallBlind} / BB ${next.state.blinds.bigBlind}`,
        );
      }
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handlePrimaryAction() {
    if (view!.state.nextAction === "AdvanceHand") {
      await run(() => services.game.advanceHand(), { blindToast: true });
    } else {
      try {
        setBusy(true);
        await services.game.endPlay();
        navigate({ name: "ResultInput" });
      } catch (error) {
        notifyError(error);
      } finally {
        setBusy(false);
      }
    }
  }

  async function handleEliminate(playerId: string) {
    await run(() => services.game.eliminatePlayer(playerId));
  }

  async function handleReinstate(playerId: string) {
    await run(() => services.game.reinstatePlayer(playerId));
  }

  async function handleUndo() {
    const message = describeLastEvent(view!.state.lastEvent, nameOf);
    const ok = await confirm({
      title: "元に戻す",
      message,
      confirmLabel: "元に戻す",
      danger: true,
    });
    if (ok) {
      await run(() => services.game.undo());
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

  const { state } = view;
  const primaryLabel = state.nextAction === "AdvanceHand" ? "次のハンドへ" : "結果入力へ";

  return (
    <div className="screen screen-game">
      <ScreenHeader
        title="対局"
        action={
          <button type="button" className="header-text-button" onClick={handleAbandon} disabled={busy}>
            中断
          </button>
        }
      />

      <div className="hand-counter">
        <div className="hand-counter-main">
          {state.handNumber} / {state.totalHands} ハンド
        </div>
        {state.handsUntilBlindIncrease !== null && (
          <div className="hand-counter-sub">
            あと{state.handsUntilBlindIncrease}ハンドでブラインド上昇
            {state.nextBlinds && `（SB ${state.nextBlinds.smallBlind} / BB ${state.nextBlinds.bigBlind}）`}
          </div>
        )}
      </div>

      <div className="blinds-display">
        SB {state.blinds.smallBlind} / BB {state.blinds.bigBlind}
      </div>

      {view.game.seats.length <= CIRCLE_LAYOUT_MAX_PLAYERS ? (
        <div className="seat-circle">
          {view.game.seats.map((player, index) => {
            const isEliminated = state.eliminatedPlayerIds.includes(player.id);
            const isDealer = state.dealerId === player.id;
            const isSB = state.smallBlindId === player.id;
            const isBB = state.bigBlindId === player.id;
            const expanded = expandedId === player.id;
            const pos = seatCirclePosition(index, view.game.seats.length);

            return (
              <button
                key={player.id}
                type="button"
                className={`seat-circle-item${isEliminated ? " is-eliminated" : ""}${
                  expanded ? " is-expanded" : ""
                }`}
                style={{ left: pos.left, top: pos.top }}
                onClick={() => setExpandedId(expanded ? null : player.id)}
                disabled={busy}
              >
                <span className="seat-circle-badges">
                  {isDealer && <span className="badge badge-dealer">親</span>}
                  {isSB && <span className="badge badge-sb">SB</span>}
                  {isBB && <span className="badge badge-bb">BB</span>}
                </span>
                <span className="seat-circle-name">
                  {isEliminated && <span className="game-player-mark">×</span>}
                  {player.name}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <ul className="game-player-list">
          {view.game.seats.map((player) => {
            const isEliminated = state.eliminatedPlayerIds.includes(player.id);
            const isDealer = state.dealerId === player.id;
            const isSB = state.smallBlindId === player.id;
            const isBB = state.bigBlindId === player.id;
            const expanded = expandedId === player.id;

            return (
              <li key={player.id} className="game-player-item-wrap">
                <button
                  type="button"
                  className={`game-player-item${isEliminated ? " is-eliminated" : ""}${
                    expanded ? " is-expanded" : ""
                  }`}
                  onClick={() => setExpandedId(expanded ? null : player.id)}
                  disabled={busy}
                >
                  <span className="game-player-name">
                    {isEliminated && <span className="game-player-mark">×</span>}
                    {player.name}
                  </span>
                  <span className="game-player-badges">
                    {isDealer && <span className="badge badge-dealer">親</span>}
                    {isSB && <span className="badge badge-sb">SB</span>}
                    {isBB && <span className="badge badge-bb">BB</span>}
                  </span>
                </button>
                {expanded && (
                  <div className="game-player-actions">
                    {isEliminated ? (
                      <Button
                        variant="secondary"
                        fullWidth
                        disabled={busy}
                        onClick={() => handleReinstate(player.id)}
                      >
                        復帰させる
                      </Button>
                    ) : (
                      <Button
                        variant="danger"
                        fullWidth
                        disabled={busy}
                        onClick={() => handleEliminate(player.id)}
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
      )}

      {expandedId && view.game.seats.length <= CIRCLE_LAYOUT_MAX_PLAYERS && (
        <div className="game-player-actions">
          <p className="section-hint">{nameOf(expandedId)}さん</p>
          {state.eliminatedPlayerIds.some((id) => (id as string) === expandedId) ? (
            <Button variant="secondary" fullWidth disabled={busy} onClick={() => handleReinstate(expandedId)}>
              復帰させる
            </Button>
          ) : (
            <Button variant="danger" fullWidth disabled={busy} onClick={() => handleEliminate(expandedId)}>
              脱落させる
            </Button>
          )}
        </div>
      )}

      <Button variant="primary" size="large" fullWidth disabled={busy} onClick={handlePrimaryAction}>
        {primaryLabel}
      </Button>
      <Button
        variant="ghost"
        fullWidth
        disabled={busy || state.lastEvent === null}
        onClick={handleUndo}
      >
        元に戻す
      </Button>
    </div>
  );
}
