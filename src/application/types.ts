/**
 * アプリケーション層：ユースケースの入出力と、外部に依存する部品（ポート）の型
 * UI（React）はここのインターフェースだけを呼ぶ。
 */
import type { Chips, GameId, IsoDateTime, PlayerId } from "../domain/shared/types";
import type {
  Game,
  GameState,
  LastGameSetup,
  NewGameInput,
} from "../domain/game/types";
import type {
  ResultDraft,
  ResultSheet,
  Settlement,
} from "../domain/settlement/types";
import type {
  GameRecord,
  Player,
  PlayerStats,
} from "../domain/roster/types";

/* ───────── ポート（テストで差し替えられるようにする） ───────── */

export interface Clock {
  now(): IsoDateTime;
}

export interface IdGenerator {
  newPlayerId(): PlayerId;
  newGameId(): GameId;
}

/* ───────── 対局進行 ───────── */

/** 画面表示用：座席や名前を持つGameと、再計算済みの状態のセット */
export interface GameView {
  readonly game: Game;
  readonly state: GameState;
}

export interface GameUseCases {
  startGame(input: NewGameInput): Promise<GameView>;
  /** アプリ起動時に、進行中の対局があれば復元する */
  getCurrentGame(): Promise<GameView | null>;
  advanceHand(): Promise<GameView>;
  /** 脱落。生存者が1人になった場合、続けてendPlayを呼ぶかはUI（またはこの中）で判断 */
  eliminatePlayer(playerId: PlayerId): Promise<GameView>;
  reinstatePlayer(playerId: PlayerId): Promise<GameView>;
  /** 「結果入力へ」 */
  endPlay(): Promise<GameView>;
  undo(): Promise<GameView>;
  /** 進行中の対局を破棄する */
  abandonGame(): Promise<void>;
}

/* ───────── 結果入力・精算 ───────── */

export interface SettlementUseCases {
  getResultSheet(): Promise<ResultSheet>;
  /** 生存者の±を入力（null で消去）。入力途中はResultDraftとして自動保存 */
  enterResult(playerId: PlayerId, netChips: Chips | null): Promise<ResultSheet>;
  /** 精算結果の計算のみ（保存しない）。精算画面の表示用 */
  previewSettlement(): Promise<Settlement>;
  /** 「保存して完了」：GameRecordを履歴に保存し、進行中の対局と入力途中データを消す */
  finalizeGame(): Promise<GameRecord>;
}

/* ───────── 名簿・履歴・成績 ───────── */

export interface RosterUseCases {
  list(): Promise<readonly Player[]>;
  register(name: string): Promise<Player>;
  rename(id: PlayerId, name: string): Promise<Player>;
  remove(id: PlayerId): Promise<void>;
}

export interface HistoryUseCases {
  listRecords(): Promise<readonly GameRecord[]>;
  deleteRecord(gameId: GameId): Promise<void>;
  getPlayerStats(): Promise<readonly PlayerStats[]>;
}

/* ───────── バックアップ ───────── */

export interface BackupData {
  readonly schemaVersion: 1;
  readonly exportedAt: IsoDateTime;
  readonly players: readonly Player[];
  readonly records: readonly GameRecord[];
  readonly currentGame: Game | null;
  readonly resultDraft: ResultDraft | null;
  readonly lastSetup: LastGameSetup | null;
}

export interface BackupUseCases {
  exportBackup(): Promise<BackupData>;
  /** 形式を検証し、既存データを置き換える（確認ダイアログはUI側） */
  importBackup(data: unknown): Promise<void>;
}
