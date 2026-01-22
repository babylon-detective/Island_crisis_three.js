#include ./common/lighting-fragment.glsl

uniform float uTime;
uniform float uElevation;
uniform float uRoughness;
uniform float uScale;
uniform vec3 uLandColor;
uniform vec3 uRockColor;
uniform vec3 uSandColor;
uniform float uMoisture;
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

// Noise function for texture variation
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

vec3 generateEarthTexture(vec2 coord, float elevation, float slope) {
    // Base colors
    vec3 grassColor = uLandColor;
    vec3 dirtColor = uLandColor * 0.7;
    vec3 rockColor = uRockColor;
    vec3 sandColor = uSandColor;
    
    // Add texture variation using noise
    float textureNoise = noise(coord * 50.0);
    float detailNoise = noise(coord * 200.0) * 0.3;
    
    // Grass/dirt base
    vec3 baseColor = mix(dirtColor, grassColor, smoothstep(0.3, 0.7, textureNoise + uMoisture));
    
    // Rock on steep slopes
    float rockMix = smoothstep(0.3, 0.8, slope + textureNoise * 0.2);
    baseColor = mix(baseColor, rockColor, rockMix);
    
    // Sand at low elevations
    float sandMix = smoothstep(-0.5, 0.2, -elevation) * (1.0 - slope);
    baseColor = mix(baseColor, sandColor, sandMix);
    
    // Add detail variation
    baseColor += (detailNoise - 0.15) * 0.1;
    
    return baseColor;
}

void main() {
    vec2 textureCoord = vPosition.xz * uScale * 0.05;
    
    // Generate base earth texture
    vec3 earthColor = generateEarthTexture(textureCoord, vElevation, vSlope);
    
    // Calculate shadows
    float shadow = 1.0;
    #ifdef USE_SHADOWMAP
      shadow = calculateShadows(vDirectionalShadowCoord, vSpotLightShadowCoord);
    #endif
    
    // Apply lighting using common lighting system
    vec3 finalColor = applyLighting(
      earthColor,
      vNormal,
      vPosition,
      vWorldPosition,
      shadow
    );
    
    // Add subtle color variation based on elevation
    float elevationTint = vElevation * 0.1;
    finalColor += vec3(elevationTint * 0.1, elevationTint * 0.05, -elevationTint * 0.05);
    
    gl_FragColor = vec4(finalColor, 1.0);
} 