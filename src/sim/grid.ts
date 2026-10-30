import { type Layout, T, isSolidTile, isWalkableTile } from '../world/tiles';

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Collision and navigation over a room's tiles. Tile (tx, ty) covers world
 * XZ [tx, tx+1) × [ty, ty+1). Locked doors are solid until the room is cleared.
 */
export class WorldGrid {
  readonly w: number;
  readonly h: number;
  private readonly base: Uint8Array;
  private readonly locked: Uint8Array;
  private readonly doorTiles: number[] = [];
  private field: Int32Array | null = null;
  private fieldTarget = -1;

  constructor(layout: Layout) {
    this.w = layout.w;
    this.h = layout.h;
    this.base = layout.tiles.slice();
    this.locked = new Uint8Array(layout.w * layout.h);
    layout.tiles.forEach((code, i) => {
      if (code === T.DOOR) this.doorTiles.push(i);
    });
  }

  /** Locks or unlocks every door tile in the room. */
  setDoorsLocked(on: boolean): void {
    for (const i of this.doorTiles) this.locked[i] = on ? 1 : 0;
    this.field = null;
  }

  private index(tx: number, ty: number): number {
    return ty * this.w + tx;
  }

  tileSolid(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return true;
    const i = this.index(tx, ty);
    if (this.locked[i]) return true;
    return isSolidTile(this.base[i]);
  }

  tileWalkable(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    const i = this.index(tx, ty);
    return !this.locked[i] && isWalkableTile(this.base[i]);
  }

  /** Ink pools slow movement. */
  inkAt(x: number, z: number): boolean {
    const tx = Math.floor(x);
    const ty = Math.floor(z);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.base[this.index(tx, ty)] === T.INK;
  }

  /** The door tile the point stands in, if any. */
  doorAt(x: number, z: number): number {
    const tx = Math.floor(x);
    const ty = Math.floor(z);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return -1;
    return this.base[this.index(tx, ty)] === T.DOOR ? this.index(tx, ty) : -1;
  }

  /**
   * Pushes a circle of radius r out of solid tiles. Two passes are enough for
   * corners. Mutates `p`.
   */
  resolveCircle(p: Vec2, r: number): void {
    for (let pass = 0; pass < 2; pass++) {
      const x0 = Math.floor(p.x - r - 1);
      const x1 = Math.floor(p.x + r + 1);
      const z0 = Math.floor(p.z - r - 1);
      const z1 = Math.floor(p.z + r + 1);
      for (let ty = z0; ty <= z1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (!this.tileSolid(tx, ty)) continue;
          const cx = Math.min(Math.max(p.x, tx), tx + 1);
          const cz = Math.min(Math.max(p.z, ty), ty + 1);
          const dx = p.x - cx;
          const dz = p.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            const push = (r - d) / d;
            p.x += dx * push;
            p.z += dz * push;
          } else {
            // Centre is inside the tile: leave through the nearest face.
            const left = p.x - tx;
            const right = tx + 1 - p.x;
            const top = p.z - ty;
            const bottom = ty + 1 - p.z;
            const m = Math.min(left, right, top, bottom);
            if (m === left) p.x = tx - r;
            else if (m === right) p.x = tx + 1 + r;
            else if (m === top) p.z = ty - r;
            else p.z = ty + 1 + r;
          }
        }
      }
    }
  }

  /** True when the straight segment between two points crosses a solid tile. */
  segmentBlocked(ax: number, az: number, bx: number, bz: number): boolean {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (this.tileSolid(Math.floor(x), Math.floor(z))) return true;
    }
    return false;
  }

  /**
   * Walking distance in tiles from every walkable tile to `target`, computed
   * by breadth-first search. Enemies descend this field to reach the player
   * around pillars. The field is cached until the target tile or the doors change.
   */
  flowTo(tx: number, ty: number): Int32Array {
    const target = this.index(tx, ty);
    if (this.field && this.fieldTarget === target) return this.field;
    const dist = new Int32Array(this.w * this.h).fill(-1);
    const queue: number[] = [];
    if (this.tileWalkable(tx, ty)) {
      dist[target] = 0;
      queue.push(target);
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const x = i % this.w;
      const y = (i - x) / this.w;
      const next = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of next) {
        if (!this.tileWalkable(nx, ny)) continue;
        const n = this.index(nx, ny);
        if (dist[n] !== -1) continue;
        dist[n] = dist[i] + 1;
        queue.push(n);
      }
    }
    this.field = dist;
    this.fieldTarget = target;
    return dist;
  }

  /**
   * Chooses the next world point to walk toward from (x, z) on the way to the
   * target field. Returns the centre of the neighbouring tile with the smallest
   * distance, or null when no path exists.
   */
  nextStep(x: number, z: number, field: Int32Array): Vec2 | null {
    const tx = Math.floor(x);
    const ty = Math.floor(z);
    const here = this.tileWalkable(tx, ty) ? field[this.index(tx, ty)] : -1;
    if (here === -1) return null;
    let best: Vec2 | null = null;
    let bestD = here;
    for (const [nx, ny] of [
      [tx + 1, ty],
      [tx - 1, ty],
      [tx, ty + 1],
      [tx, ty - 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
      const d = field[this.index(nx, ny)];
      if (d !== -1 && d < bestD) {
        bestD = d;
        best = { x: nx + 0.5, z: ny + 0.5 };
      }
    }
    return best;
  }
}
