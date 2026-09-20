import { describe, expect, test } from "vitest";
import { HistoryUseCasesImpl } from "./history-usecases";
import { expectDomainError } from "../domain/shared/testing";
import {
  sampleRecord,
  samplePlayers,
  sampleSettlementRecord,
  T0,
  T1,
} from "../infrastructure/storage/test-fixtures";
import { MemoryKeyValueStore } from "../infrastructure/storage/key-value-store";
import {
  StorageGameRecordRepository,
  StoragePlayerRepository,
  StorageSettlementRecordRepository,
} from "../infrastructure/storage/repositories";

async function setup() {
  const store = new MemoryKeyValueStore();
  const gameRecordRepo = new StorageGameRecordRepository(store);
  const playerRepo = new StoragePlayerRepository(store);
  const settlementRecordRepo = new StorageSettlementRecordRepository(store);
  for (const player of samplePlayers()) await playerRepo.save(player);
  await gameRecordRepo.add(sampleRecord("g1", T0));
  await gameRecordRepo.add(sampleRecord("g2", T1));
  const history = new HistoryUseCasesImpl({ gameRecordRepo, playerRepo, settlementRecordRepo });
  return { history, gameRecordRepo, settlementRecordRepo };
}

describe("listRecords / getRecord", () => {
  test("新しい順に並ぶ", async () => {
    const { history } = await setup();
    expect((await history.listRecords()).map((r) => r.gameId)).toEqual(["g2", "g1"]);
  });

  test("IDを指定して1件だけ取れる", async () => {
    const { history } = await setup();
    expect((await history.getRecord("g1")).gameId).toBe("g1");
  });

  test("ない場合は RECORD_NOT_FOUND", async () => {
    const { history } = await setup();
    await expectRejects(() => history.getRecord("zz"), "RECORD_NOT_FOUND");
  });
});

describe("deleteRecord", () => {
  test("削除できる", async () => {
    const { history, gameRecordRepo } = await setup();
    await history.deleteRecord("g1");
    expect((await gameRecordRepo.findAll()).map((r) => r.gameId)).toEqual(["g2"]);
  });

  test("ない場合は RECORD_NOT_FOUND（何も削除しない）", async () => {
    const { history, gameRecordRepo } = await setup();
    await expectRejects(() => history.deleteRecord("zz"), "RECORD_NOT_FOUND");
    expect((await gameRecordRepo.findAll())).toHaveLength(2);
  });
});

describe("getPlayerStats", () => {
  test("記録から通算成績を計算する", async () => {
    const { history } = await setup();
    const stats = await history.getPlayerStats();
    expect(stats.length).toBeGreaterThan(0);
  });
});

describe("listSettlements / getSettlement", () => {
  test("新しい順に並ぶ", async () => {
    const { history, settlementRecordRepo } = await setup();
    await settlementRecordRepo.add(sampleSettlementRecord("s1", T0));
    await settlementRecordRepo.add(sampleSettlementRecord("s2", T1));
    expect((await history.listSettlements()).map((s) => s.id)).toEqual(["s2", "s1"]);
  });

  test("IDを指定して1件だけ取れる", async () => {
    const { history, settlementRecordRepo } = await setup();
    await settlementRecordRepo.add(sampleSettlementRecord("s1", T0));
    expect((await history.getSettlement("s1")).id).toBe("s1");
  });

  test("ない場合は SETTLEMENT_NOT_FOUND", async () => {
    const { history } = await setup();
    await expectRejects(() => history.getSettlement("zz"), "SETTLEMENT_NOT_FOUND");
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
