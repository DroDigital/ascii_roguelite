import { type Rng, mulberry32 } from '../core/rng';
import { type RouteOption, type RoomPlan, STAGE_COUNT, exitDoor, oppositeSide, optionsForStage, planRoom } from '../world/route';
import type { Side } from '../world/tiles';
import type { EnemyKind } from '../sim/enemies';
import type { PlayerState } from '../sim/player';
import type { Mods } from '../sim/mods';
import { type RunModifiers, NO_RUN_MODIFIERS, type UpgradeId, activeCombos, computeMods, offerUpgrades } from './upgrades';

export type WeaponId = 'glaive' | 'quill';
export type BoonId = 'ash-ward' | 'scribes-pouch' | 'dust-step';
export type ModifierId = 'ink-famine' | 'gilded-path';

export interface RunConfig {
  seed: number;
  weapon: WeaponId;
  boon: BoonId | null;
  modifiers: ModifierId[];
}

/** The enemies each combat room starts with, by template id. */
export const WAVES: Record<string, EnemyKind[]> = {
  'hall-of-hooks': ['husk', 'husk', 'acolyte', 'husk'],
  stacks: ['bulwark', 'husk', 'husk', 'husk'],
  choir: ['acolyte', 'husk', 'acolyte', 'husk', 'husk'],
  ossuary: ['bulwark', 'husk', 'husk', 'husk', 'husk'],
  'lectern-gallery': ['husk', 'husk', 'acolyte', 'husk', 'acolyte', 'husk'],
  reliquary: ['elite', 'husk', 'acolyte'],
};

export type RunStatus = 'playing' | 'upgrade' | 'altar' | 'victory' | 'defeat';

export interface RunSummary {
  won: boolean;
  seed: number;
  time: number;
  kills: number;
  roomsCleared: number;
  upgrades: UpgradeId[];
  combos: string[];
  weapon: WeaponId;
}

/**
 * The roguelite run: the route through the stages, the rooms in it, upgrades
 * owned, the player state carried between rooms, and win or loss. It has no DOM
 * and no rendering, so the same rules run in the game and in the tests.
 */
export class RunDirector {
  readonly config: RunConfig;
  readonly rng: Rng;
  readonly runMods: RunModifiers;
  /** Index into the stages: 0 is the nave, 5 is the boss arena. */
  stage = 0;
  status: RunStatus = 'playing';
  owned: UpgradeId[] = [];
  /** Combos announced so far in this run. */
  combosSeen = new Set<string>();
  /** Combos completed by the most recent pick, for the banner. */
  lastCombos: string[] = [];
  kills = 0;
  roomsCleared = 0;
  mods: Mods;
  plan: RoomPlan | null = null;
  /** Upgrade picks still owed after a reliquary or an attuned cistern. */
  rarePicks = 0;
  offers: UpgradeId[] = [];

  constructor(config: RunConfig) {
    this.config = config;
    this.rng = mulberry32(config.seed);
    this.runMods = {
      ...NO_RUN_MODIFIERS,
      boonMaxHp: config.boon === 'ash-ward' ? 25 : 0,
      boonShards: config.boon === 'scribes-pouch' ? 12 : 0,
      boonDodge: config.boon === 'dust-step' ? 1 : 0,
      inkFamine: config.modifiers.includes('ink-famine'),
      gildedPath: config.modifiers.includes('gilded-path'),
    };
    this.mods = computeMods([], this.runMods);
  }

  /** Shards carried in at the start, from boons. */
  get startingShards(): number {
    return this.runMods.boonShards;
  }

  /** Enters the nave, the first room of the run. */
  begin(): RoomPlan {
    this.stage = 0;
    this.plan = planRoom(0, NAVE, null, this.rng);
    return this.plan;
  }

  /** The two options behind the doors of the current room. */
  get nextOptions(): readonly RouteOption[] {
    return optionsForStage(this.stage + 1);
  }

  /**
   * Walks through exit `exitIndex`. The next room is the chosen option, entered
   * through the door opposite the one used.
   */
  enter(exitIndex: number, option: RouteOption): RoomPlan {
    if (!this.plan) throw new Error('enter() before begin()');
    const exit = exitDoor(this.plan.layout, exitIndex);
    const entry: Side = oppositeSide(exit.side);
    this.stage += 1;
    this.plan = planRoom(this.stage, option, entry, this.rng);
    this.status = 'playing';
    return this.plan;
  }

  /** The enemies for the current room, with Gilded Path's elite added in the middle stages. */
  wave(): { kinds: EnemyKind[]; gilded: boolean } {
    if (!this.plan) return { kinds: [], gilded: false };
    const kind = this.plan.option.kind;
    if (kind === 'cistern' || kind === 'nave' || kind === 'boss') return { kinds: [], gilded: false };
    const kinds: EnemyKind[] = [...(WAVES[this.plan.option.templateId] ?? [])];
    if (this.runMods.gildedPath && (this.stage === 2 || this.stage === 3)) kinds.push('elite');
    return { kinds, gilded: this.runMods.gildedPath };
  }

  /**
   * Records a cleared room and returns the status that follows. Combat rooms
   * offer three upgrades, the reliquary offers rare ones, the boss is the win,
   * and the nave and cistern give no reward.
   */
  roomCleared(kills: number): RunStatus {
    this.kills += kills;
    this.roomsCleared += 1;
    const kind = this.plan?.option.kind;
    if (kind === 'boss') {
      this.status = 'victory';
    } else if (kind === 'reliquary') {
      this.rarePicks = 1 + (this.runMods.gildedPath ? 1 : 0);
      this.offers = offerUpgrades(this.rng, this.owned, 3, 1, true);
      this.status = 'upgrade';
    } else if (kind === 'combat') {
      this.offers = offerUpgrades(this.rng, this.owned, 3, 0.15);
      this.status = 'upgrade';
    } else {
      this.status = 'playing';
    }
    return this.status;
  }

  /** Takes an offered upgrade. Returns the combos this pick completes, for the banner. */
  pickUpgrade(id: UpgradeId): string[] {
    this.owned.push(id);
    this.mods = computeMods(this.owned, this.runMods);
    const completed = activeCombos(this.owned).filter((c) => !this.combosSeen.has(c));
    completed.forEach((c) => this.combosSeen.add(c));
    this.lastCombos = completed;
    if (this.rarePicks > 0) {
      this.rarePicks -= 1;
      if (this.rarePicks > 0) {
        this.offers = offerUpgrades(this.rng, this.owned, 3, 1, true);
        this.status = 'upgrade';
        return completed;
      }
    }
    this.offers = [];
    this.status = 'playing';
    return completed;
  }

  /** Cistern: Attune trades 20 maximum health for one rare pick. */
  attune(): void {
    this.runMods.attunePenalty += 20;
    this.mods = computeMods(this.owned, this.runMods);
    this.rarePicks = 1;
    this.offers = offerUpgrades(this.rng, this.owned, 3, 1, true);
    this.status = 'upgrade';
  }

  /** Cistern: Mend heals 45% of maximum health. Returns the health restored. */
  mend(player: PlayerState): number {
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.45);
    this.status = 'playing';
    return player.hp - before;
  }

  /** Carries health, charges and the rest into the next room, with the transient state reset. */
  carry(prev: PlayerState): PlayerState {
    return {
      ...prev,
      vx: 0,
      vz: 0,
      dodging: false,
      dodgeT: 0,
      staggerT: 0,
      hurtT: 99,
      maxHp: this.mods.maxHp,
      hp: Math.min(prev.hp, this.mods.maxHp),
      dodgeMaxCharges: this.mods.dodgeCharges,
      dodgeCharges: Math.min(prev.dodgeCharges, this.mods.dodgeCharges),
    };
  }

  /** A fresh player for the first room: full health, with upgrades and boons applied. */
  startingPlayer(): PlayerState {
    return {
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      hp: this.mods.maxHp,
      maxHp: this.mods.maxHp,
      alive: true,
      dodgeT: 0,
      dodging: false,
      dodgeDx: 0,
      dodgeDz: 0,
      dodgeCharges: this.mods.dodgeCharges,
      dodgeMaxCharges: this.mods.dodgeCharges,
      dodgeRecharge: 0,
      hurtT: 99,
      staggerT: 0,
      inInk: false,
    };
  }

  summary(won: boolean, time: number): RunSummary {
    return {
      won,
      seed: this.config.seed,
      time,
      kills: this.kills,
      roomsCleared: this.roomsCleared,
      upgrades: [...this.owned],
      combos: activeCombos(this.owned),
      weapon: this.config.weapon,
    };
  }

  get isBossStage(): boolean {
    return this.stage === STAGE_COUNT - 1;
  }
}

const NAVE: RouteOption = { templateId: 'nave', kind: 'nave', label: 'The Nave', blurb: 'where the Scriptorium begins' };
