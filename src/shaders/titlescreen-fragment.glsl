uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;

// Noise function for animated background
float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// Smooth noise
float smoothNoise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  
  float a = noise(i);
  float b = noise(i + vec2(1.0, 0.0));
  float c = noise(i + vec2(0.0, 1.0));
  float d = noise(i + vec2(1.0, 1.0));
  
  vec2 u = f * f * (3.0 - 2.0 * f);
  
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// Fractal Brownian Motion for complex patterns
float fbm(vec2 st) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 2.0;
  
  for(int i = 0; i < 5; i++) {
    value += amplitude * smoothNoise(st * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  
  return value;
}

void main() {
  vec2 st = vUv;
  
  // Animated ocean-like waves
  float time = uTime * 0.3;
  vec2 pos = st * 3.0;
  pos.y += time * 0.2;
  
  // Multiple layers of FBM for depth
  float pattern1 = fbm(pos + time * 0.1);
  float pattern2 = fbm(pos * 1.5 - time * 0.15);
  float pattern3 = fbm(pos * 0.5 + time * 0.05);
  
  // Combine patterns
  float finalPattern = pattern1 * 0.5 + pattern2 * 0.3 + pattern3 * 0.2;
  
  // Ocean color palette
  vec3 deepBlue = vec3(0.0, 0.1, 0.3);
  vec3 lightBlue = vec3(0.0, 0.4, 0.6);
  vec3 foam = vec3(0.4, 0.6, 0.7);
  
  // Mix colors based on pattern
  vec3 color = mix(deepBlue, lightBlue, finalPattern);
  color = mix(color, foam, smoothstep(0.6, 0.8, finalPattern));
  
  // Add vignette effect
  float vignette = 1.0 - length(st - 0.5) * 0.8;
  color *= vignette;
  
  // Add subtle glow at center
  float glow = exp(-length(st - 0.5) * 2.0) * 0.3;
  color += glow * vec3(0.1, 0.3, 0.5);
  
  gl_FragColor = vec4(color, 1.0);
}
