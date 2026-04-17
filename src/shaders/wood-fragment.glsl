// Wood fragment shader
// Procedural wood grain: UV-based concentric rings distorted by fbm noise

#ifdef USE_SHADOWMAP
  #if NUM_DIR_LIGHT_SHADOWS > 0
    varying vec4 vDirectionalShadowCoord[NUM_DIR_LIGHT_SHADOWS];
  #endif
  #if NUM_SPOT_LIGHT_SHADOWS > 0
    varying vec4 vSpotLightShadowCoord[NUM_SPOT_LIGHT_SHADOWS];
  #endif
#endif

#include ./common/lighting-fragment.glsl

uniform vec3 uWoodColor;
uniform vec3 uWoodDarkColor;

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

float fbm(vec2 st) {
  float value     = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value     += amplitude * noise(st);
    st        *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  // Scale UV to control ring density
  vec2 coord = vUv * 10.0;

  // Low-frequency fbm distortion for organic imperfection
  float distort = fbm(coord * 0.35) * 3.0;

  // Concentric ring pattern along U axis, distorted
  float rings = sin((coord.x + distort) * 4.5) * 0.5 + 0.5;
  rings = smoothstep(0.25, 0.75, rings);

  // Fine longitudinal grain lines along V
  float grain = noise(vec2(coord.x * 0.8, coord.y * 25.0)) * 0.12;

  vec3 woodColor = mix(uWoodDarkColor, uWoodColor, clamp(rings + grain, 0.0, 1.0));

  float shadow = 1.0;
  #ifdef USE_SHADOWMAP
    shadow = calculateShadows();
  #endif

  vec3 finalColor = applyLighting(woodColor, vNormal, vPosition, vWorldPosition, shadow);
  gl_FragColor = vec4(finalColor, 1.0);
}
