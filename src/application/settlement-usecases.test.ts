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
  StorageSettlementRecordRepository,
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
  const settlementRecordRepo = new StorageSettlementRecordRepository(store);

  const gameUseCases = new GameUseCasesImpl({
    gameRepo,
    lastSetupRepo: new StorageLastGameSetupRepository(store),
    playerRepo,
    resultDraftRepo,
    clock,
    idGen,
    random: new QueueRandomSource([]),
  });
  const settlementUseCases = new SettlementUseCasesImpl({
    gameRepo,
    resultDraftRepo,
    gameRecordRepo,
    settlementRecordRepo,
    clock,
    idGenerator: idGen,
  });

  async function startAndFinishGame(): Promise<void> {
    await gameUseCases.startGame({
      playerIds: [alice!.id, bob!.id, carol!.id],
      initialDealerId: alice!.id,
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
  }

  await startAndFinishGame();

  return {
    store,
    gameUseCases,
    settlementUseCases,
    gameRecordRepo,
    settlementRecordRepo,
    resultDraftRepo,
    clock,
    alice,
    bob,
    carol,
    startAndFinishGame,
  };
}

describe("getResultSheet / enterResult", () => {
  test("最初は全員未入力（誰も自動入力にはならない）", async () => {
    const { settlementUseCases, alice, bob, carol } = await setup();
    const sheet = await settlementUseCases.getResultSheet();
    expect(sheet.entries.map((e) => [e.playerId, e.kind])).toEqual([
      [alice.id, "Input"],
      [bob.id, "Input"],
      [carol.id, "Input"],
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

  test("残り1人になって自動入力になった人には入力できない", async () => {
    const { settlementUseCases, alice, bob, carol } = await setup();
    await settlementUseCases.enterResult(alice.id, 500);
    await settlementUseCases.enterResult(bob.id, -200);
    // 残るはcarolだけになったので、carolが自動入力になる
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

describe("recordGame", () => {
  test("未完成なら RESULT_INCOMPLETE（対局は残る）", async () => {
    const { settlementUseCases, gameUseCases } = await setup();
    await expectRejects(() => settlementUseCases.recordGame(), "RESULT_INCOMPLETE");
    expect(await gameUseCases.getCurrentGame()).not.toBeNull();
  });

  test("範囲外の値があれば RESULT_INVALID", async () => {
    const { settlementUseCases, alice, bob } = await setup();
    await settlementUseCases.enterResult(alice.id, 5000); // 上限(2000)超え
    await settlementUseCases.enterResult(bob.id, -1000);
    await expectRejects(() => settlementUseCases.recordGame(), "RESULT_INVALID");
  });

  test("未精算のまま、記録を保存し、進行中の対局と入力途中データを消す", async () => {
    const { settlementUseCases, gameUseCases, gameRecordRepo, resultDraftRepo, alice, bob, carol } = await setup();
    await settlementUseCases.enterResult(alice.id, 1000);
    await settlementUseCases.enterResult(bob.id, -400);
    const gameId = (await gameUseCases.getCurrentGame())?.game.id;
    if (!gameId) throw new Error("fixture");

    const record = await settlementUseCases.recordGame();
    expect(record.gameId).toBe(gameId);
    expect(record.settledAt).toBeNull();
    expect(record.results.map((r) => [r.playerId, r.netYen])).toEqual([
      [alice.id, 100],
      [bob.id, -40],
      [carol.id, -60],
    ]);

    expect(await gameUseCases.getCurrentGame()).toBeNull();
    expect(await resultDraftRepo.find(gameId)).toBeNull();
    expect((await gameRecordRepo.findAll()).map((r) => r.gameId)).toEqual([gameId]);
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
    await expectRejects(() => settlementUseCases.recordGame(), "STORAGE_FAILED");
    expect((await gameRecordRepo.findAll()).map((r) => r.gameId)).toEqual([gameId]);
    expect(await gameUseCases.getCurrentGame()).not.toBeNull(); // 対局はまだ残っている

    // 復旧して、もう一度「保存して完了」を押す
    store.shouldFailRemove = () => false;
    const record = await settlementUseCases.recordGame();
    expect(record.gameId).toBe(gameId);

    // 記録は1件のまま。対局と入力途中データは、今度こそ消える
    expect((await gameRecordRepo.findAll()).map((r) => r.gameId)).toEqual([gameId]);
    expect(await gameUseCases.getCurrentGame()).toBeNull();
    expect(await resultDraftRepo.find(gameId)).toBeNull();
  });
});

describe("getPendingSettlement / settleUp", () => {
  test("未精算の対局がなければ、空のプレビューを返す（エラーにしない）", async () => {
    const { settlementUseCases } = await setup();
    const view = await settlementUseCases.getPendingSettlement();
    expect(view.pendingGames).toEqual([]);
    expect(view.balances).toEqual([]);
    expect(view.transfers).toEqual([]);
  });

  test("未精算の対局がなければ settleUp は NO_PENDING_SETTLEMENT", async () => {
    const { settlementUseCases } = await setup();
    await expectRejects(() => settlementUseCases.settleUp(), "NO_PENDING_SETTLEMENT");
  });

  test("1件記録すると、その対局がプレビューに含まれる", async () => {
    const { settlementUseCases, alice, bob, carol } = await setup();
    await settlementUseCases.enterResult(alice.id, 1000);
    await settlementUseCases.enterResult(bob.id, -400);
    const record = await settlementUseCases.recordGame();

    const view = await settlementUseCases.getPendingSettlement();
    expect(view.pendingGames.map((r) => r.gameId)).toEqual([record.gameId]);
    expect(view.balances.map((b) => [b.playerId, b.netYen])).toEqual([
      [alice.id, 100],
      [bob.id, -40],
      [carol.id, -60],
    ]);
    expect(view.transfers.length).toBeGreaterThan(0);
  });

  test("複数対局分をまとめて精算する（参加者が変わっても、参加していない対局は0円扱い）", async () => {
    const { settlementUseCases, gameUseCases, clock, alice, bob, carol } = await setup();
    // 1戦目：Alice, Bob, Carol 全員参加。Alice +100円
    await settlementUseCases.enterResult(alice.id, 1000);
    await settlementUseCases.enterResult(bob.id, -400);
    const g1 = await settlementUseCases.recordGame();

    // 2戦目：Alice, Bob だけの対局（Carolは不参加）。Alice -20円
    clock.set("2026-09-20T11:00:00.000Z");
    await gameUseCases.startGame({
      playerIds: [alice.id, bob.id],
      initialDealerId: alice.id,
      startingChips: 1000,
      totalHands: 2,
      initialBigBlind: 100,
      blindIncreaseEveryHands: 5,
      blindIncreaseAmount: 0,
      yenPerChip: 0.1,
    });
    await gameUseCases.advanceHand();
    await gameUseCases.endPlay();
    await settlementUseCases.enterResult(alice.id, -200);
    const g2 = await settlementUseCases.recordGame();

    // 合算：Alice 100-20=80、Bob -40+20=-20、Carol -60+0=-60（2戦目は不参加なので0円）
    const preview = await settlementUseCases.getPendingSettlement();
    expect(preview.pendingGames.map((r) => r.gameId)).toEqual([g2.gameId, g1.gameId]);
    expect(preview.balances.map((b) => [b.playerId, b.netYen])).toEqual([
      [alice.id, 80],
      [bob.id, -20],
      [carol.id, -60],
    ]);

    clock.set("2026-09-20T12:00:00.000Z");
    const settlement = await settlementUseCases.settleUp();
    expect(settlement.settledAt).toBe("2026-09-20T12:00:00.000Z");
    expect([...settlement.gameIds].sort()).toEqual([g1.gameId, g2.gameId].sort());
    expect(settlement.balances.map((b) => [b.playerId, b.netYen])).toEqual([
      [alice.id, 80],
      [bob.id, -20],
      [carol.id, -60],
    ]);
    expect(settlement.transfers.length).toBeGreaterThan(0);

    // 精算済みになったので、プレビューは再び空になる
    const after = await settlementUseCases.getPendingSettlement();
    expect(after.pendingGames).toEqual([]);
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
