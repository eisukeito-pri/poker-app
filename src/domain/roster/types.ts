/**
 * コンテキスト③：名簿・成績（Roster / Stats）
 *
 * 通算成績は保存済みの対局（GameRecord）から集計する「投影」で、集約ではない。
 */
import type { GameId, IsoDateTime, PlayerId, SettlementId, Yen } from "../shared/types";
import type { GamePlayer, GameSettings } from "../game/types";
import type { PlayerResult, Transfer } from "../settlement/types";

/* ───────── 名簿 ───────── */

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly createdAt: IsoDateTime;
}

export interface PlayerRepository {
  /** 登録順 */
  findAll(): Promise<readonly Player[]>;
  /** 同じIDがあれば置き換え、なければ末尾に追加する */
  save(player: Player): Promise<void>;
  /** 名簿から消しても、過去の記録（名前のスナップショット）には影響しない */
  remove(id: PlayerId): Promise<void>;
}

/* ───────── 履歴 ───────── */

/**
 * 結果入力まで済んだ対局の確定記録（スナップショット）。編集はできず、削除のみ。
 *
 * 対局を終えてもお金はまだ動かないことがある（複数対局分をまとめて精算する場合）。
 * settledAt が null の間は「未精算」で、精算（SettlementRecord）が作られると
 * その時刻が入る。transfers はこの対局単体で見たときの送金額の参考値であり、
 * 実際に支払う金額は未精算の対局をまとめた SettlementRecord の方で決まる。
 */
export interface GameRecord {
  readonly gameId: GameId;
  /** 対局を始めた時刻 */
  readonly playedAt: IsoDateTime;
  readonly settings: GameSettings;
  readonly players: readonly GamePlayer[];
  /** 実際に打ったハンド数（生存者1人で早期終了した場合は総ハンド数より少ない） */
  readonly handsPlayed: number;
  /** 座席順 */
  readonly results: readonly PlayerResult[];
  /** この対局単体だけで精算した場合の送金額（参考値） */
  readonly transfers: readonly Transfer[];
  /** 未精算なら null。精算されたら、その時刻が入る */
  readonly settledAt: IsoDateTime | null;
}

export interface GameRecordRepository {
  /** 新しい順 */
  findAll(): Promise<readonly GameRecord[]>;
  /** 同じgameIdの記録がすでにあれば DUPLICATE_RECORD */
  add(record: GameRecord): Promise<void>;
  remove(gameId: GameId): Promise<void>;
  /** 指定した対局群の settledAt に時刻を設定する（存在しないIDは無視） */
  markSettled(gameIds: readonly GameId[], settledAt: IsoDateTime): Promise<void>;
}

/* ───────── 精算（複数対局のまとめ払い） ───────── */

/** ある精算に含まれる、1人分の合算収支 */
export interface PlayerYenBalance {
  readonly playerId: PlayerId;
  /** 名前のスナップショット（精算時点） */
  readonly name: string;
  readonly netYen: Yen;
}

/**
 * 「精算して支払いへ」を押した時点で、未精算の対局をまとめて1回分の支払いにした記録。
 *
 * 合算ルール：対象の各対局について、参加していた人だけを対象に、対局ごとの
 * netYen（すでに円換算済み）を人ごとに合計する。ある対局に参加していない人は、
 * その対局分は0円として扱う（＝無視する）。各対局の収支は必ず合計0円なので、
 * 合算後の収支も必ず合計0円になる。
 */
export interface SettlementRecord {
  readonly id: SettlementId;
  readonly settledAt: IsoDateTime;
  /** この精算に含まれる対局（新しい順ではなく、対象になった順） */
  readonly gameIds: readonly GameId[];
  /** 合算収支（収支の大きい順） */
  readonly balances: readonly PlayerYenBalance[];
  /** 最小回数の送金リスト */
  readonly transfers: readonly Transfer[];
}

export interface SettlementRecordRepository {
  /** 新しい順 */
  findAll(): Promise<readonly SettlementRecord[]>;
  find(id: SettlementId): Promise<SettlementRecord | null>;
  add(record: SettlementRecord): Promise<void>;
}

/* ───────── 通算成績（読み取り専用の投影） ───────── */

/**
 * 勝ち／負け／引き分けは、円換算後の収支の符号で判定する
 * （プラスなら勝ち、マイナスなら負け、0円なら引き分け）。
 * チップの合計は、対局ごとに開始チップやレートが違って比べられないため持たない。
 */
export interface PlayerStats {
  readonly playerId: PlayerId;
  /** 名簿にいる人は現在の名前、いない人は最後の記録の名前 */
  readonly name: string;
  readonly gamesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly totalNetYen: Yen;
  /** 1回あたりの平均収支（円）。小数のまま持ち、表示のときに丸める */
  readonly averageNetYen: number;
  /** 1回の対局での最高・最低の収支（円） */
  readonly bestNetYen: Yen;
  readonly worstNetYen: Yen;
}

export interface StatsProjection {
  /**
   * 記録が1件以上ある人の成績を、通算収支の大きい順
   * （同額なら勝ち数の多い順、それも同じなら名前順）で返す。
   */
  aggregate(
    records: readonly GameRecord[],
    roster: readonly Player[],
  ): readonly PlayerStats[];
}
