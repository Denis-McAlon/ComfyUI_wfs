import { Group, Mesh, TetrahedronGeometry } from 'three';
import { Entity } from '../Entity.js';
import { makeGlowMaterial } from '../../render/shaders/NeonMaterial.js';
import { GLASS } from '../../config/Constants.js';

/**
 * BrokenGlass — a strip of shattered bottles on the floor. Standing in it slows
 * the player (slowMult) and chips away health over time; the GameplayScene owns
 * the damage cadence and reads our `floorHazard` / `contains()` band each step.
 *
 * Purely a hazard: NOT harmable, deals no contact/knockback damage. Visually
 * static except for a faint per-shard twinkle so the glass catches the crimson.
 */

// Vertical band the player's FEET must fall inside to count as "in" the glass.
const FEET_BELOW = 0.25; // a touch under the strip line …
const FEET_ABOVE = 0.35; // … up to ankle height
const AABB_HH = 0.30;    // reported strip half-height

// Roughly this many shards per world unit of width.
const SHARDS_PER_UNIT = 4;

export class BrokenGlass extends Entity {
  constructor(ctx, { x, y, w = 2 } = {}) {
    super(x, y);
    this.type = 'glass';
    this.ctx = ctx;

    // ── Interaction contract ────────────────────────────────────────────────
    this.floorHazard = true;
    this.slowMult = GLASS.SLOW_MULT;
    this.dotPerSecond = GLASS.DOT_PER_SECOND; // scene uses the constant; exposed for completeness
    this.harmable = false;
    this.hurtsPlayer = false;

    this._halfW = w / 2;

    // ── View: a low scatter of crimson-white shards ─────────────────────────
    this.view = new Group();
    this.view.position.z = 0;
    // Two shared glow materials — white-hot glints and crimson bottle-glass.
    const matHot = makeGlowMaterial(0xffd7dd, 0.85);
    const matRed = makeGlowMaterial(0xff2036, 0.75);
    this._shards = [];
    const count = Math.max(4, Math.round(w * SHARDS_PER_UNIT));
    for (let i = 0; i < count; i++) {
      const size = 0.06 + Math.random() * 0.09;
      const shard = new Mesh(new TetrahedronGeometry(size), i % 3 === 0 ? matHot : matRed);
      shard.position.set(
        (Math.random() * 2 - 1) * this._halfW * 0.94, // across the strip
        (Math.random() * 2 - 1) * 0.09,               // hug the floor line (low profile)
        (Math.random() * 2 - 1) * 0.06,
      );
      shard.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.view.add(shard);
      // Per-shard twinkle params — independent phase so they never pulse in sync.
      this._shards.push({ mesh: shard, phase: Math.random() * Math.PI * 2, freq: 3 + Math.random() * 4 });
    }
    this._twinkleT = 0;
    ctx.renderer.scene.add(this.view);
  }

  /** Floor contract: are the player's feet inside the glass band? */
  contains(worldX, feetY) {
    return worldX >= this.x - this._halfW && worldX <= this.x + this._halfW
        && feetY >= this.y - FEET_BELOW && feetY <= this.y + FEET_ABOVE;
  }

  aabb() {
    return { x: this.x, y: this.y, hw: this._halfW, hh: AABB_HH };
  }

  // ── Render frame: glints ─────────────────────────────────────────────────────

  update(frameDt) {
    this._twinkleT += frameDt;
    for (let i = 0; i < this._shards.length; i++) {
      const s = this._shards[i];
      const k = 0.8 + 0.35 * Math.sin(this._twinkleT * s.freq + s.phase);
      s.mesh.scale.setScalar(k);
    }
  }
}
