import { describe, expect, test } from "vitest";
import { chips, exchangeRateFromYen, playerId } from "../shared/constructors";
import { expectDomainError } from "../shared/testing";
import { calculateSettlement } from "./settlement";
import type { PlayerNetChips } from "./types";

function nets(...values: number[]): PlayerNetChips[] {
  return values.map((v, i) => ({
    playerId: playerId(String.fromCharCode(65 + i)),
    netChips: chips(v),
  }));
}

describe("calculateSettlement", () => {
  test("換算と最小回数の送金をまとめて求める（5人・1チップ0.1円）", () => {
    const settlement = calculateSettlement(
      nets(2000, -500, -1000, 700, -1200),
      exchangeRateFromYen(0.1),
    );
    expect(settlement.results.map((r) => r.netYen)).toEqual([200, -50, -100, 70, -120]);
    expect(settlement.transfers.map((t) => [t.from, t.to, t.amount])).toEqual([
      ["E", "A", 120],
      ["C", "A", 80],
      ["B", "D", 50],
      ["C", "D", 20],
    ]);
  });

  test("端数が出る場合も、円の合計は0で送金がつじつまの合う形になる", () => {
    const settlement = calculateSettlement(nets(7, 3, -10), exchangeRateFromYen(0.1));
    expect(settlement.results.map((r) => r.netYen)).toEqual([1, 0, -1]);
    expect(settlement.transfers.map((t) => [t.from, t.to, t.amount])).toEqual([["C", "A", 1]]);
  });

  test("全員0チップなら送金なし", () => {
    const settlement = calculateSettlement(nets(0, 0, 0), exchangeRateFromYen(1));
    expect(settlement.transfers).toEqual([]);
  });

  test("合計が0でないチップ収支は拒否する", () => {
    expectDomainError(
      () => calculateSettlement(nets(100, -10), exchangeRateFromYen(1)),
      "RESULT_INVALID",
    );
  });
});
