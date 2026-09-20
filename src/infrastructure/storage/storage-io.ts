/**
 * 保存データの読み書きの共通部分。
 * 各キーには {"schemaVersion": 1, "data": ...} の形（エンベロープ）で保存する。
 */
import { DomainError } from "../../domain/shared/errors";
import type { KeyValueStore } from "./key-value-store";
import { CURRENT_SCHEMA_VERSION, SchemaError } from "./parsers";

export const STORAGE_KEYS = {
  players: "poker.players",
  records: "poker.records",
  settlements: "poker.settlements",
  currentGame: "poker.currentGame",
  resultDraft: "poker.resultDraft",
  lastSetup: "poker.lastSetup",
} as const;

export const ALL_STORAGE_KEYS: readonly string[] = Object.values(STORAGE_KEYS);

/** 保存されている data を返す。未保存なら undefined */
export function readStored(store: KeyValueStore, key: string): unknown {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    throw new DomainError("STORAGE_FAILED", "保存データを読み込めませんでした");
  }
  if (raw === null) return undefined;

  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new DomainError("STORAGE_CORRUPTED", `保存データが壊れています（${key}）`);
  }
  const isEnvelope =
    typeof envelope === "object" &&
    envelope !== null &&
    (envelope as Record<string, unknown>).schemaVersion === CURRENT_SCHEMA_VERSION &&
    "data" in envelope;
  if (!isEnvelope) {
    throw new DomainError("STORAGE_CORRUPTED", `保存データの形式が違います（${key}）`);
  }
  return (envelope as Record<string, unknown>).data;
}

export function serializeStored(data: unknown): string {
  return JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, data });
}

export function writeStored(store: KeyValueStore, key: string, data: unknown): void {
  try {
    store.setItem(key, serializeStored(data));
  } catch {
    throw new DomainError(
      "STORAGE_FAILED",
      "保存できませんでした（端末の容量がいっぱいの可能性があります）",
    );
  }
}

export function removeStored(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    throw new DomainError("STORAGE_FAILED", "保存データを削除できませんでした");
  }
}

/** 読み込んだデータの検証。壊れていれば STORAGE_CORRUPTED */
export function parseStored<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof SchemaError) {
      throw new DomainError("STORAGE_CORRUPTED", `保存データが壊れています: ${error.message}`);
    }
    throw error;
  }
}

/** 書き込み前のデータの検証。不正なら STORAGE_FAILED（アプリ側の不具合を早く見つけるため） */
export function validateBeforeWrite<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof SchemaError) {
      throw new DomainError("STORAGE_FAILED", `保存しようとしたデータが不正です: ${error.message}`);
    }
    throw error;
  }
}
