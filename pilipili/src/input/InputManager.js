import { ACTIONS } from '../config/Constants.js';

/**
 * InputManager.js — turns raw keyboard/gamepad into stable, buffered ACTIONS.
 *
 * The gameplay code never reads a key code. It asks: is JUMP held? was ATTACK
 * pressed this frame? was JUMP pressed within the last 6 fixed steps (buffer)?
 * That indirection is what lets us support keyboard + gamepad + future remap
 * without touching the Player, and it's where the "jump buffer" half of the
 * telepathic-jump feel is measured — in FIXED STEPS, not wall time.
 */

const KEYBOARD = {
  ArrowLeft: ACTIONS.LEFT, KeyA: ACTIONS.LEFT,
  ArrowRight: ACTIONS.RIGHT, KeyD: ACTIONS.RIGHT,
  ArrowUp: ACTIONS.UP, KeyW: ACTIONS.UP,
  ArrowDown: ACTIONS.DOWN, KeyS: ACTIONS.DOWN,
  Space: ACTIONS.JUMP, KeyZ: ACTIONS.JUMP, KeyK: ACTIONS.JUMP,
  KeyX: ACTIONS.ATTACK, KeyJ: ACTIONS.ATTACK, KeyL: ACTIONS.ATTACK,
  ShiftLeft: ACTIONS.DASH, KeyC: ACTIONS.DASH,
  Escape: ACTIONS.PAUSE, KeyP: ACTIONS.PAUSE,
  Enter: ACTIONS.CONFIRM,
};

// Standard Gamepad mapping (Xbox layout): button index → action.
const GAMEPAD_BUTTONS = {
  0: ACTIONS.JUMP,     // A
  2: ACTIONS.ATTACK,   // X
  5: ACTIONS.DASH, 7: ACTIONS.DASH, // RB / RT
  9: ACTIONS.PAUSE,    // Start
  12: ACTIONS.UP, 13: ACTIONS.DOWN, 14: ACTIONS.LEFT, 15: ACTIONS.RIGHT, // D-pad
  1: ACTIONS.CONFIRM,  // B as confirm on menus
};
const STICK_DEADZONE = 0.35;

export class InputManager {
  constructor(bus) {
    this.bus = bus;
    this._held = new Set();       // actions currently down (kb ∪ pad)
    this._prevHeld = new Set();   // last frame's held, for edge detection
    this._pressed = new Set();    // went down THIS frame
    this._released = new Set();   // went up THIS frame
    this._rawKeys = new Set();    // raw keyboard actions from events
    this._pressLatch = new Set(); // down-edges seen since the last sample (sub-frame taps)

    this._fixedStep = 0;                 // monotonically increasing fixed-step id
    this._bufferStamp = new Map();       // action → fixedStep when last pressed
    this.axis = { x: 0, y: 0 };          // analog movement (-1..1), kb is quantized

    this._padIndex = null;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPadConnect = (e) => { this._padIndex = e.gamepad.index; };
    this._onPadDisconnect = () => { this._padIndex = null; };
  }

  attach(target = window) {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('gamepadconnected', this._onPadConnect);
    window.addEventListener('gamepaddisconnected', this._onPadDisconnect);
    // Clear stuck keys if focus is lost (alt-tab mid-jump would otherwise stick).
    window.addEventListener('blur', () => { this._rawKeys.clear(); this._pressLatch.clear(); });
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('gamepadconnected', this._onPadConnect);
    window.removeEventListener('gamepaddisconnected', this._onPadDisconnect);
  }

  _onKeyDown(e) {
    const a = KEYBOARD[e.code];
    if (a) {
      if (!e.repeat) this._pressLatch.add(a); // latch the down-edge so a tap shorter than a frame still fires
      this._rawKeys.add(a);
      if (a === ACTIONS.JUMP || a === ACTIONS.PAUSE) e.preventDefault();
    }
  }
  _onKeyUp(e) {
    const a = KEYBOARD[e.code];
    if (a) this._rawKeys.delete(a);
  }

  /** Called once at the top of each render frame: merge sources, latch edges. */
  beginFrame() {
    // Merge keyboard + gamepad into the current held set.
    this._held = new Set(this._rawKeys);
    this.axis.x = 0; this.axis.y = 0;
    this._pollGamepad();

    // Keyboard axis (quantized) if the pad didn't provide one.
    if (this.axis.x === 0) {
      if (this._held.has(ACTIONS.LEFT)) this.axis.x -= 1;
      if (this._held.has(ACTIONS.RIGHT)) this.axis.x += 1;
    }
    if (this.axis.y === 0) {
      if (this._held.has(ACTIONS.DOWN)) this.axis.y -= 1;
      if (this._held.has(ACTIONS.UP)) this.axis.y += 1;
    }

    // Edge detection.
    this._pressed.clear();
    this._released.clear();
    for (const a of this._held) if (!this._prevHeld.has(a)) this._pressed.add(a);
    for (const a of this._prevHeld) if (!this._held.has(a)) this._released.add(a);
    // Fold in sub-frame taps: a key pressed AND released between two samples never
    // enters `_held`, so the held-edge above would miss it. The keydown handler
    // latched it — honour it here so a fast tap (or a slow frame) never eats input.
    for (const a of this._pressLatch) this._pressed.add(a);
    this._pressLatch.clear();
    for (const a of this._pressed) this._bufferStamp.set(a, this._fixedStep);

    this._prevHeld = new Set(this._held);
  }

  _pollGamepad() {
    if (this._padIndex == null || !navigator.getGamepads) return;
    const pad = navigator.getGamepads()[this._padIndex];
    if (!pad) return;
    // Left stick → analog axis (+Y up, so invert the pad's downward-positive Y).
    const lx = pad.axes[0] ?? 0, ly = pad.axes[1] ?? 0;
    if (Math.abs(lx) > STICK_DEADZONE) { this.axis.x = lx; this._held.add(lx < 0 ? ACTIONS.LEFT : ACTIONS.RIGHT); }
    if (Math.abs(ly) > STICK_DEADZONE) { this.axis.y = -ly; this._held.add(ly < 0 ? ACTIONS.UP : ACTIONS.DOWN); }
    for (const [idx, action] of Object.entries(GAMEPAD_BUTTONS)) {
      if (pad.buttons[idx]?.pressed) this._held.add(action);
    }
  }

  /** Called after EACH fixed sim step: advances the buffer clock. */
  endFixedStep() { this._fixedStep++; }

  /** Called at the end of the render frame. */
  endFrame() {}

  // ---- Query API used by gameplay ----
  held(action) { return this._held.has(action); }
  pressed(action) { return this._pressed.has(action); }
  released(action) { return this._released.has(action); }

  /**
   * True if `action` was pressed within the last `withinFrames` FIXED steps and
   * has not yet been consumed. On a match it consumes the stamp so a single
   * press can't fire twice. This IS the jump-buffer.
   */
  consumeBuffered(action, withinFrames) {
    const stamp = this._bufferStamp.get(action);
    if (stamp == null) return false;
    if (this._fixedStep - stamp <= withinFrames) {
      this._bufferStamp.delete(action);
      return true;
    }
    return false;
  }

  /** Horizontal intent, -1..1. */
  moveX() { return this.axis.x; }
  moveY() { return this.axis.y; }
}
