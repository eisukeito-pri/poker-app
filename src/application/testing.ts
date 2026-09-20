/** テスト専用の偽物（Clock・ID生成・乱数）。アプリ本体からは import しない */
import type { Clock, IdGenerator, RandomSource } from "./types";
import { gameId, playerId, settlementId } from "../domain/shared/constructors";
import type { GameId, IsoDateTime, PlayerId, SettlementId } from "../domain/shared/types";

export class FixedClock implements Clock {
  private current: IsoDateTime;

  constructor(initial: IsoDateTime) {
    this.current = initial;
  }

  now(): IsoDateTime {
    return this.current;
  }

  /** 次に now() が返す時刻を設定する */
  set(value: IsoDateTime): void {
    this.current = value;
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private playerCount = 0;
  private gameCount = 0;
  private settlementCount = 0;

  newPlayerId(): PlayerId {
    this.playerCount += 1;
    return playerId(`player-${this.playerCount}`);
  }

  newGameId(): GameId {
    this.gameCount += 1;
    return gameId(`game-${this.gameCount}`);
  }

  newSettlementId(): SettlementId {
    this.settlementCount += 1;
    return settlementId(`settlement-${this.settlementCount}`);
  }
}

/** あらかじめ決めた値を順番に返す。テストで「何番目が選ばれるか」を固定するのに使う */
export class QueueRandomSource implements RandomSource {
  private readonly queue: number[];

  constructor(queue: readonly number[]) {
    this.queue = [...queue];
  }

  nextInt(maxExclusive: number): number {
    const value = this.queue.shift();
    if (value === undefined) {
      throw new Error("QueueRandomSource: キューが空です");
    }
    if (value < 0 || value >= maxExclusive) {
      throw new Error(`QueueRandomSource: ${value} は範囲外です（< ${maxExclusive}）`);
    }
    return value;
  }
}
