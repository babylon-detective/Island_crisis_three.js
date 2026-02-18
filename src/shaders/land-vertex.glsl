#include ./common/lighting-vertex.glsl

uniform float uTime;
uniform float uElevation;
uniform float uRoughness;
uniform float uScale;
uniform vec3 uLandColor;
uniform vec3 uRockColor;
uniform float uIslandRadius;
uniform float uCoastSmoothness;
uniform float uSeaLevel;

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
varying vec2 vUv;
varying float vElevation;
varying float vSlope;
varying vec3 vWorldPosition;

// Noise functions for terrain generation
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
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 0.0;
    
    for (int i = 0; i < 6; i++) {
        value += amplitude * noise(st);
        st *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

void main() {
    vec3 pos = position;
    
    // No vertex displacement - geometry comes from imported models
    // Calculate elevation and slope from original geometry for fragment shader
    vec2 noiseCoord = pos.xz * uScale * 0.1;
    
    // Calculate elevation value for texture blending (not actual displacement)
    float height = fbm(noiseCoord) * uElevation;
    height += fbm(noiseCoord * 2.0) * uElevation * 0.6;
    height += fbm(noiseCoord * 4.0) * uElevation * 0.4;
    height += fbm(noiseCoord * 8.0) * uElevation * 0.2;
    
    // Add ridges for texture variation
    float ridgeNoise = abs(noise(noiseCoord * 3.0) - 0.5) * 2.0;
    height += ridgeNoise * uElevation * 0.3;
    
    // Add time-based variation for texture animation
    height += sin(uTime * 0.1 + pos.x * 0.1) * cos(uTime * 0.1 + pos.z * 0.1) * uRoughness * 0.1;
    
    // Pass data to fragment shader (using original geometry normal)
    vPosition = pos;
    vNormal = normal;
    vUv = uv;
    vElevation = height;
    vSlope = 1.0 - dot(normalize(normal), vec3(0.0, 1.0, 0.0));
    
    // World position for lighting calculations
    vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
    vWorldPosition = worldPosition.xyz;
    
    // Calculate shadow coordinates inline (using common lighting uniforms)
    #ifdef USE_SHADOWMAP
      #if NUM_DIR_LIGHT_SHADOWS > 0
        vDirectionalShadowCoord[0] = directionalShadowMatrix[0] * worldPosition;
      #endif
      #if NUM_SPOT_LIGHT_SHADOWS > 0
        vSpotLightShadowCoord[0] = spotShadowMatrix[0] * worldPosition;
      #endif
    #endif
    
    // Transform position (no displacement applied)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
} 