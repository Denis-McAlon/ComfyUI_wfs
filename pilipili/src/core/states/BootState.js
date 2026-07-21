/**
 * BootState.js — the very first game state.
 *
 * By the time the FSM starts (Game.init → fsm.start('boot')), every heavy system
 * has already finished its async warmup (Rapier WASM, WebGL, audio decode) and
 * main.js is about to pull the `#boot` splash. So there is nothing left to *load*
 * here — Boot exists only as a clean, named entry point that immediately hands off
 * to the title card. Keeping it as its own state (rather than starting the FSM on
 * 'title' directly) means the flow diagram in Game.js stays honest and there's an
 * obvious home for a future studio sting / save-slot check.
 *
 * StateMachine passes the shared ctx two ways: our constructor receives it (Game
 * does `new BootState(this.ctx)`), and the FSM also assigns `this.context`. We read
 * whichever is present so the state is robust either way.
 */
export class BootState {
  constructor(ctx) {
    this.ctx = ctx;
  }

  enter() {
    const ctx = this.ctx || this.context;

    // A one-frame title, purely cosmetic. The splash (#boot) is still on top at this
    // instant and main.js removes it a tick later, so this is a no-op if absent.
    const splash = typeof document !== 'undefined' ? document.getElementById('boot') : null;
    if (splash) splash.textContent = 'LE PILIPILI';

    // Straight to the title card. The transition is deferred by the FSM to the end
    // of this hook, so it's safe to request it inline here.
    ctx.goto('title');
  }
}
