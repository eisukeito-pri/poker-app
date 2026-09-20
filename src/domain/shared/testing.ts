/** テスト専用のヘルパー（アプリ本体からは import しない） */
import { expect } from "vitest";
import { DomainError } from "./errors";
import type { DomainErrorCode } from "./errors";

/** fn が指定したcodeのDomainErrorを投げることを確認する */
export function expectDomainError(
  fn: () => unknown,
  code: DomainErrorCode,
): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`DomainError(${code}) が投げられませんでした`);
}
