// Default lighting fragment shader
// Reusable for any mesh asset that needs sun and spotlight lighting
// Inherits lighting behavior from land shaders

uniform vec3 uModelColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;

// Spotlight uniforms (same as land shader)
uniform vec3 uSpotlightPosition;
uniform vec3 uSpotlightDirection;
uniform vec3 uSpotlightColor;
uniform float uSpotlightIntensity;
uniform float uSpotlightAngle;
uniform float uSpotlightPenumbra;
uniform float uSpotlightDistance;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vUv;

void main() {
  vec3 normal = normalize(vNormal);
  
  // === SUN LIGHTING ===
  vec3 lightDirection = normalize(uSunDirection);
  float sunDot = max(dot(normal, lightDirection), 0.0);
  
  // Calculate ambient based on sun elevation (day/night cycle)
  float sunElevation = lightDirection.y;
  float ambientLevel = mix(0.05, 0.3, max(0.0, sunElevation));
  float lightIntensity = sunDot * 0.8 + ambientLevel;
  
  // === SPOTLIGHT LIGHTING ===
  vec3 spotlightToFragment = vWorldPosition - uSpotlightPosition;
  float distanceToSpotlight = length(spotlightToFragment);
  vec3 spotlightDir = normalize(spotlightToFragment);
  
  // Calculate spotlight cone angle
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
  
  // Add spotlight to light intensity
  lightIntensity += spotlightContribution * 0.8;
  
  // === COLOR AND LIGHTING ===
  // Light color changes from night (blue) to day (sun color)
  vec3 lightColor = mix(vec3(0.2, 0.3, 0.6), uSunColor, max(0.0, sunElevation) * uSunIntensity);
  
  // Add spotlight color contribution
  lightColor = mix(lightColor, uSpotlightColor, spotlightContribution * 0.5);
  
  // Apply lighting to model color
  vec3 finalColor = uModelColor * lightIntensity * lightColor;
  
  // === RIM LIGHTING ===
  vec3 viewDirection = normalize(cameraPosition - vPosition);
  float rim = 1.0 - max(dot(viewDirection, normal), 0.0);
  rim = smoothstep(0.6, 1.0, rim);
  
  // Rim strength varies with sun elevation
  float rimStrength = mix(0.1, 0.3, max(0.0, sunElevation)) * uSunIntensity;
  finalColor += rim * uModelColor * rimStrength;
  
  // === ATMOSPHERIC DISTANCE FOG ===
  float distance = length(vPosition - cameraPosition);
  float fogFactor = smoothstep(200.0, 800.0, distance);
  
  // Fog color changes from night (dark blue) to day (light blue)
  vec3 dayFogColor = vec3(0.8, 0.9, 1.0);
  vec3 nightFogColor = vec3(0.1, 0.2, 0.4);
  vec3 fogColor = mix(nightFogColor, dayFogColor, max(0.0, sunElevation));
  
  finalColor = mix(finalColor, fogColor, fogFactor * 0.3);
  
  gl_FragColor = vec4(finalColor, 1.0);
}
