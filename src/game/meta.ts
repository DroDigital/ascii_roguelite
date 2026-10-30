import type { Progress } from '../core/save';

/** What a finished run tells the meta layer. Built from the run director's summary. */
export interface RunOutcome {
  won: boolean;
  time: number;
  kills: number;
  upgrades: string[];
  combos: string[];
  visitedCistern: boolean;
  clearedReliquary: boolean;
  reachedBoss: boolean;
}

/** The unlock rules. Each entry names what it unlocks and what earns it. */
export const UNLOCK_RULES: ReadonlyArray<{ kind: 'weapons' | 'boons' | 'modifiers'; id: string; label: string; how: string; met: (p: Progress, o: RunOutcome) => boolean }> = [
  { kind: 'weapons', id: 'quill', label: 'Glyph Quill', how: 'Finish a run, win or lose.', met: (p) => p.runs >= 1 },
  { kind: 'boons', id: 'ash-ward', label: 'Ash Ward', how: 'Clear the Reliquary.', met: (_p, o) => o.clearedReliquary },
  { kind: 'boons', id: 'scribes-pouch', label: "Scribe's Pouch", how: 'Visit a Cistern.', met: (_p, o) => o.visitedCistern },
  { kind: 'boons', id: 'dust-step', label: 'Dust Step', how: 'Win a run.', met: (_p, o) => o.won },
  { kind: 'modifiers', id: 'ink-famine', label: 'Ink Famine', how: 'Win a run.', met: (_p, o) => o.won },
  { kind: 'modifiers', id: 'gilded-path', label: 'Gilded Path', how: 'Reach the Scribe.', met: (_p, o) => o.reachedBoss },
];

export interface OutcomeResult {
  progress: Progress;
  /** Labels of anything this run unlocked, for the end screen. */
  unlocked: string[];
}

/** Folds a finished run into meta-progress. Pure: returns a new Progress. */
export function applyOutcome(prev: Progress, o: RunOutcome): OutcomeResult {
  const p: Progress = {
    ...prev,
    unlocks: { weapons: [...prev.unlocks.weapons], boons: [...prev.unlocks.boons], modifiers: [...prev.unlocks.modifiers] },
    combos: [...new Set([...prev.combos, ...o.combos])],
    upgrades: [...new Set([...prev.upgrades, ...o.upgrades])],
    runs: prev.runs + 1,
    wins: prev.wins + (o.won ? 1 : 0),
    kills: prev.kills + o.kills,
    bestWinTime: o.won ? (prev.bestWinTime === null ? o.time : Math.min(prev.bestWinTime, o.time)) : prev.bestWinTime,
  };
  // Rules read the updated counts, so finishing the first run unlocks the Quill.
  const unlocked: string[] = [];
  for (const rule of UNLOCK_RULES) {
    const list = p.unlocks[rule.kind];
    if (list.includes(rule.id)) continue;
    if (rule.met(p, o)) {
      list.push(rule.id);
      unlocked.push(rule.label);
    }
  }
  return { progress: p, unlocked };
}

/** Whether a weapon, boon or modifier can be picked at the loadout. */
export function isUnlocked(p: Progress, kind: 'weapons' | 'boons' | 'modifiers', id: string): boolean {
  if (kind === 'weapons' && id === 'glaive') return true;
  return p.unlocks[kind].includes(id);
}
