// Shader imports - Vite will handle these as modules
import oceanVertexShader from './shaders/ocean-vertex.glsl'
import oceanFragmentShader from './shaders/ocean-fragment.glsl'
import noiseVertexShader from './shaders/noise-vertex.glsl'
import noiseFragmentShader from './shaders/noise-fragment.glsl'
import vertexShader from './shaders/vertex.glsl'
import fragmentShader from './shaders/fragment.glsl'
import hologramVertexShader from './shaders/hologram-vertex.glsl'
import hologramFragmentShader from './shaders/hologram-fragment.glsl'
import spiralVertexShader from './shaders/spiral-vertex.glsl'
import spiralFragmentShader from './shaders/spiral-fragment.glsl'
import pulseVertexShader from './shaders/pulse-vertex.glsl'
import pulseFragmentShader from './shaders/pulse-fragment.glsl'
import crystalVertexShader from './shaders/crystal-vertex.glsl'
import crystalFragmentShader from './shaders/crystal-fragment.glsl'
import titlescreenVertexShader from './shaders/titlescreen-vertex.glsl'
import titlescreenFragmentShader from './shaders/titlescreen-fragment.glsl'

// Common lighting chunks
import lightingVertexChunk from './shaders/common/lighting-vertex.glsl'
import lightingFragmentChunk from './shaders/common/lighting-fragment.glsl'

// Shaders that use common lighting (prepend the chunks)
import defaultCharacterVertexShaderRaw from './shaders/default-character-vertex.glsl'
import defaultCharacterFragmentShaderRaw from './shaders/default-character-fragment.glsl'
import landVertexShaderRaw from './shaders/land-vertex.glsl'
import landFragmentShaderRaw from './shaders/land-fragment.glsl'

// Concatenate common lighting code with shaders that use it
const defaultCharacterVertexShader = defaultCharacterVertexShaderRaw.replace(
  '#include ./common/lighting-vertex.glsl',
  lightingVertexChunk
)
const defaultCharacterFragmentShader = defaultCharacterFragmentShaderRaw.replace(
  '#include ./common/lighting-fragment.glsl',
  lightingFragmentChunk
)
const landVertexShader = landVertexShaderRaw.replace(
  '#include ./common/lighting-vertex.glsl',
  lightingVertexChunk
)
const landFragmentShader = landFragmentShaderRaw.replace(
  '#include ./common/lighting-fragment.glsl',
  lightingFragmentChunk
)

// Shader registry for easy access
export const SHADERS = {
  'src/shaders/ocean-vertex.glsl': oceanVertexShader,
  'src/shaders/ocean-fragment.glsl': oceanFragmentShader,
  'src/shaders/land-vertex.glsl': landVertexShader,
  'src/shaders/land-fragment.glsl': landFragmentShader,
  'src/shaders/noise-vertex.glsl': noiseVertexShader,
  'src/shaders/noise-fragment.glsl': noiseFragmentShader,
  'src/shaders/vertex.glsl': vertexShader,
  'src/shaders/fragment.glsl': fragmentShader,
  'src/shaders/hologram-vertex.glsl': hologramVertexShader,
  'src/shaders/hologram-fragment.glsl': hologramFragmentShader,
  'src/shaders/spiral-vertex.glsl': spiralVertexShader,
  'src/shaders/spiral-fragment.glsl': spiralFragmentShader,
  'src/shaders/pulse-vertex.glsl': pulseVertexShader,
  'src/shaders/pulse-fragment.glsl': pulseFragmentShader,
  'src/shaders/crystal-vertex.glsl': crystalVertexShader,
  'src/shaders/crystal-fragment.glsl': crystalFragmentShader,
  'src/shaders/titlescreen-vertex.glsl': titlescreenVertexShader,
  'src/shaders/titlescreen-fragment.glsl': titlescreenFragmentShader,
  'src/shaders/default-character-vertex.glsl': defaultCharacterVertexShader,
  'src/shaders/default-character-fragment.glsl': defaultCharacterFragmentShader,
} as const

export type ShaderPath = keyof typeof SHADERS
