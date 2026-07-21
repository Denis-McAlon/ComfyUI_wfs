import { EndScreen } from '../../ui/EndScreen.js';

/**
 * EndState — the victory / game-over screen. On entry it stamps the run into the
 * save system (best tier, fastest clear), then shows the outcome overlay with the
 * run's time and any new records. Continue returns to character select.
 */
export class EndState {
  constructor(ctx) { this.ctx = ctx; }

  enter(payload) {
    const outcome = payload?.outcome ?? 'lose';
    const tier = payload?.tier ?? 0;
    const timeMs = this.ctx.game.runTimeMs();
    const records = this.ctx.save.recordRun({ outcome, tier, timeMs });

    this.ui = new EndScreen(this.ctx, {
      outcome, tier, timeMs, records,
      best: { tier: this.ctx.save.get('bestTier'), timeMs: this.ctx.save.get('bestTimeMs') },
      onContinue: () => this.ctx.goto('select'),
    });
  }

  exit() { this.ui?.destroy(); this.ui = null; }
}
