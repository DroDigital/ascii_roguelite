import type { Mods } from './mods';

/** One swing of the glaive's three-hit combo. Times are in seconds. */
export interface SwingSpec {
  windup: number;
  active: number;
  recover: number;
  damage: number;
  /** Full arc angle in radians. */
  arc: number;
  range: number;
  knockback: number;
  /** Heavy finishing swing: wider, slower, and pulses distortion. */
  heavy: boolean;
}

export const GLAIVE_COMBO: readonly SwingSpec[] = [
  { windup: 0.14, active: 0.1, recover: 0.22, damage: 14, arc: (120 * Math.PI) / 180, range: 2.1, knockback: 0.6, heavy: false },
  { windup: 0.14, active: 0.1, recover: 0.22, damage: 16, arc: (120 * Math.PI) / 180, range: 2.1, knockback: 0.8, heavy: false },
  { windup: 0.22, active: 0.12, recover: 0.36, damage: 26, arc: (150 * Math.PI) / 180, range: 2.6, knockback: 2.2, heavy: true },
];

/** Seconds after a recovery in which the next press continues the combo. */
export const COMBO_WINDOW = 0.45;

export const QUILL = {
  cadence: 0.26,
  speed: 17,
  damage: 9,
  life: 1.2,
  /** Angle between bolts in a scatter, in radians. */
  fanSpread: (8 * Math.PI) / 180,
  /** Aim assist: a bolt bends by up to this angle toward an enemy near the view centre. */
  assistAngle: (6 * Math.PI) / 180,
} as const;

export type GlaivePhase = 'idle' | 'windup' | 'active' | 'recover';

export interface GlaiveState {
  phase: GlaivePhase;
  /** Seconds into the current phase. */
  t: number;
  /** Index of the swing in progress, or the last one performed. */
  index: number;
  /** Seconds left in the combo window after the last recovery. */
  comboLeft: number;
  /** A press is waiting to start the next swing. */
  buffered: boolean;
  /** Armed by a dodge. The next swing gets the riposte bonus. */
  riposteArmed: boolean;
  /** Enemy ids already struck by the current swing. */
  hitIds: Set<number>;
}

export function createGlaive(): GlaiveState {
  return {
    phase: 'idle',
    t: 0,
    index: 0,
    comboLeft: 0,
    buffered: false,
    riposteArmed: false,
    hitIds: new Set(),
  };
}

export interface ActiveSwing {
  spec: SwingSpec;
  index: number;
  /** 1.75 when the riposte bonus applies, otherwise 1. */
  damageMul: number;
  riposte: boolean;
}

export interface SwingEvents {
  /** Set on the tick a swing's active frames begin. The battle resolves hits then. */
  activeStarted: ActiveSwing | null;
  swingStarted: boolean;
}

/** The glaive's spec for a swing index, with upgrades applied. */
export function glaiveSpec(index: number, mods: Mods): SwingSpec {
  const base = GLAIVE_COMBO[index];
  return {
    ...base,
    arc: base.arc * mods.glaive.arcMul,
    range: base.range * mods.glaive.rangeMul,
    recover: base.recover * mods.glaive.recoverMul,
  };
}

/** The index the next swing will use, given the combo window. */
function nextIndex(g: GlaiveState): number {
  return g.comboLeft > 0 && g.index < GLAIVE_COMBO.length - 1 ? g.index + 1 : 0;
}

/**
 * Advances the glaive combo one fixed step. `fireJust` is a fresh press. Presses
 * are buffered, so a press during recovery starts the next swing as soon as the
 * recovery ends. `dodgedRecently` arms Riposte when the upgrade is owned.
 */
export function updateGlaive(g: GlaiveState, dt: number, fireJust: boolean, mods: Mods, dodgedRecently: boolean): SwingEvents {
  const events: SwingEvents = { activeStarted: null, swingStarted: false };
  if (dodgedRecently && mods.glaive.riposte) g.riposteArmed = true;
  if (g.comboLeft > 0) g.comboLeft = Math.max(0, g.comboLeft - dt);
  if (fireJust) g.buffered = true;

  const start = (index: number): void => {
    g.phase = 'windup';
    g.t = 0;
    g.index = index;
    g.hitIds.clear();
    g.buffered = false;
    events.swingStarted = true;
  };

  if (g.phase === 'idle' && g.buffered) start(nextIndex(g));

  if (g.phase !== 'idle') g.t += dt;
  if (g.phase === 'windup' && g.t >= glaiveSpec(g.index, mods).windup) {
    const spec = glaiveSpec(g.index, mods);
    g.phase = 'active';
    g.t -= spec.windup;
    const riposte = g.riposteArmed;
    g.riposteArmed = false;
    events.activeStarted = { spec, index: g.index, damageMul: riposte ? 1.75 : 1, riposte };
  }
  if (g.phase === 'active' && g.t >= glaiveSpec(g.index, mods).active) {
    g.phase = 'recover';
    g.t -= glaiveSpec(g.index, mods).active;
  }
  if (g.phase === 'recover' && g.t >= glaiveSpec(g.index, mods).recover) {
    if (g.buffered && g.index < GLAIVE_COMBO.length - 1) {
      start(g.index + 1);
    } else {
      g.phase = 'idle';
      g.t = 0;
      g.buffered = false;
      g.comboLeft = g.index < GLAIVE_COMBO.length - 1 ? COMBO_WINDOW : 0;
    }
  }
  return events;
}

export interface QuillState {
  cooldown: number;
}

export function createQuill(): QuillState {
  return { cooldown: 0 };
}

/** Number of bolts per shot and the angle between them. */
export function quillShot(mods: Mods): { count: number; spread: number } {
  const count = Math.max(1, mods.quill.fan);
  const spread = count > 1 ? QUILL.fanSpread * (mods.quill.starfall ? 1.6 : 1) : 0;
  return { count, spread };
}

/** Returns 1 on the tick a shot is released while the fire button is held, otherwise 0. */
export function updateQuill(q: QuillState, dt: number, fireHeld: boolean, mods: Mods): number {
  q.cooldown = Math.max(0, q.cooldown - dt);
  if (!fireHeld || q.cooldown > 0) return 0;
  q.cooldown = QUILL.cadence * mods.quill.cadenceMul;
  return 1;
}

/** Damage for one bolt, before armour and cores. */
export function quillBoltDamage(mods: Mods): number {
  return QUILL.damage * mods.quill.damageMul * mods.damageMul;
}
