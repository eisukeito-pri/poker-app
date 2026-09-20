import { describe, expect, test } from "vitest";
import { GameUseCasesImpl } from "./game-usecases";
import { SettlementUseCasesImpl } from "./settlement-usecases";
import { FixedClock, QueueRandomSource, SequentialIdGenerator } from "./testing";
import { registerPlayer } from "../domain/roster/roster";
import type { Player } from "../domain/roster/types";
import { expectDomainError } from "../domain/shared/testing";
import { MemoryKeyValueStore } from "../infrastructure/storage/key-value-store";
import {
  StorageGameRecordRepository,
  StorageGameRepository,
  StorageLastGameSetupRepository,
  StoragePlayerRepository,
  StorageResultDraftRepository,
} from "../infrastructure/storage/repositories";
import { STORAGE_KEYS } from "../infrastructure/storage/storage-io";

const T0 = "2026-09-20T10:00:00.000Z";

async function setup() {
  const store = new MemoryKeyValueStore();
  const playerRepo = new StoragePlayerRepository(store);
  const clock = new FixedClock(T0);
  const idGen = new SequentialIdGenerator();

  let players: readonly Player[] = [];
  for (const name of ["Alice", "Bob", "Carol"]) {
    const { players: next, player } = registerPlayer(players, { id: idGen.newPlayerId(), name, now: T0 });
    players = next;
    await playerRepo.save(player);
  }
  const [alice, bob, carol] = players;
  if (!alice || !bob || !carol) throw new Error("fixture");

  const gameRepo = new StorageGameRepository(store);
  const resultDraftRepo = new StorageResultDraftRepository(store);
  const gameRecordRepo = new StorageGameRecordRepository(store);

  const gameUseCases = new GameUseCasesImpl({
    gameRepo,
    lastSetupRepo: new StorageLastGameSetupRepository(store),
    playerRepo,
    resultDraftRepo,
    clock,
    idGen,
    random: new QueueRandomSource([]),
  });
  const settlementUseCases = new SettlementUseCasesImpl({ gameRepo, resultDraftRepo, gameRecordRepo });

  await gameUseCases.startGame({
    playerIds: [alice.id, bob.id, carol.id],
    initialDealerId: alice.id,
    startingChips: 1000,
    totalHands: 2,
    initialBigBlind: 100,
    blindIncreaseEveryHands: 5,
    blindIncreaseAmount: 0,
    yenPerChip: 0.1,
  });
  await gameUseCases.advanceHand();
  const view = await gameUseCases.endPlay(); // 結果入力待ちに
  if (view.state.phase !== "ResultPending") throw new Error("fixture");

  return { store, gameUseCases, settlementUseCases, gameRecordRepo, resultDraftRepo, alice, bob, carol };
}

describe("getResultSheet / enterResult", () => {
  test("最初は全員未入力（最後の一人は自動入力欄）", async () => {
    const { settlementUseCases, alice, bob, carol } = await setup();
    const sheet = await settlementUseCases.getResultSheet();
    expect(sheet.entries.map((e) => [e.playerId, e.kind])).toEqual([
      [alice.id, "Input"],
      [bob.id, "Input"],
      [carol.id, "AutoFilled"],
    ]);
    expect(sheet.isComplete).toBe(false);
  });

  test("入力すると保存され、再取得しても残っている", async () => {
    const { settlementUseCases, alice, bob, carol } = await setup();
    await settlementUseCases.enterResult(alice.id, 500);
    const sheet = await settlementUseCases.enterResult(bob.id, -200);
    expect(sheet.entries.find((e) => e.playerId === carol.id)?.netChips).toBe(-300);

    const reloaded = await settlementUseCases.getResultSheet();
    expect(reloaded.entries.find((e) => e.playerId === alice.id)?.netChips).toBe(500);
    expect(reloaded.isComplete).toBe(true);
  });

  test("nullで入力を消せる", async () => {
    const { settlementUseCases, alice } = await setup();
    await settlementUseCases.enterResult(alice.id, 500);
    const sheet = await settlementUseCases.enterResult(alice.id, null);
    expect(sheet.entries.find((e) => e.playerId === alice.id)?.netChips).toBeNull();
  });

  test("自動入力の人には入力できない", async () => {
    const { settlementUseCases, carol } = await setup();
    await expectRejects(() => settlementUseCases.enterResult(carol.id, 100), "RESULT_INVALID");
  });

  test("結果入力に進んでいなければ拒否する", async () => {
    const { gameUseCases, settlementUseCases, alice, bob, carol } = await setup();
    await gameUseCases.undo(); // 対局に戻る
    await expectRejects(() => settlementUseCases.getResultSheet(), "NOT_RESULT_PENDING");
    await expectRejects(() => settlementUseCases.enterResult(alice.id, 100), "NOT_RESULT_PENDING");
    void bob;
    void carol;
  });
});

describe("previewSettlement", () => {
  test("未完成なら RESULT_INCOMPLETE", async () => {
    const { settlementUseCases } = await setup();
    await expectRejects(() => settlementUseCases.previewSettlement(), "RESULT_INCOMPLETE");
  });

  test("範囲外の値があれば RESULT_INVALID", async () => {
    const { settlementUseCases, alice, bob } = await setup();
    await settlementUseCases.enterResult(alice.id, 5000); // 上限(2000)超え
    await settlementUseCases.enterResult(bob.id, -1000);
    await expectRejects(() => settlementUseCases.previewSettlement(), "RESULT_INVALID");
  });

  test("完成していれば、換算と送金リストを返す", async () => {
    const { settlementUseCases, alice, bob, carol } = await setup();
    await settlementUseCases.enterResult(alice.id, 1000);
    await settlementUseCases.enterResult(bob.id, -400);
    const settlement = await settlementUseCases.previewSettlement();
    expect(settlement.results.map((r) => [r.playerId, r.netYen])).toEqual([
      [alice.id, 100],
      [bob.id, -40],
      [carol.id, -60],
    ]);
    expect(settlement.transfers.length).toBeGreaterThan(0);
  });
});

describe("finalizeGame", () => {
  test("記録を保存し、進行中の対局と入力途中データを消す", async () => {
    const { settlementUseCases, gameUseCases, gameRecordRepo, resultDraftRepo, alice, bob, carol } = await setup();
    await settlementUseCases.enterResult(alice.id, 1000);
    await settlementUseCases.enterResult(bob.id, -400);
    const gameId = (await gameUseCases.getCurrentGame())?.game.id;
    if (!gameId) throw new Error("fixture");

    const record = await settlementUseCases.finalizeGame();
    expect(record.gameId).toBe(gameId);
    expect(record.results.map((r) => r.playerId)).toEqual([alice.id, bob.id, carol.id]);

    expect(await gameUseCases.getCurrentGame()).toBeNull();
    expect(await resultDraftRepo.find(gameId)).toBeNull();
    expect((await gameRecordRepo.findAll()).map((r) => r.gameId)).toEqual([gameId]);
  });

  test("未完成のまま保存しようとすると拒否する（対局は残る）", async () => {
    const { settlementUseCases, gameUseCases } = await setup();
    await expectRejects(() => settlementUseCases.finalizeGame(), "RESULT_INCOMPLETE");
    expect(await gameUseCases.getCurrentGame()).not.toBeNull();
  });

  test("記録の保存後、後片付け（対局の削除）が失敗しても、再試行すれば二重に保存されず完了する", async () => {
    const { store, settlementUseCases, gameUseCases, gameRecordRepo, resultDraftRepo, alice, bob } =
      await setup();
    await settlementUseCases.enterResult(alice.id, 1000);
    await settlementUseCases.enterResult(bob.id, -400);
    const gameId = (await gameUseCases.getCurrentGame())?.game.id;
    if (!gameId) throw new Error("fixture");

    // 記録の保存は成功するが、そのあとの「進行中の対局を消す」段階で失敗する状況を再現する
    store.shouldFailRemove = (key) => key === STORAGE_KEYS.currentGame;
    await expectRejects(() => settlementUseCases.finalizeGame(), "STORAGE_FAILED");
    expect((await gameRecordRepo.findAll()).map((r) => r.gameId)).toEqual([gameId]);
    expect(await gameUseCases.getCurrentGame()).not.toBeNull(); // 対局はまだ残っている

    // 復旧して、もう一度「保存して完了」を押す
    store.shouldFailRemove = () => false;
    const record = await settlementUseCases.finalizeGame();
    expect(record.gameId).toBe(gameId);

    // 記録は1件のまま。対局と入力途中データは、今度こそ消える
    expect((await gameRecordRepo.findAll()).map((r) => r.gameId)).toEqual([gameId]);
    expect(await gameUseCases.getCurrentGame()).toBeNull();
    expect(await resultDraftRepo.find(gameId)).toBeNull();
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
