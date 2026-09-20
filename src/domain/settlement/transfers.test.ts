import { describe, expect, test } from "vitest";
import { playerId, yen } from "../shared/constructors";
import { expectDomainError } from "../shared/testing";
import { minimizeTransfers } from "./transfers";

function balances(...values: number[]) {
  return values.map((v, i) => ({
    playerId: playerId(String.fromCharCode(65 + i)),
    netYen: yen(v),
  }));
}

/** 送金を [from, to, amount] の並びで表す */
const flat = (transfers: ReturnType<typeof minimizeTransfers>) =>
  transfers.map((t) => [t.from as string, t.to as string, t.amount as number]);

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 検証用の別実装：合計0のグループに分けられる最大数（再帰） */
function maxZeroGroups(values: readonly number[]): number {
  const count = values.length;
  const memo = new Map<number, number>();
  const sumOf = (mask: number) =>
    values.reduce((sum, v, i) => sum + ((mask & (1 << i)) !== 0 ? v : 0), 0);
  function solve(mask: number): number {
    if (mask === 0) return 0;
    const cached = memo.get(mask);
    if (cached !== undefined) return cached;
    const low = mask & -mask;
    const others = mask ^ low;
    let best = -Infinity;
    for (let s = others; ; s = (s - 1) & others) {
      const group = s | low;
      if (sumOf(group) === 0) best = Math.max(best, 1 + solve(mask ^ group));
      if (s === 0) break;
    }
    memo.set(mask, best);
    return best;
  }
  return solve((1 << count) - 1);
}

describe("minimizeTransfers", () => {
  test("1対1なら1回", () => {
    expect(flat(minimizeTransfers(balances(300, -300)))).toEqual([["B", "A", 300]]);
  });

  test("勝者が1人なら、全員がその人に払う（支払額の大きい順、同額なら座席順）", () => {
    expect(flat(minimizeTransfers(balances(300, -100, -100, -100)))).toEqual([
      ["B", "A", 100],
      ["C", "A", 100],
      ["D", "A", 100],
    ]);
    expect(flat(minimizeTransfers(balances(-50, 300, -150, -100)))).toEqual([
      ["C", "B", 150],
      ["D", "B", 100],
      ["A", "B", 50],
    ]);
  });

  test("合計0のグループに分けられるなら、分けて回数を減らす", () => {
    // 分けなければ3回、分ければ2回
    expect(flat(minimizeTransfers(balances(100, -100, 50, -50)))).toEqual([
      ["B", "A", 100],
      ["D", "C", 50],
    ]);
  });

  test("分け方が複数あるときは、収支の大きい人同士を優先してまとめる", () => {
    // 100と100、-100と-100：先頭の人(A)は、先に並ぶ相手(C)と組む
    expect(flat(minimizeTransfers(balances(100, 100, -100, -100)))).toEqual([
      ["C", "A", 100],
      ["D", "B", 100],
    ]);
  });

  test("複数のグループに分かれ、各グループ内は大きい順に組み合わせる", () => {
    // {A:+300, B:-200, C:-100} と {D:+50, E:-50}
    expect(flat(minimizeTransfers(balances(300, -200, -100, 50, -50)))).toEqual([
      ["B", "A", 200],
      ["C", "A", 100],
      ["E", "D", 50],
    ]);
  });

  test("分けられない場合は、人数−1回", () => {
    // 200, 70 / -120, -100, -50 は部分的に0にならない
    const result = minimizeTransfers(balances(200, -50, -100, 70, -120));
    expect(flat(result)).toEqual([
      ["E", "A", 120],
      ["C", "A", 80],
      ["B", "D", 50],
      ["C", "D", 20],
    ]);
  });

  test("収支0円の人は送金に登場しない", () => {
    expect(flat(minimizeTransfers(balances(100, 0, -100)))).toEqual([["C", "A", 100]]);
    expect(minimizeTransfers(balances(0, 0, 0))).toEqual([]);
    expect(minimizeTransfers([])).toEqual([]);
  });

  test("合計が0でない入力は拒否する", () => {
    expectDomainError(() => minimizeTransfers(balances(100, -50)), "RESULT_INVALID");
  });

  test("ランダムな入力：全員の収支が0になり、回数は理論上の最小（人数−最大グループ数）", () => {
    const random = rng(20260921);
    for (let round = 0; round < 300; round++) {
      const count = 2 + Math.floor(random() * 9); // 2〜10人
      const values: number[] = [];
      for (let i = 0; i < count - 1; i++) {
        // 0円の人や、同額・打ち消し合う値が出やすいよう小さめの範囲にする
        values.push((Math.floor(random() * 9) - 4) * 50);
      }
      values.push(0 - values.reduce((sum, v) => sum + v, 0));

      const transfers = minimizeTransfers(balances(...values));

      // 送金後の残高がすべて0
      const remaining = new Map<string, number>();
      values.forEach((v, i) => remaining.set(String.fromCharCode(65 + i), v));
      for (const t of transfers) {
        expect(t.amount > 0).toBe(true);
        remaining.set(t.from, (remaining.get(t.from) ?? 0) + t.amount);
        remaining.set(t.to, (remaining.get(t.to) ?? 0) - t.amount);
      }
      for (const value of remaining.values()) expect(value).toBe(0);

      // 送金の向き：支払う人は必ず負、受け取る人は必ず正
      for (const t of transfers) {
        const from = values[t.from.charCodeAt(0) - 65] ?? 0;
        const to = values[t.to.charCodeAt(0) - 65] ?? 0;
        expect(from < 0 && to > 0).toBe(true);
      }

      // 回数が最小
      const nonZero = values.filter((v) => v !== 0);
      const expected = nonZero.length === 0 ? 0 : nonZero.length - maxZeroGroups(nonZero);
      expect(transfers.length).toBe(expected);
    }
  });
});
