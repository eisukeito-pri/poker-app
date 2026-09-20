import { describe, expect, test } from "vitest";
import { expectDomainError } from "../../domain/shared/testing";
import { AppDataStore, backupFileName, parseBackup, serializeBackup } from "./backup";
import { MemoryKeyValueStore } from "./key-value-store";
import {
  StorageGameRecordRepository,
  StorageGameRepository,
  StorageLastGameSetupRepository,
  StoragePlayerRepository,
  StorageResultDraftRepository,
  StorageSettlementRecordRepository,
} from "./repositories";
import { ALL_STORAGE_KEYS, STORAGE_KEYS } from "./storage-io";
import { edit, sampleBackup, sampleRecord, viaJson } from "./test-fixtures";

const NOW = "2026-09-22T00:00:00.000Z";

/** サンプルの全データを、リポジトリ経由で保存済みのストアを作る */
async function populatedStore(): Promise<MemoryKeyValueStore> {
  const store = new MemoryKeyValueStore();
  const data = sampleBackup();
  const players = new StoragePlayerRepository(store);
  for (const player of data.players) await players.save(player);
  const records = new StorageGameRecordRepository(store);
  for (const record of data.records) await records.add(record);
  const settlements = new StorageSettlementRecordRepository(store);
  for (const settlement of data.settlements) await settlements.add(settlement);
  if (data.currentGame) await new StorageGameRepository(store).saveCurrent(data.currentGame);
  if (data.resultDraft) await new StorageResultDraftRepository(store).save(data.resultDraft);
  if (data.lastSetup) await new StorageLastGameSetupRepository(store).save(data.lastSetup);
  return store;
}

function snapshot(store: MemoryKeyValueStore): Record<string, string | null> {
  return Object.fromEntries(ALL_STORAGE_KEYS.map((key) => [key, store.getItem(key)]));
}

describe("書き出しと読み込みの検証", () => {
  test("書き出した内容を、そのまま読み込める", () => {
    const data = sampleBackup();
    expect(parseBackup(serializeBackup(data))).toEqual(data);
  });

  test("ファイル名は日付入り", () => {
    expect(backupFileName("2026-09-20T10:11:12.000Z")).toBe("poker-backup-2026-09-20.json");
  });

  test("JSONでないファイル・形の違うファイルは INVALID_BACKUP", () => {
    expectDomainError(() => parseBackup("これはバックアップではありません"), "INVALID_BACKUP");
    expectDomainError(() => parseBackup("[]"), "INVALID_BACKUP");
    expectDomainError(() => parseBackup(JSON.stringify({ hello: "world" })), "INVALID_BACKUP");
    expectDomainError(
      () => parseBackup(JSON.stringify(edit(sampleBackup(), (d) => { d.records[0].results[0].netYen += 5; }))),
      "INVALID_BACKUP",
    );
  });

  test("新しいバージョンのファイルは UNSUPPORTED_BACKUP_VERSION", () => {
    expectDomainError(
      () => parseBackup(JSON.stringify(edit(sampleBackup(), (d) => { d.schemaVersion = 2; }))),
      "UNSUPPORTED_BACKUP_VERSION",
    );
  });
});

describe("AppDataStore.createBackup", () => {
  test("全データからバックアップを作る（保存内容と一致する）", async () => {
    const backup = new AppDataStore(await populatedStore()).createBackup(NOW);
    const expected = sampleBackup(NOW);
    expect(backup.players).toEqual(expected.players);
    expect(backup.records.map((r) => r.gameId).sort()).toEqual(["g1", "g2"]);
    expect(backup.settlements.map((s) => s.id)).toEqual(expected.settlements.map((s) => s.id));
    expect(backup.currentGame).toEqual(expected.currentGame);
    expect(backup.resultDraft).toEqual(expected.resultDraft);
    expect(backup.lastSetup).toEqual(expected.lastSetup);
    expect(backup.exportedAt).toBe(NOW);
  });

  test("何も保存されていなくても作れる", () => {
    const backup = new AppDataStore(new MemoryKeyValueStore()).createBackup(NOW);
    expect(backup).toEqual({
      schemaVersion: 1,
      exportedAt: NOW,
      players: [],
      records: [],
      settlements: [],
      currentGame: null,
      resultDraft: null,
      lastSetup: null,
    });
  });

  test("別の対局の入力途中データは含めない", async () => {
    const store = await populatedStore();
    await new StorageResultDraftRepository(store).save({ gameId: "other" as never, inputs: [] });
    expect(new AppDataStore(store).createBackup(NOW).resultDraft).toBeNull();
  });

  test("壊れたデータがあれば STORAGE_CORRUPTED", async () => {
    const store = await populatedStore();
    store.setItem(STORAGE_KEYS.records, "壊れている");
    expectDomainError(() => new AppDataStore(store).createBackup(NOW), "STORAGE_CORRUPTED");
  });
});

describe("AppDataStore.restore（置き換え）", () => {
  test("バックアップの内容で、今のデータをすべて置き換える", async () => {
    const store = new MemoryKeyValueStore();
    const old = new StorageGameRecordRepository(store);
    await old.add(sampleRecord("old", "2026-01-01T00:00:00.000Z"));
    await new StorageGameRepository(store).saveCurrent(sampleBackup().currentGame ?? (undefined as never));

    // 進行中の対局・入力途中データ・前回の設定がないバックアップ
    const incoming = { ...sampleBackup(), currentGame: null, resultDraft: null, lastSetup: null };
    new AppDataStore(store).restore(viaJson(incoming));

    expect((await new StorageGameRecordRepository(store).findAll()).map((r) => r.gameId)).toEqual(["g2", "g1"]);
    expect((await new StorageSettlementRecordRepository(store).findAll()).map((s) => s.id)).toEqual(["s1"]);
    expect(await new StorageGameRepository(store).findCurrent()).toBeNull();
    expect(store.getItem(STORAGE_KEYS.currentGame)).toBeNull();
    expect((await new StoragePlayerRepository(store).findAll()).map((p) => p.name)).toEqual(["Alice", "Bob", "Carol"]);
  });

  test("復元してから作ったバックアップは、元と同じ内容になる", async () => {
    const source = new AppDataStore(await populatedStore()).createBackup(NOW);
    const target = new MemoryKeyValueStore();
    const appData = new AppDataStore(target);
    appData.restore(viaJson(source));
    expect(appData.createBackup(NOW)).toEqual(source);
  });

  test("不正なバックアップは、何も変えずに INVALID_BACKUP", async () => {
    const store = await populatedStore();
    const before = snapshot(store);
    expectDomainError(
      () => new AppDataStore(store).restore(edit(sampleBackup(), (d) => { d.records[0].transfers[0].amount += 1; })),
      "INVALID_BACKUP",
    );
    expectDomainError(() => new AppDataStore(store).restore("ぜんぜん違う"), "INVALID_BACKUP");
    expectDomainError(
      () => new AppDataStore(store).restore(edit(sampleBackup(), (d) => { d.schemaVersion = 5; })),
      "UNSUPPORTED_BACKUP_VERSION",
    );
    expect(snapshot(store)).toEqual(before);
  });

  test("書き込みの途中で失敗したら、元のデータに戻す", async () => {
    const store = await populatedStore();
    const before = snapshot(store);
    // 名簿は書けるが、記録の書き込みで失敗する
    store.shouldFailWrite = (key) => key === STORAGE_KEYS.records;
    const incoming = viaJson({ ...sampleBackup(), players: [], lastSetup: null });
    expectDomainError(() => new AppDataStore(store).restore(incoming), "STORAGE_FAILED");
    store.shouldFailWrite = () => false;
    expect(snapshot(store)).toEqual(before);
  });
});

describe("AppDataStore.wipe", () => {
  test("全データを削除する", async () => {
    const store = await populatedStore();
    new AppDataStore(store).wipe();
    expect(store.keys()).toEqual([]);
    expect(new AppDataStore(store).createBackup(NOW).records).toEqual([]);
  });
});
