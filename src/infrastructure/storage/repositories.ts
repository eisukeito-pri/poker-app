/**
 * リポジトリの実装（KeyValueStore = localStorage など に保存する）。
 *
 * - 読み込み時：形式とルールを検証し、壊れていれば STORAGE_CORRUPTED
 *   （黙って空にはしない。バックアップからの復元などをユーザーに選んでもらうため）
 * - 書き込み時：保存前に検証し、容量超過などは STORAGE_FAILED
 */
import type {
  Game,
  GameRepository,
  LastGameSetup,
  LastGameSetupRepository,
} from "../../domain/game/types";
import { sortRecordsNewestFirst } from "../../domain/roster/record";
import type {
  GameRecord,
  GameRecordRepository,
  Player,
  PlayerRepository,
  SettlementRecord,
  SettlementRecordRepository,
} from "../../domain/roster/types";
import { DomainError } from "../../domain/shared/errors";
import type { GameId, PlayerId, SettlementId } from "../../domain/shared/types";
import type { ResultDraft, ResultDraftRepository } from "../../domain/settlement/types";
import type { KeyValueStore } from "./key-value-store";
import {
  parseGame,
  parseGameRecord,
  parseGameRecords,
  parseLastSetup,
  parsePlayers,
  parseResultDraft,
  parseSettlementRecord,
  parseSettlementRecords,
} from "./parsers";
import {
  parseStored,
  readStored,
  removeStored,
  STORAGE_KEYS,
  validateBeforeWrite,
  writeStored,
} from "./storage-io";

/* ───────── 名簿 ───────── */

export class StoragePlayerRepository implements PlayerRepository {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  private load(): Player[] {
    const data = readStored(this.store, STORAGE_KEYS.players);
    return data === undefined ? [] : parseStored(() => parsePlayers(data));
  }

  async findAll(): Promise<readonly Player[]> {
    return this.load();
  }

  async save(player: Player): Promise<void> {
    const players = this.load();
    const index = players.findIndex((p) => p.id === player.id);
    const next = index >= 0 ? players.map((p, i) => (i === index ? player : p)) : [...players, player];
    writeStored(this.store, STORAGE_KEYS.players, validateBeforeWrite(() => parsePlayers(next)));
  }

  async remove(id: PlayerId): Promise<void> {
    const players = this.load();
    writeStored(this.store, STORAGE_KEYS.players, players.filter((p) => p.id !== id));
  }
}

/* ───────── 対局の記録 ───────── */

export class StorageGameRecordRepository implements GameRecordRepository {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  private load(): GameRecord[] {
    const data = readStored(this.store, STORAGE_KEYS.records);
    return data === undefined ? [] : parseStored(() => parseGameRecords(data));
  }

  async findAll(): Promise<readonly GameRecord[]> {
    return sortRecordsNewestFirst(this.load());
  }

  async add(record: GameRecord): Promise<void> {
    const records = this.load();
    if (records.some((r) => r.gameId === record.gameId)) {
      throw new DomainError("DUPLICATE_RECORD", "この対局の記録はすでに保存されています");
    }
    const valid = validateBeforeWrite(() => parseGameRecord(record));
    writeStored(this.store, STORAGE_KEYS.records, [...records, valid]);
  }

  async remove(gameId: GameId): Promise<void> {
    const records = this.load();
    writeStored(this.store, STORAGE_KEYS.records, records.filter((r) => r.gameId !== gameId));
  }

  async markSettled(gameIds: readonly GameId[], settledAt: string): Promise<void> {
    const targets = new Set<string>(gameIds);
    const records = this.load();
    const next = records.map((r) =>
      targets.has(r.gameId) ? { ...r, settledAt } : r,
    );
    const valid = next.map((r) => validateBeforeWrite(() => parseGameRecord(r)));
    writeStored(this.store, STORAGE_KEYS.records, valid);
  }
}

/* ───────── 精算（複数対局のまとめ払い） ───────── */

export class StorageSettlementRecordRepository implements SettlementRecordRepository {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  private load(): SettlementRecord[] {
    const data = readStored(this.store, STORAGE_KEYS.settlements);
    return data === undefined ? [] : parseStored(() => parseSettlementRecords(data));
  }

  async findAll(): Promise<readonly SettlementRecord[]> {
    return this.load();
  }

  async find(id: SettlementId): Promise<SettlementRecord | null> {
    return this.load().find((r) => r.id === id) ?? null;
  }

  async add(record: SettlementRecord): Promise<void> {
    const records = this.load();
    if (records.some((r) => r.id === record.id)) {
      throw new DomainError("DUPLICATE_RECORD", "この精算の記録はすでに保存されています");
    }
    const valid = validateBeforeWrite(() => parseSettlementRecord(record));
    writeStored(this.store, STORAGE_KEYS.settlements, [...records, valid]);
  }
}

/* ───────── 進行中の対局 ───────── */

export class StorageGameRepository implements GameRepository {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async findCurrent(): Promise<Game | null> {
    const data = readStored(this.store, STORAGE_KEYS.currentGame);
    return data === undefined ? null : parseStored(() => parseGame(data));
  }

  async saveCurrent(game: Game): Promise<void> {
    // 履歴を再生して矛盾がないことを確かめてから保存する
    writeStored(this.store, STORAGE_KEYS.currentGame, validateBeforeWrite(() => parseGame(game)));
  }

  async clearCurrent(): Promise<void> {
    removeStored(this.store, STORAGE_KEYS.currentGame);
  }
}

/* ───────── 結果入力の途中経過 ───────── */

export class StorageResultDraftRepository implements ResultDraftRepository {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async find(gameId: GameId): Promise<ResultDraft | null> {
    const data = readStored(this.store, STORAGE_KEYS.resultDraft);
    if (data === undefined) return null;
    const draft = parseStored(() => parseResultDraft(data));
    return draft.gameId === gameId ? draft : null;
  }

  async save(draft: ResultDraft): Promise<void> {
    writeStored(this.store, STORAGE_KEYS.resultDraft, validateBeforeWrite(() => parseResultDraft(draft)));
  }

  /** 保存されているのが別の対局のデータなら、消さずに残す */
  async clear(gameId: GameId): Promise<void> {
    const data = readStored(this.store, STORAGE_KEYS.resultDraft);
    if (data === undefined) return;
    const draft = parseStored(() => parseResultDraft(data));
    if (draft.gameId === gameId) removeStored(this.store, STORAGE_KEYS.resultDraft);
  }
}

/* ───────── 前回の設定 ───────── */

export class StorageLastGameSetupRepository implements LastGameSetupRepository {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async find(): Promise<LastGameSetup | null> {
    const data = readStored(this.store, STORAGE_KEYS.lastSetup);
    return data === undefined ? null : parseStored(() => parseLastSetup(data));
  }

  async save(setup: LastGameSetup): Promise<void> {
    writeStored(this.store, STORAGE_KEYS.lastSetup, validateBeforeWrite(() => parseLastSetup(setup)));
  }
}
