/**
 * 保存データ・バックアップの読み込み検証（パーサー）。
 *
 * 外から来たデータ（unknown）を、型だけでなく「ルール上あり得る内容」かまで確かめる。
 * - 形が違えば SchemaError
 * - 対局の履歴は、実際に1件ずつ再生して矛盾がないか確かめる
 * - 記録は、合計が0になるか、送金が収支と合っているかまで確かめる
 */
import {
  advanceHand,
  create,
  eliminate,
  endPlay,
  reinstate,
} from "../../domain/game/game";
import type {
  Game,
  GameEvent,
  GamePlayer,
  GameSettings,
  LastGameSetup,
} from "../../domain/game/types";
import { normalizePlayerName } from "../../domain/roster/roster";
import type { GameRecord, Player, PlayerYenBalance, SettlementRecord } from "../../domain/roster/types";
import { DomainError } from "../../domain/shared/errors";
import { MAX_ABS_CHIPS } from "../../domain/shared/types";
import type {
  Chips,
  GameId,
  IsoDateTime,
  MilliYenPerChip,
  PlayerId,
  SettlementId,
  Yen,
} from "../../domain/shared/types";
import type { PlayerResult, ResultDraft, Transfer } from "../../domain/settlement/types";
import type { BackupData } from "../../application/types";

export const CURRENT_SCHEMA_VERSION = 1;

export class SchemaError extends Error {
  readonly path: string;
  readonly kind: "invalid" | "unsupported-version";

  constructor(
    path: string,
    message: string,
    kind: "invalid" | "unsupported-version" = "invalid",
  ) {
    super(`${path}: ${message}`);
    this.name = "SchemaError";
    this.path = path;
    this.kind = kind;
  }
}

/* ───────── 基本の読み取り ───────── */

type Obj = Record<string, unknown>;

function asObject(value: unknown, path: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SchemaError(path, "オブジェクトではありません");
  }
  return value as Obj;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new SchemaError(path, "配列ではありません");
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new SchemaError(path, "文字列ではありません");
  return value;
}

function asNonEmptyString(value: unknown, path: string): string {
  const text = asString(value, path);
  if (text.trim() === "") throw new SchemaError(path, "空です");
  return text;
}

function asInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new SchemaError(path, "整数ではありません");
  }
  return value;
}

function asChips(value: unknown, path: string): Chips {
  const n = asInt(value, path);
  if (Math.abs(n) > MAX_ABS_CHIPS) throw new SchemaError(path, "チップ数が大きすぎます");
  return (n + 0) as Chips;
}

function asIso(value: unknown, path: string): IsoDateTime {
  const text = asString(value, path);
  if (Number.isNaN(Date.parse(text))) throw new SchemaError(path, "日時ではありません");
  return text;
}

/** 未精算（null）または、古いデータで項目自体がない場合は null として扱う（後方互換） */
function asIsoOrNull(value: unknown, path: string): IsoDateTime | null {
  if (value === null || value === undefined) return null;
  return asIso(value, path);
}

function asId<T extends string>(value: unknown, path: string): T {
  return asNonEmptyString(value, path) as T;
}

function mapArray<T>(
  value: unknown,
  path: string,
  parse: (item: unknown, itemPath: string) => T,
): T[] {
  return asArray(value, path).map((item, i) => parse(item, `${path}[${i}]`));
}

function assertUnique(values: readonly string[], path: string, label: string): void {
  if (new Set(values).size !== values.length) {
    throw new SchemaError(path, `${label}が重複しています`);
  }
}

/* ───────── 名簿 ───────── */

function parsePlayer(value: unknown, path: string): Player {
  const o = asObject(value, path);
  const rawName = asString(o.name, `${path}.name`);
  let name: string;
  try {
    name = normalizePlayerName(rawName);
  } catch (error) {
    if (error instanceof DomainError) throw new SchemaError(`${path}.name`, error.message);
    throw error;
  }
  if (name !== rawName) throw new SchemaError(`${path}.name`, "前後に空白があります");
  return {
    id: asId<PlayerId>(o.id, `${path}.id`),
    name,
    createdAt: asIso(o.createdAt, `${path}.createdAt`),
  };
}

export function parsePlayers(value: unknown, path = "players"): Player[] {
  const players = mapArray(value, path, parsePlayer);
  assertUnique(players.map((p) => p.id), path, "ID");
  assertUnique(players.map((p) => p.name.toLowerCase()), path, "名前");
  return players;
}

/* ───────── 対局 ───────── */

function parseGamePlayer(value: unknown, path: string): GamePlayer {
  const o = asObject(value, path);
  return {
    id: asId<PlayerId>(o.id, `${path}.id`),
    name: asNonEmptyString(o.name, `${path}.name`),
  };
}

function parseSettings(value: unknown, path: string): GameSettings {
  const o = asObject(value, path);
  const b = asObject(o.blindSchedule, `${path}.blindSchedule`);
  return {
    startingChips: asChips(o.startingChips, `${path}.startingChips`),
    totalHands: asInt(o.totalHands, `${path}.totalHands`),
    blindSchedule: {
      initialBigBlind: asChips(b.initialBigBlind, `${path}.blindSchedule.initialBigBlind`),
      increaseEveryHands: asInt(b.increaseEveryHands, `${path}.blindSchedule.increaseEveryHands`),
      increaseAmount: asChips(b.increaseAmount, `${path}.blindSchedule.increaseAmount`),
    },
    exchangeRate: asInt(o.exchangeRate, `${path}.exchangeRate`) as MilliYenPerChip,
  };
}

const PLACEHOLDER_SEATS: readonly GamePlayer[] = [
  { id: "a" as PlayerId, name: "a" },
  { id: "b" as PlayerId, name: "b" },
];

/** 設定の値が、ルール上あり得る範囲かを確かめる（Game.create の検証を使う） */
function assertValidSettings(settings: GameSettings, path: string): void {
  try {
    create(
      { seats: PLACEHOLDER_SEATS, initialDealerId: "a" as PlayerId, settings },
      "check" as GameId,
      "2026-01-01T00:00:00.000Z",
    );
  } catch (error) {
    if (error instanceof DomainError) throw new SchemaError(path, error.message);
    throw error;
  }
}

function parseEvent(value: unknown, path: string): GameEvent {
  const o = asObject(value, path);
  const at = asIso(o.at, `${path}.at`);
  const type = asString(o.type, `${path}.type`);
  switch (type) {
    case "HandAdvanced":
      return { type, at };
    case "PlayerEliminated":
    case "PlayerReinstated":
      return { type, at, playerId: asId<PlayerId>(o.playerId, `${path}.playerId`) };
    case "PlayEnded": {
      const reason = asString(o.reason, `${path}.reason`);
      if (reason !== "AllHandsPlayed" && reason !== "SingleSurvivor") {
        throw new SchemaError(`${path}.reason`, "終了の理由が不正です");
      }
      return { type, at, reason };
    }
    default:
      throw new SchemaError(`${path}.type`, `未知の出来事です: ${type}`);
  }
}

/** 設定・座席から空の対局を作る（ルール違反は SchemaError） */
function buildBaseGame(
  input: {
    id: GameId;
    createdAt: IsoDateTime;
    settings: GameSettings;
    seats: readonly GamePlayer[];
    initialDealerId: PlayerId;
  },
  path: string,
): Game {
  try {
    return create(
      { seats: input.seats, initialDealerId: input.initialDealerId, settings: input.settings },
      input.id,
      input.createdAt,
    );
  } catch (error) {
    if (error instanceof DomainError) {
      throw new SchemaError(path, `設定または参加者が不正です（${error.message}）`);
    }
    throw error;
  }
}

/** 履歴を1件ずつ再生して、ルール違反や矛盾がないか確かめる */
function replayEvents(base: Game, events: readonly GameEvent[], path: string): Game {
  let game = base;
  events.forEach((event, index) => {
    const eventPath = `${path}[${index}]`;
    try {
      switch (event.type) {
        case "HandAdvanced":
          game = advanceHand(game, event.at);
          break;
        case "PlayerEliminated":
          game = eliminate(game, event.playerId, event.at);
          break;
        case "PlayerReinstated":
          game = reinstate(game, event.playerId, event.at);
          break;
        case "PlayEnded": {
          game = endPlay(game, event.at);
          const last = game.events[game.events.length - 1];
          if (last?.type !== "PlayEnded" || last.reason !== event.reason) {
            throw new SchemaError(eventPath, "終了の理由が履歴と合いません");
          }
          break;
        }
      }
    } catch (error) {
      if (error instanceof SchemaError) throw error;
      if (error instanceof DomainError) {
        throw new SchemaError(eventPath, `履歴が矛盾しています（${error.message}）`);
      }
      throw error;
    }
  });
  return game;
}

export function parseGame(value: unknown, path = "game"): Game {
  const o = asObject(value, path);
  const base = buildBaseGame(
    {
      id: asId<GameId>(o.id, `${path}.id`),
      createdAt: asIso(o.createdAt, `${path}.createdAt`),
      settings: parseSettings(o.settings, `${path}.settings`),
      seats: mapArray(o.seats, `${path}.seats`, parseGamePlayer),
      initialDealerId: asId<PlayerId>(o.initialDealerId, `${path}.initialDealerId`),
    },
    path,
  );
  const events = mapArray(o.events, `${path}.events`, parseEvent);
  return replayEvents(base, events, `${path}.events`);
}

/* ───────── 結果入力の途中経過・前回の設定 ───────── */

export function parseResultDraft(value: unknown, path = "resultDraft"): ResultDraft {
  const o = asObject(value, path);
  const inputs = mapArray(o.inputs, `${path}.inputs`, (item, itemPath) => {
    const entry = asObject(item, itemPath);
    return {
      playerId: asId<PlayerId>(entry.playerId, `${itemPath}.playerId`),
      netChips: asChips(entry.netChips, `${itemPath}.netChips`),
    };
  });
  assertUnique(inputs.map((i) => i.playerId), `${path}.inputs`, "参加者");
  return { gameId: asId<GameId>(o.gameId, `${path}.gameId`), inputs };
}

export function parseLastSetup(value: unknown, path = "lastSetup"): LastGameSetup {
  const o = asObject(value, path);
  const settings = parseSettings(o.settings, `${path}.settings`);
  assertValidSettings(settings, `${path}.settings`);
  const seatOrder = mapArray(o.seatOrder, `${path}.seatOrder`, (item, itemPath) =>
    asId<PlayerId>(item, itemPath),
  );
  assertUnique(seatOrder, `${path}.seatOrder`, "参加者");
  return { settings, seatOrder };
}

/* ───────── 対局の記録 ───────── */

function parseResult(value: unknown, path: string): PlayerResult {
  const o = asObject(value, path);
  return {
    playerId: asId<PlayerId>(o.playerId, `${path}.playerId`),
    netChips: asChips(o.netChips, `${path}.netChips`),
    netYen: (asInt(o.netYen, `${path}.netYen`) + 0) as Yen,
  };
}

function parseTransfer(value: unknown, path: string): Transfer {
  const o = asObject(value, path);
  const amount = asInt(o.amount, `${path}.amount`);
  if (amount <= 0) throw new SchemaError(`${path}.amount`, "金額は1円以上です");
  return {
    from: asId<PlayerId>(o.from, `${path}.from`),
    to: asId<PlayerId>(o.to, `${path}.to`),
    amount: amount as Yen,
  };
}

export function parseGameRecord(value: unknown, path = "record"): GameRecord {
  const o = asObject(value, path);
  const gameId = asId<GameId>(o.gameId, `${path}.gameId`);
  const playedAt = asIso(o.playedAt, `${path}.playedAt`);
  const settings = parseSettings(o.settings, `${path}.settings`);
  const players = mapArray(o.players, `${path}.players`, parseGamePlayer);
  const first = players[0];
  if (!first) throw new SchemaError(`${path}.players`, "参加者がいません");

  // 設定と参加者がルール上あり得るか（人数、ID重複、設定値の範囲）
  buildBaseGame(
    { id: gameId, createdAt: playedAt, settings, seats: players, initialDealerId: first.id },
    path,
  );

  const handsPlayed = asInt(o.handsPlayed, `${path}.handsPlayed`);
  if (handsPlayed < 1 || handsPlayed > settings.totalHands) {
    throw new SchemaError(`${path}.handsPlayed`, "ハンド数が総ハンド数の範囲外です");
  }

  const results = mapArray(o.results, `${path}.results`, parseResult);
  const playerIds = new Set<string>(players.map((p) => p.id));
  assertUnique(results.map((r) => r.playerId), `${path}.results`, "参加者");
  if (results.length !== players.length || !results.every((r) => playerIds.has(r.playerId))) {
    throw new SchemaError(`${path}.results`, "結果が参加者と合っていません");
  }
  if (results.reduce<number>((sum, r) => sum + r.netChips, 0) !== 0) {
    throw new SchemaError(`${path}.results`, "チップ収支の合計が0ではありません");
  }
  if (results.reduce<number>((sum, r) => sum + r.netYen, 0) !== 0) {
    throw new SchemaError(`${path}.results`, "円の収支の合計が0ではありません");
  }

  const transfers = mapArray(o.transfers, `${path}.transfers`, parseTransfer);
  const effect = new Map<string, number>(players.map((p) => [p.id, 0]));
  transfers.forEach((t, i) => {
    if (!playerIds.has(t.from) || !playerIds.has(t.to) || t.from === t.to) {
      throw new SchemaError(`${path}.transfers[${i}]`, "送金の相手が不正です");
    }
    effect.set(t.to, (effect.get(t.to) ?? 0) + t.amount);
    effect.set(t.from, (effect.get(t.from) ?? 0) - t.amount);
  });
  for (const result of results) {
    if ((effect.get(result.playerId) ?? 0) !== result.netYen) {
      throw new SchemaError(`${path}.transfers`, "送金が収支と合っていません");
    }
  }

  const settledAt = asIsoOrNull(o.settledAt, `${path}.settledAt`);

  return { gameId, playedAt, settings, players, handsPlayed, results, transfers, settledAt };
}

export function parseGameRecords(value: unknown, path = "records"): GameRecord[] {
  const records = mapArray(value, path, parseGameRecord);
  assertUnique(records.map((r) => r.gameId), path, "対局ID");
  return records;
}

/* ───────── 精算（複数対局のまとめ払い） ───────── */

function parsePlayerYenBalance(value: unknown, path: string): PlayerYenBalance {
  const o = asObject(value, path);
  return {
    playerId: asId<PlayerId>(o.playerId, `${path}.playerId`),
    name: asNonEmptyString(o.name, `${path}.name`),
    netYen: (asInt(o.netYen, `${path}.netYen`) + 0) as Yen,
  };
}

export function parseSettlementRecord(value: unknown, path = "settlement"): SettlementRecord {
  const o = asObject(value, path);
  const id = asId<SettlementId>(o.id, `${path}.id`);
  const settledAt = asIso(o.settledAt, `${path}.settledAt`);

  const gameIds = mapArray(o.gameIds, `${path}.gameIds`, (item, itemPath) =>
    asId<GameId>(item, itemPath),
  );
  if (gameIds.length === 0) throw new SchemaError(`${path}.gameIds`, "対局が含まれていません");
  assertUnique(gameIds, `${path}.gameIds`, "対局ID");

  const balances = mapArray(o.balances, `${path}.balances`, parsePlayerYenBalance);
  assertUnique(balances.map((b) => b.playerId), `${path}.balances`, "参加者");
  if (balances.reduce<number>((sum, b) => sum + b.netYen, 0) !== 0) {
    throw new SchemaError(`${path}.balances`, "円の収支の合計が0ではありません");
  }

  const transfers = mapArray(o.transfers, `${path}.transfers`, parseTransfer);
  const playerIds = new Set<string>(balances.map((b) => b.playerId));
  const effect = new Map<string, number>(balances.map((b) => [b.playerId, 0]));
  transfers.forEach((t, i) => {
    if (!playerIds.has(t.from) || !playerIds.has(t.to) || t.from === t.to) {
      throw new SchemaError(`${path}.transfers[${i}]`, "送金の相手が不正です");
    }
    effect.set(t.to, (effect.get(t.to) ?? 0) + t.amount);
    effect.set(t.from, (effect.get(t.from) ?? 0) - t.amount);
  });
  for (const balance of balances) {
    if ((effect.get(balance.playerId) ?? 0) !== balance.netYen) {
      throw new SchemaError(`${path}.transfers`, "送金が収支と合っていません");
    }
  }

  return { id, settledAt, gameIds, balances, transfers };
}

export function parseSettlementRecords(value: unknown, path = "settlements"): SettlementRecord[] {
  const records = mapArray(value, path, parseSettlementRecord);
  assertUnique(records.map((r) => r.id), path, "精算ID");
  return records;
}

/* ───────── バックアップ全体 ───────── */

export function parseBackupData(value: unknown): BackupData {
  const path = "backup";
  const o = asObject(value, path);
  const version = asInt(o.schemaVersion, `${path}.schemaVersion`);
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new SchemaError(
      `${path}.schemaVersion`,
      `新しいバージョン（${version}）のバックアップです`,
      "unsupported-version",
    );
  }
  if (version !== CURRENT_SCHEMA_VERSION) {
    throw new SchemaError(`${path}.schemaVersion`, `対応していないバージョンです（${version}）`);
  }

  const players = parsePlayers(o.players, `${path}.players`);
  const records = parseGameRecords(o.records, `${path}.records`);
  // 古いバックアップ（この項目自体がない）は、まだ精算機能がなかったので空扱い
  const settlements =
    o.settlements === undefined ? [] : parseSettlementRecords(o.settlements, `${path}.settlements`);
  const currentGame = o.currentGame === null ? null : parseGame(o.currentGame, `${path}.currentGame`);
  const resultDraft =
    o.resultDraft === null ? null : parseResultDraft(o.resultDraft, `${path}.resultDraft`);
  const lastSetup =
    o.lastSetup === null ? null : parseLastSetup(o.lastSetup, `${path}.lastSetup`);

  if (resultDraft) {
    if (!currentGame || currentGame.id !== resultDraft.gameId) {
      throw new SchemaError(`${path}.resultDraft`, "入力途中のデータに対応する対局がありません");
    }
    const seatIds = new Set<string>(currentGame.seats.map((s) => s.id));
    if (!resultDraft.inputs.every((i) => seatIds.has(i.playerId))) {
      throw new SchemaError(`${path}.resultDraft`, "入力途中のデータに参加者以外が含まれています");
    }
  }

  return {
    schemaVersion: 1,
    exportedAt: asIso(o.exportedAt, `${path}.exportedAt`),
    players,
    records,
    settlements,
    currentGame,
    resultDraft,
    lastSetup,
  };
}
