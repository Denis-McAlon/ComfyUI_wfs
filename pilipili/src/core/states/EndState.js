import { EndScreen } from '../../ui/EndScreen.js';

/**
 * EndState — the victory / game-over screen. A pure menu screen: it shows the
 * outcome overlay and, on continue, returns to character select. The previous
 * gameplay scene has already torn itself down, so only the neon backdrop renders
 * behind the overlay.
 */
export class EndState {
  constructor(ctx) { this.ctx = ctx; }

  enter(payload) {
    this.ui = new EndScreen(this.ctx, {
      outcome: payload?.outcome ?? 'lose',
      tier: payload?.tier ?? 0,
      onContinue: () => this.ctx.goto('select'),
    });
  }

  exit() { this.ui?.destroy(); this.ui = null; }
}
