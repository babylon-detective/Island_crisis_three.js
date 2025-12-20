uniform float uTime;
uniform float uElevation;
uniform float uRoughness;
uniform float uScale;
uniform vec3 uLandColor;
uniform vec3 uRockColor;
uniform vec3 uSandColor;
uniform float uMoisture;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uIslandRadius;
uniform float uCoastSmoothness;
uniform float uSeaLevel;

// Spotlight uniforms
uniform vec3 uSpotlightPosition;
uniform vec3 uSpotlightDirection;
uniform vec3 uSpotlightColor;
uniform float uSpotlightIntensity;
uniform float uSpotlightAngle;
uniform float uSpotlightPenumbra;
uniform float uSpotlightDistance;

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
    
    // === SUN LIGHTING ===
    vec3 lightDirection = normalize(uSunDirection);
    vec3 normal = normalize(vNormal);
    
    // Calculate lighting intensity based on sun position
    float sunDot = max(dot(normal, lightDirection), 0.0);
    
    // Add ambient lighting that varies with sun elevation
    float sunElevation = lightDirection.y;
    float ambientLevel = mix(0.05, 0.3, max(0.0, sunElevation)); // Very dark at night, brighter during day
    float lightIntensity = sunDot * 0.8 + ambientLevel;
    
    // === SPOTLIGHT LIGHTING ===
    // Calculate direction from fragment to spotlight
    vec3 spotlightToFragment = vWorldPosition - uSpotlightPosition;
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
    
    // Combine sun and spotlight lighting
    lightIntensity += spotlightContribution * 0.8;
    
    // Rim lighting for depth
    vec3 viewDirection = normalize(cameraPosition - vPosition);
    float rim = 1.0 - max(dot(viewDirection, normal), 0.0);
    rim = smoothstep(0.6, 1.0, rim);
    
    // Apply lighting to color with sun color influence - modulated by sun intensity
    vec3 lightColor = mix(vec3(0.2, 0.3, 0.6), uSunColor, max(0.0, sunElevation) * uSunIntensity); // Blue tint at night, sun color during day
    
    // Add spotlight color contribution
    lightColor = mix(lightColor, uSpotlightColor, spotlightContribution * 0.5);
    
    vec3 finalColor = earthColor * lightIntensity * lightColor;
    
    // Add rim lighting for definition - stronger during day, only when sun is present
    float rimStrength = mix(0.1, 0.3, max(0.0, sunElevation)) * uSunIntensity;
    finalColor += rim * earthColor * rimStrength;
    
    // Atmospheric perspective (distance fog) - varies with time of day
    float distance = length(vPosition - cameraPosition);
    float fogFactor = smoothstep(200.0, 800.0, distance);
    
    // Fog color changes from day (light blue) to night (dark blue)
    vec3 dayFogColor = vec3(0.8, 0.9, 1.0);
    vec3 nightFogColor = vec3(0.1, 0.2, 0.4);
    vec3 fogColor = mix(nightFogColor, dayFogColor, max(0.0, sunElevation));
    
    finalColor = mix(finalColor, fogColor, fogFactor * 0.3);
    
    // Add subtle color variation based on elevation
    float elevationTint = vElevation * 0.1;
    finalColor += vec3(elevationTint * 0.1, elevationTint * 0.05, -elevationTint * 0.05);
    
    gl_FragColor = vec4(finalColor, 1.0);
} 