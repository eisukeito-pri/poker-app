/** 名簿のユースケース。RosterUseCases の実装 */
import {
  findPlayerByName,
  registerPlayer,
  renamePlayer,
} from "../domain/roster/roster";
import type { Player, PlayerRepository } from "../domain/roster/types";
import { playerId } from "../domain/shared/constructors";
import type { Clock, IdGenerator, RosterUseCases } from "./types";

export interface RosterUseCasesDeps {
  readonly playerRepo: PlayerRepository;
  readonly clock: Clock;
  readonly idGen: IdGenerator;
}

export class RosterUseCasesImpl implements RosterUseCases {
  private readonly deps: RosterUseCasesDeps;

  constructor(deps: RosterUseCasesDeps) {
    this.deps = deps;
  }

  async list(): Promise<readonly Player[]> {
    return this.deps.playerRepo.findAll();
  }

  async register(name: string): Promise<Player> {
    const players = await this.deps.playerRepo.findAll();
    const { player } = registerPlayer(players, {
      id: this.deps.idGen.newPlayerId(),
      name,
      now: this.deps.clock.now(),
    });
    await this.deps.playerRepo.save(player);
    return player;
  }

  async registerOrFind(name: string): Promise<Player> {
    const players = await this.deps.playerRepo.findAll();
    const existing = findPlayerByName(players, name);
    if (existing) return existing;

    const { player } = registerPlayer(players, {
      id: this.deps.idGen.newPlayerId(),
      name,
      now: this.deps.clock.now(),
    });
    await this.deps.playerRepo.save(player);
    return player;
  }

  async rename(id: string, name: string): Promise<Player> {
    const players = await this.deps.playerRepo.findAll();
    const { player } = renamePlayer(players, playerId(id), name);
    await this.deps.playerRepo.save(player);
    return player;
  }

  async remove(id: string): Promise<void> {
    await this.deps.playerRepo.remove(playerId(id));
  }
}
