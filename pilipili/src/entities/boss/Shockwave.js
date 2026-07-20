import { Group, Mesh, TorusGeometry } from 'three';
import { Entity } from '../Entity.js';
import { makeGlowMaterial } from '../../render/shaders/NeonMaterial.js';
import { BOSS } from '../../config/Constants.js';

/**
 * Shockwave — a crimson soundwave the DJ Skull slams across the floor on the
 * downbeat. It rolls horizontally along the ground and hurts on contact, but it
 * is deliberately LOW so a well-timed jump clears it. NOT harmable — you dodge
 * it, you do not fight it.
 *
 * The boss emits it from its booth (at mouth height, ~this.y - 1.5); we pin the
 * wave to the arena floor band so what you SEE and what HITS you are the same low
 * strip. It self-destructs after a lifetime or once it rolls off the arena.
 */

// The boss-arena floor top (world Y). Matches FallingVinyl's ARENA_FLOOR_Y so the
// wave hugs the ground regardless of the (higher) emit height it was fired from.
const ARENA_FLOOR_Y = 0.2;

const HW = 0.5;
const HH = 0.6;                    // low enough to jump over (player apex is 3.2u)
const LIFETIME = 4.0;              // s before it fizzles
const MAX_TRAVEL = 40;             // units from origin before it fizzles
const PULSE_HZ = 9.0;              // visual throb rate

export class Shockwave extends Entity {
  constructor(ctx, { x, y, dir = 1, speed = 11 } = {}) {
    // Pin the sim Y to the floor band (ignoring the booth-mouth emit Y) so the
    // view and the hurtbox agree and the wave truly travels "along the ground".
    super(x, ARENA_FLOOR_Y + HH);
    this.type = 'shockwave';
    this.ctx = ctx;

    // ── Interaction contract ────────────────────────────────────────────────
    this.hurtsPlayer = true;
    this.contactDamage = BOSS.CONTACT_DAMAGE;
    this.knockback = 8;
    this.harmable = false;

    this.dir = Math.sign(dir) || 1;
    this.speed = speed;
    this._originX = x;
    this._age = 0;

    // ── View: a crimson neon half-ring arch that pulses ─────────────────────
    this.view = new Group();
    this._ring = new Mesh(
      new TorusGeometry(0.5, 0.08, 10, 28, Math.PI), // half-torus = a cresting arch
      makeGlowMaterial(0xff1030, 0.95),
    );
    this.view.add(this._ring);
    this.view.position.z = 0;
    ctx.renderer.scene.add(this.view);
  }

  fixedUpdate(dt) {
    this.snapshot();
    this._age += dt;
    this.x += this.dir * this.speed * dt;
    if (this._age >= LIFETIME || Math.abs(this.x - this._originX) > MAX_TRAVEL) {
      this.destroy();
    }
  }

  aabb() {
    return { x: this.x, y: this.y, hw: HW, hh: HH };
  }

  update() {
    if (!this._ring) return;
    // Throb the ring's size and brightness so the wave reads as energetic.
    const pulse = 1 + 0.12 * Math.sin(this._age * PULSE_HZ);
    this._ring.scale.set(pulse, pulse, pulse);
    this._ring.material.emissiveIntensity = 3.0 * (0.8 + 0.2 * Math.sin(this._age * PULSE_HZ * 1.3 + 1));
  }
}
