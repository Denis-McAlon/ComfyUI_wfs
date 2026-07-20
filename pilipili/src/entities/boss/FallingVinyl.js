import { Group, Mesh, CylinderGeometry, MeshStandardMaterial, Color } from 'three';
import { Entity } from '../Entity.js';
import { makeGlowMaterial } from '../../render/shaders/NeonMaterial.js';
import { BOSS, EVENT } from '../../config/Constants.js';

/**
 * FallingVinyl — a razor-edged record the DJ Skull hurls from above. It falls
 * (usually straight down, sometimes with lateral drift), spinning all the way,
 * and shatters when it reaches the arena floor. Hurts on contact; NOT harmable.
 */

// World Y of the boss-arena floor top: the disc shatters when it lands here.
const ARENA_FLOOR_Y = 0.2;
const LIFETIME = 6.0;              // s safety cull if it somehow misses the floor
const SPIN_SPEED = 9.0;            // rad/s
const RADIUS = 0.5;                // ~1u disc

export class FallingVinyl extends Entity {
  constructor(ctx, { x, y, vx = 0, vy = -14 } = {}) {
    super(x, y);
    this.type = 'vinyl-proj';
    this.ctx = ctx;

    // ── Interaction contract ────────────────────────────────────────────────
    this.hurtsPlayer = true;
    this.contactDamage = BOSS.CONTACT_DAMAGE;
    this.knockback = 6;
    this.harmable = false;

    this.vx = vx;
    this.vy = vy;
    this._age = 0;

    // ── View: a spinning dark disc with a crimson glowing label ─────────────
    this.view = new Group();
    const disc = new Mesh(
      new CylinderGeometry(RADIUS, RADIUS, 0.05, 28),
      new MeshStandardMaterial({ color: new Color(0x0a0a0d), emissive: new Color(0x180a0c), emissiveIntensity: 0.3, roughness: 0.4 }),
    );
    disc.rotation.x = Math.PI / 2;               // face the camera
    const label = new Mesh(new CylinderGeometry(0.17, 0.17, 0.06, 20), makeGlowMaterial(0xff1030, 0.95));
    label.rotation.x = Math.PI / 2;
    // Off-centre spindle mark so the spin reads on a round disc.
    const mark = new Mesh(new CylinderGeometry(0.035, 0.035, 0.07, 8), makeGlowMaterial(0xffd0d6, 0.9));
    mark.rotation.x = Math.PI / 2;
    mark.position.set(0.11, 0.11, 0);
    this.view.add(disc, label, mark);
    this.view.position.z = 0;
    ctx.renderer.scene.add(this.view);
  }

  fixedUpdate(dt) {
    this.snapshot();
    this._age += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += SPIN_SPEED * dt;

    if (this.y <= ARENA_FLOOR_Y || this._age >= LIFETIME) {
      this._shatter();
    }
  }

  aabb() {
    return { x: this.x, y: this.y, hw: RADIUS, hh: RADIUS };
  }

  _shatter() {
    // A small floor-impact kick for feel, only on a real landing (not the safety
    // cull). We deliberately do NOT emit EVENT.BOSS_VINYL — BossState listens to
    // that channel to SPAWN vinyls, so re-emitting would loop. No dedicated
    // shard-particle channel exists, so a tiny camera shake is the whole payload.
    if (this.y <= ARENA_FLOOR_Y) {
      this.ctx.bus.emit(EVENT.CAMERA_SHAKE, { trauma: 0.08 });
    }
    this.destroy();
  }
}
