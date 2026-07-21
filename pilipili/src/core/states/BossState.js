import { GameplayScene } from './GameplayScene.js';
import { DjSkullBoss, wireBossFX } from '../../entities/boss/DjSkullBoss.js';
import { BeatClock } from '../../audio/BeatClock.js';
import { Shockwave } from '../../entities/boss/Shockwave.js';
import { FallingVinyl } from '../../entities/boss/FallingVinyl.js';
import { BOSS, EVENT } from '../../config/Constants.js';

/**
 * BossState — the DJ Skull Booth encounter.
 *
 * Reuses the whole GameplayScene interaction pipeline (contact damage, melee,
 * floor hazards) and adds three boss-specific wirings:
 *   1. a BeatClock, ticked in the fixed step so every attack is frame-perfect on
 *      the beat and deterministic;
 *   2. the boss entity + wireBossFX (its events → post/lighting/camera);
 *   3. spawners that turn the boss's BOSS_SHOCKWAVE / BOSS_VINYL events into real
 *      damaging projectile entities in the scene's interaction list.
 */
export class BossState extends GameplayScene {
  constructor(ctx) {
    super(ctx, { levelId: 'boss_arena', boss: true });
    this.beatClock = new BeatClock(ctx.bus, BOSS.BPM);
    this._won = 0;
  }

  setup(ctx) {
    // The music starts the fight's clock; the boss listens to EVENT.BEAT.
    ctx.audio.playMusic?.('boss');
    this.beatClock.start();

    this.boss = new DjSkullBoss(ctx, { x: 0, y: 4 });
    this._unwireFX = wireBossFX(ctx);

    // Boss attacks → concrete projectile entities the contact loop can resolve.
    this._offs.push(ctx.bus.on(EVENT.BOSS_SHOCKWAVE, (p) => this.entities.push(new Shockwave(ctx, p))));
    this._offs.push(ctx.bus.on(EVENT.BOSS_VINYL, (p) => this.entities.push(new FallingVinyl(ctx, p))));
    this._offs.push(ctx.bus.on(EVENT.BOSS_DEFEATED, () => { this._won = 3.0; }));
  }

  fixedUpdate(dt) {
    // Advance the beat BEFORE the boss reads it this step.
    this.beatClock.fixedUpdate(dt);
    if (this._won > 0) {
      this._won -= dt;
      this.ctx.clock.timeScale = Math.max(0.15, this._won / 3.0); // slow-mo victory
      if (this._won <= 0) {
        this.ctx.clock.timeScale = 1;
        this.ctx.goto('end', { outcome: 'win', tier: this.player?.tier ?? 0 });
      }
    }
    super.fixedUpdate(dt);
  }

  exit() {
    this.beatClock.stop();
    this._unwireFX?.();
    this.ctx.clock.timeScale = 1;
    super.exit();
  }
}
