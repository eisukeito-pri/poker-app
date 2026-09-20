/**
 * コンテキスト③：名簿・成績（Roster / Stats）
 *
 * 通算成績は保存済みの対局（GameRecord）から集計する「投影」で、集約ではない。
 */
import type { GameId, IsoDateTime, PlayerId, Yen } from "../shared/types";
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

/** 精算まで済んだ対局の確定記録（スナップショット）。編集はできず、削除のみ */
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
  readonly transfers: readonly Transfer[];
}

export interface GameRecordRepository {
  /** 新しい順 */
  findAll(): Promise<readonly GameRecord[]>;
  /** 同じgameIdの記録がすでにあれば DUPLICATE_RECORD */
  add(record: GameRecord): Promise<void>;
  remove(gameId: GameId): Promise<void>;
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
