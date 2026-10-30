import { describe, expect, it } from 'vitest';
import { EdgeBuffer } from '../src/core/edges';
import type { InputSnapshot } from '../src/core/input';

const quiet = (over: Partial<InputSnapshot> = {}): InputSnapshot => ({
  moveX: 0,
  moveY: 0,
  turnKeys: 0,
  lookDX: 0,
  lookDY: 0,
  fireHeld: false,
  fireJust: false,
  tearHeld: false,
  tearJust: false,
  tearReleased: false,
  dodgeJust: false,
  interactJust: false,
  pauseJust: false,
  confirmJust: false,
  restartJust: false,
  digitJust: 0,
  upJust: false,
  downJust: false,
  leftJust: false,
  rightJust: false,
  backJust: false,
  anyJust: false,
  ...over,
});

describe('edge buffer', () => {
  it('keeps a press across display frames that run no simulation step', () => {
    const buf = new EdgeBuffer();
    buf.record(quiet({ fireJust: true }));
    buf.record(quiet());
    buf.record(quiet());
    expect(buf.take()).toEqual({ fire: true, dodge: false, tearRelease: false });
    expect(buf.take()).toEqual({ fire: false, dodge: false, tearRelease: false });
  });

  it('merges presses that arrive before the next step, and clears on request', () => {
    const buf = new EdgeBuffer();
    buf.record(quiet({ dodgeJust: true }));
    buf.record(quiet({ tearReleased: true }));
    buf.clear();
    expect(buf.take()).toEqual({ fire: false, dodge: false, tearRelease: false });
    buf.record(quiet({ dodgeJust: true, tearReleased: true }));
    expect(buf.take()).toEqual({ fire: false, dodge: true, tearRelease: true });
  });
});
