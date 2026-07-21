import { Entity } from './Entity.js';
import { CharacterMotor } from '../physics/CharacterMotor.js';
import {
  MOVE, JUMP, GROWTH, PLAYER, FX, ACTIONS, EVENT, LAYER,
  deriveJump, lerp, clamp, clamp01,
} from '../config/Constants.js';

/** Player movement/behaviour states. Locomotion (grounded vs air) is continuous
 *  and handled by physics; these are the *gating* states that own the frame. */
const S = Object.freeze({
  IDLE: 'idle', RUN: 'run', RISE: 'rise', FALL: 'fall',
  ATTACK: 'attack', HURT: 'hurt', DEAD: 'dead',
});

const moveToward = (cur, target, maxDelta) => {
  if (cur < target) return Math.min(cur + maxDelta, target);
  if (cur > target) return Math.max(cur - maxDelta, target);
  return cur;
};

/** Base melee knockback at base size; scaled up by the growth engine. */
const MELEE_KNOCKBACK_BASE = 6.0;

/**
 * Player.js — the hero. Two responsibilities fused:
 *
 *   (A) GAME-FEEL LOCOMOTION — a movement FSM with every non-negotiable of a
 *       tight platformer: coyote time, jump buffering, asymmetric rise/fall
 *       gravity, an apex hang, variable jump height, turn assist, and ice-aware
 *       traction. Velocities are integrated by hand and resolved by the kinematic
 *       CharacterMotor, never by a rigid-body solver.
 *
 *   (B) THE GROWTH ENGINE — collecting cocktails and vinyls raises a growth
 *       charge; the body scale springs toward a target, and from the derived
 *       WEIGHT every stat bends: heavier = slower to accelerate, more momentum,
 *       harder-hitting, longer reach, and a heavier fall. The collider resizes
 *       from the feet and is refused under low ceilings until there's clearance.
 *
 * All feedback is emitted on the bus (jump, land, grow, hurt, attack) so audio,
 * particles and the camera react without Player knowing they exist.
 */
export class Player extends Entity {
  constructor(ctx, { x, y, character = 'male' } = {}) {
    super(x, y);
    this.type = 'player';
    this.ctx = ctx;
    this.character = character;

    this.motor = new CharacterMotor(ctx.physics, {
      x, y, halfWidth: PLAYER.HALF_WIDTH, halfHeight: PLAYER.HALF_HEIGHT,
      layer: LAYER.PLAYER, entity: this,
    });

    // Kinematics.
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.grounded = false;

    // Feel timers (counted in FIXED steps except where noted).
    this._coyote = 0;
    this._airJumps = JUMP.MAX_AIR_JUMPS;
    this._rising = false;
    this._jumpCut = false;

    // Combat.
    this.health = PLAYER.MAX_HEALTH;
    this._iframes = 0;      // seconds
    this._attackT = 0;      // seconds remaining in attack
    this._attackCd = 0;     // seconds
    this._hurtT = 0;        // seconds

    // Growth.
    this.charge = 0;
    this.scale = GROWTH.SCALE_MIN;
    this._targetScale = GROWTH.SCALE_MIN;
    this._scaleVel = 0;
    this._colliderScale = GROWTH.SCALE_MIN;
    this.tier = 0;

    // Surface interaction, set each step by the scene from the floor under the feet:
    //  tractionMultiplier → scales accel/decel  (ICE: →0.12, makes you SKID/slide)
    //  speedMultiplier    → caps top speed      (GLASS: →0.7, makes you WADE/slow)
    // They are different feels on purpose: ice is slippery, glass is sticky.
    this.tractionMultiplier = 1;
    this.speedMultiplier = 1;

    // Cosmetic squash-and-stretch (render-space, non-uniform).
    this.squashX = 1; this.squashY = 1;

    // Jump-arc telemetry (measured in the fixed sim → render-rate-independent).
    // Read by the F1 DebugOverlay for tuning by feel. Cheap; a few numbers.
    this.lastJumpApex = 0; this.lastJumpAir = 0;
    this._jumpPeak = 0; this._airFrames = 0; this._launchFeet = 0;

    this.state = S.IDLE;
    this._stats = null;
    this._recomputeStats();
  }

  // ── Growth engine ────────────────────────────────────────────────────────

  addGrowth(amount) {
    this.charge = clamp(this.charge + amount, GROWTH.CHARGE_MIN, GROWTH.CHARGE_MAX);
    const t = clamp01((this.charge - GROWTH.CHARGE_MIN) / (GROWTH.CHARGE_MAX - GROWTH.CHARGE_MIN));
    // Curve the mapping slightly (ease-out) so early pickups feel generous.
    this._targetScale = lerp(GROWTH.SCALE_MIN, GROWTH.SCALE_MAX, Math.pow(t, 0.85));

    const newTier = Math.floor(this.charge / GROWTH.CHARGE_PER_TIER);
    if (newTier !== this.tier) {
      this.tier = newTier;
      this.ctx.bus.emit(EVENT.PLAYER_GROW, { tier: this.tier, scale: this._targetScale });
      this.ctx.bus.emit(EVENT.HITSTOP, { seconds: FX.HITSTOP_LIGHT });
    }
  }

  /** Normalized weight 0..1 (super-linear in scale) → drives every bent stat. */
  get weightT() {
    const w = Math.pow(this.scale, GROWTH.WEIGHT_EXPONENT);
    const wmin = Math.pow(GROWTH.SCALE_MIN, GROWTH.WEIGHT_EXPONENT);
    const wmax = Math.pow(GROWTH.SCALE_MAX, GROWTH.WEIGHT_EXPONENT);
    return clamp01((w - wmin) / (wmax - wmin));
  }

  _recomputeStats() {
    const t = this.weightT;
    const jump = deriveJump(t);
    this._stats = {
      maxSpeed: MOVE.MAX_SPEED * lerp(1, GROWTH.MAXSPEED_AT_HEAVY, t),
      groundAccel: MOVE.GROUND_ACCEL * lerp(1, GROWTH.ACCEL_AT_HEAVY, t),
      groundDecel: MOVE.GROUND_DECEL * lerp(1, GROWTH.DECEL_AT_HEAVY, t),
      airAccel: MOVE.AIR_ACCEL * lerp(1, GROWTH.AIR_CONTROL_AT_HEAVY, t),
      airDecel: MOVE.AIR_DECEL * lerp(1, GROWTH.AIR_CONTROL_AT_HEAVY, t),
      turnAssist: MOVE.TURN_ASSIST * lerp(1, GROWTH.TURN_ASSIST_AT_HEAVY, t),
      launch: jump.launchVelocity,
      riseG: jump.riseGravity,
      fallG: jump.fallGravity,
      terminal: jump.terminal,
      attackRange: PLAYER.ATTACK_RANGE * lerp(1, GROWTH.ATTACK_RANGE_AT_HEAVY, t),
      knockback: MELEE_KNOCKBACK_BASE * lerp(1, GROWTH.ATTACK_KNOCKBACK_AT_HEAVY, t),
    };
  }

  _updateGrowth(dt) {
    // Critically-damped spring toward the target scale — weighty, no overshoot.
    const o = GROWTH.SCALE_SMOOTH_OMEGA;
    const dx = this.scale - this._targetScale;
    const accel = -2 * o * this._scaleVel - o * o * dx;
    this._scaleVel += accel * dt;
    this.scale += this._scaleVel * dt;

    // Try to bring the collider to the visual scale — feet-anchored, clearance-safe.
    const hx = PLAYER.HALF_WIDTH * this.scale;
    const hy = PLAYER.HALF_HEIGHT * this.scale;
    const applied = this.motor.setSizeAnchoredToFeet(hx, hy, { safe: true });
    if (applied) {
      this._colliderScale = this.scale;
    } else if (this.scale > this._colliderScale) {
      // Blocked by a ceiling: freeze visual growth at the last safe size so the
      // sprite never clips into the roof. Growth resumes once there's headroom.
      this.scale = this._colliderScale;
      this._scaleVel = 0;
    }
    this._recomputeStats();
  }

  // ── Combat surface ───────────────────────────────────────────────────────

  attack() {
    if (this._attackCd > 0 || this.state === S.HURT || this.state === S.DEAD) return;
    this.state = S.ATTACK;
    this._attackT = PLAYER.ATTACK_ACTIVE + PLAYER.ATTACK_RECOVERY;
    this._attackCd = PLAYER.ATTACK_COOLDOWN;

    const reach = this.motor.hx + this._stats.attackRange * this.scale;
    const cx = this.x + this.facing * (this.motor.hx + reach * 0.5);
    this.ctx.bus.emit(EVENT.PLAYER_ATTACK, {
      x: cx, y: this.y,
      hw: reach * 0.5, hh: this.motor.hy * 0.9,
      facing: this.facing,
      knockback: this._stats.knockback,
      damage: 2 + this.tier, // bigger hits harder (2..7 across growth tiers)
    });
  }

  takeHit({ damage = 1, knockbackX = 0, knockbackY = 4 }) {
    if (this._iframes > 0 || this.state === S.DEAD) return;
    this.health -= damage;
    this._iframes = PLAYER.IFRAMES;
    this._hurtT = 0.28;
    this.vx = knockbackX;
    this.vy = knockbackY;
    this.grounded = false;
    this.state = S.HURT;
    this.ctx.bus.emit(EVENT.PLAYER_HURT, { health: this.health });
    this.ctx.bus.emit(EVENT.HITSTOP, { seconds: FX.HITSTOP_HEAVY });
    this.ctx.bus.emit(EVENT.CAMERA_SHAKE, { trauma: 0.5 });
    if (this.health <= 0) this._die();
  }

  /** Damage-over-time (broken glass) — no knockback, no long i-frames. */
  takeDoT(amount) {
    if (this.state === S.DEAD) return;
    this.health -= amount;
    this.ctx.bus.emit(EVENT.PLAYER_HURT, { health: this.health, dot: true });
    if (this.health <= 0) this._die();
  }

  _die() {
    this.state = S.DEAD;
    this.vx = 0; this.vy = 6; // little death-pop
    this.ctx.bus.emit(EVENT.PLAYER_DIED, {});
    this.ctx.bus.emit(EVENT.CAMERA_SHAKE, { trauma: 0.9 });
  }

  // ── Fixed-step simulation ────────────────────────────────────────────────

  fixedUpdate(dt) {
    this.snapshot();
    const input = this.ctx.input;

    // Timers.
    if (this._iframes > 0) this._iframes -= dt;
    if (this._attackCd > 0) this._attackCd -= dt;

    this._updateGrowth(dt);

    switch (this.state) {
      case S.DEAD: this._simDead(dt); break;
      case S.HURT: this._simHurt(dt, input); break;
      case S.ATTACK: this._simAttack(dt, input); break;
      default: this._simNormal(dt, input); break;
    }

    // Attack input can be issued from any non-locked state.
    if (input.pressed(ACTIONS.ATTACK)) this.attack();
  }

  _simNormal(dt, input) {
    const st = this._stats;
    const wantX = input.moveX();
    if (Math.abs(wantX) > 0.01) this.facing = Math.sign(wantX);

    this._horizontal(dt, wantX, st, this.grounded);
    this._jumpAndGravity(dt, input, st);
    this._resolve(dt);

    // Pose for animation.
    if (!this.grounded) this.state = this.vy > 0 ? S.RISE : S.FALL;
    else this.state = Math.abs(this.vx) > 0.4 ? S.RUN : S.IDLE;
  }

  _simAttack(dt, input) {
    const st = this._stats;
    // Reduced steering while committed to the swing.
    this._horizontal(dt, input.moveX() * 0.4, st, this.grounded);
    this._jumpAndGravity(dt, input, st, /*allowJump=*/false);
    this._resolve(dt);
    this._attackT -= dt;
    if (this._attackT <= 0) this.state = this.grounded ? S.IDLE : S.FALL;
  }

  _simHurt(dt, input) {
    const st = this._stats;
    // Air-drag only; no active control during the flinch.
    this.vx = moveToward(this.vx, 0, st.airDecel * 0.5 * dt);
    this._gravity(dt, st);
    this._resolve(dt);
    this._hurtT -= dt;
    if (this._hurtT <= 0) this.state = this.grounded ? S.IDLE : S.FALL;
  }

  _simDead(dt) {
    this._gravity(dt, this._stats);
    this._resolve(dt);
  }

  // ── Locomotion primitives ────────────────────────────────────────────────

  _horizontal(dt, wantX, st, grounded) {
    const traction = grounded ? this.tractionMultiplier : 1;
    const accel = (grounded ? st.groundAccel : st.airAccel) * traction;
    const decel = (grounded ? st.groundDecel : st.airDecel) * traction;

    if (Math.abs(wantX) < 0.01) {
      this.vx = moveToward(this.vx, 0, decel * dt);
      if (Math.abs(this.vx) < MOVE.STOP_EPSILON) this.vx = 0;
    } else {
      const target = clamp(wantX, -1, 1) * st.maxSpeed * (grounded ? this.speedMultiplier : 1);
      const opposing = Math.sign(target) !== Math.sign(this.vx) && Math.abs(this.vx) > 0.05;
      // A hard direction-flip gets accel PLUS a turn-assist decel so the pivot
      // is crisp instead of mushy — the difference between "responsive" and "ok".
      const rate = opposing ? accel + decel * st.turnAssist : accel;
      this.vx = moveToward(this.vx, target, rate * dt);
    }
  }

  _jumpAndGravity(dt, input, st, allowJump = true) {
    // Coyote-time bookkeeping happens in _resolve; here we act on it.
    const canJump = allowJump && (this.grounded || this._coyote > 0 || this._airJumps > 0);
    if (canJump && input.consumeBuffered(ACTIONS.JUMP, JUMP.BUFFER_FRAMES)) {
      const fromGround = this.grounded || this._coyote > 0;
      this.vy = st.launch;
      this.grounded = false;
      this._coyote = 0;
      this._rising = true;
      this._jumpCut = false;
      if (!fromGround) this._airJumps--;
      this._squash(FX.SQUASH_JUMP);
      this.ctx.bus.emit(EVENT.PLAYER_JUMP, { x: this.x, y: this.y });
    }

    // Variable height: release while rising cuts the ascent short.
    if (this._rising && this.vy > 0 && !this._jumpCut && !input.held(ACTIONS.JUMP)) {
      this.vy *= JUMP.CUT_MULTIPLIER;
      this._jumpCut = true;
    }
    if (this.vy <= 0) this._rising = false;

    this._gravity(dt, st);
  }

  _gravity(dt, st) {
    if (this.grounded && this.vy <= 0) {
      this.vy = -2; // constant press into the floor keeps snap-to-ground stable
      return;
    }
    let g = this.vy > 0 ? st.riseG : st.fallG;
    // Apex hang: soften gravity near the top so the arc "floats" for a beat.
    if (Math.abs(this.vy) < JUMP.APEX_HANG_VELOCITY) g *= JUMP.APEX_HANG_GRAVITY_MULT;
    this.vy -= g * dt;
    if (this.vy < -st.terminal) this.vy = -st.terminal;
  }

  _resolve(dt) {
    const wasAir = !this.grounded;
    const res = this.motor.move(this.vx * dt, this.vy * dt);
    this.x = this.motor.x;
    this.y = this.motor.y;

    if (res.wall !== 0 && Math.sign(this.vx) === res.wall) this.vx = 0;
    if (res.ceiling && this.vy > 0) { this.vy = 0; this._rising = false; }

    // Ground transition + coyote refresh.
    if (res.grounded) {
      if (wasAir && this.vy < -6) {
        // Meaningful landing: squash, dust, a touch of shake proportional to fall.
        this._squash(FX.SQUASH_LAND);
        this.ctx.bus.emit(EVENT.PLAYER_LAND, { x: this.x, y: this.y, impact: -this.vy });
        this.ctx.bus.emit(EVENT.CAMERA_SHAKE, { trauma: Math.min(0.3, -this.vy * 0.012) });
      }
      this._coyote = JUMP.COYOTE_FRAMES;
      this._airJumps = JUMP.MAX_AIR_JUMPS;
    } else if (wasAir && this._coyote > 0) {
      // Only start counting DOWN once we've been airborne for a full step. If we
      // decremented on the very frame we left the ledge, the constant would lie
      // by one frame (COYOTE_FRAMES=6 would grant only 5). This makes 6 mean 6.
      this._coyote--;
    }

    // Jump-arc telemetry, measured against the surface we left from.
    if (!wasAir && !res.grounded) { this._launchFeet = this.motor.feetY; this._jumpPeak = 0; this._airFrames = 0; }
    if (!res.grounded) { this._airFrames++; this._jumpPeak = Math.max(this._jumpPeak, this.motor.feetY - this._launchFeet); }
    if (wasAir && res.grounded) { this.lastJumpApex = this._jumpPeak; this.lastJumpAir = this._airFrames * dt; }

    this.grounded = res.grounded;
  }

  _squash({ x, y }) { this.squashX = x; this.squashY = y; }

  // ── Render-frame (cosmetic) ──────────────────────────────────────────────

  update(frameDt) {
    // Ease squash/stretch back to neutral. Cosmetic → render-rate is fine.
    const k = Math.min(1, FX.SQUASH_RECOVER * frameDt);
    this.squashX += (1 - this.squashX) * k;
    this.squashY += (1 - this.squashY) * k;
  }

  /** Override to layer growth-scale × squash × facing-flip onto the view. */
  syncView(alpha) {
    if (!this.view) return;
    const ax = this.prevX + (this.x - this.prevX) * alpha;
    const ay = this.prevY + (this.y - this.prevY) * alpha;
    const as = this.prevScale + (this.scale - this.prevScale) * alpha;
    this.view.position.set(ax, ay, this.view.position.z);
    this.view.scale.set(as * this.squashX * this.facing, as * this.squashY, as);
    // Flicker during i-frames so a hit reads instantly.
    this.view.visible = !(this._iframes > 0 && Math.floor(this._iframes * 30) % 2 === 0);
  }

  get isDead() { return this.state === S.DEAD; }

  /** Current growth-derived locomotion stats (read-only; for the debug overlay). */
  get stats() { return this._stats; }

  /** Reset to a spawn point. Keeps accumulated growth (you stay big). */
  respawn(x, y) {
    this.motor.teleport(x, y);
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.vx = 0; this.vy = 0;
    this.grounded = false;
    this.health = PLAYER.MAX_HEALTH;
    this.state = S.IDLE;
    this._iframes = 1.2;
    this._attackT = 0;
    this._hurtT = 0;
  }

  destroy() {
    this.motor.destroy();
    super.destroy();
  }
}
