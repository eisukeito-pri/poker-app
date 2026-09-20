/**
 * 設定画面：参加者・初期チップ・ハンド数・ブラインド・換算レートを決めて対局を始める。
 *
 * - 参加者は名簿から選ぶ（タップで選択／解除）。選んだ順が座席順になり、
 *   ↑↓ボタンで並び替えられる。名簿にない人はその場で登録して追加できる。
 * - 親は、選んだ参加者の中から選ぶか「ランダムで決める」。
 * - 数値項目は前回の対局の設定（なければアプリの既定値）を初期値にする。
 * - 「この設定で始める」を押すと対局を作る。進行中の対局がある場合は
 *   GAME_IN_PROGRESS になるので、確認してから破棄して始め直す。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { Button } from "../components/Button";
import { ScreenHeader } from "../components/ScreenHeader";
import { Banner } from "../components/Banner";
import { errorCodeOf, toUserMessage } from "../errorMessages";
import { MAX_PLAYERS, MIN_PLAYERS } from "../../domain/shared/types";
import type { Player } from "../../domain/roster/types";
import { CIRCLE_LAYOUT_MAX_PLAYERS, seatCirclePosition } from "../seatCircle";

interface FormFields {
  startingChips: string;
  totalHands: string;
  initialBigBlind: string;
  blindIncreaseEveryHands: string;
  blindIncreaseAmount: string;
  yenPerChip: string;
  bountyRuleEnabled: boolean;
  bountyAmountYen: string;
}

function toFields(defaults: {
  startingChips: number;
  totalHands: number;
  initialBigBlind: number;
  blindIncreaseEveryHands: number;
  blindIncreaseAmount: number;
  yenPerChip: number;
  bountyRuleEnabled: boolean;
  bountyAmountYen: number;
}): FormFields {
  return {
    startingChips: String(defaults.startingChips),
    totalHands: String(defaults.totalHands),
    initialBigBlind: String(defaults.initialBigBlind),
    blindIncreaseEveryHands: String(defaults.blindIncreaseEveryHands),
    blindIncreaseAmount: String(defaults.blindIncreaseAmount),
    yenPerChip: String(defaults.yenPerChip),
    bountyRuleEnabled: defaults.bountyRuleEnabled,
    bountyAmountYen: String(defaults.bountyAmountYen),
  };
}

/** 数値項目の簡易チェック。厳密な検証はユースケース側（DomainError）に任せる */
function fieldProblem(fields: FormFields): string | null {
  const chips = Number(fields.startingChips);
  const hands = Number(fields.totalHands);
  const bb = Number(fields.initialBigBlind);
  const every = Number(fields.blindIncreaseEveryHands);
  const amount = Number(fields.blindIncreaseAmount);
  const rate = Number(fields.yenPerChip);
  const bountyAmount = Number(fields.bountyAmountYen);

  if (!Number.isInteger(chips) || chips <= 0) return "開始チップは1以上の整数で入力してください。";
  if (!Number.isInteger(hands) || hands < 1) return "ハンド数は1以上の整数で入力してください。";
  if (!Number.isInteger(bb) || bb < 1) return "初期BBは1以上の整数で入力してください。";
  if (!Number.isInteger(every) || every < 1) return "ブラインド上昇の間隔は1以上の整数で入力してください。";
  if (!Number.isInteger(amount) || amount < 0) return "ブラインドの上昇額は0以上の整数で入力してください。";
  if (!Number.isFinite(rate) || rate <= 0) return "換算レートは0より大きい数で入力してください。";
  if (fields.bountyRuleEnabled && (!Number.isInteger(bountyAmount) || bountyAmount < 1)) {
    return "脱落ボーナスの金額は1円以上の整数で入力してください。";
  }
  return null;
}

interface NumberFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly step?: string;
  readonly suffix?: string;
}

function NumberField(props: NumberFieldProps): ReactNode {
  const { label, value, onChange, step, suffix } = props;
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input-row">
        <input
          className="field-input"
          type="number"
          inputMode="decimal"
          value={value}
          step={step ?? "1"}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </span>
    </label>
  );
}

export function SetupScreen(): ReactNode {
  const { services, navigate, notify, notifyError, confirm } = useShell();

  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<readonly Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [dealerId, setDealerId] = useState<string | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [fromLastGame, setFromLastGame] = useState(false);
  const [fields, setFields] = useState<FormFields>(toFields({
    startingChips: 1000,
    totalHands: 20,
    initialBigBlind: 100,
    blindIncreaseEveryHands: 5,
    blindIncreaseAmount: 50,
    yenPerChip: 0.1,
    bountyRuleEnabled: false,
    bountyAmountYen: 100,
  }));
  const [submitting, setSubmitting] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealName, setRevealName] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [roster, defaults] = await Promise.all([
          services.roster.list(),
          services.game.getSetupDefaults(),
        ]);
        if (cancelled) return;
        setPlayers(roster);
        setSelectedIds(defaults.seatOrder);
        setFromLastGame(defaults.isFromLastGame);
        setFields(toFields(defaults));
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

  const playerName = useMemo(() => {
    const map = new Map(players.map((p) => [p.id as string, p.name]));
    return (id: string) => map.get(id) ?? "?";
  }, [players]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((p) => p !== id);
        if (dealerId === id) setDealerId(null);
        if (selectedSeatId === id) setSelectedSeatId(null);
        return next;
      }
      if (prev.length >= MAX_PLAYERS) {
        notify(`参加者は最大${MAX_PLAYERS}人までです。`, "error");
        return prev;
      }
      return [...prev, id];
    });
  }

  function moveSelected(id: string, direction: -1 | 1) {
    setSelectedIds((prev) => {
      const index = prev.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[index]!;
      next[index] = next[target]!;
      next[target] = tmp;
      return next;
    });
  }

  async function addNewPlayer() {
    const name = newPlayerName.trim();
    if (!name) return;
    try {
      const player = await services.roster.registerOrFind(name);
      setPlayers((prev) => (prev.some((p) => p.id === player.id) ? prev : [...prev, player]));
      setNewPlayerName("");
      setSelectedIds((prev) => {
        if (prev.includes(player.id)) return prev;
        if (prev.length >= MAX_PLAYERS) {
          notify(`参加者は最大${MAX_PLAYERS}人までです。`, "error");
          return prev;
        }
        return [...prev, player.id];
      });
    } catch (error) {
      notifyError(error);
    }
  }

  function chooseRandomDealer() {
    if (selectedIds.length === 0 || revealing) return;
    const finalId = services.game.chooseRandomDealer(selectedIds);
    const durationMs = 2000;
    const start = Date.now();
    setRevealing(true);

    const tick = () => {
      if (!mountedRef.current) return;
      const elapsed = Date.now() - start;
      if (elapsed >= durationMs) {
        setDealerId(finalId);
        setRevealName(playerName(finalId));
        setRevealing(false);
        return;
      }
      const candidate = selectedIds[Math.floor(Math.random() * selectedIds.length)]!;
      setRevealName(playerName(candidate));
      // 終盤ほど切り替えをゆっくりにして、決まる瞬間を分かりやすくする
      const remaining = durationMs - elapsed;
      const delay = remaining < 500 ? 180 : remaining < 1000 ? 110 : 70;
      window.setTimeout(tick, delay);
    };
    tick();
  }

  async function submit() {
    if (selectedIds.length < MIN_PLAYERS) {
      notify(`参加者は${MIN_PLAYERS}人以上選んでください。`, "error");
      return;
    }
    if (!dealerId) {
      notify("最初の親を選んでください。", "error");
      return;
    }
    const problem = fieldProblem(fields);
    if (problem) {
      notify(problem, "error");
      return;
    }

    const request = {
      playerIds: selectedIds,
      initialDealerId: dealerId,
      startingChips: Number(fields.startingChips),
      totalHands: Number(fields.totalHands),
      initialBigBlind: Number(fields.initialBigBlind),
      blindIncreaseEveryHands: Number(fields.blindIncreaseEveryHands),
      blindIncreaseAmount: Number(fields.blindIncreaseAmount),
      yenPerChip: Number(fields.yenPerChip),
      bountyRuleEnabled: fields.bountyRuleEnabled,
      bountyAmountYen: Number(fields.bountyAmountYen),
    };

    setSubmitting(true);
    try {
      await services.game.startGame(request);
      navigate({ name: "Game" }, { replace: true });
    } catch (error) {
      if (errorCodeOf(error) === "GAME_IN_PROGRESS") {
        const ok = await confirm({
          title: "進行中の対局があります",
          message: "今の対局を破棄して、新しい対局を始めますか？（記録には残りません）",
          confirmLabel: "破棄して始める",
          danger: true,
        });
        if (ok) {
          try {
            await services.game.startGame({ ...request, replaceCurrent: true });
            navigate({ name: "Game" }, { replace: true });
          } catch (retryError) {
            notify(toUserMessage(retryError), "error");
          }
        }
      } else {
        notify(toUserMessage(error), "error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const goHome = () => navigate({ name: "Home" });

  if (loading) {
    return (
      <div className="screen">
        <ScreenHeader title="対局の設定" onBack={goHome} />
        <p className="loading-text">読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="screen screen-setup">
      <ScreenHeader title="対局の設定" onBack={goHome} />

      {fromLastGame && <Banner>前回の設定を引き継いでいます。必要な部分だけ変更してください。</Banner>}

      <section className="setup-section">
        <h2 className="setup-section-title">参加者（{selectedIds.length}/{MAX_PLAYERS}人）</h2>
        <ul className="player-select-list">
          {players.map((player) => {
            const selected = selectedIds.includes(player.id);
            return (
              <li key={player.id}>
                <button
                  type="button"
                  className={`player-select-item${selected ? " is-selected" : ""}`}
                  onClick={() => toggleSelect(player.id)}
                >
                  {player.name}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="add-player-row">
          <input
            className="field-input"
            type="text"
            placeholder="新しい参加者の名前"
            value={newPlayerName}
            onChange={(e) => setNewPlayerName(e.target.value)}
          />
          <Button onClick={addNewPlayer}>追加</Button>
        </div>
      </section>

      {selectedIds.length > 0 && (
        <section className="setup-section">
          <h2 className="setup-section-title">座席順</h2>
          {selectedIds.length <= CIRCLE_LAYOUT_MAX_PLAYERS ? (
            <>
              <p className="section-hint">丸をタップすると、その人の位置を前後に動かせます。</p>
              <div className="seat-circle seat-circle-setup">
                {selectedIds.map((id, index) => {
                  const pos = seatCirclePosition(index, selectedIds.length);
                  const isSelected = selectedSeatId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`seat-circle-item${isSelected ? " is-expanded" : ""}`}
                      style={{ left: pos.left, top: pos.top }}
                      onClick={() => setSelectedSeatId(isSelected ? null : id)}
                    >
                      <span className="seat-circle-name">{playerName(id)}</span>
                    </button>
                  );
                })}
              </div>
              {selectedSeatId && (
                <div className="seat-circle-controls">
                  <span className="section-hint">{playerName(selectedSeatId)}さんの位置を変える</span>
                  <div className="seat-order-controls">
                    <Button
                      variant="secondary"
                      disabled={selectedIds.indexOf(selectedSeatId) === 0}
                      onClick={() => moveSelected(selectedSeatId, -1)}
                    >
                      ← 前へ
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={selectedIds.indexOf(selectedSeatId) === selectedIds.length - 1}
                      onClick={() => moveSelected(selectedSeatId, 1)}
                    >
                      次へ →
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <ul className="seat-order-list">
              {selectedIds.map((id, index) => (
                <li key={id} className="seat-order-item">
                  <span className="seat-order-number">{index + 1}</span>
                  <span className="seat-order-name">{playerName(id)}</span>
                  <span className="seat-order-controls">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="上へ"
                      disabled={index === 0}
                      onClick={() => moveSelected(id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="下へ"
                      disabled={index === selectedIds.length - 1}
                      onClick={() => moveSelected(id, 1)}
                    >
                      ↓
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {selectedIds.length >= MIN_PLAYERS && (
        <section className="setup-section">
          <h2 className="setup-section-title">最初の親</h2>
          {revealing ? (
            <div className="dealer-reveal">
              <span className="dealer-reveal-name">{revealName}</span>
            </div>
          ) : (
            <div className="dealer-select-row">
              {selectedIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`dealer-select-item${dealerId === id ? " is-selected" : ""}`}
                  onClick={() => setDealerId(id)}
                >
                  {playerName(id)}
                </button>
              ))}
            </div>
          )}
          <Button variant="ghost" disabled={revealing} onClick={chooseRandomDealer}>
            {revealing ? "決めています…" : "ランダムで決める"}
          </Button>
        </section>
      )}

      <section className="setup-section">
        <h2 className="setup-section-title">チップ・ハンド数</h2>
        <NumberField
          label="開始チップ（1人あたり）"
          value={fields.startingChips}
          onChange={(v) => setFields((f) => ({ ...f, startingChips: v }))}
        />
        <NumberField
          label="総ハンド数"
          value={fields.totalHands}
          onChange={(v) => setFields((f) => ({ ...f, totalHands: v }))}
        />
        <NumberField
          label="1チップあたりの円"
          value={fields.yenPerChip}
          step="0.001"
          suffix="円"
          onChange={(v) => setFields((f) => ({ ...f, yenPerChip: v }))}
        />
      </section>

      <section className="setup-section">
        <h2 className="setup-section-title">ブラインド</h2>
        <NumberField
          label="初期BB（SBは自動で半額）"
          value={fields.initialBigBlind}
          onChange={(v) => setFields((f) => ({ ...f, initialBigBlind: v }))}
        />
        <NumberField
          label="何ハンドごとに上げるか"
          value={fields.blindIncreaseEveryHands}
          onChange={(v) => setFields((f) => ({ ...f, blindIncreaseEveryHands: v }))}
        />
        <NumberField
          label="1回あたりの上昇額（BB）"
          value={fields.blindIncreaseAmount}
          onChange={(v) => setFields((f) => ({ ...f, blindIncreaseAmount: v }))}
        />
      </section>

      <section className="setup-section">
        <h2 className="setup-section-title">オプションルール：脱落ボーナス</h2>
        <p className="section-hint">
          脱落した人が、脱落させた人（そのハンドの勝者）に、決めた金額を渡します。チップには影響せず、精算額だけが変わります。
        </p>
        <div className="dealer-select-row">
          <button
            type="button"
            className={`dealer-select-item${!fields.bountyRuleEnabled ? " is-selected" : ""}`}
            onClick={() => setFields((f) => ({ ...f, bountyRuleEnabled: false }))}
          >
            オフ
          </button>
          <button
            type="button"
            className={`dealer-select-item${fields.bountyRuleEnabled ? " is-selected" : ""}`}
            onClick={() => setFields((f) => ({ ...f, bountyRuleEnabled: true }))}
          >
            オン
          </button>
        </div>
        {fields.bountyRuleEnabled && (
          <NumberField
            label="脱落ボーナスの金額"
            value={fields.bountyAmountYen}
            suffix="円"
            onChange={(v) => setFields((f) => ({ ...f, bountyAmountYen: v }))}
          />
        )}
      </section>

      <Button variant="primary" fullWidth disabled={submitting || revealing} onClick={submit}>
        {submitting ? "作成中…" : "この設定で始める"}
      </Button>
    </div>
  );
}
