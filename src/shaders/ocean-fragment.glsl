uniform float uTime;
uniform vec3 uWaterColor;
uniform vec3 uDeepWaterColor;
uniform vec3 uFoamColor;
uniform float uTransparency;
uniform float uReflectionStrength;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;

varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vWorldPosition;
varying float vRandom;
varying float vWaveHeight;
varying vec3 vNormal;
varying float vFoam;

// Fresnel effect for water surface
float fresnel(vec3 viewDir, vec3 normal, float power) {
    return pow(1.0 - max(0.0, dot(viewDir, normal)), power);
}

// Simulated caustics pattern (unrolled to avoid gradient-in-loop GPU warnings)
float caustics(vec2 uv, float time) {
    vec2 p = uv * 8.0;
    float c = 0.0;
    
    // Iteration 0
    vec2 q0 = p + vec2(cos(time * 0.3), sin(time * 0.2)) * 0.5;
    c += sin(q0.x + cos(q0.y + time * 0.4)) * sin(q0.y + cos(q0.x + time * 0.3));
    
    // Iteration 1
    vec2 q1 = p + vec2(cos(time * 0.3 + 1.0), sin(time * 0.2 + 1.0)) * 0.5;
    c += sin(q1.x + cos(q1.y + time * 0.4)) * sin(q1.y + cos(q1.x + time * 0.3));
    
    // Iteration 2
    vec2 q2 = p + vec2(cos(time * 0.3 + 2.0), sin(time * 0.2 + 2.0)) * 0.5;
    c += sin(q2.x + cos(q2.y + time * 0.4)) * sin(q2.y + cos(q2.x + time * 0.3));
    
    return c * 0.1 + 0.5;
}

// Water depth calculation
float waterDepth(vec3 worldPos) {
    // Simulate depth based on distance from "shore" (can be customized)
    float depth = clamp(length(worldPos.xz) * 0.02, 0.0, 10.0);
    return depth;
}

void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(vNormal);
    
    // Calculate water depth
    float depth = waterDepth(vWorldPosition);
    
    // Base water color mixing based on depth and lighting
    vec3 shallowColor = uWaterColor;
    vec3 deepColor = uDeepWaterColor;
    
    // Calculate sun elevation and visibility for day/night effects
    vec3 sunDir = normalize(uSunDirection);
    float sunElevation = sunDir.y;
    
    // Smooth day-night transition (avoid abrupt step at horizon)
    float sunVisibility = smoothstep(-0.18, 0.25, sunElevation) * clamp(uSunIntensity, 0.0, 1.25);
    
    // Water color responds to sun presence - much darker at night
    float colorIntensity = mix(0.08, 1.12, sunVisibility); // Dark night water, brighter daytime response
    shallowColor *= colorIntensity;
    deepColor *= colorIntensity;
    
    vec3 baseColor = mix(shallowColor, deepColor, smoothstep(0.0, 5.0, depth));
    
    // Fresnel effect for reflections
    float fresnelFactor = fresnel(viewDirection, normal, 2.0);
    
    // Enhanced lighting calculation considering sun visibility and surface normals
    float sunDot = dot(normal, sunDir);
    
    // Calculate surface lighting based on sun visibility and normal direction
    float surfaceLighting = max(0.0, sunDot) * sunVisibility; // Only positive when sun hits surface from above
    
    // Ambient lighting varies dramatically between day and night
    float ambientLevel = mix(0.02, 0.22, sunVisibility); // Keep night dark, day less flat
    
    // Final lighting combines surface lighting with ambient
    float lightIntensity = surfaceLighting * 0.8 + ambientLevel;
    
    // Sun reflection (specular) - only when sun is visible and hitting surface properly
    vec3 sunReflection = normalize(reflect(-sunDir, normal));
    float sunSpec = pow(max(0.0, dot(viewDirection, sunReflection)), 64.0);
    
    // Specular only when: sun is above horizon, hitting surface from above, and has intensity
    float specularStrength = sunVisibility * step(0.0, sunDot); // Double check: sun visible AND hitting surface
    vec3 sunHighlight = uSunColor * sunSpec * uReflectionStrength * specularStrength;
    
    // Sky reflection - changes from day to night
    vec3 daySkyColor = vec3(0.22, 0.45, 0.75); // Deeper day sky reflection (less white horizon)
    vec3 nightSkyColor = vec3(0.1, 0.1, 0.2); // Dark night sky
    vec3 skyReflection = mix(nightSkyColor, daySkyColor, sunVisibility);
    vec3 reflectedColor = skyReflection * fresnelFactor * uReflectionStrength;
    
    // Caustics effect - only visible when sun is shining and hitting the water surface
    float causticsPattern = caustics(vUv + vWorldPosition.xz * 0.1, uTime);
    vec3 causticsColor = vec3(0.8, 1.0, 1.0) * causticsPattern * 0.3 * surfaceLighting;
    
    // Foam calculations
    float foamMask = smoothstep(0.4, 0.8, vFoam);
    vec3 foamEffect = uFoamColor * foamMask;
    
    // Wave crest foam (additional foam on wave peaks)
    float crestFoam = smoothstep(0.3, 0.6, vWaveHeight) * 0.8;
    foamEffect += uFoamColor * crestFoam;
    
    // Underwater light scattering
    float scatter = max(0.0, 1.0 - depth * 0.1);
    vec3 scatterColor = vec3(0.0, 0.4, 0.6) * scatter * 0.2;
    
    // Combine all effects
    vec3 finalColor = baseColor;
    finalColor = mix(finalColor, reflectedColor, fresnelFactor);
    finalColor += sunHighlight;
    finalColor += causticsColor * (1.0 - foamMask);
    finalColor += scatterColor;
    finalColor = mix(finalColor, foamEffect, foamMask);
    
    // Add subsurface scattering - only when sun is shining through the water surface
    float subsurface = pow(max(0.0, sunDot), 0.5) * 0.3;
    vec3 subsurfaceColor = mix(vec3(0.0, 0.1, 0.2), vec3(0.0, 0.3, 0.4), sunVisibility);
    finalColor += subsurfaceColor * subsurface * surfaceLighting;
    
    // Distance-based fog/haze - changes with day/night
    float distance = length(vWorldPosition - cameraPosition);
    float fog = 1.0 - exp(-distance * 0.001);
    vec3 dayFogColor = vec3(0.45, 0.58, 0.72);
    vec3 nightFogColor = vec3(0.1, 0.15, 0.3);
    vec3 fogColor = mix(nightFogColor, dayFogColor, sunVisibility);
    finalColor = mix(finalColor, fogColor, fog * 0.18);
    
    // Alpha based on depth and fresnel
    float alpha = mix(uTransparency, 1.0, fresnelFactor);
    alpha = mix(alpha, 1.0, foamMask); // Foam is opaque
    
    // Add some animation to the overall color
    float timeVariation = sin(uTime * 0.1) * 0.05 + 0.95;
    finalColor *= timeVariation;
    
    gl_FragColor = vec4(finalColor, alpha);
} 