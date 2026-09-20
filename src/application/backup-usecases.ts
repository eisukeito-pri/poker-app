/** バックアップのユースケース。BackupUseCases の実装 */
import type {
  BackupCodec,
  BackupFile,
  BackupStorage,
  BackupUseCases,
  Clock,
} from "./types";

export interface BackupUseCasesDeps {
  readonly storage: BackupStorage;
  readonly codec: BackupCodec;
  readonly clock: Clock;
}

export class BackupUseCasesImpl implements BackupUseCases {
  private readonly deps: BackupUseCasesDeps;

  constructor(deps: BackupUseCasesDeps) {
    this.deps = deps;
  }

  async exportBackup(): Promise<BackupFile> {
    const data = this.deps.storage.createBackup(this.deps.clock.now());
    return {
      fileName: this.deps.codec.fileName(data.exportedAt),
      content: this.deps.codec.serialize(data),
    };
  }

  async importBackup(content: string): Promise<void> {
    const data = this.deps.codec.parse(content);
    this.deps.storage.restore(data);
  }

  async wipeAllData(): Promise<void> {
    this.deps.storage.wipe();
  }
}
