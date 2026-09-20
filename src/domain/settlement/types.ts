/**
 * コンテキスト②：精算（Settlement）
 *
 * 流れ：ResultSheet（±の入力）→ 換算（円）→ 最小回数の送金リスト
 */
import type {
  Chips,
  GameId,
  MilliYenPerChip,
  PlayerId,
  Yen,
} from "../shared/types";

/* ───────── 結果入力 ───────── */

/**
 * 入力欄の種類
 * - Eliminated: 脱落者。−開始チップ全額で自動確定（編集不可）
 * - Input:      生存者。±を入力する（未入力はnull。0は入力済み）
 * - AutoFilled: 生存者のうち座席順で一番後ろの1人。
 *               他の全員がそろうと「合計0」になる値が自動で入る（それまでnull）
 * 生存者が1人だけのときは、その人がAutoFilled（全員の負けの合計を受け取る）。
 */
export type ResultEntry =
  | {
      readonly kind: "Eliminated";
      readonly playerId: PlayerId;
      readonly netChips: Chips;
    }
  | {
      readonly kind: "Input";
      readonly playerId: PlayerId;
      readonly netChips: Chips | null;
    }
  | {
      readonly kind: "AutoFilled";
      readonly playerId: PlayerId;
      readonly netChips: Chips | null;
    };

/**
 * 入力ミスの指摘。1つでもあれば精算できない（canSettle = false）。
 * 範囲：下限は −開始チップ、上限は (参加人数−1) × 開始チップ
 */
export interface ResultIssue {
  readonly playerId: PlayerId;
  readonly code: "BELOW_MINIMUM" | "ABOVE_MAXIMUM";
}

/** 不変：完成時（isComplete）、全員の合計は必ず0になる */
export interface ResultSheet {
  /** 座席順 */
  readonly entries: readonly ResultEntry[];
  readonly startingChips: Chips;
  /** 全員の値が確定している */
  readonly isComplete: boolean;
  readonly issues: readonly ResultIssue[];
  /** 精算に進める：isComplete かつ issues が空 */
  readonly canSettle: boolean;
}

export interface ResultSheetOperations {
  /** 座席順・脱落者・開始チップから、空の入力シートを作る（生存者が0人ならエラー） */
  create(input: {
    /** 座席順 */
    readonly seatOrder: readonly PlayerId[];
    readonly eliminatedIds: readonly PlayerId[];
    readonly startingChips: Chips;
  }): ResultSheet;
  /** 生存者（Input）の値を入力／消去（null）する。Eliminated/AutoFilledは不可 */
  enter(
    sheet: ResultSheet,
    playerId: PlayerId,
    netChips: Chips | null,
  ): ResultSheet;
  /**
   * 脱落状態の変更（結果入力画面での脱落・復帰）を反映して作り直す。
   * 入力値の扱い：Input のままの人の値は保持し、種類が変わった人
   * （脱落／復帰した人、自動入力の対象になった人・外れた人）の値は破棄する。
   */
  updateEliminated(
    sheet: ResultSheet,
    eliminatedIds: readonly PlayerId[],
  ): ResultSheet;
}

/** 入力途中の保存用（タブが閉じても消えないように） */
export interface ResultDraft {
  readonly gameId: GameId;
  readonly inputs: readonly {
    readonly playerId: PlayerId;
    readonly netChips: Chips;
  }[];
}

export interface ResultDraftRepository {
  find(gameId: GameId): Promise<ResultDraft | null>;
  save(draft: ResultDraft): Promise<void>;
  clear(gameId: GameId): Promise<void>;
}

/* ───────── 精算結果 ───────── */

export interface PlayerNetChips {
  readonly playerId: PlayerId;
  readonly netChips: Chips;
}

export interface PlayerResult {
  readonly playerId: PlayerId;
  readonly netChips: Chips;
  /** 換算後の収支（円）。全員の合計が必ず0になるよう端数調整済み */
  readonly netYen: Yen;
}

export interface Transfer {
  readonly from: PlayerId;
  readonly to: PlayerId;
  readonly amount: Yen;
}

export interface Settlement {
  readonly results: readonly PlayerResult[];
  /** 最小回数の送金リスト */
  readonly transfers: readonly Transfer[];
}

/* ───────── ドメインサービス ───────── */

export interface ChipsToYenConverter {
  /**
   * チップ収支を1円単位の円に換算する。
   * 各人の金額（1/1000円）を1000で割って切り捨て、余りの大きい人から順に
   * +1円ずつ配る（最大剰余法）ことで、合計が必ず0円になる。
   * 余りが同じなら、入力配列の並び（座席順）で先の人から。
   * 前提：入力のnetChipsの合計は0（違えば RESULT_INVALID）。
   */
  convert(
    netChips: readonly PlayerNetChips[],
    rate: MilliYenPerChip,
  ): readonly PlayerResult[];
}

export interface TransferMinimizer {
  /**
   * 送金回数が最小になる組み合わせを求める。
   * 合計0の部分グループにできるだけ細かく分け、各グループ内で、
   * 受取額の大きい人と支払額の大きい人から順に組み合わせる。
   * 同点の選び方は、収支の絶対値が大きい人（同額なら入力順）を優先して決定的に決める。
   * 収支0円の人は含まれない。
   * 前提：netYenの合計は0（違えば RESULT_INVALID）。
   */
  minimize(
    balances: readonly { readonly playerId: PlayerId; readonly netYen: Yen }[],
  ): readonly Transfer[];
}

export interface SettlementCalculator {
  /** ChipsToYenConverter → TransferMinimizer の順に呼び出す */
  calculate(
    netChips: readonly PlayerNetChips[],
    rate: MilliYenPerChip,
  ): Settlement;
}
