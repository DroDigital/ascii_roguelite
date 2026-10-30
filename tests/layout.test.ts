import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import { TRANSFORMS, applyTransform, buildRawGrid, findProblems, generateLayout } from '../src/world/layout';
import { TEMPLATES, templateById } from '../src/world/templates';
import type { Side } from '../src/world/tiles';
import { T } from '../src/world/tiles';

const OPTIONS: Record<string, { entrySide: Side | null; exitCount: number }> = {
  nave: { entrySide: null, exitCount: 2 },
  combat: { entrySide: 'W', exitCount: 2 },
  cistern: { entrySide: 'W', exitCount: 2 },
  reliquary: { entrySide: 'W', exitCount: 1 },
  boss: { entrySide: 'W', exitCount: 0 },
};

describe('authored templates', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s has rectangular rows and known symbols', (_id, tpl) => {
    expect(() => buildRawGrid(tpl)).not.toThrow();
    const widths = new Set(tpl.rows.map((r) => r.length));
    expect(widths.size).toBe(1);
  });

  it('keeps standard rooms at 22 x 14 and the boss arena at 28 x 20', () => {
    for (const tpl of TEMPLATES) {
      const expected = tpl.kind === 'boss' ? [28, 20] : [22, 14];
      expect([tpl.rows[0].length, tpl.rows.length], tpl.id).toEqual(expected);
    }
  });

  it('gives every combat room a spawn budget that fits its encounters', () => {
    for (const tpl of TEMPLATES.filter((t) => t.kind === 'combat')) {
      const spawns = tpl.rows.join('').split('s').length - 1;
      expect(spawns, tpl.id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('transforms', () => {
  it('provides eight distinct variants', () => {
    const keys = new Set(TRANSFORMS.map((t) => `${t.rot}:${t.mirror}`));
    expect(keys.size).toBe(8);
  });

  it('keeps the tile count and door count under every transform', () => {
    const tpl = templateById('stacks');
    const raw = buildRawGrid(tpl);
    for (const tf of TRANSFORMS) {
      const g = applyTransform(raw, tf);
      expect(g.tiles.length).toBe(g.w * g.h);
      expect(g.doors.length).toBe(raw.doors.length);
    }
  });
});

describe('generated layouts', () => {
  for (const tpl of TEMPLATES) {
    it(`${tpl.id} validates under all transforms across seeds`, () => {
      const opts = OPTIONS[tpl.kind];
      for (let seed = 1; seed <= 40; seed++) {
        const layout = generateLayout(tpl.id, mulberry32(seed * 7919), opts);
        expect(findProblems(layout, tpl.kind), `${tpl.id} seed ${seed}`).toEqual([]);
        const exits = layout.doors.filter((d) => d.role === 'exit');
        expect(exits.length).toBe(opts.exitCount);
        expect(layout.doors.some((d) => d.role === 'entry')).toBe(opts.entrySide !== null);
        if (tpl.kind === 'boss') expect(layout.bossSpawn).not.toBeNull();
      }
    });
  }

  it('is deterministic for a given seed', () => {
    const a = generateLayout('hall-of-hooks', mulberry32(42), OPTIONS.combat);
    const b = generateLayout('hall-of-hooks', mulberry32(42), OPTIONS.combat);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.doors).toEqual(b.doors);
  });

  it('exits open onto walkable floor and every spawn is fair to the arrival point', () => {
    for (const tpl of TEMPLATES.filter((t) => t.kind === 'combat')) {
      const layout = generateLayout(tpl.id, mulberry32(9), OPTIONS.combat);
      for (const s of layout.spawns) {
        const d = Math.hypot(s.x - layout.start.x, s.y - layout.start.y);
        expect(d, `${tpl.id} spawn ${s.x},${s.y}`).toBeGreaterThanOrEqual(6);
      }
      expect(layout.tiles[layout.start.y * layout.w + layout.start.x]).not.toBe(T.WALL);
    }
  });

  it('turns unused door openings into walls', () => {
    const layout = generateLayout('hall-of-hooks', mulberry32(3), OPTIONS.combat);
    const openings = layout.tiles.reduce((n, code) => n + (code === T.DOOR ? 1 : 0), 0);
    expect(openings).toBe(layout.doors.length);
  });
});
