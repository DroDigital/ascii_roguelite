import type { Mods } from './mods';

/** Tuning for the signature mechanic. Values come from the design spec. */
export const TEAR = {
  chargeTime: 0.9,
  /** Releasing before this charge cancels the tear without a cooldown. */
  minRelease: 0.45,
  length: 6.5,
  halfWidth: 0.7,
  damage: 10,
  cooldown: 2.2,
  orbitRadius: 1.3,
  orbitHeight: 1.05,
  orbitSpeed: 2.2,
  fragmentLife: 2.8,
  fragmentInterval: 0.5,
  fragmentDamage: 7,
  fragmentSpeed: 14,
  fragmentFlyLife: 1.6,
} as const;

/** An orbiting fragment. Once it fires, the battle turns it into a homing projectile. */
export interface Fragment {
  id: number;
  angle: number;
  /** Seconds left before the fragment dissolves. */
  life: number;
  /** Seconds until this fragment fires at the nearest enemy. */
  fireCooldown: number;
  x: number;
  y: number;
  z: number;
  /** Set by the battle when the fragment has been launched. */
  fired: boolean;
}

export interface TearState {
  charging: boolean;
  /** Seconds of charge accumulated. */
  charge: number;
  cooldown: number;
  fragments: Fragment[];
  nextId: number;
}

export function createTear(): TearState {
  return { charging: false, charge: 0, cooldown: 0, fragments: [], nextId: 1 };
}

/** The line a tear fires along. The battle tests enemies against this segment. */
export interface TearShot {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  length: number;
  halfWidth: number;
  power: number;
}

/** Charge needed for a full tear, with upgrades applied. */
export function chargeNeeded(mods: Mods): number {
  return TEAR.chargeTime * mods.tear.chargeMul;
}

/** Charge progress from 0 to 1, for the HUD ring and the gathering glyphs. */
export function chargeFraction(t: TearState, mods: Mods): number {
  return Math.min(1, t.charge / chargeNeeded(mods));
}

/**
 * Advances charge and cooldown for one fixed step. A release at or above the
 * minimum charge returns the shot line and spawns the orbiting fragments. The
 * battle resolves the hits.
 */
export function updateTear(
  t: TearState,
  dt: number,
  held: boolean,
  released: boolean,
  mods: Mods,
  px: number,
  pz: number,
  forward: { x: number; z: number },
): TearShot | null {
  t.cooldown = Math.max(0, t.cooldown - dt);
  let shot: TearShot | null = null;

  if (held && t.cooldown <= 0) {
    t.charging = true;
    t.charge = Math.min(chargeNeeded(mods), t.charge + dt);
  } else if (!held) {
    if (released && t.charging && t.charge >= TEAR.minRelease * mods.tear.chargeMul) {
      const power = Math.min(1, t.charge / chargeNeeded(mods));
      shot = {
        x: px,
        z: pz,
        dirX: forward.x,
        dirZ: forward.z,
        length: TEAR.length * (0.55 + 0.45 * power),
        halfWidth: TEAR.halfWidth * (0.8 + 0.2 * power),
        power,
      };
      t.cooldown = TEAR.cooldown * mods.tear.cooldownMul;
      spawnFragments(t, mods);
    }
    t.charging = false;
    t.charge = 0;
  }
  updateOrbit(t, dt, px, pz);
  return shot;
}

function spawnFragments(t: TearState, mods: Mods): void {
  const count = mods.tear.fragments;
  for (let i = 0; i < count; i++) {
    t.fragments.push({
      id: t.nextId++,
      angle: (i / count) * Math.PI * 2,
      life: TEAR.fragmentLife + mods.tear.fragmentLifeAdd,
      fireCooldown: TEAR.fragmentInterval * mods.tear.fragmentIntervalMul * (1 + i / count),
      x: 0,
      y: TEAR.orbitHeight,
      z: 0,
      fired: false,
    });
  }
}

/** Keeps orbiting fragments on their ring around the player, and drops expired ones. */
function updateOrbit(t: TearState, dt: number, px: number, pz: number): void {
  const remaining: Fragment[] = [];
  for (const f of t.fragments) {
    if (f.fired) continue;
    f.life -= dt;
    if (f.life <= 0) continue;
    f.angle += TEAR.orbitSpeed * dt;
    f.x = px + Math.cos(f.angle) * TEAR.orbitRadius;
    f.z = pz + Math.sin(f.angle) * TEAR.orbitRadius;
    f.y = TEAR.orbitHeight + Math.sin(f.angle * 2) * 0.08;
    f.fireCooldown -= dt;
    remaining.push(f);
  }
  t.fragments = remaining;
}
