/**
 * 組み立て（コンポジションルート）。
 *
 * ここで、保存先（localStorage）とシステム側の実装（時刻・ID・乱数）を使って、
 * すべてのリポジトリとユースケースを組み立てる。画面（screens/）はここで作った
 * AppServices だけを使い、リポジトリや保存の仕組みを直接知らない。
 */
import { BackupUseCasesImpl } from "../application/backup-usecases";
import { GameUseCasesImpl } from "../application/game-usecases";
import { HistoryUseCasesImpl } from "../application/history-usecases";
import { RosterUseCasesImpl } from "../application/roster-usecases";
import { SettlementUseCasesImpl } from "../application/settlement-usecases";
import type {
  BackupUseCases,
  GameUseCases,
  HistoryUseCases,
  RosterUseCases,
  SettlementUseCases,
} from "../application/types";
import {
  AppDataStore,
  backupFileName,
  parseBackup,
  serializeBackup,
} from "../infrastructure/storage/backup";
import {
  browserLocalStorage,
  MemoryKeyValueStore,
} from "../infrastructure/storage/key-value-store";
import type { KeyValueStore } from "../infrastructure/storage/key-value-store";
import {
  StorageGameRecordRepository,
  StorageGameRepository,
  StorageLastGameSetupRepository,
  StoragePlayerRepository,
  StorageResultDraftRepository,
} from "../infrastructure/storage/repositories";
import { systemClock } from "../infrastructure/system/clock";
import { systemIdGenerator } from "../infrastructure/system/id-generator";
import { systemRandomSource } from "../infrastructure/system/random";

export interface AppServices {
  readonly game: GameUseCases;
  readonly settlement: SettlementUseCases;
  readonly roster: RosterUseCases;
  readonly history: HistoryUseCases;
  readonly backup: BackupUseCases;
  /**
   * false なら、この端末では localStorage が使えず、データは
   * このタブを閉じると消える（プライベートブラウズなど）。
   * UIで案内を出すために使う。
   */
  readonly isPersistent: boolean;
}

function resolveStore(): { store: KeyValueStore; isPersistent: boolean } {
  try {
    return { store: browserLocalStorage(), isPersistent: true };
  } catch {
    return { store: new MemoryKeyValueStore(), isPersistent: false };
  }
}

export function createAppServices(): AppServices {
  const { store, isPersistent } = resolveStore();

  const gameRepo = new StorageGameRepository(store);
  const lastSetupRepo = new StorageLastGameSetupRepository(store);
  const playerRepo = new StoragePlayerRepository(store);
  const resultDraftRepo = new StorageResultDraftRepository(store);
  const gameRecordRepo = new StorageGameRecordRepository(store);

  const game = new GameUseCasesImpl({
    gameRepo,
    lastSetupRepo,
    playerRepo,
    resultDraftRepo,
    clock: systemClock,
    idGen: systemIdGenerator,
    random: systemRandomSource,
  });
  const settlement = new SettlementUseCasesImpl({ gameRepo, resultDraftRepo, gameRecordRepo });
  const roster = new RosterUseCasesImpl({
    playerRepo,
    clock: systemClock,
    idGen: systemIdGenerator,
  });
  const history = new HistoryUseCasesImpl({ gameRecordRepo, playerRepo });
  const backup = new BackupUseCasesImpl({
    storage: new AppDataStore(store),
    codec: { serialize: serializeBackup, parse: parseBackup, fileName: backupFileName },
    clock: systemClock,
  });

  return { game, settlement, roster, history, backup, isPersistent };
}
