uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uColorLevels;
uniform float uDitherAmount;
uniform float uContrast;
uniform float uSaturation;
uniform float uEdgeThickness;
uniform float uEdgeIntensity;
uniform vec3 uEdgeColor;
uniform float uDepthEdgeThreshold;
uniform float uNormalEdgeThreshold;

varying vec2 vUv;

// Dithering pattern (Bayer 4x4)
float ditherPattern(vec2 coord) {
    int x = int(mod(coord.x, 4.0));
    int y = int(mod(coord.y, 4.0));
    
    // Bayer 4x4 matrix
    float bayer[16];
    bayer[0] = 0.0 / 16.0;  bayer[1] = 8.0 / 16.0;  bayer[2] = 2.0 / 16.0;  bayer[3] = 10.0 / 16.0;
    bayer[4] = 12.0 / 16.0; bayer[5] = 4.0 / 16.0;  bayer[6] = 14.0 / 16.0; bayer[7] = 6.0 / 16.0;
    bayer[8] = 3.0 / 16.0;  bayer[9] = 11.0 / 16.0; bayer[10] = 1.0 / 16.0; bayer[11] = 9.0 / 16.0;
    bayer[12] = 15.0 / 16.0; bayer[13] = 7.0 / 16.0; bayer[14] = 13.0 / 16.0; bayer[15] = 5.0 / 16.0;
    
    return bayer[y * 4 + x];
}

// Quantize/posterize color
vec3 quantizeColor(vec3 color, float levels) {
    return floor(color * levels) / levels;
}

// Pixelate coordinates
vec2 pixelate(vec2 uv, vec2 resolution, float pixelSize) {
    vec2 pixelScale = resolution / pixelSize;
    return floor(uv * pixelScale) / pixelScale;
}

// Sobel edge detection for depth
float depthEdge(sampler2D depthTex, vec2 uv, vec2 texelSize, float threshold) {
    // Sample depth in 3x3 grid
    float d00 = texture2D(depthTex, uv + vec2(-1.0, -1.0) * texelSize).r;
    float d01 = texture2D(depthTex, uv + vec2(-1.0,  0.0) * texelSize).r;
    float d02 = texture2D(depthTex, uv + vec2(-1.0,  1.0) * texelSize).r;
    float d10 = texture2D(depthTex, uv + vec2( 0.0, -1.0) * texelSize).r;
    float d12 = texture2D(depthTex, uv + vec2( 0.0,  1.0) * texelSize).r;
    float d20 = texture2D(depthTex, uv + vec2( 1.0, -1.0) * texelSize).r;
    float d21 = texture2D(depthTex, uv + vec2( 1.0,  0.0) * texelSize).r;
    float d22 = texture2D(depthTex, uv + vec2( 1.0,  1.0) * texelSize).r;
    
    // Sobel operator
    float sobelX = d00 + 2.0 * d01 + d02 - d20 - 2.0 * d21 - d22;
    float sobelY = d00 + 2.0 * d10 + d20 - d02 - 2.0 * d12 - d22;
    float edge = sqrt(sobelX * sobelX + sobelY * sobelY);
    
    return step(threshold, edge);
}

// Sobel edge detection for normals
float normalEdge(sampler2D normalTex, vec2 uv, vec2 texelSize, float threshold) {
    // Sample normals in 3x3 grid
    vec3 n00 = texture2D(normalTex, uv + vec2(-1.0, -1.0) * texelSize).rgb;
    vec3 n01 = texture2D(normalTex, uv + vec2(-1.0,  0.0) * texelSize).rgb;
    vec3 n02 = texture2D(normalTex, uv + vec2(-1.0,  1.0) * texelSize).rgb;
    vec3 n10 = texture2D(normalTex, uv + vec2( 0.0, -1.0) * texelSize).rgb;
    vec3 n12 = texture2D(normalTex, uv + vec2( 0.0,  1.0) * texelSize).rgb;
    vec3 n20 = texture2D(normalTex, uv + vec2( 1.0, -1.0) * texelSize).rgb;
    vec3 n21 = texture2D(normalTex, uv + vec2( 1.0,  0.0) * texelSize).rgb;
    vec3 n22 = texture2D(normalTex, uv + vec2( 1.0,  1.0) * texelSize).rgb;
    
    // Sobel operator for each component
    vec3 sobelX = n00 + 2.0 * n01 + n02 - n20 - 2.0 * n21 - n22;
    vec3 sobelY = n00 + 2.0 * n10 + n20 - n02 - 2.0 * n12 - n22;
    float edge = length(sobelX) + length(sobelY);
    
    return step(threshold, edge);
}

void main() {
    // Pixelate the UV coordinates
    vec2 pixelatedUv = pixelate(vUv, uResolution, uPixelSize);
    
    // Sample the texture
    vec4 color = texture2D(tDiffuse, pixelatedUv);
    
    // === EDGE DETECTION ===
    vec2 texelSize = uEdgeThickness / uResolution;
    
    // Detect depth edges (object silhouettes)
    float depthEdgeValue = 0.0;
    if (uDepthEdgeThreshold > 0.0) {
        depthEdgeValue = depthEdge(tDepth, pixelatedUv, texelSize, uDepthEdgeThreshold);
    }
    
    // Detect normal edges (surface creases)
    float normalEdgeValue = 0.0;
    if (uNormalEdgeThreshold > 0.0) {
        normalEdgeValue = normalEdge(tNormal, pixelatedUv, texelSize, uNormalEdgeThreshold);
    }
    
    // Combine edge detection (take maximum)
    float edgeValue = max(depthEdgeValue, normalEdgeValue);
    
    // Apply contrast
    color.rgb = (color.rgb - 0.5) * uContrast + 0.5;
    
    // Apply saturation
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(gray), color.rgb, uSaturation);
    
    // Quantize/posterize colors
    color.rgb = quantizeColor(color.rgb, uColorLevels);
    
    // Apply dithering
    vec2 ditherCoord = gl_FragCoord.xy;
    float dither = ditherPattern(ditherCoord) - 0.5;
    color.rgb += dither * uDitherAmount / uColorLevels;
    
    // Clamp to valid range
    color.rgb = clamp(color.rgb, 0.0, 1.0);
    
    // === APPLY EDGES ===
    // Mix edge color with scene color based on edge detection
    color.rgb = mix(color.rgb, uEdgeColor, edgeValue * uEdgeIntensity);
    
    gl_FragColor = color;
}

