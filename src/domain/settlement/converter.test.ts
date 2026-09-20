import { describe, expect, test } from "vitest";
import { chips, exchangeRateFromYen, playerId } from "../shared/constructors";
import { expectDomainError } from "../shared/testing";
import { convertToYen } from "./converter";
import type { PlayerNetChips } from "./types";

const rate01 = exchangeRateFromYen(0.1);

function nets(...values: number[]): PlayerNetChips[] {
  return values.map((v, i) => ({
    playerId: playerId(String.fromCharCode(65 + i)),
    netChips: chips(v),
  }));
}
const yens = (results: ReturnType<typeof convertToYen>) => results.map((r) => r.netYen);

/** 再現できる乱数（テスト用） */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("convertToYen", () => {
  test("端数が出ないときは、そのまま掛け算になる", () => {
    expect(yens(convertToYen(nets(1000, -1000), rate01))).toEqual([100, -100]);
    expect(yens(convertToYen(nets(300, -100, -200), exchangeRateFromYen(1)))).toEqual([300, -100, -200]);
  });

  test("0チップは0円", () => {
    expect(yens(convertToYen(nets(0, 0), rate01))).toEqual([0, 0]);
  });

  test("端数は、余りの大きい人から1円ずつ配って合計を0にする", () => {
    // +0.7, +0.3, -1.0 → 切り捨て 0, 0, -1 → 不足1円を余り最大（0.7）の人へ
    expect(yens(convertToYen(nets(7, 3, -10), rate01))).toEqual([1, 0, -1]);
  });

  test("余りが同じなら、入力順（座席順）で先の人から", () => {
    // ±0.5円：先に並んでいる人が+1円を受け取る
    expect(yens(convertToYen(nets(5, -5), rate01))).toEqual([1, -1]);
    expect(yens(convertToYen(nets(-5, 5), rate01))).toEqual([0, 0]);
  });

  test("結果の各項目にチップ収支も含まれる", () => {
    const [first] = convertToYen(nets(7, 3, -10), rate01);
    expect(first).toEqual({ playerId: "A", netChips: 7, netYen: 1 });
  });

  test("合計が0でない入力は拒否する", () => {
    expectDomainError(() => convertToYen(nets(100, -50), rate01), "RESULT_INVALID");
  });

  test("空の入力は空の結果", () => {
    expect(convertToYen([], rate01)).toEqual([]);
  });

  test("ランダムな入力でも、合計は必ず0円で、各人の誤差は1円未満", () => {
    const random = rng(20260920);
    for (let round = 0; round < 300; round++) {
      const count = 2 + Math.floor(random() * 9);
      const values: number[] = [];
      for (let i = 0; i < count - 1; i++) values.push(Math.floor(random() * 2001) - 1000);
      values.push(0 - values.reduce((sum, v) => sum + v, 0));
      const rate = exchangeRateFromYen((1 + Math.floor(random() * 5000)) / 1000);

      const results = convertToYen(nets(...values), rate);
      expect(results.reduce<number>((sum, r) => sum + r.netYen, 0)).toBe(0);
      results.forEach((r) => {
        const exact = (r.netChips * rate) / 1000;
        expect(Math.abs(r.netYen - exact) < 1).toBe(true);
      });
    }
  });
});
