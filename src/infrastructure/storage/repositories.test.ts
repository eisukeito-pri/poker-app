import { describe, expect, test } from "vitest";
import { chips, gameId, playerId } from "../../domain/shared/constructors";
import { expectDomainError } from "../../domain/shared/testing";
import { MemoryKeyValueStore } from "./key-value-store";
import {
  StorageGameRecordRepository,
  StorageGameRepository,
  StorageLastGameSetupRepository,
  StoragePlayerRepository,
  StorageResultDraftRepository,
  StorageSettlementRecordRepository,
} from "./repositories";
import { STORAGE_KEYS } from "./storage-io";
import {
  finishedGame,
  newGameFixture,
  sampleBackup,
  samplePlayers,
  sampleRecord,
  sampleSettlementRecord,
  T0,
  T1,
} from "./test-fixtures";
import { settlementId } from "../../domain/shared/constructors";

describe("StoragePlayerRepository", () => {
  test("未保存なら空。保存した順に並び、同じIDは置き換える", async () => {
    const store = new MemoryKeyValueStore();
    const repo = new StoragePlayerRepository(store);
    expect(await repo.findAll()).toEqual([]);

    const [alice, bob, carol] = samplePlayers();
    if (!alice || !bob || !carol) throw new Error("fixture");
    await repo.save(alice);
    await repo.save(bob);
    await repo.save(carol);
    await repo.save({ ...bob, name: "Bobby" });
    expect((await repo.findAll()).map((p) => p.name)).toEqual(["Alice", "Bobby", "Carol"]);
  });

  test("別のインスタンスからも読める（再読み込みで復元される）", async () => {
    const store = new MemoryKeyValueStore();
    const [alice] = samplePlayers();
    if (!alice) throw new Error("fixture");
    await new StoragePlayerRepository(store).save(alice);
    expect(await new StoragePlayerRepository(store).findAll()).toEqual([alice]);
  });

  test("削除。いない人を消してもエラーにならない", async () => {
    const repo = new StoragePlayerRepository(new MemoryKeyValueStore());
    const [alice, bob] = samplePlayers();
    if (!alice || !bob) throw new Error("fixture");
    await repo.save(alice);
    await repo.save(bob);
    await repo.remove(alice.id);
    await repo.remove(playerId("zz"));
    expect((await repo.findAll()).map((p) => p.name)).toEqual(["Bob"]);
  });

  test("壊れた保存データは STORAGE_CORRUPTED（黙って空にしない）", async () => {
    const store = new MemoryKeyValueStore();
    store.setItem(STORAGE_KEYS.players, "{not json");
    const repo = new StoragePlayerRepository(store);
    await expectRejects(() => repo.findAll(), "STORAGE_CORRUPTED");

    store.setItem(STORAGE_KEYS.players, JSON.stringify({ schemaVersion: 99, data: [] }));
    await expectRejects(() => repo.findAll(), "STORAGE_CORRUPTED");

    store.setItem(STORAGE_KEYS.players, JSON.stringify({ schemaVersion: 1, data: [{ id: 1 }] }));
    await expectRejects(() => repo.findAll(), "STORAGE_CORRUPTED");
  });

  test("書き込みに失敗したら STORAGE_FAILED で、データは変わらない", async () => {
    const store = new MemoryKeyValueStore();
    const repo = new StoragePlayerRepository(store);
    const [alice, bob] = samplePlayers();
    if (!alice || !bob) throw new Error("fixture");
    await repo.save(alice);
    store.shouldFailWrite = () => true;
    await expectRejects(() => repo.save(bob), "STORAGE_FAILED");
    store.shouldFailWrite = () => false;
    expect(await repo.findAll()).toEqual([alice]);
  });
});

describe("StorageGameRecordRepository", () => {
  test("新しい順に返す。同じ対局の記録は追加できない", async () => {
    const repo = new StorageGameRecordRepository(new MemoryKeyValueStore());
    await repo.add(sampleRecord("g1", T0));
    await repo.add(sampleRecord("g2", T1));
    expect((await repo.findAll()).map((r) => r.gameId)).toEqual(["g2", "g1"]);
    await expectRejects(() => repo.add(sampleRecord("g1", T0)), "DUPLICATE_RECORD");
  });

  test("削除できる", async () => {
    const repo = new StorageGameRecordRepository(new MemoryKeyValueStore());
    await repo.add(sampleRecord("g1", T0));
    await repo.add(sampleRecord("g2", T1));
    await repo.remove(gameId("g2"));
    expect((await repo.findAll()).map((r) => r.gameId)).toEqual(["g1"]);
  });

  test("内容が不正な記録は保存しない（STORAGE_FAILED）", async () => {
    const store = new MemoryKeyValueStore();
    const repo = new StorageGameRecordRepository(store);
    await repo.add(sampleRecord("g1", T0));
    const broken = { ...sampleRecord("g2", T1), handsPlayed: 99 };
    await expectRejects(() => repo.add(broken), "STORAGE_FAILED");
    expect((await repo.findAll()).map((r) => r.gameId)).toEqual(["g1"]);
  });

  test("markSettled：指定したIDだけ settledAt を設定する。存在しないIDは無視する", async () => {
    const repo = new StorageGameRecordRepository(new MemoryKeyValueStore());
    await repo.add(sampleRecord("g1", T0));
    await repo.add(sampleRecord("g2", T1));
    expect((await repo.findAll()).every((r) => r.settledAt === null)).toBe(true);

    await repo.markSettled([gameId("g1"), gameId("zz")], "2026-09-20T12:00:00.000Z");
    const records = await repo.findAll();
    expect(records.find((r) => r.gameId === "g1")?.settledAt).toBe("2026-09-20T12:00:00.000Z");
    expect(records.find((r) => r.gameId === "g2")?.settledAt).toBeNull();
  });
});

describe("StorageSettlementRecordRepository", () => {
  test("新しい順ではなく、追加順に返す。findで1件だけ取れる", async () => {
    const repo = new StorageSettlementRecordRepository(new MemoryKeyValueStore());
    expect(await repo.findAll()).toEqual([]);
    await repo.add(sampleSettlementRecord("s1", T0));
    await repo.add(sampleSettlementRecord("s2", T1));
    expect((await repo.findAll()).map((r) => r.id)).toEqual(["s1", "s2"]);
    expect((await repo.find(settlementId("s1")))?.id).toBe("s1");
    expect(await repo.find(settlementId("zz"))).toBeNull();
  });

  test("同じIDの精算記録は追加できない", async () => {
    const repo = new StorageSettlementRecordRepository(new MemoryKeyValueStore());
    await repo.add(sampleSettlementRecord("s1", T0));
    await expectRejects(() => repo.add(sampleSettlementRecord("s1", T1)), "DUPLICATE_RECORD");
  });

  test("内容が不正な精算記録は保存しない（STORAGE_FAILED）", async () => {
    const store = new MemoryKeyValueStore();
    const repo = new StorageSettlementRecordRepository(store);
    const broken = { ...sampleSettlementRecord("s1", T0), gameIds: [] };
    await expectRejects(() => repo.add(broken), "STORAGE_FAILED");
    expect(await repo.findAll()).toEqual([]);
  });
});

describe("StorageGameRepository", () => {
  test("進行中の対局の保存・復元・削除", async () => {
    const repo = new StorageGameRepository(new MemoryKeyValueStore());
    expect(await repo.findCurrent()).toBeNull();
    const game = finishedGame("g1");
    await repo.saveCurrent(game);
    expect(await repo.findCurrent()).toEqual(game);
    await repo.clearCurrent();
    expect(await repo.findCurrent()).toBeNull();
  });

  test("履歴が矛盾した対局は保存しない", async () => {
    const repo = new StorageGameRepository(new MemoryKeyValueStore());
    const game = newGameFixture();
    const broken = {
      ...game,
      events: [{ type: "PlayerEliminated" as const, playerId: playerId("Z"), at: T0 }],
    };
    await expectRejects(() => repo.saveCurrent(broken), "STORAGE_FAILED");
    expect(await repo.findCurrent()).toBeNull();
  });
});

describe("StorageResultDraftRepository", () => {
  const draft = { gameId: gameId("g1"), inputs: [{ playerId: playerId("A"), netChips: chips(100) }] };

  test("保存・復元。別の対局のものは見えない", async () => {
    const repo = new StorageResultDraftRepository(new MemoryKeyValueStore());
    expect(await repo.find(gameId("g1"))).toBeNull();
    await repo.save(draft);
    expect(await repo.find(gameId("g1"))).toEqual(draft);
    expect(await repo.find(gameId("other"))).toBeNull();
  });

  test("clearは、その対局のデータだけを消す", async () => {
    const repo = new StorageResultDraftRepository(new MemoryKeyValueStore());
    await repo.save(draft);
    await repo.clear(gameId("other"));
    expect(await repo.find(gameId("g1"))).toEqual(draft);
    await repo.clear(gameId("g1"));
    expect(await repo.find(gameId("g1"))).toBeNull();
  });
});

describe("StorageLastGameSetupRepository", () => {
  test("前回の設定の保存・復元。上書きされる", async () => {
    const repo = new StorageLastGameSetupRepository(new MemoryKeyValueStore());
    expect(await repo.find()).toBeNull();
    const setup = sampleBackup().lastSetup;
    if (!setup) throw new Error("fixture");
    await repo.save(setup);
    expect(await repo.find()).toEqual(setup);
    const changed = { ...setup, seatOrder: [playerId("C"), playerId("A")] };
    await repo.save(changed);
    expect(await repo.find()).toEqual(changed);
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
