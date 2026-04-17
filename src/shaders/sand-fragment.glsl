// Sand fragment shader
// Procedural sandy texture: multi-scale grain noise + directional wind ripple

#ifdef USE_SHADOWMAP
  #if NUM_DIR_LIGHT_SHADOWS > 0
    varying vec4 vDirectionalShadowCoord[NUM_DIR_LIGHT_SHADOWS];
  #endif
  #if NUM_SPOT_LIGHT_SHADOWS > 0
    varying vec4 vSpotLightShadowCoord[NUM_SPOT_LIGHT_SHADOWS];
  #endif
#endif

#include ./common/lighting-fragment.glsl

uniform vec3 uSandColor;
uniform vec3 uSandDarkColor;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vUv;

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float noise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = random(i);
  float b = random(i + vec2(1.0, 0.0));
  float c = random(i + vec2(0.0, 1.0));
  float d = random(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  // World-space tiling so scale is consistent regardless of UV density
  vec2 coord = vWorldPosition.xz * 0.25;

  // Multi-scale grain: coarse + medium + fine
  float grain = noise(coord * 6.0)  * 0.50
              + noise(coord * 18.0) * 0.30
              + noise(coord * 55.0) * 0.20;

  // Wind ripple — a directional sine wave rotated by low-freq noise
  float angle  = noise(coord * 1.5) * 6.2832;
  float ripple = sin(cos(angle) * vWorldPosition.x * 1.2
                   + sin(angle) * vWorldPosition.z * 1.2) * 0.5 + 0.5;
  ripple = pow(ripple, 6.0) * 0.10;

  vec3 sandColor = mix(uSandDarkColor, uSandColor, clamp(grain + ripple, 0.0, 1.0));

  float shadow = 1.0;
  #ifdef USE_SHADOWMAP
    shadow = calculateShadows();
  #endif

  vec3 finalColor = applyLighting(sandColor, vNormal, vPosition, vWorldPosition, shadow);
  gl_FragColor = vec4(finalColor, 1.0);
}
