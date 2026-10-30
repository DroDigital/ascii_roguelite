import { type Rng, shuffled } from '../core/rng';
import { type Mods, baseMods } from '../sim/mods';

export type UpgradeTag = 'glaive' | 'quill' | 'tear' | 'dodge' | 'general';

export type UpgradeId =
  | 'ember-edge'
  | 'wide-crescent'
  | 'riposte'
  | 'breakers-edge'
  | 'piercing-sigil'
  | 'scatter-sigils'
  | 'kindling'
  | 'glyph-lattice'
  | 'fragment-barrage'
  | 'core-piercer'
  | 'blank-step'
  | 'brittle-vow';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  tag: UpgradeTag;
  rare: boolean;
  text: string;
  /** The cost, stated plainly so the tradeoff is visible on the card. */
  tradeoff: string;
  apply: (m: Mods) => void;
}

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'ember-edge',
    name: 'Ember Edge',
    tag: 'glaive',
    rare: false,
    text: 'Glaive hits set enemies burning for 4 damage a second over 3 seconds.',
    tradeoff: 'No drawback.',
    apply: (m) => {
      m.glaive.ignite = true;
    },
  },
  {
    id: 'wide-crescent',
    name: 'Wide Crescent',
    tag: 'glaive',
    rare: false,
    text: 'The glaive arc is 35% wider and reaches further.',
    tradeoff: 'Recovery after each swing is 15% longer.',
    apply: (m) => {
      m.glaive.arcMul *= 1.35;
      m.glaive.recoverMul *= 1.15;
    },
  },
  {
    id: 'riposte',
    name: 'Riposte',
    tag: 'glaive',
    rare: true,
    text: 'The first swing after a dodge deals 75% more damage and staggers.',
    tradeoff: 'Only works straight after a dodge.',
    apply: (m) => {
      m.glaive.riposte = true;
    },
  },
  {
    id: 'breakers-edge',
    name: "Breaker's Edge",
    tag: 'glaive',
    rare: true,
    text: 'Glaive hits remove one armour layer from enemies.',
    tradeoff: 'Glaive damage is 15% lower.',
    apply: (m) => {
      m.glaive.breakArmor = true;
      m.glaive.damageMul *= 0.85;
    },
  },
  {
    id: 'piercing-sigil',
    name: 'Piercing Sigil',
    tag: 'quill',
    rare: false,
    text: 'Quill bolts pass through one enemy.',
    tradeoff: 'Each bolt deals 20% less damage.',
    apply: (m) => {
      m.quill.pierce += 1;
      m.quill.damageMul *= 0.8;
    },
  },
  {
    id: 'scatter-sigils',
    name: 'Scatter Sigils',
    tag: 'quill',
    rare: false,
    text: 'Each quill shot releases a fan of three bolts.',
    tradeoff: 'Each bolt deals 45% less damage.',
    apply: (m) => {
      m.quill.fan = 3;
      m.quill.damageMul *= 0.55;
    },
  },
  {
    id: 'kindling',
    name: 'Kindling',
    tag: 'general',
    rare: false,
    text: 'Burning enemies burst when they die, hurting and igniting those nearby.',
    tradeoff: 'Needs a burning enemy to trigger.',
    apply: (m) => {
      m.kindling = true;
    },
  },
  {
    id: 'glyph-lattice',
    name: 'Glyph Lattice',
    tag: 'tear',
    rare: false,
    text: 'The Tear releases two more fragments, and they last two seconds longer.',
    tradeoff: 'Tear cooldown is 27% longer.',
    apply: (m) => {
      m.tear.fragments += 2;
      m.tear.fragmentLifeAdd += 2;
      m.tear.cooldownMul *= 1.27;
    },
  },
  {
    id: 'fragment-barrage',
    name: 'Fragment Barrage',
    tag: 'tear',
    rare: false,
    text: 'Fragments fire twice as often.',
    tradeoff: 'No drawback.',
    apply: (m) => {
      m.tear.fragmentIntervalMul *= 0.5;
    },
  },
  {
    id: 'core-piercer',
    name: 'Core Piercer',
    tag: 'tear',
    rare: true,
    text: 'Exposed cores take 60% more damage instead of 40%.',
    tradeoff: 'The Tear takes 25% longer to charge.',
    apply: (m) => {
      m.tear.coreMul = 1.6;
      m.tear.chargeMul *= 1.25;
    },
  },
  {
    id: 'blank-step',
    name: 'Blank Step',
    tag: 'dodge',
    rare: false,
    text: 'Dodge cooldown is 35% shorter. The dodge trail strikes enemies it crosses.',
    tradeoff: 'Dodges travel 15% less far.',
    apply: (m) => {
      m.dodge.cooldownMul *= 0.65;
      m.dodge.distanceMul *= 0.85;
      m.dodge.trailDamage = 6;
    },
  },
  {
    id: 'brittle-vow',
    name: 'Brittle Vow',
    tag: 'general',
    rare: true,
    text: 'All damage is 35% higher.',
    tradeoff: 'Maximum health is 25 lower.',
    apply: (m) => {
      m.damageMul *= 1.35;
      m.maxHp -= 25;
    },
  },
];

export function upgradeById(id: UpgradeId): UpgradeDef {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) throw new Error(`Unknown upgrade: ${id}`);
  return u;
}

export interface ComboDef {
  id: 'pyre' | 'mirror-step' | 'starfall' | 'orbit-storm' | 'unshelled';
  name: string;
  needs: [UpgradeId, UpgradeId];
  text: string;
}

export const COMBOS: readonly ComboDef[] = [
  { id: 'pyre', name: 'Pyre', needs: ['ember-edge', 'kindling'], text: 'Ignited enemies detonate on death and spread the fire.' },
  { id: 'mirror-step', name: 'Mirror Step', needs: ['blank-step', 'riposte'], text: 'Trail hits count as dodges for Riposte.' },
  { id: 'starfall', name: 'Starfall', needs: ['piercing-sigil', 'scatter-sigils'], text: 'Bolts pierce, and the fan widens.' },
  { id: 'orbit-storm', name: 'Orbit Storm', needs: ['glyph-lattice', 'fragment-barrage'], text: 'Fragments fire the moment the Tear is released.' },
  { id: 'unshelled', name: 'Unshelled', needs: ['breakers-edge', 'core-piercer'], text: 'Armour broken by a glaive hit also exposes the core for two seconds.' },
];

/** Which combos are complete for a set of owned upgrades. */
export function activeCombos(owned: readonly UpgradeId[]): ComboDef['id'][] {
  const set = new Set(owned);
  return COMBOS.filter((c) => set.has(c.needs[0]) && set.has(c.needs[1])).map((c) => c.id);
}

/** Run-level inputs beyond upgrades: boons, modifiers and the Attune penalty. */
export interface RunModifiers {
  boonMaxHp: number;
  boonShards: number;
  boonDodge: number;
  inkFamine: boolean;
  gildedPath: boolean;
  attunePenalty: number;
}

export const NO_RUN_MODIFIERS: RunModifiers = {
  boonMaxHp: 0,
  boonShards: 0,
  boonDodge: 0,
  inkFamine: false,
  gildedPath: false,
  attunePenalty: 0,
};

/** Derives the full Mods from owned upgrades, combos, and run-level modifiers. Pure. */
export function computeMods(owned: readonly UpgradeId[], run: RunModifiers = NO_RUN_MODIFIERS): Mods {
  const m = baseMods();
  for (const id of owned) upgradeById(id).apply(m);
  const combos = new Set(activeCombos(owned));
  m.pyre = combos.has('pyre');
  m.dodge.mirrorStep = combos.has('mirror-step');
  m.quill.starfall = combos.has('starfall');
  m.tear.orbitStorm = combos.has('orbit-storm');
  m.glaive.unshelled = combos.has('unshelled');
  m.maxHp += run.boonMaxHp - run.attunePenalty;
  m.dodgeCharges += run.boonDodge;
  m.shardMul *= run.inkFamine ? 1.4 : 1;
  return m;
}

/** Picks up to `count` upgrades the player does not own yet, weighted toward common ones. */
export function offerUpgrades(rng: Rng, owned: readonly UpgradeId[], count = 3, rareChance = 0.15, onlyRare = false): UpgradeId[] {
  const have = new Set(owned);
  const pool = UPGRADES.filter((u) => !have.has(u.id));
  const common = shuffled(rng, pool.filter((u) => !u.rare));
  const rare = shuffled(rng, pool.filter((u) => u.rare));
  const picks: UpgradeId[] = [];
  const take = (list: UpgradeDef[]): void => {
    const next = list.find((u) => !picks.includes(u.id));
    if (next) picks.push(next.id);
  };
  for (let slot = 0; slot < count; slot++) {
    const wantRare = onlyRare || rng() < rareChance;
    if (wantRare && rare.some((u) => !picks.includes(u.id))) take(rare);
    else take(common);
  }
  // Fall back to whatever remains so every slot is filled while cards are left.
  for (const u of [...common, ...rare]) {
    if (picks.length >= count) break;
    if (!picks.includes(u.id)) picks.push(u.id);
  }
  return picks;
}
