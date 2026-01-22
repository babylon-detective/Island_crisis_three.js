// Common lighting and shadow vertex shader code
// Reusable across all materials that need shadow receiving

// Shadow map matrices (injected by Three.js when receiveShadow=true)
#ifdef USE_SHADOWMAP
  #if NUM_DIR_LIGHT_SHADOWS > 0
    uniform mat4 directionalShadowMatrix[NUM_DIR_LIGHT_SHADOWS];
  #endif
  #if NUM_SPOT_LIGHT_SHADOWS > 0
    uniform mat4 spotShadowMatrix[NUM_SPOT_LIGHT_SHADOWS];
  #endif
#endif

// Calculate shadow coordinates for a world position
// Call this in your vertex shader after calculating worldPosition
void calculateShadowCoords(
  vec4 worldPosition,
  out vec4 vDirectionalShadowCoords[NUM_DIR_LIGHT_SHADOWS],
  out vec4 vSpotLightShadowCoords[NUM_SPOT_LIGHT_SHADOWS]
) {
  #ifdef USE_SHADOWMAP
    #if NUM_DIR_LIGHT_SHADOWS > 0
      vDirectionalShadowCoords[0] = directionalShadowMatrix[0] * worldPosition;
    #endif
    #if NUM_SPOT_LIGHT_SHADOWS > 0
      vSpotLightShadowCoords[0] = spotShadowMatrix[0] * worldPosition;
    #endif
  #endif
}
