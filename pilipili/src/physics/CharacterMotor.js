import { LAYER } from '../config/Constants.js';

/**
 * CharacterMotor.js — kinematic "move-and-slide" for the player (and any actor
 * that wants precise, non-physical control).
 *
 * WHY KINEMATIC, NOT A RIGID BODY: a dynamic body obeys the solver — you cannot
 * give it asymmetric gravity, an apex hang, instant direction flips, or a jump
 * that respects the player's intent. So we compute the *desired* displacement
 * ourselves (Player.js) and hand it to Rapier's KinematicCharacterController,
 * which resolves it against the world — collide-and-slide, auto-step over small
 * ledges, snap-to-ground on descents, one-way platforms — and hands back the
 * corrected movement plus whether we're grounded. Best of both worlds.
 *
 * The motor owns its collider centre (x, y) as the authoritative transform and
 * keeps the kinematic body in lock-step with it.
 */
export class CharacterMotor {
  /**
   * @param {import('./PhysicsWorld.js').PhysicsWorld} physics
   */
  constructor(physics, { x, y, halfWidth, halfHeight, layer = LAYER.PLAYER, entity = null,
    offset = 0.02, snap = 0.35, stepHeight = 0.4, maxSlopeDeg = 46, minSlideDeg = 55 } = {}) {
    this.physics = physics;
    const R = physics.RAPIER;

    this.x = x; this.y = y;
    this.hx = halfWidth; this.hy = halfHeight;

    const { body, col } = physics.createKinematicBox(x, y, halfWidth, halfHeight, { layer, entity });
    this.body = body;
    this.col = col;

    // The controller is configured once and reused every step.
    this.controller = physics.world.createCharacterController(offset);
    this.controller.setUp({ x: 0, y: 1 });
    this.controller.enableSnapToGround(snap);
    this.controller.enableAutostep(stepHeight, 0.12, true); // maxH, minWidth, dynamic
    this.controller.setMaxSlopeClimbAngle((maxSlopeDeg * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((minSlideDeg * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true); // shove bottles/patrons
    this.controller.setSlideEnabled(true);

    // Bound once so the WASM callback isn't re-allocated per step.
    this._filter = this._oneWayFilter.bind(this);
    this._descendVy = 0; // last vertical intent, read by the one-way filter
  }

  /**
   * One-way platform rule: a platform is IGNORED (passable) when the actor is
   * moving upward, OR when the actor's feet start below the platform surface.
   * Otherwise it's solid, so you land on it and can stand. Returns true to KEEP
   * the collider in the query (treat as solid), false to skip it.
   */
  _oneWayFilter(collider) {
    const m = this.physics.metaOf(collider);
    if (!m?.oneWay) return true;
    const feet = this.y - this.hy;
    const rising = this._descendVy > 0.0001;
    // Passable when rising, or when the feet are still below the deck (jumping up
    // through it). A small skin avoids jitter right at the lip.
    if (rising || feet < m.topY - 0.06) return false;
    return true;
  }

  /**
   * Resolve a desired displacement against the world.
   * @returns {{ grounded:boolean, ceiling:boolean, wall:number, dx:number, dy:number }}
   *   wall: -1 blocked on left, +1 blocked on right, 0 none.
   */
  move(dx, dy) {
    this._descendVy = dy;
    const c = this.controller;
    c.computeColliderMovement(this.col, { x: dx, y: dy }, undefined, undefined, this._filter);
    const mv = c.computedMovement();
    const grounded = c.computedGrounded();

    this.x += mv.x;
    this.y += mv.y;
    this.body.setNextKinematicTranslation({ x: this.x, y: this.y });

    // Infer wall/ceiling from desired-vs-resolved: version-stable, no normal-sign
    // assumptions. A blocked axis keeps <50% of its intended travel.
    const EPS = 1e-4;
    let wall = 0, ceiling = false;
    if (dx > EPS && mv.x < dx * 0.5) wall = 1;
    else if (dx < -EPS && mv.x > dx * 0.5) wall = -1;
    if (dy > EPS && mv.y < dy * 0.5 && !grounded) ceiling = true;

    return { grounded, ceiling, wall, dx: mv.x, dy: mv.y };
  }

  /** Immediate placement (respawn, teleporter). */
  teleport(x, y) {
    this.x = x; this.y = y;
    this.body.setTranslation({ x, y }, true);
    this.body.setNextKinematicTranslation({ x, y });
  }

  get feetY() { return this.y - this.hy; }

  /**
   * Resize the collider for the growth engine, anchored to the FEET so the actor
   * grows upward from the floor. Clearance-gated: if the taller/wider body would
   * intersect a ceiling or wall, the resize is refused and the caller keeps its
   * current size until there's room (the Mario-mushroom rule).
   * @returns {boolean} whether the resize was applied.
   */
  setSizeAnchoredToFeet(hx, hy, { safe = true } = {}) {
    if (Math.abs(hx - this.hx) < 1e-4 && Math.abs(hy - this.hy) < 1e-4) return true;
    const feet = this.feetY;
    const newY = feet + hy;
    if (safe && this.physics.isBlocked(this.x, newY, hx, hy, this.col)) return false;

    this.hx = hx; this.hy = hy; this.y = newY;
    this.col.setHalfExtents({ x: hx, y: hy });
    this.body.setTranslation({ x: this.x, y: newY }, true);
    this.body.setNextKinematicTranslation({ x: this.x, y: newY });
    return true;
  }

  destroy() {
    this.physics.world.removeCharacterController(this.controller);
    this.physics.removeCollider(this.col);
  }
}
