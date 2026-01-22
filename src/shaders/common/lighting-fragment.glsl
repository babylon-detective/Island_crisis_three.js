// Common lighting and shadow fragment shader code
// Reusable across all materials that need sun and spotlight lighting with shadow receiving

// === UNIFORMS ===
// These must be defined in the parent shader
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uSpotlightPosition;
uniform vec3 uSpotlightDirection;
uniform vec3 uSpotlightColor;
uniform float uSpotlightIntensity;
uniform float uSpotlightAngle;
uniform float uSpotlightPenumbra;
uniform float uSpotlightDistance;

// Toon/cel shading controls (optional, defaults provided)
#ifndef TOON_LEVELS
  #define TOON_LEVELS 3.0  // Number of distinct lighting bands
#endif
#ifndef TOON_ENABLED
  #define TOON_ENABLED 0  // Set to 1 to enable toon shading
#endif
#ifndef RIM_STRENGTH_MULTIPLIER
  #define RIM_STRENGTH_MULTIPLIER 1.0  // Increase for more pronounced edges
#endif

// Shadow map uniforms (injected by Three.js when receiveShadow=true)
#ifdef USE_SHADOWMAP
  #if NUM_DIR_LIGHT_SHADOWS > 0
    uniform sampler2D directionalShadowMap[NUM_DIR_LIGHT_SHADOWS];
  #endif
  #if NUM_SPOT_LIGHT_SHADOWS > 0
    uniform sampler2D spotShadowMap[NUM_SPOT_LIGHT_SHADOWS];
  #endif
#endif

// === SHADOW FUNCTIONS ===

// Shadow map sampling with PCF (Percentage Closer Filtering) for soft shadows
float getShadow(sampler2D shadowMap, vec4 shadowCoord) {
  // Perspective divide to get NDC coordinates
  vec3 projCoords = shadowCoord.xyz / shadowCoord.w;
  
  // Transform to [0,1] range
  projCoords = projCoords * 0.5 + 0.5;
  
  // Outside shadow map bounds - no shadow
  if (projCoords.z > 1.0 || projCoords.x < 0.0 || projCoords.x > 1.0 || projCoords.y < 0.0 || projCoords.y > 1.0) {
    return 1.0;
  }
  
  // Get current depth
  float currentDepth = projCoords.z;
  
  // PCF (Percentage Closer Filtering) for soft shadows
  float shadow = 0.0;
  vec2 texelSize = 1.0 / vec2(2048.0); // Shadow map resolution
  float bias = 0.005; // Reduce shadow acne
  
  // 3x3 PCF sampling
  for(int x = -1; x <= 1; x++) {
    for(int y = -1; y <= 1; y++) {
      float pcfDepth = texture2D(shadowMap, projCoords.xy + vec2(x, y) * texelSize).r;
      shadow += currentDepth - bias > pcfDepth ? 0.0 : 1.0;
    }
  }
  shadow /= 9.0;
  
  return shadow;
}

// Calculate shadows from all light sources
float calculateShadows(vec4 vDirectionalShadowCoords[NUM_DIR_LIGHT_SHADOWS], vec4 vSpotLightShadowCoords[NUM_SPOT_LIGHT_SHADOWS]) {
  float shadow = 1.0; // Default: no shadow (full light)
  
  #ifdef USE_SHADOWMAP
    // Sample directional light shadows (sun)
    #if NUM_DIR_LIGHT_SHADOWS > 0
      shadow = getShadow(directionalShadowMap[0], vDirectionalShadowCoords[0]);
    #endif
    
    // Sample spotlight shadows
    #if NUM_SPOT_LIGHT_SHADOWS > 0
      float spotShadow = getShadow(spotShadowMap[0], vSpotLightShadowCoords[0]);
      shadow = min(shadow, spotShadow); // Take darkest shadow
    #endif
  #endif
  
  return shadow;
}

// === TOON/CEL SHADING ===

// Quantize lighting into discrete bands for toon shading effect
float quantizeLighting(float lighting, float levels) {
  return floor(lighting * levels) / levels;
}

// === LIGHTING FUNCTIONS ===

// Calculate spotlight contribution
float calculateSpotlight(vec3 worldPosition, vec3 normal) {
  // Calculate direction from fragment to spotlight
  vec3 spotlightToFragment = worldPosition - uSpotlightPosition;
  float distanceToSpotlight = length(spotlightToFragment);
  vec3 spotlightDir = normalize(spotlightToFragment);
  
  // Calculate angle between spotlight direction and fragment direction
  float spotlightDot = dot(normalize(uSpotlightDirection), spotlightDir);
  float spotlightCutoff = cos(uSpotlightAngle);
  float spotlightOuterCutoff = cos(uSpotlightAngle + uSpotlightPenumbra);
  
  // Smooth falloff at spotlight edges
  float spotlightEffect = smoothstep(spotlightOuterCutoff, spotlightCutoff, spotlightDot);
  
  // Distance attenuation
  float attenuation = 1.0 - smoothstep(0.0, uSpotlightDistance, distanceToSpotlight);
  
  // Calculate spotlight contribution
  float spotlightNdotL = max(dot(normal, -spotlightDir), 0.0);
  float spotlightContribution = spotlightEffect * attenuation * spotlightNdotL * uSpotlightIntensity;
  
  return spotlightContribution;
}

// Calculate rim lighting
float calculateRimLighting(vec3 viewPosition, vec3 normal) {
  vec3 viewDirection = normalize(cameraPosition - viewPosition);
  float rim = 1.0 - max(dot(viewDirection, normal), 0.0);
  rim = smoothstep(0.5, 1.0, rim); // More pronounced edge detection
  return rim * RIM_STRENGTH_MULTIPLIER;
}

// Apply atmospheric distance fog
vec3 applyFog(vec3 color, vec3 viewPosition, float sunElevation) {
  float distance = length(viewPosition - cameraPosition);
  float fogFactor = smoothstep(200.0, 800.0, distance);
  
  // Fog color changes from night (dark blue) to day (light blue)
  vec3 dayFogColor = vec3(0.8, 0.9, 1.0);
  vec3 nightFogColor = vec3(0.1, 0.2, 0.4);
  vec3 fogColor = mix(nightFogColor, dayFogColor, max(0.0, sunElevation));
  
  return mix(color, fogColor, fogFactor * 0.3);
}

// Main lighting function - applies sun, spotlight, shadows, rim lighting, and fog
vec3 applyLighting(
  vec3 baseColor, 
  vec3 normal, 
  vec3 viewPosition, 
  vec3 worldPosition,
  float shadow
) {
  normal = normalize(normal);
  
  // === SUN LIGHTING ===
  vec3 lightDirection = normalize(uSunDirection);
  float sunDot = max(dot(normal, lightDirection), 0.0);
  
  // Calculate ambient based on sun elevation (day/night cycle)
  float sunElevation = lightDirection.y;
  float ambientLevel = mix(0.05, 0.3, max(0.0, sunElevation));
  
  // Apply shadow to sun lighting (preserve ambient)
  float sunLighting = sunDot * 0.8 * shadow;
  float lightIntensity = sunLighting + ambientLevel;
    // Apply toon shading quantization if enabled
  #if TOON_ENABLED > 0
    lightIntensity = quantizeLighting(lightIntensity, TOON_LEVELS);
  #endif
    // === SPOTLIGHT LIGHTING ===
  float spotlightContribution = calculateSpotlight(worldPosition, normal);
  
  // Apply spotlight shadow if available
  #ifdef USE_SHADOWMAP
    #if NUM_SPOT_LIGHT_SHADOWS > 0
      spotlightContribution *= shadow;
    #endif
  #endif
  
  // Add spotlight to light intensity
  lightIntensity += spotlightContribution * 0.8;
  
  // === COLOR AND LIGHTING ===
  // Light color changes from night (blue) to day (sun color)
  vec3 lightColor = mix(vec3(0.2, 0.3, 0.6), uSunColor, max(0.0, sunElevation) * uSunIntensity);
  
  // Add spotlight color contribution
  lightColor = mix(lightColor, uSpotlightColor, spotlightContribution * 0.5);
  
  // Apply lighting to base color
  vec3 finalColor = baseColor * lightIntensity * lightColor;
  
  // === RIM LIGHTING ===
  float rim = calculateRimLighting(viewPosition, normal);
  
  // Rim strength varies with sun elevation
  float rimStrength = mix(0.1, 0.3, max(0.0, sunElevation)) * uSunIntensity;
  finalColor += rim * baseColor * rimStrength;
  
  // === ATMOSPHERIC FOG ===
  finalColor = applyFog(finalColor, viewPosition, sunElevation);
  
  return finalColor;
}
