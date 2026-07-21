import { CharacterSelectUI } from '../../ui/CharacterSelectUI.js';

/**
 * CharacterSelectState.js — the roster screen ("Choisis ton personnage").
 *
 * This state is a thin bridge between the FSM and the DOM menu (CharacterSelectUI).
 * It owns the UI's lifecycle and, crucially, the CONFIRM handoff:
 *
 *   1. record the chosen hero on the game so every downstream system reads it from
 *      one place (ctx.game.selectedCharacter);
 *   2. resume the audio context — this confirm click is the first trusted user
 *      gesture, and browsers won't let WebAudio start before one;
 *   3. transition into the play level, carrying the chosen character in the payload.
 *
 * Keyboard/gamepad navigation is OPTIONAL and, when the game loop is running, is
 * forwarded from the shared InputManager into the UI via handleInput(); the UI also
 * listens to the DOM directly so it works the instant it mounts (before start()).
 */
export class CharacterSelectState {
  constructor(ctx) {
    this.ctx = ctx;
    this.ui = null;
  }

  enter() {
    const ctx = this.ctx || this.context;
    this.ui = new CharacterSelectUI(ctx, {
      onConfirm: (id) => {
        // (1) Single source of truth for the chosen hero.
        ctx.game.selectedCharacter = id;
        // (2) Unlock audio on this first user gesture (safe-optional).
        ctx.audio?.resume?.();
        // (3) Into the back room, character in hand.
        ctx.goto('play', { character: id });
      },
    });
  }

  /** Forward the frame's input into the menu so pad/keys can drive selection. */
  handleInput(input) {
    this.ui?.handleInput?.(input);
  }

  exit() {
    this.ui?.destroy?.();
    this.ui = null;
  }
}
