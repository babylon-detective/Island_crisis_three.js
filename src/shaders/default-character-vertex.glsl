// ============================================================================
// Character Vertex Shader — lightweight cel-shaded characters
// Standalone: does NOT depend on the common lighting system.
// ============================================================================

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec2 vUv;

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);

  vec4 worldPos  = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;

  vec4 mvPos     = modelViewMatrix * vec4(position, 1.0);
  vViewPosition  = -mvPos.xyz;          // camera-space position (toward camera)

  gl_Position    = projectionMatrix * mvPos;
}
