// ============================================================================
// Character Fragment Shader — Wind-Waker-style cel-shaded with per-object lighting
// Standalone: does NOT include the common lighting system.
// Designed for bright, readable characters that pop against any background.
//
// Lighting model:
//   • 1-2 dominant lights selected per object (JS-side, pushed via uniforms)
//   • Character-space rim/back light for silhouette definition
//   • Independent ambient & brightness boost (artist-controlled)
//   • Banded cel-shaded diffuse + hard specular highlight
//   • Fresnel outline (dark edge)
// ============================================================================

// ---- primary dominant light ----
uniform vec3  uLightDir;          // world-space direction (normalised)
uniform vec3  uLightColor;        // colour of the dominant light
uniform float uLightIntensity;    // intensity multiplier

// ---- secondary light (optional, intensity 0 = off) ----
uniform vec3  uLight2Dir;
uniform vec3  uLight2Color;
uniform float uLight2Intensity;

// ---- global sun cycle light (shared from land/ocean day-night system) ----
uniform vec3  uSunDirection;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform float uSunResponse;
uniform float uLandscapeLightingBlend;

// ---- centralized spotlight (shared with land system) ----
uniform vec3  uSpotlightPosition;
uniform vec3  uSpotlightDirection;
uniform vec3  uSpotlightColor;
uniform float uSpotlightIntensity;
uniform float uSpotlightAngle;
uniform float uSpotlightPenumbra;
uniform float uSpotlightDistance;
uniform float uSpotlightResponse;

// ---- character colour & shading ----
uniform vec3  uModelColor;
uniform float uAmbient;           // ambient brightness   [0–1]  default 0.55
uniform float uBrightBoost;       // additive emissive lift       default 0.18
uniform float uBands;             // number of toon bands          default 3.0

// ---- rim light (character-space, follows the character) ----
uniform vec3  uRimColor;          // rim/back-light colour         default (1,1,1)
uniform float uRimStrength;       // rim intensity                 default 0.45
uniform float uRimPower;          // rim exponent (sharpness)      default 2.5

// ---- specular ----
uniform float uSpecStrength;      // specular highlight intensity  default 0.15
uniform float uSpecPower;         // specular exponent             default 32.0

// ---- outline (dark Fresnel edge) ----
uniform float uOutlineWidth;      // outline thickness     [0–1]  default 0.38
uniform vec3  uOutlineColor;      // outline colour                default (0.08,0.06,0.12)

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec2 vUv;

// ---- helpers ----
float celDiffuse(vec3 N, vec3 L, float ambient, float bands) {
  float NdotL   = dot(N, L) * 0.5 + 0.5;      // half-lambert [0,1]
  float stepped = floor(NdotL * bands) / bands;
  return mix(ambient, 1.0, stepped);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewPosition);            // toward camera
  vec3 L1 = normalize(uLightDir);
  float bands = max(uBands, 1.0);

  // Ambient baseline is partly driven by sun height for landscape meshes.
  float sunHeight = max(normalize(uSunDirection).y, 0.0);
  float dayAmbient = mix(0.06, 0.42, sunHeight) * mix(0.35, 1.0, clamp(uSunIntensity, 0.0, 1.25));
  float ambientBase = mix(uAmbient, dayAmbient, clamp(uLandscapeLightingBlend, 0.0, 1.0));

  vec3 litColor = uModelColor * ambientBase;

  // ==== PRIMARY LIGHT (cel-shaded diffuse) ====
  float diff1  = celDiffuse(N, L1, 0.0, bands);
  litColor += uModelColor * diff1 * uLightColor * uLightIntensity;

  // ==== SECONDARY LIGHT (same treatment, additive) ====
  if (uLight2Intensity > 0.001) {
    vec3 L2    = normalize(uLight2Dir);
    float diff2 = celDiffuse(N, L2, 0.0, bands);
    litColor   += uModelColor * diff2 * uLight2Color * uLight2Intensity;
  }

  // ==== SUN CYCLE LIGHT (day-night driven) ====
  // Keeps environment models in sync with terrain/ocean sun transitions.
  if (uSunIntensity > 0.001) {
    vec3 Ls = normalize(uSunDirection);
    float sunDiff = celDiffuse(N, Ls, 0.0, bands);
    litColor += uModelColor * sunDiff * uSunColor * uSunIntensity * uSunResponse;
  }

  // ==== CENTRALIZED PLAYER SPOTLIGHT (night-time local lighting) ====
  if (uSpotlightIntensity > 0.001 && uSpotlightResponse > 0.001) {
    vec3 spotlightToFragment = vWorldPosition - uSpotlightPosition;
    float distanceToSpotlight = length(spotlightToFragment);
    vec3 spotlightDir = normalize(spotlightToFragment);

    float spotlightDot = dot(normalize(uSpotlightDirection), spotlightDir);
    float cutoff = cos(uSpotlightAngle);
    float outerCutoff = cos(uSpotlightAngle + uSpotlightPenumbra);
    float cone = smoothstep(outerCutoff, cutoff, spotlightDot);

    float attenuation = 1.0 - smoothstep(0.0, uSpotlightDistance, distanceToSpotlight);
    float ndotl = max(dot(N, -spotlightDir), 0.0);
    float spotlightContribution = cone * attenuation * ndotl * uSpotlightIntensity * uSpotlightResponse;

    litColor += uModelColor * uSpotlightColor * spotlightContribution;
  }

  // ==== SPECULAR HIGHLIGHT (hard band, primary light only) ====
  vec3  H        = normalize(L1 + V);
  float spec     = pow(max(dot(N, H), 0.0), uSpecPower);
  float specBand = step(0.5, spec);
  litColor      += uLightColor * uSpecStrength * specBand;

  // ==== BRIGHTNESS BOOST (emissive-style lift) ====
  litColor += uModelColor * uBrightBoost;

  // ==== RIM / BACK LIGHT (character-space) ====
  float rim = 1.0 - max(dot(N, V), 0.0);       // 0 = facing camera, 1 = silhouette
  rim = pow(rim, uRimPower);
  litColor += uRimColor * rim * uRimStrength;

  // ==== OUTLINE (dark Fresnel edge, painted over rim) ====
  float edge    = 1.0 - max(dot(N, V), 0.0);
  float outline = smoothstep(1.0 - uOutlineWidth, 1.0, edge);
  litColor      = mix(litColor, uOutlineColor, outline);

  gl_FragColor = vec4(litColor, 1.0);
}
