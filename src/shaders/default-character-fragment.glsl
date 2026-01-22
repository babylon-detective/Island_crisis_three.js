// Character shader - flat cel-shaded look with strong outlines
// Always bright, even in darkness, with stepped lighting

// Enable toon/cel shading with 4 lighting levels
#define TOON_ENABLED 1
#define TOON_LEVELS 4.0
#define RIM_STRENGTH_MULTIPLIER 3.0  // Strong outline effect

#include ./common/lighting-fragment.glsl

uniform vec3 uModelColor;

#ifdef USE_SHADOWMAP
  #if NUM_DIR_LIGHT_SHADOWS > 0
    varying vec4 vDirectionalShadowCoord[NUM_DIR_LIGHT_SHADOWS];
  #endif
  #if NUM_SPOT_LIGHT_SHADOWS > 0
    varying vec4 vSpotLightShadowCoord[NUM_SPOT_LIGHT_SHADOWS];
  #endif
#endif

varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vUv;

void main() {
  // Calculate shadows
  float shadow = 1.0;
  #ifdef USE_SHADOWMAP
    shadow = calculateShadows(vDirectionalShadowCoord, vSpotLightShadowCoord);
  #endif
  
  // Apply lighting using common lighting system (with toon shading)
  vec3 finalColor = applyLighting(
    uModelColor,
    vNormal,
    vPosition,
    vWorldPosition,
    shadow
  );
  
  // Boost overall brightness - characters are always visible
  // Add constant ambient boost so they're never too dark
  float brightnessBoost = 0.4;  // Minimum 40% brightness
  finalColor = max(finalColor, uModelColor * brightnessBoost);
  
  gl_FragColor = vec4(finalColor, 1.0);
}
