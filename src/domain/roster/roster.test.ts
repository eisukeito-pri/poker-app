import { describe, expect, test } from "vitest";
import { playerId } from "../shared/constructors";
import { expectDomainError } from "../shared/testing";
import {
  MAX_NAME_LENGTH,
  normalizePlayerName,
  registerPlayer,
  removePlayer,
  renamePlayer,
} from "./roster";
import type { Player } from "./types";

const NOW = "2026-09-20T00:00:00.000Z";

function roster(...names: string[]): Player[] {
  return names.map((name, i) => ({
    id: playerId(`p${i + 1}`),
    name,
    createdAt: NOW,
  }));
}

describe("normalizePlayerName", () => {
  test("前後の空白（全角も）を除く", () => {
    expect(normalizePlayerName("  Alice ")).toBe("Alice");
    expect(normalizePlayerName("\u3000太郎\u3000")).toBe("太郎");
  });

  test("1〜20文字（絵文字は1文字）", () => {
    expect(normalizePlayerName("あ")).toBe("あ");
    expect(normalizePlayerName("a".repeat(MAX_NAME_LENGTH))).toBe("a".repeat(20));
    expect(normalizePlayerName("😀".repeat(20))).toBe("😀".repeat(20));
    expectDomainError(() => normalizePlayerName("a".repeat(21)), "INVALID_PLAYER_NAME");
    expectDomainError(() => normalizePlayerName("😀".repeat(21)), "INVALID_PLAYER_NAME");
  });

  test("空・空白だけは拒否する", () => {
    expectDomainError(() => normalizePlayerName(""), "INVALID_PLAYER_NAME");
    expectDomainError(() => normalizePlayerName("  \u3000 "), "INVALID_PLAYER_NAME");
  });
});

describe("registerPlayer", () => {
  test("登録順に末尾へ追加され、名前は整形される", () => {
    const first = registerPlayer([], { id: playerId("a"), name: " Alice ", now: NOW });
    expect(first.player).toEqual({ id: "a", name: "Alice", createdAt: NOW });
    const second = registerPlayer(first.players, { id: playerId("b"), name: "Bob", now: NOW });
    expect(second.players.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  test("同じ名前は登録できない（英字の大小・前後の空白は無視）", () => {
    const players = roster("Alice");
    const attempt = (name: string) => () =>
      registerPlayer(players, { id: playerId("x"), name, now: NOW });
    expectDomainError(attempt("Alice"), "DUPLICATE_PLAYER_NAME");
    expectDomainError(attempt("alice"), "DUPLICATE_PLAYER_NAME");
    expectDomainError(attempt(" ALICE "), "DUPLICATE_PLAYER_NAME");
    expect(registerPlayer(players, { id: playerId("x"), name: "Alicia", now: NOW }).players).toHaveLength(2);
  });

  test("同じIDは登録できない", () => {
    expectDomainError(
      () => registerPlayer(roster("Alice"), { id: playerId("p1"), name: "Bob", now: NOW }),
      "INVALID_PLAYERS",
    );
  });

  test("元の名簿は変更されない", () => {
    const players = roster("Alice");
    registerPlayer(players, { id: playerId("x"), name: "Bob", now: NOW });
    expect(players).toHaveLength(1);
  });
});

describe("renamePlayer", () => {
  test("順番と登録日時はそのままで、名前だけ変わる", () => {
    const result = renamePlayer(roster("Alice", "Bob", "Carol"), playerId("p2"), " Bobby ");
    expect(result.players.map((p) => p.name)).toEqual(["Alice", "Bobby", "Carol"]);
    expect(result.player).toEqual({ id: "p2", name: "Bobby", createdAt: NOW });
  });

  test("自分自身の名前の大小だけを変えるのはOK。他の人と同じ名前はNG", () => {
    const players = roster("Alice", "Bob");
    expect(renamePlayer(players, playerId("p1"), "ALICE").player.name).toBe("ALICE");
    expectDomainError(() => renamePlayer(players, playerId("p1"), "bob"), "DUPLICATE_PLAYER_NAME");
  });

  test("名簿にいない人・不正な名前は拒否する", () => {
    expectDomainError(() => renamePlayer(roster("Alice"), playerId("zz"), "X"), "PLAYER_NOT_FOUND");
    expectDomainError(() => renamePlayer(roster("Alice"), playerId("p1"), " "), "INVALID_PLAYER_NAME");
  });
});

describe("removePlayer", () => {
  test("指定した人だけ削除する", () => {
    expect(removePlayer(roster("Alice", "Bob"), playerId("p1")).map((p) => p.name)).toEqual(["Bob"]);
  });

  test("名簿にいない人は拒否する", () => {
    expectDomainError(() => removePlayer(roster("Alice"), playerId("zz")), "PLAYER_NOT_FOUND");
  });
});
