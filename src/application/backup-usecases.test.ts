import { describe, expect, test } from "vitest";
import { BackupUseCasesImpl } from "./backup-usecases";
import { FixedClock } from "./testing";
import { expectDomainError } from "../domain/shared/testing";
import { AppDataStore, backupFileName, parseBackup, serializeBackup } from "../infrastructure/storage/backup";
import { MemoryKeyValueStore } from "../infrastructure/storage/key-value-store";
import { StoragePlayerRepository } from "../infrastructure/storage/repositories";
import { samplePlayers } from "../infrastructure/storage/test-fixtures";

const NOW = "2026-09-22T00:00:00.000Z";

function setup() {
  const store = new MemoryKeyValueStore();
  const storage = new AppDataStore(store);
  const backup = new BackupUseCasesImpl({
    storage,
    codec: { serialize: serializeBackup, parse: parseBackup, fileName: backupFileName },
    clock: new FixedClock(NOW),
  });
  return { store, backup };
}

describe("exportBackup", () => {
  test("ファイル名と内容を返す", async () => {
    const { backup } = setup();
    const file = await backup.exportBackup();
    expect(file.fileName).toBe("poker-backup-2026-09-22.json");
    expect(JSON.parse(file.content).exportedAt).toBe(NOW);
  });
});

describe("importBackup", () => {
  test("書き出したものを読み込むと、同じ内容になる", async () => {
    const { store, backup } = setup();
    const playerRepo = new StoragePlayerRepository(store);
    for (const player of samplePlayers()) await playerRepo.save(player);

    const file = await backup.exportBackup();
    const otherStore = new MemoryKeyValueStore();
    const otherBackup = new BackupUseCasesImpl({
      storage: new AppDataStore(otherStore),
      codec: { serialize: serializeBackup, parse: parseBackup, fileName: backupFileName },
      clock: new FixedClock(NOW),
    });
    await otherBackup.importBackup(file.content);
    expect(await new StoragePlayerRepository(otherStore).findAll()).toEqual(samplePlayers());
  });

  test("不正な内容は拒否する", async () => {
    const { backup } = setup();
    await expectRejects(() => backup.importBackup("not json"), "INVALID_BACKUP");
  });
});

describe("wipeAllData", () => {
  test("全データを消す", async () => {
    const { store, backup } = setup();
    const playerRepo = new StoragePlayerRepository(store);
    await playerRepo.save((await new StoragePlayerRepository(store).findAll())[0] ?? samplePlayers()[0]!);
    await backup.wipeAllData();
    expect(await playerRepo.findAll()).toEqual([]);
  });
});

async function expectRejects(fn: () => Promise<unknown>, code: Parameters<typeof expectDomainError>[1]): Promise<void> {
  let rejected: unknown;
  try {
    await fn();
  } catch (error) {
    rejected = error;
  }
  if (rejected === undefined) throw new Error(`DomainError(${code}) が投げられませんでした`);
  expectDomainError(() => {
    throw rejected;
  }, code);
}
