/** Tile codes for a room's walkable grid. Row-major, index = y * w + x. */
export const T = {
  VOID: 0,
  FLOOR: 1,
  WALL: 2,
  PILLAR: 3,
  BOOK: 4,
  INK: 5,
  DOOR: 6,
  ALTAR: 7,
} as const;

export type TileCode = (typeof T)[keyof typeof T];

export type Side = 'N' | 'E' | 'S' | 'W';

export interface Vec2i {
  x: number;
  y: number;
}

export type DoorRole = 'entry' | 'exit' | 'closed';

export interface DoorSpec {
  side: Side;
  x: number;
  y: number;
  role: DoorRole;
  /** For exits: which option on the route this door leads to (0 or 1). */
  exitIndex: number;
}

export interface Layout {
  templateId: string;
  w: number;
  h: number;
  tiles: Uint8Array;
  doors: DoorSpec[];
  spawns: Vec2i[];
  candles: Vec2i[];
  altars: Vec2i[];
  /** Where the player stands when the room starts. */
  start: Vec2i;
  /** Boss spawn in the boss arena, otherwise null. */
  bossSpawn: Vec2i | null;
}

export function tileAt(layout: Layout, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= layout.w || y >= layout.h) return T.VOID;
  return layout.tiles[y * layout.w + x];
}

/** Solid regardless of door state. Locked doors are handled by the caller. */
export function isSolidTile(code: number): boolean {
  return code === T.VOID || code === T.WALL || code === T.PILLAR || code === T.BOOK;
}

/** Walkable when open. Ink slows movement but does not block it. */
export function isWalkableTile(code: number): boolean {
  return code === T.FLOOR || code === T.INK || code === T.ALTAR || code === T.DOOR;
}

export function sideOf(x: number, y: number, w: number, h: number): Side | null {
  if (y === 0) return 'N';
  if (y === h - 1) return 'S';
  if (x === 0) return 'W';
  if (x === w - 1) return 'E';
  return null;
}
