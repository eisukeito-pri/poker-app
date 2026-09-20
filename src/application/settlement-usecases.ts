/**
 * 結果入力・精算のユースケース。SettlementUseCases の実装。
 *
 * ResultSheet はその場で組み立てる（保存するのは生の入力値だけ）：
 * 現在の対局の状態（脱落者など）と、保存されている入力途中の値から、
 * 毎回 resultSheetOperations で作り直す。脱落状態が変わって「種類」が
 * 変わった人の値は、ResultSheet 側のロジックで自動的に捨てられる。
 *
 * お金のやりとりは対局ごとには行わない。recordGame() は対局の結果を
 * 未精算（settledAt: null）のまま履歴に保存するだけで、「次の対局へ」
 * 「精算して支払いへ」のどちらでも呼ばれる。実際にお金を動かす単位は
 * settleUp()（未精算の対局をまとめて1回の精算にする）。
 */
import { project } from "../domain/game/game";
import type { Game, GameRepository } from "../domain/game/types";
import { pendingRecordsOf, aggregatePendingSettlement } from "../domain/roster/pending-settlement";
import { createGameRecord, sortRecordsNewestFirst } from "../domain/roster/record";
import type {
  GameRecord,
  GameRecordRepository,
  SettlementRecord,
  SettlementRecordRepository,
} from "../domain/roster/types";
import { chips } from "../domain/shared/constructors";
import { DomainError } from "../domain/shared/errors";
import type { PlayerId } from "../domain/shared/types";
import { resultSheetOperations } from "../domain/settlement/result-sheet";
import { calculateSettlement } from "../domain/settlement/settlement";
import type {
  PlayerNetChips,
  ResultDraftRepository,
  ResultSheet,
  Settlement,
} from "../domain/settlement/types";
import type { Clock, IdGenerator, PendingSettlementView, SettlementUseCases } from "./types";
import { playerId as toPlayerId } from "../domain/shared/constructors";

export interface SettlementUseCasesDeps {
  readonly gameRepo: GameRepository;
  readonly resultDraftRepo: ResultDraftRepository;
  readonly gameRecordRepo: GameRecordRepository;
  readonly settlementRecordRepo: SettlementRecordRepository;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

export class SettlementUseCasesImpl implements SettlementUseCases {
  private readonly deps: SettlementUseCasesDeps;

  constructor(deps: SettlementUseCasesDeps) {
    this.deps = deps;
  }

  private async requireResultPendingGame(): Promise<Game> {
    const game = await this.deps.gameRepo.findCurrent();
    if (!game) {
      throw new DomainError("NO_CURRENT_GAME", "進行中の対局がありません");
    }
    if (project(game).phase !== "ResultPending") {
      throw new DomainError(
        "NOT_RESULT_PENDING",
        "結果入力に進んでいません（先に「結果入力へ」を押してください）",
      );
    }
    return game;
  }

  private async buildSheet(game: Game): Promise<ResultSheet> {
    const state = project(game);
    let sheet = resultSheetOperations.create({
      seatOrder: game.seats.map((s) => s.id),
      eliminatedIds: state.eliminatedPlayerIds,
      startingChips: game.settings.startingChips,
    });

    const draft = await this.deps.resultDraftRepo.find(game.id);
    if (!draft) return sheet;

    const inputKinds = new Map(sheet.entries.map((e) => [e.playerId, e.kind]));
    for (const input of draft.inputs) {
      // 対局の状態が変わり、入力欄でなくなった人の値は読み込まない（自然に破棄される）
      if (inputKinds.get(input.playerId) !== "Input") continue;
      sheet = resultSheetOperations.enter(sheet, input.playerId, input.netChips);
    }
    return sheet;
  }

  async getResultSheet(): Promise<ResultSheet> {
    const game = await this.requireResultPendingGame();
    return this.buildSheet(game);
  }

  async enterResult(playerIdRaw: string, netChips: number | null): Promise<ResultSheet> {
    const game = await this.requireResultPendingGame();
    const id: PlayerId = toPlayerId(playerIdRaw);
    const sheet = await this.buildSheet(game);
    const value = netChips === null ? null : chips(netChips);
    const updated = resultSheetOperations.enter(sheet, id, value);

    const inputs = updated.entries.flatMap((entry) =>
      entry.kind === "Input" && entry.netChips !== null
        ? [{ playerId: entry.playerId, netChips: entry.netChips }]
        : [],
    );
    await this.deps.resultDraftRepo.save({ gameId: game.id, inputs });
    return updated;
  }

  private settlementFromSheet(game: Game, sheet: ResultSheet): Settlement {
    if (!sheet.isComplete) {
      throw new DomainError("RESULT_INCOMPLETE", "まだ入力が終わっていない人がいます");
    }
    if (sheet.issues.length > 0) {
      throw new DomainError(
        "RESULT_INVALID",
        "入力値の範囲が正しくありません。入力を見直してください",
      );
    }
    const netChipsList: PlayerNetChips[] = sheet.entries.map((entry) => {
      if (entry.netChips === null) {
        throw new DomainError("RESULT_INCOMPLETE", "まだ入力が終わっていない人がいます");
      }
      return { playerId: entry.playerId, netChips: entry.netChips };
    });
    return calculateSettlement(netChipsList, game.settings.exchangeRate);
  }

  async recordGame(): Promise<GameRecord> {
    const game = await this.requireResultPendingGame();
    const sheet = await this.buildSheet(game);
    const settlement = this.settlementFromSheet(game, sheet);
    const record = createGameRecord({ game, settlement });

    try {
      await this.deps.gameRecordRepo.add(record);
    } catch (error) {
      // すでに保存済み（前回の途中失敗のあとの再試行）なら、そのまま後片付けへ進む
      const alreadySaved = error instanceof DomainError && error.code === "DUPLICATE_RECORD";
      if (!alreadySaved) throw error;
    }

    await this.deps.gameRepo.clearCurrent();
    await this.deps.resultDraftRepo.clear(game.id);
    return record;
  }

  async getPendingSettlement(): Promise<PendingSettlementView> {
    const allRecords = await this.deps.gameRecordRepo.findAll();
    const pending = pendingRecordsOf(allRecords);
    const { balances, transfers } = aggregatePendingSettlement(pending);
    return {
      pendingGames: sortRecordsNewestFirst(pending),
      balances,
      transfers,
    };
  }

  async settleUp(): Promise<SettlementRecord> {
    const allRecords = await this.deps.gameRecordRepo.findAll();
    const pending = pendingRecordsOf(allRecords);
    if (pending.length === 0) {
      throw new DomainError("NO_PENDING_SETTLEMENT", "未精算の対局がありません");
    }
    const { balances, transfers } = aggregatePendingSettlement(pending);
    const settledAt = this.deps.clock.now();
    const gameIds = sortRecordsNewestFirst(pending).map((r) => r.gameId);

    const settlementRecord: SettlementRecord = {
      id: this.deps.idGenerator.newSettlementId(),
      settledAt,
      gameIds,
      balances,
      transfers,
    };

    await this.deps.settlementRecordRepo.add(settlementRecord);
    await this.deps.gameRecordRepo.markSettled(gameIds, settledAt);
    return settlementRecord;
  }
}
