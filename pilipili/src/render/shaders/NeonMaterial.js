import { MeshStandardMaterial, Color, AdditiveBlending } from 'three';

/**
 * NeonMaterial — an emissive tube/sign material that the Bloom pass turns into
 * glowing crimson light.
 *
 * It extends MeshStandardMaterial (so it still lights normally) and injects, via
 * onBeforeCompile:
 *   - a FRESNEL rim so the tube's silhouette blooms hottest at grazing angles,
 *     exactly like a real glass neon tube seen edge-on;
 *   - a per-tube FLICKER driven by a time uniform, with a configurable instability
 *     so a "broken" sign in the back room can gutter and buzz.
 *
 * Bloom only picks up pixels above its luminance threshold, so `emissiveIntensity`
 * here is deliberately > 1 for the tubes we want to glow.
 */
export class NeonMaterial extends MeshStandardMaterial {
  constructor({ color = 0xff1030, intensity = 2.6, flicker = 0.0, rim = 1.4 } = {}) {
    super({
      color: new Color(color).multiplyScalar(0.1), // body is near-black glass…
      emissive: new Color(color),                  // …the light is the emissive
      emissiveIntensity: intensity,
      roughness: 0.35,
      metalness: 0.0,
      toneMapped: false, // let it exceed 1.0 so bloom reads it as a light source
    });
    this._time = 0;
    this._flicker = flicker;
    this._rim = rim;
    this._shader = null;

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uFlicker = { value: this._flicker };
      shader.uniforms.uRim = { value: this._rim };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n varying vec3 vViewDir; varying vec3 vWNormal;')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vec4 _wp = modelMatrix * vec4(transformed, 1.0);
           vViewDir = normalize(cameraPosition - _wp.xyz);
           vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uFlicker; uniform float uRim;
          varying vec3 vViewDir; varying vec3 vWNormal;
          float _hash(float n){ return fract(sin(n)*43758.5453123); }`)
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           // Fresnel rim → hottest at grazing angles (glass-tube look).
           float fres = pow(1.0 - clamp(dot(normalize(vWNormal), normalize(vViewDir)), 0.0, 1.0), 2.0);
           totalEmissiveRadiance *= 1.0 + uRim * fres;
           // Buzzing flicker: two noises, one slow gutter + one mains hum.
           float f = mix(1.0,
             0.72 + 0.28 * _hash(floor(uTime*22.0)) + 0.06*sin(uTime*120.0),
             uFlicker);
           totalEmissiveRadiance *= f;`,
        );

      this._shader = shader;
    };
  }

  /** Call every frame with elapsed seconds to animate flicker. */
  tick(t) {
    this._time = t;
    if (this._shader) this._shader.uniforms.uTime.value = t;
  }
}

/**
 * A cheap additive "glow sprite" material for halos and light shafts that should
 * never be lit — just pure emissive bloom fuel.
 */
export function makeGlowMaterial(color = 0xff1030, opacity = 0.85) {
  return new MeshStandardMaterial({
    color: 0x000000,
    emissive: new Color(color),
    emissiveIntensity: 3.0,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}
