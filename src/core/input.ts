/** One frame of player intent. "Just" flags are true only on the frame the input began. */
export interface InputSnapshot {
  /** Strafe: -1 left (A), +1 right (D). */
  moveX: number;
  /** Walk: -1 back (S), +1 forward (W). */
  moveY: number;
  /** Turn with the arrow keys: -1 left, +1 right. */
  turnKeys: number;
  /** Mouse-look deltas in pixels since the last snapshot. */
  lookDX: number;
  lookDY: number;
  fireHeld: boolean;
  fireJust: boolean;
  tearHeld: boolean;
  tearJust: boolean;
  tearReleased: boolean;
  dodgeJust: boolean;
  interactJust: boolean;
  pauseJust: boolean;
  confirmJust: boolean;
  restartJust: boolean;
  /** 1, 2 or 3 when a digit key was pressed this frame, else 0. */
  digitJust: number;
  /** Menu navigation, true on the frame the key began. */
  upJust: boolean;
  downJust: boolean;
  leftJust: boolean;
  rightJust: boolean;
  /** Escape, for backing out of menus. */
  backJust: boolean;
  /** Any key or mouse button began this frame. Used to leave title-style screens. */
  anyJust: boolean;
}

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/**
 * Collects keyboard, mouse and pointer-lock state on a target element and
 * turns it into one snapshot per frame. Pointer lock is optional: arrow keys
 * still turn when the mouse is not captured.
 */
export class InputManager {
  private readonly held = new Set<string>();
  private readonly justDown = new Set<string>();
  private readonly mouseHeld = new Set<number>();
  private readonly mouseJust = new Set<number>();
  private readonly mouseUp = new Set<number>();
  private dx = 0;
  private dy = 0;
  private readonly listeners: Array<[EventTarget, string, EventListener]> = [];
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private readonly target: HTMLElement) {
    this.on(window, 'keydown', (e) => this.keyDown(e as KeyboardEvent));
    this.on(window, 'keyup', (e) => {
      const k = e as KeyboardEvent;
      this.held.delete(k.code);
    });
    this.on(window, 'blur', () => {
      this.held.clear();
      this.mouseHeld.clear();
    });
    this.on(target, 'mousedown', (e) => {
      const m = e as MouseEvent;
      this.mouseHeld.add(m.button);
      this.mouseJust.add(m.button);
    });
    this.on(window, 'mouseup', (e) => {
      const m = e as MouseEvent;
      this.mouseHeld.delete(m.button);
      this.mouseUp.add(m.button);
    });
    this.on(window, 'contextmenu', (e) => e.preventDefault());
    this.on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      const m = e as MouseEvent;
      this.dx += m.movementX;
      this.dy += m.movementY;
    });
    this.on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      this.onLockChange?.(this.locked);
    });
  }

  private on(t: EventTarget, type: string, fn: (e: Event) => void): void {
    t.addEventListener(type, fn);
    this.listeners.push([t, type, fn as EventListener]);
  }

  private keyDown(e: KeyboardEvent): void {
    if (PREVENT.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      this.justDown.add(e.code);
      this.anyKeyPressed = true;
    }
    this.held.add(e.code);
  }

  private anyKeyPressed = false;

  /** Asks the browser to capture the mouse for look. Must run from a user gesture. */
  captureMouse(): void {
    if (!this.locked) this.target.requestPointerLock?.();
  }

  releaseMouse(): void {
    if (this.locked) document.exitPointerLock?.();
  }

  private has(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  private just(...codes: string[]): boolean {
    return codes.some((c) => this.justDown.has(c));
  }

  /** Reads and clears the per-frame state. Call once per rendered frame. */
  snapshot(): InputSnapshot {
    const digit = this.just('Digit1') ? 1 : this.just('Digit2') ? 2 : this.just('Digit3') ? 3 : 0;
    const snap: InputSnapshot = {
      moveX: (this.has('KeyD') ? 1 : 0) - (this.has('KeyA') ? 1 : 0),
      moveY: (this.has('KeyW') ? 1 : 0) - (this.has('KeyS') ? 1 : 0),
      turnKeys: (this.has('ArrowRight') ? 1 : 0) - (this.has('ArrowLeft') ? 1 : 0),
      lookDX: this.dx,
      lookDY: this.dy,
      fireHeld: this.mouseHeld.has(0),
      fireJust: this.mouseJust.has(0),
      tearHeld: this.mouseHeld.has(2),
      tearJust: this.mouseJust.has(2),
      tearReleased: this.mouseUp.has(2),
      dodgeJust: this.just('Space', 'ShiftLeft', 'ShiftRight'),
      interactJust: this.just('KeyE'),
      pauseJust: this.just('KeyP', 'Escape'),
      confirmJust: this.just('Enter', 'NumpadEnter'),
      restartJust: this.just('KeyR'),
      digitJust: digit,
      upJust: this.just('ArrowUp', 'KeyW'),
      downJust: this.just('ArrowDown', 'KeyS'),
      leftJust: this.just('ArrowLeft', 'KeyA'),
      rightJust: this.just('ArrowRight', 'KeyD'),
      backJust: this.just('Escape', 'Backspace'),
      anyJust: this.anyKeyPressed || this.mouseJust.size > 0,
    };
    this.dx = 0;
    this.dy = 0;
    this.justDown.clear();
    this.mouseJust.clear();
    this.mouseUp.clear();
    this.anyKeyPressed = false;
    return snap;
  }

  dispose(): void {
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.listeners.length = 0;
  }
}
