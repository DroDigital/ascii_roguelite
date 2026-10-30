import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import { DEFAULT_SETTINGS, PROGRESS_KEY, SETTINGS_KEY, defaultProgress, loadProgress, loadSettings } from '../src/core/save';
import { applyOutcome, isUnlocked, type RunOutcome } from '../src/game/meta';
import { RunDirector } from '../src/game/run';
import { COMBOS, UPGRADES, activeCombos, computeMods, offerUpgrades } from '../src/game/upgrades';
import { STAGE_OPTIONS, optionsForStage, exitCountForStage, oppositeSide } from '../src/world/route';

/** Minimal in-memory localStorage so save code runs under the node test environment. */
function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

const outcome = (over: Partial<RunOutcome> = {}): RunOutcome => ({
  won: false,
  time: 600,
  kills: 10,
  upgrades: [],
  combos: [],
  visitedCistern: false,
  clearedReliquary: false,
  reachedBoss: false,
  ...over,
});

describe('upgrades', () => {
  it('has twelve upgrades with unique ids and a stated tradeoff for each', () => {
    expect(UPGRADES.length).toBe(12);
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(12);
    for (const u of UPGRADES) expect(u.tradeoff.length, u.id).toBeGreaterThan(3);
  });

  it('derives base mods when nothing is owned', () => {
    const m = computeMods([]);
    expect(m.maxHp).toBe(100);
    expect(m.damageMul).toBe(1);
    expect(m.quill.fan).toBe(1);
    expect(m.tear.fragments).toBe(4);
  });

  it('applies tradeoffs as well as gains', () => {
    const m = computeMods(['brittle-vow', 'wide-crescent']);
    expect(m.damageMul).toBeCloseTo(1.35);
    expect(m.maxHp).toBe(75);
    expect(m.glaive.arcMul).toBeCloseTo(1.35);
    expect(m.glaive.recoverMul).toBeCloseTo(1.15);
  });

  it('lights up each discoverable combo only when both members are owned', () => {
    expect(activeCombos(['ember-edge'])).toEqual([]);
    expect(activeCombos(['ember-edge', 'kindling'])).toEqual(['pyre']);
    expect(activeCombos(['piercing-sigil', 'scatter-sigils'])).toEqual(['starfall']);
    expect(activeCombos(['glyph-lattice', 'fragment-barrage'])).toEqual(['orbit-storm']);
    expect(activeCombos(['breakers-edge', 'core-piercer'])).toEqual(['unshelled']);
    expect(activeCombos(['blank-step', 'riposte'])).toEqual(['mirror-step']);
    expect(COMBOS.length).toBe(5);
  });

  it('sets combo flags on the mods so the effect exists in the simulation', () => {
    const m = computeMods(['ember-edge', 'kindling', 'piercing-sigil', 'scatter-sigils']);
    expect(m.pyre).toBe(true);
    expect(m.quill.starfall).toBe(true);
    expect(m.quill.pierce).toBe(1);
    expect(m.quill.fan).toBe(3);
  });

  it('offers distinct, unowned upgrades and respects the rare-only request', () => {
    const rng = mulberry32(3);
    const owned = ['ember-edge', 'kindling'] as const;
    for (let i = 0; i < 40; i++) {
      const offers = offerUpgrades(rng, [...owned], 3, 0.15);
      expect(offers.length).toBe(3);
      expect(new Set(offers).size).toBe(3);
      for (const o of offers) expect(owned.includes(o as never)).toBe(false);
    }
    const rare = offerUpgrades(mulberry32(9), [], 3, 1, true);
    for (const id of rare) expect(UPGRADES.find((u) => u.id === id)?.rare).toBe(true);
  });
});

describe('route', () => {
  it('describes the branching route with two options per choice stage', () => {
    expect(STAGE_OPTIONS.map((s) => s.length)).toEqual([2, 2, 2]);
    expect(optionsForStage(4).map((o) => o.kind)).toEqual(['reliquary']);
    expect(optionsForStage(5).map((o) => o.kind)).toEqual(['boss']);
    expect([0, 1, 2, 3, 4, 5].map(exitCountForStage)).toEqual([2, 2, 2, 1, 1, 0]);
  });

  it('enters the next room through the opposite side', () => {
    expect(oppositeSide('N')).toBe('S');
    expect(oppositeSide('E')).toBe('W');
  });
});

describe('run director', () => {
  it('walks the route from the nave to the boss and wins at the boss', () => {
    const d = new RunDirector({ seed: 42, weapon: 'glaive', boon: null, modifiers: [] });
    let plan = d.begin();
    expect(plan.option.kind).toBe('nave');
    expect(d.nextOptions.length).toBe(2);
    expect(d.roomCleared(0)).toBe('playing');
    plan = d.enter(0, d.nextOptions[0]);
    expect(plan.option.kind).toBe('combat');
    expect(d.roomCleared(3)).toBe('upgrade');
    expect(d.offers.length).toBe(3);
    d.pickUpgrade(d.offers[0]);
    expect(d.status).toBe('playing');
    // Walk through the remaining stages with the first option each time.
    for (let guard = 0; guard < 10 && d.stage < 5; guard++) {
      if (d.plan?.option.kind === 'cistern') d.roomCleared(0);
      else if (d.plan?.option.kind === 'reliquary') {
        d.roomCleared(2);
        while (d.status === 'upgrade') d.pickUpgrade(d.offers[0]);
      } else if (d.plan?.option.kind === 'combat') {
        d.roomCleared(4);
        while (d.status === 'upgrade') d.pickUpgrade(d.offers[0]);
      }
      if (d.stage < 5) plan = d.enter(0, d.nextOptions[0]);
    }
    expect(plan.option.kind).toBe('boss');
    expect(d.roomCleared(10)).toBe('victory');
  });

  it('reports combos once, the first time both members are owned', () => {
    const d = new RunDirector({ seed: 1, weapon: 'glaive', boon: null, modifiers: [] });
    d.begin();
    expect(d.pickUpgrade('ember-edge')).toEqual([]);
    expect(d.pickUpgrade('kindling')).toEqual(['pyre']);
    expect(d.pickUpgrade('blank-step')).toEqual([]);
    expect(d.combosSeen.has('pyre')).toBe(true);
  });

  it('attunes at the cistern for a rare pick and a maximum-health penalty', () => {
    const d = new RunDirector({ seed: 2, weapon: 'glaive', boon: null, modifiers: [] });
    d.begin();
    const before = d.mods.maxHp;
    d.attune();
    expect(d.status).toBe('upgrade');
    expect(d.mods.maxHp).toBe(before - 20);
    expect(d.offers.every((id) => UPGRADES.find((u) => u.id === id)?.rare)).toBe(true);
  });

  it('mends 45% of maximum health without exceeding it', () => {
    const d = new RunDirector({ seed: 3, weapon: 'glaive', boon: null, modifiers: [] });
    const p = d.startingPlayer();
    p.hp = 20;
    d.mend(p);
    expect(p.hp).toBeCloseTo(20 + 100 * 0.45);
    p.hp = 95;
    d.mend(p);
    expect(p.hp).toBe(100);
  });

  it('applies boons to the starting player', () => {
    const d = new RunDirector({ seed: 4, weapon: 'glaive', boon: 'ash-ward', modifiers: [] });
    expect(d.startingPlayer().maxHp).toBe(125);
    const dust = new RunDirector({ seed: 4, weapon: 'glaive', boon: 'dust-step', modifiers: [] });
    expect(dust.startingPlayer().dodgeMaxCharges).toBe(2);
  });

  it('gives an extra elite in the middle stages when Gilded Path is on', () => {
    const d = new RunDirector({ seed: 5, weapon: 'glaive', boon: null, modifiers: ['gilded-path'] });
    d.begin();
    d.enter(0, d.nextOptions[0]);
    d.roomCleared(3);
    d.pickUpgrade(d.offers[0]);
    d.enter(0, d.nextOptions[0]);
    expect(d.stage).toBe(2);
    expect(d.wave().kinds).toContain('elite');
  });
});

describe('meta progression', () => {
  it('unlocks the Quill after the first finished run', () => {
    const r = applyOutcome(defaultProgress(), outcome());
    expect(r.progress.unlocks.weapons).toContain('quill');
    expect(r.unlocked).toContain('Glyph Quill');
  });

  it('unlocks win-only rewards on a win and records the best time', () => {
    const first = applyOutcome(defaultProgress(), outcome({ won: true, time: 800, reachedBoss: true }));
    expect(first.progress.unlocks.boons).toContain('dust-step');
    expect(first.progress.unlocks.modifiers).toEqual(expect.arrayContaining(['ink-famine', 'gilded-path']));
    expect(first.progress.bestWinTime).toBe(800);
    const second = applyOutcome(first.progress, outcome({ won: true, time: 700 }));
    expect(second.progress.bestWinTime).toBe(700);
    const third = applyOutcome(second.progress, outcome({ won: true, time: 900 }));
    expect(third.progress.bestWinTime).toBe(700);
  });

  it('records codex entries across runs without duplicates', () => {
    const a = applyOutcome(defaultProgress(), outcome({ upgrades: ['kindling'], combos: ['pyre'] }));
    const b = applyOutcome(a.progress, outcome({ upgrades: ['kindling', 'riposte'], combos: ['pyre'] }));
    expect(b.progress.upgrades.sort()).toEqual(['kindling', 'riposte']);
    expect(b.progress.combos).toEqual(['pyre']);
  });

  it('gates the loadout on unlocks', () => {
    const p = defaultProgress();
    expect(isUnlocked(p, 'weapons', 'glaive')).toBe(true);
    expect(isUnlocked(p, 'weapons', 'quill')).toBe(false);
  });
});

describe('local save', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to defaults when nothing is stored', () => {
    installStorage();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadProgress()).toEqual(defaultProgress());
  });

  it('ignores corrupt JSON instead of throwing', () => {
    const map = installStorage();
    map.set(SETTINGS_KEY, '{not json');
    map.set(PROGRESS_KEY, '[1,2');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadProgress()).toEqual(defaultProgress());
  });

  it('clamps out-of-range settings and rejects unknown choices', () => {
    const map = installStorage();
    map.set(SETTINGS_KEY, JSON.stringify({ contrast: 9, masterVolume: -3, glyphDensity: 'huge', quality: 'high', hitStop: 'yes' }));
    const s = loadSettings();
    expect(s.contrast).toBe(1.6);
    expect(s.masterVolume).toBe(0);
    expect(s.glyphDensity).toBe(DEFAULT_SETTINGS.glyphDensity);
    expect(s.quality).toBe('high');
    expect(s.hitStop).toBe(DEFAULT_SETTINGS.hitStop);
  });

  it('drops unknown ids from saved progress and keeps the glaive', () => {
    const map = installStorage();
    map.set(
      PROGRESS_KEY,
      JSON.stringify({ version: 1, runs: 3, wins: 1, bestWinTime: 400, kills: 9, combos: ['pyre', 'nope'], upgrades: ['kindling', 'x'], unlocks: { weapons: ['quill', 'laser'], boons: ['dust-step', 'bogus'], modifiers: [] } }),
    );
    const p = loadProgress();
    expect(p.combos).toEqual(['pyre']);
    expect(p.upgrades).toEqual(['kindling']);
    expect(p.unlocks.weapons).toEqual(['quill', 'glaive']);
    expect(p.unlocks.boons).toEqual(['dust-step']);
    expect(p.bestWinTime).toBe(400);
  });

  it('treats an unknown save version as empty', () => {
    const map = installStorage();
    map.set(PROGRESS_KEY, JSON.stringify({ version: 99, runs: 50 }));
    expect(loadProgress().runs).toBe(0);
  });
});
