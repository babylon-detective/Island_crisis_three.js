// Default lighting fragment shader
// Reusable for any mesh asset that needs sun and spotlight lighting
// Inherits lighting behavior from common lighting system

// Shadow coord varyings must be declared BEFORE the common lighting include
#ifdef USE_SHADOWMAP
  #if NUM_DIR_LIGHT_SHADOWS > 0
    varying vec4 vDirectionalShadowCoord[NUM_DIR_LIGHT_SHADOWS];
  #endif
  #if NUM_SPOT_LIGHT_SHADOWS > 0
    varying vec4 vSpotLightShadowCoord[NUM_SPOT_LIGHT_SHADOWS];
  #endif
#endif

#include ./common/lighting-fragment.glsl

uniform vec3 uModelColor;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vUv;

void main() {
  // Calculate shadows
  float shadow = 1.0;
  #ifdef USE_SHADOWMAP
    shadow = calculateShadows();
  #endif
  
  // Apply lighting using common lighting system
  vec3 finalColor = applyLighting(
    uModelColor,
    vNormal,
    vPosition,
    vWorldPosition,
    shadow
  );
  
  gl_FragColor = vec4(finalColor, 1.0);
}
