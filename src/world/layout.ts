import { type Rng, shuffled } from '../core/rng';
import { type RoomKind, type RoomTemplate, templateById } from './templates';
import { type DoorSpec, type Layout, type Side, T, type Vec2i, isWalkableTile, sideOf, tileAt } from './tiles';

/** Rotation (quarter turns clockwise) and optional mirror. Eight variants per template. */
export interface Transform {
  rot: 0 | 1 | 2 | 3;
  mirror: boolean;
}

export const TRANSFORMS: readonly Transform[] = ([0, 1, 2, 3] as const).flatMap((rot) =>
  [false, true].map((mirror) => ({ rot, mirror })),
);

export interface LayoutOptions {
  /** Side of the entry door, or null for the start room. */
  entrySide: Side | null;
  /** Number of exit doors to open. The rest become walls. */
  exitCount: number;
}

/** Fairness rules. Spawns must be far enough from the player's arrival and from every door. */
export const SPAWN_RULES = {
  fromStart: 6,
  fromDoor: 3.5,
  spacing: 2.5,
  /** The boss arena fights a single boss, placed by bossSpawn rather than the spawn list. */
  minSpawns: { nave: 0, combat: 3, cistern: 0, reliquary: 3, boss: 0 } satisfies Record<RoomKind, number>,
} as const;

interface Candidate {
  x: number;
  y: number;
}

/** A template after the wall border is added, before doors are assigned. */
interface RawGrid {
  w: number;
  h: number;
  tiles: Uint8Array;
  doors: Candidate[];
  spawns: Vec2i[];
  candles: Vec2i[];
  altars: Vec2i[];
  playerStart: Vec2i | null;
  bossSpawn: Vec2i | null;
}

const INTERIOR_SYMBOLS: Record<string, number> = {
  '.': T.FLOOR,
  s: T.FLOOR,
  c: T.FLOOR,
  p: T.FLOOR,
  B: T.FLOOR,
  a: T.ALTAR,
  o: T.PILLAR,
  b: T.BOOK,
  '#': T.WALL,
  ',': T.INK,
};

export function buildRawGrid(tpl: RoomTemplate): RawGrid {
  const iw = tpl.rows[0].length;
  const ih = tpl.rows.length;
  tpl.rows.forEach((row, i) => {
    if (row.length !== iw) throw new Error(`${tpl.id}: row ${i} is ${row.length} wide, expected ${iw}`);
  });
  const w = iw + 2;
  const h = ih + 2;
  const tiles = new Uint8Array(w * h);
  const raw: RawGrid = {
    w,
    h,
    tiles,
    doors: [],
    spawns: [],
    candles: [],
    altars: [],
    playerStart: null,
    bossSpawn: null,
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      tiles[y * w + x] = border ? T.WALL : T.FLOOR;
    }
  }

  tpl.rows.forEach((row, iy) => {
    [...row].forEach((ch, ix) => {
      const code = INTERIOR_SYMBOLS[ch];
      if (code === undefined) throw new Error(`${tpl.id}: unknown symbol "${ch}" at ${ix},${iy}`);
      const x = ix + 1;
      const y = iy + 1;
      tiles[y * w + x] = code;
      const pos = { x, y };
      if (ch === 's') raw.spawns.push(pos);
      if (ch === 'c') raw.candles.push(pos);
      if (ch === 'a') raw.altars.push(pos);
      if (ch === 'p') raw.playerStart = pos;
      if (ch === 'B') raw.bossSpawn = pos;
    });
  });

  for (const d of tpl.doors) {
    const pos = doorPosition(d.side, d.at, w, h);
    raw.doors.push(pos);
    tiles[pos.y * w + pos.x] = T.WALL; // Openings are decided per layout.
  }
  return raw;
}

function doorPosition(side: Side, at: number, w: number, h: number): Candidate {
  switch (side) {
    case 'N':
      return { x: at + 1, y: 0 };
    case 'S':
      return { x: at + 1, y: h - 1 };
    case 'W':
      return { x: 0, y: at + 1 };
    case 'E':
      return { x: w - 1, y: at + 1 };
  }
}

function mapPoint(x: number, y: number, w: number, h: number, tf: Transform): { x: number; y: number; w: number; h: number } {
  let px = tf.mirror ? w - 1 - x : x;
  let py = y;
  let cw = w;
  let ch = h;
  for (let i = 0; i < tf.rot; i++) {
    const nx = ch - 1 - py;
    const ny = px;
    px = nx;
    py = ny;
    [cw, ch] = [ch, cw];
  }
  return { x: px, y: py, w: cw, h: ch };
}

export function applyTransform(g: RawGrid, tf: Transform): RawGrid {
  const first = mapPoint(0, 0, g.w, g.h, tf);
  const w2 = first.w;
  const h2 = first.h;
  // Dimensions after a quarter turn are swapped, so recompute from a corner.
  const tiles = new Uint8Array(w2 * h2);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const p = mapPoint(x, y, g.w, g.h, tf);
      tiles[p.y * p.w + p.x] = g.tiles[y * g.w + x];
    }
  }
  const mp = (pt: Vec2i): Vec2i => {
    const p = mapPoint(pt.x, pt.y, g.w, g.h, tf);
    return { x: p.x, y: p.y };
  };
  return {
    w: w2,
    h: h2,
    tiles,
    doors: g.doors.map((d) => mp(d)),
    spawns: g.spawns.map(mp),
    candles: g.candles.map(mp),
    altars: g.altars.map(mp),
    playerStart: g.playerStart ? mp(g.playerStart) : null,
    bossSpawn: g.bossSpawn ? mp(g.bossSpawn) : null,
  };
}

/** Two tiles inside the room from an entry door, so arrival never starts on the threshold. */
function arrivalTile(side: Side, x: number, y: number, w: number, h: number): Vec2i {
  switch (side) {
    case 'N':
      return { x, y: 2 };
    case 'S':
      return { x, y: h - 3 };
    case 'W':
      return { x: 2, y };
    case 'E':
      return { x: w - 3, y };
  }
}

function dist(a: Vec2i, b: Vec2i): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Keeps only spawns that satisfy the fairness rules, greedily in template order. */
function filterSpawns(spawns: Vec2i[], start: Vec2i | null, doors: DoorSpec[]): Vec2i[] {
  const kept: Vec2i[] = [];
  for (const s of spawns) {
    if (start && dist(s, start) < SPAWN_RULES.fromStart) continue;
    if (doors.some((d) => dist(s, { x: d.x, y: d.y }) < SPAWN_RULES.fromDoor)) continue;
    if (kept.some((k) => dist(k, s) < SPAWN_RULES.spacing)) continue;
    kept.push(s);
  }
  return kept;
}

/** Breadth-first search over walkable tiles. Returns a visited mask. */
export function reachableFrom(layout: Pick<Layout, 'w' | 'h' | 'tiles'>, start: Vec2i): Uint8Array {
  const visited = new Uint8Array(layout.w * layout.h);
  const queue: number[] = [];
  const startIdx = start.y * layout.w + start.x;
  if (!isWalkableTile(layout.tiles[startIdx])) return visited;
  visited[startIdx] = 1;
  queue.push(startIdx);
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    const x = idx % layout.w;
    const y = (idx - x) / layout.w;
    const neighbours: Array<[number, number]> = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= layout.w || ny >= layout.h) continue;
      const n = ny * layout.w + nx;
      if (visited[n] || !isWalkableTile(layout.tiles[n])) continue;
      visited[n] = 1;
      queue.push(n);
    }
  }
  return visited;
}

function inward(d: DoorSpec, w: number, h: number): Vec2i {
  switch (d.side) {
    case 'N':
      return { x: d.x, y: 1 };
    case 'S':
      return { x: d.x, y: h - 2 };
    case 'W':
      return { x: 1, y: d.y };
    case 'E':
      return { x: w - 2, y: d.y };
  }
  return { x: d.x, y: d.y };
}

/**
 * Checks a finished layout against the validation rules. Returns problems, or
 * an empty list when the layout is valid. Generation uses this same check, and
 * the unit tests run it over every template and transform.
 */
export function findProblems(layout: Layout, kind: RoomKind): string[] {
  const problems: string[] = [];
  const { w, h } = layout;

  const doorSeen = new Set<string>();
  for (const d of layout.doors) {
    const key = `${d.x},${d.y}`;
    if (doorSeen.has(key)) problems.push(`two doors share tile ${key}`);
    doorSeen.add(key);
    if (sideOf(d.x, d.y, w, h) !== d.side) problems.push(`door at ${key} is not on side ${d.side}`);
    if (tileAt(layout, d.x, d.y) !== T.DOOR) problems.push(`door at ${key} is not a door tile`);
    const inside = inward(d, w, h);
    if (!isWalkableTile(tileAt(layout, inside.x, inside.y))) {
      problems.push(`door at ${key} opens onto a blocked tile`);
    }
  }

  const exitIndices = layout.doors.filter((d) => d.role === 'exit').map((d) => d.exitIndex).sort();
  exitIndices.forEach((idx, i) => {
    if (idx !== i) problems.push('exit indices are not 0..n-1');
  });

  if (!isWalkableTile(tileAt(layout, layout.start.x, layout.start.y))) {
    problems.push('player start is not walkable');
    return problems;
  }

  const reach = reachableFrom(layout, layout.start);
  for (const d of layout.doors) {
    const inside = inward(d, w, h);
    if (!reach[inside.y * w + inside.x]) problems.push(`door at ${d.x},${d.y} is unreachable from the start`);
  }
  for (const s of layout.spawns) {
    if (!reach[s.y * w + s.x]) problems.push(`spawn ${s.x},${s.y} is unreachable from the start`);
  }
  if (layout.bossSpawn && !reach[layout.bossSpawn.y * w + layout.bossSpawn.x]) {
    problems.push('boss spawn is unreachable from the start');
  }

  if (layout.spawns.length < SPAWN_RULES.minSpawns[kind]) {
    problems.push(`has ${layout.spawns.length} spawns, needs ${SPAWN_RULES.minSpawns[kind]}`);
  }
  if (kind === 'boss' && !layout.bossSpawn) problems.push('boss arena has no boss spawn');
  return problems;
}

function assemble(g: RawGrid, templateId: string, kind: RoomKind, opts: LayoutOptions, rng: Rng): Layout | null {
  const pool = g.doors.slice();
  let entry: Candidate | null = null;
  if (opts.entrySide) {
    const idx = pool.findIndex((d) => sideOf(d.x, d.y, g.w, g.h) === opts.entrySide);
    if (idx < 0) return null;
    entry = pool.splice(idx, 1)[0];
  }
  if (pool.length < opts.exitCount) return null;

  const exits = shuffled(rng, pool).slice(0, opts.exitCount);
  const tiles = g.tiles.slice();
  for (const d of pool) {
    if (!exits.includes(d)) tiles[d.y * g.w + d.x] = T.WALL;
  }

  const doors: DoorSpec[] = [];
  if (entry) {
    const side = sideOf(entry.x, entry.y, g.w, g.h);
    if (!side) return null;
    tiles[entry.y * g.w + entry.x] = T.DOOR;
    doors.push({ side, x: entry.x, y: entry.y, role: 'entry', exitIndex: -1 });
  }
  exits.forEach((d, i) => {
    const side = sideOf(d.x, d.y, g.w, g.h);
    if (!side) return;
    tiles[d.y * g.w + d.x] = T.DOOR;
    doors.push({ side, x: d.x, y: d.y, role: 'exit', exitIndex: i });
  });

  const entryDoor = doors.find((d) => d.role === 'entry');
  const start = entryDoor ? arrivalTile(entryDoor.side, entryDoor.x, entryDoor.y, g.w, g.h) : g.playerStart;
  if (!start) return null;

  const layout: Layout = {
    templateId,
    w: g.w,
    h: g.h,
    tiles,
    doors,
    spawns: filterSpawns(g.spawns, start, doors),
    candles: g.candles.slice(),
    altars: g.altars.slice(),
    start,
    bossSpawn: g.bossSpawn,
  };
  return findProblems(layout, kind).length === 0 ? layout : null;
}

/**
 * Builds a playable layout from an authored template. Tries the eight transforms
 * in a seeded random order and returns the first one that passes validation.
 * Throws only if the template cannot satisfy the request, which the tests rule out.
 */
export function generateLayout(templateId: string, rng: Rng, opts: LayoutOptions): Layout {
  const tpl = templateById(templateId);
  const raw = buildRawGrid(tpl);
  for (const tf of shuffled(rng, TRANSFORMS)) {
    const layout = assemble(applyTransform(raw, tf), tpl.id, tpl.kind, opts, rng);
    if (layout) return layout;
  }
  throw new Error(`No valid layout for ${templateId} with ${JSON.stringify(opts)}`);
}
