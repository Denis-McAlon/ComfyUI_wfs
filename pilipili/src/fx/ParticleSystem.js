import {
  Points, BufferGeometry, Float32BufferAttribute, PointsMaterial,
  AdditiveBlending, Color, CanvasTexture, DynamicDrawUsage,
} from 'three';
import { EVENT, FX, PLAYER, clamp } from '../config/Constants.js';

/**
 * ParticleSystem.js — the "juice" layer.
 *
 * ONE THREE.Points draws every spark in the game. We never allocate a Three.js
 * object per particle — that would GC-thrash the render thread into stutter. Instead
 * a fixed POOL of `CAPACITY` slots is backed by flat typed arrays, recycled with a
 * ring cursor, and uploaded to the GPU in one buffer per frame. Adding a spark is
 * writing a few floats into an already-allocated slot; the hot integrate loop below
 * touches nothing but numbers.
 *
 * It is DECOUPLED: rather than being poked by gameplay, it subscribes to the event
 * bus and reacts. Player.jump/land/grow/hurt/attack, pickups, kills and every boss
 * beat already broadcast on the bus (see Constants.EVENT), so the whole feedback
 * layer is "fire and forget" — nothing in gameplay knows this file exists.
 *
 * RENDERING NOTES
 *   - AdditiveBlending: overlapping sparks sum toward white, so dense bursts read as
 *     hot cores exactly like real embers, and `toneMapped:false` lets them punch past
 *     1.0 so the Bloom pass blooms them.
 *   - Per-particle ALPHA is faked by fading each particle's RGB toward black as it
 *     dies: under additive blending "darker" == "more transparent", which sidesteps
 *     PointsMaterial's lack of a per-vertex alpha channel.
 *   - Per-particle SIZE is a custom `aSize` attribute injected into PointsMaterial's
 *     shader (onBeforeCompile), so a speck of dust and a boss-death chunk can share
 *     one draw call.
 */

/** Pool size. 2000 points is a rounding error on the GPU; we rarely exceed a few
 *  hundred live at once, but the headroom means a big burst never truncates. */
const CAPACITY = 2000;

/** Air drag applied to every particle (fraction of velocity bled per second). Keeps
 *  bursts from flying forever and gives them a satisfying "settle". */
const DRAG_PER_SECOND = 1.6;

/** Clamp the render delta we integrate against: a backgrounded tab hands us a huge
 *  frameDt and we don't want particles to teleport across the level on the catch-up
 *  frame. Cosmetic system → dropping time here is invisible and safe. */
const MAX_STEP = 0.05;

/**
 * Named spark colours. Where the design doc points at the venue's grade we read it
 * straight from FX.CRIMSON_GRADE so the particles stay in lockstep with the palette.
 */
const CRIMSON_TINT = Array.isArray(FX?.CRIMSON_GRADE?.tint) ? FX.CRIMSON_GRADE.tint : [1.0, 0.13, 0.18];
const COLOR = {
  DUST: 0xb98a7d,     // warm rose-grey — kicked-up club-floor haze
  CRIMSON: 0xff1030,  // the house neon
  MAGENTA: 0xff2b6b,  // rim / secondary neon
  EMBER: 0xff5a24,    // hot debris
  GOLD: 0xffcf6a,     // pickup shine
  WHITE: 0xfff0f2,    // hottest core / slash
  RED: 0xff2436,      // damage
  SLASH: 0xff8494,    // melee arc
};

export class ParticleSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx?.renderer?.scene ?? null;

    // ── Parallel pools (Structure-of-Arrays). Index i addresses one particle. ──
    // Three of these back live GPU attributes (position/colour/size); the rest are
    // CPU-only simulation state.
    this.aPos = new Float32Array(CAPACITY * 3);   // xyz — GPU 'position'
    this.aCol = new Float32Array(CAPACITY * 3);   // rgb (already faded) — GPU 'color'
    this.aSize = new Float32Array(CAPACITY);      // world size — GPU 'aSize'
    this.vel = new Float32Array(CAPACITY * 3);    // velocity (units/s)
    this.baseCol = new Float32Array(CAPACITY * 3);// un-faded rgb, so fade is non-destructive
    this.baseSize = new Float32Array(CAPACITY);   // spawn size, so shrink is non-destructive
    this.life = new Float32Array(CAPACITY);       // seconds remaining (<=0 == dead)
    this.maxLife = new Float32Array(CAPACITY);    // seconds at spawn (for the fade ratio)
    this.grav = new Float32Array(CAPACITY);       // per-particle downward accel (units/s²)
    this.drag = new Float32Array(CAPACITY);       // per-particle air-drag (fraction/s)

    this._cursor = 0;         // ring-buffer write head; oldest slot is recycled first
    this._scratch = new Color(); // reused when parsing a burst colour (no per-burst alloc)
    this._offs = [];          // bus unsubscribe thunks, released in destroy()

    this._buildPoints();
    this._wireBus();
  }

  // ── GPU object construction ───────────────────────────────────────────────

  _buildPoints() {
    const geo = new BufferGeometry();
    // Wrap the SAME typed arrays we mutate on the CPU; setting needsUpdate re-uploads.
    const posAttr = new Float32BufferAttribute(this.aPos, 3).setUsage(DynamicDrawUsage);
    const colAttr = new Float32BufferAttribute(this.aCol, 3).setUsage(DynamicDrawUsage);
    const sizeAttr = new Float32BufferAttribute(this.aSize, 1).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('color', colAttr);
    geo.setAttribute('aSize', sizeAttr);
    this._geo = geo;
    this._posAttr = posAttr;
    this._colAttr = colAttr;
    this._sizeAttr = sizeAttr;

    this._sprite = this._makeSprite(); // soft round glow so points aren't hard squares

    const mat = new PointsMaterial({
      size: 1.0,                  // multiplied per-vertex by aSize in the shader below
      sizeAttenuation: true,      // sparks shrink with distance → sells the 2.5D depth
      map: this._sprite || undefined,
      alphaTest: 0.0,
      transparent: true,
      depthWrite: false,          // never occlude the world; they're pure light
      blending: AdditiveBlending, // sum toward white; darkness == transparency
      vertexColors: true,
      toneMapped: false,          // allow >1.0 so Bloom treats them as light sources
    });

    // Inject a per-particle size attribute into the stock Points shader. `aSize`
    // scales the point sprite so one draw call spans dust motes → death chunks.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute float aSize;\n' + shader.vertexShader
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
    };
    this._mat = mat;

    const points = new Points(geo, mat);
    points.frustumCulled = false; // bursts happen anywhere; culling by a stale bounds hides them
    points.renderOrder = 10;      // draw over the world so additive glow reads on dark scenery
    this._points = points;
    this.scene?.add(points);
  }

  /** Generate a soft radial-gradient sprite (white core → transparent edge) once.
   *  In a non-DOM/headless context we silently fall back to square points. */
  _makeSprite() {
    if (typeof document === 'undefined') return null;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    if (!g) return null;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0.0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.65)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  // ── Bus wiring: turn gameplay events into sparks ──────────────────────────

  _wireBus() {
    const bus = this.ctx?.bus;
    if (!bus) return;
    const on = (evt, fn) => this._offs.push(bus.on(evt, fn));

    // Jump: a small puff of floor dust kicked out from under the feet.
    on(EVENT.PLAYER_JUMP, (p) => {
      const x = p?.x ?? this._px();
      const y = this._feetY(p?.y);
      this.burst(x, y, { count: 8, speed: 3.4, spread: Math.PI * 0.9, angle: Math.PI * 0.5, color: COLOR.DUST, size: 0.12, life: 0.32, gravity: 8, drag: 2.4 });
    });

    // Land: a dust RING that flares with the impact (impact == landing |vy|).
    on(EVENT.PLAYER_LAND, (p) => {
      const impact = Math.max(0, p?.impact ?? 6);
      const x = p?.x ?? this._px();
      const y = this._feetY(p?.y);
      const count = Math.round(clamp(6 + impact * 0.7, 6, 26));
      const speed = clamp(2.5 + impact * 0.18, 2.5, 8);
      this.burst(x, y, { ring: true, radius: 0.28, count, speed, color: COLOR.DUST, size: 0.13, life: 0.36, gravity: 6, drag: 3.0 });
    });

    // Grow: a radial crimson sparkle burst — the venue grade made physical.
    on(EVENT.PLAYER_GROW, () => {
      const x = this._px();
      const y = this._py();
      this.burst(x, y, { ring: true, radius: 0.5, count: 26, speed: 6.5, color: CRIMSON_TINT, size: 0.17, life: 0.7, gravity: -2, drag: 1.1, speedJitter: 0.55 });
      this.burst(x, y, { count: 16, speed: 4.5, spread: Math.PI * 2, color: COLOR.WHITE, size: 0.12, life: 0.5, gravity: 0, drag: 1.4 });
    });

    // Pickup: a bright warm shimmer at the collector.
    on(EVENT.PICKUP_COLLECTED, () => {
      const x = this._px();
      const y = this._py();
      this.burst(x, y, { count: 16, speed: 4.2, spread: Math.PI * 2, angle: -Math.PI * 0.5, color: COLOR.GOLD, size: 0.14, life: 0.55, gravity: -3, drag: 1.6 });
    });

    // Hurt: a red spit of blood-neon. Glass DoT ticks (dot:true) get a small one.
    on(EVENT.PLAYER_HURT, (p) => {
      const x = this._px();
      const y = this._py();
      const dot = !!p?.dot;
      this.burst(x, y, {
        count: dot ? 6 : 18, speed: dot ? 2.6 : 6.0, spread: Math.PI * 2,
        color: COLOR.RED, size: dot ? 0.11 : 0.16, life: dot ? 0.35 : 0.5, gravity: 10, drag: 1.8,
      });
    });

    // Attack: a short arc of slash sparks thrown along the strike's facing.
    on(EVENT.PLAYER_ATTACK, (p) => {
      const facing = (p?.facing ?? this.ctx?.player?.facing ?? 1) >= 0 ? 1 : -1;
      const x = p?.x ?? this._px();
      const y = p?.y ?? this._py();
      this.burst(x, y, {
        count: 10, speed: 8.5, spread: Math.PI * 0.55, angle: facing > 0 ? 0 : Math.PI,
        color: COLOR.SLASH, size: 0.15, life: 0.22, gravity: 0, drag: 3.5, speedJitter: 0.6,
      });
    });

    // Enemy killed: a debris burst that falls (gravity) at the kill site.
    on(EVENT.ENEMY_KILLED, (p) => {
      const x = p?.x ?? this._px();
      const y = p?.y ?? this._py();
      this.burst(x, y, { count: 20, speed: 6.5, spread: Math.PI * 2, color: COLOR.EMBER, size: 0.16, life: 0.6, gravity: 22, drag: 1.2, speedJitter: 0.7 });
      this.burst(x, y, { count: 8, speed: 3.5, spread: Math.PI * 2, color: COLOR.CRIMSON, size: 0.13, life: 0.5, gravity: 14, drag: 1.4 });
    });

    // Death: a dark, heavy scatter at the hero — the run bursts apart.
    on(EVENT.PLAYER_DIED, () => {
      const x = this._px(); const y = this._py();
      this.burst(x, y, { count: 30, speed: 7, spread: Math.PI * 2, color: COLOR.RED, size: 0.18, life: 0.8, gravity: 16, drag: 1.2, speedJitter: 0.6 });
      this.burst(x, y, { count: 14, speed: 3.5, spread: Math.PI * 2, color: COLOR.CRIMSON, size: 0.15, life: 0.7, gravity: 10, drag: 1.4 });
    });

    // Boss hurt: a white hit-spark at the skull so a landed blow is VISIBLE (not just heard).
    on(EVENT.BOSS_HURT, (p) => {
      const x = p?.x ?? this._px(); const y = p?.y ?? this._py();
      this.burst(x, y, { count: 14, speed: 7.5, spread: Math.PI * 2, color: COLOR.WHITE, size: 0.14, life: 0.3, gravity: 0, drag: 3.0, speedJitter: 0.5 });
      this.burst(x, y, { count: 8, speed: 4, spread: Math.PI * 2, color: COLOR.CRIMSON, size: 0.13, life: 0.4, gravity: 6, drag: 1.6 });
    });

    // Boss shockwave: an expanding crimson ring at the wave's origin.
    on(EVENT.BOSS_SHOCKWAVE, (p) => {
      const x = p?.x ?? 0;
      const y = p?.y ?? this._py();
      this.burst(x, y, { ring: true, radius: 0.4, count: 40, speed: 9.5, color: COLOR.CRIMSON, size: 0.15, life: 0.75, gravity: 0, drag: 0.9, speedJitter: 0.15 });
    });

    // Boss defeated: a big, layered, multi-colour finale.
    on(EVENT.BOSS_DEFEATED, () => {
      const x = this._px();
      const y = this._py() + 1.5;
      this.burst(x, y, { ring: true, radius: 0.6, count: 48, speed: 11, color: COLOR.CRIMSON, size: 0.2, life: 1.0, gravity: 4, drag: 0.8, speedJitter: 0.5 });
      this.burst(x, y, { count: 40, speed: 8, spread: Math.PI * 2, color: COLOR.MAGENTA, size: 0.18, life: 1.1, gravity: 3, drag: 0.9 });
      this.burst(x, y, { count: 32, speed: 6, spread: Math.PI * 2, color: COLOR.GOLD, size: 0.16, life: 1.2, gravity: 2, drag: 1.0 });
      this.burst(x, y, { count: 24, speed: 4, spread: Math.PI * 2, color: COLOR.WHITE, size: 0.14, life: 0.9, gravity: 0, drag: 1.3 });
    });
  }

  // ── Player-position helpers (fallbacks when an event carries no coordinates) ──

  _px() { return this.ctx?.player?.x ?? 0; }
  _py() { return this.ctx?.player?.y ?? 0; }
  /** Feet Y for dust: prefer the collider's half-height, else the base silhouette. */
  _feetY(centerY) {
    const p = this.ctx?.player;
    const cy = centerY ?? p?.y ?? 0;
    const hy = p?.motor?.hy ?? (PLAYER?.HALF_HEIGHT ?? 0.85);
    return cy - hy;
  }

  // ── The workhorse: emit a burst of particles ──────────────────────────────

  /**
   * Spawn `count` particles at (x, y).
   * @param {number} x world X
   * @param {number} y world Y
   * @param {object} [o]
   * @param {number} [o.count=12]        how many particles
   * @param {number} [o.speed=6]         base launch speed (units/s)
   * @param {number|string|number[]} [o.color=CRIMSON] hex, css string, or [r,g,b] 0..1
   * @param {number} [o.size=0.16]       base world size
   * @param {number} [o.life=0.5]        base lifetime (s)
   * @param {number} [o.spread=TWO_PI]   angular cone width (radians) for scatter mode
   * @param {number} [o.angle=0]         cone centre / ring phase (radians)
   * @param {number} [o.gravity=0]       downward accel (units/s²); negative floats up
   * @param {number} [o.drag=DRAG]       per-second velocity bleed
   * @param {boolean}[o.ring=false]      emit evenly around a circle instead of a cone
   * @param {number} [o.radius=0]        initial offset from centre (great for rings)
   * @param {number} [o.speedJitter=0.4] fractional random speed variation
   */
  burst(x, y, o = {}) {
    const count = o.count ?? 12;
    const speed = o.speed ?? 6;
    const size = o.size ?? 0.16;
    const life = o.life ?? 0.5;
    const spread = o.spread ?? Math.PI * 2;
    const angle = o.angle ?? 0;
    const gravity = o.gravity ?? 0;
    const drag = o.drag ?? DRAG_PER_SECOND;
    const ring = !!o.ring;
    const radius = o.radius ?? 0;
    const speedJitter = o.speedJitter ?? 0.4;

    // Parse the colour ONCE (not per particle). Accept [r,g,b], number, or css.
    let r, g, b;
    if (Array.isArray(o.color)) {
      r = o.color[0] ?? 1; g = o.color[1] ?? 1; b = o.color[2] ?? 1;
    } else {
      this._scratch.set(o.color ?? COLOR.CRIMSON);
      r = this._scratch.r; g = this._scratch.g; b = this._scratch.b;
    }

    for (let n = 0; n < count; n++) {
      const i = this._cursor;
      this._cursor = (this._cursor + 1) % CAPACITY; // ring-recycle the oldest slot

      // Direction: even spokes for a ring, a randomised cone otherwise.
      const theta = ring
        ? angle + (n / count) * Math.PI * 2
        : angle + (Math.random() - 0.5) * spread;
      const dx = Math.cos(theta);
      const dy = Math.sin(theta);
      const spd = speed * (1 - Math.random() * speedJitter);

      const i3 = i * 3;
      this.aPos[i3] = x + dx * radius;
      this.aPos[i3 + 1] = y + dy * radius;
      this.aPos[i3 + 2] = 0;                 // gameplay plane
      this.vel[i3] = dx * spd;
      this.vel[i3 + 1] = dy * spd;
      this.vel[i3 + 2] = 0;

      // A little per-particle brightness variety keeps a burst from looking flat.
      const bright = 0.8 + Math.random() * 0.4;
      this.baseCol[i3] = r * bright;
      this.baseCol[i3 + 1] = g * bright;
      this.baseCol[i3 + 2] = b * bright;
      this.aCol[i3] = this.baseCol[i3];
      this.aCol[i3 + 1] = this.baseCol[i3 + 1];
      this.aCol[i3 + 2] = this.baseCol[i3 + 2];

      const sz = size * (0.7 + Math.random() * 0.6);
      this.baseSize[i] = sz;
      this.aSize[i] = sz;

      const lf = life * (0.75 + Math.random() * 0.4);
      this.life[i] = lf;
      this.maxLife[i] = lf;
      this.grav[i] = gravity;
      this.drag[i] = drag;
    }
  }

  // ── Per-frame integration (hot loop; strictly allocation-free) ────────────

  /**
   * Advance every live particle by `frameDt` real seconds, fade + shrink it toward
   * death, recycle the expired, and flag the GPU buffers for a single re-upload.
   */
  update(frameDt) {
    let dt = frameDt;
    if (dt > MAX_STEP) dt = MAX_STEP; // guard the catch-up frame (see MAX_STEP)
    if (dt <= 0) return;

    const drags = this.drag;
    let touched = false;

    for (let i = 0; i < CAPACITY; i++) {
      const l = this.life[i];
      if (l <= 0) continue;          // dead slot — skip
      touched = true;

      const nl = l - dt;
      if (nl <= 0) {
        // Death: zero the size so the vertex shader emits a 0-pixel point (nothing
        // rasterised) and the slot renders inert until recycled.
        this.life[i] = 0;
        this.aSize[i] = 0;
        continue;
      }
      this.life[i] = nl;

      const i3 = i * 3;
      // Integrate velocity (gravity) then position.
      this.vel[i3 + 1] -= this.grav[i] * dt;
      this.aPos[i3] += this.vel[i3] * dt;
      this.aPos[i3 + 1] += this.vel[i3 + 1] * dt;

      // Air drag — bleed a fraction of velocity per second (clamped so a fat dt
      // can't invert the sign).
      const d = 1 - Math.min(1, drags[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] *= d;

      // Fade: RGB toward black == alpha toward 0 under additive blending.
      const fade = nl / this.maxLife[i];
      this.aCol[i3] = this.baseCol[i3] * fade;
      this.aCol[i3 + 1] = this.baseCol[i3 + 1] * fade;
      this.aCol[i3 + 2] = this.baseCol[i3 + 2] * fade;

      // Shrink a touch as it dies so the tail feels like it's burning out.
      this.aSize[i] = this.baseSize[i] * (0.35 + 0.65 * fade);
    }

    // One upload for the whole system. When nothing was live (or died) this frame
    // we skip it entirely — an idle ParticleSystem costs zero GPU traffic.
    if (touched) {
      this._posAttr.needsUpdate = true;
      this._colAttr.needsUpdate = true;
      this._sizeAttr.needsUpdate = true;
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  destroy() {
    this._offs.forEach((off) => { try { off(); } catch { /* already gone */ } });
    this._offs.length = 0;
    if (this._points && this.scene) this.scene.remove(this._points);
    this._geo?.dispose();
    this._mat?.dispose();
    this._sprite?.dispose();
    this._points = null;
  }
}
