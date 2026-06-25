// Two-pass Gaussian glow that preserves alpha.
// Pass 0: horizontal blur  (axis = vec2(1,0))
// Pass 1: vertical blur    (axis = vec2(0,1))
// The glow is additive so transparent areas stay transparent.

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 axis;       // blur direction in texel space
uniform float glowSize;  // blur radius in pixels
uniform float glowPower; // brightness multiplier

varying vec2 vUv;

void main() {
  // 9-tap Gaussian weights
  const int TAPS = 9;
  float weights[9];
  weights[0] = 0.0625;
  weights[1] = 0.125;
  weights[2] = 0.1875;
  weights[3] = 0.25;
  weights[4] = 0.3125;   // centre (we ramp, then mirror)
  weights[3] = 0.25;
  weights[2] = 0.1875;
  weights[1] = 0.125;
  weights[0] = 0.0625;

  const float W[9] = float[9](
    0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.25, 0.1875, 0.125, 0.0625
  );
  const float W_SUM = 1.625;

  vec2 texel = axis / resolution * glowSize;
  vec4 blur = vec4(0.0);
  for (int i = 0; i < 9; i++) {
    blur += texture2D(tDiffuse, vUv + texel * float(i - 4)) * W[i];
  }
  blur /= W_SUM;

  vec4 src = texture2D(tDiffuse, vUv);

  // Additive glow on top of the original — alpha stays unmodified
  vec4 glow = blur * glowPower;
  glow.a = 0.0;  // pure additive; don't increase alpha
  gl_FragColor = clamp(src + glow, 0.0, 1.0);
}
