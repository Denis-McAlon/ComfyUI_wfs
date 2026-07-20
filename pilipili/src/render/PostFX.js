import {
  EffectComposer, RenderPass, EffectPass,
  BloomEffect, ChromaticAberrationEffect, VignetteEffect,
  NoiseEffect, ScanlineEffect, GlitchEffect, ShockWaveEffect,
  ToneMappingEffect, ToneMappingMode, GlitchMode, BlendFunction,
} from 'postprocessing';
import { Vector2, Vector3, HalfFloatType } from 'three';
import { FX, BOSS } from '../config/Constants.js';
import { CrimsonGradeEffect } from './shaders/CrimsonGradeEffect.js';

/**
 * PostFX.js — the "saturated crimson club" screen pipeline.
 *
 * Built on pmndrs/postprocessing (not three's stock EffectComposer) because it
 * MERGES compatible effects into a single fullscreen pass, does mip-map bloom,
 * and ships the exact effects the brief asks for. Pass order, front to back:
 *
 *   RenderPass                     draw the neon scene into an HDR buffer
 *   ├─ EffectPass  (main)          bloom → chromatic aberration → crimson grade → ACES
 *   ├─ EffectPass  (distort)       pooled shockwaves → glitch      (boss FX, toggled)
 *   └─ EffectPass  (overlay)       scanlines → vignette → film grain (CRT surface)
 *
 * An HDR (HalfFloat) buffer is essential: emissive neon exceeds 1.0 and bloom
 * needs those over-bright values to bleed convincingly.
 */
export class PostFX {
  constructor(webgl, scene, camera) {
    this.webgl = webgl;
    this.scene = scene;
    this.camera = camera;

    this.composer = new EffectComposer(webgl, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));

    // ── Main grade pass ─────────────────────────────────────────────
    this.bloom = new BloomEffect({
      intensity: FX.BLOOM.intensity,
      luminanceThreshold: FX.BLOOM.luminanceThreshold,
      luminanceSmoothing: FX.BLOOM.luminanceSmoothing,
      radius: FX.BLOOM.radius,
      mipmapBlur: FX.BLOOM.mipmapBlur,
    });
    this._bloomBase = FX.BLOOM.intensity;

    this.chroma = new ChromaticAberrationEffect({
      offset: new Vector2(FX.CHROMA.offset, FX.CHROMA.offset),
      radialModulation: FX.CHROMA.radialModulation,
      modulationOffset: FX.CHROMA.modulationOffset,
    });
    this._chromaBase = FX.CHROMA.offset;

    this.crimson = new CrimsonGradeEffect(FX.CRIMSON_GRADE);
    this.tonemap = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });

    // pmndrs merges effects per EffectPass, but forbids a UV-transforming effect
    // (our crimson barrel) sharing a pass with a CONVOLUTION effect. In this lib
    // ChromaticAberration IS convolution, so it must live in its OWN pass; bloom,
    // the crimson grade (UV) and tone-mapping are convolution-free and merge fine.
    this.composer.addPass(new EffectPass(camera, this.bloom, this.crimson, this.tonemap));
    this.composer.addPass(new EffectPass(camera, this.chroma));

    // ── Boss distortion pass (shockwaves + glitch) ──────────────────
    this._shockwaves = [];
    this._swCursor = 0;
    for (let i = 0; i < 3; i++) {
      this._shockwaves.push(new ShockWaveEffect(camera, new Vector3(0, 0, 0), {
        speed: 2.0, maxRadius: 0.9, waveSize: 0.18, amplitude: 0.06,
      }));
    }
    this.glitch = new GlitchEffect({
      delay: new Vector2(6, 12),
      duration: new Vector2(0.1, 0.2),
      strength: new Vector2(0.05, 0.25),
      ratio: 0.6,
    });
    this.glitch.mode = GlitchMode.DISABLED;
    this.composer.addPass(new EffectPass(camera, ...this._shockwaves, this.glitch));

    // ── CRT surface overlay ─────────────────────────────────────────
    this.scanline = new ScanlineEffect({ density: FX.SCANLINE.density });
    this.scanline.blendMode.opacity.value = FX.SCANLINE.opacity;
    this.vignette = new VignetteEffect({ offset: FX.VIGNETTE.offset, darkness: FX.VIGNETTE.darkness });
    this.noise = new NoiseEffect({ premultiply: FX.NOISE.premultiply, blendFunction: BlendFunction.SCREEN });
    this.noise.blendMode.opacity.value = FX.NOISE.opacity;
    this.composer.addPass(new EffectPass(camera, this.scanline, this.vignette, this.noise));

    this._bloomPulse = 0;
    this._chromaPulse = 0;
    this._strobeActive = false;
    this._strobeT = 0;
  }

  render(frameDt) {
    // Boss strobe: flash the crimson invert as a square wave, phase-locked to the
    // same frequency the LightingRig flashes its white light — they blind together.
    if (this._strobeActive) {
      this._strobeT += frameDt;
      this.crimson.strobe = Math.sin(this._strobeT * Math.PI * 2 * BOSS.STROBE_FLASH_HZ) > 0 ? 0.85 : 0.0;
    }
    // Decay transient pulses (a hit briefly cranks bloom + aberration).
    if (this._bloomPulse > 0) {
      this._bloomPulse = Math.max(0, this._bloomPulse - frameDt * 3.5);
      this.bloom.intensity = this._bloomBase + this._bloomPulse;
    }
    if (this._chromaPulse > 0) {
      this._chromaPulse = Math.max(0, this._chromaPulse - frameDt * 4.0);
      const o = this._chromaBase + this._chromaPulse * 0.01;
      this.chroma.offset.set(o, o);
    }
    this.composer.render(frameDt);
  }

  setSize(w, h) { this.composer.setSize(w, h); }

  // ── Public FX API (driven by the bus/boss/camera) ─────────────────

  /** Transient bloom bump 0..~1 on a big hit / growth tier. */
  pulseBloom(amount = 0.6) { this._bloomPulse = Math.max(this._bloomPulse, amount); }
  pulseChroma(amount = 1.0) { this._chromaPulse = Math.max(this._chromaPulse, amount); }

  /** Fire a soundwave ripple centred on a WORLD position (boss shockwave). */
  triggerShockwave(worldX, worldY, worldZ = 0) {
    const sw = this._shockwaves[this._swCursor];
    this._swCursor = (this._swCursor + 1) % this._shockwaves.length;
    sw.position.set(worldX, worldY, worldZ);
    sw.explode();
    this.pulseChroma(1.2);
  }

  /** Glitch tearing for phase transitions / strobe. */
  setGlitch(on, wild = false) {
    this.glitch.mode = on ? (wild ? GlitchMode.CONSTANT_WILD : GlitchMode.SPORADIC) : GlitchMode.DISABLED;
  }

  /** Arm/disarm the boss strobe blind. While armed, render() flashes the grade. */
  setStrobe(on) {
    this._strobeActive = !!on;
    if (!on) { this.crimson.strobe = 0; this._strobeT = 0; }
  }

  dispose() { this.composer.dispose(); }
}
