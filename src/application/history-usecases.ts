/** 履歴・通算成績のユースケース。HistoryUseCases の実装 */
import { sortRecordsNewestFirst } from "../domain/roster/record";
import { aggregateStats } from "../domain/roster/stats";
import type {
  GameRecord,
  GameRecordRepository,
  PlayerRepository,
  PlayerStats,
} from "../domain/roster/types";
import { gameId } from "../domain/shared/constructors";
import { DomainError } from "../domain/shared/errors";
import type { HistoryUseCases } from "./types";

export interface HistoryUseCasesDeps {
  readonly gameRecordRepo: GameRecordRepository;
  readonly playerRepo: PlayerRepository;
}

export class HistoryUseCasesImpl implements HistoryUseCases {
  private readonly deps: HistoryUseCasesDeps;

  constructor(deps: HistoryUseCasesDeps) {
    this.deps = deps;
  }

  async listRecords(): Promise<readonly GameRecord[]> {
    return sortRecordsNewestFirst(await this.deps.gameRecordRepo.findAll());
  }

  async getRecord(id: string): Promise<GameRecord> {
    const record = (await this.deps.gameRecordRepo.findAll()).find((r) => r.gameId === id);
    if (!record) {
      throw new DomainError("RECORD_NOT_FOUND", `記録が見つかりません: ${id}`);
    }
    return record;
  }

  async deleteRecord(id: string): Promise<void> {
    const exists = (await this.deps.gameRecordRepo.findAll()).some((r) => r.gameId === id);
    if (!exists) {
      throw new DomainError("RECORD_NOT_FOUND", `記録が見つかりません: ${id}`);
    }
    await this.deps.gameRecordRepo.remove(gameId(id));
  }

  async getPlayerStats(): Promise<readonly PlayerStats[]> {
    const [records, roster] = await Promise.all([
      this.deps.gameRecordRepo.findAll(),
      this.deps.playerRepo.findAll(),
    ]);
    return aggregateStats(records, roster);
  }
}
