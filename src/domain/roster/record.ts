/**
 * 対局の確定記録（GameRecord）の作成と並べ替え。純粋関数。
 */
import { DomainError } from "../shared/errors";
import { project } from "../game/game";
import type { Game } from "../game/types";
import type { PlayerResult, Settlement } from "../settlement/types";
import type { GameRecord } from "./types";

/**
 * 結果入力待ち（精算まで済んだ）対局から、確定記録を作る。
 * - 記録の日時は、対局を始めた時刻
 * - 打ったハンド数は、対局が終わった時点のハンド数
 * - 精算結果は座席順に並べ直す。参加者と過不足があれば RESULT_INVALID
 */
export function createGameRecord(input: {
  readonly game: Game;
  readonly settlement: Settlement;
}): GameRecord {
  const { game, settlement } = input;
  const state = project(game);
  if (state.phase !== "ResultPending") {
    throw new DomainError(
      "NOT_RESULT_PENDING",
      "結果入力に進んでいない対局は、記録できません",
    );
  }

  const byId = new Map<string, PlayerResult>(
    settlement.results.map((r) => [r.playerId, r]),
  );
  const results: PlayerResult[] = [];
  for (const seat of game.seats) {
    const result = byId.get(seat.id);
    if (!result) {
      throw new DomainError("RESULT_INVALID", "精算結果に参加者が足りません");
    }
    results.push(result);
  }
  if (byId.size !== game.seats.length || settlement.results.length !== byId.size) {
    throw new DomainError("RESULT_INVALID", "精算結果に参加者以外が含まれています");
  }

  return {
    gameId: game.id,
    playedAt: game.createdAt,
    settings: game.settings,
    players: game.seats,
    handsPlayed: state.handNumber,
    results,
    transfers: settlement.transfers,
    settledAt: null,
  };
}

/** 新しい順に並べる（同時刻ならgameIdの降順で、結果が毎回同じになるようにする） */
export function sortRecordsNewestFirst(
  records: readonly GameRecord[],
): GameRecord[] {
  return [...records].sort((a, b) => {
    const byTime = Date.parse(b.playedAt) - Date.parse(a.playedAt);
    if (byTime !== 0) return byTime;
    return a.gameId < b.gameId ? 1 : a.gameId > b.gameId ? -1 : 0;
  });
}
