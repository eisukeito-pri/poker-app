/** テスト専用のサンプルデータ（アプリ本体からは import しない） */
import type { BackupData } from "../../application/types";
import { advanceHand, create, endPlay } from "../../domain/game/game";
import type { Game, GameSettings } from "../../domain/game/types";
import { createGameRecord } from "../../domain/roster/record";
import type { GameRecord, Player } from "../../domain/roster/types";
import {
  chips,
  exchangeRateFromYen,
  gameId,
  playerId,
} from "../../domain/shared/constructors";
import { calculateSettlement } from "../../domain/settlement/settlement";

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

export function sampleBackup(exportedAt = "2026-09-21T00:00:00.000Z"): BackupData {
  const current = advanceHand(newGameFixture("g-current", "2026-09-21T09:00:00.000Z"), T1);
  return {
    schemaVersion: 1,
    exportedAt,
    players: samplePlayers(),
    records: [sampleRecord("g1", T0), sampleRecord("g2", T1)],
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
