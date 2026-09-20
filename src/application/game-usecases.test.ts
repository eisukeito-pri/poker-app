import { describe, expect, test } from "vitest";
import { DEFAULT_SETUP, GameUseCasesImpl } from "./game-usecases";
import { FixedClock, QueueRandomSource, SequentialIdGenerator } from "./testing";
import { registerPlayer } from "../domain/roster/roster";
import type { Player } from "../domain/roster/types";
import { expectDomainError } from "../domain/shared/testing";
import { MemoryKeyValueStore } from "../infrastructure/storage/key-value-store";
import {
  StorageGameRepository,
  StorageLastGameSetupRepository,
  StoragePlayerRepository,
  StorageResultDraftRepository,
} from "../infrastructure/storage/repositories";

const T0 = "2026-09-20T10:00:00.000Z";

async function setup() {
  const store = new MemoryKeyValueStore();
  const playerRepo = new StoragePlayerRepository(store);
  const clock = new FixedClock(T0);
  const idGen = new SequentialIdGenerator();

  // 名簿にA・B・Cを登録
  let players: readonly Player[] = [];
  for (const name of ["Alice", "Bob", "Carol"]) {
    const { players: next, player } = registerPlayer(players, {
      id: idGen.newPlayerId(),
      name,
      now: T0,
    });
    players = next;
    await playerRepo.save(player);
  }
  const [alice, bob, carol] = players;
  if (!alice || !bob || !carol) throw new Error("fixture");

  const gameUseCases = new GameUseCasesImpl({
    gameRepo: new StorageGameRepository(store),
    lastSetupRepo: new StorageLastGameSetupRepository(store),
    playerRepo,
    resultDraftRepo: new StorageResultDraftRepository(store),
    clock,
    idGen,
    random: new QueueRandomSource([]),
  });

  return { store, playerRepo, clock, idGen, gameUseCases, alice, bob, carol };
}

const basicRequest = (alice: Player, bob: Player, carol: Player) => ({
  playerIds: [alice.id, bob.id, carol.id],
  initialDealerId: alice.id,
  startingChips: 1000,
  totalHands: 3,
  initialBigBlind: 100,
  blindIncreaseEveryHands: 5,
  blindIncreaseAmount: 50,
  yenPerChip: 0.1,
  bountyRuleEnabled: false,
  bountyAmountYen: 100,
});

describe("getSetupDefaults", () => {
  test("前回の設定がなければ既定値、参加者は空", async () => {
    const { gameUseCases } = await setup();
    const defaults = await gameUseCases.getSetupDefaults();
    expect(defaults).toEqual({ ...DEFAULT_SETUP, seatOrder: [], isFromLastGame: false });
  });

  test("対局を始めると、次回の初期値になる", async () => {
    const { gameUseCases, alice, bob, carol } = await setup();
    await gameUseCases.startGame(basicRequest(alice, bob, carol));
    const defaults = await gameUseCases.getSetupDefaults();
    expect(defaults).toEqual({
      startingChips: 1000,
      totalHands: 3,
      initialBigBlind: 100,
      blindIncreaseEveryHands: 5,
      blindIncreaseAmount: 50,
      yenPerChip: 0.1,
      seatOrder: [alice.id, bob.id, carol.id],
      isFromLastGame: true,
      bountyRuleEnabled: false,
      bountyAmountYen: 100,
    });
  });

  test("名簿から削除された参加者は、前回の座席順から除かれる", async () => {
    const { gameUseCases, playerRepo, alice, bob, carol } = await setup();
    await gameUseCases.startGame(basicRequest(alice, bob, carol));
    await playerRepo.remove(bob.id);
    const defaults = await gameUseCases.getSetupDefaults();
    expect(defaults.seatOrder).toEqual([alice.id, carol.id]);
  });
});

describe("chooseRandomDealer", () => {
  test("乱数の結果に応じて、参加者の中から選ぶ", async () => {
    const { alice, bob, carol } = await setup();
    const gameUseCases = new GameUseCasesImpl({
      gameRepo: new StorageGameRepository(new MemoryKeyValueStore()),
      lastSetupRepo: new StorageLastGameSetupRepository(new MemoryKeyValueStore()),
      playerRepo: new StoragePlayerRepository(new MemoryKeyValueStore()),
      resultDraftRepo: new StorageResultDraftRepository(new MemoryKeyValueStore()),
      clock: new FixedClock(T0),
      idGen: new SequentialIdGenerator(),
      random: new QueueRandomSource([2, 0]),
    });
    const ids = [alice.id, bob.id, carol.id];
    expect(gameUseCases.chooseRandomDealer(ids)).toBe(carol.id);
    expect(gameUseCases.chooseRandomDealer(ids)).toBe(alice.id);
  });

  test("参加者がいなければ拒否する", async () => {
    const { gameUseCases } = await setup();
    expectDomainError(() => gameUseCases.chooseRandomDealer([]), "INVALID_PLAYERS");
  });
});

describe("startGame", () => {
  test("対局が始まり、1ハンド目の状態になる", async () => {
    const { gameUseCases, alice, bob, carol } = await setup();
    const view = await gameUseCases.startGame(basicRequest(alice, bob, carol));
    expect(view.state.phase).toBe("Playing");
    expect(view.state.handNumber).toBe(1);
    expect(view.state.dealerId).toBe(alice.id);
    expect(view.game.seats.map((s) => s.name)).toEqual(["Alice", "Bob", "Carol"]);
  });

  test("名簿にいない参加者は拒否する", async () => {
    const { gameUseCases, alice, bob } = await setup();
    await expectRejects(
      () => gameUseCases.startGame(basicRequest(alice, bob, { id: "ghost", name: "Ghost" } as never)),
      "PLAYER_NOT_FOUND",
    );
  });

  test("進行中の対局があるときは、確認なしでは始められない", async () => {
    const { gameUseCases, alice, bob, carol } = await setup();
    await gameUseCases.startGame(basicRequest(alice, bob, carol));
    await expectRejects(
      () => gameUseCases.startGame(basicRequest(alice, bob, carol)),
      "GAME_IN_PROGRESS",
    );
  });

  test("replaceCurrent: true なら、進行中の対局を破棄して新しく始める", async () => {
    const { gameUseCases, alice, bob, carol } = await setup();
    const first = await gameUseCases.startGame(basicRequest(alice, bob, carol));
    const second = await gameUseCases.startGame({
      ...basicRequest(alice, bob, carol),
      replaceCurrent: true,
    });
    expect(second.game.id).not.toBe(first.game.id);
    const current = await gameUseCases.getCurrentGame();
    expect(current?.game.id).toBe(second.game.id);
  });

  test("破棄した対局の入力途中データも消える", async () => {
    const { gameUseCases, alice, bob, carol, store } = await setup();
    await gameUseCases.startGame(basicRequest(alice, bob, carol));
    const draftRepo = new StorageResultDraftRepository(store);
    const firstId = (await gameUseCases.getCurrentGame())?.game.id;
    if (!firstId) throw new Error("no game");
    await draftRepo.save({ gameId: firstId, inputs: [] });
    await gameUseCases.startGame({ ...basicRequest(alice, bob, carol), replaceCurrent: true });
    expect(await draftRepo.find(firstId)).toBeNull();
  });
});

describe("進行操作", () => {
  test("次のハンドへ・脱落・復帰・戻す", async () => {
    const { gameUseCases, alice, bob, carol } = await setup();
    await gameUseCases.startGame(basicRequest(alice, bob, carol));

    const afterAdvance = await gameUseCases.advanceHand();
    expect(afterAdvance.state.handNumber).toBe(2);

    const afterEliminate = await gameUseCases.eliminatePlayer(bob.id);
    expect(afterEliminate.state.eliminatedPlayerIds).toEqual([bob.id]);

    const afterReinstate = await gameUseCases.reinstatePlayer(bob.id);
    expect(afterReinstate.state.eliminatedPlayerIds).toEqual([]);

    const afterUndo = await gameUseCases.undo();
    expect(afterUndo.state.eliminatedPlayerIds).toEqual([bob.id]);
  });

  test("生存者が1人になっても、自動では結果入力へ進まない", async () => {
    const { gameUseCases, alice, bob, carol } = await setup();
    await gameUseCases.startGame(basicRequest(alice, bob, carol));
    await gameUseCases.eliminatePlayer(bob.id);
    const view = await gameUseCases.eliminatePlayer(carol.id);
    expect(view.state.phase).toBe("Playing");
    expect(view.state.nextAction).toBe("EnterResult");
  });

  test("対局がなければ NO_CURRENT_GAME", async () => {
    const { gameUseCases } = await setup();
    await expectRejects(() => gameUseCases.advanceHand(), "NO_CURRENT_GAME");
    await expectRejects(() => gameUseCases.eliminatePlayer("x"), "NO_CURRENT_GAME");
    await expectRejects(() => gameUseCases.endPlay(), "NO_CURRENT_GAME");
    await expectRejects(() => gameUseCases.undo(), "NO_CURRENT_GAME");
  });
});

describe("結果入力から戻ったときの入力途中データ", () => {
  test("結果入力へ進んだあと「戻す」で対局に戻ると、入力途中の値は破棄される", async () => {
    const { gameUseCases, store, alice, bob, carol } = await setup();
    await gameUseCases.startGame(basicRequest(alice, bob, carol));
    await gameUseCases.advanceHand();
    await gameUseCases.advanceHand();
    const view = await gameUseCases.endPlay();
    expect(view.state.phase).toBe("ResultPending");

    const draftRepo = new StorageResultDraftRepository(store);
    await draftRepo.save({ gameId: view.game.id, inputs: [{ playerId: alice.id, netChips: 100 as never }] });

    const afterUndo = await gameUseCases.undo();
    expect(afterUndo.state.phase).toBe("Playing");
    expect(await draftRepo.find(view.game.id)).toBeNull();
  });

  test("結果入力画面での脱落の取り消しは、入力途中データを消さない", async () => {
    const { gameUseCases, store, alice, bob, carol } = await setup();
    await gameUseCases.startGame(basicRequest(alice, bob, carol));
    await gameUseCases.advanceHand();
    await gameUseCases.advanceHand();
    const view = await gameUseCases.endPlay();
    const draftRepo = new StorageResultDraftRepository(store);
    await draftRepo.save({ gameId: view.game.id, inputs: [{ playerId: alice.id, netChips: 100 as never }] });

    await gameUseCases.eliminatePlayer(bob.id);
    await gameUseCases.undo(); // 脱落を取り消す（結果入力待ちのまま）
    expect(await draftRepo.find(view.game.id)).toEqual({
      gameId: view.game.id,
      inputs: [{ playerId: alice.id, netChips: 100 }],
    });
  });
});

describe("abandonGame", () => {
  test("進行中の対局と、その入力途中データを削除する", async () => {
    const { gameUseCases, store, alice, bob, carol } = await setup();
    await gameUseCases.startGame(basicRequest(alice, bob, carol));
    const gameId = (await gameUseCases.getCurrentGame())?.game.id;
    if (!gameId) throw new Error("no game");
    const draftRepo = new StorageResultDraftRepository(store);
    await draftRepo.save({ gameId, inputs: [] });

    await gameUseCases.abandonGame();
    expect(await gameUseCases.getCurrentGame()).toBeNull();
    expect(await draftRepo.find(gameId)).toBeNull();
  });

  test("対局がなくても何も起きない", async () => {
    const { gameUseCases } = await setup();
    await gameUseCases.abandonGame();
    expect(await gameUseCases.getCurrentGame()).toBeNull();
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
