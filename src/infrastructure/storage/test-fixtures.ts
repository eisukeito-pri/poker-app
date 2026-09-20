/** テスト専用のサンプルデータ（アプリ本体からは import しない） */
import type { BackupData } from "../../application/types";
import { advanceHand, create, eliminate, endPlay } from "../../domain/game/game";
import type { Game, GameSettings } from "../../domain/game/types";
import { createGameRecord } from "../../domain/roster/record";
import type { GameRecord, Player, SettlementRecord } from "../../domain/roster/types";
import {
  chips,
  exchangeRateFromYen,
  gameId,
  playerId,
  settlementId,
  yen,
} from "../../domain/shared/constructors";
import { calculateSettlement } from "../../domain/settlement/settlement";
import { minimizeTransfers } from "../../domain/settlement/transfers";

export const T0 = "2026-09-20T10:00:00.000Z";
export const T1 = "2026-09-20T12:00:00.000Z";

export function sampleSettings(): GameSettings {
  return {
    startingChips: chips(1000),
    totalHands: 3,
    blindSchedule: {
      initialBigBlind: chips(100),
      increaseEveryHands: 5,
      increaseAmount: chips(50),
    },
    exchangeRate: exchangeRateFromYen(0.1),
    bountyRule: null,
  };
}

export function samplePlayers(): Player[] {
  return [
    { id: playerId("A"), name: "Alice", createdAt: T0 },
    { id: playerId("B"), name: "Bob", createdAt: T0 },
    { id: playerId("C"), name: "Carol", createdAt: T0 },
  ];
}

/** 3人の対局を始めたところ（履歴なし） */
export function newGameFixture(id = "g1", createdAt = T0): Game {
  return create(
    {
      seats: samplePlayers().map((p) => ({ id: p.id, name: p.name })),
      initialDealerId: playerId("A"),
      settings: sampleSettings(),
    },
    gameId(id),
    createdAt,
  );
}

/** 最終ハンドまで進めて、結果入力待ちになった対局 */
export function finishedGame(id = "g1", createdAt = T0): Game {
  return endPlay(advanceHand(advanceHand(newGameFixture(id, createdAt), T1), T1), T1);
}

export function sampleRecord(id = "g1", createdAt = T0): GameRecord {
  const settlement = calculateSettlement(
    [
      { playerId: playerId("A"), netChips: chips(1000) },
      { playerId: playerId("B"), netChips: chips(-400) },
      { playerId: playerId("C"), netChips: chips(-600) },
    ],
    sampleSettings().exchangeRate,
  );
  return createGameRecord({ game: finishedGame(id, createdAt), settlement });
}

/** 脱落ボーナスのルール（500円）が有効な設定 */
export function sampleBountySettings(): GameSettings {
  return { ...sampleSettings(), bountyRule: { amountYen: yen(500) } };
}

/** 脱落ボーナスのルールが有効な対局を始めたところ（履歴なし） */
export function newBountyGameFixture(id = "g1", createdAt = T0): Game {
  return create(
    {
      seats: samplePlayers().map((p) => ({ id: p.id, name: p.name })),
      initialDealerId: playerId("A"),
      settings: sampleBountySettings(),
    },
    gameId(id),
    createdAt,
  );
}

/** 脱落ボーナスのルールが有効なまま、Bを脱落させて（Aへ）最終ハンドまで進めた対局 */
export function finishedBountyGame(id = "g1", createdAt = T0): Game {
  const advanced = advanceHand(advanceHand(newBountyGameFixture(id, createdAt), T1), T1);
  return endPlay(eliminate(advanced, playerId("B"), T1, playerId("A")), T1);
}

/** 脱落ボーナス（B→A、500円）を含む確定記録 */
export function sampleBountyRecord(id = "g1", createdAt = T0): GameRecord {
  const settlement = calculateSettlement(
    [
      { playerId: playerId("A"), netChips: chips(1000) },
      { playerId: playerId("B"), netChips: chips(-400) },
      { playerId: playerId("C"), netChips: chips(-600) },
    ],
    sampleBountySettings().exchangeRate,
  );
  return createGameRecord({ game: finishedBountyGame(id, createdAt), settlement });
}

export function sampleSettlementRecord(id = "s1", settledAt = T1): SettlementRecord {
  const balances = [
    { playerId: playerId("A"), name: "Alice", netYen: yen(100), bountyNetYen: yen(0) },
    { playerId: playerId("B"), name: "Bob", netYen: yen(-40), bountyNetYen: yen(0) },
    { playerId: playerId("C"), name: "Carol", netYen: yen(-60), bountyNetYen: yen(0) },
  ];
  return {
    id: settlementId(id),
    settledAt,
    gameIds: [gameId("g1")],
    balances,
    transfers: minimizeTransfers(balances),
  };
}

export function sampleBackup(exportedAt = "2026-09-21T00:00:00.000Z"): BackupData {
  const current = advanceHand(newGameFixture("g-current", "2026-09-21T09:00:00.000Z"), T1);
  return {
    schemaVersion: 1,
    exportedAt,
    players: samplePlayers(),
    records: [sampleRecord("g1", T0), sampleRecord("g2", T1)],
    settlements: [sampleSettlementRecord()],
    currentGame: current,
    resultDraft: {
      gameId: current.id,
      inputs: [{ playerId: playerId("A"), netChips: chips(100) }],
    },
    lastSetup: {
      settings: sampleSettings(),
      seatOrder: [playerId("A"), playerId("B"), playerId("C")],
    },
  };
}

/** JSONを経由して、外から読み込んだ値と同じ形にする */
export function viaJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Draft = any;

/** 値をコピーして、fnで書き換えたものを返す（壊れたデータの作成用） */
export function edit(value: unknown, fn: (draft: Draft) => void): unknown {
  const copy = viaJson(value);
  fn(copy);
  return copy;
}
