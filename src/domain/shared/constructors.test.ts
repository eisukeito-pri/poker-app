import { describe, expect, test } from "vitest";
import { chips, exchangeRateFromYen, handNumber } from "./constructors";

describe("chips", () => {
  test("整数は受け付ける（負の値も可）", () => {
    expect(chips(100)).toBe(100);
    expect(chips(-300)).toBe(-300);
  });
  test("小数は拒否する", () => {
    expect(() => chips(1.5)).toThrow();
  });
});

describe("handNumber", () => {
  test("1以上の整数のみ", () => {
    expect(handNumber(1)).toBe(1);
    expect(() => handNumber(0)).toThrow();
    expect(() => handNumber(2.5)).toThrow();
  });
});

describe("exchangeRateFromYen", () => {
  test("1/1000円単位の整数に変換する", () => {
    expect(exchangeRateFromYen(0.1)).toBe(100);
    expect(exchangeRateFromYen(1)).toBe(1000);
    expect(exchangeRateFromYen(0.001)).toBe(1);
    expect(exchangeRateFromYen(2.5)).toBe(2500);
  });
  test("0以下・小数第4位以下・数でない値は拒否する", () => {
    expect(() => exchangeRateFromYen(0)).toThrow();
    expect(() => exchangeRateFromYen(-1)).toThrow();
    expect(() => exchangeRateFromYen(0.0001)).toThrow();
    expect(() => exchangeRateFromYen(0.1234)).toThrow();
    expect(() => exchangeRateFromYen(Number.NaN)).toThrow();
  });
});
