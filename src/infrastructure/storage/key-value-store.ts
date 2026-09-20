/**
 * 保存先の抽象化。ブラウザの localStorage と同じ形なので、そのまま渡せる。
 * テストでは MemoryKeyValueStore を使う。
 */
import { DomainError } from "../../domain/shared/errors";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** テスト用のメモリ保存。失敗のシミュレーションもできる */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly items = new Map<string, string>();
  /** true を返したキーへの書き込みを失敗させる（容量超過などの再現用） */
  shouldFailWrite: (key: string) => boolean = () => false;
  /** true を返したキーの削除を失敗させる */
  shouldFailRemove: (key: string) => boolean = () => false;

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.shouldFailWrite(key)) {
      throw new Error("QuotaExceededError (simulated)");
    }
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    if (this.shouldFailRemove(key)) {
      throw new Error("remove failed (simulated)");
    }
    this.items.delete(key);
  }

  keys(): string[] {
    return [...this.items.keys()];
  }
}

/** ブラウザの localStorage。使えない環境（プライベートモード等）では STORAGE_FAILED */
export function browserLocalStorage(): KeyValueStore {
  try {
    const storage = globalThis.localStorage;
    const probe = "poker.__probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    throw new DomainError(
      "STORAGE_FAILED",
      "この環境ではデータを保存できません（localStorageが使えません）",
    );
  }
}
