/**
 * Entity.js — base for everything that lives in the world.
 *
 * Deliberately holds NO Three.js reference. Simulation state (x, y, angle) is
 * plain numbers advanced in the fixed step; the render layer attaches a `.view`
 * (a THREE.Object3D) and we interpolate it toward the sim state every draw call.
 * This is what lets the whole gameplay layer be unit-tested headless and keeps a
 * variable render frame rate from ever touching physics.
 */
let _nextId = 1;

export class Entity {
  constructor(x = 0, y = 0) {
    this.id = _nextId++;
    this.type = 'entity';
    this.alive = true;

    // Simulation transform (authoritative).
    this.x = x;
    this.y = y;
    this.angle = 0;
    this.scale = 1;

    // Previous-step transform for render interpolation.
    this.prevX = x;
    this.prevY = y;
    this.prevAngle = 0;
    this.prevScale = 1;

    /** Render view, set by the render layer. May stay null in headless tests. */
    this.view = null;
    /** Physics handle (Rapier collider/body), set by subclasses that need it. */
    this.body = null;
  }

  /** Call at the TOP of every fixedUpdate so interpolation has a "from". */
  snapshot() {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevAngle = this.angle;
    this.prevScale = this.scale;
  }

  /** Advance one fixed step. Override in subclasses. */
  fixedUpdate(_dt, _ctx) {}

  /** Push interpolated sim state into the Three.js view. alpha ∈ [0,1). */
  syncView(alpha) {
    if (!this.view) return;
    const ax = this.prevX + (this.x - this.prevX) * alpha;
    const ay = this.prevY + (this.y - this.prevY) * alpha;
    const aa = this.prevAngle + (this.angle - this.prevAngle) * alpha;
    const as = this.prevScale + (this.scale - this.prevScale) * alpha;
    this.view.position.set(ax, ay, this.view.position.z);
    this.view.rotation.z = aa;
    if (as !== 1) this.view.scale.setScalar(as);
  }

  destroy() {
    this.alive = false;
    this.view?.parent?.remove(this.view);
    this.view = null;
  }
}
