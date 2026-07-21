import { ShaderMaterial, Color, AdditiveBlending } from 'three';

/**
 * SkullEyeMaterial — the DJ skull's glowing red eyes behind the white shades.
 *
 * Mapped onto two quads inset in the eye sockets. A radial core with an animated
 * corona; the `uBeat` uniform is pumped on every downbeat so the eyes throb with
 * the music, and `uRage` widens/reddens them as the boss enters later phases.
 * Additive + toneMapped:false so the bloom pass smears them into hot light.
 */
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uBeat;   // 0..1 impulse, decays each frame
  uniform float uRage;   // 0..1 phase intensity
  uniform vec3  uColor;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p);

    // Core + corona. Rage tightens the core and pushes the corona out.
    float core = smoothstep(0.34 - 0.1*uRage, 0.0, d);
    float corona = smoothstep(0.5, 0.16, d);
    float pulse = 0.85 + 0.15 * sin(uTime * 6.2831 * 2.0);
    float beat = 1.0 + uBeat * (1.6 + uRage);

    float intensity = (core * 1.4 + corona * 0.6) * pulse * beat;
    // Slight horizontal slit flare for a menacing, non-circular eye.
    intensity *= 1.0 - smoothstep(0.06, 0.22, abs(p.y)) * 0.35;

    vec3 col = uColor * intensity;
    col += vec3(1.0, 0.9, 0.85) * pow(core, 3.0) * 0.6; // white-hot centre
    float alpha = clamp(intensity, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

export class SkullEyeMaterial extends ShaderMaterial {
  constructor({ color = 0xff1524 } = {}) {
    super({
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uRage: { value: 0 },
        // A THREE.Color uploads as a vec3 (its linear r,g,b) — no conversion dance.
        uColor: { value: new Color(color) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  }

  tick(t) { this.uniforms.uTime.value = t; if (this.uniforms.uBeat.value > 0) this.uniforms.uBeat.value *= 0.86; }
  pulse() { this.uniforms.uBeat.value = 1; }
  set rage(v) { this.uniforms.uRage.value = v; }
}
