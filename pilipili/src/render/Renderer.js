import {
  WebGLRenderer, Scene, Color, SRGBColorSpace, NoToneMapping, ACESFilmicToneMapping,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { CameraRig } from './CameraRig.js';
import { LightingRig } from './LightingRig.js';
import { PostFX } from './PostFX.js';

/**
 * Renderer.js — owns the WebGL context, the scene graph, the camera rig, the
 * lighting rig, and the post pipeline. Everything visual hangs off here.
 *
 * Tone mapping is left to the PostFX pass (ACES), so the WebGLRenderer itself is
 * set to NoToneMapping and an HDR composer buffer carries the over-bright neon
 * through to bloom untouched.
 */
export class Renderer {
  constructor(canvas, bus) {
    this.canvas = canvas;
    this.bus = bus;
    this.webgl = null;
    this.scene = null;
    this.cameraRig = null;
    this.lighting = null;
    this.postfx = null;
    this._onResize = this._onResize.bind(this);
  }

  async init() {
    this.webgl = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    this.webgl.outputColorSpace = SRGBColorSpace;
    this.webgl.toneMapping = NoToneMapping; // PostFX does ACES in the composer
    // RectAreaLight needs its BRDF LUTs uploaded once before use.
    RectAreaLightUniformsLib.init();

    this.scene = new Scene();
    this.scene.background = new Color(0x05010a);

    this.cameraRig = new CameraRig(this.bus);
    this.camera = this.cameraRig.camera;
    this.lighting = new LightingRig(this.scene);
    this.postfx = new PostFX(this.webgl, this.scene, this.camera);

    this._onResize();
    window.addEventListener('resize', this._onResize);
    return this;
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.webgl.setSize(w, h);
    this.cameraRig.resize(w / h);
    this.postfx.setSize(w, h);
  }

  /** Called once per render frame from Game._frame. */
  render(elapsed, alpha, frameDt) {
    this.lighting.tick(elapsed, frameDt);
    this.cameraRig.update(frameDt, elapsed);
    this.postfx.render(frameDt);
  }

  add(obj) { this.scene.add(obj); }
  remove(obj) { this.scene.remove(obj); }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.postfx.dispose();
    this.webgl.dispose();
  }
}
