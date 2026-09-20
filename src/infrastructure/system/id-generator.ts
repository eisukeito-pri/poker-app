/**
 * ID生成。crypto.randomUUID() を使い、使えない環境ではフォールバックする。
 */
import type { IdGenerator } from "../../application/types";
import { gameId, playerId, settlementId } from "../../domain/shared/constructors";
import type { GameId, PlayerId, SettlementId } from "../../domain/shared/types";

function randomUuid(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();

  // フォールバック（crypto.randomUUID が使えない古い環境向け）
  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const b = bytes;
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(b, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const systemIdGenerator: IdGenerator = {
  newPlayerId(): PlayerId {
    return playerId(randomUuid());
  },
  newGameId(): GameId {
    return gameId(randomUuid());
  },
  newSettlementId(): SettlementId {
    return settlementId(randomUuid());
  },
};
