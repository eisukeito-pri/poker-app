/**
 * コンテキスト①：対局進行（Game）
 *
 * 方針：Gameは「設定・座席・出来事の履歴」だけを保存する。
 * 現在の親／SB／BB／ハンド数／生存者などは履歴から再計算（project）する。
 * 「戻す」は履歴の最後の1件を取り除くだけで実現できる。
 */
import type {
  Chips,
  GameId,
  HandNumber,
  IsoDateTime,
  MilliYenPerChip,
  PlayerId,
} from "../shared/types";

/* ───────── 値オブジェクト ───────── */

/** 対局に参加するプレイヤー（名前は対局時点のスナップショット） */
export interface GamePlayer {
  readonly id: PlayerId;
  readonly name: string;
}

/** ブラインド設定 */
export interface BlindSchedule {
  /** 初期BB。SBは自動でBBの半額（端数は切り上げ） */
  readonly initialBigBlind: Chips;
  /** 何ハンドごとに上げるか（1以上） */
  readonly increaseEveryHands: number;
  /** 1回あたりのBB増加額（0以上）。SBはBBに追従して半額 */
  readonly increaseAmount: Chips;
}

export interface Blinds {
  readonly smallBlind: Chips;
  readonly bigBlind: Chips;
}

export interface GameSettings {
  /** 全員共通の開始チップ */
  readonly startingChips: Chips;
  /** 総ハンド数（1以上） */
  readonly totalHands: number;
  readonly blindSchedule: BlindSchedule;
  /** 換算レート（1チップ＝何円か。1/1000円単位の整数） */
  readonly exchangeRate: MilliYenPerChip;
}

/* ───────── 出来事（イベント） ───────── */

export interface GameEventBase {
  readonly at: IsoDateTime;
}

/** 「次のハンドへ」を押した */
export interface HandAdvanced extends GameEventBase {
  readonly type: "HandAdvanced";
}

export interface PlayerEliminated extends GameEventBase {
  readonly type: "PlayerEliminated";
  readonly playerId: PlayerId;
}

export interface PlayerReinstated extends GameEventBase {
  readonly type: "PlayerReinstated";
  readonly playerId: PlayerId;
}

export type PlayEndReason =
  | "AllHandsPlayed" // 最終ハンドで「結果入力へ」を押した
  | "SingleSurvivor"; // 生存者が1人になった

/** 対局（プレイ）の終了。結果入力へ進む。戻すと取り消せる */
export interface PlayEnded extends GameEventBase {
  readonly type: "PlayEnded";
  readonly reason: PlayEndReason;
}

export type GameEvent =
  | HandAdvanced
  | PlayerEliminated
  | PlayerReinstated
  | PlayEnded;

/* ───────── 集約ルート ───────── */

export interface Game {
  readonly id: GameId;
  readonly createdAt: IsoDateTime;
  readonly settings: GameSettings;
  /** 座席順（時計回り）。並びは対局中ずっと固定 */
  readonly seats: readonly GamePlayer[];
  /** 1ハンド目の親 */
  readonly initialDealerId: PlayerId;
  /** 出来事の履歴（古い順） */
  readonly events: readonly GameEvent[];
}

/* ───────── 履歴から再計算される現在の状態 ───────── */

export type GamePhase =
  | "Playing" // 対局中
  | "ResultPending"; // 結果入力待ち（PlayEnded済み）

/** 主ボタンの動作。最終ハンド or 生存者1人なら "EnterResult"（文言「結果入力へ」） */
export type NextAction = "AdvanceHand" | "EnterResult";

export interface GameState {
  readonly phase: GamePhase;
  readonly nextAction: NextAction;

  /** 現在のハンド（1始まり）と総ハンド数。画面上部の「5/20」 */
  readonly handNumber: HandNumber;
  readonly totalHands: number;

  /** 生存者（座席順）と脱落者 */
  readonly activePlayerIds: readonly PlayerId[];
  readonly eliminatedPlayerIds: readonly PlayerId[];

  /** 親。脱落者は飛ばされる */
  readonly dealerId: PlayerId;
  /** 残り2人のときは dealerId と同一人物（ディーラーがSB） */
  readonly smallBlindId: PlayerId;
  readonly bigBlindId: PlayerId;

  /** 現在のブラインド額 */
  readonly blinds: Blinds;
  /**
   * 現在のブラインドで打つ残りハンド数（現在のハンドを含む）。
   * 「あと3ハンドでブラインド上昇」の3。
   * 最終ハンドまでに上がらない場合（増加額0を含む）は null。
   */
  readonly handsUntilBlindIncrease: number | null;
  /** 上昇後のブラインド額（上昇しない場合は null） */
  readonly nextBlinds: Blinds | null;

  /** 直近の出来事。「戻す」ボタンで「何が戻るか」を表示するために使う */
  readonly lastEvent: GameEvent | null;
}

/* ───────── ドメインの振る舞い（実装は後で。純粋関数） ───────── */

export interface NewGameInput {
  /** 座席順（時計回り）。MIN_PLAYERS〜MAX_PLAYERS人、ID重複なし */
  readonly seats: readonly GamePlayer[];
  readonly initialDealerId: PlayerId;
  readonly settings: GameSettings;
}

/** ブラインドの計算（BlindScheduleの振る舞い） */
export interface BlindCalculator {
  /** BB = 初期BB + floor((hand-1) / 間隔) × 増加額、SB = ceil(BB / 2) */
  blindsAt(schedule: BlindSchedule, hand: HandNumber): Blinds;
  handsUntilIncrease(
    schedule: BlindSchedule,
    hand: HandNumber,
    totalHands: number,
  ): number | null;
}

/**
 * Game集約の操作。すべて新しいGameを返す（元は変更しない）。
 * ルール違反は DomainError を投げる。
 */
export interface GameOperations {
  create(input: NewGameInput, id: GameId, now: IsoDateTime): Game;
  /** 履歴を畳み込んで現在の状態を求める */
  project(game: Game): GameState;
  /** 次のハンドへ。親を次の生存者へ移す。最終ハンドでは NO_MORE_HANDS */
  advanceHand(game: Game, now: IsoDateTime): Game;
  /** 脱落。最後の生存者は不可。生存者が1人になったら呼び出し側が endPlay する */
  eliminate(game: Game, playerId: PlayerId, now: IsoDateTime): Game;
  reinstate(game: Game, playerId: PlayerId, now: IsoDateTime): Game;
  /** 「結果入力へ」。最終ハンド or 生存者1人のときのみ可能 */
  endPlay(game: Game, now: IsoDateTime): Game;
  /** 履歴の最後の1件を取り消す */
  undo(game: Game): Game;
}

/* ───────── リポジトリ ───────── */

/** 進行中の対局は常に1件だけ保持する */
export interface GameRepository {
  findCurrent(): Promise<Game | null>;
  saveCurrent(game: Game): Promise<void>;
  clearCurrent(): Promise<void>;
}
