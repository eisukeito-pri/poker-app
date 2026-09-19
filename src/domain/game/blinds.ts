/**
 * ブラインドの計算（BlindScheduleの振る舞い）。純粋関数。
 */
import { chips } from "../shared/constructors";
import type { HandNumber } from "../shared/types";
import type { BlindCalculator, BlindSchedule, Blinds } from "./types";

/**
 * そのハンドのブラインド額。
 * BB = 初期BB + floor((hand-1) / 間隔) × 増加額、SB = ceil(BB / 2)
 */
export function blindsAt(schedule: BlindSchedule, hand: HandNumber): Blinds {
  const level = Math.floor((hand - 1) / schedule.increaseEveryHands);
  const bigBlind = schedule.initialBigBlind + level * schedule.increaseAmount;
  return {
    smallBlind: chips(Math.ceil(bigBlind / 2)),
    bigBlind: chips(bigBlind),
  };
}

/**
 * 現在のブラインドで打つ残りハンド数（現在のハンドを含む）。
 * 最終ハンドまでに上がらない場合、および増加額が0の場合は null。
 */
export function handsUntilIncrease(
  schedule: BlindSchedule,
  hand: HandNumber,
  totalHands: number,
): number | null {
  if (schedule.increaseAmount === 0) return null;
  const remaining =
    schedule.increaseEveryHands - ((hand - 1) % schedule.increaseEveryHands);
  return hand + remaining <= totalHands ? remaining : null;
}

export const blindCalculator: BlindCalculator = {
  blindsAt,
  handsUntilIncrease,
};
