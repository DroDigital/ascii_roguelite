import type { WorldGrid } from './grid';
import { PLAYER_TUNING, type PlayerState } from './player';

export type EnemyKind = 'husk' | 'acolyte' | 'bulwark' | 'elite' | 'boss';

export type AttackId =
  | 'lunge'
  | 'bolt'
  | 'slam'
  | 'charge'
  | 'seal-fan'
  | 'double-slam'
  | 'seal-volley'
  | 'book-slam'
  | 'page-sweep'
  | 'page-storm'
  | 'ink-rain'
  | 'triple-dash';

/** One attack. Windup is the telegraph, active is the hit, recover is the vulnerable tail. */
export interface AttackDef {
  id: AttackId;
  windup: number;
  active: number;
  recover: number;
  /** The attack is chosen only when the player is within this many units. */
  range: number;
  /** Minimum distance for the attack to be chosen. Zero means any. */
  minRange: number;
  cooldown: number;
  damage: number;
}

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  radius: number;
  speed: number;
  armor: number;
  /** Stagger threshold. Heavy hits at or above this poise interrupt windups. */
  poise: number;
  attacks: AttackDef[];
  /** Acolytes hold a distance band instead of closing in. */
  keepDistance: { min: number; max: number } | null;
  shards: [number, number];
  /** Chance of a health mote on death, from 0 to 1. */
  moteChance: number;
  /** Multiplies the model. Bulwarks and elites read larger. */
  scale: number;
}

const DEG = Math.PI / 180;

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  husk: {
    kind: 'husk',
    name: 'Husk',
    hp: 34,
    radius: 0.32,
    speed: 3.3,
    armor: 0,
    poise: 1,
    attacks: [{ id: 'lunge', windup: 0.55, active: 0.16, recover: 0.7, range: 2.4, minRange: 0, cooldown: 1.2, damage: 12 }],
    keepDistance: null,
    shards: [1, 2],
    moteChance: 0.2,
    scale: 1,
  },
  acolyte: {
    kind: 'acolyte',
    name: 'Acolyte',
    hp: 26,
    radius: 0.3,
    speed: 2.4,
    armor: 1,
    poise: 2,
    attacks: [{ id: 'seal-fan', windup: 0.7, active: 0.08, recover: 0.9, range: 7.5, minRange: 2.5, cooldown: 1.6, damage: 9 }],
    keepDistance: { min: 4.5, max: 6.5 },
    shards: [1, 3],
    moteChance: 0.1,
    scale: 1,
  },
  bulwark: {
    kind: 'bulwark',
    name: 'Bulwark',
    hp: 110,
    radius: 0.5,
    speed: 2.0,
    armor: 2,
    poise: 3,
    attacks: [
      { id: 'slam', windup: 1.0, active: 0.25, recover: 0.9, range: 3.2, minRange: 0, cooldown: 2.4, damage: 22 },
      { id: 'charge', windup: 0.8, active: 0.8, recover: 0.9, range: 7, minRange: 3.5, cooldown: 3, damage: 16 },
    ],
    keepDistance: null,
    shards: [2, 4],
    moteChance: 0.1,
    scale: 1.35,
  },
  elite: {
    kind: 'elite',
    name: 'Gilded Bulwark',
    hp: 190,
    radius: 0.6,
    speed: 2.2,
    armor: 3,
    poise: 4,
    attacks: [
      { id: 'double-slam', windup: 1.0, active: 0.5, recover: 0.9, range: 3.4, minRange: 0, cooldown: 2.8, damage: 22 },
      { id: 'seal-fan', windup: 0.8, active: 0.08, recover: 0.8, range: 9, minRange: 2.5, cooldown: 2.2, damage: 9 },
      { id: 'charge', windup: 0.8, active: 0.8, recover: 0.9, range: 7, minRange: 3.5, cooldown: 3.2, damage: 18 },
    ],
    keepDistance: null,
    shards: [4, 6],
    moteChance: 0.25,
    scale: 1.5,
  },
  boss: {
    kind: 'boss',
    name: 'The Scribe',
    hp: 520,
    radius: 0.85,
    speed: 2.2,
    armor: 3,
    poise: 6,
    // Phase 1 attacks. The boss swaps to PHASE_TWO_ATTACKS below half health.
    attacks: [
      { id: 'book-slam', windup: 1.1, active: 0.2, recover: 0.8, range: 6.5, minRange: 0, cooldown: 2.6, damage: 20 },
      { id: 'seal-volley', windup: 0.6, active: 0.08, recover: 0.8, range: 9, minRange: 2, cooldown: 1.8, damage: 9 },
      { id: 'page-sweep', windup: 0.8, active: 0.2, recover: 0.7, range: 3.5, minRange: 0, cooldown: 2.2, damage: 22 },
    ],
    keepDistance: null,
    shards: [8, 12],
    moteChance: 0,
    scale: 2.1,
  },
};

/** Attacks the boss uses once its book opens. */
export const PHASE_TWO_ATTACKS: AttackDef[] = [
  { id: 'page-storm', windup: 0.8, active: 0.1, recover: 0.6, range: 9, minRange: 0, cooldown: 2.4, damage: 10 },
  { id: 'ink-rain', windup: 0.9, active: 0.1, recover: 0.8, range: 12, minRange: 0, cooldown: 4, damage: 14 },
  { id: 'triple-dash', windup: 0.5, active: 0.36, recover: 0.7, range: 9, minRange: 2.5, cooldown: 3.4, damage: 16 },
];

export type EnemyStage = 'spawn' | 'chase' | 'windup' | 'active' | 'recover' | 'stagger' | 'stun' | 'transition' | 'dead';

/** The longest reach of any attack. Enemies start an attack once the player is within it. */
export function maxRangeOf(attacks: readonly AttackDef[]): number {
  return attacks.reduce((m, a) => Math.max(m, a.range), 0);
}

export const SPAWN_TIME = 0.8;
export const STAGGER_TIME = 0.3;
export const STUN_TIME = 1.5;
export const COLLAPSE_TIME = 1.1;
export const TRANSITION_TIME = 1.4;
export const CHARGE_SPEED = 9;
export const LUNGE_SPEED = 9;
/** Radius of a front strike, around the point the enemy reaches out to. */
const FRONT_HIT_RADIUS = 0.55;

/** Events the battle turns into hits, projectiles, hazards, audio and effects. */
export type EnemyEvent =
  | { type: 'telegraph'; enemy: Enemy; attack: AttackId; duration: number }
  | { type: 'active'; enemy: Enemy; attack: AttackId }
  | { type: 'bolts'; enemy: Enemy; x: number; z: number; dirX: number; dirZ: number; count: number; spread: number; damage: number }
  | { type: 'radial'; enemy: Enemy; x: number; z: number; count: number; damage: number }
  | { type: 'ring'; enemy: Enemy; x: number; z: number; radius: number; damage: number }
  | { type: 'hitFront'; enemy: Enemy; x: number; z: number; radius: number; damage: number; knockback: number }
  | { type: 'sweep'; enemy: Enemy; arc: number; range: number; damage: number }
  | { type: 'hazards'; enemy: Enemy; spots: Array<{ x: number; z: number }>; damage: number }
  | { type: 'wallStun'; enemy: Enemy }
  | { type: 'phase'; enemy: Enemy; phase: 2 };

export interface EnemyContext {
  player: PlayerState;
  grid: WorldGrid;
  flow: Int32Array;
  time: number;
}

let nextEnemyId = 1;

export class Enemy {
  readonly id = nextEnemyId++;
  readonly def: EnemyDef;
  x: number;
  z: number;
  /** Heading in radians. Forward is -Z when the heading is zero. */
  yaw = 0;
  hp: number;
  armor: number;
  /** Core exposed: armour is gone, or Unshelled has opened it briefly. */
  coreExposed = false;
  coreTimer = 0;
  stage: EnemyStage = 'spawn';
  /** Seconds into the current stage. */
  t = 0;
  attack: AttackDef | null = null;
  cooldowns = new Map<AttackId, number>();
  burnT = 0;
  burnDps = 0;
  vx = 0;
  vz = 0;
  hitDone = false;
  hurtT = 99;
  dirX = 0;
  dirZ = 0;
  /** Phase within a multi-part attack, such as the double slam. */
  part = 0;
  readonly modifierElite: boolean;

  constructor(kind: EnemyKind, x: number, z: number, opts: { gilded?: boolean } = {}) {
    this.def = ENEMY_DEFS[kind];
    this.x = x;
    this.z = z;
    this.hp = this.def.hp;
    this.armor = this.def.armor;
    this.modifierElite = !!opts.gilded;
  }

  get alive(): boolean {
    return this.stage !== 'dead';
  }

  /** The attacks this enemy may choose from right now. Bosses override this per phase. */
  protected attackList(): readonly AttackDef[] {
    return this.def.attacks;
  }

  cooldownOf(id: AttackId): number {
    return this.cooldowns.get(id) ?? 0;
  }

  setStage(stage: EnemyStage): void {
    this.stage = stage;
    this.t = 0;
  }

  protected faceTowards(x: number, z: number, dt: number, rate: number): void {
    const want = Math.atan2(-(x - this.x), -(z - this.z));
    let diff = want - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * rate);
  }

  /** Moves toward a point through the grid, pushing out of walls. */
  protected stepToward(tx: number, tz: number, speed: number, dt: number, grid: WorldGrid): void {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const step = Math.min(d, speed * dt);
    this.x += (dx / d) * step;
    this.z += (dz / d) * step;
    const p = { x: this.x, z: this.z };
    grid.resolveCircle(p, this.def.radius);
    this.x = p.x;
    this.z = p.z;
  }

  /** Gradient step through the walking field. Walks around pillars toward the player. */
  protected pursue(ctx: EnemyContext, dt: number, speed: number): void {
    const next = ctx.grid.nextStep(this.x, this.z, ctx.flow);
    if (next) this.stepToward(next.x, next.z, speed, dt, ctx.grid);
    else this.stepToward(ctx.player.x, ctx.player.z, speed, dt, ctx.grid);
  }

  /** Acolytes hold between their minimum and maximum range, backing off when crowded. */
  private hold(ctx: EnemyContext, dt: number, dist: number): void {
    const band = this.def.keepDistance;
    if (!band) return;
    const dx = this.x - ctx.player.x;
    const dz = this.z - ctx.player.z;
    const d = Math.max(1e-3, dist);
    if (d < band.min) this.stepToward(this.x + (dx / d) * 2, this.z + (dz / d) * 2, this.def.speed, dt, ctx.grid);
    else if (d > band.max) this.pursue(ctx, dt, this.def.speed);
  }

  /** Picks an attack that is off cooldown and fits the distance. Heavy enemies vary by range. */
  protected choose(dist: number): AttackDef | null {
    const options = this.attackList().filter((a) => this.cooldownOf(a.id) <= 0 && dist <= a.range && dist >= a.minRange);
    if (options.length === 0) return null;
    if (this.def.kind === 'bulwark' || this.def.kind === 'elite') {
      const close = options.find((a) => a.id === 'slam' || a.id === 'double-slam');
      const far = options.find((a) => a.id === 'charge' || a.id === 'seal-fan');
      if (close && dist < 3.3) return close;
      return far ?? close ?? null;
    }
    if (this.def.kind === 'boss') {
      const sweep = options.find((a) => a.id === 'page-sweep');
      if (sweep && dist < 3.5) return sweep;
      return options[Math.floor(this.t * 7) % options.length];
    }
    return options[0];
  }

  private beginWindup(attack: AttackDef, out: EnemyEvent[]): void {
    this.attack = attack;
    this.part = 0;
    this.setStage('windup');
    this.hitDone = false;
    this.cooldowns.set(attack.id, attack.cooldown);
    out.push({ type: 'telegraph', enemy: this, attack: attack.id, duration: attack.windup });
  }

  /** Advances this enemy by one fixed step and returns its events. */
  update(dt: number, ctx: EnemyContext): EnemyEvent[] {
    const out: EnemyEvent[] = [];
    if (this.stage === 'dead') return out;
    this.t += dt;
    this.hurtT += dt;
    for (const [id, left] of this.cooldowns) {
      if (left > 0) this.cooldowns.set(id, Math.max(0, left - dt));
    }
    if (this.coreTimer > 0) {
      this.coreTimer = Math.max(0, this.coreTimer - dt);
      if (this.coreTimer === 0 && this.armor > 0) this.coreExposed = false;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const drag = Math.exp(-dt * 10);
    this.vx *= drag;
    this.vz *= drag;

    const { player } = ctx;
    const dist = Math.hypot(player.x - this.x, player.z - this.z);

    switch (this.stage) {
      case 'spawn':
        if (this.t >= SPAWN_TIME) this.setStage('chase');
        break;
      case 'chase': {
        this.faceTowards(player.x, player.z, dt, 8);
        if (this.def.keepDistance) this.hold(ctx, dt, dist);
        else this.pursue(ctx, dt, this.def.speed);
        if (dist <= maxRangeOf(this.attackList()) + this.def.radius) {
          const choice = this.choose(dist);
          if (choice && !ctx.grid.segmentBlocked(this.x, this.z, player.x, player.z)) this.beginWindup(choice, out);
        }
        break;
      }
      case 'windup':
        this.faceTowards(player.x, player.z, dt, 5);
        if (this.attack && this.t >= this.attack.windup) this.beginActive(ctx, out);
        break;
      case 'active':
        this.updateActive(dt, ctx, out);
        break;
      case 'recover':
        this.faceTowards(player.x, player.z, dt, 3);
        // Acolytes keep their distance while recovering, so they never stand still in one spot.
        if (this.def.keepDistance) this.hold(ctx, dt, dist);
        if (this.attack && this.t >= this.attack.recover) this.setStage('chase');
        break;
      case 'stagger':
        if (this.t >= STAGGER_TIME) this.setStage('chase');
        break;
      case 'stun':
        if (this.t >= STUN_TIME) this.setStage('chase');
        break;
      default:
        break;
    }
    return out;
  }

  private beginActive(ctx: EnemyContext, out: EnemyEvent[]): void {
    const attack = this.attack;
    if (!attack) return;
    this.setStage('active');
    const { player } = ctx;
    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const d = Math.max(1e-3, Math.hypot(dx, dz));
    this.dirX = dx / d;
    this.dirZ = dz / d;
    out.push({ type: 'active', enemy: this, attack: attack.id });
    switch (attack.id) {
      case 'bolt':
      case 'seal-fan':
      case 'seal-volley': {
        const count = attack.id === 'seal-fan' ? 5 : attack.id === 'seal-volley' ? 3 : 1;
        const spread = count === 5 ? 22 * DEG : count === 3 ? 14 * DEG : 0;
        out.push({
          type: 'bolts',
          enemy: this,
          x: this.x + this.dirX * 0.4,
          z: this.z + this.dirZ * 0.4,
          dirX: this.dirX,
          dirZ: this.dirZ,
          count,
          spread,
          damage: attack.damage,
        });
        this.hitDone = true;
        break;
      }
      case 'slam':
      case 'book-slam':
        out.push({ type: 'ring', enemy: this, x: this.x, z: this.z, radius: attack.id === 'book-slam' ? 2.5 : 3.2, damage: attack.damage });
        this.hitDone = true;
        break;
      case 'page-sweep':
        out.push({ type: 'sweep', enemy: this, arc: (150 * DEG), range: 3.5, damage: attack.damage });
        this.hitDone = true;
        break;
      case 'page-storm':
        out.push({ type: 'radial', enemy: this, x: this.x, z: this.z, count: 8, damage: attack.damage });
        this.hitDone = true;
        break;
      case 'ink-rain': {
        const spots: Array<{ x: number; z: number }> = [];
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + this.t;
          const r = 1.5 + (i % 2) * 2.2;
          spots.push({ x: player.x + Math.cos(a) * r, z: player.z + Math.sin(a) * r });
        }
        out.push({ type: 'hazards', enemy: this, spots, damage: attack.damage });
        this.hitDone = true;
        break;
      }
      default:
        break;
    }
  }

  private updateActive(dt: number, ctx: EnemyContext, out: EnemyEvent[]): void {
    const attack = this.attack;
    if (!attack) return;
    const { player, grid } = ctx;
    switch (attack.id) {
      case 'lunge':
        this.stepToward(this.x + this.dirX * 2, this.z + this.dirZ * 2, LUNGE_SPEED, dt, grid);
        this.hitFrontOnce(ctx, out, attack.damage, 0.9, 0.45);
        break;
      case 'charge': {
        const before = { x: this.x, z: this.z };
        this.stepToward(this.x + this.dirX * 2, this.z + this.dirZ * 2, CHARGE_SPEED, dt, grid);
        const moved = Math.hypot(this.x - before.x, this.z - before.z);
        if (moved < CHARGE_SPEED * dt * 0.3 && this.t > 0.15) {
          out.push({ type: 'wallStun', enemy: this });
          this.setStage('stun');
          return;
        }
        this.hitFrontOnce(ctx, out, attack.damage, 1.0, 1.3);
        break;
      }
      case 'double-slam':
        if (this.part === 0) {
          out.push({ type: 'ring', enemy: this, x: this.x, z: this.z, radius: 3.2, damage: attack.damage });
          this.part = 1;
        }
        if (this.part === 1 && this.t >= 0.5) {
          out.push({ type: 'ring', enemy: this, x: this.x, z: this.z, radius: 4.2, damage: attack.damage });
          this.part = 2;
        }
        break;
      case 'triple-dash':
        // Three dashes in a row. Each one re-aims at the player when it begins.
        this.stepToward(this.x + this.dirX * 2, this.z + this.dirZ * 2, 10, dt, grid);
        this.hitFrontOnce(ctx, out, attack.damage, 1.0, 0.9);
        if (this.t >= attack.active && this.part < 2) {
          this.part += 1;
          const dx = player.x - this.x;
          const dz = player.z - this.z;
          const d = Math.max(1e-3, Math.hypot(dx, dz));
          this.dirX = dx / d;
          this.dirZ = dz / d;
          this.hitDone = false;
          this.t = 0;
          return;
        }
        break;
      default:
        break;
    }
    if (this.t >= attack.active) {
      if (attack.id === 'double-slam' && this.part < 2) return;
      this.setStage('recover');
    }
  }

  private hitFrontOnce(ctx: EnemyContext, out: EnemyEvent[], damage: number, reach: number, knockback: number): void {
    if (this.hitDone) return;
    const { player } = ctx;
    const fx = this.x + this.dirX * reach;
    const fz = this.z + this.dirZ * reach;
    // The same reach the battle checks when it applies the hit, so a strike that is spent always lands.
    if (Math.hypot(player.x - fx, player.z - fz) <= FRONT_HIT_RADIUS + PLAYER_TUNING.radius) {
      this.hitDone = true;
      out.push({ type: 'hitFront', enemy: this, x: fx, z: fz, radius: FRONT_HIT_RADIUS, damage, knockback });
    }
  }

  /** Interrupts an enemy with a heavy hit. Windups and actives drop into a stagger. */
  stagger(): void {
    if (this.stage === 'windup' || this.stage === 'active' || this.stage === 'recover' || this.stage === 'chase') {
      this.attack = null;
      this.setStage('stagger');
    }
  }

  /** Advances the collapse timer of a dead enemy, so its body leaves the battle once the collapse ends. */
  tickDead(dt: number): void {
    if (this.stage === 'dead') this.t += dt;
  }

  /** Marks the enemy dead. Returns true if this call was the one that killed it. */
  die(): boolean {
    if (this.stage === 'dead') return false;
    this.hp = 0;
    this.setStage('dead');
    return true;
  }
}

/**
 * Damage rules for one hit. Armour reduces normal damage to 35%. An exposed core
 * (armour gone, or a temporary opening) multiplies it by `coreMul`. A stunned
 * enemy takes a quarter more.
 */
export function applyArmourRule(enemy: Enemy, base: number, coreMul: number): number {
  if (enemy.stage === 'dead' || enemy.stage === 'transition') return 0;
  // A core is exposed only once armour that the enemy had has been stripped away. Enemies born without armour, such as husks, never take the bonus.
  const exposed = (enemy.def.armor > 0 && enemy.armor <= 0) || enemy.coreExposed;
  const armourMul = enemy.armor > 0 ? 0.35 : 1;
  const coreFactor = exposed ? coreMul : 1;
  const stunFactor = enemy.stage === 'stun' ? 1.25 : 1;
  return base * armourMul * coreFactor * stunFactor;
}

export function resetEnemyIds(): void {
  nextEnemyId = 1;
}
