import { Effect } from 'postprocessing';
import { Uniform, Vector3 } from 'three';

/**
 * CrimsonGradeEffect — the signature colour of "Le PiliPili".
 *
 * A custom postprocessing Effect (merged into the main EffectPass, so it costs
 * one texture read, not a whole extra pass). It does three things the venue
 * photos demand:
 *   1. mainUv(): a gentle CRT/anamorphic BARREL warp so the frame bulges like an
 *      old club screen — the curvature you feel more than see.
 *   2. mainImage(): grades the whole frame toward crimson while PROTECTING
 *      highlights, so neon tubes stay searing white-hot instead of muddying to
 *      pink. This is the difference between "red filter" and "red LIGHT".
 *   3. A strobe uniform the boss cranks to flash/invert the image on the beat.
 *
 * Authoring against pmndrs/postprocessing's Effect ABI: we only provide the two
 * shader hooks and a uniform Map; the library wires blending, resolution and the
 * fullscreen triangle.
 */
const fragmentShader = /* glsl */ `
uniform vec3  uTint;
uniform float uStrength;
uniform float uHighlightProtect;
uniform float uBarrel;
uniform float uStrobe;      // 0..1 boss strobe intensity
uniform float uSaturation;  // global saturation push

// CRT barrel: bow the sampling coordinates outward from centre.
void mainUv(inout vec2 uv) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  uv = 0.5 + c * (1.0 + uBarrel * r2);
}

vec3 saturate3(vec3 col, float amt) {
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), col, amt);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));

  // Highlights (hot neon) resist the grade so they read as light sources.
  float protect = mix(1.0, 1.0 - uHighlightProtect, smoothstep(0.62, 1.0, luma));
  vec3 tinted = col * uTint + uTint * 0.12;
  vec3 graded = mix(col, tinted, uStrength * protect);

  graded = saturate3(graded, uSaturation);

  // Strobe: hard flash toward an inverted, blown-out frame on the boss's beat.
  vec3 flashed = vec3(1.0) - graded * 0.15;
  graded = mix(graded, flashed, clamp(uStrobe, 0.0, 1.0));

  outputColor = vec4(graded, inputColor.a);
}
`;

export class CrimsonGradeEffect extends Effect {
  constructor({
    tint = [1.0, 0.13, 0.18],
    strength = 0.34,
    highlightProtect = 0.7,
    barrel = 0.12,
    saturation = 1.18,
  } = {}) {
    super('CrimsonGradeEffect', fragmentShader, {
      uniforms: new Map([
        ['uTint', new Uniform(new Vector3(tint[0], tint[1], tint[2]))],
        ['uStrength', new Uniform(strength)],
        ['uHighlightProtect', new Uniform(highlightProtect)],
        ['uBarrel', new Uniform(barrel)],
        ['uStrobe', new Uniform(0)],
        ['uSaturation', new Uniform(saturation)],
      ]),
    });
  }

  /** 0 = off, 1 = full white-flash invert. Driven by the boss strobe. */
  set strobe(v) { this.uniforms.get('uStrobe').value = v; }
  get strobe() { return this.uniforms.get('uStrobe').value; }
  set strength(v) { this.uniforms.get('uStrength').value = v; }
}
