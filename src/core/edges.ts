import type { InputSnapshot } from './input';

/** One-shot presses that no simulation step has consumed yet. */
export interface Edges {
  fire: boolean;
  dodge: boolean;
  tearRelease: boolean;
}

const EMPTY: Edges = { fire: false, dodge: false, tearRelease: false };

/**
 * Keeps edge-triggered input until a simulation step consumes it. Display frames
 * can run without a fixed step (above 60 Hz, or during hit-stop), so a press that
 * lands on such a frame would otherwise be lost.
 */
export class EdgeBuffer {
  private edges: Edges = { ...EMPTY };

  /** Adds this display frame's presses to the buffer. */
  record(snap: InputSnapshot): void {
    this.edges.fire ||= snap.fireJust;
    this.edges.dodge ||= snap.dodgeJust;
    this.edges.tearRelease ||= snap.tearReleased;
  }

  /** Returns the buffered presses and clears them. Call only when a simulation step is about to run. */
  take(): Edges {
    const out = this.edges;
    this.edges = { ...EMPTY };
    return out;
  }

  clear(): void {
    this.edges = { ...EMPTY };
  }
}
