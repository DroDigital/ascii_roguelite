import * as THREE from 'three';
import type { AsciiRenderer, DistortionSpec } from '../render/asciiRenderer';
import { PAL } from '../render/palette';
import type { BattleEvent } from '../sim/battle';
import type { Enemy } from '../sim/enemies';
import type { Projectile } from '../sim/projectiles';
import type { Fragment } from '../sim/tear';
import type { Rng } from '../core/rng';
import { FirstPersonView } from '../sim/fpView';
import { type PlayerState, PLAYER_TUNING } from '../sim/player';
import { type Layout, T } from '../world/tiles';
import { hash2 } from '../core/rng';

/** Smooth 2D value noise on the lattice, in [0, 1]. Used for fog drift. */
function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export interface EffectsSettings {
  /** 0 to 1. Scales particle counts, distortions and flashes. */
  intensity: number;
  /** 0 to 1. Scales shake and hit-stop. Zero under reduced motion. */
  motion: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  glyph: string;
  pal: number;
  /** Streams keep a short tail of glyphs above the head. */
  tail: boolean;
  gravity: number;
}

interface ArcFx {
  x: number;
  z: number;
  yaw: number;
  arc: number;
  range: number;
  t: number;
  life: number;
  pal: number;
  heavy: boolean;
}

interface TelegraphFx {
  enemy: Enemy;
  attack: string;
  t: number;
  duration: number;
}

interface RuneFx {
  x: number;
  z: number;
  t: number;
  life: number;
}

interface DistortFx {
  x: number;
  y: number;
  z: number;
  t: number;
  life: number;
  amount: number;
  radius: number;
}

const DEBRIS = ['*', '+', '.', "'", 'x', ':', '%'];
const STREAM = ['|', '!', ':', '.', ',', ';', "'", ']', '1'];

/** The glyph that traces a curve whose tangent is `angle`, folded to four directions. */
function glyphFor(angle: number): string {
  const a = ((angle % Math.PI) + Math.PI) % Math.PI;
  if (a < Math.PI / 8 || a >= (7 * Math.PI) / 8) return '-';
  if (a < (3 * Math.PI) / 8) return '\\';
  if (a < (5 * Math.PI) / 8) return '|';
  return '/';
}

/**
 * Glyph effects drawn into the overlay: luminous slash arcs, debris from struck
 * surfaces, telegraph patterns, collapse streams, spawn runes, the aim reticle,
 * fragments, projectiles and screen distortions. Events drive them; the battle is
 * never changed from here.
 */
export class Effects {
  private readonly particles: Particle[] = [];
  private readonly arcs: ArcFx[] = [];
  private readonly runes: RuneFx[] = [];
  private readonly distortions: DistortFx[] = [];
  private readonly telegraphs: TelegraphFx[] = [];
  private readonly trails = new Map<number, Array<{ x: number; y: number; z: number }>>();
  private edgeFlash = 0;
  private chargeFlash = 0;
  private readonly scratch = new THREE.Vector3();
  private readonly lookScratch = new THREE.Vector3();
  /** Requests picked up by the app each frame. */
  hitStopRequest = 0;
  shakeRequest = 0;
  kickRequest: { pitch: number; yaw: number; roll: number } | null = null;

  constructor(
    private readonly ascii: AsciiRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly rng: Rng,
    private settings: EffectsSettings,
  ) {}

  setSettings(s: EffectsSettings): void {
    this.settings = s;
  }

  get overlay() {
    return this.ascii.overlay;
  }

  /** Clears all effects, for example when the room changes. */
  reset(): void {
    this.particles.length = 0;
    this.arcs.length = 0;
    this.runes.length = 0;
    this.distortions.length = 0;
    this.telegraphs.length = 0;
    this.trails.clear();
    this.edgeFlash = 0;
  }

  private rand(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rng();
  }

  private spark(x: number, y: number, z: number, count: number, pal: number, speed: number): void {
    const n = Math.max(1, Math.round(count * this.settings.intensity));
    for (let i = 0; i < n; i++) {
      const a = this.rand(0, Math.PI * 2);
      const s = this.rand(speed * 0.4, speed);
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: this.rand(0.5, 2.5) * speed * 0.5,
        vz: Math.sin(a) * s,
        life: this.rand(0.25, 0.5),
        max: 0.5,
        glyph: DEBRIS[Math.floor(this.rng() * DEBRIS.length)],
        pal,
        tail: false,
        gravity: 4,
      });
    }
  }

  private distort(x: number, y: number, z: number, amount: number, radius: number, life: number): void {
    if (this.settings.intensity <= 0 || this.settings.motion <= 0) return;
    this.distortions.push({ x, y, z, t: 0, life, amount: amount * this.settings.intensity * this.settings.motion, radius });
  }

  /** Handles one battle event. Call for every event the battle drains. */
  onEvent(ev: BattleEvent): void {
    switch (ev.type) {
      case 'swing':
        this.arcs.push({
          x: ev.x,
          z: ev.z,
          yaw: ev.yaw,
          arc: ev.arc,
          range: ev.range,
          t: 0,
          life: ev.heavy ? 0.36 : 0.22,
          pal: ev.riposte ? PAL.cyan : ev.heavy ? PAL.white : PAL.ivory,
          heavy: ev.heavy,
        });
        if (ev.heavy) {
          this.hitStopRequest = Math.max(this.hitStopRequest, 0.05);
          this.shakeRequest = Math.max(this.shakeRequest, 0.35);
          const cx = ev.x - Math.sin(ev.yaw) * 1.6;
          const cz = ev.z - Math.cos(ev.yaw) * 1.6;
          this.distort(cx, 1, cz, 0.9, 1.6, 0.35);
        }
        break;
      case 'enemyHurt': {
        const pal = ev.core ? PAL.cyan : ev.heavy ? PAL.white : PAL.ivory;
        this.spark(ev.x, 1.1, ev.z, ev.heavy ? 12 : 6, pal, ev.heavy ? 3.2 : 2.2);
        this.hitStopRequest = Math.max(this.hitStopRequest, ev.heavy ? 0.04 : 0.012);
        break;
      }
      case 'armourBroken':
        this.spark(ev.x, 1.1, ev.z, 14, PAL.cyan, 3.6);
        this.hitStopRequest = Math.max(this.hitStopRequest, 0.05);
        this.shakeRequest = Math.max(this.shakeRequest, 0.2);
        break;
      case 'ignited':
        this.spark(ev.enemy.x, 0.6, ev.enemy.z, 8, PAL.ember, 1.2);
        break;
      case 'enemyDied':
        this.collapse(ev.enemy);
        this.hitStopRequest = Math.max(this.hitStopRequest, 0.03);
        this.shakeRequest = Math.max(this.shakeRequest, 0.12);
        break;
      case 'kindlingBlast':
        this.spark(ev.x, 0.8, ev.z, 26, PAL.ember, 4.5);
        this.distort(ev.x, 0.8, ev.z, 0.6, ev.radius, 0.3);
        this.shakeRequest = Math.max(this.shakeRequest, 0.25);
        break;
      case 'ring':
        this.distort(ev.x, 0.2, ev.z, 1.1, ev.radius * 0.9, 0.45);
        this.spark(ev.x, 0.2, ev.z, 18, PAL.ember, 4.4);
        this.shakeRequest = Math.max(this.shakeRequest, 0.6);
        this.hitStopRequest = Math.max(this.hitStopRequest, 0.07);
        break;
      case 'stagger':
        this.spark(ev.enemy.x, 1.2, ev.enemy.z, 6, PAL.white, 2.2);
        break;
      case 'wallStun':
        this.spark(ev.enemy.x, 1, ev.enemy.z, 14, PAL.ash, 3);
        this.shakeRequest = Math.max(this.shakeRequest, 0.3);
        break;
      case 'spawnRune':
        this.runes.push({ x: ev.x, z: ev.z, t: 0, life: 0.8 });
        break;
      case 'bossPhase':
        this.distort(ev.enemy.x, 1.2, ev.enemy.z, 1.4, 4, 0.9);
        this.shakeRequest = Math.max(this.shakeRequest, 0.8);
        this.hitStopRequest = Math.max(this.hitStopRequest, 0.1);
        this.spark(ev.enemy.x, 1.2, ev.enemy.z, 30, PAL.ember, 5);
        break;
      case 'hazardBurst':
        this.distort(ev.x, 0.1, ev.z, ev.hit ? 0.8 : 0.3, ev.radius * 1.4, 0.3);
        this.spark(ev.x, 0.2, ev.z, ev.hit ? 16 : 6, PAL.ember, 3.2);
        break;
      case 'playerHurt':
        this.edgeFlash = 0.45;
        this.shakeRequest = Math.max(this.shakeRequest, 0.45);
        this.hitStopRequest = Math.max(this.hitStopRequest, 0.045);
        this.kickRequest = { pitch: 0.06, yaw: 0, roll: (ev.fromX > 0 ? 1 : -1) * 0.05 };
        break;
      case 'tear':
        this.shakeRequest = Math.max(this.shakeRequest, 0.22);
        this.hitStopRequest = Math.max(this.hitStopRequest, 0.05);
        this.chargeFlash = 0.35;
        this.drawTearLine(ev.shot);
        break;
      case 'pickup':
        this.spark(ev.x, 0.6, ev.z, 4, ev.kind === 'shard' ? PAL.amber : PAL.ivory, 1.4);
        break;
      case 'impact':
        this.spark(ev.x, ev.y, ev.z, ev.owner === 'player' ? 4 : 6, ev.owner === 'player' ? PAL.cyan : PAL.ember, 2.4);
        break;
      default:
        break;
    }
  }

  private collapse(e: Enemy): void {
    const count = Math.round(44 * this.settings.intensity);
    for (let i = 0; i < count; i++) {
      const a = this.rand(0, Math.PI * 2);
      this.particles.push({
        x: e.x + Math.cos(a) * this.rand(0, 0.4),
        y: this.rand(0.2, e.def.kind === 'bulwark' || e.def.kind === 'elite' ? 2.2 : 1.8),
        z: e.z + Math.sin(a) * this.rand(0, 0.4),
        vx: Math.cos(a) * this.rand(0.2, 0.9),
        vy: this.rand(0, 1.2),
        vz: Math.sin(a) * this.rand(0.2, 0.9),
        life: this.rand(1.2, 2.2),
        max: 2.2,
        glyph: STREAM[Math.floor(this.rng() * STREAM.length)],
        pal: e.def.kind === 'elite' ? PAL.amber : e.def.kind === 'acolyte' ? PAL.cyan : PAL.ivory,
        tail: true,
        gravity: 2.5,
      });
    }
  }

  /** The Tear line lingers as a short bright strip of glyphs along the shot. */
  private drawTearLine(shot: { x: number; z: number; dirX: number; dirZ: number; length: number }): void {
    this.arcs.push({
      x: shot.x,
      z: shot.z,
      yaw: Math.atan2(-shot.dirX, -shot.dirZ),
      arc: 0,
      range: shot.length,
      t: 0,
      life: 0.3,
      pal: PAL.cyan,
      heavy: false,
    });
  }

  /** Advances all effects by one display frame. */
  update(dt: number, battle: { enemies: Enemy[]; player: PlayerState; projectiles: Projectile[]; fragments: Fragment[] }): void {
    this.edgeFlash = Math.max(0, this.edgeFlash - dt);
    this.chargeFlash = Math.max(0, this.chargeFlash - dt);
    for (const p of this.particles) {
      p.life -= dt;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0, p.y + p.vy * dt);
      p.z += p.vz * dt;
      if (p.y <= 0) {
        p.vx *= 0.6;
        p.vz *= 0.6;
        p.vy = 0;
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) if (this.particles[i].life <= 0) this.particles.splice(i, 1);
    for (const a of this.arcs) a.t += dt;
    for (let i = this.arcs.length - 1; i >= 0; i--) if (this.arcs[i].t > this.arcs[i].life) this.arcs.splice(i, 1);
    for (const r of this.runes) r.t += dt;
    for (let i = this.runes.length - 1; i >= 0; i--) if (this.runes[i].t > this.runes[i].life) this.runes.splice(i, 1);
    for (const d of this.distortions) d.t += dt;
    for (let i = this.distortions.length - 1; i >= 0; i--) if (this.distortions[i].t > this.distortions[i].life) this.distortions.splice(i, 1);
    this.telegraphs.length = 0;
    for (const e of battle.enemies) {
      if (e.stage === 'windup' && e.attack) {
        this.telegraphs.push({ enemy: e, attack: e.attack.id, t: e.t, duration: e.attack.windup });
      }
      if (e.stage === 'dead') continue;
    }
    // Record short trails for projectiles so bolts read as streaks.
    const live = new Set<number>();
    for (const p of battle.projectiles) {
      live.add(p.id);
      const trail = this.trails.get(p.id) ?? [];
      trail.push({ x: p.x, y: p.y, z: p.z });
      if (trail.length > 4) trail.shift();
      this.trails.set(p.id, trail);
    }
    for (const id of [...this.trails.keys()]) if (!live.has(id)) this.trails.delete(id);
  }

  /**
   * Layered fog fields. Two heights of drifting glyphs are sampled on the room's
   * floor tiles and anchored to the world, so they move past the camera rather
   * than sliding with the screen.
   */
  private drawFog(now: number, layout: Layout | null): void {
    if (!layout || this.settings.intensity <= 0) return;
    const ov = this.ascii.overlay;
    const cam = this.camera;
    const strength = 0.5 * this.settings.intensity;
    const layers = [
      { h: 0.12, scale: 0.42, speed: 0.05, seed: 11, glyph: '.' },
      { h: 1.3, scale: 0.3, speed: 0.035, seed: 29, glyph: ':' },
    ];
    for (let y = 1; y < layout.h - 1; y++) {
      for (let x = 1; x < layout.w - 1; x++) {
        const code = layout.tiles[y * layout.w + x];
        if (code === T.WALL || code === T.PILLAR || code === T.BOOK || code === T.VOID) continue;
        for (const layer of layers) {
          const n = noise2(x * layer.scale + now * layer.speed, y * layer.scale - now * layer.speed * 0.6, layer.seed);
          if (n < 0.56) continue;
          const alpha = (n - 0.56) * 2.4 * strength;
          ov.putWorld(cam, this.scratch.set(x + 0.5, layer.h, y + 0.5), layer.glyph, PAL.ash, alpha, this.scratch);
        }
      }
    }
  }

  /** Writes all effect glyphs into the overlay for this frame. */
  draw(
    now: number,
    battle: {
      enemies: Enemy[];
      player: PlayerState;
      projectiles: Projectile[];
      fragments: Fragment[];
      tearCharge: number;
      charging: boolean;
      pickups: Array<{ kind: 'shard' | 'mote'; x: number; z: number }>;
      hazards: Array<{ x: number; z: number; timer: number }>;
      layout: Layout | null;
    },
  ): void {
    const ov = this.ascii.overlay;
    const cam = this.camera;
    ov.clear();
    this.drawFog(now, battle.layout);

    // Crosshair and tear charge ring around it.
    const cx = Math.floor(ov.cols / 2);
    const cy = Math.floor(ov.rows / 2);
    ov.put(cx, cy, '+', PAL.white, 0.95);
    if (battle.charging) {
      const r = 3 + Math.round(battle.tearCharge * 3);
      const ringAlpha = 0.25 + 0.6 * battle.tearCharge;
      const pal = battle.tearCharge >= 1 ? PAL.white : PAL.cyan;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const gx = cx + Math.round(Math.cos(a) * r * 2);
        const gy = cy + Math.round(Math.sin(a) * r);
        if (i / 24 < battle.tearCharge) ov.put(gx, gy, i % 2 ? '*' : '+', pal, ringAlpha);
        else ov.put(gx, gy, '.', PAL.cyan, 0.25);
      }
    }

    // Dodge invulnerability: a cyan ghost frame around the view while the window is open.
    const p = battle.player;
    const iframes = p.dodging && p.dodgeT >= PLAYER_TUNING.dodge.iframeStart && p.dodgeT <= PLAYER_TUNING.dodge.iframeEnd;
    if (iframes) {
      const a = 0.22 * this.settings.intensity + 0.1 * Math.sin(now * 30);
      for (let x = 0; x < ov.cols; x++) {
        ov.put(x, 1, '.', PAL.cyan, a);
        ov.put(x, ov.rows - 2, '.', PAL.cyan, a);
      }
      for (let y = 0; y < ov.rows; y++) {
        ov.put(1, y, '.', PAL.cyan, a);
        ov.put(ov.cols - 2, y, '.', PAL.cyan, a);
      }
    }

    // Edge flash on damage: a frame of ember glyphs.
    if (this.edgeFlash > 0) {
      const a = this.edgeFlash * 2 * (this.settings.intensity);
      for (let x = 0; x < ov.cols; x++) {
        ov.put(x, 0, '%', PAL.ember, a);
        ov.put(x, ov.rows - 1, '%', PAL.ember, a);
      }
      for (let y = 0; y < ov.rows; y++) {
        ov.put(0, y, '%', PAL.ember, a);
        ov.put(ov.cols - 1, y, '%', PAL.ember, a);
      }
    }

    // Glaive arcs: luminous glyphs that sweep across the swing, fading behind.
    for (const a of this.arcs) {
      if (a.arc <= 0) {
        // Tear line: a straight row of glyphs.
        const dx = -Math.sin(a.yaw);
        const dz = -Math.cos(a.yaw);
        const steps = 14;
        for (let i = 0; i <= steps; i++) {
          const s = (i / steps) * a.range * Math.min(1, a.t / 0.08);
          const fade = 1 - a.t / a.life;
          const x = a.x + dx * s;
          const z = a.z + dz * s;
          ov.putWorld(cam, new THREE.Vector3(x, 1.1, z), i % 2 ? '=' : '-', a.pal, 0.9 * fade);
        }
        continue;
      }
      const progress = Math.min(1, a.t / (a.life * 0.6));
      const fade = Math.max(0, 1 - a.t / a.life);
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const frac = i / n;
        if (frac > progress) break;
        const ang = a.yaw - a.arc / 2 + frac * a.arc;
        const r = a.range * (0.55 + 0.45 * frac);
        const px = a.x - Math.sin(ang) * r;
        const pz = a.z - Math.cos(ang) * r;
        const tangent = ang + Math.PI / 2;
        const g = glyphFor(tangent);
        ov.putWorld(cam, new THREE.Vector3(px, 1.15, pz), g, a.pal, 0.95 * fade);
      }
    }

    // Telegraphs: shapes that grow through the windup.
    for (const t of this.telegraphs) {
      const e = t.enemy;
      const frac = Math.min(1, t.t / Math.max(0.01, t.duration));
      const pulse = 0.55 + 0.35 * Math.sin(now * 14);
      const alpha = (0.35 + 0.6 * frac) * pulse;
      if (t.attack === 'lunge' || t.attack === 'charge') {
        const dx = -Math.sin(e.yaw);
        const dz = -Math.cos(e.yaw);
        const len = t.attack === 'lunge' ? 2.6 : 7;
        const steps = Math.round(len / 0.32);
        for (let i = 1; i <= steps; i++) {
          if (i / steps > frac) break;
          const s = (i / steps) * len;
          ov.putWorld(cam, new THREE.Vector3(e.x + dx * s, 0.05, e.z + dz * s), '=', PAL.ember, alpha);
        }
      } else if (t.attack === 'slam' || t.attack === 'double-slam') {
        const r = 3.2 * frac;
        for (let i = 0; i < 40; i++) {
          const a = (i / 40) * Math.PI * 2;
          ov.putWorld(cam, new THREE.Vector3(e.x + Math.cos(a) * r, 0.05, e.z + Math.sin(a) * r), '%', PAL.ember, alpha);
        }
      } else if (t.attack === 'seal-fan' || t.attack === 'bolt') {
        const dirs = t.attack === 'seal-fan' ? 5 : 1;
        const base = Math.atan2(-Math.cos(e.yaw), -Math.sin(e.yaw));
        for (let d = 0; d < dirs; d++) {
          const a = base + (d - (dirs - 1) / 2) * 0.38;
          for (let i = 1; i <= 8; i++) {
            if (i / 8 > frac) break;
            const s = i * 0.5;
            ov.putWorld(cam, new THREE.Vector3(e.x + Math.cos(a) * s, 1.4, e.z + Math.sin(a) * s), '.', PAL.ember, alpha);
          }
        }
      }
    }

    // Spawn runes: a ring that closes onto the spot where an enemy will rise.
    for (const r of this.runes) {
      const frac = r.t / r.life;
      const radius = 1.1 * (1 - frac * 0.5);
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        ov.putWorld(cam, new THREE.Vector3(r.x + Math.cos(a) * radius, 0.04, r.z + Math.sin(a) * radius), i % 2 ? '+' : '.', PAL.ember, 0.8 * (1 - frac));
      }
    }

    // Collapse streams and debris.
    for (const p of this.particles) {
      const fade = Math.max(0, p.life / p.max);
      ov.putWorld(cam, new THREE.Vector3(p.x, p.y, p.z), p.glyph, p.pal, Math.min(1, fade * 1.2));
      if (p.tail) {
        ov.putWorld(cam, new THREE.Vector3(p.x, p.y + 0.22, p.z), '|', p.pal, fade * 0.45);
      }
    }

    // Pickups bob in place: shards are amber, health motes ivory.
    for (const p of battle.pickups) {
      const bob = Math.sin(now * 4 + p.x) * 0.06;
      if (p.kind === 'shard') {
        ov.putWorld(cam, this.scratch.set(p.x, 0.45 + bob, p.z), '*', PAL.amber, 0.95, this.scratch);
        ov.putWorld(cam, this.scratch.set(p.x, 0.25, p.z), '.', PAL.amber, 0.5, this.scratch);
      } else {
        ov.putWorld(cam, this.scratch.set(p.x, 0.45 + bob, p.z), '+', PAL.ivory, 0.95, this.scratch);
      }
    }

    // Ink hazards: a ring that fills as it arms, then bursts.
    for (const h of battle.hazards) {
      const armed = 1 - Math.max(0, Math.min(1, h.timer / 1.2));
      const pulse = 0.6 + 0.4 * Math.sin(now * 16);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const r = 1.1 * (0.4 + 0.6 * armed);
        if (i / 18 > armed + 0.2) continue;
        ov.putWorld(cam, this.scratch.set(h.x + Math.cos(a) * r, 0.05, h.z + Math.sin(a) * r), i % 3 ? '%' : '#', PAL.ember, 0.4 + 0.5 * armed * pulse, this.scratch);
      }
    }

    // Off-screen attackers: an ember marker on the screen edge, pointing toward each enemy
    // that is hunting the player from outside the view.
    const halfW = ov.cols / 2;
    const halfH = ov.rows / 2;
    const look = cam.getWorldDirection(this.lookScratch);
    for (const e of battle.enemies) {
      if (e.stage === 'dead' || e.stage === 'spawn') continue;
      const v = this.scratch.set(e.x, 1.1, e.z).project(cam);
      // Behind the camera, projection flips both axes and nothing there is on screen.
      const behind = (e.x - cam.position.x) * look.x + (1.1 - cam.position.y) * look.y + (e.z - cam.position.z) * look.z < 0;
      const onScreen = !behind && v.z <= 1 && Math.abs(v.x) <= 0.97 && Math.abs(v.y) <= 0.97;
      if (onScreen) continue;
      const flip = behind ? -1 : 1;
      const ang = Math.atan2(flip * v.y, flip * v.x);
      const ex = Math.round(halfW + Math.cos(ang) * (halfW - 2));
      const ey = Math.round(halfH + Math.sin(ang) * (halfH - 2));
      const glyph = Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang)) ? (Math.cos(ang) > 0 ? '>' : '<') : Math.sin(ang) > 0 ? '^' : 'v';
      ov.put(Math.max(1, Math.min(ov.cols - 2, ex)), Math.max(1, Math.min(ov.rows - 2, ey)), glyph, PAL.ember, 0.55 + 0.35 * Math.sin(now * 10));
    }

    // Fragments orbiting the player.
    for (const f of battle.fragments) {
      const pulse = 0.7 + 0.3 * Math.sin(now * 9 + f.id);
      ov.putWorld(cam, new THREE.Vector3(f.x, f.y, f.z), f.fired ? '*' : 'o', PAL.cyan, pulse);
    }

    // Projectiles and their trails.
    for (const p of battle.projectiles) {
      const trail = this.trails.get(p.id) ?? [];
      const isEnemy = p.owner === 'enemy';
      const pal = isEnemy ? PAL.ember : p.kind === 'fragment' ? PAL.cyan : PAL.cyan;
      const glyph = isEnemy ? '@' : p.kind === 'fragment' ? '*' : '-';
      trail.forEach((pt, i) => {
        ov.putWorld(cam, new THREE.Vector3(pt.x, pt.y, pt.z), glyph === '-' ? '-' : '.', pal, 0.15 + 0.12 * i);
      });
      ov.putWorld(cam, new THREE.Vector3(p.x, p.y, p.z), glyph, pal, 0.95);
    }

    ov.upload();
    this.pushDistortions(cam);
  }

  private pushDistortions(cam: THREE.PerspectiveCamera): void {
    const specs: DistortionSpec[] = [];
    const ov = this.ascii.overlay;
    const scratch = new THREE.Vector3();
    for (const d of this.distortions.slice(0, 3)) {
      scratch.set(d.x, d.y, d.z).project(cam);
      if (scratch.z > 1) continue;
      const cxCell = (scratch.x * 0.5 + 0.5) * ov.cols;
      const cyCell = (scratch.y * 0.5 + 0.5) * ov.rows;
      const k = 1 - d.t / d.life;
      specs.push({
        x: cxCell,
        y: cyCell,
        radius: 1 + (d.radius * 2 * d.t) / d.life,
        amount: d.amount * k,
      });
    }
    this.lastDistortions = specs;
  }

  private lastDistortions: DistortionSpec[] = [];

  /** Distortions for the renderer this frame. Empty when motion or intensity is off. */
  get distortionsNow(): DistortionSpec[] {
    return this.lastDistortions;
  }

  /** Applies queued camera requests to the first-person view, then clears them. */
  applyTo(view: FirstPersonView): void {
    if (this.kickRequest) {
      const k = this.settings.motion * this.settings.intensity;
      view.kick(this.kickRequest.pitch * k, this.kickRequest.yaw * k, this.kickRequest.roll * k);
      this.kickRequest = null;
    }
    // The view scales shake by the screen-shake setting, and to zero under reduced motion.
    if (this.shakeRequest > 0) {
      view.shake(this.shakeRequest);
      this.shakeRequest = 0;
    }
  }
}

