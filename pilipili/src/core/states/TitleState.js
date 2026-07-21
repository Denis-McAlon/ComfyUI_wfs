import { TitleScreen } from '../../ui/TitleScreen.js';

/**
 * TitleState.js — the front-door screen ("LE PILIPILI").
 *
 * A thin bridge between the FSM and the DOM title card (TitleScreen), mirroring
 * CharacterSelectState: it owns the overlay's lifecycle and forwards the frame's
 * input so keyboard/gamepad can enter once the loop is running. Confirming here
 * unlocks audio on this first trusted gesture and moves on to character select.
 */
export class TitleState {
  constructor(ctx) {
    this.ctx = ctx;
    this.ui = null;
  }

  enter() {
    const ctx = this.ctx || this.context;
    this.ui = new TitleScreen(ctx, {
      onStart: () => {
        // First trusted user gesture — a safe place to unlock WebAudio early.
        ctx.audio?.resume?.();
        ctx.goto('select');
      },
    });
  }

  /** Forward the frame's input into the title card so pad/keys can enter. */
  handleInput(input) {
    this.ui?.handleInput?.(input);
  }

  exit() {
    this.ui?.destroy?.();
    this.ui = null;
  }
}
