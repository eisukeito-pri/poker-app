/**
 * 未精算の対局群から、まとめ払いの合算収支と送金リストを作る。純粋関数。
 *
 * 合算ルール：対象の各対局について、参加していた人だけを対象に、対局ごとの
 * netYen（すでに円換算済み）を人ごとに合計する。ある対局に参加していない人は、
 * その対局分は0円として扱う（＝無視する）。各対局の収支は必ず合計0円なので、
 * 合算後の収支も必ず合計0円になり、minimizeTransfers にそのまま渡せる。
 *
 * 名前のスナップショットは、対象の対局のうち、その人が参加した最新の対局の名前。
 */
import { yen } from "../shared/constructors";
import type { PlayerId } from "../shared/types";
import { minimizeTransfers } from "../settlement/transfers";
import type { Transfer } from "../settlement/types";
import { sortRecordsNewestFirst } from "./record";
import type { GameRecord, PlayerYenBalance } from "./types";

export interface PendingSettlementSummary {
  readonly balances: readonly PlayerYenBalance[];
  readonly transfers: readonly Transfer[];
}

/** 未精算（settledAt === null）の対局だけを、記録された順に返す */
export function pendingRecordsOf(
  records: readonly GameRecord[],
): readonly GameRecord[] {
  return records.filter((r) => r.settledAt === null);
}

export function aggregatePendingSettlement(
  pendingRecords: readonly GameRecord[],
): PendingSettlementSummary {
  interface Accumulator {
    playerId: PlayerId;
    latestName: string;
    total: number;
  }
  const accumulators = new Map<string, Accumulator>();

  // 新しい記録から順に見るので、最初に見た名前が「最新の対局の名前」
  for (const record of sortRecordsNewestFirst(pendingRecords)) {
    const snapshotNames = new Map<string, string>(
      record.players.map((p) => [p.id, p.name]),
    );
    for (const result of record.results) {
      const current = accumulators.get(result.playerId);
      if (!current) {
        accumulators.set(result.playerId, {
          playerId: result.playerId,
          latestName: snapshotNames.get(result.playerId) ?? result.playerId,
          total: result.netYen,
        });
      } else {
        current.total += result.netYen;
      }
    }
  }

  const balances: PlayerYenBalance[] = [...accumulators.values()]
    .map((a) => ({
      playerId: a.playerId,
      name: a.latestName,
      netYen: yen(a.total),
    }))
    .sort((a, b) => b.netYen - a.netYen || a.name.localeCompare(b.name, "ja"));

  const transfers = minimizeTransfers(
    balances.map((b) => ({ playerId: b.playerId, netYen: b.netYen })),
  );

  return { balances, transfers };
}
