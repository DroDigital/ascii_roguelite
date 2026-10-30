import type { Rng } from '../core/rng';
import { type Layout, type Side } from './tiles';
import { type RoomKind } from './templates';
import { type LayoutOptions, generateLayout } from './layout';

/** One room a player can choose from when walking through a door. */
export interface RouteOption {
  templateId: string;
  kind: RoomKind;
  label: string;
  blurb: string;
}

/**
 * The branching route. Stage 0 is the nave. Stages 1–3 each offer two doors,
 * and stage 4 is the reliquary. Stage 5 is the boss arena. Each stage's exits
 * lead to the next stage's options.
 */
export const STAGE_OPTIONS: readonly (readonly RouteOption[])[] = [
  [
    { templateId: 'hall-of-hooks', kind: 'combat', label: 'Hall of Hooks', blurb: 'husks and an acolyte' },
    { templateId: 'stacks', kind: 'combat', label: 'The Stacks', blurb: 'a bulwark among the shelves' },
  ],
  [
    { templateId: 'choir', kind: 'combat', label: 'The Choir', blurb: 'acolytes and husks' },
    { templateId: 'cistern', kind: 'cistern', label: 'The Cistern', blurb: 'mend, or attune for a rare gift' },
  ],
  [
    { templateId: 'ossuary', kind: 'combat', label: 'The Ossuary', blurb: 'bulwarks and husks' },
    { templateId: 'lectern-gallery', kind: 'combat', label: 'Lectern Gallery', blurb: 'a swarm with acolytes' },
  ],
];

export const RELIQUARY_OPTION: RouteOption = {
  templateId: 'reliquary',
  kind: 'reliquary',
  label: 'The Reliquary',
  blurb: 'a gilded elite guards a rare gift',
};

export const BOSS_OPTION: RouteOption = {
  templateId: 'boss-arena',
  kind: 'boss',
  label: 'The Scribe’s Arena',
  blurb: 'the Scribe of Nine Seals',
};

/** Number of stages before the boss: nave, three choice stages, reliquary. */
export const STAGE_COUNT = 6;

/** Options offered by a stage. Stage 0 is the nave itself, which has no choice. */
export function optionsForStage(stage: number): readonly RouteOption[] {
  if (stage >= 1 && stage <= 3) return STAGE_OPTIONS[stage - 1];
  if (stage === 4) return [RELIQUARY_OPTION];
  if (stage === 5) return [BOSS_OPTION];
  return [];
}

/** Exits a room at this stage has: the number of doors leading onward. */
export function exitCountForStage(stage: number): number {
  if (stage === 0 || stage === 1 || stage === 2) return 2;
  if (stage === 3 || stage === 4) return 1;
  return 0;
}

export function oppositeSide(side: Side): Side {
  switch (side) {
    case 'N':
      return 'S';
    case 'S':
      return 'N';
    case 'E':
      return 'W';
    case 'W':
      return 'E';
  }
}

export interface RoomPlan {
  stage: number;
  option: RouteOption;
  layout: Layout;
}

/** Builds the room for a stage, entered through the door on `entrySide`. */
export function planRoom(stage: number, option: RouteOption, entrySide: Side | null, rng: Rng): RoomPlan {
  const opts: LayoutOptions = { entrySide, exitCount: exitCountForStage(stage) };
  return { stage, option, layout: generateLayout(option.templateId, rng, opts) };
}

/** The door leading to exit `index` in a finished layout. */
export function exitDoor(layout: Layout, index: number): Layout['doors'][number] {
  const door = layout.doors.find((d) => d.role === 'exit' && d.exitIndex === index);
  if (!door) throw new Error(`Layout ${layout.templateId} has no exit ${index}`);
  return door;
}
