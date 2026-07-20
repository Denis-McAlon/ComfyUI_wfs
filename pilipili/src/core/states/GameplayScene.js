import { Player } from '../../entities/Player.js';
import { buildHeroView } from '../../config/Characters.js';
import { Level } from '../../world/Level.js';
import { HUD } from '../../ui/HUD.js';
import { IceCube } from '../../entities/enemies/IceCube.js';
import { DrunkPatron } from '../../entities/enemies/DrunkPatron.js';
import { BrokenGlass } from '../../entities/hazards/BrokenGlass.js';
import { Collectible } from '../../entities/Collectible.js';
import { ParticleSystem } from '../../fx/ParticleSystem.js';
import { GROWTH, GLASS, ICE, BOSS, EVENT } from '../../config/Constants.js';

/**
 * GameplayScene — the workhorse behind both the platforming level and the boss
 * arena. It owns the player + an entity list and resolves ALL interactions each
 * fixed step through one small, uniform contract that every entity opts into:
 *
 *   aabb() → {x,y,hw,hh}
 *   hurtsPlayer / contactDamage / knockback        contact damage TO the player
 *   harmable / onPlayerHit({damage,knockback,...})  response to the player's melee
 *   pickup / kind / charge                          collectibles (growth)
 *   floorHazard / contains(x,feetY) / dotPerSecond / slowMult   broken glass
 *   iceZone / slickAt(x)                            zero-friction floor
 *
 * Because interaction lives HERE (not smeared across entities), adding an enemy
 * is just a new file that sets a few flags — the scene already knows what to do
 * with it. Subclasses (PlayState, BossState) only choose the level and any
 * scene-specific spawns.
 */
const overlap = (a, b) =>
  Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh;

const ENEMY_CTOR = { ice: IceCube, drunk: DrunkPatron };

export class GameplayScene {
  constructor(ctx, { levelId, boss = false } = {}) {
    this.ctx = ctx;
    this.levelId = levelId;
    this.isBossScene = boss;
    this.entities = [];
    this.hazards = [];
    this.player = null;
    this.boss = null;
    this.lives = 3;
    this._offs = [];
    this._glassTick = 0;
    this._deadTimer = 0;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  enter(payload) {
    const ctx = this.ctx;
    this.character = payload?.character || ctx.game.selectedCharacter;

    // Build the level (static geometry + neon meshes) and read spawn data.
    this.level = new Level(ctx);
    this.data = this.level.load(this.levelId);

    // Player.
    this.player = new Player(ctx, { x: this.data.spawn.x, y: this.data.spawn.y, character: this.character });
    this.player.view = buildHeroView(this.character);
    ctx.renderer.scene.add(this.player.view);
    ctx.player = this.player;                 // boss + camera read this
    ctx.cameraRig.follow(this.player);

    // Spawns from level data.
    for (const e of this.data.enemies || []) {
      const Ctor = ENEMY_CTOR[e.type];
      if (Ctor) this.entities.push(new Ctor(ctx, e));
    }
    for (const p of this.data.pickups || []) this.entities.push(new Collectible(ctx, p));
    for (const h of this.data.hazards || []) {
      const g = new BrokenGlass(ctx, h);
      this.hazards.push(g); this.entities.push(g);
    }

    // HUD + particles (particles self-wire to bus events; scene just ticks them).
    this.hud = new HUD(ctx);
    this.hud.setHealth(this.player.health, 5);
    this.particles = new ParticleSystem(ctx);

    // Wire interaction events.
    this._offs.push(ctx.bus.on(EVENT.PLAYER_ATTACK, (hit) => this._resolveMelee(hit)));
    this._offs.push(ctx.bus.on(EVENT.PLAYER_DIED, () => { this._deadTimer = 1.2; }));

    this.setup?.(ctx); // subclass hook (boss spawns its encounter here)
  }

  exit() {
    this._offs.forEach((o) => o());
    this._offs.length = 0;
    for (const e of this.entities) e.destroy?.();
    this.entities.length = 0;
    this.boss?.destroy?.();
    this.player?.destroy?.();
    this.level?.unload?.();
    this.hud?.destroy?.();
    this.particles?.destroy?.();
    this.ctx.player = null;
  }

  // ── Fixed simulation ────────────────────────────────────────────────────────

  fixedUpdate(dt) {
    if (this._deadTimer > 0) { this._handleDeath(dt); return; }

    this.player.fixedUpdate(dt);
    this._applyFloor(dt);          // ice + glass modify traction & deal DoT
    this.boss?.fixedUpdate(dt);

    for (const e of this.entities) if (e.alive) e.fixedUpdate?.(dt);
    this._resolveContacts();
    this._cull();

    // Reach the arena → drop into the boss fight.
    if (!this.isBossScene && this.data.bossArenaX != null && this.player.x >= this.data.bossArenaX) {
      this.ctx.goto('boss', { character: this.character });
    }
    this.hud.setHealth(this.player.health, 5);
    this.hud.setGrowth?.(this.player.charge, this.player.tier, GROWTH.CHARGE_MAX);
    if (this.boss) {
      this.hud.showBoss?.(true);
      this.hud.setBoss?.(this.boss.health, BOSS.MAX_HEALTH);
    }
  }

  _applyFloor() {
    const feet = this.player.motor.feetY;
    let mult = 1;
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (e.iceZone && e.slickAt?.(this.player.x)) mult = Math.min(mult, ICE.PLAYER_TRACTION_ON_ICE);
    }
    let onGlass = false;
    for (const g of this.hazards) {
      if (g.alive && g.contains?.(this.player.x, feet)) { onGlass = true; mult = Math.min(mult, g.slowMult ?? GLASS.SLOW_MULT); }
    }
    this.player.tractionMultiplier = mult;

    // Glass damage-over-time on a fixed cadence.
    if (onGlass) {
      this._glassTick += this.ctx.clock.fixedDt;
      if (this._glassTick >= GLASS.TICK_INTERVAL) {
        this._glassTick = 0;
        this.player.takeDoT(GLASS.DOT_PER_SECOND * GLASS.TICK_INTERVAL);
      }
    } else {
      this._glassTick = 0;
    }
  }

  _resolveContacts() {
    const pa = this._playerAabb();
    // Contact damage + pickups from the entity list…
    for (const e of this.entities) {
      if (!e.alive || !e.aabb) continue;
      if (!overlap(pa, e.aabb())) continue;
      if (e.pickup) {
        this.player.addGrowth(e.charge ?? 1);
        this.ctx.bus.emit(EVENT.PICKUP_COLLECTED, { kind: e.kind });
        e.destroy();
      } else if (e.hurtsPlayer) {
        this.player.takeHit({
          damage: e.contactDamage ?? 1,
          knockbackX: Math.sign(this.player.x - e.x || 1) * (e.knockback ?? 6),
          knockbackY: 5,
        });
      }
    }
    // …and from the boss body.
    if (this.boss?.alive && this.boss.hurtsPlayer && overlap(pa, this.boss.aabb())) {
      this.player.takeHit({
        damage: this.boss.contactDamage, knockbackY: 6,
        knockbackX: Math.sign(this.player.x - this.boss.x || 1) * this.boss.knockback,
      });
    }
  }

  _resolveMelee(hit) {
    const box = { x: hit.x, y: hit.y, hw: hit.hw, hh: hit.hh };
    for (const e of this.entities) {
      if (e.alive && e.harmable && e.aabb && overlap(box, e.aabb())) {
        const killed = e.onPlayerHit?.({ damage: hit.damage, knockback: hit.knockback, facing: hit.facing });
        if (killed) this.ctx.bus.emit(EVENT.ENEMY_KILLED, { type: e.type, x: e.x, y: e.y });
      }
    }
    if (this.boss?.alive && this.boss.harmable && overlap(box, this.boss.aabb())) {
      this.boss.onPlayerHit({ damage: hit.damage });
    }
  }

  _handleDeath(dt) {
    this._deadTimer -= dt;
    if (this._deadTimer > 0) return;
    if (--this.lives <= 0) { this.ctx.goto('select'); return; }
    this.player.respawn(this.data.spawn.x, this.data.spawn.y);
  }

  _cull() {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      if (!this.entities[i].alive) this.entities.splice(i, 1);
    }
  }

  _playerAabb() {
    return { x: this.player.x, y: this.player.y, hw: this.player.motor.hx, hh: this.player.motor.hy };
  }

  // ── Render frame ─────────────────────────────────────────────────────────────

  update(frameDt) {
    this.player?.update?.(frameDt);
    this.boss?.update?.(frameDt);
    for (const e of this.entities) e.update?.(frameDt);
    this.particles?.update(frameDt);
  }

  render(alpha) {
    this.player?.syncView(alpha);
    this.boss?.syncView(alpha);
    for (const e of this.entities) e.syncView?.(alpha);
  }
}
