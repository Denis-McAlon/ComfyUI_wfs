import { Group, Mesh, CapsuleGeometry, MeshStandardMaterial, Color } from 'three';
import { Entity } from '../Entity.js';
import { makeGlowMaterial } from '../../render/shaders/NeonMaterial.js';
import { DRUNK } from '../../config/Constants.js';

/**
 * DrunkPatron — a club-goer who has had three too many. He lurches back and forth
 * on a sine-wave stagger, occasionally LUNGES in a random stumble, and damages
 * the player on contact. Two solid melee hits put him down; one just spins him.
 *
 * Bodyless transform-mover, clamped to his spawn floor Y and a patrol range. His
 * signature is the STUMBLING HITBOX: mid-lunge his hurtbox stretches forward in
 * his facing direction, so the drunk who looked harmless suddenly has reach.
 */

const START_HP = 2;

// Hurtbox half-extents: normal, and the extended "lunging" width.
const HW_NORMAL = 0.5;
const HW_LUNGE = 0.85;
const HH_BODY = 0.85;          // ~1.7u tall patron

// Cosmetic drunken lean (radians), folded onto this.angle.
const LEAN_MAX = 0.16;

// How fast transient velocity (stumbles + knockback) bleeds off (1/s exp decay).
const TRANSIENT_DAMP = 6.0;

export class DrunkPatron extends Entity {
  constructor(ctx, { x, y, dir = 1, range = 5 } = {}) {
    super(x, y);
    this.type = 'drunk';
    this.ctx = ctx;

    // ── Interaction contract ────────────────────────────────────────────────
    this.hurtsPlayer = true;
    this.contactDamage = DRUNK.CONTACT_DAMAGE;
    this.knockback = DRUNK.KNOCKBACK;
    this.harmable = true;

    // ── Patrol / gait ───────────────────────────────────────────────────────
    this.dir = Math.sign(dir) || 1;
    this.facing = this.dir;
    this._minX = x - range;
    this._maxX = x + range;
    this._t = 0;               // gait phase accumulator (seconds)

    this.hp = START_HP;

    // Transient horizontal velocity: stumble lunges + melee knockback ride here
    // and decay away, layered on top of the steady wobble-walk.
    this._transientVx = 0;
    this._stumbleT = 0;        // seconds of "currently lunging" left
    this._windupT = 0;         // seconds of "coiling before a lunge" left (telegraph)

    // ── View: a dark silhouette with a crimson neon rim ─────────────────────
    this.view = new Group();
    const body = new Mesh(
      new CapsuleGeometry(0.30, 1.02, 4, 10),
      new MeshStandardMaterial({
        color: new Color(0x140307),
        emissive: new Color(0x2a0409),
        emissiveIntensity: 0.4,
        roughness: 0.75,
        metalness: 0.0,
      }),
    );
    // A slightly larger back-shell in pure crimson glow = the readable neon rim.
    const rim = new Mesh(
      new CapsuleGeometry(0.38, 1.06, 4, 10),
      makeGlowMaterial(0xff1030, 0.4),
    );
    this.view.add(rim, body);
    this.view.position.z = 0;
    ctx.renderer.scene.add(this.view);
  }

  // ── Simulation ─────────────────────────────────────────────────────────────

  fixedUpdate(dt) {
    this.snapshot();
    this._t += dt;

    // Two summed sines → an erratic, never-quite-repeating sway.
    const wobble = Math.sin(this._t * DRUNK.SWAY_FREQ_A) + 0.5 * Math.sin(this._t * DRUNK.SWAY_FREQ_B);
    // A steady walk whose speed pulses with the wobble (can briefly stall / back-step).
    let walkVx = this.dir * DRUNK.BASE_SPEED * (0.55 + 0.45 * wobble);

    // Random stumble — but TELEGRAPHED. On the random trigger the drunk first
    // COILS (a brief hesitation), and only when the coil expires does the lunge
    // fire. That coil is the tell that makes a fast dart fair to dodge.
    if (this._windupT <= 0 && this._stumbleT <= 0 && Math.random() < DRUNK.STUMBLE_CHANCE) {
      this._windupT = DRUNK.STUMBLE_WINDUP;
    }
    if (this._windupT > 0) {
      this._windupT -= dt;
      walkVx *= 0.15;                       // nearly halt while coiling — the visible tell
      if (this._windupT <= 0) {             // coil released → the lunge fires
        this._stumbleT = DRUNK.STUMBLE_DURATION;
        this._transientVx += DRUNK.STUMBLE_IMPULSE * this.facing;
      }
    }
    if (this._stumbleT > 0) this._stumbleT -= dt;

    // Integrate, then bleed the transient velocity toward zero (frame-rate safe).
    this.x += (walkVx + this._transientVx) * dt;
    this._transientVx *= Math.exp(-TRANSIENT_DAMP * dt);

    // Bounce at the patrol bounds and turn to face the new heading.
    if (this.x <= this._minX) { this.x = this._minX; this.dir = 1; this.facing = 1; }
    else if (this.x >= this._maxX) { this.x = this._maxX; this.dir = -1; this.facing = -1; }

    // Drunken lean, folded onto the render angle (cosmetic only).
    this.angle = LEAN_MAX * (0.7 * Math.sin(this._t * DRUNK.SWAY_FREQ_A) + 0.3 * Math.sin(this._t * DRUNK.SWAY_FREQ_B));
    // Coil tell: lean back (away from the lunge) while winding up, so the pounce reads.
    if (this._windupT > 0) this.angle -= 0.35 * this.facing;
  }

  /** True while coiling for a lunge — the telegraph window (for FX / debug). */
  get isWindingUp() { return this._windupT > 0; }

  /** Hurtbox: stretches forward while lunging — the "stumbling hitbox". */
  aabb() {
    const lunging = this._stumbleT > 0;
    const hw = lunging ? HW_LUNGE : HW_NORMAL;
    // Grow forward only: keep the rear edge put, push the front edge out.
    const cx = this.x + (lunging ? (hw - HW_NORMAL) * this.facing : 0);
    return { x: cx, y: this.y, hw, hh: HH_BODY };
  }

  /**
   * Melee response. He has 2 HP and dies only when it runs out; otherwise he just
   * staggers and keeps coming. We decrement by ONE per hit (a flat two-hit kill)
   * regardless of the player's damage magnitude — matching the "2 HP" spec — and
   * shove him in the direction the player is facing.
   */
  onPlayerHit({ knockback = 0, facing = 1 } = {}) {
    this._transientVx += facing * knockback;
    this.hp -= 1;
    if (this.hp <= 0) {
      this.destroy(); // scene emits EVENT.ENEMY_KILLED for the kill
      return true;
    }
    // Survived: knock him into a fresh stagger (extended hitbox) but let him live.
    this._stumbleT = Math.max(this._stumbleT, DRUNK.STUMBLE_DURATION);
    return false;
  }
}
