import { describe, expect, test } from "vitest";
import { RosterUseCasesImpl } from "./roster-usecases";
import { FixedClock, SequentialIdGenerator } from "./testing";
import { expectDomainError } from "../domain/shared/testing";
import { MemoryKeyValueStore } from "../infrastructure/storage/key-value-store";
import { StoragePlayerRepository } from "../infrastructure/storage/repositories";

function setup() {
  const playerRepo = new StoragePlayerRepository(new MemoryKeyValueStore());
  const roster = new RosterUseCasesImpl({
    playerRepo,
    clock: new FixedClock("2026-09-20T00:00:00.000Z"),
    idGen: new SequentialIdGenerator(),
  });
  return { playerRepo, roster };
}

describe("register / list", () => {
  test("登録した人が、登録順に並ぶ", async () => {
    const { roster } = setup();
    await roster.register("Alice");
    await roster.register("Bob");
    expect((await roster.list()).map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  test("同じ名前は登録できない", async () => {
    const { roster } = setup();
    await roster.register("Alice");
    await expectRejects(() => roster.register("alice"), "DUPLICATE_PLAYER_NAME");
  });
});

describe("registerOrFind", () => {
  test("同じ名前がいれば、その人を返す（新規登録しない）", async () => {
    const { roster } = setup();
    const first = await roster.register("Alice");
    const found = await roster.registerOrFind(" alice ");
    expect(found.id).toBe(first.id);
    expect((await roster.list())).toHaveLength(1);
  });

  test("いなければ新規登録する", async () => {
    const { roster } = setup();
    const player = await roster.registerOrFind("Bob");
    expect(player.name).toBe("Bob");
    expect((await roster.list()).map((p) => p.name)).toEqual(["Bob"]);
  });
});

describe("rename", () => {
  test("名前を変えられる", async () => {
    const { roster } = setup();
    const alice = await roster.register("Alice");
    const renamed = await roster.rename(alice.id, "Alicia");
    expect(renamed.name).toBe("Alicia");
    expect((await roster.list()).map((p) => p.name)).toEqual(["Alicia"]);
  });

  test("他の人と同じ名前にはできない", async () => {
    const { roster } = setup();
    const alice = await roster.register("Alice");
    await roster.register("Bob");
    await expectRejects(() => roster.rename(alice.id, "bob"), "DUPLICATE_PLAYER_NAME");
  });
});

describe("remove", () => {
  test("名簿から削除できる", async () => {
    const { roster } = setup();
    const alice = await roster.register("Alice");
    await roster.remove(alice.id);
    expect(await roster.list()).toEqual([]);
  });
});

async function expectRejects(fn: () => Promise<unknown>, code: Parameters<typeof expectDomainError>[1]): Promise<void> {
  let rejected: unknown;
  try {
    await fn();
  } catch (error) {
    rejected = error;
  }
  if (rejected === undefined) throw new Error(`DomainError(${code}) が投げられませんでした`);
  expectDomainError(() => {
    throw rejected;
  }, code);
}
