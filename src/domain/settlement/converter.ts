/**
 * チップ収支 → 円（1円単位）への換算。最大剰余法で、合計が必ず0円になる。
 */
import { yen } from "../shared/constructors";
import { DomainError } from "../shared/errors";
import type { MilliYenPerChip } from "../shared/types";
import type {
  ChipsToYenConverter,
  PlayerNetChips,
  PlayerResult,
} from "./types";

const MILLI = 1000;

export function convertToYen(
  netChips: readonly PlayerNetChips[],
  rate: MilliYenPerChip,
): readonly PlayerResult[] {
  const total = netChips.reduce<number>((sum, p) => sum + p.netChips, 0);
  if (total !== 0) {
    throw new DomainError("RESULT_INVALID", "チップ収支の合計が0ではありません");
  }

  const parts = netChips.map((p, index) => {
    const exact = p.netChips * rate; // 1/1000円単位の整数
    if (!Number.isSafeInteger(exact)) {
      throw new DomainError("RESULT_INVALID", "金額が大きすぎて換算できません");
    }
    const remainder = ((exact % MILLI) + MILLI) % MILLI; // 0〜999
    return {
      playerId: p.playerId,
      netChips: p.netChips,
      index,
      floorYen: (exact - remainder) / MILLI,
      remainder,
    };
  });

  // 切り捨てた結果の合計は0以下。足りない円数を、余りの大きい人から1円ずつ配る
  const shortfall = -parts.reduce<number>((sum, p) => sum + p.floorYen, 0);
  const receivers = new Set(
    [...parts]
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
      .slice(0, shortfall)
      .map((p) => p.index),
  );

  return parts.map((p) => ({
    playerId: p.playerId,
    netChips: p.netChips,
    netYen: yen(p.floorYen + (receivers.has(p.index) ? 1 : 0)),
  }));
}

export const chipsToYenConverter: ChipsToYenConverter = {
  convert: convertToYen,
};
