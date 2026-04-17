// Concrete fragment shader
// Procedural concrete: aggregate speckle noise + subtle tile seam lines from UV

#ifdef USE_SHADOWMAP
  #if NUM_DIR_LIGHT_SHADOWS > 0
    varying vec4 vDirectionalShadowCoord[NUM_DIR_LIGHT_SHADOWS];
  #endif
  #if NUM_SPOT_LIGHT_SHADOWS > 0
    varying vec4 vSpotLightShadowCoord[NUM_SPOT_LIGHT_SHADOWS];
  #endif
#endif

#include ./common/lighting-fragment.glsl

uniform vec3 uConcreteColor;
uniform vec3 uConcreteDarkColor;

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
  // World-space coordinate for scale-independent aggregate texture
  vec2 coord = vWorldPosition.xz * 0.20;

  // Multi-scale aggregate speckle
  float speckle = noise(coord * 12.0) * 0.50
                + noise(coord * 30.0) * 0.30
                + noise(coord * 80.0) * 0.20;

  // Subtle tile seams derived from UV (concrete slab joints)
  vec2 tile   = fract(vUv * 4.0);
  float seam  = min(min(tile.x, 1.0 - tile.x), min(tile.y, 1.0 - tile.y));
  float seamMask = 1.0 - smoothstep(0.015, 0.05, seam);

  vec3 concreteColor = mix(uConcreteDarkColor, uConcreteColor, speckle);
  // Darken slightly along seam lines
  concreteColor = mix(concreteColor, uConcreteDarkColor * 0.75, seamMask * 0.35);

  float shadow = 1.0;
  #ifdef USE_SHADOWMAP
    shadow = calculateShadows();
  #endif

  vec3 finalColor = applyLighting(concreteColor, vNormal, vPosition, vWorldPosition, shadow);
  gl_FragColor = vec4(finalColor, 1.0);
}
