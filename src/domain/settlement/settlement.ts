/**
 * 精算の計算：チップ収支 → 円換算 → 最小回数の送金リスト
 */
import { convertToYen } from "./converter";
import { minimizeTransfers } from "./transfers";
import type { PlayerNetChips, Settlement, SettlementCalculator } from "./types";
import type { MilliYenPerChip } from "../shared/types";

export function calculateSettlement(
  netChips: readonly PlayerNetChips[],
  rate: MilliYenPerChip,
): Settlement {
  const results = convertToYen(netChips, rate);
  const transfers = minimizeTransfers(
    results.map((r) => ({ playerId: r.playerId, netYen: r.netYen })),
  );
  return { results, transfers };
}

export const settlementCalculator: SettlementCalculator = {
  calculate: calculateSettlement,
};
