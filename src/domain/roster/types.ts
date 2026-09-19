/**
 * コンテキスト③：名簿・成績（Roster / Stats）
 *
 * 通算成績は保存済みの対局（GameRecord）から集計する「投影」で、集約ではない。
 */
import type {
  Chips,
  GameId,
  IsoDateTime,
  PlayerId,
  Yen,
} from "../shared/types";
import type { GamePlayer, GameSettings } from "../game/types";
import type { PlayerResult, Transfer } from "../settlement/types";

/* ───────── 名簿 ───────── */

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly createdAt: IsoDateTime;
}

export interface PlayerRepository {
  findAll(): Promise<readonly Player[]>;
  save(player: Player): Promise<void>;
  /** 名簿から消しても、過去の記録（名前のスナップショット）には影響しない */
  remove(id: PlayerId): Promise<void>;
}

/* ───────── 履歴 ───────── */

/** 精算まで済んだ対局の確定記録（スナップショット） */
export interface GameRecord {
  readonly gameId: GameId;
  readonly playedAt: IsoDateTime;
  readonly settings: GameSettings;
  readonly players: readonly GamePlayer[];
  /** 実際に打ったハンド数（生存者1人で早期終了した場合は総ハンド数より少ない） */
  readonly handsPlayed: number;
  readonly results: readonly PlayerResult[];
  readonly transfers: readonly Transfer[];
}

export interface GameRecordRepository {
  /** 新しい順 */
  findAll(): Promise<readonly GameRecord[]>;
  add(record: GameRecord): Promise<void>;
  remove(gameId: GameId): Promise<void>;
}

/* ───────── 通算成績（読み取り専用の投影） ───────── */

export interface PlayerStats {
  readonly playerId: PlayerId;
  /** 直近の記録での名前 */
  readonly name: string;
  readonly gamesPlayed: number;
  /** 収支がプラスだった対局数 */
  readonly positiveGames: number;
  readonly totalNetChips: Chips;
  readonly totalNetYen: Yen;
}

export interface StatsProjection {
  /** 通算収支の大きい順 */
  aggregate(records: readonly GameRecord[]): readonly PlayerStats[];
}
