import * as THREE from 'three';
import { EffectComposer }  from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass }      from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass }      from 'three/examples/jsm/postprocessing/ShaderPass.js';

// ─── Shared vertex shader ────────────────────────────────────────────────────
const VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;

// ─── Sobel outline ───────────────────────────────────────────────────────────
const SobelOutlineShader = {
  uniforms: {
    tDiffuse:   { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    varying vec2 vUv;
    float lum(vec2 off) {
      return dot(texture2D(tDiffuse, vUv + off / resolution).rgb, vec3(0.299,0.587,0.114));
    }
    void main() {
      float gx = -lum(vec2(-1,-1)) + lum(vec2(1,-1))
                 - 2.0*lum(vec2(-1,0)) + 2.0*lum(vec2(1,0))
                 - lum(vec2(-1,1))  + lum(vec2(1,1));
      float gy = -lum(vec2(-1,-1)) - 2.0*lum(vec2(0,-1)) - lum(vec2(1,-1))
                 + lum(vec2(-1,1))  + 2.0*lum(vec2(0,1))  + lum(vec2(1,1));
      float edge = clamp(sqrt(gx*gx + gy*gy) * 3.0, 0.0, 1.0);
      gl_FragColor = vec4(edge, edge, edge, edge);
    }
  `,
};

// ─── ASCII pass 1: per-pixel Sobel → direction map ──────────────────────────
// Encodes into RG:
//   R = direction index / 3.0  (0=|  1/3=\  2/3=_  1=/  )
//   G = gradient magnitude (0–1)
// Pixels below minMag write G=0 so the vote pass ignores them.
const AsciiDirectionShader = {
  uniforms: {
    tDiffuse:   { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    varying vec2 vUv;

    float lum(vec2 uv) {
      return dot(texture2D(tDiffuse, uv).rgb, vec3(0.299, 0.587, 0.114));
    }

    void main() {
      vec2 px = vec2(1.0) / resolution;

      float gx =
        -lum(vUv + vec2(-px.x,-px.y)) + lum(vUv + vec2( px.x,-px.y))
        - 2.0*lum(vUv + vec2(-px.x, 0.0)) + 2.0*lum(vUv + vec2( px.x, 0.0))
        - lum(vUv + vec2(-px.x, px.y)) + lum(vUv + vec2( px.x, px.y));
      float gy =
        -lum(vUv + vec2(-px.x,-px.y)) - 2.0*lum(vUv + vec2( 0.0,-px.y)) - lum(vUv + vec2( px.x,-px.y))
        + lum(vUv + vec2(-px.x, px.y)) + 2.0*lum(vUv + vec2( 0.0, px.y)) + lum(vUv + vec2( px.x, px.y));

      float mag = sqrt(gx*gx + gy*gy);

      float dir = 0.0;
      if (mag > 0.05) {
        float angle = atan(gy, gx);
        if (angle < 0.0) angle += 3.14159265;
        float a = angle / 3.14159265;   /* normalise to [0,1) */

        /* Fold gradient angle to edge character:
           [0, 1/8) or [7/8, 1)  →  |  (gradient horizontal, edge vertical)
           [1/8, 3/8)            →  \  (gradient ~45°)
           [3/8, 5/8)            →  _  (gradient vertical, edge horizontal)
           [5/8, 7/8)            →  /  (gradient ~135°) */
        if      (a < 0.125 || a >= 0.875) dir = 0.0 / 3.0;
        else if (a < 0.375)              dir = 1.0 / 3.0;
        else if (a < 0.625)              dir = 2.0 / 3.0;
        else                             dir = 3.0 / 3.0;
      }

      gl_FragColor = vec4(dir, clamp(mag, 0.0, 1.0), 0.0, 1.0);
    }
  `,
};

// ─── ASCII pass 2: cell-wide vote → draw winning character ──────────────────
// Reads the direction map produced by pass 1.
// For every pixel, loops all cellSize×cellSize neighbours in its cell, tallies
// magnitude-weighted votes per direction, and draws the winner only if the
// edge-pixel count meets the threshold fraction of (cellSize²).
// Loop max is 32; GLSL ES 3.0 (WebGL 2) allows breaking on a uniform condition.
const AsciiVoteShader = {
  uniforms: {
    tDiffuse:   { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    threshold:  { value: 0.05 },  /* fraction of cellSize² pixels that must be edges */
    cellSize:   { value: 8.0  },  /* cell width/height in pixels: 4 8 12 18 24 32 */
  },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2  resolution;
    uniform float threshold;
    uniform float cellSize;
    varying vec2 vUv;

    void main() {
      const float T = 0.15;   /* character half-thickness in [0,1] cell space */

      int   cs  = int(cellSize + 0.5);
      float csF = float(cs);

      vec2 px      = vec2(1.0) / resolution;
      vec2 cellSz  = csF * px;
      vec2 ci      = floor(vUv / cellSz);
      vec2 cellOrg = ci * cellSz;
      vec2 lp      = fract(vUv / cellSz);  /* local [0,1) inside cell */

      /* Gap scales with cell size: floor(cellSize/8), min 1 pixel.
         Gives 1px at 4-15, 2px at 16-23, 3px at 24-31, 4px at 32. */
      float gap    = max(1.0, floor(csF / 8.0));
      float gapUV  = gap / csF;
      if (lp.x >= 1.0 - gapUV || lp.y >= 1.0 - gapUV) {
        gl_FragColor = vec4(0.0); return;
      }

      /* Weighted vote per direction across all cs×cs pixels in the cell.
         Loop bound is compile-time 32; break exits early for smaller sizes. */
      float v0 = 0.0, v1 = 0.0, v2 = 0.0, v3 = 0.0;
      float edgeCount = 0.0;

      for (int dy = 0; dy < 32; dy++) {
        if (dy >= cs) break;
        for (int dx = 0; dx < 32; dx++) {
          if (dx >= cs) break;
          vec2 suv = cellOrg + (vec2(float(dx), float(dy)) + 0.5) * px;
          vec2 s   = texture2D(tDiffuse, suv).rg;
          float mag = s.g;
          if (mag > 0.1) {
            int d = int(s.r * 3.0 + 0.5);
            if      (d == 0) v0 += mag;
            else if (d == 1) v1 += mag;
            else if (d == 2) v2 += mag;
            else             v3 += mag;
            edgeCount += 1.0;
          }
        }
      }

      if (edgeCount < threshold * csF * csF) { gl_FragColor = vec4(0.0); return; }

      /* Winner-takes-all */
      int winner = 0;
      float best = v0;
      if (v1 > best) { best = v1; winner = 1; }
      if (v2 > best) { best = v2; winner = 2; }
      if (v3 > best) { best = v3; winner = 3; }

      float lx = lp.x;
      float ly = lp.y;
      float cp = 0.0;

      if (winner == 0) {
        cp = 1.0 - step(T, abs(lx - 0.5));
      } else if (winner == 1) {
        cp = 1.0 - step(T * 1.5, abs(lx + ly - 1.0));
      } else if (winner == 2) {
        cp = 1.0 - step(T, abs(ly - 0.5));
      } else {
        cp = 1.0 - step(T * 1.5, abs(lx - ly));
      }

      /* Hard white — cp is already 0 or 1 from the step tests */
      gl_FragColor = vec4(cp, cp, cp, cp);
    }
  `,
};

// ─── Bloom alpha fix ─────────────────────────────────────────────────────────
// UnrealBloomPass hardcodes alpha=1 everywhere in its composite shader.
// This pass restores transparency using the pre-bloom scene capture:
//   • Avatar pixels  (origAlpha=1)     → stay opaque
//   • Bloom halo pixels (origAlpha=0)  → alpha = bloom luminance (glow visible)
//   • Background pixels (no bloom)     → alpha = 0  (fully transparent)
const BloomAlphaShader = {
  uniforms: {
    tDiffuse:  { value: null },
    tOriginal: { value: null },
  },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tOriginal;
    varying vec2 vUv;
    void main() {
      vec4  bloom    = texture2D(tDiffuse,  vUv);
      float origAlpha = texture2D(tOriginal, vUv).a;
      float bloomLum  = dot(bloom.rgb, vec3(0.299, 0.587, 0.114));
      gl_FragColor = vec4(bloom.rgb, max(origAlpha, bloomLum));
    }
  `,
};

// ─── Aura subtract ───────────────────────────────────────────────────────────
// tDiffuse  = bloomed frame (body + glow halo)
// tOriginal = pre-bloom capture (plain body, no glow)
// output    = bloom × (1 − body_mask) → transparent hole where body was, glow around it
// Alpha = luminance of the masked colour so that background pixels (no bloom)
// are transparent rather than opaque black.
const AuraSubtractShader = {
  uniforms: {
    tDiffuse:  { value: null },
    tOriginal: { value: null },
  },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tOriginal;
    varying vec2 vUv;
    void main() {
      vec4  bloom = texture2D(tDiffuse, vUv);
      float body  = clamp(dot(texture2D(tOriginal, vUv).rgb, vec3(0.333)), 0.0, 1.0);
      vec3  color = bloom.rgb * (1.0 - body);
      gl_FragColor = vec4(color, dot(color, vec3(0.299, 0.587, 0.114)));
    }
  `,
};

// ─── Renderer ────────────────────────────────────────────────────────────────
export class Renderer {
  constructor(container) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this._gl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this._gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._gl.setSize(w, h);
    this._gl.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this._gl.domElement);

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.01, 50);
    this.camera.position.set(0, 0, 2.8);

    this.scene.background = null;

    this._renderPass  = new RenderPass(this.scene, this.camera);
    this._outputPass  = new OutputPass();
    this._effectPass  = null; // main swappable pass (Sobel / ASCII dir / Bloom)
    this._bloomPass   = null; // UnrealBloomPass — shared by 'bloom' and 'aura'
    this._captureRT   = null; // pre-bloom render target for aura
    this._asciiVotePass = null; // ASCII vote pass (needs resize too)

    this._composer = new EffectComposer(this._gl);
    this._composer.addPass(this._renderPass);
    this._composer.addPass(this._outputPass);

    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const w  = window.innerWidth;
    const h  = window.innerHeight;
    const pr = this._gl.getPixelRatio();
    this._gl.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._composer.setSize(w, h);

    if (this._captureRT) {
      this._captureRT.setSize(
        this._composer.readBuffer.width,
        this._composer.readBuffer.height,
      );
    }
    // Update resolution uniforms for shader-based passes
    const res = new THREE.Vector2(w * pr, h * pr);
    if (this._effectPass?.uniforms?.resolution)   this._effectPass.uniforms.resolution.value.copy(res);
    if (this._asciiVotePass?.uniforms?.resolution) this._asciiVotePass.uniforms.resolution.value.copy(res);
  }

  toggleBackground() {
    const nowWhite = !this.scene.background;
    this.scene.background = nowWhite ? new THREE.Color(0xffffff) : null;
    return nowWhite;
  }

  setFlipped(flipped) {
    this._gl.domElement.style.transform = flipped ? 'scaleX(-1)' : '';
  }

  /** Switch post-processing effect: 'none' | 'bloom' | 'outline' | 'ascii' | 'aura' */
  setEffect(name, strength = 0.7, radius = 0.15, threshold = 0.5) {
    if (this._effectPass?.dispose) this._effectPass.dispose();
    this._effectPass   = null;
    this._bloomPass    = null;
    this._asciiVotePass = null;
    if (this._captureRT) { this._captureRT.dispose(); this._captureRT = null; }

    this._composer.passes.length = 0;
    this._composer.addPass(this._renderPass);

    const el = this._gl.domElement;

    if (name === 'bloom') {
      // Capture pre-bloom scene so BloomAlphaShader can restore transparency
      this._captureRT = new THREE.WebGLRenderTarget(
        this._composer.readBuffer.width,
        this._composer.readBuffer.height,
      );
      this._bloomPass  = new UnrealBloomPass(new THREE.Vector2(el.width, el.height), strength, radius, threshold);
      this._effectPass = this._bloomPass;
      this._composer.addPass(this._bloomPass);

      const alphaFix = new ShaderPass(BloomAlphaShader);
      alphaFix.uniforms.tOriginal.value = this._captureRT.texture;
      this._composer.addPass(alphaFix);

    } else if (name === 'outline') {
      this._effectPass = new ShaderPass(SobelOutlineShader);
      this._effectPass.uniforms.resolution.value.set(el.width, el.height);
      this._composer.addPass(this._effectPass);

    } else if (name === 'ascii') {
      // Pass 1 — per-pixel Sobel direction map (R=direction/3, G=magnitude)
      this._effectPass = new ShaderPass(AsciiDirectionShader);
      this._effectPass.uniforms.resolution.value.set(el.width, el.height);
      this._composer.addPass(this._effectPass);

      // Pass 2 — cell-wide vote, winner draws character
      this._asciiVotePass = new ShaderPass(AsciiVoteShader);
      this._asciiVotePass.uniforms.resolution.value.set(el.width, el.height);
      this._composer.addPass(this._asciiVotePass);

    } else if (name === 'aura') {
      this._captureRT = new THREE.WebGLRenderTarget(
        this._composer.readBuffer.width,
        this._composer.readBuffer.height,
      );
      this._bloomPass  = new UnrealBloomPass(new THREE.Vector2(el.width, el.height), strength, radius, threshold);
      this._effectPass = this._bloomPass;
      this._composer.addPass(this._bloomPass);

      const subtract = new ShaderPass(AuraSubtractShader);
      subtract.uniforms.tOriginal.value = this._captureRT.texture;
      this._composer.addPass(subtract);
    }

    this._composer.addPass(this._outputPass);
  }

  updateBloom(strength, radius, threshold) {
    if (this._bloomPass) {
      this._bloomPass.strength  = strength;
      this._bloomPass.radius    = radius;
      this._bloomPass.threshold = threshold;
    }
  }

  updateAsciiThreshold(t) {
    if (this._asciiVotePass) this._asciiVotePass.uniforms.threshold.value = t;
  }

  updateAsciiCellSize(size) {
    if (this._asciiVotePass) this._asciiVotePass.uniforms.cellSize.value = size;
  }

  render() {
    if (this._captureRT) {
      this._gl.setRenderTarget(this._captureRT);
      this._gl.render(this.scene, this.camera);
      this._gl.setRenderTarget(null);
    }
    this._composer.render();
  }
}
