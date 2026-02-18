// Common lighting and shadow vertex shader code
// Reusable across all materials that need shadow receiving

// Shadow map matrices (populated by Three.js when lights:true + shadow casting lights)
#ifdef USE_SHADOWMAP
  #if NUM_DIR_LIGHT_SHADOWS > 0
    uniform mat4 directionalShadowMatrix[NUM_DIR_LIGHT_SHADOWS];
  #endif
  #if NUM_SPOT_LIGHT_SHADOWS > 0
    uniform mat4 spotShadowMatrix[NUM_SPOT_LIGHT_SHADOWS];
  #endif
#endif

// NOTE: calculateShadowCoords removed — callers should compute shadow coords
// inline using the guarded varying/uniform blocks to avoid zero-length array
// parameters when NUM_SPOT_LIGHT_SHADOWS or NUM_DIR_LIGHT_SHADOWS is 0.
