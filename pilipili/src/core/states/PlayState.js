import { GameplayScene } from './GameplayScene.js';

/**
 * PlayState — the platforming run through the back room of Le PiliPili. Pure
 * config: which level, and "no boss here". All behaviour is inherited from
 * GameplayScene. Reaching data.bossArenaX hands off to BossState.
 */
export class PlayState extends GameplayScene {
  constructor(ctx) {
    super(ctx, { levelId: 'level_01_backroom', boss: false });
  }
}
