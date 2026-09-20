/**
 * 通算成績の集計（保存済みの記録から計算する投影）。純粋関数。
 *
 * - 記録が1件以上ある人だけが対象
 * - 勝ち／負け／引き分けは、円換算後の収支の符号で判定
 * - 表示名は、名簿にいる人は現在の名前、いない人は最後（最新）の記録の名前
 * - 並び：通算収支の大きい順 → 勝ち数の多い順 → 名前順 → ID順
 */
import { yen } from "../shared/constructors";
import type { PlayerId } from "../shared/types";
import { sortRecordsNewestFirst } from "./record";
import type { GameRecord, Player, PlayerStats, StatsProjection } from "./types";

interface Accumulator {
  playerId: PlayerId;
  latestName: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  total: number;
  best: number;
  worst: number;
}

export function aggregateStats(
  records: readonly GameRecord[],
  roster: readonly Player[],
): readonly PlayerStats[] {
  const rosterNames = new Map<string, string>(roster.map((p) => [p.id, p.name]));
  const accumulators = new Map<string, Accumulator>();

  // 新しい記録から順に見るので、最初に見た名前が「最後の記録の名前」
  for (const record of sortRecordsNewestFirst(records)) {
    const snapshotNames = new Map<string, string>(
      record.players.map((p) => [p.id, p.name]),
    );
    for (const result of record.results) {
      const net: number = result.netYen;
      const current = accumulators.get(result.playerId);
      if (!current) {
        accumulators.set(result.playerId, {
          playerId: result.playerId,
          latestName: snapshotNames.get(result.playerId) ?? result.playerId,
          games: 1,
          wins: net > 0 ? 1 : 0,
          losses: net < 0 ? 1 : 0,
          draws: net === 0 ? 1 : 0,
          total: net,
          best: net,
          worst: net,
        });
        continue;
      }
      current.games += 1;
      if (net > 0) current.wins += 1;
      else if (net < 0) current.losses += 1;
      else current.draws += 1;
      current.total += net;
      current.best = Math.max(current.best, net);
      current.worst = Math.min(current.worst, net);
    }
  }

  const stats: PlayerStats[] = [...accumulators.values()].map((a) => ({
    playerId: a.playerId,
    name: rosterNames.get(a.playerId) ?? a.latestName,
    gamesPlayed: a.games,
    wins: a.wins,
    losses: a.losses,
    draws: a.draws,
    totalNetYen: yen(a.total),
    averageNetYen: a.total / a.games,
    bestNetYen: yen(a.best),
    worstNetYen: yen(a.worst),
  }));

  return stats.sort(
    (a, b) =>
      b.totalNetYen - a.totalNetYen ||
      b.wins - a.wins ||
      a.name.localeCompare(b.name, "ja") ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );
}

export const statsProjection: StatsProjection = { aggregate: aggregateStats };
