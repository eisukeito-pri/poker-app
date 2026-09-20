/**
 * Game集約の操作（純粋関数）。
 * すべて新しいGameを返し、元のGameは変更しない。ルール違反は DomainError を投げる。
 *
 * 現在の状態（親・SB・BB・生存者など）は保存せず、出来事の履歴を先頭から
 * 順に畳み込んで求める（project）。「戻す」は履歴の最後の1件を取り除くだけ。
 *
 * 親・SB・BBのルール：
 * - 親は「座席順で次の生存者」へ移る（脱落者は飛ばす）
 * - SBは親の次の生存者、BBはその次の生存者
 * - 生存者が2人で親が生存しているときは、親がSB、もう一人がBB
 * - 親自身が脱落した場合、次の「次のハンドへ」までは脱落した人が親のまま表示される
 *   （SB・BBはその人の次の生存者から決まる）
 * - 生存者が1人のときは、その人がSB・BBを兼ねる（実際には結果入力へ進む）
 *
 * 結果入力待ち（PlayEnded後）の扱い：
 * - ハンドを進める・結果入力へ進む操作はできない
 * - 脱落・復帰は変更できる（結果入力画面での修正用）。最後の生存者は脱落させられない
 */
import { handNumber } from "../shared/constructors";
import { DomainError } from "../shared/errors";
import { MAX_PLAYERS, MIN_PLAYERS } from "../shared/types";
import type { GameId, IsoDateTime, PlayerId } from "../shared/types";
import type { Transfer } from "../settlement/types";
import { blindsAt, handsUntilIncrease } from "./blinds";
import type {
  Game,
  GameEvent,
  GameOperations,
  GamePlayer,
  GameSettings,
  GameState,
  NewGameInput,
} from "./types";

/* ───────── 内部ヘルパー ───────── */

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 1;

function seatIdAt(seats: readonly GamePlayer[], index: number): PlayerId {
  const seat = seats[index];
  if (!seat) throw new Error(`座席が存在しません: ${index}`); // 到達しない想定
  return seat.id;
}

/** fromIndex の次から時計回りに探して、最初の生存者の座席番号を返す */
function nextActiveSeatIndex(
  seats: readonly GamePlayer[],
  isActive: (id: PlayerId) => boolean,
  fromIndex: number,
): number {
  const count = seats.length;
  for (let step = 1; step <= count; step++) {
    const index = (fromIndex + step) % count;
    if (isActive(seatIdAt(seats, index))) return index;
  }
  return fromIndex;
}

interface Replayed {
  readonly hand: number;
  readonly dealerId: PlayerId;
  readonly eliminated: ReadonlySet<PlayerId>;
  readonly ended: boolean;
}

/** 履歴を先頭から畳み込む */
function replay(game: Game): Replayed {
  const { seats, events } = game;
  const eliminated = new Set<PlayerId>();
  const isActive = (id: PlayerId) => !eliminated.has(id);
  let hand = 1;
  let dealerId = game.initialDealerId;
  let ended = false;

  for (const event of events) {
    switch (event.type) {
      case "HandAdvanced": {
        hand += 1;
        const dealerIndex = seats.findIndex((seat) => seat.id === dealerId);
        dealerId = seatIdAt(
          seats,
          nextActiveSeatIndex(seats, isActive, dealerIndex),
        );
        break;
      }
      case "PlayerEliminated":
        eliminated.add(event.playerId);
        break;
      case "PlayerReinstated":
        eliminated.delete(event.playerId);
        break;
      case "PlayEnded":
        ended = true;
        break;
    }
  }
  return { hand, dealerId, eliminated, ended };
}

function blindPositions(
  seats: readonly GamePlayer[],
  activeIds: readonly PlayerId[],
  dealerId: PlayerId,
): { smallBlindId: PlayerId; bigBlindId: PlayerId } {
  const isActive = (id: PlayerId) => activeIds.includes(id);
  const dealerIndex = seats.findIndex((seat) => seat.id === dealerId);

  const [only] = activeIds;
  if (activeIds.length === 1 && only !== undefined) {
    return { smallBlindId: only, bigBlindId: only };
  }
  if (activeIds.length === 2 && isActive(dealerId)) {
    // ヘッズアップ：親がSB
    const bbIndex = nextActiveSeatIndex(seats, isActive, dealerIndex);
    return { smallBlindId: dealerId, bigBlindId: seatIdAt(seats, bbIndex) };
  }
  const sbIndex = nextActiveSeatIndex(seats, isActive, dealerIndex);
  const bbIndex = nextActiveSeatIndex(seats, isActive, sbIndex);
  return {
    smallBlindId: seatIdAt(seats, sbIndex),
    bigBlindId: seatIdAt(seats, bbIndex),
  };
}

function append(game: Game, event: GameEvent): Game {
  return { ...game, events: [...game.events, event] };
}

function requirePlaying(state: GameState): void {
  if (state.phase !== "Playing") {
    throw new DomainError(
      "NOT_PLAYING",
      "結果入力待ちのため、この操作はできません（先に「戻す」で対局に戻してください）",
    );
  }
}

function requireSeat(game: Game, playerId: PlayerId): void {
  if (!game.seats.some((seat) => seat.id === playerId)) {
    throw new DomainError("PLAYER_NOT_FOUND", `参加者ではありません: ${playerId}`);
  }
}

function validateSeats(
  seats: readonly GamePlayer[],
  initialDealerId: PlayerId,
): void {
  const problems: string[] = [];
  if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
    problems.push(`参加者は${MIN_PLAYERS}〜${MAX_PLAYERS}人`);
  }
  if (new Set(seats.map((seat) => seat.id)).size !== seats.length) {
    problems.push("参加者のIDが重複しています");
  }
  if (seats.some((seat) => seat.name.trim() === "")) {
    problems.push("名前が空の参加者がいます");
  }
  if (!seats.some((seat) => seat.id === initialDealerId)) {
    problems.push("最初の親が参加者に含まれていません");
  }
  if (problems.length > 0) {
    throw new DomainError("INVALID_PLAYERS", problems.join(" / "));
  }
}

function validateSettings(settings: GameSettings): void {
  const schedule = settings.blindSchedule;
  const problems: string[] = [];
  if (!isPositiveInteger(settings.startingChips)) {
    problems.push("開始チップは1以上の整数");
  }
  if (!isPositiveInteger(settings.totalHands)) {
    problems.push("総ハンド数は1以上の整数");
  }
  if (!isPositiveInteger(schedule.initialBigBlind)) {
    problems.push("初期BBは1以上の整数");
  }
  if (!isPositiveInteger(schedule.increaseEveryHands)) {
    problems.push("ブラインドを上げる間隔は1以上の整数");
  }
  if (!Number.isInteger(schedule.increaseAmount) || schedule.increaseAmount < 0) {
    problems.push("ブラインドの増加額は0以上の整数");
  }
  if (!isPositiveInteger(settings.exchangeRate)) {
    problems.push("換算レートが不正です");
  }
  if (settings.bountyRule !== null && !isPositiveInteger(settings.bountyRule.amountYen)) {
    problems.push("脱落ボーナスの金額は1以上の整数");
  }
  if (problems.length > 0) {
    throw new DomainError("INVALID_SETTINGS", problems.join(" / "));
  }
}

/* ───────── 公開する操作 ───────── */

export function create(
  input: NewGameInput,
  id: GameId,
  now: IsoDateTime,
): Game {
  validateSeats(input.seats, input.initialDealerId);
  validateSettings(input.settings);
  return {
    id,
    createdAt: now,
    settings: input.settings,
    seats: [...input.seats],
    initialDealerId: input.initialDealerId,
    events: [],
  };
}

/** 履歴を畳み込んで現在の状態を求める */
export function project(game: Game): GameState {
  const { seats, settings, events } = game;
  const replayed = replay(game);

  const activePlayerIds = seats
    .filter((seat) => !replayed.eliminated.has(seat.id))
    .map((seat) => seat.id);
  const eliminatedPlayerIds = seats
    .filter((seat) => replayed.eliminated.has(seat.id))
    .map((seat) => seat.id);

  const hand = handNumber(replayed.hand);
  const untilIncrease = handsUntilIncrease(
    settings.blindSchedule,
    hand,
    settings.totalHands,
  );
  const { smallBlindId, bigBlindId } = blindPositions(
    seats,
    activePlayerIds,
    replayed.dealerId,
  );

  const isFinalHand = replayed.hand >= settings.totalHands;
  const isSingleSurvivor = activePlayerIds.length === 1;

  return {
    phase: replayed.ended ? "ResultPending" : "Playing",
    nextAction:
      replayed.ended || isFinalHand || isSingleSurvivor
        ? "EnterResult"
        : "AdvanceHand",
    handNumber: hand,
    totalHands: settings.totalHands,
    activePlayerIds,
    eliminatedPlayerIds,
    dealerId: replayed.dealerId,
    smallBlindId,
    bigBlindId,
    blinds: blindsAt(settings.blindSchedule, hand),
    handsUntilBlindIncrease: untilIncrease,
    nextBlinds:
      untilIncrease === null
        ? null
        : blindsAt(settings.blindSchedule, handNumber(replayed.hand + untilIncrease)),
    lastEvent: events.length > 0 ? (events[events.length - 1] ?? null) : null,
  };
}

/** 次のハンドへ。最終ハンド・生存者1人・結果入力待ちでは進めない */
export function advanceHand(game: Game, now: IsoDateTime): Game {
  const state = project(game);
  requirePlaying(state);
  if (
    state.handNumber >= game.settings.totalHands ||
    state.activePlayerIds.length <= 1
  ) {
    throw new DomainError("NO_MORE_HANDS", "これ以上ハンドを進められません");
  }
  return append(game, { type: "HandAdvanced", at: now });
}

/**
 * 脱落。最後の生存者は脱落させられない。結果入力待ちでも可。
 * 脱落ボーナスのルールが有効な対局では、eliminatedById（脱落させた人。
 * 参加者のうち、脱落する本人以外の、今まさに脱落していない人）が必須
 */
export function eliminate(
  game: Game,
  playerId: PlayerId,
  now: IsoDateTime,
  eliminatedById: PlayerId | null = null,
): Game {
  const state = project(game);
  requireSeat(game, playerId);
  if (state.eliminatedPlayerIds.includes(playerId)) {
    throw new DomainError("ALREADY_ELIMINATED", "すでに脱落しています");
  }
  if (state.activePlayerIds.length <= 1) {
    throw new DomainError("LAST_SURVIVOR", "最後の生存者は脱落させられません");
  }

  const rule = game.settings.bountyRule;
  if (rule === null) {
    if (eliminatedById !== null) {
      throw new DomainError(
        "INVALID_BOUNTY_RECIPIENT",
        "この対局では脱落ボーナスのルールが無効です",
      );
    }
  } else {
    if (eliminatedById === null) {
      throw new DomainError(
        "BOUNTY_RECIPIENT_REQUIRED",
        "脱落ボーナスのルールが有効です。脱落させた人を選んでください",
      );
    }
    if (eliminatedById === playerId) {
      throw new DomainError("INVALID_BOUNTY_RECIPIENT", "本人は選べません");
    }
    requireSeat(game, eliminatedById);
    if (state.eliminatedPlayerIds.includes(eliminatedById)) {
      throw new DomainError(
        "INVALID_BOUNTY_RECIPIENT",
        "脱落している人は選べません",
      );
    }
  }

  return append(game, { type: "PlayerEliminated", playerId, at: now, eliminatedById });
}

/**
 * 脱落ボーナスのルールによる、現時点で有効な送金の一覧を返す（ルール無効なら空配列）。
 * 脱落した人 → 脱落させた人、へ決めた金額。
 * 誤操作で「復帰」させた場合は、そのときの受け渡しも取り消したものとして扱う
 * （同じ人がその後もう一度脱落すれば、そのときの相手が新たに記録される）。
 */
export function bountyTransfersOf(game: Game): readonly Transfer[] {
  const rule = game.settings.bountyRule;
  if (rule === null) return [];

  const current = new Map<PlayerId, PlayerId>();
  for (const event of game.events) {
    if (event.type === "PlayerEliminated" && event.eliminatedById !== null) {
      current.set(event.playerId, event.eliminatedById);
    } else if (event.type === "PlayerReinstated") {
      current.delete(event.playerId);
    }
  }

  return [...current.entries()].map(([eliminatedId, eliminatedById]) => ({
    from: eliminatedId,
    to: eliminatedById,
    amount: rule.amountYen,
  }));
}

/** 復帰。結果入力待ちでも可 */
export function reinstate(
  game: Game,
  playerId: PlayerId,
  now: IsoDateTime,
): Game {
  const state = project(game);
  requireSeat(game, playerId);
  if (!state.eliminatedPlayerIds.includes(playerId)) {
    throw new DomainError("NOT_ELIMINATED", "脱落していません");
  }
  return append(game, { type: "PlayerReinstated", playerId, at: now });
}

/** 「結果入力へ」。最終ハンド or 生存者1人のときのみ */
export function endPlay(game: Game, now: IsoDateTime): Game {
  const state = project(game);
  requirePlaying(state);
  const isSingleSurvivor = state.activePlayerIds.length === 1;
  const isFinalHand = state.handNumber >= game.settings.totalHands;
  if (!isSingleSurvivor && !isFinalHand) {
    throw new DomainError(
      "CANNOT_END_YET",
      "最終ハンドか、生存者が1人になるまで結果入力には進めません",
    );
  }
  return append(game, {
    type: "PlayEnded",
    reason: isSingleSurvivor ? "SingleSurvivor" : "AllHandsPlayed",
    at: now,
  });
}

/** 履歴の最後の1件を取り消す */
export function undo(game: Game): Game {
  if (game.events.length === 0) {
    throw new DomainError("NOTHING_TO_UNDO", "戻せる操作がありません");
  }
  return { ...game, events: game.events.slice(0, -1) };
}

export const gameOperations: GameOperations = {
  create,
  project,
  advanceHand,
  eliminate,
  reinstate,
  endPlay,
  undo,
};
