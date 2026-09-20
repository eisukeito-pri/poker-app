/**
 * アプリケーション層：ユースケースの入出力と、外部に依存する部品（ポート）の型
 * UI（React）はここのインターフェースだけを呼ぶ。
 *
 * 入力は、画面から受け取る普通の数値・文字列。ユースケースの中で検証して型に変換する。
 * ルール違反は DomainError（codeで表示を切り替える）。
 */
import type { Game, GameState, LastGameSetup } from "../domain/game/types";
import type {
  GameRecord,
  Player,
  PlayerStats,
  PlayerYenBalance,
  SettlementRecord,
} from "../domain/roster/types";
import type { IsoDateTime, PlayerId, SettlementId } from "../domain/shared/types";
import type { GameId } from "../domain/shared/types";
import type { ResultDraft, ResultSheet, Transfer } from "../domain/settlement/types";

/* ───────── ポート（テストで差し替えられるようにする） ───────── */

export interface Clock {
  now(): IsoDateTime;
}

export interface IdGenerator {
  newPlayerId(): PlayerId;
  newGameId(): GameId;
  newSettlementId(): SettlementId;
}

export interface RandomSource {
  /** 0以上 maxExclusive 未満の整数を、偏りなく返す */
  nextInt(maxExclusive: number): number;
}

/* ───────── 対局進行 ───────── */

/** 画面表示用：座席や名前を持つGameと、再計算済みの状態のセット */
export interface GameView {
  readonly game: Game;
  readonly state: GameState;
}

/** 設定画面の初期値（前回の設定。なければアプリの既定値） */
export interface SetupDefaults {
  readonly startingChips: number;
  readonly totalHands: number;
  readonly initialBigBlind: number;
  readonly blindIncreaseEveryHands: number;
  readonly blindIncreaseAmount: number;
  /** 1チップあたりの円（例：0.1） */
  readonly yenPerChip: number;
  /** 前回の参加者と座席順。名簿から削除された人は除いてある */
  readonly seatOrder: readonly PlayerId[];
  readonly isFromLastGame: boolean;
  /** 脱落ボーナスのオプションルール。前回オフだった場合、金額は前回入力していた値かアプリの既定値 */
  readonly bountyRuleEnabled: boolean;
  readonly bountyAmountYen: number;
}

export interface StartGameRequest {
  /** 座席順（時計回り）。名簿のID */
  readonly playerIds: readonly string[];
  readonly initialDealerId: string;
  readonly startingChips: number;
  readonly totalHands: number;
  /** BB。SBは自動で半額（切り上げ） */
  readonly initialBigBlind: number;
  readonly blindIncreaseEveryHands: number;
  readonly blindIncreaseAmount: number;
  readonly yenPerChip: number;
  /** オプションルール「脱落ボーナス」。オンなら bountyAmountYen（1円以上）が必要 */
  readonly bountyRuleEnabled: boolean;
  readonly bountyAmountYen: number;
  /**
   * 進行中の対局があるときに、破棄して始めるか。
   * false／未指定なら GAME_IN_PROGRESS（UIが確認ダイアログを出してから true で呼ぶ）
   */
  readonly replaceCurrent?: boolean;
}

export interface GameUseCases {
  getSetupDefaults(): Promise<SetupDefaults>;
  /** 最初の親をランダムに選ぶ（選ばれたIDを返すだけで、対局は始まらない） */
  chooseRandomDealer(playerIds: readonly string[]): PlayerId;
  startGame(request: StartGameRequest): Promise<GameView>;
  /** アプリ起動時に、進行中の対局があれば復元する */
  getCurrentGame(): Promise<GameView | null>;
  advanceHand(): Promise<GameView>;
  /**
   * 生存者が1人になっても自動では進まない（主ボタンが「結果入力へ」に変わる）。
   * 脱落ボーナスのルールが有効な対局では、eliminatedById（脱落させた人）が必須
   */
  eliminatePlayer(playerId: string, eliminatedById?: string | null): Promise<GameView>;
  reinstatePlayer(playerId: string): Promise<GameView>;
  /** 「結果入力へ」 */
  endPlay(): Promise<GameView>;
  /** 履歴の最初まで戻せる。結果入力から対局に戻ると、入力途中の値は破棄される */
  undo(): Promise<GameView>;
  /** 進行中の対局を破棄する（記録には残さない）。対局がなければ何もしない */
  abandonGame(): Promise<void>;
}

/* ───────── 結果入力・精算 ───────── */

/**
 * 未精算（まだお金のやりとりをしていない）対局をまとめた、精算前のプレビュー。
 * 未精算の対局が1件もなければ pendingGames は空配列（エラーにはしない）。
 */
export interface PendingSettlementView {
  /** 対象になっている対局（新しい順） */
  readonly pendingGames: readonly GameRecord[];
  /** 合算収支（収支の大きい順） */
  readonly balances: readonly PlayerYenBalance[];
  /** 最小回数の送金リスト */
  readonly transfers: readonly Transfer[];
}

export interface SettlementUseCases {
  /** 結果入力待ちの対局のシート。それ以外は NOT_RESULT_PENDING */
  getResultSheet(): Promise<ResultSheet>;
  /** 生存者の±を入力（nullで消去）。入力途中のデータとして自動保存される */
  enterResult(playerId: string, netChips: number | null): Promise<ResultSheet>;
  /**
   * この対局の結果を履歴に保存する（未精算のまま）。進行中の対局と入力途中の
   * データを消す。途中で失敗して押し直しても、記録が二重にならない。
   * 「次の対局へ」「精算して支払いへ」のどちらでも、まずこれを呼ぶ。
   */
  recordGame(): Promise<GameRecord>;
  /** 未精算の対局をまとめたプレビュー（何件あっても・0件でもエラーにしない） */
  getPendingSettlement(): Promise<PendingSettlementView>;
  /**
   * 「精算して支払いへ」：未精算の対局をすべて精算済みにし、まとめの精算記録を作る。
   * 未精算の対局が1件もなければ NO_PENDING_SETTLEMENT。
   */
  settleUp(): Promise<SettlementRecord>;
}

/* ───────── 名簿・履歴・成績 ───────── */

export interface RosterUseCases {
  list(): Promise<readonly Player[]>;
  /** 同じ名前がすでにあれば DUPLICATE_PLAYER_NAME */
  register(name: string): Promise<Player>;
  /** 設定画面用：同じ名前の人がいればその人を返し、いなければ登録する */
  registerOrFind(name: string): Promise<Player>;
  rename(id: string, name: string): Promise<Player>;
  /** 名簿から削除する。過去の記録や、進行中の対局には影響しない */
  remove(id: string): Promise<void>;
}

export interface HistoryUseCases {
  /** 新しい順 */
  listRecords(): Promise<readonly GameRecord[]>;
  /** なければ RECORD_NOT_FOUND */
  getRecord(gameId: string): Promise<GameRecord>;
  /** なければ RECORD_NOT_FOUND */
  deleteRecord(gameId: string): Promise<void>;
  getPlayerStats(): Promise<readonly PlayerStats[]>;
  /** 新しい順 */
  listSettlements(): Promise<readonly SettlementRecord[]>;
  /** なければ SETTLEMENT_NOT_FOUND */
  getSettlement(id: string): Promise<SettlementRecord>;
}

/* ───────── バックアップ ───────── */

export interface BackupData {
  readonly schemaVersion: 1;
  readonly exportedAt: IsoDateTime;
  readonly players: readonly Player[];
  readonly records: readonly GameRecord[];
  readonly settlements: readonly SettlementRecord[];
  readonly currentGame: Game | null;
  readonly resultDraft: ResultDraft | null;
  readonly lastSetup: LastGameSetup | null;
}

export interface BackupFile {
  /** 例：poker-backup-2026-09-20.json */
  readonly fileName: string;
  /** JSONの文字列 */
  readonly content: string;
}

export interface BackupUseCases {
  exportBackup(): Promise<BackupFile>;
  /**
   * ファイルの内容を検証し、今のデータをすべて置き換える（確認ダイアログはUI側）。
   * 不正・新しいバージョンのファイルは、何も変えずにエラー。
   */
  importBackup(content: string): Promise<void>;
  /** 進行中の対局も含めて、全データを削除する（確認ダイアログはUI側） */
  wipeAllData(): Promise<void>;
}

/* ───────── バックアップの部品（infrastructure が実装する） ───────── */

export interface BackupStorage {
  createBackup(now: IsoDateTime): BackupData;
  restore(data: unknown): void;
  wipe(): void;
}

export interface BackupCodec {
  serialize(data: BackupData): string;
  parse(content: string): BackupData;
  fileName(now: IsoDateTime): string;
}
