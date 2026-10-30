import type { WorldGrid } from './grid';

/** Tuning for the player body. Values come from the design spec. */
export const PLAYER_TUNING = {
  maxHp: 100,
  speed: 6.2,
  accel: 40,
  radius: 0.35,
  inkSlow: 0.65,
  dodge: {
    duration: 0.42,
    speed: 13,
    iframeStart: 0.05,
    iframeEnd: 0.3,
    cooldown: 0.85,
  },
} as const;

export interface PlayerState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Seconds since the current dodge began. Only meaningful while `dodging`. */
  dodgeT: number;
  dodging: boolean;
  dodgeDx: number;
  dodgeDz: number;
  /** Dodges available now, and the maximum the boons and upgrades allow. */
  dodgeCharges: number;
  dodgeMaxCharges: number;
  /** Seconds until the next charge returns. */
  dodgeRecharge: number;
  /** Seconds since the last hurt, used for the damage flash. */
  hurtT: number;
  /** Remaining stagger seconds. While above zero the player cannot act. */
  staggerT: number;
  /** Ink in the current tile slows movement. Recomputed each tick. */
  inInk: boolean;
}

export function createPlayer(x: number, z: number, maxHp: number, dodgeCharges = 1): PlayerState {
  return {
    x,
    z,
    vx: 0,
    vz: 0,
    hp: maxHp,
    maxHp,
    alive: true,
    dodgeT: 0,
    dodging: false,
    dodgeDx: 0,
    dodgeDz: 0,
    dodgeCharges,
    dodgeMaxCharges: dodgeCharges,
    dodgeRecharge: 0,
    hurtT: 0,
    staggerT: 0,
    inInk: false,
  };
}

export interface MoveIntent {
  /** Strafe input: -1 left, +1 right. */
  moveX: number;
  /** Walk input: -1 back, +1 forward. */
  moveY: number;
  forward: { x: number; z: number };
  right: { x: number; z: number };
  dodgePressed: boolean;
}

/** Upgrade multipliers that change how the dodge behaves. */
export interface DodgeMods {
  cooldownMul: number;
  distanceMul: number;
}

export interface PlayerEvents {
  dodgeStarted: boolean;
  dodgeEnded: boolean;
}

/** Whether the player is invulnerable this instant, from the dodge's invulnerability window. */
export function isInvulnerable(p: PlayerState): boolean {
  const d = PLAYER_TUNING.dodge;
  return p.dodging && p.dodgeT >= d.iframeStart && p.dodgeT <= d.iframeEnd;
}

/** Advances movement, dodge and timers by one fixed step. */
export function updatePlayer(
  p: PlayerState,
  dt: number,
  intent: MoveIntent,
  grid: WorldGrid,
  dodgeMods: DodgeMods = { cooldownMul: 1, distanceMul: 1 },
): PlayerEvents {
  const events: PlayerEvents = { dodgeStarted: false, dodgeEnded: false };
  if (!p.alive) return events;
  const d = PLAYER_TUNING.dodge;
  const cooldown = d.cooldown * dodgeMods.cooldownMul;

  p.hurtT += dt;
  if (p.staggerT > 0) p.staggerT = Math.max(0, p.staggerT - dt);
  if (p.dodgeCharges < p.dodgeMaxCharges) {
    p.dodgeRecharge -= dt;
    if (p.dodgeRecharge <= 0) {
      p.dodgeCharges += 1;
      p.dodgeRecharge = p.dodgeCharges < p.dodgeMaxCharges ? cooldown : 0;
    }
  }

  const canAct = p.staggerT <= 0;
  if (!p.dodging && canAct && intent.dodgePressed && p.dodgeCharges > 0) {
    let dx = intent.right.x * intent.moveX + intent.forward.x * intent.moveY;
    let dz = intent.right.z * intent.moveX + intent.forward.z * intent.moveY;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) {
      dx = intent.forward.x;
      dz = intent.forward.z;
    } else {
      dx /= len;
      dz /= len;
    }
    p.dodging = true;
    p.dodgeT = 0;
    p.dodgeDx = dx;
    p.dodgeDz = dz;
    if (p.dodgeCharges === p.dodgeMaxCharges) p.dodgeRecharge = cooldown;
    p.dodgeCharges -= 1;
    events.dodgeStarted = true;
  }

  const tile = grid.inkAt(p.x, p.z);
  p.inInk = tile;
  const slow = tile ? PLAYER_TUNING.inkSlow : 1;

  if (p.dodging) {
    p.dodgeT += dt;
    const t = Math.min(1, p.dodgeT / d.duration);
    const speed = d.speed * dodgeMods.distanceMul * Math.pow(1 - t, 0.6);
    p.vx = p.dodgeDx * speed;
    p.vz = p.dodgeDz * speed;
    if (p.dodgeT >= d.duration) {
      p.dodging = false;
      events.dodgeEnded = true;
    }
  } else if (canAct) {
    let dx = intent.right.x * intent.moveX + intent.forward.x * intent.moveY;
    let dz = intent.right.z * intent.moveX + intent.forward.z * intent.moveY;
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      dx /= len;
      dz /= len;
    }
    const cap = PLAYER_TUNING.speed * slow;
    const tvx = dx * cap;
    const tvz = dz * cap;
    const step = PLAYER_TUNING.accel * dt;
    const ddx = tvx - p.vx;
    const ddz = tvz - p.vz;
    const dd = Math.hypot(ddx, ddz);
    if (dd <= step) {
      p.vx = tvx;
      p.vz = tvz;
    } else {
      p.vx += (ddx / dd) * step;
      p.vz += (ddz / dd) * step;
    }
  } else {
    p.vx *= Math.exp(-dt * 12);
    p.vz *= Math.exp(-dt * 12);
  }

  p.x += p.vx * dt;
  p.z += p.vz * dt;
  const pos = { x: p.x, z: p.z };
  grid.resolveCircle(pos, PLAYER_TUNING.radius);
  p.x = pos.x;
  p.z = pos.z;
  return events;
}

/** Applies damage that has already passed armour and invulnerability checks. Returns the damage dealt. */
export function damagePlayer(p: PlayerState, amount: number): number {
  if (!p.alive || amount <= 0) return 0;
  const before = p.hp;
  p.hp = Math.max(0, p.hp - amount);
  p.hurtT = 0;
  if (p.hp <= 0) p.alive = false;
  return before - p.hp;
}
