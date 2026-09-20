import { describe, expect, test } from "vitest";
import { chips, exchangeRateFromYen, gameId, playerId, yen } from "../shared/constructors";
import { expectDomainError } from "../shared/testing";
import { advanceHand, create, eliminate, endPlay } from "../game/game";
import type { Game, GameSettings } from "../game/types";
import { calculateSettlement } from "../settlement/settlement";
import type { Settlement } from "../settlement/types";
import { createGameRecord, sortRecordsNewestFirst } from "./record";
import type { GameRecord } from "./types";

const CREATED = "2026-09-20T10:00:00.000Z";
const LATER = "2026-09-20T12:00:00.000Z";

const settings: GameSettings = {
  startingChips: chips(1000),
  totalHands: 3,
  blindSchedule: { initialBigBlind: chips(100), increaseEveryHands: 5, increaseAmount: chips(50) },
  exchangeRate: exchangeRateFromYen(0.1),
  bountyRule: null,
};

function newGame(): Game {
  return create(
    {
      seats: ["A", "B", "C"].map((id) => ({ id: playerId(id), name: `名前${id}` })),
      initialDealerId: playerId("A"),
      settings,
    },
    gameId("g1"),
    CREATED,
  );
}

const finishedAtFinalHand = (): Game =>
  endPlay(advanceHand(advanceHand(newGame(), LATER), LATER), LATER);

const bountySettings: GameSettings = { ...settings, bountyRule: { amountYen: yen(500) } };

function newGameWithBounty(): Game {
  return create(
    {
      seats: ["A", "B", "C"].map((id) => ({ id: playerId(id), name: `名前${id}` })),
      initialDealerId: playerId("A"),
      settings: bountySettings,
    },
    gameId("g1"),
    CREATED,
  );
}

function settle(...values: number[]): Settlement {
  return calculateSettlement(
    values.map((v, i) => ({ playerId: playerId(["A", "B", "C"][i] ?? "?"), netChips: chips(v) })),
    settings.exchangeRate,
  );
}

describe("createGameRecord", () => {
  test("対局と精算結果から確定記録を作る", () => {
    const settlement = settle(1000, -400, -600);
    const record = createGameRecord({ game: finishedAtFinalHand(), settlement });
    expect(record.gameId).toBe("g1");
    expect(record.playedAt).toBe(CREATED); // 対局を始めた時刻
    expect(record.handsPlayed).toBe(3);
    expect(record.settings).toEqual(settings);
    expect(record.players.map((p) => [p.id, p.name])).toEqual([
      ["A", "名前A"],
      ["B", "名前B"],
      ["C", "名前C"],
    ]);
    expect(record.results.map((r) => r.netYen)).toEqual([100, -40, -60]);
    expect(record.transfers).toEqual(settlement.transfers);
  });

  test("精算結果は座席順に並べ直される", () => {
    const settlement = settle(1000, -400, -600);
    const shuffled: Settlement = {
      ...settlement,
      results: [...settlement.results].reverse(),
    };
    const record = createGameRecord({ game: finishedAtFinalHand(), settlement: shuffled });
    expect(record.results.map((r) => r.playerId)).toEqual(["A", "B", "C"]);
  });

  test("生存者1人で早期終了した対局は、その時点のハンド数", () => {
    const game = endPlay(
      eliminate(eliminate(advanceHand(newGame(), LATER), playerId("B"), LATER), playerId("C"), LATER),
      LATER,
    );
    const record = createGameRecord({ game, settlement: settle(2000, -1000, -1000) });
    expect(record.handsPlayed).toBe(2);
  });

  test("結果入力に進んでいない対局は記録できない", () => {
    expectDomainError(
      () => createGameRecord({ game: newGame(), settlement: settle(0, 0, 0) }),
      "NOT_RESULT_PENDING",
    );
  });

  test("精算結果に参加者の過不足があれば拒否する", () => {
    const settlement = settle(1000, -400, -600);
    const missing: Settlement = { ...settlement, results: settlement.results.slice(0, 2) };
    expectDomainError(
      () => createGameRecord({ game: finishedAtFinalHand(), settlement: missing }),
      "RESULT_INVALID",
    );
    const extra: Settlement = {
      ...settlement,
      results: [...settlement.results, { playerId: playerId("Z"), netChips: chips(0), netYen: 0 as never }],
    };
    expectDomainError(
      () => createGameRecord({ game: finishedAtFinalHand(), settlement: extra }),
      "RESULT_INVALID",
    );
  });

  test("脱落ボーナスのルールが有効なら、netYenと送金リストに反映される（チップの収支は変えない）", () => {
    const game = endPlay(
      eliminate(
        advanceHand(advanceHand(newGameWithBounty(), LATER), LATER),
        playerId("B"),
        LATER,
        playerId("A"),
      ),
      LATER,
    );
    const settlement = settle(1000, -400, -600);
    const record = createGameRecord({ game, settlement });

    expect(record.bountyTransfers).toEqual([{ from: "B", to: "A", amount: 500 }]);
    expect(record.results.map((r) => [r.playerId, r.netChips])).toEqual(
      settlement.results.map((r) => [r.playerId, r.netChips]),
    );
    expect(record.results.map((r) => r.netYen)).toEqual([600, -540, -60]);
    expect(record.results.reduce((sum, r) => sum + r.netYen, 0)).toBe(0);

    const net = new Map<string, number>([["A", 0], ["B", 0], ["C", 0]]);
    for (const t of record.transfers) {
      net.set(t.to, (net.get(t.to) ?? 0) + t.amount);
      net.set(t.from, (net.get(t.from) ?? 0) - t.amount);
    }
    expect(net.get("A")).toBe(600);
    expect(net.get("B")).toBe(-540);
    expect(net.get("C")).toBe(-60);
  });

  test("脱落ボーナスのルールが無効なら、bountyTransfersは空で送金額もそのまま", () => {
    const settlement = settle(1000, -400, -600);
    const record = createGameRecord({ game: finishedAtFinalHand(), settlement });
    expect(record.bountyTransfers).toEqual([]);
    expect(record.transfers).toEqual(settlement.transfers);
  });
});

describe("sortRecordsNewestFirst", () => {
  const rec = (id: string, playedAt: string): GameRecord => ({
    gameId: gameId(id),
    playedAt,
    settings,
    players: [],
    handsPlayed: 1,
    results: [],
    transfers: [],
    bountyTransfers: [],
    settledAt: null,
  });

  test("新しい順。同時刻ならgameIdの降順。元の配列は変更しない", () => {
    const records = [
      rec("a", "2026-09-01T00:00:00.000Z"),
      rec("b", "2026-09-03T00:00:00.000Z"),
      rec("c", "2026-09-03T00:00:00.000Z"),
      rec("d", "2026-09-02T00:00:00.000Z"),
    ];
    expect(sortRecordsNewestFirst(records).map((r) => r.gameId)).toEqual(["c", "b", "d", "a"]);
    expect(records.map((r) => r.gameId)).toEqual(["a", "b", "c", "d"]);
  });
});
