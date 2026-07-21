import { PerspectiveCamera, Vector3 } from 'three';
import { CAMERA, EVENT, lerp, clamp01 } from '../config/Constants.js';

/**
 * CameraRig.js — a follow camera with the four things that make 2D cameras feel
 * good, plus the 2.5D depth read:
 *
 *   - LOOK-AHEAD: leads the player in the direction they face/move, so you see
 *     where you're going, not where you've been.
 *   - DEADZONE: a small box the player can move inside without the camera budging,
 *     so tiny corrections don't cause seasick drift.
 *   - TRAUMA SHAKE: additive shake that scales with trauma² and decays (Eiserloh).
 *     A landing adds a little, a boss shockwave a lot; it never feels linear.
 *   - SIZE ZOOM: as the hero grows, the camera dollies back so the giant stays
 *     framed — the world literally feels smaller as you get bigger.
 *
 * A PerspectiveCamera (not ortho) gives parallax between the play plane and the
 * neon backdrop — the subtle 3D that sells "2.5D".
 */
export class CameraRig {
  constructor(bus) {
    this.bus = bus;
    this.camera = new PerspectiveCamera(CAMERA.FOV_DEG, 16 / 9, 0.1, 200);
    this.camera.position.set(0, 3, CAMERA.DOLLY_Z);

    this.target = null;           // Entity to follow (the player)
    this._center = new Vector3(0, 3, 0); // deadzone-tracked follow point (RAW target)
    this._pos = new Vector3(0, 3, CAMERA.DOLLY_Z); // final desired pos = center + look-ahead
    this._look = 0;               // smoothed look-ahead offset (ADDITIVE, outside deadzone)
    this.trauma = 0;
    this._viewHeight = CAMERA.VIEW_HEIGHT;

    bus?.on(EVENT.CAMERA_SHAKE, ({ trauma }) => this.addTrauma(trauma));
  }

  follow(entity) { this.target = entity; }
  addTrauma(amount) { this.trauma = Math.min(CAMERA.MAX_SHAKE, this.trauma + amount); }

  /** Convert a desired framing height (world units) into a dolly distance. */
  _dollyFor(viewHeight) {
    const fov = (this.camera.fov * Math.PI) / 180;
    return (viewHeight * 0.5) / Math.tan(fov * 0.5);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(frameDt, elapsed) {
    if (!this.target) return;

    // Size-aware framing: pull back as the hero grows.
    const heavyT = this.target.weightT ?? 0;
    this._viewHeight = lerp(CAMERA.VIEW_HEIGHT, CAMERA.VIEW_HEIGHT_AT_HEAVY, heavyT);
    const dolly = this._dollyFor(this._viewHeight);

    const k = clamp01(CAMERA.FOLLOW_LERP * 60 * frameDt);

    // 1) DEADZONE BOX on the RAW target. The target roams freely inside the box
    //    (idle micro-moves, landing bobs) without budging the camera; only when
    //    it crosses an edge does the centre ease toward it. This is the real
    //    anti-seasickness deadzone — it must NOT see the look-ahead, or the lead
    //    would pin the target to the edge and eat all the slack.
    const rawTx = this.target.x;
    const rawTy = this.target.y + this._viewHeight * 0.12; // frame the hero low-centre
    const dx = rawTx - this._center.x;
    const dy = rawTy - this._center.y;
    if (Math.abs(dx) > CAMERA.DEADZONE_X) this._center.x += (dx - Math.sign(dx) * CAMERA.DEADZONE_X) * k;
    if (Math.abs(dy) > CAMERA.DEADZONE_Y) this._center.y += (dy - Math.sign(dy) * CAMERA.DEADZONE_Y) * k;

    // 2) Look-ahead: an ADDITIVE lead in the facing direction, eased.
    const desiredLook = (this.target.facing ?? 1) * CAMERA.LOOKAHEAD;
    this._look = lerp(this._look, desiredLook, clamp01(CAMERA.LOOKAHEAD_LERP * 60 * frameDt));

    // 3) Compose: the camera sits at the deadzone centre plus the lead.
    this._pos.x = this._center.x + this._look;
    this._pos.y = this._center.y;
    this._pos.z += (dolly - this._pos.z) * k;

    // Trauma shake: quadratic falloff, decaying. Random is fine here (render-only).
    let sx = 0, sy = 0, sr = 0;
    if (this.trauma > 0) {
      const shake = this.trauma * this.trauma;
      sx = (Math.random() * 2 - 1) * CAMERA.MAX_SHAKE * shake;
      sy = (Math.random() * 2 - 1) * CAMERA.MAX_SHAKE * shake * 0.7;
      sr = (Math.random() * 2 - 1) * 0.04 * shake;
      this.trauma = Math.max(0, this.trauma - CAMERA.SHAKE_DECAY * frameDt);
    }

    this.camera.position.set(this._pos.x + sx, this._pos.y + sy, this._pos.z);
    this.camera.lookAt(this._pos.x + sx * 0.5, this._pos.y + sy * 0.5, 0);
    this.camera.rotation.z = sr; // apply shake roll after lookAt (which levels z to ~0)
  }
}
