import { Group, Mesh, BoxGeometry, PlaneGeometry, MeshStandardMaterial, Color } from 'three';
import { Entity } from '../Entity.js';
import { makeGlowMaterial } from '../../render/shaders/NeonMaterial.js';
import { ICE } from '../../config/Constants.js';

/**
 * IceCube — a block of frozen booze-slush that slides along the floor and paints
 * a zero-friction skid-zone wherever it has recently been.
 *
 * It carries NO Rapier body: it is a pure transform-mover clamped to its spawn
 * floor Y. The GameplayScene reads our `iceZone` / `slickAt()` contract every
 * fixed step and, wherever we report "slick", drops the player's traction to
 * ICE.PLAYER_TRACTION_ON_ICE — so the club floor turns to glass under the feet.
 *
 * The cube MELTS as it goes, dribbling a trail of puddles behind it. Each puddle
 * stays slick for ICE.FRICTION_ZONE_LIFETIME before it "re-freezes" (expires),
 * which is why the slick band trails the cube instead of teleporting with it.
 */

// How close (world units) a query point must be to count as standing on ice.
const SELF_SLICK_RADIUS = 0.5;   // the cube's own frosty footprint
const TRAIL_SLICK_RADIUS = 0.6;  // each melted puddle it has dribbled behind it

// Collision half-extents — a chunky ~1×1 unit block.
const CUBE_HALF = 0.5;

// Cosmetic trail: a small pool of floor-quads we re-point at live puddles every
// render frame (world-space, so they stay put as the cube slides on). Fixed pool
// => no per-step allocation / GC churn.
const TRAIL_QUADS = 16;

export class IceCube extends Entity {
  constructor(ctx, { x, y, dir = 1, range = 4 } = {}) {
    super(x, y);
    this.type = 'ice';
    this.ctx = ctx;

    // ── Interaction contract ────────────────────────────────────────────────
    this.iceZone = true;      // scene calls slickAt() to zero-out floor friction
    this.harmable = true;     // one melee hit shatters it
    this.hurtsPlayer = false; // it is a floor nuisance, not a damage source

    // ── Patrol ──────────────────────────────────────────────────────────────
    this.dir = Math.sign(dir) || 1;
    this._minX = x - range;
    this._maxX = x + range;

    // Melting slick trail: newest puddle last. Each entry is { x, life } (secs).
    this._trail = [];

    // ── View: a cold cyan-white block that contrasts the crimson room ───────
    this.view = new Group();
    // Frosted solid core (lit, translucent) …
    const core = new Mesh(
      new BoxGeometry(2 * CUBE_HALF * 0.82, 2 * CUBE_HALF * 0.82, 2 * CUBE_HALF * 0.82),
      new MeshStandardMaterial({
        color: new Color(0x1c4b57),
        emissive: new Color(0x9fe8ff),
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.6,
        roughness: 0.12,
        metalness: 0.0,
      }),
    );
    // … wrapped in a pure-glow halo shell so bloom reads it as cold light.
    const halo = new Mesh(
      new BoxGeometry(2 * CUBE_HALF, 2 * CUBE_HALF, 2 * CUBE_HALF),
      makeGlowMaterial(0x9fe8ff, 0.5),
    );
    this.view.add(core, halo);
    this.view.position.z = 0; // gameplay plane
    ctx.renderer.scene.add(this.view);

    // Trail quads live in their OWN world-space group — they must NOT slide with
    // the cube's view. We recycle the pool each frame in update().
    this._trailGroup = new Group();
    this._trailGroup.position.z = -0.05; // a hair behind the action
    this._trailQuads = [];
    for (let i = 0; i < TRAIL_QUADS; i++) {
      const q = new Mesh(new PlaneGeometry(0.9, 0.28), makeGlowMaterial(0x9fe8ff, 0.0));
      q.visible = false;
      this._trailGroup.add(q);
      this._trailQuads.push(q);
    }
    ctx.renderer.scene.add(this._trailGroup);
  }

  // ── Simulation ─────────────────────────────────────────────────────────────

  fixedUpdate(dt) {
    this.snapshot();

    // Slide along the spawn floor, bouncing between the patrol bounds.
    this.x += ICE.SLIDE_SPEED * this.dir * dt;
    if (this.x <= this._minX) { this.x = this._minX; this.dir = 1; }
    else if (this.x >= this._maxX) { this.x = this._maxX; this.dir = -1; }

    // Dribble a fresh puddle at the current spot, then age & cull the trail.
    this._trail.push({ x: this.x, life: ICE.FRICTION_ZONE_LIFETIME });
    for (let i = this._trail.length - 1; i >= 0; i--) {
      this._trail[i].life -= dt;
      if (this._trail[i].life <= 0) this._trail.splice(i, 1);
    }
  }

  /** Floor contract: is the ground under `worldX` frictionless right now? */
  slickAt(worldX) {
    // The cube itself is always slick underfoot …
    if (Math.abs(worldX - this.x) <= SELF_SLICK_RADIUS) return true;
    // … as is any puddle it has dribbled that has not yet re-frozen.
    for (let i = 0; i < this._trail.length; i++) {
      const p = this._trail[i];
      if (p.life > 0 && Math.abs(worldX - p.x) <= TRAIL_SLICK_RADIUS) return true;
    }
    return false;
  }

  aabb() {
    return { x: this.x, y: this.y, hw: CUBE_HALF, hh: CUBE_HALF };
  }

  /** Melee response: a single hit shatters the cube. Returns true = "I died". */
  onPlayerHit() {
    this.melt();
    return true;
  }

  melt() {
    // NOTE: the GameplayScene already emits EVENT.ENEMY_KILLED for any melee kill
    // (onPlayerHit → truthy), so we deliberately do NOT re-emit it here — that
    // would double-fire kill VFX/SFX. We simply clean ourselves up.
    this.destroy();
  }

  // ── Render frame (cosmetic) ────────────────────────────────────────────────

  update() {
    if (!this._trailQuads) return;
    // Re-point the fixed quad pool at an even sample of the live trail so the
    // whole slick band shows, fading each quad by how "unmelted" its puddle is.
    const n = this._trail.length;
    const last = this._trailQuads.length - 1;
    for (let i = 0; i < this._trailQuads.length; i++) {
      const q = this._trailQuads[i];
      if (n === 0) { q.visible = false; continue; }
      const idx = last === 0 ? n - 1 : Math.round((i / last) * (n - 1));
      const p = this._trail[idx];
      const t = Math.max(0, Math.min(1, p.life / ICE.FRICTION_ZONE_LIFETIME));
      q.visible = t > 0;
      q.position.set(p.x, this.y - CUBE_HALF + 0.02, 0); // lie on the floor line
      q.material.opacity = 0.35 * t;
      q.scale.setScalar(0.6 + 0.4 * t);
    }
  }

  destroy() {
    // Tear down the world-space trail group we own before the base clears view.
    this._trailGroup?.parent?.remove(this._trailGroup);
    this._trailGroup = null;
    this._trailQuads = null;
    super.destroy();
  }
}
