import {
  Group, Mesh, IcosahedronGeometry, BoxGeometry, PlaneGeometry, ConeGeometry,
  CylinderGeometry, TorusGeometry, MeshStandardMaterial, Color,
} from 'three';
import { Entity } from '../Entity.js';
import { BOSS, EVENT, clamp01, lerp } from '../../config/Constants.js';
import { SkullEyeMaterial } from '../../render/shaders/SkullEyeMaterial.js';
import { NeonMaterial, makeGlowMaterial } from '../../render/shaders/NeonMaterial.js';

const PHASE = Object.freeze({ INTRO: 'intro', ONE: 'p1', TWO: 'p2', THREE: 'p3', DEAD: 'dead' });

/**
 * DjSkullBoss.js — the final boss: the DJ inside a giant skull booth, white
 * shades, glowing red eyes, a chili pepper in its teeth. A RHYTHM boss: every
 * attack lands on the beat (it subscribes to EVENT.BEAT), so the fight is a
 * pattern to learn, not a reflex check.
 *
 * PHASES (gated on HP):
 *   1  Soundwave shockwaves on a 2-beat pulse. Telegraph → fire → EXPOSED.
 *   2  Adds falling vinyls and the first strobe blinds.
 *   3  Enraged: dense shockwaves + vinyls, long strobes, shorter exposure.
 *
 * You only deal damage during the EXPOSED window (jaw dropped, chili white-hot).
 * The mesh here is a stylised procedural build so the scene is complete out of
 * the box; swap in a sculpted GLTF via loadModel() without touching the fight.
 */
export class DjSkullBoss extends Entity {
  constructor(ctx, { x = 0, y = 4 } = {}) {
    super(x, y);
    this.type = 'boss';
    this.ctx = ctx;

    this.health = BOSS.MAX_HEALTH;
    this.phase = PHASE.INTRO;
    this.vulnerable = false;

    // Unified interaction contract (see GameplayScene): the booth body hurts on
    // contact; the boss is only `harmable` while exposed (guarded in takeDamage).
    this.hurtsPlayer = true;
    this.contactDamage = BOSS.CONTACT_DAMAGE;
    this.knockback = 8;
    this.harmable = true;
    this.beat = 0;
    this._introBeats = 4;
    this._phaseStartBeat = 0;     // beat at which the current phase's cycle began
    this._strobeOffAt = 0;        // sim-seconds to lower the strobe
    this._jawOpen = 0;            // 0..1 animated jaw
    this._jawTarget = 0;
    this._t = 0;

    this._buildView();

    // The fight is driven entirely off the music clock.
    this._offBeat = ctx.bus.on(EVENT.BEAT, (b) => this._onBeat(b));
  }

  // ── Procedural booth build ────────────────────────────────────────────────

  _buildView() {
    const g = new Group();
    g.position.set(this.x, this.y, -0.5);

    // Booth shell: dark box with a neon-lit rim (the DJ stand).
    const boothMat = new MeshStandardMaterial({ color: 0x120309, roughness: 0.8, metalness: 0.1 });
    const booth = new Mesh(new BoxGeometry(9, 5, 3), boothMat);
    booth.position.set(0, -3.2, -0.4);
    g.add(booth);

    const rimNeon = this.ctx.renderer.lighting.registerNeon(new NeonMaterial({ color: 0xff1030, intensity: 3.2, flicker: 0.08 }));
    const rim = new Mesh(new TorusGeometry(5.2, 0.12, 12, 48), rimNeon);
    rim.position.set(0, -1.5, 1.2);
    rim.scale.set(1, 0.55, 1);
    g.add(rim);

    // Skull cranium.
    const boneMat = new MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.55, emissive: new Color(0x1a0206), emissiveIntensity: 0.4 });
    const cranium = new Mesh(new IcosahedronGeometry(3.1, 4), boneMat);
    cranium.scale.set(1.05, 1.15, 0.9);
    g.add(cranium);

    // Jaw (animated open/close). Pivoted at its top edge.
    this.jaw = new Group();
    this.jaw.position.set(0, -2.1, 0.4);
    const jawMesh = new Mesh(new BoxGeometry(3.6, 1.4, 1.8), boneMat);
    jawMesh.position.set(0, -0.7, 0);
    this.jaw.add(jawMesh);
    g.add(this.jaw);

    // Eye sockets: dark recesses…
    const socketMat = new MeshStandardMaterial({ color: 0x050505, roughness: 1 });
    for (const sx of [-1.15, 1.15]) {
      const socket = new Mesh(new IcosahedronGeometry(0.95, 2), socketMat);
      socket.position.set(sx, 0.5, 1.9);
      socket.scale.set(1, 1.1, 0.5);
      g.add(socket);
    }
    // …with glowing red eyes inside.
    this.eyeMat = this.ctx.renderer.lighting.registerNeon(new SkullEyeMaterial({ color: 0xff1524 }));
    for (const sx of [-1.15, 1.15]) {
      const eye = new Mesh(new PlaneGeometry(1.4, 1.0), this.eyeMat);
      eye.position.set(sx, 0.5, 2.35);
      g.add(eye);
    }

    // White shades across the eyes (iconic). Slightly transparent so eyes bleed through.
    const shadeMat = new MeshStandardMaterial({
      color: 0xffffff, emissive: new Color(0xffffff), emissiveIntensity: 0.5,
      roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.82, toneMapped: false,
    });
    const shades = new Mesh(new BoxGeometry(3.6, 0.85, 0.2), shadeMat);
    shades.position.set(0, 0.5, 2.5);
    g.add(shades);

    // Red-hot chili pepper clenched in the teeth. Glows WHITE when exposed.
    this.chiliMat = makeGlowMaterial(0xff0a1e, 1.0);
    const chili = new Mesh(new ConeGeometry(0.28, 1.8, 12), this.chiliMat);
    chili.position.set(0.2, -1.7, 2.2);
    chili.rotation.set(0, 0, Math.PI * 0.62);
    g.add(chili);
    const stem = new Mesh(new CylinderGeometry(0.05, 0.05, 0.5, 6), new MeshStandardMaterial({ color: 0x113a0f }));
    stem.position.set(1.0, -1.35, 2.2);
    stem.rotation.z = Math.PI * 0.35;
    g.add(stem);

    this.view = g;
    this.ctx.renderer.scene.add(g);
  }

  /** Optional: replace the procedural skull with a sculpted GLTF at runtime. */
  async loadModel(url) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    // Keep the animated jaw/eye/chili references by naming convention in the DCC:
    // nodes "Jaw", "EyeL"/"EyeR", "Chili". Wire them here, then swap the view.
    return gltf;
  }

  // ── Fight logic (beat-driven) ─────────────────────────────────────────────

  _phaseCfg() {
    if (this.phase === PHASE.THREE) return BOSS.PHASES.THREE;
    if (this.phase === PHASE.TWO) return BOSS.PHASES.TWO;
    return BOSS.PHASES.ONE;
  }

  _onBeat() {
    this.beat++;
    this.eyeMat.pulse();

    if (this.phase === PHASE.INTRO) {
      if (this.beat >= this._introBeats) this._enterPhase(PHASE.ONE);
      return;
    }
    if (this.phase === PHASE.DEAD) return;

    const cfg = this._phaseCfg();
    // Position within the phase's attack→expose cycle.
    const cycle = cfg.cycleBeats ?? 6;
    const attackBeats = cfg.attackBeats ?? 4;
    const pos = (((this.beat - this._phaseStartBeat) % cycle) + cycle) % cycle;

    if (pos >= attackBeats) {
      // EXPOSED — jaw drops, chili glows, the only window damage lands.
      this._setExposed(true);
      return;
    }

    // ATTACK portion.
    this._setExposed(false);
    const every = cfg.shockwaveEveryBeats ?? 2;
    if (pos % every === 0) {
      this._fireShockwave();                 // fire on the beat
      this._jawTarget = 0.15;
    } else if ((pos + 1) % every === 0 && pos + 1 < attackBeats) {
      this._jawTarget = 0.35;                // telegraph the beat before a fire
    }

    // Phase 2+: falling vinyls (during the attack portion only).
    if (cfg.vinylEveryBeats != null) {
      const v = cfg.vinylEveryBeats;
      const count = v < 1 ? Math.max(1, Math.round(1 / v)) : (pos % v === 0 ? 1 : 0);
      for (let i = 0; i < count; i++) this._dropVinyl(i, count);
    }

    // Strobe blinds on cadence (kept out of the exposed window so you can see to punish).
    if (cfg.strobeEveryBeats != null && pos % cfg.strobeEveryBeats === 0) {
      this._strobe();
    }
  }

  _fireShockwave() {
    const dir = this.ctx.player ? Math.sign(this.ctx.player.x - this.x) || 1 : 1;
    this.ctx.bus.emit(EVENT.BOSS_SHOCKWAVE, {
      x: this.x, y: this.y - 1.5, dir, speed: this._phaseCfg().shockwaveSpeed ?? 11,
    });
  }

  _dropVinyl(i, count) {
    const px = this.ctx.player ? this.ctx.player.x : 0;
    // Spread the volley across the player's neighbourhood so it must be dodged.
    const spread = (i - (count - 1) / 2) * 2.4 + (Math.random() * 1.2 - 0.6);
    this.ctx.bus.emit(EVENT.BOSS_VINYL, {
      x: px + spread, y: this.y + 6, vx: 0, vy: -(this._phaseCfg().vinylFallSpeed ?? 14),
    });
  }

  _strobe() {
    this.ctx.bus.emit(EVENT.BOSS_STROBE, { on: true });
    this._strobeOffAt = this._t + BOSS.STROBE_DURATION;
  }

  _setExposed(on) {
    if (this.vulnerable === on) return;
    this.vulnerable = on;
    this._jawTarget = on ? 0.85 : 0.15;
    this.ctx.bus.emit(EVENT.BOSS_VULNERABLE, { on });
  }

  _enterPhase(p) {
    this.phase = p;
    this._phaseStartBeat = this.beat;   // restart the attack→expose cycle cleanly
    const rage = p === PHASE.THREE ? 1 : p === PHASE.TWO ? 0.5 : 0.15;
    this.eyeMat.rage = rage;
    this.ctx.bus.emit(EVENT.BOSS_PHASE, { phase: p === PHASE.THREE ? 3 : p === PHASE.TWO ? 2 : 1 });
  }

  /** AABB around the skull for melee overlap + player contact. */
  aabb() { return { x: this.x, y: this.y, hw: 2.6, hh: 2.8 }; }

  /** Unified melee response; boss only takes damage while exposed. */
  onPlayerHit({ damage = 1 } = {}) { return this.takeDamage(damage); }

  takeDamage(dmg) {
    if (!this.vulnerable || this.phase === PHASE.DEAD) return false;
    this.health = Math.max(0, this.health - dmg);
    this.ctx.bus.emit(EVENT.BOSS_HURT, { health: this.health, x: this.x, y: this.y });
    this._hurtFlash = 0.12;

    const f = this.health / BOSS.MAX_HEALTH;
    if (f <= BOSS.PHASES.THREE.hpThreshold && this.phase !== PHASE.THREE) this._enterPhase(PHASE.THREE);
    else if (f <= BOSS.PHASES.TWO.hpThreshold && this.phase === PHASE.ONE) this._enterPhase(PHASE.TWO);

    if (this.health <= 0) this._defeat();
    return true;
  }

  _defeat() {
    this.phase = PHASE.DEAD;
    this._setExposed(false);
    this.ctx.bus.emit(EVENT.BOSS_STROBE, { on: false });
    this.ctx.bus.emit(EVENT.BOSS_DEFEATED, {});
  }

  // ── Per-step + render ──────────────────────────────────────────────────────

  fixedUpdate(dt) {
    this.snapshot();
    this._t += dt;
    if (this._strobeOffAt && this._t >= this._strobeOffAt) {
      this._strobeOffAt = 0;
      this.ctx.bus.emit(EVENT.BOSS_STROBE, { on: false });
    }
    // Ease the jaw toward its target.
    this._jawOpen += (this._jawTarget - this._jawOpen) * Math.min(1, 12 * dt);
    if (this._hurtFlash > 0) this._hurtFlash -= dt;
  }

  update() {
    // Drive procedural motion in render for smoothness.
    if (this.jaw) this.jaw.rotation.x = -this._jawOpen * 0.5;
    if (this.view) {
      const bob = Math.sin(this._t * 1.5) * 0.15;
      this.view.position.set(this.x, this.y + bob, this.view.position.z); // idle bob
    }
    // Chili glows white while exposed — the "hit me" tell.
    if (this.chiliMat) {
      const hot = this.vulnerable ? 1 : 0;
      const c = this.chiliMat.emissive;
      c.setRGB(1, lerp(0.05, 0.95, hot) + (this._hurtFlash > 0 ? 0.4 : 0), lerp(0.1, 0.9, hot));
      this.chiliMat.emissiveIntensity = 3 + hot * 2;
    }
  }

  /** The boss is stationary + procedurally animated, so it owns its transform
   *  entirely (see update()). Overriding prevents Entity.syncView from clobbering
   *  the idle bob with the raw sim position each frame. */
  syncView() {}

  destroy() {
    this._offBeat?.();
    super.destroy();
  }
}

/**
 * wireBossFX — the CONDUCTOR. Subscribes the boss's high-level events to the
 * post / lighting / camera systems, so the boss never imports a renderer. Call
 * once when the boss fight starts; call the returned thunk to tear it down.
 */
export function wireBossFX(ctx) {
  const post = ctx.renderer.postfx;
  const light = ctx.renderer.lighting;
  const cam = ctx.renderer.cameraRig;
  const offs = [
    ctx.bus.on(EVENT.BOSS_SHOCKWAVE, ({ x, y }) => { post.triggerShockwave(x, y, 0); cam.addTrauma(0.55); }),
    ctx.bus.on(EVENT.BOSS_STROBE, ({ on }) => { light.setStrobe(on); post.setStrobe(on); post.setGlitch(on); }),
    ctx.bus.on(EVENT.BOSS_PHASE, ({ phase }) => { post.pulseBloom(0.9); post.pulseChroma(1.6); cam.addTrauma(0.6); post.setGlitch(phase >= 3, phase >= 3); }),
    ctx.bus.on(EVENT.BOSS_HURT, () => { post.pulseBloom(0.4); cam.addTrauma(0.2); }),
    ctx.bus.on(EVENT.BOSS_DEFEATED, () => { light.setStrobe(false); post.setStrobe(false); post.setGlitch(false); cam.addTrauma(0.9); }),
  ];
  return () => offs.forEach((o) => o());
}
