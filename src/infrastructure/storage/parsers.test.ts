import { describe, expect, test } from "vitest";
import {
  parseBackupData,
  parseGame,
  parseGameRecord,
  parsePlayers,
  SchemaError,
} from "./parsers";
import {
  edit,
  finishedGame,
  newGameFixture,
  sampleBackup,
  samplePlayers,
  sampleRecord,
  viaJson,
} from "./test-fixtures";

function expectSchemaError(fn: () => unknown, kind: "invalid" | "unsupported-version" = "invalid"): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SchemaError);
    expect((error as SchemaError).kind).toBe(kind);
    return;
  }
  throw new Error("SchemaError が投げられませんでした");
}

describe("parsePlayers", () => {
  test("正しい名簿はそのまま読み込める", () => {
    expect(parsePlayers(viaJson(samplePlayers()))).toEqual(samplePlayers());
  });

  test("ID・名前（英字の大小は無視）の重複、前後の空白、長すぎる名前は拒否する", () => {
    expectSchemaError(() => parsePlayers(edit(samplePlayers(), (d) => { d[1].id = "A"; })));
    expectSchemaError(() => parsePlayers(edit(samplePlayers(), (d) => { d[1].name = "ALICE"; })));
    expectSchemaError(() => parsePlayers(edit(samplePlayers(), (d) => { d[0].name = " Alice"; })));
    expectSchemaError(() => parsePlayers(edit(samplePlayers(), (d) => { d[0].name = "a".repeat(21); })));
    expectSchemaError(() => parsePlayers("players"));
  });
});

describe("parseGame", () => {
  test("進行中・結果入力待ちの対局はそのまま読み込める", () => {
    const finished = finishedGame();
    expect(parseGame(viaJson(finished))).toEqual(finished);
    const fresh = newGameFixture();
    expect(parseGame(viaJson(fresh))).toEqual(fresh);
  });

  test("形が違うものは拒否する", () => {
    expectSchemaError(() => parseGame(null));
    expectSchemaError(() => parseGame(edit(newGameFixture(), (d) => { delete d.seats; })));
    expectSchemaError(() => parseGame(edit(newGameFixture(), (d) => { d.createdAt = "昨日"; })));
    expectSchemaError(() =>
      parseGame(edit(finishedGame(), (d) => { d.events[0].type = "Unknown"; })),
    );
  });

  test("設定や参加者がルール上あり得ないものは拒否する", () => {
    expectSchemaError(() => parseGame(edit(newGameFixture(), (d) => { d.settings.totalHands = 0; })));
    expectSchemaError(() => parseGame(edit(newGameFixture(), (d) => { d.seats[1].id = "A"; })));
    expectSchemaError(() => parseGame(edit(newGameFixture(), (d) => { d.initialDealerId = "Z"; })));
    expectSchemaError(() => parseGame(edit(newGameFixture(), (d) => { d.seats = d.seats.slice(0, 1); })));
  });

  test("履歴が矛盾しているものは拒否する", () => {
    // 最終ハンドのあとにさらにハンドを進める
    expectSchemaError(() =>
      parseGame(edit(newGameFixture(), (d) => {
        d.events = [1, 2, 3].map(() => ({ type: "HandAdvanced", at: "2026-09-20T10:00:00.000Z" }));
      })),
    );
    // 参加者以外の脱落
    expectSchemaError(() =>
      parseGame(edit(newGameFixture(), (d) => {
        d.events = [{ type: "PlayerEliminated", playerId: "Z", at: "2026-09-20T10:00:00.000Z" }];
      })),
    );
    // 終了の理由が合わない
    expectSchemaError(() =>
      parseGame(edit(finishedGame(), (d) => { d.events[d.events.length - 1].reason = "SingleSurvivor"; })),
    );
    // 結果入力待ちのあとに、ハンドを進める
    expectSchemaError(() =>
      parseGame(edit(finishedGame(), (d) => {
        d.events.push({ type: "HandAdvanced", at: "2026-09-20T13:00:00.000Z" });
      })),
    );
  });
});

describe("parseGameRecord", () => {
  test("正しい記録はそのまま読み込める", () => {
    expect(parseGameRecord(viaJson(sampleRecord()))).toEqual(sampleRecord());
  });

  test("合計が0でない・送金が収支と合わない・参加者の過不足は拒否する", () => {
    expectSchemaError(() => parseGameRecord(edit(sampleRecord(), (d) => { d.results[0].netYen += 1; })));
    expectSchemaError(() => parseGameRecord(edit(sampleRecord(), (d) => { d.results[0].netChips += 1; })));
    expectSchemaError(() => parseGameRecord(edit(sampleRecord(), (d) => { d.transfers[0].amount += 1; })));
    expectSchemaError(() => parseGameRecord(edit(sampleRecord(), (d) => { d.transfers[0].to = "Z"; })));
    expectSchemaError(() => parseGameRecord(edit(sampleRecord(), (d) => { d.transfers[0].to = d.transfers[0].from; })));
    expectSchemaError(() => parseGameRecord(edit(sampleRecord(), (d) => { d.results.pop(); })));
    expectSchemaError(() => parseGameRecord(edit(sampleRecord(), (d) => { d.results[1].playerId = "A"; })));
  });

  test("ハンド数・設定・日時が不正なものは拒否する", () => {
    expectSchemaError(() => parseGameRecord(edit(sampleRecord(), (d) => { d.handsPlayed = 4; })));
    expectSchemaError(() => parseGameRecord(edit(sampleRecord(), (d) => { d.handsPlayed = 0; })));
    expectSchemaError(() => parseGameRecord(edit(sampleRecord(), (d) => { d.settings.startingChips = 0; })));
    expectSchemaError(() => parseGameRecord(edit(sampleRecord(), (d) => { d.playedAt = "x"; })));
  });
});

describe("parseBackupData", () => {
  test("正しいバックアップはそのまま読み込める", () => {
    expect(parseBackupData(viaJson(sampleBackup()))).toEqual(sampleBackup());
  });

  test("新しいバージョンは unsupported-version、古い・不正なバージョンは invalid", () => {
    expectSchemaError(() => parseBackupData(edit(sampleBackup(), (d) => { d.schemaVersion = 2; })), "unsupported-version");
    expectSchemaError(() => parseBackupData(edit(sampleBackup(), (d) => { d.schemaVersion = 0; })));
    expectSchemaError(() => parseBackupData(edit(sampleBackup(), (d) => { d.schemaVersion = "1"; })));
  });

  test("項目の欠け・同じ対局IDの重複は拒否する", () => {
    expectSchemaError(() => parseBackupData(edit(sampleBackup(), (d) => { delete d.records; })));
    expectSchemaError(() => parseBackupData(edit(sampleBackup(), (d) => { delete d.currentGame; })));
    expectSchemaError(() => parseBackupData(edit(sampleBackup(), (d) => { d.records[1].gameId = "g1"; })));
  });

  test("入力途中のデータは、対応する進行中の対局が必要", () => {
    expectSchemaError(() => parseBackupData(edit(sampleBackup(), (d) => { d.currentGame = null; })));
    expectSchemaError(() => parseBackupData(edit(sampleBackup(), (d) => { d.resultDraft.gameId = "other"; })));
    expectSchemaError(() =>
      parseBackupData(edit(sampleBackup(), (d) => { d.resultDraft.inputs[0].playerId = "Z"; })),
    );
    const noDraft = parseBackupData(edit(sampleBackup(), (d) => { d.resultDraft = null; d.currentGame = null; }));
    expect(noDraft.currentGame).toBeNull();
  });

  test("前回の設定が不正なものは拒否する", () => {
    expectSchemaError(() => parseBackupData(edit(sampleBackup(), (d) => { d.lastSetup.settings.totalHands = 0; })));
    expectSchemaError(() => parseBackupData(edit(sampleBackup(), (d) => { d.lastSetup.seatOrder = ["A", "A"]; })));
  });
});
