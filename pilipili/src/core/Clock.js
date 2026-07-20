import { SIM } from '../config/Constants.js';

/**
 * Clock.js — decouples SIMULATION time from RENDER time.
 *
 * The golden rule of a platformer that feels the same on every machine: advance
 * the simulation in FIXED steps and render with interpolation. If you integrate
 * physics with a variable frame delta, jump height changes with frame rate and
 * the game is unplayable on someone else's laptop. (Glenn Fiedler, "Fix Your
 * Timestep!".)
 *
 * Usage per frame:
 *   const { steps, alpha } = clock.advance(performance.now());
 *   for (let i = 0; i < steps; i++) fixedUpdate(SIM.FIXED_DT);
 *   render(alpha); // alpha ∈ [0,1): how far between the last two sim states
 *
 * HITSTOP is handled here: while frozen, real time still elapses (render keeps
 * animating shaders) but no fixed steps are produced, so gameplay stands still
 * for those few impactful milliseconds on a big hit.
 */
export class Clock {
  constructor(fixedDt = SIM.FIXED_DT, maxSubsteps = SIM.MAX_SUBSTEPS) {
    this.fixedDt = fixedDt;
    this.maxSubsteps = maxSubsteps;
    this._accumulator = 0;
    this._lastMs = 0;
    this._hitstop = 0;      // seconds of frozen gameplay remaining
    this._timeScale = 1;    // global slow-mo hook (boss finisher, menus)
    this.elapsed = 0;       // total unfrozen sim seconds (for shader time, etc.)
    this.frameCount = 0;
    this._started = false;
  }

  reset(nowMs) {
    this._lastMs = nowMs;
    this._accumulator = 0;
    this._started = true;
  }

  /** Freeze gameplay for `seconds` while rendering continues. Stacks additively. */
  hitstop(seconds) {
    this._hitstop = Math.max(this._hitstop, seconds);
  }

  set timeScale(v) { this._timeScale = Math.max(0, v); }
  get timeScale() { return this._timeScale; }

  /**
   * @returns {{ steps: number, alpha: number, frameDt: number }}
   *   steps  — how many fixed sim steps to run this frame (0..maxSubsteps)
   *   alpha  — interpolation factor for rendering between sim states
   *   frameDt— real seconds since last frame (for render-only animation)
   */
  advance(nowMs) {
    if (!this._started) this.reset(nowMs);

    let frameDt = (nowMs - this._lastMs) / 1000;
    this._lastMs = nowMs;
    // Clamp pathological deltas (tab was backgrounded, GC pause) so we don't try
    // to simulate two seconds in one frame and spiral.
    if (frameDt > 0.25) frameDt = 0.25;

    // Burn hitstop first — it eats real time without producing sim steps.
    if (this._hitstop > 0) {
      const eaten = Math.min(this._hitstop, frameDt);
      this._hitstop -= eaten;
      frameDt -= eaten;
    }

    this._accumulator += frameDt * this._timeScale;

    let steps = 0;
    while (this._accumulator >= this.fixedDt && steps < this.maxSubsteps) {
      this._accumulator -= this.fixedDt;
      this.elapsed += this.fixedDt;
      steps++;
    }
    // If we hit the substep ceiling, drop the backlog rather than accrue debt.
    if (steps === this.maxSubsteps) this._accumulator = 0;

    this.frameCount++;
    return { steps, alpha: this._accumulator / this.fixedDt, frameDt };
  }
}
