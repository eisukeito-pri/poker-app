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
 * - Input:      生存者。±を入力する（未入力はnull）
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

/** 入力ミスの疑いを知らせるための指摘（保存や精算は止めない） */
export interface ResultIssue {
  readonly playerId: PlayerId;
  /** 開始チップ全額を超えて負けている（あり得ない値） */
  readonly code: "BELOW_STARTING_LOSS";
}

/** 不変：全員の合計は、完成時に必ず0になる */
export interface ResultSheet {
  /** 座席順 */
  readonly entries: readonly ResultEntry[];
  readonly startingChips: Chips;
  /** 全員の値が確定している（精算に進める） */
  readonly isComplete: boolean;
  readonly issues: readonly ResultIssue[];
}

export interface ResultSheetOperations {
  create(input: {
    /** 座席順 */
    readonly seatOrder: readonly PlayerId[];
    readonly eliminatedIds: readonly PlayerId[];
    readonly startingChips: Chips;
  }): ResultSheet;
  /** 生存者（Input）の値を入力／消去する。Eliminated/AutoFilledは不可 */
  enter(
    sheet: ResultSheet,
    playerId: PlayerId,
    netChips: Chips | null,
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

/* ───────── ドメインサービス（実装は後で） ───────── */

export interface ChipsToYenConverter {
  /**
   * チップ収支を円に換算する。
   * 各人の金額（1/1000円）を1000で割って切り捨て、余りの大きい人から順に
   * +1円ずつ配る（最大剰余法）ことで、合計が必ず0円になる。
   * 前提：入力のnetChipsの合計は0。
   */
  convert(
    netChips: readonly PlayerNetChips[],
    rate: MilliYenPerChip,
  ): readonly PlayerResult[];
}

export interface TransferMinimizer {
  /**
   * 送金回数が最小になる組み合わせを求める。
   * 少人数は「合計0の部分集合に分ける」厳密解、多い場合は貪欲法で代用。
   * 前提：netYenの合計は0。
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
