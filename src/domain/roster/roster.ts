/**
 * 名簿の操作（純粋関数）。常に新しい配列を返し、元は変更しない。
 *
 * ルール：
 * - 名前は前後の空白を除いて1〜20文字
 * - 同じ名前は登録できない（英字の大小は区別しない）
 * - 名簿は登録順に並ぶ
 */
import { DomainError } from "../shared/errors";
import type { IsoDateTime, PlayerId } from "../shared/types";
import type { Player } from "./types";

export const MAX_NAME_LENGTH = 20;

/** 前後の空白を除いた名前を返す。1〜20文字でなければ INVALID_PLAYER_NAME */
export function normalizePlayerName(raw: string): string {
  const name = raw.trim();
  const length = [...name].length; // 絵文字なども1文字と数える
  if (length < 1 || length > MAX_NAME_LENGTH) {
    throw new DomainError(
      "INVALID_PLAYER_NAME",
      `名前は1〜${MAX_NAME_LENGTH}文字で入力してください`,
    );
  }
  return name;
}

const nameKey = (name: string): string => name.toLowerCase();

function assertNameAvailable(
  players: readonly Player[],
  name: string,
  exceptId?: PlayerId,
): void {
  const taken = players.some(
    (p) => p.id !== exceptId && nameKey(p.name) === nameKey(name),
  );
  if (taken) {
    throw new DomainError(
      "DUPLICATE_PLAYER_NAME",
      `「${name}」はすでに登録されています`,
    );
  }
}

export function registerPlayer(
  players: readonly Player[],
  input: { readonly id: PlayerId; readonly name: string; readonly now: IsoDateTime },
): { readonly players: readonly Player[]; readonly player: Player } {
  const name = normalizePlayerName(input.name);
  if (players.some((p) => p.id === input.id)) {
    throw new DomainError("INVALID_PLAYERS", "同じIDの人がすでに登録されています");
  }
  assertNameAvailable(players, name);
  const player: Player = { id: input.id, name, createdAt: input.now };
  return { players: [...players, player], player };
}

export function renamePlayer(
  players: readonly Player[],
  id: PlayerId,
  rawName: string,
): { readonly players: readonly Player[]; readonly player: Player } {
  const current = players.find((p) => p.id === id);
  if (!current) {
    throw new DomainError("PLAYER_NOT_FOUND", "名簿にいません");
  }
  const name = normalizePlayerName(rawName);
  assertNameAvailable(players, name, id); // 自分自身の名前は除く（大小だけの変更もOK）
  const player: Player = { ...current, name };
  return {
    players: players.map((p) => (p.id === id ? player : p)),
    player,
  };
}

/** 名簿から削除する。過去の記録や成績には影響しない */
export function removePlayer(
  players: readonly Player[],
  id: PlayerId,
): readonly Player[] {
  if (!players.some((p) => p.id === id)) {
    throw new DomainError("PLAYER_NOT_FOUND", "名簿にいません");
  }
  return players.filter((p) => p.id !== id);
}
