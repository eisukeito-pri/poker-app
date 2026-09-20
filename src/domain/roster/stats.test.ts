import { describe, expect, test } from "vitest";
import { chips, exchangeRateFromYen, gameId, playerId, yen } from "../shared/constructors";
import { aggregateStats } from "./stats";
import type { GameRecord, Player } from "./types";

const settings = {
  startingChips: chips(1000),
  totalHands: 10,
  blindSchedule: { initialBigBlind: chips(100), increaseEveryHands: 5, increaseAmount: chips(0) },
  exchangeRate: exchangeRateFromYen(0.1),
};

/** rows: [ID, 記録時点の名前, 円の収支] */
function record(id: string, playedAt: string, rows: [string, string, number][]): GameRecord {
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
    settledAt: null,
  };
}

const player = (id: string, name: string): Player => ({
  id: playerId(id),
  name,
  createdAt: "2026-09-01T00:00:00.000Z",
});

describe("aggregateStats", () => {
  test("対局数・勝ち負け引き分け・通算・平均・最高最低を集計する", () => {
    const records = [
      record("g1", "2026-09-01T00:00:00.000Z", [["a", "Alice", 100], ["b", "Bob", -100], ["c", "Carol", 0]]),
      record("g2", "2026-09-02T00:00:00.000Z", [["a", "Alice", -30], ["b", "Bob", 30], ["c", "Carol", 0]]),
    ];
    const stats = aggregateStats(records, [player("a", "Alice"), player("b", "Bob"), player("c", "Carol")]);
    const alice = stats.find((s) => s.playerId === "a");
    expect(alice).toEqual({
      playerId: "a",
      name: "Alice",
      gamesPlayed: 2,
      wins: 1,
      losses: 1,
      draws: 0,
      totalNetYen: 70,
      averageNetYen: 35,
      bestNetYen: 100,
      worstNetYen: -30,
    });
    const carol = stats.find((s) => s.playerId === "c");
    expect(carol?.draws).toBe(2);
    expect(carol?.wins).toBe(0);
    expect(carol?.losses).toBe(0);
    expect(carol?.totalNetYen).toBe(0);
  });

  test("平均は小数のまま持つ", () => {
    const records = [
      record("g1", "2026-09-01T00:00:00.000Z", [["a", "Alice", 1], ["b", "Bob", -1]]),
      record("g2", "2026-09-02T00:00:00.000Z", [["a", "Alice", 0], ["b", "Bob", 0]]),
    ];
    expect(aggregateStats(records, [])[0]?.averageNetYen).toBe(0.5);
  });

  test("通算収支の大きい順 → 勝ち数の多い順 → 名前順 → ID順", () => {
    const records = [
      record("g1", "2026-09-01T00:00:00.000Z", [
        ["a", "Carol", 50], ["b", "Bob", 50], ["c", "Alice", 200], ["d", "Dave", -300],
      ]),
      record("g2", "2026-09-02T00:00:00.000Z", [
        ["a", "Carol", 0], ["b", "Bob", 0], ["c", "Alice", -200], ["d", "Dave", 200],
      ]),
      record("g3", "2026-09-03T00:00:00.000Z", [
        ["a", "Carol", 0], ["b", "Bob", 0], ["c", "Alice", 0], ["d", "Dave", 0],
      ]),
    ];
    // 通算：Alice 0、Dave -100、Carol 50、Bob 50 → 50同士は勝ち数(1,1)も同じなので名前順
    const order = aggregateStats(records, []).map((s) => s.name);
    expect(order).toEqual(["Bob", "Carol", "Alice", "Dave"]);
  });

  test("通算収支が同じなら、勝ち数の多い人が上（名前順より優先）", () => {
    const records = [
      record("g1", "2026-09-01T00:00:00.000Z", [["x", "Xan", 100], ["y", "Aki", 0], ["z", "Zoe", -100]]),
      record("g2", "2026-09-02T00:00:00.000Z", [["x", "Xan", -100], ["y", "Aki", 0], ["z", "Zoe", 100]]),
    ];
    // 3人とも通算0円。勝ち数は Xan=1, Zoe=1, Aki=0 → Xan, Zoe（名前順）, Aki
    expect(aggregateStats(records, []).map((s) => s.name)).toEqual(["Xan", "Zoe", "Aki"]);
  });

  test("通算収支の大きい順に並ぶ", () => {
    const records = [
      record("g1", "2026-09-01T00:00:00.000Z", [["a", "A", 100], ["b", "B", 50], ["c", "C", -150]]),
      record("g2", "2026-09-02T00:00:00.000Z", [["a", "A", -100], ["b", "B", 50], ["c", "C", 50]]),
    ];
    // A: 0、B: 100、C: -100
    expect(aggregateStats(records, []).map((s) => [s.playerId, s.totalNetYen])).toEqual([
      ["b", 100],
      ["a", 0],
      ["c", -100],
    ]);
  });

  test("名簿にいる人は現在の名前、いない人は最後の記録の名前", () => {
    const records = [
      record("g1", "2026-09-01T00:00:00.000Z", [["a", "旧名", 100], ["b", "Bob旧", -100]]),
      record("g2", "2026-09-02T00:00:00.000Z", [["a", "新名", 100], ["b", "Bob新", -100]]),
    ];
    const stats = aggregateStats(records, [player("a", "改名後")]); // bは名簿から削除済み
    expect(stats.find((s) => s.playerId === "a")?.name).toBe("改名後");
    expect(stats.find((s) => s.playerId === "b")?.name).toBe("Bob新");
  });

  test("記録がない名簿の人は含まれない。記録がなければ空", () => {
    const records = [record("g1", "2026-09-01T00:00:00.000Z", [["a", "Alice", 10], ["b", "Bob", -10]])];
    const stats = aggregateStats(records, [player("a", "Alice"), player("z", "未対局")]);
    expect(stats.map((s) => s.playerId)).toEqual(["a", "b"]);
    expect(aggregateStats([], [player("a", "Alice")])).toEqual([]);
  });
});
