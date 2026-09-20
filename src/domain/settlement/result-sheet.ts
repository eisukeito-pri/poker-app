/**
 * ResultSheet（結果入力シート）の操作。純粋関数で、常に新しいシートを返す。
 *
 * ルール：
 * - 脱落者は −開始チップ全額で自動確定
 * - 生存者のうち座席順で一番後ろの1人は「自動入力」。他の全員がそろうと、
 *   全員の合計が0になる値が入る
 * - 値の範囲は −開始チップ 〜 (参加人数−1)×開始チップ。範囲外は issues に載り、
 *   canSettle が false になる（自動入力の値も対象）
 * - 状態が変わった人（脱落／復帰、自動入力の対象になった人・外れた人）の
 *   入力値は破棄し、それ以外の人の入力値は保持する
 */
import { chips } from "../shared/constructors";
import { DomainError } from "../shared/errors";
import { MAX_ABS_CHIPS } from "../shared/types";
import type { Chips, PlayerId } from "../shared/types";
import type {
  ResultEntry,
  ResultIssue,
  ResultSheet,
  ResultSheetOperations,
} from "./types";

interface BuildParams {
  readonly seatOrder: readonly PlayerId[];
  readonly eliminated: ReadonlySet<PlayerId>;
  readonly startingChips: Chips;
  /** 生存者（Input）の入力値 */
  readonly inputs: ReadonlyMap<PlayerId, Chips>;
}

function build(params: BuildParams): ResultSheet {
  const { seatOrder, eliminated, startingChips, inputs } = params;

  const survivors = seatOrder.filter((id) => !eliminated.has(id));
  const autoFilledId = survivors[survivors.length - 1];
  if (autoFilledId === undefined) {
    throw new DomainError("RESULT_INVALID", "生存者がいません");
  }
  const loss = chips(-startingChips);

  // 自動入力の人以外の値
  const others = seatOrder
    .filter((id) => id !== autoFilledId)
    .map((id) => (eliminated.has(id) ? loss : (inputs.get(id) ?? null)));
  const allOthersFilled = others.every((value) => value !== null);
  const othersTotal = others.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  // 0 から引くのは、-0 を避けるため
  const autoNet: Chips | null = allOthersFilled ? ((0 - othersTotal) as Chips) : null;

  const entries: ResultEntry[] = seatOrder.map((id): ResultEntry => {
    if (eliminated.has(id)) {
      return { kind: "Eliminated", playerId: id, netChips: loss };
    }
    if (id === autoFilledId) {
      return { kind: "AutoFilled", playerId: id, netChips: autoNet };
    }
    return { kind: "Input", playerId: id, netChips: inputs.get(id) ?? null };
  });

  const minimum = -startingChips;
  const maximum = (seatOrder.length - 1) * startingChips;
  const issues: ResultIssue[] = [];
  for (const entry of entries) {
    if (entry.kind === "Eliminated" || entry.netChips === null) continue;
    if (entry.netChips < minimum) {
      issues.push({ playerId: entry.playerId, code: "BELOW_MINIMUM" });
    } else if (entry.netChips > maximum) {
      issues.push({ playerId: entry.playerId, code: "ABOVE_MAXIMUM" });
    }
  }

  const isComplete = entries.every((entry) => entry.netChips !== null);
  return {
    entries,
    startingChips,
    isComplete,
    issues,
    canSettle: isComplete && issues.length === 0,
  };
}

function assertSeatOrder(seatOrder: readonly PlayerId[]): void {
  if (new Set(seatOrder).size !== seatOrder.length) {
    throw new DomainError("INVALID_PLAYERS", "参加者のIDが重複しています");
  }
}

function toEliminatedSet(
  seatOrder: readonly PlayerId[],
  eliminatedIds: readonly PlayerId[],
): ReadonlySet<PlayerId> {
  for (const id of eliminatedIds) {
    if (!seatOrder.includes(id)) {
      throw new DomainError("PLAYER_NOT_FOUND", `参加者ではありません: ${id}`);
    }
  }
  return new Set(eliminatedIds);
}

function seatOrderOf(sheet: ResultSheet): PlayerId[] {
  return sheet.entries.map((entry) => entry.playerId);
}

function eliminatedOf(sheet: ResultSheet): Set<PlayerId> {
  return new Set(
    sheet.entries
      .filter((entry) => entry.kind === "Eliminated")
      .map((entry) => entry.playerId),
  );
}

function inputsOf(sheet: ResultSheet): Map<PlayerId, Chips> {
  const inputs = new Map<PlayerId, Chips>();
  for (const entry of sheet.entries) {
    if (entry.kind === "Input" && entry.netChips !== null) {
      inputs.set(entry.playerId, entry.netChips);
    }
  }
  return inputs;
}

export function create(input: {
  readonly seatOrder: readonly PlayerId[];
  readonly eliminatedIds: readonly PlayerId[];
  readonly startingChips: Chips;
}): ResultSheet {
  assertSeatOrder(input.seatOrder);
  if (!Number.isInteger(input.startingChips) || input.startingChips < 1) {
    throw new DomainError("INVALID_SETTINGS", "開始チップは1以上の整数");
  }
  return build({
    seatOrder: input.seatOrder,
    eliminated: toEliminatedSet(input.seatOrder, input.eliminatedIds),
    startingChips: input.startingChips,
    inputs: new Map(),
  });
}

export function enter(
  sheet: ResultSheet,
  playerId: PlayerId,
  netChips: Chips | null,
): ResultSheet {
  const entry = sheet.entries.find((e) => e.playerId === playerId);
  if (!entry) {
    throw new DomainError("PLAYER_NOT_FOUND", `参加者ではありません: ${playerId}`);
  }
  if (entry.kind !== "Input") {
    throw new DomainError(
      "RESULT_INVALID",
      "この人の値は自動で決まるため、入力できません",
    );
  }
  if (
    netChips !== null &&
    (!Number.isInteger(netChips) || Math.abs(netChips) > MAX_ABS_CHIPS)
  ) {
    throw new DomainError("RESULT_INVALID", "入力値が不正です");
  }

  const inputs = inputsOf(sheet);
  if (netChips === null) inputs.delete(playerId);
  else inputs.set(playerId, netChips);

  return build({
    seatOrder: seatOrderOf(sheet),
    eliminated: eliminatedOf(sheet),
    startingChips: sheet.startingChips,
    inputs,
  });
}

export function updateEliminated(
  sheet: ResultSheet,
  eliminatedIds: readonly PlayerId[],
): ResultSheet {
  const seatOrder = seatOrderOf(sheet);
  const eliminated = toEliminatedSet(seatOrder, eliminatedIds);

  // いったん空の入力で作って、新しい「種類」を確かめる
  const next = build({
    seatOrder,
    eliminated,
    startingChips: sheet.startingChips,
    inputs: new Map(),
  });
  const nextKinds = new Map(next.entries.map((e) => [e.playerId, e.kind]));

  // Input のままの人の値だけ引き継ぐ
  const inputs = new Map<PlayerId, Chips>();
  for (const [id, value] of inputsOf(sheet)) {
    if (nextKinds.get(id) === "Input") inputs.set(id, value);
  }
  return build({
    seatOrder,
    eliminated,
    startingChips: sheet.startingChips,
    inputs,
  });
}

export const resultSheetOperations: ResultSheetOperations = {
  create,
  enter,
  updateEliminated,
};
