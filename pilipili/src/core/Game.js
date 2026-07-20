import { SIM, EVENT } from '../config/Constants.js';
import { EventBus } from './EventBus.js';
import { Clock } from './Clock.js';
import { StateMachine } from './StateMachine.js';
import { InputManager } from '../input/InputManager.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { Renderer } from '../render/Renderer.js';
import { AudioEngine } from '../audio/AudioEngine.js';

import { BootState } from './states/BootState.js';
import { CharacterSelectState } from './states/CharacterSelectState.js';
import { PlayState } from './states/PlayState.js';
import { BossState } from './states/BossState.js';

/**
 * Game.js — the conductor.
 *
 * Owns the cross-cutting systems (bus, clock, input, physics, renderer, audio)
 * and the top-level game-flow FSM. It runs ONE requestAnimationFrame loop and
 * enforces the fixed/render split; per-screen logic lives in the state objects,
 * which receive a shared `ctx` so they never construct systems themselves.
 *
 *   Boot → CharacterSelect → Play → Boss → (win|GameOver) → CharacterSelect
 */
export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.bus = new EventBus();
    this.clock = new Clock();
    this.input = new InputManager(this.bus);
    this.physics = new PhysicsWorld();
    this.renderer = new Renderer(canvas, this.bus);
    this.audio = new AudioEngine(this.bus);

    /** Chosen hero id ('male' | 'female'), set on the select screen. */
    this.selectedCharacter = 'male';

    /** Shared context handed to every state. The state contract IS this object. */
    this.ctx = {
      game: this,
      bus: this.bus,
      clock: this.clock,
      input: this.input,
      physics: this.physics,
      renderer: this.renderer,
      audio: this.audio,
      get scene() { return this.renderer.scene; },
      get camera() { return this.renderer.camera; },
      get cameraRig() { return this.renderer.cameraRig; },
      get postfx() { return this.renderer.postfx; },
      goto: (name, payload) => this.fsm.change(name, payload),
    };

    this.fsm = new StateMachine({}, { bus: this.bus, context: this.ctx });
    this._frame = this._frame.bind(this);
    this._running = false;

    // A single, cheaply-wired reaction to the global hitstop event.
    this.bus.on(EVENT.HITSTOP, ({ seconds }) => this.clock.hitstop(seconds));
  }

  async init() {
    // Physics + renderer + audio all have async warmup (WASM, GL, decode).
    await this.physics.init(SIM.WORLD_GRAVITY);
    await this.renderer.init();
    await this.audio.init();
    this.input.attach(this.canvas);

    this.fsm
      .add('boot', new BootState(this.ctx))
      .add('select', new CharacterSelectState(this.ctx))
      .add('play', new PlayState(this.ctx))
      .add('boss', new BossState(this.ctx));

    this.fsm.start('boot');
  }

  start() {
    if (this._running) return;
    this._running = true;
    this.clock.reset(performance.now());
    requestAnimationFrame(this._frame);
  }

  stop() { this._running = false; }

  _frame(nowMs) {
    if (!this._running) return;

    const { steps, alpha, frameDt } = this.clock.advance(nowMs);

    // 1) Sample input ONCE per frame; buffers are edge-latched here.
    this.input.beginFrame();
    this.fsm.handleInput(this.input);

    // 2) Fixed simulation — deterministic, frame-rate independent.
    for (let i = 0; i < steps; i++) {
      this.fsm.fixedUpdate(SIM.FIXED_DT);
      this.physics.step();                 // world integrates dynamic bodies
      this.input.endFixedStep();           // decay coyote/buffer counters (in frames)
    }

    // 3) Variable-rate render. ORDER MATTERS:
    //    a) render-only animation (particles, ui tweens, boss procedural motion)
    //    b) interpolate every entity's view toward its sim transform
    //    c) draw LAST — camera follow, lighting tick, and the composer pass, once
    //       all views are already in their final position for this frame.
    this.fsm.update(frameDt);
    this.fsm.render(alpha);
    this.renderer.render(this.clock.elapsed, alpha, frameDt);

    this.input.endFrame();
    requestAnimationFrame(this._frame);
  }
}
