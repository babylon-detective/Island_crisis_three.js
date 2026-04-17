// ============================================================================
// Silhouette Fragment Shader — ultra-cheap distance rendering
// ~10 instructions total. Retro/toon aesthetic for distant objects.
//
// Features:
//   • Flat base colour (no lighting calculation)
//   • Fresnel outline for silhouette definition
//   • Bayer 4×4 dithered alpha dissolve near visibility boundary
//   • Matches the retro post-process dithering aesthetic
// ============================================================================

uniform vec3  uSilhouetteColor;    // flat fill colour (derived from original material)
uniform vec3  uOutlineColor;       // dark edge colour           default (0.08, 0.06, 0.12)
uniform float uOutlineWidth;       // Fresnel outline threshold  default 0.4
uniform float uDitherFade;         // 0.0 = fully visible, 1.0 = fully dissolved
uniform float uAmbientBoost;       // slight brightness lift     default 0.05

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec4 vScreenPos;

// Bayer 4×4 dither matrix — same pattern as retro post-process
float bayerDither(vec2 screenCoord) {
  int x = int(mod(screenCoord.x, 4.0));
  int y = int(mod(screenCoord.y, 4.0));

  float bayer[16];
  bayer[0]  =  0.0 / 16.0; bayer[1]  =  8.0 / 16.0;
  bayer[2]  =  2.0 / 16.0; bayer[3]  = 10.0 / 16.0;
  bayer[4]  = 12.0 / 16.0; bayer[5]  =  4.0 / 16.0;
  bayer[6]  = 14.0 / 16.0; bayer[7]  =  6.0 / 16.0;
  bayer[8]  =  3.0 / 16.0; bayer[9]  = 11.0 / 16.0;
  bayer[10] =  1.0 / 16.0; bayer[11] =  9.0 / 16.0;
  bayer[12] = 15.0 / 16.0; bayer[13] =  7.0 / 16.0;
  bayer[14] = 13.0 / 16.0; bayer[15] =  5.0 / 16.0;

  return bayer[y * 4 + x];
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);

  // ---- Flat colour with slight lift ----
  vec3 color = uSilhouetteColor + uAmbientBoost;

  // ---- Fresnel outline (silhouette edge) ----
  float edge    = 1.0 - max(dot(N, V), 0.0);
  float outline = smoothstep(1.0 - uOutlineWidth, 1.0, edge);
  color = mix(color, uOutlineColor, outline);

  // ---- Bayer dither dissolve ----
  vec2 screenCoord = gl_FragCoord.xy;
  float threshold  = bayerDither(screenCoord);
  if (uDitherFade > threshold) {
    discard;
  }

  gl_FragColor = vec4(color, 1.0);
}
