import type { WorldGrid } from './grid';

export type ProjectileKind = 'bolt' | 'seal' | 'fragment' | 'page';

export interface Projectile {
  id: number;
  owner: 'player' | 'enemy';
  kind: ProjectileKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  radius: number;
  damage: number;
  /** Enemies this projectile can still pass through. Zero means it stops at the first hit. */
  pierce: number;
  hitIds: Set<number>;
  /** Turn rate for homing projectiles, in radians per second. Zero for straight shots. */
  homing: number;
  /** Enemy id a homing projectile is chasing, or -1. */
  targetId: number;
  /** Set on the frame the projectile is removed, so the battle can emit an impact. */
  done: boolean;
}

export interface ProjectileHits {
  /** Player hit by an enemy projectile. Return true if the hit landed. */
  player: (p: Projectile) => boolean;
  /** Enemy hit by a player projectile. Pierce decides whether the projectile carries on. */
  enemy: (p: Projectile, enemyId: number, x: number, z: number) => void;
  /** Enemy position lookup for homing. Returns null once the target is gone. */
  targetAt: (id: number) => { x: number; z: number } | null;
  /** Enemies to test against player bolts. */
  enemiesNear: (x: number, z: number, r: number) => Array<{ id: number; x: number; z: number; radius: number }>;
  playerAt: () => { x: number; z: number; radius: number };
  impact: (p: Projectile) => void;
}

let nextProjectileId = 1;

export function makeProjectile(
  partial: Pick<Projectile, 'owner' | 'kind' | 'x' | 'z' | 'vx' | 'vz' | 'life' | 'radius' | 'damage'> &
    Partial<Pick<Projectile, 'y' | 'pierce' | 'homing' | 'targetId'>>,
): Projectile {
  return {
    id: nextProjectileId++,
    y: 1.2,
    pierce: 0,
    homing: 0,
    targetId: -1,
    hitIds: new Set(),
    done: false,
    ...partial,
  };
}

/**
 * Moves every projectile, applies homing, and resolves wall, player and enemy
 * contacts. Returns the survivors. Dead projectiles report through `hits.impact`.
 */
export function updateProjectiles(list: Projectile[], dt: number, grid: WorldGrid, hits: ProjectileHits): Projectile[] {
  const alive: Projectile[] = [];
  for (const p of list) {
    if (p.done) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.done = true;
      hits.impact(p);
      continue;
    }
    if (p.homing > 0 && p.targetId >= 0) {
      const target = hits.targetAt(p.targetId);
      if (target) {
        const want = Math.atan2(target.z - p.z, target.x - p.x);
        const have = Math.atan2(p.vz, p.vx);
        let diff = want - have;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const turn = Math.max(-p.homing * dt, Math.min(p.homing * dt, diff));
        const speed = Math.hypot(p.vx, p.vz);
        const next = have + turn;
        p.vx = Math.cos(next) * speed;
        p.vz = Math.sin(next) * speed;
      }
    }
    const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vz) * dt) / 0.25));
    let stopped = false;
    for (let s = 0; s < steps && !stopped; s++) {
      p.x += (p.vx * dt) / steps;
      p.z += (p.vz * dt) / steps;
      if (grid.tileSolid(Math.floor(p.x), Math.floor(p.z))) {
        p.done = true;
        hits.impact(p);
        stopped = true;
        break;
      }
      if (p.owner === 'enemy') {
        const pl = hits.playerAt();
        if (Math.hypot(pl.x - p.x, pl.z - p.z) <= pl.radius + p.radius) {
          const landed = hits.player(p);
          p.done = true;
          if (landed) hits.impact(p);
          stopped = true;
          break;
        }
      } else {
        for (const e of hits.enemiesNear(p.x, p.z, p.radius + 0.6)) {
          if (p.hitIds.has(e.id)) continue;
          if (Math.hypot(e.x - p.x, e.z - p.z) > e.radius + p.radius) continue;
          p.hitIds.add(e.id);
          hits.enemy(p, e.id, p.x, p.z);
          if (p.pierce <= 0) {
            p.done = true;
            hits.impact(p);
            stopped = true;
            break;
          }
          p.pierce -= 1;
        }
      }
    }
    if (!p.done) alive.push(p);
  }
  return alive;
}

export function resetProjectileIds(): void {
  nextProjectileId = 1;
}
