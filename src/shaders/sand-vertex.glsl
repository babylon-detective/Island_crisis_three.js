// Sand vertex shader

#include ./common/lighting-vertex.glsl

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
  vPosition = position;
  vNormal = normalize(normalMatrix * normal);
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vUv = uv;

  #ifdef USE_SHADOWMAP
    #if NUM_DIR_LIGHT_SHADOWS > 0
      vDirectionalShadowCoord[0] = directionalShadowMatrix[0] * worldPosition;
    #endif
    #if NUM_SPOT_LIGHT_SHADOWS > 0
      vSpotLightShadowCoord[0] = spotShadowMatrix[0] * worldPosition;
    #endif
  #endif

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
