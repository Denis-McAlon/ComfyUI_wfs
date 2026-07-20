import {
  AmbientLight, HemisphereLight, PointLight, SpotLight, RectAreaLight,
  Color, FogExp2, Object3D, Vector2,
} from 'three';
import { BOSS } from '../config/Constants.js';

/**
 * LightingRig.js — the light of "Le PiliPili".
 *
 * The venue is DARK. The trick to the look is a near-black ambient with a few
 * intensely saturated crimson sources doing all the work, so faces are lit from
 * below/behind and everything has a hot red rim. We DON'T flood the scene; we
 * carve figures out of the dark with backlight. Fog gives the smoke-filled depth.
 *
 * The rig also owns:
 *   - per-light FLICKER (mains buzz + occasional gutter) so it feels alive/cheap;
 *   - the boss STROBE, a white flash pulsing at BOSS.STROBE_FLASH_HZ that pairs
 *     with the CrimsonGradeEffect's invert to blind the player on the beat;
 *   - a registry of NeonMaterials it ticks so signs animate in sync.
 */
const CRIMSON = 0xff1030;
const CRIMSON_DEEP = 0xc4001a;
const MAGENTA_RIM = 0xff2b6b;

export class LightingRig {
  constructor(scene) {
    this.scene = scene;
    this.neon = [];        // NeonMaterial[] to tick
    this._t = 0;

    scene.fog = new FogExp2(new Color(0x0a0104), 0.028);

    // Base fill: almost nothing, faintly warm so blacks aren't dead.
    this.ambient = new AmbientLight(new Color(0x1a0308), 0.35);
    scene.add(this.ambient);

    // Sky (dark red haze) / ground (black) hemisphere for gentle volume.
    this.hemi = new HemisphereLight(new Color(0x2a0410), new Color(0x000000), 0.35);
    scene.add(this.hemi);

    // Backlight bar: a row of flickering crimson points behind the play plane.
    this.backlights = [];
    for (let i = 0; i < 6; i++) {
      const p = new PointLight(new Color(CRIMSON), 8.0, 22, 2.0);
      p.position.set(-24 + i * 10, 4.5, -3.5);
      p.userData.flicker = 0.12 + Math.random() * 0.18;
      p.userData.base = 8.0;
      p.userData.phase = Math.random() * 100;
      scene.add(p);
      this.backlights.push(p);
    }

    // Booth key: a hard crimson spot from above centre-stage (the DJ skull).
    this.key = new SpotLight(new Color(CRIMSON_DEEP), 24, 40, Math.PI * 0.18, 0.4, 1.3);
    this.key.position.set(0, 16, 6);
    this.key.target = new Object3D();
    this.key.target.position.set(0, 2, 0);
    scene.add(this.key, this.key.target);

    // Rim: a magenta area light low and behind for that neon edge separation.
    // (RectAreaLight needs RectAreaLightUniformsLib.init() once — see Renderer.)
    this.rim = new RectAreaLight(new Color(MAGENTA_RIM), 5.0, 60, 8);
    this.rim.position.set(0, 3, -6);
    this.rim.lookAt(0, 3, 1);
    scene.add(this.rim);

    // Strobe: full-scene white flash, off until the boss weaponizes it.
    this.strobeLight = new PointLight(new Color(0xffffff), 0, 60, 1.0);
    this.strobeLight.position.set(0, 10, 8);
    scene.add(this.strobeLight);
    this._strobeOn = false;
    this._strobeT = 0;
  }

  registerNeon(material) { this.neon.push(material); return material; }

  /** Boss calls this to arm/disarm the strobe for STROBE_DURATION worth of beats. */
  setStrobe(on) { this._strobeOn = on; if (!on) { this.strobeLight.intensity = 0; this._strobeT = 0; } }

  tick(t, dt = 0.016) {
    this._t = t;

    // Flicker the backlights: steady mains hum + rare deeper gutter.
    for (const p of this.backlights) {
      const hum = 0.94 + 0.06 * Math.sin(t * 120 + p.userData.phase);
      const gutter = Math.random() < 0.004 ? 0.4 + Math.random() * 0.4 : 1.0;
      const f = (1 - p.userData.flicker) + p.userData.flicker * hum;
      p.intensity = p.userData.base * f * gutter;
    }

    // Booth key breathes subtly with the beat feel.
    this.key.intensity = 22 + 3 * Math.sin(t * 3.0);

    // Strobe flash.
    if (this._strobeOn) {
      this._strobeT += dt;
      const phase = Math.sin(this._strobeT * Math.PI * 2 * BOSS.STROBE_FLASH_HZ);
      this.strobeLight.intensity = phase > 0 ? 45 : 0;
    }

    for (const m of this.neon) m.tick?.(t);
  }
}
