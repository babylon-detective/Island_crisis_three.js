// ============================================================================
// Silhouette Vertex Shader — ultra-cheap distant object rendering
// Supports skinning for distant NPCs.
// Passes only what the fragment shader needs: normal + view direction + UV.
// ============================================================================

#ifdef USE_SKINNING
  uniform mat4 bindMatrix;
  uniform mat4 bindMatrixInverse;
  uniform highp sampler2D boneTexture;

  mat4 getBoneMatrix( const in float i ) {
    int size = textureSize( boneTexture, 0 ).x;
    int j = int( i ) * 4;
    int x = j % size;
    int y = j / size;
    vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
    vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
    vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
    vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
    return mat4( v1, v2, v3, v4 );
  }
#endif

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec4 vScreenPos;

void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;

  #ifdef USE_SKINNING
    mat4 boneMatX = getBoneMatrix( skinIndex.x );
    mat4 boneMatY = getBoneMatrix( skinIndex.y );
    mat4 boneMatZ = getBoneMatrix( skinIndex.z );
    mat4 boneMatW = getBoneMatrix( skinIndex.w );

    vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
    vec4 skinned  = vec4( 0.0 );
    skinned += boneMatX * skinVertex * skinWeight.x;
    skinned += boneMatY * skinVertex * skinWeight.y;
    skinned += boneMatZ * skinVertex * skinWeight.z;
    skinned += boneMatW * skinVertex * skinWeight.w;
    transformed = ( bindMatrixInverse * skinned ).xyz;

    mat4 skinMatrix = mat4( 0.0 );
    skinMatrix += skinWeight.x * boneMatX;
    skinMatrix += skinWeight.y * boneMatY;
    skinMatrix += skinWeight.z * boneMatZ;
    skinMatrix += skinWeight.w * boneMatW;
    skinMatrix  = bindMatrixInverse * skinMatrix * bindMatrix;
    objectNormal = ( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
  #endif

  vNormal = normalize( normalMatrix * objectNormal );

  vec4 mvPos = modelViewMatrix * vec4( transformed, 1.0 );
  vViewDir   = normalize( -mvPos.xyz );

  gl_Position = projectionMatrix * mvPos;
  vScreenPos  = gl_Position;
}
