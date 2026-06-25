// Smoke / ghost displacement pass.
// Displaces the outline texture with layered simplex noise, then adds a
// "rising smoke" smear by blending a slightly upward-shifted sample.
// Alpha is preserved so OBS transparency still works.

uniform sampler2D tDiffuse;
uniform float time;
uniform float warpStrength;  // ghost mode: small   smoke mode: larger
uniform float riseSpeed;     // how fast smoke drifts upward

varying vec2 vUv;

// ── Simplex noise (2-D, GPU-friendly) ─────────────────────────────────────
vec3 _mod289v3(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec2 _mod289v2(vec2 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 _permute(vec3 x) { return _mod289v3(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(
     0.211324865405187,   // (3 - sqrt(3)) / 6
     0.366025403784439,   // (sqrt(3) - 1) / 2
    -0.577350269189626,   // -1 + 2*(3 - sqrt(3))/6
     0.024390243902439    // 1/41
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1  = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = _mod289v2(i);
  vec3 p = _permute(_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m * m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h  = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x   + h.x  * x0.y;
  g.yz = a0.yz * x12.xz  + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
// ──────────────────────────────────────────────────────────────────────────

void main() {
  // Two octaves of noise for organic feel
  float n1 = snoise(vUv * 2.5 + vec2(time * 0.25,  time * 0.18));
  float n2 = snoise(vUv * 5.0 - vec2(time * 0.15,  time * 0.30));
  float n  = n1 * 0.65 + n2 * 0.35;

  // Primary warp — horizontal & vertical displacement
  vec2 warp = vec2(n, n * 0.6) * warpStrength;

  // Smoke rise — sample from below so content appears to drift upward
  float rise = riseSpeed * (0.5 + 0.5 * snoise(vUv * 1.5 + time * 0.1));
  vec2 smokeOffset = warp + vec2(0.0, rise);

  vec4 warped = texture2D(tDiffuse, vUv + warp);
  vec4 smoked = texture2D(tDiffuse, vUv + smokeOffset);

  // Blend: smoke trail is softer / more transparent than the warped base
  vec4 color = mix(warped, smoked, 0.35);

  // Fade trailing smoke (pixels that gained alpha from the smoke sample)
  float trailAlpha = max(color.a - warped.a, 0.0);
  color.a = warped.a + trailAlpha * 0.5;

  gl_FragColor = color;
}
