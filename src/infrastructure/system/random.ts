/**
 * 「ランダムで決める」ボタン用の乱数。crypto.getRandomValues があれば、
 * 棄却法（rejection sampling）で偏りなく整数を選ぶ。なければ Math.random にフォールバック。
 */
import type { RandomSource } from "../../application/types";

export const systemRandomSource: RandomSource = {
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError(`maxExclusive must be a positive integer: ${maxExclusive}`);
    }
    const cryptoObj = globalThis.crypto as Crypto | undefined;
    if (!cryptoObj?.getRandomValues) {
      return Math.floor(Math.random() * maxExclusive);
    }
    // 32bit値を、余りに偏りが出ない範囲まで棄却してから mod を取る
    const range = 0x100000000;
    const limit = range - (range % maxExclusive);
    const buffer = new Uint32Array(1);
    let value: number;
    do {
      cryptoObj.getRandomValues(buffer);
      value = buffer[0] ?? 0;
    } while (value >= limit);
    return value % maxExclusive;
  },
};
