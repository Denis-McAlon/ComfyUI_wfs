import { LAYER } from '../config/Constants.js';

/**
 * PhysicsWorld.js — thin wrapper over Rapier2D (WASM).
 *
 * Pinned to @dimforge/rapier2d-compat ^0.14 (see package.json). Every engine
 * call is funnelled through this file, so if Rapier changes a signature it is a
 * one-file fix rather than a shotgun edit across the entity layer.
 *
 * We use Rapier for: static level geometry, dynamic props (bottles, dynamic
 * vinyls), sensors (pickups / hurtboxes), and shape/ray queries. The PLAYER is
 * NOT a dynamic body — it's a kinematic collider driven by CharacterMotor, which
 * lets us author game-feel that a rigid-body solver would never permit.
 */
export class PhysicsWorld {
  constructor() {
    this.RAPIER = null;
    this.world = null;
    this.eventQueue = null;
    /** collider.handle → { layer, entity, oneWay, topY, ... } */
    this.meta = new Map();
  }

  async init(gravity = { x: 0, y: -60 }) {
    // rapier2d-compat bundles the WASM and must be initialized once.
    const RAPIER = (await import('@dimforge/rapier2d-compat')).default;
    await RAPIER.init();
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World(gravity);
    this.eventQueue = new RAPIER.EventQueue(true);
    return this;
  }

  /** Pack a 16-bit membership + 16-bit filter into Rapier's u32 collision group. */
  groups(membership, filter) {
    return ((membership & 0xffff) << 16) | (filter & 0xffff);
  }

  step() {
    this.world.step(this.eventQueue);
  }

  /** Drain sensor/contact events since last step. cb(handle1, handle2, started). */
  drainCollisionEvents(cb) {
    this.eventQueue.drainCollisionEvents((h1, h2, started) => cb(h1, h2, started));
  }

  metaOf(collider) {
    return collider ? this.meta.get(collider.handle) : undefined;
  }

  // ---- Factories -----------------------------------------------------------

  /** Static solid box (level geometry). Returns the Rapier Collider. */
  createStaticBox(x, y, hx, hy, { layer = LAYER.WORLD, friction = 0.85, meta = {} } = {}) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y));
    const desc = R.ColliderDesc.cuboid(hx, hy)
      .setFriction(friction)
      .setCollisionGroups(this.groups(layer, 0xffff));
    const col = this.world.createCollider(desc, body);
    this.meta.set(col.handle, { layer, body, ...meta });
    return col;
  }

  /**
   * One-way platform: solid geometry the motor is allowed to pass through from
   * below / when rising. We tag it and store the surface Y; CharacterMotor's
   * filter predicate does the directional logic.
   */
  createOneWayPlatform(x, y, hx, hy, { friction = 0.9 } = {}) {
    const col = this.createStaticBox(x, y, hx, hy, {
      layer: LAYER.ONE_WAY,
      friction,
      meta: { oneWay: true, topY: y + hy },
    });
    return col;
  }

  /** Sensor (no collision response, only events). For pickups, triggers, hurtboxes. */
  createSensorBox(x, y, hx, hy, { layer = LAYER.SENSOR, entity = null } = {}) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y));
    const desc = R.ColliderDesc.cuboid(hx, hy)
      .setSensor(true)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(this.groups(layer, 0xffff));
    const col = this.world.createCollider(desc, body);
    this.meta.set(col.handle, { layer, body, entity, sensor: true });
    return col;
  }

  /** Dynamic box (bottles, debris, boss-thrown props). */
  createDynamicBox(x, y, hx, hy, { layer = LAYER.PROJECTILE, density = 1, restitution = 0.2 } = {}) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(x, y).setCcdEnabled(true),
    );
    const desc = R.ColliderDesc.cuboid(hx, hy)
      .setDensity(density)
      .setRestitution(restitution)
      .setCollisionGroups(this.groups(layer, 0xffff));
    const col = this.world.createCollider(desc, body);
    this.meta.set(col.handle, { layer, body });
    return { body, col };
  }

  /** Kinematic-position collider for the player / kinematic enemies. */
  createKinematicBox(x, y, hx, hy, { layer = LAYER.PLAYER, friction = 0, entity = null } = {}) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y),
    );
    const desc = R.ColliderDesc.cuboid(hx, hy)
      .setFriction(friction)
      .setCollisionGroups(this.groups(layer, 0xffff));
    const col = this.world.createCollider(desc, body);
    this.meta.set(col.handle, { layer, body, entity });
    return { body, col };
  }

  // ---- Queries -------------------------------------------------------------

  /**
   * Clearance test: is a cuboid of half-extents (hx,hy) at (x,y) overlapping any
   * SOLID collider (excluding `exclude`)? Used by the growth engine to refuse to
   * expand the body into a ceiling — the Mario-mushroom rule.
   * @returns {boolean} true if blocked.
   */
  isBlocked(x, y, hx, hy, exclude = null) {
    const R = this.RAPIER;
    const shape = new R.Cuboid(hx, hy);
    const hit = this.world.intersectionWithShape(
      { x, y }, 0, shape,
      undefined,                       // filterFlags
      this.groups(LAYER.PLAYER, LAYER.WORLD | LAYER.ONE_WAY), // only solids
      exclude || undefined,            // exclude this collider
      undefined,                       // exclude rigidbody
      (c) => !this.metaOf(c)?.oneWay,  // ignore one-way platforms for growth
    );
    return hit != null;
  }

  /** Raycast; returns { collider, toi, point } or null. */
  castRay(ox, oy, dx, dy, maxToi, { solidOnly = true, exclude = null } = {}) {
    const R = this.RAPIER;
    const ray = new R.Ray({ x: ox, y: oy }, { x: dx, y: dy });
    const hit = this.world.castRay(
      ray, maxToi, solidOnly, undefined, undefined, exclude || undefined,
    );
    if (!hit) return null;
    return {
      collider: hit.collider,
      toi: hit.timeOfImpact ?? hit.toi,
      point: { x: ox + dx * (hit.timeOfImpact ?? hit.toi), y: oy + dy * (hit.timeOfImpact ?? hit.toi) },
    };
  }

  removeCollider(col) {
    if (!col) return;
    const m = this.meta.get(col.handle);
    this.meta.delete(col.handle);
    if (m?.body) this.world.removeRigidBody(m.body);
    else this.world.removeCollider(col, true);
  }
}
