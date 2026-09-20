import { describe, expect, test } from "vitest";
import { chips, exchangeRateFromYen, gameId, playerId, yen } from "../shared/constructors";
import type { Transfer } from "../settlement/types";
import { aggregatePendingSettlement, pendingRecordsOf } from "./pending-settlement";
import type { GameRecord } from "./types";

const settings = {
  startingChips: chips(1000),
  totalHands: 10,
  blindSchedule: { initialBigBlind: chips(100), increaseEveryHands: 5, increaseAmount: chips(0) },
  exchangeRate: exchangeRateFromYen(0.1),
  bountyRule: null,
};

/** rows: [ID, 記録時点の名前, 円の収支] */
function record(
  id: string,
  playedAt: string,
  rows: [string, string, number][],
  options: { settledAt?: string | null; bountyTransfers?: readonly Transfer[] } = {},
): GameRecord {
  return {
    gameId: gameId(id),
    playedAt,
    settings,
    players: rows.map(([pid, name]) => ({ id: playerId(pid), name })),
    handsPlayed: 10,
    results: rows.map(([pid, , net]) => ({
      playerId: playerId(pid),
      netChips: chips(net * 10),
      netYen: yen(net),
    })),
    transfers: [],
    bountyTransfers: options.bountyTransfers ?? [],
    settledAt: options.settledAt ?? null,
  };
}

describe("pendingRecordsOf", () => {
  test("settledAtがnullの記録だけを、渡された順に返す", () => {
    const records = [
      record("g1", "2026-09-01T00:00:00.000Z", [["a", "Alice", 0]], { settledAt: "2026-09-02T00:00:00.000Z" }),
      record("g2", "2026-09-02T00:00:00.000Z", [["a", "Alice", 0]]),
      record("g3", "2026-09-03T00:00:00.000Z", [["a", "Alice", 0]]),
    ];
    expect(pendingRecordsOf(records).map((r) => r.gameId)).toEqual(["g2", "g3"]);
  });
});

describe("aggregatePendingSettlement", () => {
  test("脱落ボーナスの分は、通常の収支に合算されつつ、bountyNetYenで内訳が分かる", () => {
    const records = [
      record("g1", "2026-09-01T00:00:00.000Z", [["a", "Alice", 100], ["b", "Bob", -40], ["c", "Carol", -60]], {
        bountyTransfers: [{ from: playerId("b"), to: playerId("a"), amount: yen(500) }],
      }),
    ];
    const summary = aggregatePendingSettlement(records);
    const alice = summary.balances.find((b) => b.playerId === "a");
    const bob = summary.balances.find((b) => b.playerId === "b");
    const carol = summary.balances.find((b) => b.playerId === "c");
    expect([alice?.netYen, alice?.bountyNetYen]).toEqual([100, 500]);
    expect([bob?.netYen, bob?.bountyNetYen]).toEqual([-40, -500]);
    expect([carol?.netYen, carol?.bountyNetYen]).toEqual([-60, 0]);
  });

  test("複数対局にまたがる脱落ボーナスも合算される", () => {
    const records = [
      record("g1", "2026-09-01T00:00:00.000Z", [["a", "Alice", 100], ["b", "Bob", -100]], {
        bountyTransfers: [{ from: playerId("b"), to: playerId("a"), amount: yen(300) }],
      }),
      record("g2", "2026-09-02T00:00:00.000Z", [["a", "Alice", -50], ["b", "Bob", 50]], {
        bountyTransfers: [{ from: playerId("a"), to: playerId("b"), amount: yen(200) }],
      }),
    ];
    const summary = aggregatePendingSettlement(records);
    const alice = summary.balances.find((b) => b.playerId === "a");
    const bob = summary.balances.find((b) => b.playerId === "b");
    expect([alice?.netYen, alice?.bountyNetYen]).toEqual([50, 100]);
    expect([bob?.netYen, bob?.bountyNetYen]).toEqual([-50, -100]);
  });

  test("脱落ボーナスのルールを使っていない対局だけなら、bountyNetYenは0", () => {
    const records = [
      record("g1", "2026-09-01T00:00:00.000Z", [["a", "Alice", 100], ["b", "Bob", -100]]),
    ];
    const summary = aggregatePendingSettlement(records);
    expect(summary.balances.every((b) => b.bountyNetYen === 0)).toBe(true);
  });
});
