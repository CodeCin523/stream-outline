// Chromatic aberration pass.
// Spreads R outward from center and B inward, leaving G at center.
// Alpha is sampled from the undisplaced position so OBS transparency is preserved.

uniform sampler2D tDiffuse;
uniform float strength;   // channel spread in UV units (ghost: small, effect: larger)

varying vec2 vUv;

void main() {
  vec2 dir = vUv - 0.5;          // vector from center
  vec2 shift = dir * strength;

  float r = texture2D(tDiffuse, vUv + shift).r;
  float g = texture2D(tDiffuse, vUv).g;
  float b = texture2D(tDiffuse, vUv - shift).b;
  float a = texture2D(tDiffuse, vUv).a;

  gl_FragColor = vec4(r, g, b, a);
}
