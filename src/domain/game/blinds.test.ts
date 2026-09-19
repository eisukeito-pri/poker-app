import { describe, expect, test } from "vitest";
import { chips, handNumber } from "../shared/constructors";
import { blindsAt, handsUntilIncrease } from "./blinds";
import type { BlindSchedule } from "./types";

const schedule: BlindSchedule = {
  initialBigBlind: chips(100),
  increaseEveryHands: 5,
  increaseAmount: chips(50),
};

describe("blindsAt", () => {
  test("最初の間隔のあいだは初期ブラインド（SBはBBの半額）", () => {
    for (const hand of [1, 2, 3, 4, 5]) {
      expect(blindsAt(schedule, handNumber(hand))).toEqual({
        smallBlind: 50,
        bigBlind: 100,
      });
    }
  });

  test("間隔ごとにBBが増加額ぶん上がる", () => {
    expect(blindsAt(schedule, handNumber(6))).toEqual({
      smallBlind: 75,
      bigBlind: 150,
    });
    expect(blindsAt(schedule, handNumber(10))).toEqual({
      smallBlind: 75,
      bigBlind: 150,
    });
    expect(blindsAt(schedule, handNumber(11))).toEqual({
      smallBlind: 100,
      bigBlind: 200,
    });
  });

  test("SBが割り切れない場合は切り上げる", () => {
    const odd: BlindSchedule = {
      initialBigBlind: chips(25),
      increaseEveryHands: 1,
      increaseAmount: chips(10),
    };
    expect(blindsAt(odd, handNumber(1))).toEqual({ smallBlind: 13, bigBlind: 25 });
    expect(blindsAt(odd, handNumber(2))).toEqual({ smallBlind: 18, bigBlind: 35 });
  });

  test("増加額が0ならずっと同じ", () => {
    const flat: BlindSchedule = { ...schedule, increaseAmount: chips(0) };
    expect(blindsAt(flat, handNumber(50))).toEqual({
      smallBlind: 50,
      bigBlind: 100,
    });
  });
});

describe("handsUntilIncrease", () => {
  test("現在のハンドを含めた残りハンド数を返す", () => {
    expect(handsUntilIncrease(schedule, handNumber(1), 20)).toBe(5);
    expect(handsUntilIncrease(schedule, handNumber(4), 20)).toBe(2);
    expect(handsUntilIncrease(schedule, handNumber(5), 20)).toBe(1);
    expect(handsUntilIncrease(schedule, handNumber(6), 20)).toBe(5);
  });

  test("最終ハンドまでに上がらないならnull", () => {
    // 総8ハンド：6ハンド目に上がるが、その次（11ハンド目）は範囲外
    expect(handsUntilIncrease(schedule, handNumber(1), 8)).toBe(5);
    expect(handsUntilIncrease(schedule, handNumber(6), 8)).toBeNull();
    expect(handsUntilIncrease(schedule, handNumber(5), 5)).toBeNull();
  });

  test("増加額が0ならnull", () => {
    const flat: BlindSchedule = { ...schedule, increaseAmount: chips(0) };
    expect(handsUntilIncrease(flat, handNumber(1), 20)).toBeNull();
  });
});
