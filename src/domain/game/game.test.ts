import { describe, expect, test } from "vitest";
import {
  chips,
  exchangeRateFromYen,
  gameId,
  playerId,
} from "../shared/constructors";
import { DomainError } from "../shared/errors";
import type { DomainErrorCode } from "../shared/errors";
import {
  advanceHand,
  create,
  endPlay,
  eliminate,
  project,
  reinstate,
  undo,
} from "./game";
import type { Game, GameSettings } from "./types";

const NOW = "2026-09-20T00:00:00.000Z";

const baseSettings: GameSettings = {
  startingChips: chips(1000),
  totalHands: 20,
  blindSchedule: {
    initialBigBlind: chips(100),
    increaseEveryHands: 5,
    increaseAmount: chips(50),
  },
  exchangeRate: exchangeRateFromYen(0.1),
};

function newGame(
  settings: Partial<GameSettings> = {},
  ids: readonly string[] = ["A", "B", "C", "D", "E"],
): Game {
  return create(
    {
      seats: ids.map((id) => ({ id: playerId(id), name: `プレイヤー${id}` })),
      initialDealerId: playerId(ids[0] ?? "A"),
      settings: { ...baseSettings, ...settings },
    },
    gameId("game-1"),
    NOW,
  );
}

function advance(game: Game, times = 1): Game {
  let current = game;
  for (let i = 0; i < times; i++) current = advanceHand(current, NOW);
  return current;
}

function out(game: Game, ...ids: string[]): Game {
  return ids.reduce((g, id) => eliminate(g, playerId(id), NOW), game);
}

function expectCode(fn: () => unknown, code: DomainErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`DomainError(${code}) が投げられませんでした`);
}

describe("開始時の状態", () => {
  test("1ハンド目：親A、SB=B、BB=C、ブラインド50/100", () => {
    const state = project(newGame());
    expect(state.phase).toBe("Playing");
    expect(state.nextAction).toBe("AdvanceHand");
    expect(state.handNumber).toBe(1);
    expect(state.totalHands).toBe(20);
    expect(state.activePlayerIds).toEqual(["A", "B", "C", "D", "E"]);
    expect(state.eliminatedPlayerIds).toEqual([]);
    expect(state.dealerId).toBe("A");
    expect(state.smallBlindId).toBe("B");
    expect(state.bigBlindId).toBe("C");
    expect(state.blinds).toEqual({ smallBlind: 50, bigBlind: 100 });
    expect(state.handsUntilBlindIncrease).toBe(5);
    expect(state.nextBlinds).toEqual({ smallBlind: 75, bigBlind: 150 });
    expect(state.lastEvent).toBeNull();
  });
});

describe("親の移動", () => {
  test("次のハンドへ進むたびに、親・SB・BBが1人ずつ時計回りに移る", () => {
    const state = project(advance(newGame()));
    expect(state.handNumber).toBe(2);
    expect(state.dealerId).toBe("B");
    expect(state.smallBlindId).toBe("C");
    expect(state.bigBlindId).toBe("D");
  });

  test("末尾の人の次は先頭に戻る", () => {
    const state = project(advance(newGame(), 4));
    expect(state.dealerId).toBe("E");
    expect(state.smallBlindId).toBe("A");
    expect(state.bigBlindId).toBe("B");
    expect(project(advance(newGame(), 5)).dealerId).toBe("A");
  });

  test("脱落者は親を飛ばされる", () => {
    let game = out(newGame(), "E");
    const dealers: string[] = [];
    for (let i = 0; i < 4; i++) {
      game = advanceHand(game, NOW);
      dealers.push(project(game).dealerId);
    }
    expect(dealers).toEqual(["B", "C", "D", "A"]);
  });

  test("最初の親を途中の席にできる", () => {
    const game = create(
      {
        seats: ["A", "B", "C"].map((id) => ({ id: playerId(id), name: id })),
        initialDealerId: playerId("B"),
        settings: baseSettings,
      },
      gameId("g"),
      NOW,
    );
    const state = project(game);
    expect(state.dealerId).toBe("B");
    expect(state.smallBlindId).toBe("C");
    expect(state.bigBlindId).toBe("A");
  });
});

describe("脱落とSB・BB", () => {
  test("SB・BBは脱落者を飛ばして決まる", () => {
    const state = project(out(newGame(), "B"));
    expect(state.dealerId).toBe("A");
    expect(state.smallBlindId).toBe("C");
    expect(state.bigBlindId).toBe("D");
    expect(state.activePlayerIds).toEqual(["A", "C", "D", "E"]);
    expect(state.eliminatedPlayerIds).toEqual(["B"]);
  });

  test("親が脱落した場合、次のハンドで次の生存者に親が移る", () => {
    const eliminated = out(newGame(), "A");
    const before = project(eliminated);
    expect(before.dealerId).toBe("A"); // 次に進むまでは脱落した人のまま
    expect(before.smallBlindId).toBe("B");
    expect(before.bigBlindId).toBe("C");

    const after = project(advanceHand(eliminated, NOW));
    expect(after.dealerId).toBe("B");
    expect(after.smallBlindId).toBe("C");
    expect(after.bigBlindId).toBe("D");
  });

  test("残り2人で親が生存：親がSB、もう一人がBB。ハンドごとに入れ替わる", () => {
    let game = out(newGame(), "C", "D", "E");
    let state = project(game);
    expect(state.dealerId).toBe("A");
    expect(state.smallBlindId).toBe("A");
    expect(state.bigBlindId).toBe("B");

    game = advanceHand(game, NOW);
    state = project(game);
    expect(state.dealerId).toBe("B");
    expect(state.smallBlindId).toBe("B");
    expect(state.bigBlindId).toBe("A");

    state = project(advanceHand(game, NOW));
    expect(state.dealerId).toBe("A");
  });

  test("残り2人で親が脱落済み：親の次の生存者がSB、その次がBB", () => {
    const state = project(out(newGame(), "A", "D", "E"));
    expect(state.activePlayerIds).toEqual(["B", "C"]);
    expect(state.dealerId).toBe("A");
    expect(state.smallBlindId).toBe("B");
    expect(state.bigBlindId).toBe("C");
  });

  test("生存者が1人になると、主ボタンは「結果入力へ」になる", () => {
    const state = project(out(newGame(), "B", "C", "D", "E"));
    expect(state.activePlayerIds).toEqual(["A"]);
    expect(state.nextAction).toBe("EnterResult");
    expect(state.smallBlindId).toBe("A");
    expect(state.bigBlindId).toBe("A");
  });
});

describe("脱落・復帰のルール違反", () => {
  test("最後の生存者は脱落させられない", () => {
    const game = out(newGame(), "B", "C", "D", "E");
    expectCode(() => eliminate(game, playerId("A"), NOW), "LAST_SURVIVOR");
  });

  test("同じ人を2回脱落させられない", () => {
    const game = out(newGame(), "B");
    expectCode(() => eliminate(game, playerId("B"), NOW), "ALREADY_ELIMINATED");
  });

  test("参加者以外は指定できない", () => {
    expectCode(
      () => eliminate(newGame(), playerId("Z"), NOW),
      "PLAYER_NOT_FOUND",
    );
    expectCode(
      () => reinstate(newGame(), playerId("Z"), NOW),
      "PLAYER_NOT_FOUND",
    );
  });

  test("脱落していない人は復帰できない", () => {
    expectCode(
      () => reinstate(newGame(), playerId("B"), NOW),
      "NOT_ELIMINATED",
    );
  });

  test("復帰すると、生存者・SB・BBが元に戻る", () => {
    const game = reinstate(out(newGame(), "B"), playerId("B"), NOW);
    const state = project(game);
    expect(state.activePlayerIds).toEqual(["A", "B", "C", "D", "E"]);
    expect(state.eliminatedPlayerIds).toEqual([]);
    expect(state.smallBlindId).toBe("B");
    expect(state.bigBlindId).toBe("C");
  });
});

describe("ブラインド上昇", () => {
  test("上げる間隔のハンドで額が変わり、残りハンド数が更新される", () => {
    const at5 = project(advance(newGame(), 4));
    expect(at5.handNumber).toBe(5);
    expect(at5.blinds).toEqual({ smallBlind: 50, bigBlind: 100 });
    expect(at5.handsUntilBlindIncrease).toBe(1);
    expect(at5.nextBlinds).toEqual({ smallBlind: 75, bigBlind: 150 });

    const at6 = project(advance(newGame(), 5));
    expect(at6.handNumber).toBe(6);
    expect(at6.blinds).toEqual({ smallBlind: 75, bigBlind: 150 });
    expect(at6.handsUntilBlindIncrease).toBe(5);
    expect(at6.nextBlinds).toEqual({ smallBlind: 100, bigBlind: 200 });
  });

  test("最終ハンドまでに上がらない場合は表示なし（null）", () => {
    const state = project(advance(newGame(), 15)); // 16ハンド目
    expect(state.blinds).toEqual({ smallBlind: 125, bigBlind: 250 });
    expect(state.handsUntilBlindIncrease).toBeNull();
    expect(state.nextBlinds).toBeNull();
  });
});

describe("最終ハンドと結果入力", () => {
  test("最終ハンドでは主ボタンが「結果入力へ」になり、進めない", () => {
    const game = advance(newGame({ totalHands: 3 }), 2);
    const state = project(game);
    expect(state.handNumber).toBe(3);
    expect(state.nextAction).toBe("EnterResult");
    expectCode(() => advanceHand(game, NOW), "NO_MORE_HANDS");
  });

  test("最終ハンドで結果入力へ進める。以降はハンドを進められない", () => {
    const finished = endPlay(advance(newGame({ totalHands: 3 }), 2), NOW);
    const state = project(finished);
    expect(state.phase).toBe("ResultPending");
    expect(state.nextAction).toBe("EnterResult");
    expect(state.lastEvent).toEqual({
      type: "PlayEnded",
      reason: "AllHandsPlayed",
      at: NOW,
    });
    expectCode(() => advanceHand(finished, NOW), "NOT_PLAYING");
    expectCode(() => endPlay(finished, NOW), "NOT_PLAYING");
  });

  test("最終ハンドでも生存者1人でもなければ結果入力へ進めない", () => {
    expectCode(() => endPlay(newGame(), NOW), "CANNOT_END_YET");
  });

  test("生存者が1人なら、途中でも結果入力へ進める（理由はSingleSurvivor）", () => {
    const game = endPlay(out(advance(newGame(), 2), "B", "C", "D", "E"), NOW);
    expect(project(game).phase).toBe("ResultPending");
    expect(project(game).lastEvent).toEqual({
      type: "PlayEnded",
      reason: "SingleSurvivor",
      at: NOW,
    });
  });

  test("生存者が1人のときは、ハンドを進められない", () => {
    const game = out(newGame(), "B", "C", "D", "E");
    expectCode(() => advanceHand(game, NOW), "NO_MORE_HANDS");
  });
});

describe("結果入力待ちでの脱落・復帰", () => {
  const pending = () => endPlay(advance(newGame({ totalHands: 3 }), 2), NOW);

  test("脱落・復帰を変更でき、結果入力待ちのまま", () => {
    const eliminated = eliminate(pending(), playerId("B"), NOW);
    const state = project(eliminated);
    expect(state.phase).toBe("ResultPending");
    expect(state.eliminatedPlayerIds).toEqual(["B"]);
    expect(state.lastEvent).toEqual({
      type: "PlayerEliminated",
      playerId: "B",
      at: NOW,
    });

    const reinstated = project(reinstate(eliminated, playerId("B"), NOW));
    expect(reinstated.phase).toBe("ResultPending");
    expect(reinstated.eliminatedPlayerIds).toEqual([]);
  });

  test("最後の生存者は、結果入力待ちでも脱落させられない", () => {
    const game = out(pending(), "B", "C", "D", "E");
    expect(project(game).activePlayerIds).toEqual(["A"]);
    expectCode(() => eliminate(game, playerId("A"), NOW), "LAST_SURVIVOR");
  });

  test("ルール違反（二重脱落・脱落していない人の復帰）は同じくエラー", () => {
    const game = eliminate(pending(), playerId("B"), NOW);
    expectCode(() => eliminate(game, playerId("B"), NOW), "ALREADY_ELIMINATED");
    expectCode(() => reinstate(pending(), playerId("B"), NOW), "NOT_ELIMINATED");
  });

  test("戻すと、脱落の変更 → 結果入力へ進む操作 の順に取り消される", () => {
    const base = pending();
    const changed = eliminate(base, playerId("B"), NOW);
    expect(project(undo(changed))).toEqual(project(base));
    expect(project(undo(changed)).phase).toBe("ResultPending");
    expect(project(undo(undo(changed))).phase).toBe("Playing");
  });
});

describe("元に戻す", () => {
  test("ハンドを進めた操作を取り消すと、元の状態に戻る", () => {
    const initial = newGame();
    expect(project(undo(advance(initial)))).toEqual(project(initial));
  });

  test("脱落を取り消すと、生存者と親の位置が元に戻る", () => {
    const game = advance(newGame(), 2);
    expect(project(undo(out(game, "D")))).toEqual(project(game));
  });

  test("結果入力へ進んだあとでも戻せて、対局に復帰できる", () => {
    const game = advance(newGame({ totalHands: 3 }), 2);
    const finished = endPlay(game, NOW);
    expect(project(undo(finished)).phase).toBe("Playing");
    expect(project(undo(finished))).toEqual(project(game));
  });

  test("直近の出来事がlastEventで分かる（「戻す」の説明用）", () => {
    const game = out(advance(newGame()), "C");
    expect(project(game).lastEvent).toEqual({
      type: "PlayerEliminated",
      playerId: "C",
      at: NOW,
    });
  });

  test("履歴が空なら戻せない", () => {
    expectCode(() => undo(newGame()), "NOTHING_TO_UNDO");
  });
});

describe("Gameは変更されない（イミュータブル）", () => {
  test("操作しても元のGameの履歴は増えない", () => {
    const game = newGame();
    advanceHand(game, NOW);
    eliminate(game, playerId("B"), NOW);
    expect(game.events).toHaveLength(0);
  });
});

describe("対局の作成時の検証", () => {
  const seat = (id: string) => ({ id: playerId(id), name: id });

  test("人数は2〜10人", () => {
    expectCode(
      () =>
        create(
          { seats: [seat("A")], initialDealerId: playerId("A"), settings: baseSettings },
          gameId("g"),
          NOW,
        ),
      "INVALID_PLAYERS",
    );
    const eleven = "ABCDEFGHIJK".split("").map(seat);
    expectCode(
      () =>
        create(
          { seats: eleven, initialDealerId: playerId("A"), settings: baseSettings },
          gameId("g"),
          NOW,
        ),
      "INVALID_PLAYERS",
    );
    const ten = "ABCDEFGHIJ".split("").map(seat);
    expect(
      project(
        create(
          { seats: ten, initialDealerId: playerId("A"), settings: baseSettings },
          gameId("g"),
          NOW,
        ),
      ).activePlayerIds,
    ).toHaveLength(10);
  });

  test("IDの重複・空の名前・座席にいない親は拒否する", () => {
    expectCode(
      () =>
        create(
          { seats: [seat("A"), seat("A")], initialDealerId: playerId("A"), settings: baseSettings },
          gameId("g"),
          NOW,
        ),
      "INVALID_PLAYERS",
    );
    expectCode(
      () =>
        create(
          {
            seats: [{ id: playerId("A"), name: "  " }, seat("B")],
            initialDealerId: playerId("A"),
            settings: baseSettings,
          },
          gameId("g"),
          NOW,
        ),
      "INVALID_PLAYERS",
    );
    expectCode(
      () =>
        create(
          { seats: [seat("A"), seat("B")], initialDealerId: playerId("Z"), settings: baseSettings },
          gameId("g"),
          NOW,
        ),
      "INVALID_PLAYERS",
    );
  });

  test("設定値が不正なら拒否する", () => {
    expectCode(() => newGame({ totalHands: 0 }), "INVALID_SETTINGS");
    expectCode(() => newGame({ startingChips: chips(0) }), "INVALID_SETTINGS");
    expectCode(
      () =>
        newGame({
          blindSchedule: {
            initialBigBlind: chips(0),
            increaseEveryHands: 5,
            increaseAmount: chips(50),
          },
        }),
      "INVALID_SETTINGS",
    );
    expectCode(
      () =>
        newGame({
          blindSchedule: {
            initialBigBlind: chips(100),
            increaseEveryHands: 0,
            increaseAmount: chips(50),
          },
        }),
      "INVALID_SETTINGS",
    );
    expectCode(
      () =>
        newGame({
          blindSchedule: {
            initialBigBlind: chips(100),
            increaseEveryHands: 5,
            increaseAmount: chips(-1),
          },
        }),
      "INVALID_SETTINGS",
    );
  });
});
