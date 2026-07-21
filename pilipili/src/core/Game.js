import { SIM, EVENT, ACTIONS } from '../config/Constants.js';
import { EventBus } from './EventBus.js';
import { SaveSystem } from './SaveSystem.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { Clock } from './Clock.js';
import { StateMachine } from './StateMachine.js';
import { InputManager } from '../input/InputManager.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { Renderer } from '../render/Renderer.js';
import { AudioEngine } from '../audio/AudioEngine.js';

import { BootState } from './states/BootState.js';
import { TitleState } from './states/TitleState.js';
import { CharacterSelectState } from './states/CharacterSelectState.js';
import { PlayState } from './states/PlayState.js';
import { BossState } from './states/BossState.js';
import { EndState } from './states/EndState.js';

/**
 * Game.js — the conductor.
 *
 * Owns the cross-cutting systems (bus, clock, input, physics, renderer, audio)
 * and the top-level game-flow FSM. It runs ONE requestAnimationFrame loop and
 * enforces the fixed/render split; per-screen logic lives in the state objects,
 * which receive a shared `ctx` so they never construct systems themselves.
 *
 *   Boot → Title → CharacterSelect → Play → Boss → (win|GameOver) → CharacterSelect
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
    this.save = new SaveSystem();

    /** Chosen hero id ('male' | 'female'), set on the select screen. */
    this.selectedCharacter = 'male';
    /** clock.elapsed at which the current run started (select → play). */
    this._runStartElapsed = 0;

    /** Shared context handed to every state. The state contract IS this object. */
    this.ctx = {
      game: this,
      bus: this.bus,
      clock: this.clock,
      input: this.input,
      physics: this.physics,
      renderer: this.renderer,
      audio: this.audio,
      save: this.save,
      get scene() { return this.renderer.scene; },
      get camera() { return this.renderer.camera; },
      get cameraRig() { return this.renderer.cameraRig; },
      get postfx() { return this.renderer.postfx; },
      goto: (name, payload) => this.fsm.change(name, payload),
    };

    this.fsm = new StateMachine({}, { bus: this.bus, context: this.ctx });
    this._frame = this._frame.bind(this);
    this._running = false;
    this.paused = false;
    this._pauseUI = null;

    // A single, cheaply-wired reaction to the global hitstop event.
    this.bus.on(EVENT.HITSTOP, ({ seconds }) => this.clock.hitstop(seconds));

    // Start the run timer when a fresh run begins (select → first level).
    this.bus.on(EVENT.STATE_CHANGE, ({ from, to }) => {
      if (from === 'select' && to === 'play') this._runStartElapsed = this.clock.elapsed;
    });
  }

  async init() {
    // Physics + renderer + audio all have async warmup (WASM, GL, decode).
    await this.physics.init(SIM.WORLD_GRAVITY);
    await this.renderer.init();
    await this.audio.init();
    this.audio.setVolume?.(this.save.get('volume')); // restore saved volume
    this.input.attach(this.canvas);

    this.fsm
      .add('boot', new BootState(this.ctx))
      .add('title', new TitleState(this.ctx))
      .add('select', new CharacterSelectState(this.ctx))
      .add('play', new PlayState(this.ctx))
      .add('boss', new BossState(this.ctx))
      .add('end', new EndState(this.ctx));

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

    // Sample input FIRST so the pause toggle is caught even while paused.
    this.input.beginFrame();
    if (this.input.pressed(ACTIONS.PAUSE) && this._canPause()) this._togglePause();

    // While paused, clock.timeScale is 0, so advance() yields 0 steps with no
    // backlog and no reset trickery — sim time simply stands still, cleanly.
    const { steps, alpha, frameDt } = this.clock.advance(nowMs);

    if (!this.paused) {
      this.fsm.handleInput(this.input);

      // Fixed simulation — deterministic, frame-rate independent.
      for (let i = 0; i < steps; i++) {
        this.fsm.fixedUpdate(SIM.FIXED_DT);
        this.physics.step();               // world integrates dynamic bodies
        this.input.endFixedStep();         // decay coyote/buffer counters (in frames)
      }

      // Variable-rate render. ORDER MATTERS:
      //    a) render-only animation (particles, ui tweens, boss procedural motion)
      //    b) interpolate every entity's view toward its sim transform
      //    c) draw is below — camera follow, lighting tick, composer pass, once
      //       all views are already in their final position for this frame.
      this.fsm.update(frameDt);
      this.fsm.render(alpha);
    }

    // Draw every frame; while paused pass frameDt 0 so the frame is fully frozen
    // (no camera drift, no neon flicker) under the overlay.
    this.renderer.render(this.clock.elapsed, alpha, this.paused ? 0 : frameDt);

    this.input.endFrame();
    requestAnimationFrame(this._frame);
  }

  /** Pausing is only meaningful in a gameplay scene, not on menus. */
  _canPause() {
    return this.fsm.currentName === 'play' || this.fsm.currentName === 'boss';
  }

  _togglePause() {
    this.paused = !this.paused;
    this.clock.timeScale = this.paused ? 0 : 1;   // freeze / thaw simulation time
    if (this.paused) {
      if (!this._pauseUI) {
        this._pauseUI = new PauseMenu(this.ctx, {
          onResume: () => this._togglePause(),
          onRestart: () => { this._togglePause(); this._restart(); },
          onQuit: () => { this._togglePause(); this.fsm.change('select'); },
          onVolume: (v) => { this.audio.setVolume?.(v); this.save.set('volume', v); },
        });
      }
      this._pauseUI.show();
      this.audio.suspend?.();               // silence while paused
    } else {
      this._pauseUI?.hide();
      this.audio.resume?.();
    }
  }

  /** Restart the current gameplay scene from its spawn. */
  _restart() {
    const st = this.fsm.current;
    const character = st?.character ?? this.selectedCharacter;
    if (this.fsm.currentName === 'boss') this.fsm.change('boss', { character });
    else this.fsm.change('play', { character, levelId: st?.levelId });
  }

  /** Elapsed (unpaused) sim time of the current run, in ms. Used by the end screen. */
  runTimeMs() {
    return Math.max(0, (this.clock.elapsed - this._runStartElapsed) * 1000);
  }
}
