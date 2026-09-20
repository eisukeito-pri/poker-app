/**
 * バックアップ（.jsonファイル）の書き出し・検証・読み込みと、全データの操作。
 *
 * - 読み込みは「置き換え」方式：今のデータをすべて入れ替える（確認ダイアログはUI側）
 * - 不正なファイルや、新しいバージョンのファイルは、何も変えずにエラーにする
 * - 置き換えの途中で失敗したら、元の状態に戻す
 */
import type { BackupData } from "../../application/types";
import { DomainError } from "../../domain/shared/errors";
import type { IsoDateTime } from "../../domain/shared/types";
import type { KeyValueStore } from "./key-value-store";
import { CURRENT_SCHEMA_VERSION, parseBackupData, SchemaError } from "./parsers";
import {
  ALL_STORAGE_KEYS,
  readStored,
  removeStored,
  serializeStored,
  STORAGE_KEYS,
} from "./storage-io";
import {
  parseGame,
  parseGameRecords,
  parseLastSetup,
  parsePlayers,
  parseResultDraft,
  parseSettlementRecords,
} from "./parsers";

export function serializeBackup(data: BackupData): string {
  return JSON.stringify(data, null, 2);
}

/** 例：poker-backup-2026-09-20.json */
export function backupFileName(now: IsoDateTime): string {
  return `poker-backup-${now.slice(0, 10)}.json`;
}

function toBackupError(error: unknown): DomainError {
  if (error instanceof SchemaError) {
    return error.kind === "unsupported-version"
      ? new DomainError(
          "UNSUPPORTED_BACKUP_VERSION",
          "新しいバージョンのアプリで作られたバックアップです。アプリを更新してから読み込んでください",
        )
      : new DomainError("INVALID_BACKUP", `バックアップの内容が正しくありません（${error.message}）`);
  }
  return error instanceof DomainError ? error : new DomainError("INVALID_BACKUP", "バックアップを読み込めませんでした");
}

/** ファイルの内容（文字列）を検証して、バックアップデータにする */
export function parseBackup(text: string): BackupData {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DomainError("INVALID_BACKUP", "バックアップファイルを読み込めません（JSONの形式ではありません）");
  }
  try {
    return parseBackupData(json);
  } catch (error) {
    throw toBackupError(error);
  }
}

/** アプリの全データをまとめて扱う */
export class AppDataStore {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  /** 現在の全データからバックアップを作る（壊れたデータがあれば STORAGE_CORRUPTED） */
  createBackup(now: IsoDateTime): BackupData {
    const read = (key: string) => readStored(this.store, key);
    const players = read(STORAGE_KEYS.players);
    const records = read(STORAGE_KEYS.records);
    const settlements = read(STORAGE_KEYS.settlements);
    const currentGame = read(STORAGE_KEYS.currentGame);
    const resultDraft = read(STORAGE_KEYS.resultDraft);
    const lastSetup = read(STORAGE_KEYS.lastSetup);

    try {
      const game = currentGame === undefined ? null : parseGame(currentGame);
      const draft = resultDraft === undefined ? null : parseResultDraft(resultDraft);
      return parseBackupData({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        exportedAt: now,
        players: players === undefined ? [] : parsePlayers(players),
        records: records === undefined ? [] : parseGameRecords(records),
        settlements: settlements === undefined ? [] : parseSettlementRecords(settlements),
        currentGame: game,
        // 別の対局の入力途中データは含めない
        resultDraft: draft && game && draft.gameId === game.id ? draft : null,
        lastSetup: lastSetup === undefined ? null : parseLastSetup(lastSetup),
      });
    } catch (error) {
      if (error instanceof SchemaError) {
        throw new DomainError("STORAGE_CORRUPTED", `保存データが壊れています: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * バックアップの内容で、今のデータをすべて置き換える。
   * 検証に通らなければ何も変えない。書き込みに失敗したら元に戻す。
   */
  restore(data: unknown): void {
    let valid: BackupData;
    try {
      valid = parseBackupData(data);
    } catch (error) {
      throw toBackupError(error);
    }

    const next: [string, string | null][] = [
      [STORAGE_KEYS.players, serializeStored(valid.players)],
      [STORAGE_KEYS.records, serializeStored(valid.records)],
      [STORAGE_KEYS.settlements, serializeStored(valid.settlements)],
      [STORAGE_KEYS.currentGame, valid.currentGame ? serializeStored(valid.currentGame) : null],
      [STORAGE_KEYS.resultDraft, valid.resultDraft ? serializeStored(valid.resultDraft) : null],
      [STORAGE_KEYS.lastSetup, valid.lastSetup ? serializeStored(valid.lastSetup) : null],
    ];

    const previous = new Map<string, string | null>();
    try {
      for (const key of ALL_STORAGE_KEYS) previous.set(key, this.store.getItem(key));
    } catch {
      throw new DomainError("STORAGE_FAILED", "保存データを読み込めませんでした");
    }

    try {
      for (const [key, value] of next) {
        if (value === null) this.store.removeItem(key);
        else this.store.setItem(key, value);
      }
    } catch {
      this.rollback(previous);
      throw new DomainError(
        "STORAGE_FAILED",
        "保存できませんでした。元のデータはそのままです（端末の容量がいっぱいの可能性があります）",
      );
    }
  }

  /** 全データを削除する（確認ダイアログはUI側） */
  wipe(): void {
    for (const key of ALL_STORAGE_KEYS) removeStored(this.store, key);
  }

  private rollback(previous: ReadonlyMap<string, string | null>): void {
    for (const [key, value] of previous) {
      try {
        if (value === null) this.store.removeItem(key);
        else this.store.setItem(key, value);
      } catch {
        // 元に戻せなかったキーがあっても、残りは続けて戻す
      }
    }
  }
}
