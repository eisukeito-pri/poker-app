import { describe, expect, test } from "vitest";
import { chips, playerId } from "../shared/constructors";
import { expectDomainError } from "../shared/testing";
import type { PlayerId } from "../shared/types";
import { resultSheetOperations as sheets } from "./result-sheet";
import type { ResultSheet } from "./types";

const ids = (...names: string[]): PlayerId[] => names.map(playerId);
const START = chips(1000);

function create(eliminated: string[] = ["E"], seat: string[] = ["A", "B", "C", "D", "E"]) {
  return sheets.create({
    seatOrder: ids(...seat),
    eliminatedIds: ids(...eliminated),
    startingChips: START,
  });
}

function enter(sheet: ResultSheet, id: string, value: number | null): ResultSheet {
  return sheets.enter(sheet, playerId(id), value === null ? null : chips(value));
}

function entryOf(sheet: ResultSheet, id: string) {
  const entry = sheet.entries.find((e) => e.playerId === id);
  if (!entry) throw new Error(`entry not found: ${id}`);
  return entry;
}

const kinds = (sheet: ResultSheet) => sheet.entries.map((e) => e.kind);
const nets = (sheet: ResultSheet) => sheet.entries.map((e) => e.netChips);

describe("create", () => {
  test("脱落者は−開始チップで確定、一番後ろの生存者が自動入力、他は未入力", () => {
    const sheet = create(["E"]);
    expect(kinds(sheet)).toEqual(["Input", "Input", "Input", "AutoFilled", "Eliminated"]);
    expect(nets(sheet)).toEqual([null, null, null, null, -1000]);
    expect(sheet.isComplete).toBe(false);
    expect(sheet.canSettle).toBe(false);
    expect(sheet.issues).toEqual([]);
  });

  test("脱落者がいなければ、座席順で最後の人が自動入力", () => {
    expect(kinds(create([]))).toEqual(["Input", "Input", "Input", "Input", "AutoFilled"]);
  });

  test("生存者が1人なら、その人が全員の負けを受け取って即完成する", () => {
    const sheet = create(["B", "C", "D", "E"]);
    expect(entryOf(sheet, "A").kind).toBe("AutoFilled");
    expect(entryOf(sheet, "A").netChips).toBe(4000);
    expect(sheet.isComplete).toBe(true);
    expect(sheet.canSettle).toBe(true);
  });

  test("生存者がいない・IDの重複・存在しない脱落者は拒否する", () => {
    expectDomainError(() => create(["A", "B", "C", "D", "E"]), "RESULT_INVALID");
    expectDomainError(() => create([], ["A", "A", "B"]), "INVALID_PLAYERS");
    expectDomainError(() => create(["Z"]), "PLAYER_NOT_FOUND");
  });
});

describe("enter", () => {
  test("最後の一人以外を入力すると、合計0になる値が自動で入る", () => {
    let sheet = create(["E"]);
    sheet = enter(sheet, "A", 500);
    sheet = enter(sheet, "B", -200);
    expect(entryOf(sheet, "D").netChips).toBeNull(); // まだ揃っていない
    sheet = enter(sheet, "C", 100);
    // D = -(500 - 200 + 100 - 1000) = 600
    expect(entryOf(sheet, "D").netChips).toBe(600);
    expect(sheet.isComplete).toBe(true);
    expect(sheet.canSettle).toBe(true);
    expect(nets(sheet).reduce<number>((sum, v) => sum + (v ?? 0), 0)).toBe(0);
  });

  test("0の入力は入力済みとして扱う", () => {
    let sheet = create(["E"]);
    sheet = enter(sheet, "A", 0);
    sheet = enter(sheet, "B", 0);
    sheet = enter(sheet, "C", 0);
    expect(entryOf(sheet, "A").netChips).toBe(0);
    expect(entryOf(sheet, "D").netChips).toBe(1000); // 脱落者の-1000を受け取る
    expect(sheet.isComplete).toBe(true);
  });

  test("入力の修正・消去ができ、自動入力の値も追従する", () => {
    let sheet = create(["E"]);
    sheet = enter(sheet, "A", 500);
    sheet = enter(sheet, "B", -200);
    sheet = enter(sheet, "C", 100);
    sheet = enter(sheet, "C", 300);
    expect(entryOf(sheet, "D").netChips).toBe(400);
    sheet = enter(sheet, "A", null);
    expect(entryOf(sheet, "A").netChips).toBeNull();
    expect(entryOf(sheet, "D").netChips).toBeNull();
    expect(sheet.isComplete).toBe(false);
    expect(sheet.canSettle).toBe(false);
  });

  test("脱落者と自動入力の人には入力できない", () => {
    const sheet = create(["E"]);
    expectDomainError(() => enter(sheet, "E", 100), "RESULT_INVALID");
    expectDomainError(() => enter(sheet, "D", 100), "RESULT_INVALID");
    expectDomainError(() => enter(sheet, "Z", 100), "PLAYER_NOT_FOUND");
  });

  test("元のシートは変更されない", () => {
    const sheet = create(["E"]);
    enter(sheet, "A", 500);
    expect(entryOf(sheet, "A").netChips).toBeNull();
  });
});

describe("範囲外の入力（警告して精算不可）", () => {
  test("下限：−開始チップより小さい入力", () => {
    let sheet = create(["E"]);
    sheet = enter(sheet, "A", -1001);
    expect(sheet.issues).toEqual([{ playerId: "A", code: "BELOW_MINIMUM" }]);
    expect(sheet.canSettle).toBe(false);
    sheet = enter(sheet, "A", -1000);
    expect(sheet.issues).toEqual([]);
  });

  test("上限：(人数−1)×開始チップより大きい入力（5人なら4000）", () => {
    let sheet = create(["E"]);
    sheet = enter(sheet, "A", 4001);
    expect(sheet.issues).toEqual([{ playerId: "A", code: "ABOVE_MAXIMUM" }]);
    sheet = enter(sheet, "A", 4000);
    expect(sheet.issues).toEqual([]);
  });

  test("最後の一人の自動入力が範囲外なら、警告して精算不可", () => {
    let sheet = create(["E"]);
    sheet = enter(sheet, "A", 1000);
    sheet = enter(sheet, "B", 1000);
    sheet = enter(sheet, "C", 1000);
    // D = -(3000 - 1000) = -2000（下限 -1000 を下回る）
    expect(entryOf(sheet, "D").netChips).toBe(-2000);
    expect(sheet.isComplete).toBe(true);
    expect(sheet.issues).toEqual([{ playerId: "D", code: "BELOW_MINIMUM" }]);
    expect(sheet.canSettle).toBe(false);
  });

  test("値が不正（小数・絶対値が大きすぎる）な入力は拒否する", () => {
    const sheet = create(["E"]);
    expectDomainError(() => sheets.enter(sheet, playerId("A"), 1.5 as never), "RESULT_INVALID");
    expectDomainError(() => sheets.enter(sheet, playerId("A"), 2_000_000_000 as never), "RESULT_INVALID");
  });
});

describe("updateEliminated（結果入力画面での脱落・復帰）", () => {
  function filled(): ResultSheet {
    let sheet = create(["E"]);
    sheet = enter(sheet, "A", 500);
    sheet = enter(sheet, "B", -200);
    sheet = enter(sheet, "C", 100);
    return sheet;
  }

  test("入力済みの人が脱落：その人の値は破棄、他の人の値は保持", () => {
    const sheet = sheets.updateEliminated(filled(), ids("C", "E"));
    expect(kinds(sheet)).toEqual(["Input", "Input", "Eliminated", "AutoFilled", "Eliminated"]);
    expect(entryOf(sheet, "A").netChips).toBe(500);
    expect(entryOf(sheet, "B").netChips).toBe(-200);
    expect(entryOf(sheet, "C").netChips).toBe(-1000);
    // D = -(500 - 200 - 1000 - 1000) = 1700
    expect(entryOf(sheet, "D").netChips).toBe(1700);
    expect(sheet.isComplete).toBe(true);
  });

  test("脱落者が復帰：座席順で最後なら自動入力になり、元の自動入力の人は未入力に戻る", () => {
    const sheet = sheets.updateEliminated(filled(), []);
    expect(kinds(sheet)).toEqual(["Input", "Input", "Input", "Input", "AutoFilled"]);
    expect(entryOf(sheet, "A").netChips).toBe(500);
    expect(entryOf(sheet, "B").netChips).toBe(-200);
    expect(entryOf(sheet, "C").netChips).toBe(100);
    expect(entryOf(sheet, "D").netChips).toBeNull(); // 自動入力から入力欄に戻った → 未入力
    expect(entryOf(sheet, "E").netChips).toBeNull();
    expect(sheet.isComplete).toBe(false);
  });

  test("最後の生存者が脱落：一つ前の人が自動入力になり、その人の入力値は破棄される", () => {
    const sheet = sheets.updateEliminated(filled(), ids("D", "E"));
    expect(kinds(sheet)).toEqual(["Input", "Input", "AutoFilled", "Eliminated", "Eliminated"]);
    expect(entryOf(sheet, "A").netChips).toBe(500);
    expect(entryOf(sheet, "B").netChips).toBe(-200);
    // C = -(500 - 200 - 1000 - 1000) = 1700（元の入力100は破棄）
    expect(entryOf(sheet, "C").netChips).toBe(1700);
  });

  test("生存者が1人になれば即完成し、生存者がいなくなる変更は拒否する", () => {
    const one = sheets.updateEliminated(filled(), ids("B", "C", "D", "E"));
    expect(entryOf(one, "A").kind).toBe("AutoFilled");
    expect(entryOf(one, "A").netChips).toBe(4000);
    expect(one.canSettle).toBe(true);
    expectDomainError(
      () => sheets.updateEliminated(filled(), ids("A", "B", "C", "D", "E")),
      "RESULT_INVALID",
    );
    expectDomainError(() => sheets.updateEliminated(filled(), ids("Z")), "PLAYER_NOT_FOUND");
  });

  test("脱落状態が変わっていなければ、入力値はすべて保持される", () => {
    const before = filled();
    expect(sheets.updateEliminated(before, ids("E"))).toEqual(before);
  });
});
