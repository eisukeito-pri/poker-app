/**
 * 対局進行のユースケース。GameUseCases の実装。
 *
 * ルール（決定済み）：
 * - 生存者が1人になっても自動では結果入力へ進まない（主ボタンが変わるだけ）
 * - 「戻す」で結果入力（PlayEnded）から対局に戻ると、入力途中の値はすべて破棄する
 * - 対局開始後は設定を変更できない
 * - 進行中の対局があるときの新しい対局は、replaceCurrent が true のときだけ、破棄して始める
 * - 前回の設定は、対局を始めるたびに上書きする
 * - 破棄した対局は、記録に残さない
 */
import {
  advanceHand as domainAdvanceHand,
  create as createGame,
  eliminate as domainEliminate,
  endPlay as domainEndPlay,
  project,
  reinstate as domainReinstate,
  undo as domainUndo,
} from "../domain/game/game";
import type {
  Game,
  GamePlayer,
  GameRepository,
  GameSettings,
  LastGameSetupRepository,
} from "../domain/game/types";
import type { PlayerRepository } from "../domain/roster/types";
import {
  chips,
  exchangeRateFromYen,
  playerId,
} from "../domain/shared/constructors";
import { DomainError } from "../domain/shared/errors";
import type { PlayerId } from "../domain/shared/types";
import type { ResultDraftRepository } from "../domain/settlement/types";
import type {
  Clock,
  GameUseCases,
  GameView,
  IdGenerator,
  RandomSource,
  SetupDefaults,
  StartGameRequest,
} from "./types";

/** 前回の設定がないときの初期値 */
export const DEFAULT_SETUP: Omit<SetupDefaults, "seatOrder" | "isFromLastGame"> = {
  startingChips: 1000,
  totalHands: 20,
  initialBigBlind: 100,
  blindIncreaseEveryHands: 5,
  blindIncreaseAmount: 50,
  yenPerChip: 0.1,
};

export interface GameUseCasesDeps {
  readonly gameRepo: GameRepository;
  readonly lastSetupRepo: LastGameSetupRepository;
  readonly playerRepo: PlayerRepository;
  readonly resultDraftRepo: ResultDraftRepository;
  readonly clock: Clock;
  readonly idGen: IdGenerator;
  readonly random: RandomSource;
}

export class GameUseCasesImpl implements GameUseCases {
  private readonly deps: GameUseCasesDeps;

  constructor(deps: GameUseCasesDeps) {
    this.deps = deps;
  }

  private toView(game: Game): GameView {
    return { game, state: project(game) };
  }

  private async requireCurrentGame(): Promise<Game> {
    const game = await this.deps.gameRepo.findCurrent();
    if (!game) {
      throw new DomainError("NO_CURRENT_GAME", "進行中の対局がありません");
    }
    return game;
  }

  async getSetupDefaults(): Promise<SetupDefaults> {
    const lastSetup = await this.deps.lastSetupRepo.find();
    if (!lastSetup) {
      return { ...DEFAULT_SETUP, seatOrder: [], isFromLastGame: false };
    }
    const roster = await this.deps.playerRepo.findAll();
    const rosterIds = new Set(roster.map((p) => p.id));
    const seatOrder = lastSetup.seatOrder.filter((id) => rosterIds.has(id));
    const { settings } = lastSetup;
    return {
      startingChips: settings.startingChips,
      totalHands: settings.totalHands,
      initialBigBlind: settings.blindSchedule.initialBigBlind,
      blindIncreaseEveryHands: settings.blindSchedule.increaseEveryHands,
      blindIncreaseAmount: settings.blindSchedule.increaseAmount,
      yenPerChip: settings.exchangeRate / 1000,
      seatOrder,
      isFromLastGame: true,
    };
  }

  chooseRandomDealer(playerIds: readonly string[]): PlayerId {
    if (playerIds.length === 0) {
      throw new DomainError("INVALID_PLAYERS", "参加者がいません");
    }
    const index = this.deps.random.nextInt(playerIds.length);
    const chosen = playerIds[index];
    if (chosen === undefined) {
      throw new DomainError("INVALID_PLAYERS", "参加者がいません");
    }
    return playerId(chosen);
  }

  async startGame(request: StartGameRequest): Promise<GameView> {
    const current = await this.deps.gameRepo.findCurrent();
    if (current) {
      if (!request.replaceCurrent) {
        throw new DomainError(
          "GAME_IN_PROGRESS",
          "進行中の対局があります。破棄してから新しい対局を始めてください",
        );
      }
      await this.deps.gameRepo.clearCurrent();
      await this.deps.resultDraftRepo.clear(current.id);
    }

    const roster = await this.deps.playerRepo.findAll();
    const rosterById = new Map(roster.map((p) => [p.id, p]));
    const seats: GamePlayer[] = request.playerIds.map((raw) => {
      const id = playerId(raw);
      const player = rosterById.get(id);
      if (!player) {
        throw new DomainError("PLAYER_NOT_FOUND", `名簿にいない参加者です: ${raw}`);
      }
      return { id: player.id, name: player.name };
    });

    const settings: GameSettings = {
      startingChips: chips(request.startingChips),
      totalHands: request.totalHands,
      blindSchedule: {
        initialBigBlind: chips(request.initialBigBlind),
        increaseEveryHands: request.blindIncreaseEveryHands,
        increaseAmount: chips(request.blindIncreaseAmount),
      },
      exchangeRate: exchangeRateFromYen(request.yenPerChip),
    };

    const id = this.deps.idGen.newGameId();
    const now = this.deps.clock.now();
    const game = createGame(
      { seats, initialDealerId: playerId(request.initialDealerId), settings },
      id,
      now,
    );

    await this.deps.gameRepo.saveCurrent(game);
    await this.deps.lastSetupRepo.save({
      settings,
      seatOrder: seats.map((s) => s.id),
    });

    return this.toView(game);
  }

  async getCurrentGame(): Promise<GameView | null> {
    const game = await this.deps.gameRepo.findCurrent();
    return game ? this.toView(game) : null;
  }

  async advanceHand(): Promise<GameView> {
    const game = await this.requireCurrentGame();
    const next = domainAdvanceHand(game, this.deps.clock.now());
    await this.deps.gameRepo.saveCurrent(next);
    return this.toView(next);
  }

  async eliminatePlayer(playerIdRaw: string): Promise<GameView> {
    const game = await this.requireCurrentGame();
    const next = domainEliminate(game, playerId(playerIdRaw), this.deps.clock.now());
    await this.deps.gameRepo.saveCurrent(next);
    return this.toView(next);
  }

  async reinstatePlayer(playerIdRaw: string): Promise<GameView> {
    const game = await this.requireCurrentGame();
    const next = domainReinstate(game, playerId(playerIdRaw), this.deps.clock.now());
    await this.deps.gameRepo.saveCurrent(next);
    return this.toView(next);
  }

  async endPlay(): Promise<GameView> {
    const game = await this.requireCurrentGame();
    const next = domainEndPlay(game, this.deps.clock.now());
    await this.deps.gameRepo.saveCurrent(next);
    return this.toView(next);
  }

  async undo(): Promise<GameView> {
    const game = await this.requireCurrentGame();
    const lastEvent = game.events[game.events.length - 1];
    const leavingResultPending = lastEvent?.type === "PlayEnded";

    const next = domainUndo(game);
    await this.deps.gameRepo.saveCurrent(next);
    if (leavingResultPending) {
      await this.deps.resultDraftRepo.clear(game.id);
    }
    return this.toView(next);
  }

  async abandonGame(): Promise<void> {
    const game = await this.deps.gameRepo.findCurrent();
    if (!game) return;
    await this.deps.gameRepo.clearCurrent();
    await this.deps.resultDraftRepo.clear(game.id);
  }
}
