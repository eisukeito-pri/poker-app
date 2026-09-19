/**
 * ブランド型の値を安全に作るための関数。
 * 入力チェックはここに集めておき、ドメインの他の場所では「作られた値は正しい」とみなす。
 */
import { DomainError } from "./errors";
import type {
  Chips,
  GameId,
  HandNumber,
  MilliYenPerChip,
  PlayerId,
} from "./types";

export const playerId = (value: string): PlayerId => value as PlayerId;
export const gameId = (value: string): GameId => value as GameId;

/** チップ数。整数のみ（負の値は収支として許可） */
export function chips(value: number): Chips {
  if (!Number.isInteger(value)) {
    throw new DomainError(
      "INVALID_SETTINGS",
      `チップは整数で指定してください: ${value}`,
    );
  }
  return value as Chips;
}

/** ハンド数。1以上の整数 */
export function handNumber(value: number): HandNumber {
  if (!Number.isInteger(value) || value < 1) {
    throw new DomainError(
      "INVALID_SETTINGS",
      `ハンド数は1以上の整数で指定してください: ${value}`,
    );
  }
  return value as HandNumber;
}

/**
 * 「1チップ＝○円」（小数第3位まで）を、内部表現（1/1000円単位の整数）に変換する。
 * 例）0.1 → 100、1 → 1000
 */
export function exchangeRateFromYen(yenPerChip: number): MilliYenPerChip {
  const milli = Math.round(yenPerChip * 1000);
  const isExact = Math.abs(yenPerChip * 1000 - milli) < 1e-6;
  if (!Number.isFinite(yenPerChip) || milli < 1 || !isExact) {
    throw new DomainError(
      "INVALID_SETTINGS",
      `換算レートは0より大きい、小数第3位までの数で指定してください: ${yenPerChip}`,
    );
  }
  return milli as MilliYenPerChip;
}
