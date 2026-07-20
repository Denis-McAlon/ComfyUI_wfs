import { EVENT } from '../config/Constants.js';

/**
 * StateMachine.js — a generic, hierarchical-friendly FSM used at two scales:
 *   1. GAME states  (Boot → CharacterSelect → Play → Boss → GameOver)
 *   2. ENTITY states (Player: Idle/Run/Airborne/Attack/Hurt; Boss: Phase1/2/3)
 *
 * A State is any object implementing a subset of:
 *   enter(payload, prevName)   exit(nextName)
 *   fixedUpdate(dt)            update(dt)   render(alpha)
 *   handleInput(input)
 * Missing hooks are simply skipped, so states stay as small as they need to be.
 *
 * Transitions are deferred to a safe point: calling `change()` inside a state's
 * update sets a pending target that is applied *after* the current hook returns,
 * so you never exit a state while iterating its own logic.
 */
export class StateMachine {
  /**
   * @param {Object<string, object>} states  name → state object
   * @param {{ bus?: import('./EventBus.js').EventBus, context?: any }} [opts]
   */
  constructor(states = {}, { bus = null, context = null } = {}) {
    this.states = states;
    this.bus = bus;
    this.context = context;      // shared ctx handed to every state
    this.current = null;
    this.currentName = null;
    this._pending = null;
    this.timeInState = 0;        // seconds since last transition (fixed time)
  }

  add(name, state) {
    this.states[name] = state;
    return this;
  }

  is(name) { return this.currentName === name; }

  /** Queue a transition. Applied at the next `_flush()` (end of the active hook). */
  change(name, payload = null) {
    if (!this.states[name]) throw new Error(`[FSM] unknown state "${name}"`);
    this._pending = { name, payload };
  }

  start(name, payload = null) {
    this._pending = { name, payload };
    this._flush();
  }

  _flush() {
    while (this._pending) {
      const { name, payload } = this._pending;
      this._pending = null;
      const prevName = this.currentName;
      if (this.current?.exit) this.current.exit(name);

      this.current = this.states[name];
      this.currentName = name;
      this.timeInState = 0;
      if (this.current.context === undefined) this.current.context = this.context;
      if (this.current.enter) this.current.enter(payload, prevName);
      this.bus?.emit(EVENT.STATE_CHANGE, { from: prevName, to: name });
    }
  }

  fixedUpdate(dt) {
    this.timeInState += dt;
    this.current?.fixedUpdate?.(dt);
    this._flush();
  }

  update(dt) {
    this.current?.update?.(dt);
    this._flush();
  }

  render(alpha) {
    this.current?.render?.(alpha);
  }

  handleInput(input) {
    this.current?.handleInput?.(input);
    this._flush();
  }
}
