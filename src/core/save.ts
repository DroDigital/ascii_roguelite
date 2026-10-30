/** Local persistence for settings and meta-progress. Every access is guarded: storage can be blocked or full. */

export const SETTINGS_KEY = 'vellum.settings.v1';
export const PROGRESS_KEY = 'vellum.save.v1';

export type GlyphDensity = 'fine' | 'standard' | 'bold';
export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  /** 0 to 1. Scales shake and camera kicks. */
  screenShake: number;
  hitStop: boolean;
  reducedMotion: boolean;
  /** 0 to 1. Scales particle counts, distortions and flashes. */
  effects: number;
  glyphDensity: GlyphDensity;
  /** Brightness exponent for the glyph ramp, 0.6 to 1.6. */
  contrast: number;
  quality: Quality;
  showStats: boolean;
  /** Mouse-look multiplier, 0.4 to 2.5. */
  sensitivity: number;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 0.9,
  ambienceVolume: 0.5,
  screenShake: 1,
  hitStop: true,
  reducedMotion: false,
  effects: 1,
  glyphDensity: 'standard',
  contrast: 0.8,
  quality: 'medium',
  showStats: false,
  sensitivity: 1,
};

export interface Unlocks {
  weapons: string[];
  boons: string[];
  modifiers: string[];
}

export interface Progress {
  version: 1;
  runs: number;
  wins: number;
  bestWinTime: number | null;
  kills: number;
  /** Combos discovered across runs, by id. */
  combos: string[];
  /** Upgrades seen across runs, by id. */
  upgrades: string[];
  unlocks: Unlocks;
}

export const DEFAULT_UNLOCKS: Unlocks = {
  weapons: ['glaive'],
  boons: [],
  modifiers: [],
};

export function defaultProgress(): Progress {
  return {
    version: 1,
    runs: 0,
    wins: 0,
    bestWinTime: null,
    kills: 0,
    combos: [],
    upgrades: [],
    unlocks: { weapons: [...DEFAULT_UNLOCKS.weapons], boons: [], modifiers: [] },
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read(key: string): unknown {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;
const strings = (v: unknown, allowed: readonly string[]): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && allowed.includes(x)))] : [];

/** Reads settings, clamping every value. Unknown or corrupt data falls back to defaults. */
export function loadSettings(): Settings {
  const raw = (read(SETTINGS_KEY) ?? {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    masterVolume: num(raw.masterVolume, 0, 1, d.masterVolume),
    sfxVolume: num(raw.sfxVolume, 0, 1, d.sfxVolume),
    ambienceVolume: num(raw.ambienceVolume, 0, 1, d.ambienceVolume),
    screenShake: num(raw.screenShake, 0, 1, d.screenShake),
    hitStop: bool(raw.hitStop, d.hitStop),
    reducedMotion: bool(raw.reducedMotion, d.reducedMotion),
    effects: num(raw.effects, 0, 1, d.effects),
    glyphDensity: oneOf(raw.glyphDensity, ['fine', 'standard', 'bold'] as const, d.glyphDensity),
    contrast: num(raw.contrast, 0.6, 1.6, d.contrast),
    quality: oneOf(raw.quality, ['low', 'medium', 'high'] as const, d.quality),
    showStats: bool(raw.showStats, d.showStats),
    sensitivity: num(raw.sensitivity, 0.4, 2.5, d.sensitivity),
  };
}

export function saveSettings(s: Settings): boolean {
  return write(SETTINGS_KEY, s);
}

const UPGRADE_IDS = [
  'ember-edge',
  'wide-crescent',
  'riposte',
  'breakers-edge',
  'piercing-sigil',
  'scatter-sigils',
  'kindling',
  'glyph-lattice',
  'fragment-barrage',
  'core-piercer',
  'blank-step',
  'brittle-vow',
];
const COMBO_IDS = ['pyre', 'mirror-step', 'starfall', 'orbit-storm', 'unshelled'];
const BOON_IDS = ['ash-ward', 'scribes-pouch', 'dust-step'];
const MODIFIER_IDS = ['ink-famine', 'gilded-path'];
const WEAPON_IDS = ['glaive', 'quill'];

/** Reads meta-progress. Anything unrecognised is dropped, so a corrupt save never breaks the game. */
export function loadProgress(): Progress {
  const raw = (read(PROGRESS_KEY) ?? {}) as Record<string, unknown>;
  const d = defaultProgress();
  if (raw.version !== 1) return d;
  const unlocks = (raw.unlocks ?? {}) as Record<string, unknown>;
  return {
    version: 1,
    runs: Math.floor(num(raw.runs, 0, 1e9, 0)),
    wins: Math.floor(num(raw.wins, 0, 1e9, 0)),
    bestWinTime: raw.bestWinTime === null ? null : num(raw.bestWinTime, 0, 1e9, 0) || null,
    kills: Math.floor(num(raw.kills, 0, 1e12, 0)),
    combos: strings(raw.combos, COMBO_IDS),
    upgrades: strings(raw.upgrades, UPGRADE_IDS),
    unlocks: {
      weapons: strings(unlocks.weapons, WEAPON_IDS).concat('glaive').filter((v, i, a) => a.indexOf(v) === i),
      boons: strings(unlocks.boons, BOON_IDS),
      modifiers: strings(unlocks.modifiers, MODIFIER_IDS),
    },
  };
}

export function saveProgress(p: Progress): boolean {
  return write(PROGRESS_KEY, p);
}

/** Erases meta-progress and settings. Used by the Reset control in settings. */
export function resetAll(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(PROGRESS_KEY);
    s.removeItem(SETTINGS_KEY);
  } catch {
    // Storage is unavailable; nothing to clear.
  }
}
