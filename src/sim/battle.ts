import { type Rng } from '../core/rng';
import type { Layout } from '../world/tiles';
import { WorldGrid, type Vec2 } from './grid';
import { type AttackId, Enemy, type EnemyEvent, type EnemyKind, applyArmourRule } from './enemies';
import { Boss } from './boss';
import { type Mods } from './mods';
import { PLAYER_TUNING, type MoveIntent, type PlayerState, createPlayer, damagePlayer, isInvulnerable, updatePlayer } from './player';
import { type GlaiveState, type QuillState, type SwingSpec, createGlaive, createQuill, quillBoltDamage, quillShot, updateGlaive, updateQuill, QUILL } from './weapons';
import { type Fragment, type TearShot, type TearState, TEAR, createTear, updateTear } from './tear';
import { type Projectile, makeProjectile, updateProjectiles } from './projectiles';

export const MAX_ACTIVE_ENEMIES = 4;
const TRAIL_RADIUS = 1.1;
const TRAIL_INTERVAL = 0.12;

/** One fixed step of player intent, already in world directions. */
export interface StepInput {
  move: MoveIntent;
  fireJust: boolean;
  fireHeld: boolean;
  tearHeld: boolean;
  tearReleased: boolean;
}

/** Facts the effects, audio and UI layers react to. The battle never draws anything itself. */
export type BattleEvent =
  | { type: 'swingStart'; index: number }
  | { type: 'swing'; index: number; heavy: boolean; x: number; z: number; yaw: number; arc: number; range: number; riposte: boolean }
  | { type: 'shot'; x: number; z: number; dirX: number; dirZ: number; count: number }
  | { type: 'impact'; x: number; y: number; z: number; owner: 'player' | 'enemy'; kind: string }
  | { type: 'tear'; shot: TearShot }
  | { type: 'fragmentLaunch'; x: number; y: number; z: number }
  | { type: 'enemyHurt'; enemy: Enemy; amount: number; x: number; z: number; source: string; heavy: boolean; core: boolean }
  | { type: 'armourBroken'; enemy: Enemy; x: number; z: number; coreExposed: boolean }
  | { type: 'ignited'; enemy: Enemy }
  | { type: 'enemyDied'; enemy: Enemy; x: number; z: number; burning: boolean }
  | { type: 'kindlingBlast'; x: number; z: number; radius: number }
  | { type: 'telegraph'; enemy: Enemy; attack: AttackId; duration: number }
  | { type: 'attackActive'; enemy: Enemy; attack: AttackId }
  | { type: 'ring'; x: number; z: number; radius: number; enemy: Enemy }
  | { type: 'wallStun'; enemy: Enemy }
  | { type: 'stagger'; enemy: Enemy }
  | { type: 'spawnRune'; x: number; z: number; kind: EnemyKind }
  | { type: 'playerHurt'; amount: number; x: number; z: number; fromX: number; fromZ: number }
  | { type: 'playerDied' }
  | { type: 'bossPhase'; enemy: Enemy; phase: 2 }
  | { type: 'hazardArmed'; x: number; z: number; timer: number }
  | { type: 'hazardBurst'; x: number; z: number; radius: number; hit: boolean }
  | { type: 'dodge'; phase: 'start' | 'end' }
  | { type: 'pickup'; kind: 'shard' | 'mote'; x: number; z: number; amount: number }
  | { type: 'roomCleared' }
  | { type: 'doorEntered'; exitIndex: number };

/** An ink hazard on the floor: it shows for a telegraph time, then bursts once. */
export interface Hazard {
  x: number;
  z: number;
  timer: number;
  damage: number;
}

export interface Pickup {
  kind: 'shard' | 'mote';
  x: number;
  z: number;
  amount: number;
  life: number;
}

interface HitOptions {
  source: string;
  heavy: boolean;
  knockback: number;
  dirX: number;
  dirZ: number;
  /** Glaive or armour-breaking effects that remove one layer. */
  breakArmour: boolean;
  /** The tear always removes one layer. */
  tearLayer: boolean;
  ignite: boolean;
  stagger: boolean;
}

/**
 * One room: player, weapons, Tear, enemies, projectiles, drops, waves and doors.
 * Each `step` advances one fixed tick and queues events for the rest of the game.
 */
export class Battle {
  readonly layout: Layout;
  readonly grid: WorldGrid;
  readonly rng: Rng;
  mods: Mods;
  /** The primary weapon equipped for this run. */
  weapon: 'glaive' | 'quill';
  player: PlayerState;
  glaive: GlaiveState = createGlaive();
  quill: QuillState = createQuill();
  tear: TearState = createTear();
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  hazards: Hazard[] = [];
  /** Enemies waiting for a free spawn point. */
  pending: Array<{ kind: EnemyKind; gilded: boolean }> = [];
  events: BattleEvent[] = [];
  time = 0;
  shards = 0;
  kills = 0;
  damageTaken = 0;
  cleared = false;
  exited = false;
  private readonly trailHit = new Set<number>();
  private trailTimer = 0;

  constructor(opts: { layout: Layout; rng: Rng; mods: Mods; weapon: 'glaive' | 'quill'; player?: PlayerState; shards?: number }) {
    this.layout = opts.layout;
    this.grid = new WorldGrid(opts.layout);
    this.rng = opts.rng;
    this.mods = opts.mods;
    this.weapon = opts.weapon;
    this.shards = opts.shards ?? 0;
    this.player =
      opts.player ?? createPlayer(opts.layout.start.x + 0.5, opts.layout.start.y + 0.5, opts.mods.maxHp, opts.mods.dodgeCharges);
    this.grid.setDoorsLocked(true);
  }

  /** Queues enemies. They arrive as spawn points free up, never more than MAX_ACTIVE_ENEMIES at once. */
  queueWave(kinds: EnemyKind[], gilded = false): void {
    for (const kind of kinds) this.pending.push({ kind, gilded });
  }

  /** Places an enemy directly at a world position. Used for bosses and tests. */
  addEnemy(kind: EnemyKind, x: number, z: number, gilded = false): Enemy {
    const e = kind === 'boss' ? new Boss(x, z) : new Enemy(kind, x, z, { gilded });
    this.enemies.push(e);
    return e;
  }

  get aliveEnemies(): Enemy[] {
    return this.enemies.filter((e) => e.alive);
  }

  get roomClear(): boolean {
    return this.pending.length === 0 && this.aliveEnemies.length === 0;
  }

  /** Charge fraction for the HUD ring. */
  get tearCharge(): number {
    return Math.min(1, this.tear.charge / (TEAR.chargeTime * this.mods.tear.chargeMul));
  }

  drain(): BattleEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private emit(e: BattleEvent): void {
    this.events.push(e);
  }

  /** Advances the room by one fixed step. */
  step(dt: number, input: StepInput): void {
    if (this.exited || !this.player.alive) return;
    this.time += dt;

    const ev = updatePlayer(this.player, dt, input.move, this.grid, {
      cooldownMul: this.mods.dodge.cooldownMul,
      distanceMul: this.mods.dodge.distanceMul,
    });
    if (ev.dodgeStarted) {
      this.emit({ type: 'dodge', phase: 'start' });
      this.trailHit.clear();
      this.trailTimer = 0;
    }
    if (ev.dodgeEnded) {
      this.emit({ type: 'dodge', phase: 'end' });
      if (this.mods.glaive.riposte) this.glaive.riposteArmed = true;
    }
    if (this.player.dodging && this.mods.dodge.trailDamage > 0) this.updateTrail(dt);

    this.updateWeapons(dt, input);
    this.updateEnemies(dt);
    this.updateProjectileList(dt);
    this.updateHazards(dt);
    this.updateDrops(dt);
    this.spawnPending();
    this.separateEnemies();
    this.checkRoomState();
  }

  private forward(input: StepInput): { x: number; z: number } {
    return input.move.forward;
  }

  private updateWeapons(dt: number, input: StepInput): void {
    const forward = this.forward(input);
    if (this.weapon === 'glaive') {
      const swing = updateGlaive(this.glaive, dt, input.fireJust, this.mods, false);
      if (swing.swingStarted) this.emit({ type: 'swingStart', index: this.glaive.index });
      if (swing.activeStarted) {
        const a = swing.activeStarted;
        this.resolveSwing(a.spec, a.index, a.damageMul, a.riposte, forward);
      }
    } else if (updateQuill(this.quill, dt, input.fireHeld, this.mods) > 0) {
      this.fireQuill(forward);
    }

    const shot = updateTear(this.tear, dt, input.tearHeld, input.tearReleased, this.mods, this.player.x, this.player.z, forward);
    if (shot) this.releaseTear(shot);
    this.fireOrbiting(this.mods.tear.orbitStorm && !!shot);
  }

  private resolveSwing(spec: SwingSpec, index: number, damageMul: number, riposte: boolean, forward: { x: number; z: number }): void {
    this.emit({
      type: 'swing',
      index,
      heavy: spec.heavy,
      x: this.player.x,
      z: this.player.z,
      yaw: Math.atan2(-forward.x, -forward.z),
      arc: spec.arc,
      range: spec.range,
      riposte,
    });
    const cosHalf = Math.cos(spec.arc / 2);
    for (const e of this.aliveEnemies) {
      if (this.glaive.hitIds.has(e.id)) continue;
      const dx = e.x - this.player.x;
      const dz = e.z - this.player.z;
      const d = Math.max(1e-4, Math.hypot(dx, dz));
      if (d > spec.range + e.def.radius) continue;
      if ((dx * forward.x + dz * forward.z) / d < cosHalf) continue;
      this.glaive.hitIds.add(e.id);
      const base = spec.damage * this.mods.glaive.damageMul * this.mods.damageMul * damageMul;
      this.hitEnemy(e, base, {
        source: 'glaive',
        heavy: spec.heavy,
        knockback: spec.knockback,
        dirX: dx / d,
        dirZ: dz / d,
        breakArmour: this.mods.glaive.breakArmor,
        tearLayer: false,
        ignite: this.mods.glaive.ignite,
        stagger: spec.heavy || riposte,
      });
    }
  }

  private fireQuill(forward: { x: number; z: number }): void {
    const { count, spread } = quillShot(this.mods);
    const target = this.nearestEnemyInCone(forward, QUILL.assistAngle, 14);
    const baseAngle = Math.atan2(forward.z, forward.x);
    for (let i = 0; i < count; i++) {
      let angle = baseAngle + (i - (count - 1) / 2) * spread;
      if (target && count === 1) {
        const want = Math.atan2(target.z - this.player.z, target.x - this.player.x);
        let diff = want - angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        angle += Math.max(-QUILL.assistAngle, Math.min(QUILL.assistAngle, diff));
      }
      this.projectiles.push(
        makeProjectile({
          owner: 'player',
          kind: 'bolt',
          x: this.player.x + Math.cos(angle) * 0.5,
          z: this.player.z + Math.sin(angle) * 0.5,
          vx: Math.cos(angle) * QUILL.speed,
          vz: Math.sin(angle) * QUILL.speed,
          life: QUILL.life,
          radius: 0.14,
          damage: quillBoltDamage(this.mods),
          pierce: this.mods.quill.pierce,
        }),
      );
    }
    this.emit({ type: 'shot', x: this.player.x, z: this.player.z, dirX: forward.x, dirZ: forward.z, count });
  }

  private nearestEnemyInCone(forward: { x: number; z: number }, halfAngle: number, range: number): Vec2 | null {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const e of this.aliveEnemies) {
      const dx = e.x - this.player.x;
      const dz = e.z - this.player.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 1e-3) continue;
      const cos = Math.min(1, Math.max(-1, (dx * forward.x + dz * forward.z) / d));
      if (Math.acos(cos) > halfAngle) continue;
      if (d < bestD) {
        bestD = d;
        best = { x: e.x, z: e.z };
      }
    }
    return best;
  }

  private releaseTear(shot: TearShot): void {
    this.emit({ type: 'tear', shot });
    for (const e of this.aliveEnemies) {
      const dx = e.x - shot.x;
      const dz = e.z - shot.z;
      const along = dx * shot.dirX + dz * shot.dirZ;
      if (along < 0 || along > shot.length + e.def.radius) continue;
      const lateral = Math.abs(dx * -shot.dirZ + dz * shot.dirX);
      if (lateral > shot.halfWidth + e.def.radius) continue;
      this.hitEnemy(e, TEAR.damage * this.mods.damageMul, {
        source: 'tear',
        heavy: false,
        knockback: 0.8,
        dirX: shot.dirX,
        dirZ: shot.dirZ,
        breakArmour: false,
        tearLayer: true,
        ignite: false,
        stagger: true,
      });
    }
  }

  /**
   * Launches orbiting fragments at the nearest enemies. When `all` is true (Orbit
   * Storm, on release) every fragment fires at once, otherwise only those whose
   * timers have run out.
   */
  private fireOrbiting(all: boolean): void {
    for (const f of this.tear.fragments) {
      if (f.fired) continue;
      if (!all && f.fireCooldown > 0) continue;
      const target = this.nearestEnemy(f.x, f.z, all ? 16 : 14);
      if (!target) {
        f.fireCooldown = 0.2;
        continue;
      }
      this.launchFragment(f, target);
    }
    this.tear.fragments = this.tear.fragments.filter((f) => !f.fired);
  }

  private launchFragment(f: Fragment, target: Enemy): void {
    const dx = target.x - f.x;
    const dz = target.z - f.z;
    const d = Math.max(1e-3, Math.hypot(dx, dz));
    this.projectiles.push(
      makeProjectile({
        owner: 'player',
        kind: 'fragment',
        x: f.x,
        y: f.y,
        z: f.z,
        vx: (dx / d) * TEAR.fragmentSpeed,
        vz: (dz / d) * TEAR.fragmentSpeed,
        life: TEAR.fragmentFlyLife,
        radius: 0.16,
        damage: TEAR.fragmentDamage * this.mods.damageMul,
        homing: 9,
        targetId: target.id,
      }),
    );
    f.fired = true;
    this.emit({ type: 'fragmentLaunch', x: f.x, y: f.y, z: f.z });
  }

  private nearestEnemy(x: number, z: number, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = range;
    for (const e of this.aliveEnemies) {
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Blank Step: the dodge trail strikes each enemy it passes once per dodge. */
  private updateTrail(dt: number): void {
    this.trailTimer -= dt;
    if (this.trailTimer > 0) return;
    this.trailTimer = TRAIL_INTERVAL;
    for (const e of this.aliveEnemies) {
      if (this.trailHit.has(e.id)) continue;
      if (Math.hypot(e.x - this.player.x, e.z - this.player.z) > TRAIL_RADIUS + e.def.radius) continue;
      this.trailHit.add(e.id);
      this.hitEnemy(e, this.mods.dodge.trailDamage * this.mods.damageMul, {
        source: 'trail',
        heavy: false,
        knockback: 0.2,
        dirX: e.x - this.player.x,
        dirZ: e.z - this.player.z,
        breakArmour: false,
        tearLayer: false,
        ignite: false,
        stagger: false,
      });
      if (this.mods.dodge.mirrorStep) this.glaive.riposteArmed = true;
    }
  }

  /**
   * Applies one hit. A tear or armour-breaking glaive removes a layer first, so
   * a hit that strips the last layer exposes the core for its own damage.
   * Armour reduces the rest, exposed cores take extra, and heavy hits stagger.
   */
  hitEnemy(e: Enemy, base: number, opt: HitOptions): void {
    if (!e.alive) return;
    let broke = false;
    if ((opt.breakArmour || opt.tearLayer) && e.armor > 0) {
      e.armor -= 1;
      broke = true;
      if (e.armor === 0) e.coreExposed = true;
      if (opt.breakArmour && this.mods.glaive.unshelled) {
        e.coreExposed = true;
        e.coreTimer = 2;
      }
      this.emit({ type: 'armourBroken', enemy: e, x: e.x, z: e.z, coreExposed: e.coreExposed });
    }
    const core = e.coreExposed;
    const dealt = applyArmourRule(e, base, this.mods.tear.coreMul);
    e.hp -= dealt;
    e.hurtT = 0;
    this.emit({
      type: 'enemyHurt',
      enemy: e,
      amount: dealt,
      x: e.x,
      z: e.z,
      source: opt.source,
      heavy: opt.heavy,
      core: core && !broke,
    });
    if (opt.knockback > 0) {
      e.vx += opt.dirX * opt.knockback * 4;
      e.vz += opt.dirZ * opt.knockback * 4;
    }
    if (opt.ignite) {
      if (e.burnT <= 0) this.emit({ type: 'ignited', enemy: e });
      e.burnT = 3;
      e.burnDps = 4;
    }
    if (opt.stagger && e.def.poise <= (opt.heavy || opt.tearLayer ? 3 : 1)) {
      e.stagger();
      this.emit({ type: 'stagger', enemy: e });
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy): void {
    if (!e.die()) return;
    this.kills += 1;
    const burning = e.burnT > 0;
    this.emit({ type: 'enemyDied', enemy: e, x: e.x, z: e.z, burning });
    const [lo, hi] = e.def.shards;
    const amount = lo + Math.floor(this.rng() * (hi - lo + 1));
    this.pickups.push({ kind: 'shard', x: e.x, z: e.z, amount: Math.max(1, Math.round(amount * this.mods.shardMul)), life: 30 });
    // Ink Famine: healing comes only from Mend, so enemies drop no health motes.
    if (!this.mods.inkFamine && this.rng() < e.def.moteChance) this.pickups.push({ kind: 'mote', x: e.x, z: e.z, amount: 8, life: 30 });
    if (burning && (this.mods.kindling || this.mods.pyre)) {
      const radius = this.mods.pyre ? 3.2 : 2.5;
      this.emit({ type: 'kindlingBlast', x: e.x, z: e.z, radius });
      for (const other of this.aliveEnemies) {
        const dx = other.x - e.x;
        const dz = other.z - e.z;
        if (Math.hypot(dx, dz) > radius) continue;
        this.hitEnemy(other, 14 * this.mods.damageMul, {
          source: 'burst',
          heavy: false,
          knockback: 0.5,
          dirX: dx,
          dirZ: dz,
          breakArmour: false,
          tearLayer: false,
          ignite: this.mods.pyre,
          stagger: false,
        });
      }
    }
  }

  private updateEnemies(dt: number): void {
    const flow = this.grid.flowTo(Math.floor(this.player.x), Math.floor(this.player.z));
    for (const e of this.enemies) {
      if (!e.alive) {
        e.tickDead(dt);
        continue;
      }
      if (e.burnT > 0) {
        e.hp -= e.burnDps * dt;
        if (e.hp <= 0) {
          this.killEnemy(e);
          continue;
        }
      }
      for (const ev of e.update(dt, { player: this.player, grid: this.grid, flow, time: this.time })) {
        this.handleEnemyEvent(ev);
      }
    }
    // Dead enemies stay visible while they collapse, then leave the list.
    this.enemies = this.enemies.filter((e) => e.stage !== 'dead' || e.t < 1.1);
  }

  private handleEnemyEvent(ev: EnemyEvent): void {
    switch (ev.type) {
      case 'telegraph':
        this.emit({ type: 'telegraph', enemy: ev.enemy, attack: ev.attack, duration: ev.duration });
        break;
      case 'active':
        this.emit({ type: 'attackActive', enemy: ev.enemy, attack: ev.attack });
        break;
      case 'bolts': {
        const base = Math.atan2(ev.dirZ, ev.dirX);
        const sp = ev.enemy.def.kind === 'elite' || ev.enemy.def.kind === 'boss' ? 7 : 8;
        for (let i = 0; i < ev.count; i++) {
          const a = base + (i - (ev.count - 1) / 2) * ev.spread;
          this.spawnEnemyBolt(ev.x, ev.z, a, sp, ev.damage, 3);
        }
        break;
      }
      case 'radial':
        for (let i = 0; i < ev.count; i++) {
          this.spawnEnemyBolt(ev.x, ev.z, (i / ev.count) * Math.PI * 2, 5.5, ev.damage, 3.2);
        }
        break;
      case 'ring': {
        this.emit({ type: 'ring', x: ev.x, z: ev.z, radius: ev.radius, enemy: ev.enemy });
        if (Math.hypot(this.player.x - ev.x, this.player.z - ev.z) <= ev.radius + PLAYER_TUNING.radius) {
          this.hurtPlayer(ev.damage, ev.x, ev.z, 1.2);
        }
        break;
      }
      case 'hitFront':
        if (Math.hypot(this.player.x - ev.x, this.player.z - ev.z) <= ev.radius + PLAYER_TUNING.radius) {
          this.hurtPlayer(ev.damage, ev.enemy.x, ev.enemy.z, ev.knockback);
        }
        break;
      case 'sweep': {
        // A wide arc in front of the enemy, resolved once on its active frame.
        const dx = this.player.x - ev.enemy.x;
        const dz = this.player.z - ev.enemy.z;
        const d = Math.max(1e-4, Math.hypot(dx, dz));
        const facing = { x: -Math.sin(ev.enemy.yaw), z: -Math.cos(ev.enemy.yaw) };
        const inArc = (dx * facing.x + dz * facing.z) / d >= Math.cos(ev.arc / 2);
        if (d <= ev.range + PLAYER_TUNING.radius && inArc) this.hurtPlayer(ev.damage, ev.enemy.x, ev.enemy.z, 0.8);
        break;
      }
      case 'hazards':
        for (const spot of ev.spots) {
          const timer = 1.2;
          this.hazards.push({ x: spot.x, z: spot.z, timer, damage: ev.damage });
          this.emit({ type: 'hazardArmed', x: spot.x, z: spot.z, timer });
        }
        break;
      case 'phase':
        this.emit({ type: 'bossPhase', enemy: ev.enemy, phase: ev.phase });
        break;
      case 'wallStun':
        this.emit({ type: 'wallStun', enemy: ev.enemy });
        break;
    }
  }

  private spawnEnemyBolt(x: number, z: number, angle: number, speed: number, damage: number, life: number): void {
    this.projectiles.push(
      makeProjectile({
        owner: 'enemy',
        kind: 'seal',
        x,
        z,
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        life,
        radius: 0.22,
        damage,
      }),
    );
  }

  /** Ink hazards count down, then burst once on the player if they stand in one. */
  private updateHazards(dt: number): void {
    const remaining: Hazard[] = [];
    for (const h of this.hazards) {
      h.timer -= dt;
      if (h.timer > 0) {
        remaining.push(h);
        continue;
      }
      const hit = Math.hypot(this.player.x - h.x, this.player.z - h.z) <= 1.1 + PLAYER_TUNING.radius;
      this.emit({ type: 'hazardBurst', x: h.x, z: h.z, radius: 1.1, hit });
      if (hit) this.hurtPlayer(h.damage, h.x, h.z, 0.3);
    }
    this.hazards = remaining;
  }

  /** Damage to the player. Dodge invulnerability blocks it. Returns true when it landed. */
  hurtPlayer(amount: number, fromX: number, fromZ: number, knockback: number): boolean {
    if (!this.player.alive || isInvulnerable(this.player)) return false;
    const dealt = damagePlayer(this.player, amount);
    if (dealt <= 0) return false;
    this.damageTaken += dealt;
    const dx = this.player.x - fromX;
    const dz = this.player.z - fromZ;
    const d = Math.max(1e-3, Math.hypot(dx, dz));
    this.player.vx += (dx / d) * knockback * 3;
    this.player.vz += (dz / d) * knockback * 3;
    this.player.staggerT = Math.max(this.player.staggerT, 0.12);
    this.emit({ type: 'playerHurt', amount: dealt, x: this.player.x, z: this.player.z, fromX, fromZ });
    if (!this.player.alive) this.emit({ type: 'playerDied' });
    return true;
  }

  private updateProjectileList(dt: number): void {
    this.projectiles = updateProjectiles(this.projectiles, dt, this.grid, {
      player: (p) => this.hurtPlayer(p.damage, p.x, p.z, 0.4),
      enemy: (p, id) => {
        const e = this.enemies.find((en) => en.id === id);
        if (!e || !e.alive) return;
        const fragment = p.kind === 'fragment';
        this.hitEnemy(e, p.damage, {
          source: fragment ? 'fragment' : 'quill',
          heavy: false,
          knockback: 0.25,
          dirX: p.vx,
          dirZ: p.vz,
          breakArmour: false,
          tearLayer: false,
          ignite: this.mods.glaive.ignite && fragment,
          stagger: false,
        });
      },
      targetAt: (id) => {
        const e = this.enemies.find((en) => en.id === id && en.alive);
        return e ? { x: e.x, z: e.z } : null;
      },
      enemiesNear: (x, z, r) =>
        this.aliveEnemies
          .filter((e) => Math.hypot(e.x - x, e.z - z) <= r + e.def.radius)
          .map((e) => ({ id: e.id, x: e.x, z: e.z, radius: e.def.radius })),
      playerAt: () => ({ x: this.player.x, z: this.player.z, radius: PLAYER_TUNING.radius }),
      impact: (p) => this.emit({ type: 'impact', x: p.x, y: p.y, z: p.z, owner: p.owner, kind: p.kind }),
    });
  }

  private updateDrops(dt: number): void {
    const remaining: Pickup[] = [];
    for (const p of this.pickups) {
      p.life -= dt;
      const dx = this.player.x - p.x;
      const dz = this.player.z - p.z;
      const d = Math.hypot(dx, dz);
      if (p.kind === 'shard' && d < 1.5) {
        const pull = Math.min(d, 6 * dt);
        p.x += (dx / Math.max(d, 1e-3)) * pull;
        p.z += (dz / Math.max(d, 1e-3)) * pull;
      }
      if (d < 0.7) {
        if (p.kind === 'shard') this.shards += p.amount;
        else this.player.hp = Math.min(this.player.maxHp, this.player.hp + p.amount);
        this.emit({ type: 'pickup', kind: p.kind, x: p.x, z: p.z, amount: p.amount });
      } else if (p.life > 0) {
        remaining.push(p);
      }
    }
    this.pickups = remaining;
  }

  private spawnPending(): void {
    if (this.pending.length === 0 || this.aliveEnemies.length >= MAX_ACTIVE_ENEMIES) return;
    const spot = this.pickSpawnPoint();
    if (!spot) return;
    const next = this.pending.shift();
    if (!next) return;
    this.emit({ type: 'spawnRune', x: spot.x, z: spot.z, kind: next.kind });
    this.addEnemy(next.kind, spot.x, spot.z, next.gilded);
  }

  /**
   * The spawn point to use next. Fair spawns are preferred: far from the player and
   * clear of other enemies. If none qualifies, the farthest clear point is used, so
   * a queued enemy can never be stranded and softlock the room.
   */
  private pickSpawnPoint(): Vec2 | null {
    const spots = this.layout.spawns
      .map((s) => {
        const x = s.x + 0.5;
        const z = s.y + 0.5;
        return { x, z, d: Math.hypot(x - this.player.x, z - this.player.z) };
      })
      .sort((a, b) => b.d - a.d);
    const clear = (c: Vec2): boolean => this.aliveEnemies.every((e) => Math.hypot(e.x - c.x, e.z - c.z) >= 3);
    const fair = spots.find((c) => c.d >= 6 && clear(c));
    if (fair) return fair;
    const any = spots.find((c) => clear(c));
    if (any) return any;
    return this.aliveEnemies.length === 0 && spots.length > 0 ? spots[0] : null;
  }

  /** Pushes overlapping enemies apart so they do not stack. */
  private separateEnemies(): void {
    const list = this.aliveEnemies;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = (a.def.radius + b.def.radius) * 0.95;
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) * 0.5;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
      }
    }
    // Separation can push an enemy into a wall. Keep every enemy on the floor.
    for (const e of list) {
      const p = { x: e.x, z: e.z };
      this.grid.resolveCircle(p, e.def.radius);
      e.x = p.x;
      e.z = p.z;
    }
  }

  private checkRoomState(): void {
    if (!this.cleared && this.roomClear) {
      this.cleared = true;
      this.grid.setDoorsLocked(false);
      this.emit({ type: 'roomCleared' });
    }
    if (!this.cleared) return;
    const door = this.grid.doorAt(this.player.x, this.player.z);
    if (door < 0) return;
    const x = door % this.layout.w;
    const y = (door - x) / this.layout.w;
    const exit = this.layout.doors.find((d) => d.role === 'exit' && d.x === x && d.y === y);
    if (exit) {
      this.exited = true;
      this.emit({ type: 'doorEntered', exitIndex: exit.exitIndex });
    }
  }
}
