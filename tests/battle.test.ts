import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import { Battle, type StepInput } from '../src/sim/battle';
import { baseMods } from '../src/sim/mods';
import { PLAYER_TUNING } from '../src/sim/player';
import { generateLayout } from '../src/world/layout';
import type { Layout } from '../src/world/tiles';
import { T } from '../src/world/tiles';

const DT = 1 / 60;

function makeBattle(seed = 5, templateId = 'hall-of-hooks'): Battle {
  const layout: Layout = generateLayout(templateId, mulberry32(seed), { entrySide: 'W', exitCount: 2 });
  return new Battle({ layout, rng: mulberry32(seed + 99), mods: baseMods(), weapon: 'glaive' });
}

/** Input that faces a fixed forward vector and holds nothing unless told to. */
function idle(forward = { x: 1, z: 0 }, extra: Partial<StepInput> = {}): StepInput {
  return {
    move: { moveX: 0, moveY: 0, forward, right: { x: -forward.z, z: forward.x }, dodgePressed: false },
    fireJust: false,
    fireHeld: false,
    tearHeld: false,
    tearReleased: false,
    ...extra,
  };
}

/** Faces an enemy and, optionally, presses fire once. */
function faceAndFire(b: Battle, x: number, z: number, fire: boolean): StepInput {
  const dx = x - b.player.x;
  const dz = z - b.player.z;
  const d = Math.max(1e-6, Math.hypot(dx, dz));
  return idle({ x: dx / d, z: dz / d }, { fireJust: fire });
}

/** Input that faces an enemy, for aimed shots. */
function aimedAt(b: Battle, target: { x: number; z: number }, extra: Partial<StepInput>): StepInput {
  return faceAndFire(b, target.x, target.z, false) && { ...faceAndFire(b, target.x, target.z, false), ...extra };
}

function runSeconds(b: Battle, seconds: number, input: (step: number) => StepInput): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) b.step(DT, input(i));
}

/** Clears spawn-in time so enemies are active and can act immediately. */
function settle(b: Battle): void {
  runSeconds(b, 1, () => idle());
}

describe('pursuit and damage', () => {
  it('a husk closes distance, lunges, and damages an idle player', () => {
    const b = makeBattle();
    const husk = b.addEnemy('husk', b.player.x + 3, b.player.z);
    settle(b);
    const start = b.player.hp;
    runSeconds(b, 6, () => idle());
    expect(husk.alive).toBe(true);
    expect(b.player.hp).toBeLessThan(start);
    expect(b.damageTaken).toBeGreaterThan(0);
  });
});

describe('glaive', () => {
  it('kills a husk standing in front, drops shards, and counts the kill', () => {
    const b = makeBattle();
    const husk = b.addEnemy('husk', b.player.x + 1.5, b.player.z);
    settle(b);
    let fired = false;
    runSeconds(b, 4, () => {
      const input = faceAndFire(b, husk.x, husk.z, !fired);
      fired = true;
      return input;
    });
    // Keep swinging while the husk is alive; the combo window lets the next press land.
    for (let i = 0; i < 40 && husk.alive; i++) {
      runSeconds(b, 0.5, () => faceAndFire(b, husk.x, husk.z, true));
    }
    expect(husk.alive).toBe(false);
    expect(b.kills).toBe(1);
    expect(b.pickups.some((p) => p.kind === 'shard') || b.shards > 0).toBe(true);
  });
});

describe('dodge invulnerability', () => {
  it('blocks damage during the i-frame window', () => {
    const b = makeBattle();
    const husk = b.addEnemy('husk', b.player.x + 0.9, b.player.z);
    settle(b);
    // Dodge forward in the first frame so the window covers the lunge.
    const hpBefore = b.player.hp;
    runSeconds(b, PLAYER_TUNING.dodge.iframeStart, () => idle({ x: 1, z: 0 }, { move: { moveX: 0, moveY: 1, forward: { x: 1, z: 0 }, right: { x: 0, z: -1 }, dodgePressed: true } }));
    expect(b.player.dodging).toBe(true);
    const during = b.player.hp;
    runSeconds(b, PLAYER_TUNING.dodge.iframeEnd - PLAYER_TUNING.dodge.iframeStart, () => idle({ x: 1, z: 0 }));
    expect(b.player.hp).toBe(during);
    expect(husk.alive).toBe(true);
    expect(hpBefore).toBeGreaterThanOrEqual(b.player.hp);
  });
});

describe('tear', () => {
  it('a full charge strips an armour layer, and the second hit exposes the core', () => {
    const b = makeBattle(11);
    const bulwark = b.addEnemy('bulwark', b.player.x + 2, b.player.z);
    settle(b);
    expect(bulwark.armor).toBe(2);
    // Charge the tear for a full second, then release it along the view.
    runSeconds(b, 1.0, () => idle({ x: 1, z: 0 }, { tearHeld: true }));
    runSeconds(b, DT * 2, () => idle({ x: 1, z: 0 }, { tearReleased: true }));
    expect(bulwark.armor).toBe(1);
    expect(bulwark.coreExposed).toBe(false);
  });

  it('exposes the core once the last layer is gone', () => {
    const b = makeBattle(11);
    const bulwark = b.addEnemy('bulwark', b.player.x + 2, b.player.z);
    settle(b);
    for (let shot = 0; shot < 2; shot++) {
      // Wait out the tear cooldown between releases, aiming at the bulwark as a player would.
      runSeconds(b, 2.3, () => idle());
      runSeconds(b, 1.0, () => aimedAt(b, bulwark, { tearHeld: true }));
      runSeconds(b, DT * 2, () => aimedAt(b, bulwark, { tearReleased: true }));
    }
    expect(bulwark.armor).toBe(0);
    expect(bulwark.coreExposed).toBe(true);
  });
});

describe('room completion', () => {
  it('unlocks the doors when the room is clear and reports the exit taken', () => {
    const b = makeBattle(21);
    expect(b.grid.tileWalkable(...doorTile(b.layout, 'exit', 0))).toBe(false);
    b.queueWave([]);
    runSeconds(b, 0.2, () => idle());
    expect(b.cleared).toBe(true);
    expect(b.grid.tileWalkable(...doorTile(b.layout, 'exit', 0))).toBe(true);
    // Walk the player onto the exit tile.
    const [tx, ty] = doorTile(b.layout, 'exit', 0);
    b.player.x = tx + 0.5;
    b.player.z = ty + 0.5;
    const events = [];
    b.step(DT, idle());
    events.push(...b.drain());
    expect(events.some((e) => e.type === 'doorEntered' && e.exitIndex === 0)).toBe(true);
    expect(b.exited).toBe(true);
    expect(b.layout.tiles[ty * b.layout.w + tx]).toBe(T.DOOR);
  });
});

function doorTile(layout: Layout, role: 'entry' | 'exit', exitIndex: number): [number, number] {
  const d = layout.doors.find((dd) => dd.role === role && dd.exitIndex === exitIndex) ?? layout.doors.find((dd) => dd.role === role);
  if (!d) throw new Error('no such door');
  return [d.x, d.y];
}
