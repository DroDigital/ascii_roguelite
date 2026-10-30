import type { Side } from './tiles';

/**
 * Authored room templates. Each row is the room's interior (walls are added
 * around it). Standard rooms are 22 × 14 interior tiles, written as groups of
 * 5, 5, 5, 5 and 2 columns. The boss arena is 28 × 20, written as four groups
 * of 7. Groups are separated by spaces, which are visual only. Symbols:
 *   .  floor            o  pillar (solid)        b  bookshelf (solid)
 *   #  inner wall block (solid)                  ,  ink pool (walkable, slows)
 *   s  enemy spawn      c  candle (light)        a  altar (interactable)
 *   p  player start     B  boss spawn
 * Doors are placed by side and interior position, so the generator can rotate
 * and mirror a template to suit the route.
 */
export type RoomKind = 'nave' | 'combat' | 'cistern' | 'reliquary' | 'boss';

export interface TemplateDoor {
  side: Side;
  /** Interior coordinate along the side: x for N/S, y for W/E. */
  at: number;
}

export interface RoomTemplate {
  id: string;
  name: string;
  kind: RoomKind;
  rows: string[];
  doors: TemplateDoor[];
}

/** Removes the visual spaces from grouped rows. */
function grid(rows: string[]): string[] {
  return rows.map((r) => r.replace(/ /g, ''));
}

export const TEMPLATES: RoomTemplate[] = [
  {
    id: 'nave',
    name: 'Nave',
    kind: 'nave',
    rows: grid([
      'oo... ..... ..... ..... oo',
      '..... ..... ..... ..... ..',
      '..c.. ..... ..... ..c.. ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
      '..c.. ..... ..... ..c.. ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..p.. ..... ..',
      'oo... ..... ..... ..... oo',
    ]),
    doors: [
      { side: 'N', at: 10 },
      { side: 'W', at: 6 },
      { side: 'E', at: 6 },
    ],
  },
  {
    id: 'hall-of-hooks',
    name: 'Hall of Hooks',
    kind: 'combat',
    rows: grid([
      'o.... ..... ..... ..... .o',
      '..... ..... ..... ..... ..',
      '..o.. ..... ..o.. ..... ..',
      '..... ..s.. ..... ..s.. ..',
      '..... ..... ..... ..... ..',
      '..... ..,,, ,,,,, ,,,.. ..',
      '..... ..,,, ,,,,, ,,,.. ..',
      '..... ..... ..... ..... ..',
      '..... ..s.. ..... ..s.. ..',
      '..... ..... ..... ..... ..',
      '..o.. ..... ..o.. ..... ..',
      '..... ..... ..... ..... ..',
      'o.... ..... ..s.. ..... .o',
      '..... ..... ..... ..... ..',
    ]),
    doors: [
      { side: 'N', at: 9 },
      { side: 'W', at: 6 },
      { side: 'E', at: 6 },
    ],
  },
  {
    id: 'stacks',
    name: 'The Stacks',
    kind: 'combat',
    rows: grid([
      '..... bbbbb ..... bbbbb ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..s.. ..',
      '..... bbbbb ..... bbbbb ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..s.. ..... ..',
      '..... ..... ..... ..... ..',
      '..... bbbbb ..... bbbbb ..',
      '..... ..... ..... ..... ..',
      '..s.. ..... ..... ..... ..',
      '..... bbbbb ..... bbbbb ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..s.. ..... ..',
      '..s.. ..... ..... ..... ..',
    ]),
    doors: [
      { side: 'W', at: 3 },
      { side: 'S', at: 12 },
      { side: 'E', at: 10 },
    ],
  },
  {
    id: 'choir',
    name: 'The Choir',
    kind: 'combat',
    rows: grid([
      '..... ..... ..... ..... ..',
      '..o.o ..... ..... ..... .o',
      '..... ..o.. ..s.. ..o.. ..',
      '..... ..... ..... ..... ..',
      '..o.. ..... ..... ..... .o',
      '..... ..s.. ..... ..... ..',
      '..... ..... ..... ..... ..',
      '..... ..c.. ..... ..c.. ..',
      '..o.. ..... ..s.. ..... .o',
      '..... ..... ..... ..s.. ..',
      '..... ..o.. ..... ..o.. ..',
      '..o.o ..... ..s.. ..... .o',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
    ]),
    doors: [
      { side: 'N', at: 10 },
      { side: 'S', at: 10 },
      { side: 'W', at: 6 },
    ],
  },
  {
    id: 'cistern',
    name: 'The Cistern',
    kind: 'cistern',
    rows: grid([
      '..... ..... ..... ..... ..',
      '..... ,,,,, ,,,,, ,,,,, ..',
      '..... ,,,,, ,,,,, ,,,,, ..',
      '..... ,,a,, ,,,,, ,,a,, ..',
      '..... ,,,,, ,,,,, ,,,,, ..',
      '..... ,,,,, ,,,,, ,,,,, ..',
      '..... ..... ..... ..... ..',
      '..... ,,,,, ,,,,, ,,,,, ..',
      '..... ,,,,, ,,,,, ,,,,, ..',
      '..... ,,,,, ,,,,, ,,,,, ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..c.. ..... ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
    ]),
    doors: [
      { side: 'N', at: 10 },
      { side: 'W', at: 6 },
      { side: 'E', at: 6 },
    ],
  },
  {
    id: 'ossuary',
    name: 'The Ossuary',
    kind: 'combat',
    rows: grid([
      '..... ..... ..... ..... ..',
      '..##. ..s.. ..... ..s.. ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..o.. ..... ..',
      '..... ..... ..... ..... ..',
      '..s.. ..##. ..... .##.. ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..o.. ..... ..',
      '..... ..... ..... ..... ..',
      '..##. ..... ..s.. ..... ..',
      '..... ..... ..... ..... ..',
      '..... ..s.. ..... ..s.. ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
    ]),
    doors: [
      { side: 'N', at: 4 },
      { side: 'E', at: 9 },
      { side: 'W', at: 9 },
    ],
  },
  {
    id: 'lectern-gallery',
    name: 'Lectern Gallery',
    kind: 'combat',
    rows: grid([
      '..b.. ..... ..... ..... .b',
      '..b.. ..s.. ..... ..s.. .b',
      '..b.. ..... ..... ..... .b',
      '..... ..... ..o.. ..... ..',
      '..s.. ..... ..... ..... .s',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..o.. ..... ..',
      '..s.. ..... ..... ..... .s',
      '..b.. ..... ..... ..... .b',
      '..b.. ..s.. ..... ..s.. .b',
      '..b.. ..... ..... ..... .b',
      '..... ..... ..... ..... ..',
    ]),
    doors: [
      { side: 'N', at: 12 },
      { side: 'S', at: 4 },
      { side: 'E', at: 6 },
    ],
  },
  {
    id: 'reliquary',
    name: 'The Reliquary',
    kind: 'reliquary',
    rows: grid([
      'bbbbb ..... ..... ..... bb',
      'b.... ..... ..... ..... .b',
      'b..s. ..... ..o.. ..... .b',
      'b.... ..... ..... ..... .b',
      'b.... ..... ..... ..... .b',
      '..... ..... ..... ..... ..',
      '..c.. ..s.. ..... ..s.. ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
      '..... ..... ..... ..... ..',
      'b.... ..... ..... ..... .b',
      'b.... ..... ..o.. ..... .b',
      'b..s. ..... ..... ..... .b',
      'bbbbb ..... ..... ..... bb',
    ]),
    doors: [
      { side: 'N', at: 10 },
      { side: 'W', at: 6 },
      { side: 'E', at: 6 },
    ],
  },
  {
    id: 'boss-arena',
    name: 'The Scribe’s Arena',
    kind: 'boss',
    rows: grid([
      'oo..... ....... ....... .....oo',
      '..o.... ....... ....... ....o..',
      '....... ....... ....... .......',
      '....... ....... ..o.... .......',
      'o...... ....... ....... ......o',
      '....... ....... ....... .......',
      '....... ,,,,,,, ,,,,,,, .......',
      '....... ,,,,,,, ,,,,,,, .......',
      '....... ,,,,,,, ,,,,,,, .......',
      '....... ....... ....... .......',
      '....... ....... ....... .......',
      '....... ....... .B..... .......',
      '....... ....... ....... .......',
      '....... ,,,,,,, ,,,,,,, .......',
      '....... ,,,,,,, ,,,,,,, .......',
      '....... ,,,,,,, ,,,,,,, .......',
      '....... ....... ....... .......',
      'o...... ....... ....... ......o',
      '..o.... ....... ....... ....o..',
      'oo..... ....... ....... .....oo',
    ]),
    doors: [
      { side: 'S', at: 13 },
      { side: 'N', at: 13 },
    ],
  },
];

export function templateById(id: string): RoomTemplate {
  const t = TEMPLATES.find((tpl) => tpl.id === id);
  if (!t) throw new Error(`Unknown room template: ${id}`);
  return t;
}
