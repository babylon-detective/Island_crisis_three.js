import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { ObjectManager } from './systems/ObjectManager'
import { ConfigManager } from './systems/ConfigManager'
import { ObjectLoader } from './systems/ObjectLoader'
import { AnimationSystem } from './systems/AnimationSystem'
import { ConsoleCommands } from './systems/ConsoleCommands'
import { CollisionSystem } from './systems/CollisionSystem'
import { CameraManager } from './systems/CameraManager'
import { PlayerController } from './systems/PlayerController'
import { ParameterManager } from './systems/ParameterManager'
import { ParameterGUI } from './systems/ParameterGUI'
import { ParameterIntegration } from './systems/ParameterIntegration'
import { logger, LogModule } from './systems/Logger'
import { performanceMonitor } from './systems/PerformanceMonitor'
import { DebugGUIManager } from './systems/DebugGUIManager'
import { HUDSystem, HUDData } from './systems/HUDSystem'
import { InputSystem, GamepadInputHandler } from './systems/InputSystem'
import { RetroPostProcessingSystem } from './systems/RetroPostProcessingSystem'
import { PauseManager } from './systems/PauseManager'
import { PauseOverlay } from './systems/PauseOverlay'
import { CharacterAnimationSystem, AnimationClipRegistry, buildQuaterniusToRigifyRemap } from './systems/CharacterAnimationSystem'
import { AnimationBrowser } from './systems/AnimationBrowser'
import { AnimationStateMachine, createPlayerStateMachineConfig, AnimStateParams } from './systems/AnimationStateMachine'
import { SHADERS, ShaderPath } from './shaderImports'

// TSL (Three Shader Language) - works with both WebGL and WebGPU!
// import { 
//   sin, 
//   cos, 
//   mul, 
//   add, 
//   mix, 
//   vec3, 
//   vec4, 
//   positionGeometry, 
//   uniform,
//   time
// } from 'three/tsl'

// ============================================================================
// SHADER LOADING UTILITIES
// ============================================================================

interface ShaderConfig {
  vertexPath: string
  fragmentPath: string
}

class ShaderLoader {
  private static cache: Map<string, string> = new Map()

  public static async loadShader(path: string): Promise<string> {
    if (this.cache.has(path)) {
      return this.cache.get(path)!
    }

    try {
      // Use imported shaders instead of fetch for production compatibility
      if (path in SHADERS) {
        const content = SHADERS[path as ShaderPath]
        this.cache.set(path, content)
        return content
      }
      
      // Fallback to fetch for development/custom shaders
      const response = await fetch(path)
      if (!response.ok) {
        throw new Error(`Failed to load shader: ${path}`)
      }
      const content = await response.text()
      this.cache.set(path, content)
      return content
    } catch (error) {
      logger.error(LogModule.SYSTEM, `Error loading shader ${path}:`, error)
      throw error
    }
  }

  public static async loadShaderPair(config: ShaderConfig): Promise<{ vertex: string; fragment: string }> {
    const [vertex, fragment] = await Promise.all([
      this.loadShader(config.vertexPath),
      this.loadShader(config.fragmentPath)
    ])
    return { vertex, fragment }
  }
}

// ============================================================================
// OCEAN LOD SYSTEM
// ============================================================================

interface OceanLODLevel {
  geometry: THREE.PlaneGeometry
  material: THREE.ShaderMaterial | THREE.MeshStandardMaterial
  mesh: THREE.Mesh
  shadowMesh: THREE.Mesh
  distance: number
  size: number
  segments: number
}

interface LandPiece {
  geometry: THREE.BufferGeometry
  material: THREE.ShaderMaterial | THREE.MeshStandardMaterial
  mesh: THREE.Mesh
  shadowMesh: THREE.Mesh
  id: string
  type: 'plane' | 'box' | 'sphere' | 'cylinder' | 'custom'
  scale: number
}

class OceanLODSystem {
  private lodLevels: OceanLODLevel[] = []
  private camera: THREE.Camera
  private scene: THREE.Scene
  private oceanUniforms: { [key: string]: { value: any } }

  constructor(camera: THREE.Camera, scene: THREE.Scene) {
    this.camera = camera
    this.scene = scene
    this.oceanUniforms = {
      uTime: { value: 0 },
      uAmplitude: { value: 0.5 },
      uWindDirection: { value: new THREE.Vector2(1, 0.5) },
      uWindStrength: { value: 1.0 },
      uWaveLength: { value: 2.0 },
      uWaveSpeed: { value: 1.0 },
      uWaterColor: { value: new THREE.Color(0x006994) },
      uDeepWaterColor: { value: new THREE.Color(0x003366) },
      uFoamColor: { value: new THREE.Color(0xffffff) },
      uTransparency: { value: 0.8 },
      uReflectionStrength: { value: 0.6 },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.2) },
      uSunColor: { value: new THREE.Color(0xffffff) },
      uSunIntensity: { value: 1.0 }
    }
  }

  public async createLODLevels(oceanShaders: { vertex: string; fragment: string }): Promise<void> {
    // Simplified LOD system with only 3 levels for smoother transitions
    const lodConfigs = [
      { distance: 0, size: 300, segments: 128 },    // Close - high detail
      { distance: 200, size: 800, segments: 64 },   // Medium - medium detail  
      { distance: 800, size: 2000, segments: 32 }   // Far - low detail (large coverage)
    ]

    for (let i = 0; i < lodConfigs.length; i++) {
      const config = lodConfigs[i]
      
      // Create geometry with appropriate detail level  
      const geometry = new THREE.PlaneGeometry(config.size, config.size, config.segments, config.segments)
      geometry.rotateX(-Math.PI / 2) // Rotate to make it horizontal (X-Z plane)

      // Add random attributes for wave variation
      const positionAttribute = geometry.getAttribute('position')
      const randomValues = new Float32Array(positionAttribute.count)
      for (let j = 0; j < randomValues.length; j++) {
        randomValues[j] = Math.random()
      }
      geometry.setAttribute('aRandom', new THREE.BufferAttribute(randomValues, 1))

      // Create material with shared uniforms
      let material: THREE.ShaderMaterial | THREE.MeshStandardMaterial
      try {
        const shaderMaterial = new THREE.ShaderMaterial({
          vertexShader: oceanShaders.vertex,
          fragmentShader: oceanShaders.fragment,
          uniforms: this.oceanUniforms,
          transparent: true,
          side: THREE.DoubleSide,
          blending: THREE.NormalBlending,
          depthWrite: true, // Enable depth writing for proper sorting
          depthTest: true,
          alphaTest: 0.1 // Discard fully transparent pixels
        })
        material = shaderMaterial
        console.log(`✅ Ocean LOD ${i} shader compiled successfully`)
      } catch (error) {
        console.warn(`⚠️ Ocean LOD ${i} shader compilation failed, using fallback:`, error)
        // Fallback to standard material for mobile
        material = new THREE.MeshStandardMaterial({
          color: 0x006994,
          transparent: true,
          opacity: 0.8,
          roughness: 0.1,
          metalness: 0.8,
          side: THREE.DoubleSide
        })
      }

      // Create mesh
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(0, -2, 0) // Fixed position at origin
      mesh.userData = { 
        id: `ocean-lod-${i}`, 
        type: 'ocean', 
        lodLevel: i,
        distance: config.distance,
        size: config.size 
      }

      // Ocean receives shadows but cannot cast them with custom shaders
      mesh.receiveShadow = true  // Water receives shadows from land
      mesh.castShadow = false    // Custom shaders don't support shadow casting
      
      // Create invisible shadow-casting plane for this LOD level
      const shadowGeometry = new THREE.PlaneGeometry(config.size, config.size, 32, 32)
      shadowGeometry.rotateX(-Math.PI / 2)
      
      const shadowMaterial = new THREE.MeshStandardMaterial({
        transparent: true,
        opacity: 0, // Invisible
        color: 0x006994,
        depthWrite: false // Don't write to depth buffer to avoid interfering with ocean
      })
      
      const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial)
      shadowMesh.position.set(0, -1.9, 0) // Slightly higher than ocean to avoid Z-fighting
      shadowMesh.castShadow = true
      shadowMesh.receiveShadow = false
      shadowMesh.userData = { 
        id: `ocean-shadow-${i}`, 
        type: 'ocean-shadow', 
        lodLevel: i,
        visible: false // Mark as helper mesh
      }
      
      this.scene.add(shadowMesh)

      // Add to scene
      this.scene.add(mesh)

      // Store LOD level
      this.lodLevels.push({
        geometry,
        material,
        mesh,
        shadowMesh,
        distance: config.distance,
        size: config.size,
        segments: config.segments
      })
    }

    console.log(`🌊 Simplified Ocean LOD System created with ${this.lodLevels.length} levels`)
    console.log('🌊 Ocean shadow settings: receiveShadow=true, invisible shadow casters added')
  }

  public update(time: number): void {
    // Update time uniform for all levels
    this.oceanUniforms.uTime.value = time * 0.001

    const cameraPosition = this.camera.position
    
    // Calculate camera distance from origin for zoom-based decisions
    const cameraDistance = Math.sqrt(
      cameraPosition.x * cameraPosition.x + 
      cameraPosition.z * cameraPosition.z
    )
    
    // Determine which single LOD level to show based on camera distance
    let activeLODIndex = 0
    
    if (cameraDistance < 150) {
      activeLODIndex = 0 // Close: high detail
    } else if (cameraDistance < 600) {
      activeLODIndex = 1 // Medium: medium detail
    } else {
      activeLODIndex = 2 // Far: low detail
    }
    
    for (let i = 0; i < this.lodLevels.length; i++) {
      const level = this.lodLevels[i]
      
      // Only the active LOD level is visible - eliminates jumping between levels
      const isActive = (i === activeLODIndex)
      level.mesh.visible = isActive
      level.shadowMesh.visible = isActive
      
      if (isActive) {
        // Keep ocean centered at global origin - DO NOT follow camera
        level.mesh.position.set(0, -2, 0)
        level.shadowMesh.position.set(0, -1.9, 0)
        
        // For close-up detail, allow slight following to prevent edge visibility
        if (i === 0 && cameraDistance < 100) {
          // Only follow camera when very close to prevent seeing edges
          const followX = Math.max(-50, Math.min(50, cameraPosition.x * 0.3))
          const followZ = Math.max(-50, Math.min(50, cameraPosition.z * 0.3))
          level.mesh.position.x = followX
          level.mesh.position.z = followZ
          level.shadowMesh.position.set(followX, -1.9, followZ)
        }
      }
    }
  }

  public setWaveAmplitude(amplitude: number): void {
    this.oceanUniforms.uAmplitude.value = amplitude
  }

  public setWindDirection(x: number, z: number): void {
    this.oceanUniforms.uWindDirection.value.set(x, z)
  }

  public setWindStrength(strength: number): void {
    this.oceanUniforms.uWindStrength.value = strength
  }

  public setWaterColors(shallow: THREE.Color, deep: THREE.Color): void {
    this.oceanUniforms.uWaterColor.value.copy(shallow)
    this.oceanUniforms.uDeepWaterColor.value.copy(deep)
  }

  public setSunDirection(direction: THREE.Vector3): void {
    this.oceanUniforms.uSunDirection.value.copy(direction)
  }

  public setSunColor(color: THREE.Color): void {
    this.oceanUniforms.uSunColor.value.copy(color)
  }

  public setSunIntensity(intensity: number): void {
    this.oceanUniforms.uSunIntensity.value = intensity
  }

  public getLODLevels(): OceanLODLevel[] {
    return this.lodLevels
  }

  // Legacy method removed - position locking now handled by ObjectManager

  public resetOceanPositions(): void {
    // Reset all ocean planes to origin
    for (let i = 0; i < this.lodLevels.length; i++) {
      const level = this.lodLevels[i]
      level.mesh.position.set(0, -2, 0) // Reset to origin
      level.shadowMesh.position.set(0, -1.9, 0) // Reset shadow mesh too
    }
  }

  public setOceanShadowCasting(enabled: boolean): void {
    for (let i = 0; i < this.lodLevels.length; i++) {
      this.lodLevels[i].shadowMesh.castShadow = enabled
    }
    console.log(`🌊 Ocean shadow casting: ${enabled ? 'enabled' : 'disabled'}`)
  }

  public setOceanShadowReceiving(enabled: boolean): void {
    for (let i = 0; i < this.lodLevels.length; i++) {
      this.lodLevels[i].mesh.receiveShadow = enabled
    }
    console.log(`🌊 Ocean shadow receiving: ${enabled ? 'enabled' : 'disabled'}`)
  }
}

class LandSystem {
  private landPieces: LandPiece[] = []
  private scene: THREE.Scene
  private landUniforms: { [key: string]: { value: any } }
  private collisionSystem?: CollisionSystem

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.landUniforms = {
      // Three.js light/shadow uniforms — needed for USE_SHADOWMAP in the land shader
      ...THREE.UniformsLib.lights,
      uTime: { value: 0 },
      uElevation: { value: 8.0 }, // Increased for more dramatic peaks
      uRoughness: { value: 1.2 }, // More terrain variation
      uScale: { value: 0.8 }, // Tighter terrain features
      uLandColor: { value: new THREE.Color(0x4a7c59) }, // Forest green
      uRockColor: { value: new THREE.Color(0x8b7355) }, // Rock brown
      uSandColor: { value: new THREE.Color(0xc2b280) }, // Sandy beige
      uMoisture: { value: 0.3 }, // Drier for more rocky appearance
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.2) },
      uSunColor: { value: new THREE.Color(1, 1, 0.9) },
      uSunIntensity: { value: 1.0 },
      uIslandRadius: { value: 35.0 }, // Smaller for steeper dropoff
      uCoastSmoothness: { value: 8.0 }, // Sharper coastline
      uSeaLevel: { value: -4.0 }, // Deeper edges
      // Spotlight uniforms, 
      uSpotlightPosition: { value: new THREE.Vector3(0, 30, 0) },
      uSpotlightDirection: { value: new THREE.Vector3(0, -1, 0) },
      uSpotlightColor: { value: new THREE.Color(1, 1, 1) },
      uSpotlightIntensity: { value: 0.0 },
      uSpotlightAngle: { value: Math.PI / 8 }, // 22.5 degrees - tight focus
      uSpotlightPenumbra: { value: 0.3 }, // Sharper edges
      uSpotlightDistance: { value: 80 }
    }
  }

  public async createLandPiece(
    type: 'plane' | 'box' | 'sphere' | 'cylinder' | 'custom',
    landShaders: { vertex: string; fragment: string },
    options: {
      id?: string
      position?: THREE.Vector3
      rotation?: THREE.Euler
      scale?: THREE.Vector3
      size?: number
      segments?: number
      customGeometry?: THREE.BufferGeometry
    } = {}
  ): Promise<LandPiece> {
    const {
      id = `land-${type}-${Date.now()}`,
      position = new THREE.Vector3(0, 0, 0),
      rotation = new THREE.Euler(0, 0, 0),
      scale = new THREE.Vector3(1, 1, 1),
      size = 50,
      segments = 64,
      customGeometry
    } = options

    // Create geometry based on type
    let geometry: THREE.BufferGeometry

    switch (type) {
      case 'plane':
        geometry = new THREE.PlaneGeometry(size, size, segments, segments)
        geometry.rotateX(-Math.PI / 2) // Make horizontal
        break
      case 'box':
        geometry = new THREE.BoxGeometry(size, size * 0.5, size, segments, segments, segments)
        break
      case 'sphere':
        geometry = new THREE.SphereGeometry(size * 0.5, segments, segments)
        break
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(size * 0.5, size * 0.5, size * 0.3, segments, segments)
        break
      case 'custom':
        if (!customGeometry) {
          throw new Error('Custom geometry required for custom type')
        }
        geometry = customGeometry
        break
      default:
        throw new Error(`Unknown land type: ${type}`)
    }

    // Create material with land shader
    let material: THREE.ShaderMaterial | THREE.MeshStandardMaterial
    try {
      const shaderMaterial = new THREE.ShaderMaterial({
        vertexShader: landShaders.vertex,
        fragmentShader: landShaders.fragment,
        uniforms: this.landUniforms,
        side: THREE.DoubleSide,
        wireframe: false,
        lights: true  // Enables USE_SHADOWMAP defines so land receives shadows
      })
      
      // Test compilation by forcing a render check
      material = shaderMaterial
      console.log('✅ Land shader compiled successfully')
    } catch (error) {
      console.warn('⚠️ Land shader compilation failed, using fallback material:', error)
      // Fallback to standard material for mobile compatibility
      material = new THREE.MeshStandardMaterial({
        color: 0x3a6b35,
        roughness: 0.8,
        metalness: 0.2,
        side: THREE.DoubleSide
      })
    }

    // Create mesh
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position)
    mesh.rotation.copy(rotation)
    mesh.scale.copy(scale)
    mesh.userData = {
      id,
      type: 'land',
      landType: type,
      scale: scale.x
    }

    // Land can receive shadows but cannot cast them with custom shaders
    mesh.castShadow = false    // Custom shaders don't support shadow casting
    mesh.receiveShadow = true  // Land receives shadows from other objects
    
    // Create invisible shadow-casting geometry for proper shadows
    const shadowGeometry = geometry.clone()
    const shadowMaterial = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0, // Invisible
      color: 0x8B4513,
      depthWrite: false // Don't write to depth buffer to avoid interfering with ocean
    })
    
    const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial)
    shadowMesh.position.copy(position)
    shadowMesh.rotation.copy(rotation)
    shadowMesh.scale.copy(scale)
    shadowMesh.castShadow = true
    shadowMesh.receiveShadow = false
    shadowMesh.userData = { 
      id: `${id}-shadow`, 
      type: 'land-shadow',
      visible: false // Mark as helper mesh
    }
    
    this.scene.add(shadowMesh)

    // Add to scene
    this.scene.add(mesh)

    // Create land piece object
    const landPiece: LandPiece = {
      geometry,
      material,
      mesh,
      shadowMesh,
      id,
      type,
      scale: scale.x
    }

    // Store land piece
    this.landPieces.push(landPiece)

    // Note: Land meshes are now registered centrally in createContent() method
    // This ensures proper initialization order and avoids duplicate registration

    console.log(`🏔️ Land piece created: ${type} (${id}) - receiveShadow=true, invisible shadow caster added`)
    return landPiece
  }

  public update(time: number): void {
    // Update time uniform for all land pieces
    this.landUniforms.uTime.value = time * 0.001
  }

  /**
   * Set collision system reference for automatic updates
   */
  public setCollisionSystem(collisionSystem: CollisionSystem): void {
    this.collisionSystem = collisionSystem
  }

  public setElevation(elevation: number): void {
    this.landUniforms.uElevation.value = elevation
    // TODO: Update collision geometry when parameters change
    console.log(`🏔️ Elevation set to ${elevation} - use refreshCollisionMeshes() to update collision`)
  }

  public setRoughness(roughness: number): void {
    this.landUniforms.uRoughness.value = roughness
    // TODO: Update collision geometry when parameters change  
    console.log(`🏔️ Roughness set to ${roughness} - use refreshCollisionMeshes() to update collision`)
  }

  public setScale(scale: number): void {
    this.landUniforms.uScale.value = scale
    // TODO: Update collision geometry when parameters change
    console.log(`🏔️ Scale set to ${scale} - use refreshCollisionMeshes() to update collision`)
  }

  public setLandColor(color: THREE.Color): void {
    this.landUniforms.uLandColor.value.copy(color)
  }

  public setRockColor(color: THREE.Color): void {
    this.landUniforms.uRockColor.value.copy(color)
  }

  public setSandColor(color: THREE.Color): void {
    this.landUniforms.uSandColor.value.copy(color)
  }

  public setMoisture(moisture: number): void {
    this.landUniforms.uMoisture.value = moisture
  }

  public setSunDirection(direction: THREE.Vector3): void {
    this.landUniforms.uSunDirection.value.copy(direction)
  }

  public setSunColor(color: THREE.Color): void {
    this.landUniforms.uSunColor.value.copy(color)
  }

  public setSunIntensity(intensity: number): void {
    this.landUniforms.uSunIntensity.value = intensity
  }

  public setSpotlightPosition(position: THREE.Vector3): void {
    this.landUniforms.uSpotlightPosition.value.copy(position)
  }

  public setSpotlightDirection(direction: THREE.Vector3): void {
    this.landUniforms.uSpotlightDirection.value.copy(direction)
  }

  public setSpotlightColor(color: THREE.Color): void {
    this.landUniforms.uSpotlightColor.value.copy(color)
  }

  public setSpotlightIntensity(intensity: number): void {
    this.landUniforms.uSpotlightIntensity.value = intensity
  }

  public setSpotlightAngle(angle: number): void {
    this.landUniforms.uSpotlightAngle.value = angle
  }

  public setSpotlightPenumbra(penumbra: number): void {
    this.landUniforms.uSpotlightPenumbra.value = penumbra
  }

  public setSpotlightDistance(distance: number): void {
    this.landUniforms.uSpotlightDistance.value = distance
  }

  public setIslandRadius(radius: number): void {
    this.landUniforms.uIslandRadius.value = radius
  }

  public setCoastSmoothness(smoothness: number): void {
    this.landUniforms.uCoastSmoothness.value = smoothness
  }

  public setSeaLevel(level: number): void {
    this.landUniforms.uSeaLevel.value = level
  }

  public getLandUniforms(): { [key: string]: { value: any } } {
    return this.landUniforms
  }

  public removeLandPiece(id: string): boolean {
    const index = this.landPieces.findIndex(piece => piece.id === id)
    if (index !== -1) {
      const piece = this.landPieces[index]
      this.scene.remove(piece.mesh)
      this.scene.remove(piece.shadowMesh)
      piece.geometry.dispose()
      piece.material.dispose()
      if (Array.isArray(piece.shadowMesh.material)) {
        piece.shadowMesh.material.forEach(mat => mat.dispose())
      } else {
        piece.shadowMesh.material.dispose()
      }
      piece.shadowMesh.geometry.dispose()
      this.landPieces.splice(index, 1)
      console.log(`🏔️ Land piece removed: ${id}`)
      return true
    }
    return false
  }

  public getLandPieces(): LandPiece[] {
    return this.landPieces
  }

  public getLandPiece(id: string): LandPiece | undefined {
    return this.landPieces.find(piece => piece.id === id)
  }

  public clearAllLand(): void {
    this.landPieces.forEach(piece => {
      this.scene.remove(piece.mesh)
      this.scene.remove(piece.shadowMesh)
      piece.geometry.dispose()
      piece.material.dispose()
      if (Array.isArray(piece.shadowMesh.material)) {
        piece.shadowMesh.material.forEach(mat => mat.dispose())
      } else {
        piece.shadowMesh.material.dispose()
      }
      piece.shadowMesh.geometry.dispose()
    })
    this.landPieces = []
    console.log('🏔️ All land pieces cleared')
    
    // Clear collision system land meshes when all land is cleared
    if (this.collisionSystem) {
      this.collisionSystem.registerLandMeshes([])
    }
  }

  public setLandShadowCasting(enabled: boolean): void {
    this.landPieces.forEach(piece => {
      piece.shadowMesh.castShadow = enabled
    })
    console.log(`🏔️ Land shadow casting: ${enabled ? 'enabled' : 'disabled'}`)
  }

  public setLandShadowReceiving(enabled: boolean): void {
    this.landPieces.forEach(piece => {
      piece.mesh.receiveShadow = enabled
    })
    console.log(`🏔️ Land shadow receiving: ${enabled ? 'enabled' : 'disabled'}`)
  }

  // ============================================================================
  // LAND MESH ACCESS (FOR PRIMITIVE COLLISION)
  // ============================================================================

  /**
   * Get all land meshes (for primitive collision registration)
   * Note: Using imported model geometry directly - no dynamic collision generation
   */
  public getLandMeshes(): THREE.Mesh[] {
    return this.landPieces.map(piece => piece.mesh)
  }
}

// ============================================================================
// TYPESCRIPT INTERFACES & TYPES
// ============================================================================

interface CameraConfig {
  fov: number
  aspect: number
  near: number
  far: number
  position: THREE.Vector3
}

interface RendererConfig {
  antialias: boolean
  shadows: boolean
}

interface SceneConfig {
  backgroundColor: THREE.Color
  fog?: THREE.Fog
}

interface SkyConfig {
  turbidity: number
  rayleigh: number
  mieCoefficient: number
  mieDirectionalG: number
  elevation: number
  azimuth: number
  exposure: number
}

enum DeviceType {
  MOBILE = 'mobile',
  TABLET = 'tablet',
  DESKTOP = 'desktop'
}

type InputMethod = 'touch' | 'mouse' | 'keyboard'
type QualityPreset = 'ultra' | 'high' | 'medium' | 'low' | 'potato'

interface AnimationConfig {
  duration: number
  easing: (t: number) => number
  loop: boolean
  yoyo: boolean
  delay: number
  onStart?: () => void
  onUpdate?: (progress: number) => void
  onComplete?: () => void
}

interface DebugState {
  active: boolean
  stats: Stats | null
  gui: GUI | null
  gameplayGui: GUI | null
  lightingGui: GUI | null
  debugGUIManager: DebugGUIManager | null
  helpers: THREE.Object3D[]
}

// ============================================================================
// EASING FUNCTIONS
// ============================================================================

const Easing = {
  linear: (t: number): number => t,
  easeInQuad: (t: number): number => t * t,
  easeOutQuad: (t: number): number => t * (2 - t),
  easeInOutQuad: (t: number): number => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: (t: number): number => t * t * t,
  easeOutCubic: (t: number): number => (--t) * t * t + 1,
  easeInOutCubic: (t: number): number => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeOutElastic: (t: number): number => {
    if (t === 0) return 0
    if (t === 1) return 1
    const p = 0.3
    const s = p / 4
    return Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p) + 1
  },
  easeInOutSine: (t: number): number => {
    if (t < 0.5) {
      return 0.5 * Math.sin(t * Math.PI)
    } else {
      return 0.5 * Math.sin((t - 1) * Math.PI) + 1
    }
  }
} as const

// ============================================================================
// PLAYER DEFAULTS — single source of truth for player speed/physics
// Change values here; they propagate to PlayerController, ParameterManager, & GUI.
// ============================================================================
const PLAYER_DEFAULTS = {
  height: 1.8,
  radius: 0.5,
  mass: 70,
  walkSpeed: 1.4,   // m/s — matches UAL walk animation
  runSpeed: 5.0,    // m/s — matches UAL run animation
  jumpForce: 15.0,
  gravity: 8.0,
  groundCheckDistance: 0.1,
  friction: 0.8,
  airResistance: 0.95,
} as const

// ============================================================================
// ANIMATION SYSTEM
// Animation classes moved to separate AnimationSystem module
// ============================================================================

// ============================================================================
// MAIN APPLICATION CLASS
// ============================================================================

class IntegratedThreeJSApp {
  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private controls!: OrbitControls
  
  // Animation and systems
  private animationSystem: AnimationSystem
  private oceanLODSystem: OceanLODSystem | null = null
  private landSystem: LandSystem | null = null
  private deviceType: DeviceType
  private inputMethods: InputMethod[]
  
  // Unified management systems
  private objectManager!: ObjectManager
  private configManager: ConfigManager
  private consoleCommands!: ConsoleCommands
  
  // New modular systems
  private collisionSystem!: CollisionSystem
  private cameraManager!: CameraManager
  private playerController!: PlayerController
  private parameterManager!: ParameterManager
  private parameterGUI!: ParameterGUI
  private parameterIntegration!: ParameterIntegration
  private hudSystem!: HUDSystem
  private inputSystem!: InputSystem
  private gamepadHandler!: GamepadInputHandler
  private retroPostProcessing!: RetroPostProcessingSystem
  
  // Character animation system (skeletal / GLB clip-based)
  private characterAnimationSystem: CharacterAnimationSystem = new CharacterAnimationSystem()
  private playerAnimStateMachine: AnimationStateMachine | null = null
  private animationBrowser: AnimationBrowser | null = null

  // Pause system
  private pauseManager: PauseManager = new PauseManager()
  private pauseOverlay: PauseOverlay = new PauseOverlay()
  private lastPauseToggleTime: number = 0
  private pauseToggleCooldownMs: number = 250
  
  // Lighting references for dynamic control
  private ambientLight!: THREE.AmbientLight
  private keyLight!: THREE.DirectionalLight
  private fillLight!: THREE.DirectionalLight
  
  // Initialization flag
  private isInitialized: boolean = false
  
  // Timing for delta time calculation
  private lastTime: number = 0
  private frameCount: number = 0
  
  // All objects now managed via ObjectManager - no legacy references needed
  
  // Sky system
  private sky: Sky | null = null
  private sun: THREE.Vector3 = new THREE.Vector3()
  private skyConfig: SkyConfig = {
    turbidity: 10,
    rayleigh: 3,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.7,
    elevation: 2,
    azimuth: 180,
    exposure: 0.5
  }
  
  // Debug system
  private debugState: DebugState = {
    active: false,
    stats: null,
    gui: null,
    gameplayGui: null,
    lightingGui: null,
    debugGUIManager: null,
    helpers: []
  }

  constructor(
    private container: HTMLElement,
    private cameraConfig: CameraConfig,
    private rendererConfig: RendererConfig,
    private sceneConfig: SceneConfig
  ) {
    this.deviceType = this.detectDeviceType()
    this.inputMethods = this.detectInputMethods()
    this.animationSystem = new AnimationSystem()
    
    // Initialize management systems (scene will be initialized in init())
    this.configManager = new ConfigManager()
    
    // NOTE: Do NOT call this.init() here.
    // The constructor runs at module-import time (singleton), but init() is
    // called explicitly by initializeGame() after the title screen is ready.
    // Calling it here would race with the initializeGame() call and double-
    // initialise everything (two renderers, two scenes, black screen).
  }

  public async init(onProgress?: (text: string) => void): Promise<void> {
    // Prevent double initialization
    if (this.isInitialized) {
      console.log('⚠️ Game already initialized, ensuring animation loop is running...')
      // Make sure animation is running
      if (!this.lastTime) {
        this.lastTime = performance.now()
        this.animate()
      }
      return
    }
    
    this.detectDeviceType()
    this.detectInputMethods()
    
    this.initScene()
    this.initCamera()
    this.initRenderer()
    this.initControls()
    
    // Initialize ObjectManager after scene is created
    this.objectManager = new ObjectManager(this.scene, this.configManager)
    
    // Initialize new modular systems
    this.collisionSystem = new CollisionSystem()
    this.cameraManager = new CameraManager(this.scene, this.renderer, this.container)
    this.parameterManager = new ParameterManager()
    this.parameterGUI = new ParameterGUI(this.parameterManager, {
      container: this.container,
      position: { top: '0px', right: '320px' },
      width: 300
    })
    // Initialize HUD system
    this.hudSystem = new HUDSystem()
    
    // Set up pause overlay hide callback
    this.pauseOverlay.onHide(() => {
      this.pauseManager.setPaused(false)
    })
    
    // Initialize Input system
    this.inputSystem = new InputSystem(this.renderer.domElement as HTMLCanvasElement)
    
    // Parameter integration will be initialized after all systems are created
    
    // Initialize player controller with collision system and camera manager
          this.playerController = new PlayerController(
        this.scene, 
        this.collisionSystem, 
        this.cameraManager,
        this.landSystem?.getLandUniforms(), // Pass land lighting uniforms
        { ...PLAYER_DEFAULTS }
      )
    
    // Initialize gamepad handler and connect to player controller
    this.gamepadHandler = this.inputSystem.createGamepadHandler((input) => {
      this.playerController.handleGamepadInput(input)
      
      // Handle camera mode toggle (right stick button / R3 or select button)
      if (input.cameraMode || input.select) {
        this.cycleCameraMode()
      }
      
      // Handle menu/pause button (start button)
      if (input.menu) {
        console.log('🎮 Menu/Pause button pressed (gamepad)')
        this.togglePause()
      }
    })
    this.inputSystem.addHandler(this.gamepadHandler)
    
    // Register camera with ObjectManager for persistence
    this.objectManager.registerCamera(this.camera, this.controls)
    
    // Auto-save camera state when controls change
    this.controls.addEventListener('change', () => {
      this.objectManager.saveCameraState()
    })
    
            // console.log('📷 Camera registered with ObjectManager for persistence')
    
    // Initialize ConsoleCommands with app reference
    this.consoleCommands = new ConsoleCommands({
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      objectManager: this.objectManager,
      animationSystem: this.animationSystem,
      configManager: this.configManager,
      collisionSystem: this.collisionSystem,
      retroPostProcessing: this.retroPostProcessing,
      cameraManager: this.cameraManager,
      playerController: this.playerController,
      oceanLODSystem: this.oceanLODSystem,
      landSystem: this.landSystem,
      deviceType: this.deviceType,
      inputMethods: this.inputMethods,
      parameterManager: this.parameterManager,
      parameterGUI: this.parameterGUI
    })
    
    // Register global console commands
    this.consoleCommands.registerGlobalCommands()
    
    // Set up locked position checker for animation system (using ObjectManager)
    this.animationSystem.setLockedPositionChecker((uuid: string) => this.objectManager.getLockedPositions().has(uuid))
    
    await this.createContent(onProgress)
    
    this.setupEventListeners()
    this.animate()
    
    this.animationSystem.start()

    // Character animation system — bones renamed in Blender to match UAL naming
    this.initCharacterAnimations()
    
    // Mark as initialized
    this.isInitialized = true
    console.log('✅ Game initialization complete')
    
    // Initialize debug system after all other systems are ready
    this.initDebugSystem()
    
    // Show initial help overlay
    this.showInitialHelp()
  }

  /**
   * Initialize the character animation system.
   * Registers the Quaternius Universal Animation Library set and, once the
   * player model is ready, binds an AnimationStateMachine to the player.
   */
  private async initCharacterAnimations(): Promise<void> {
    try {
      // Register the Quaternius UAL packed animation set (single GLB with 45 clips)
      const registry = AnimationClipRegistry.getInstance()
      registry.registerQuaterniusPackedSet('/models/animations/quaternius', 'UAL1_Standard.glb')

      // Wait briefly for the player model to finish loading, then register it
      const playerModel = this.playerController.getMesh()
      if (playerModel) {
        await this.setupPlayerAnimations(playerModel)
      } else {
        // Model not ready yet — retry after a short delay
        const retryInterval = setInterval(async () => {
          const mesh = this.playerController.getMesh()
          if (mesh) {
            clearInterval(retryInterval)
            await this.setupPlayerAnimations(mesh)
          }
        }, 500)
        // Give up after 10 seconds
        setTimeout(() => clearInterval(retryInterval), 10000)
      }
    } catch (error) {
      console.warn('⚠️ Character animation system init skipped (animations will load when GLB files are placed in public/models/animations/quaternius/):', error)
    }
  }

  /**
   * Bind the character animation system to a player model.
   */
  private async setupPlayerAnimations(playerModel: THREE.Object3D): Promise<void> {
    try {
      // Stop the pose-baking mixer that ObjectLoader created (if any) so it
      // doesn't compete with the CharacterAnimationSystem's new mixer.
      if (playerModel.userData._poseMixer) {
        const poseMixer = playerModel.userData._poseMixer as THREE.AnimationMixer
        poseMixer.stopAllAction()
        poseMixer.uncacheRoot(playerModel)
        delete playerModel.userData._poseMixer
      }

      await this.characterAnimationSystem.registerCharacter({
        id: 'player',
        model: playerModel,
        animationSetId: 'quaternius-universal',
        defaultCrossfadeDuration: 0.25,
        // boneRemap removed — character bones renamed in Blender to match UAL directly
      }, true)

      // Create the state machine — pass a getter that reads the FSM's own
      // internal params (updated each frame via setParams in the update loop)
      const config = createPlayerStateMachineConfig('player', () => {
        return this.playerAnimStateMachine!.getParams() as AnimStateParams
      })
      this.playerAnimStateMachine = new AnimationStateMachine(this.characterAnimationSystem)
      this.playerAnimStateMachine.configure(config)

      // Create animation browser (toggle with ` key)
      this.animationBrowser = new AnimationBrowser(
        this.characterAnimationSystem,
        'player',
        (browsing) => {
          // Disable state machine while browsing so it doesn't override manual clip selection
          if (this.playerAnimStateMachine) {
            this.playerAnimStateMachine.setEnabled(!browsing)
          }
        }
      )

      console.log('✅ Player character animation system ready (press ` to open animation browser)')
    } catch (error) {
      console.warn('⚠️ Player animation binding skipped (animation GLB files not found):', error)
    }
  }

  /**
   * Collect current player state into AnimStateParams for the state machine.
   */
  private getPlayerAnimParams(): AnimStateParams {
    const velocity = this.playerController.getVelocity()
    const speed = new THREE.Vector2(velocity.x, velocity.z).length()
    const isGrounded = this.playerController.isOnGround()
    const isMoving = this.playerController.isMoving()
    const isRunning = this.playerController.isRunning()

    return {
      speed,
      isGrounded,
      isJumping: velocity.y > 2.0 && !isGrounded,
      isFalling: velocity.y < -3.0 && !isGrounded,
      isRunning: isRunning && isMoving,
      isAttacking: false,
      isDead: false,
      isCrouching: false,
      movementX: velocity.x,
      movementZ: velocity.z,
    }
  }

  private detectDeviceType(): DeviceType {
    const width = window.innerWidth
    if (width < 768) return DeviceType.MOBILE
    if (width < 1024) return DeviceType.TABLET
    return DeviceType.DESKTOP
  }

  private getViewportSize(): { width: number; height: number } {
    const visualViewport = window.visualViewport
    if (visualViewport) {
      return {
        width: Math.round(visualViewport.width),
        height: Math.round(visualViewport.height)
      }
    }

    return {
      width: window.innerWidth,
      height: window.innerHeight
    }
  }

  private detectInputMethods(): InputMethod[] {
    const methods: InputMethod[] = []
    if ('ontouchstart' in window) methods.push('touch')
    if (window.matchMedia('(hover: hover)').matches) methods.push('mouse')
    methods.push('keyboard')
    return methods
  }

  private initScene(): void {
    this.scene = new THREE.Scene()
    this.scene.background = this.sceneConfig.backgroundColor
    
    if (this.sceneConfig.fog) {
      this.scene.fog = this.sceneConfig.fog
    }
  }

  private initCamera(): void {
    const { width, height } = this.getViewportSize()
    this.camera = new THREE.PerspectiveCamera(
      this.cameraConfig.fov,
      width / height,
      this.cameraConfig.near,
      this.cameraConfig.far
    )
    this.camera.position.copy(this.cameraConfig.position)
    this.adjustCameraForDevice()
  }

  private adjustCameraForDevice(): void {
    switch (this.deviceType) {
      case DeviceType.MOBILE:
        this.camera.fov = 85
        this.camera.position.z = 8
        break
      case DeviceType.TABLET:
        this.camera.fov = 80
        this.camera.position.z = 6
        break
      case DeviceType.DESKTOP:
        this.camera.fov = 75
        this.camera.position.z = 5
        break
    }
    this.camera.updateProjectionMatrix()
  }

  private initRenderer(): void {
    // Retro mode: disable antialiasing for pixelated look
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: false, // Disabled for retro pixelated look
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false, // Allow fallback on mobile
        alpha: false,
        stencil: false
      })
      
      console.log('✅ WebGL Renderer created successfully')
      console.log(`📱 Device type: ${this.deviceType}`)
      console.log(`🎮 WebGL Version: ${this.renderer.capabilities.isWebGL2 ? '2.0' : '1.0'}`)
      console.log(`📊 Max Texture Size: ${this.renderer.capabilities.maxTextureSize}`)
      
    } catch (error) {
      console.error('❌ Failed to create WebGL renderer:', error)
      throw new Error('WebGL not supported on this device')
    }
    
    const { width, height } = this.getViewportSize()
    this.renderer.setSize(width, height)
    // Lower pixel ratio for retro look (optional - can be adjusted)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0)) // Reduced from 2.0
    
    if (this.rendererConfig.shadows) {
      this.renderer.shadowMap.enabled = true
      // Use basic shadow map for retro look (harder edges)
      this.renderer.shadowMap.type = THREE.BasicShadowMap // Changed from PCFSoftShadowMap
    }
    
    this.container.appendChild(this.renderer.domElement)
    
    // Add WebGL context lost/restored handlers for mobile debugging
    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      console.error('❌ WebGL context lost!')
      console.log('This usually happens on mobile when the browser runs out of GPU memory')
    }, false)
    
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      console.log('✅ WebGL context restored')
    }, false)
    
    // Initialize retro post-processing system
    this.retroPostProcessing = new RetroPostProcessingSystem(
      this.renderer,
      this.scene,
      this.camera
    )
    
    // Apply flat shading to all materials for retro look
    this.applyFlatShadingToScene()
  }
  
  /**
   * Apply flat shading to all materials in the scene (for retro look)
   */
  private applyFlatShadingToScene(): void {
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const material = object.material
        
        if (material instanceof THREE.MeshStandardMaterial) {
          material.flatShading = true
          material.needsUpdate = true
        } else if (material instanceof THREE.MeshLambertMaterial) {
          material.flatShading = true
          material.needsUpdate = true
        } else if (material instanceof THREE.MeshPhongMaterial) {
          material.flatShading = true
          material.needsUpdate = true
        } else if (material instanceof THREE.MeshPhysicalMaterial) {
          // Convert to MeshStandardMaterial with flat shading
          const newMaterial = new THREE.MeshStandardMaterial({
            color: material.color,
            metalness: material.metalness,
            roughness: material.roughness,
            emissive: material.emissive,
            flatShading: true
          })
          object.material = newMaterial
        }
        // Note: MeshBasicMaterial doesn't support flatShading, skip it
      }
    })
  }

  private initControls(): void {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    
    // Adjust controls based on device - less sensitive for ocean viewing
    if (this.inputMethods.includes('touch')) {
      this.controls.rotateSpeed = 0.5
      this.controls.zoomSpeed = 0.8
    } else {
      this.controls.rotateSpeed = 0.2
      this.controls.zoomSpeed = 0.5
    }
    
    // Limit extreme rotations that can cause ocean clipping
    this.controls.maxPolarAngle = Math.PI * 0.95 // Prevent going too far under
    this.controls.minPolarAngle = Math.PI * 0.05 // Prevent going too far over
    
    // Set reasonable zoom limits for ocean viewing
    this.controls.minDistance = 2
    this.controls.maxDistance = 1000
    
    // console.log('🎮 Controls initialized')
  }

  private initDebugSystem(): void {
    this.checkDebugMode()
    window.addEventListener('hashchange', () => this.checkDebugMode())
    
    // Add global debug functions
    ;(window as any).toggleDebug = () => {
      window.location.hash = this.debugState.active ? '' : 'debug'
    }
    
    ;(window as any).getPerformanceStats = () => {
      return {
        deviceType: this.deviceType,
        inputMethods: this.inputMethods,
        animationCount: this.animationSystem.getAnimationCount(),
        triangles: this.renderer.info.render.triangles,
        drawCalls: this.renderer.info.render.calls,
        managedObjects: this.objectManager?.getAllObjects().length || 0,
        oceanLODs: this.oceanLODSystem?.getLODLevels().length || 0,
        landPieces: this.landSystem?.getLandPieces().length || 0
      }
    }
    
    // Rendering optimization analysis functions
    ;(window as any).analyzePerformance = () => {
      if (this.consoleCommands) {
        this.consoleCommands.analyzeRenderingPerformance()
      } else {
        console.warn('❌ ConsoleCommands not available')
      }
    }
    ;(window as any).showObjectBreakdown = () => {
      if (this.consoleCommands) {
        this.consoleCommands.showObjectBreakdown()
      } else {
        console.warn('❌ ConsoleCommands not available')
      }
    }
    ;(window as any).simulateInstancing = () => {
      if (this.consoleCommands) {
        this.consoleCommands.simulateInstancing()
      } else {
        console.warn('❌ ConsoleCommands not available')
      }
    }
  }

  private checkDebugMode(): void {
    const shouldBeActive = window.location.hash === '#debug'
    
    if (shouldBeActive && !this.debugState.active) {
      this.enableDebug()
    } else if (!shouldBeActive && this.debugState.active) {
      this.disableDebug()
    }
  }

  private enableDebug(): void {
    this.debugState.active = true
    
    // Create stats
    this.debugState.stats = new Stats()
    this.debugState.stats.dom.style.position = 'absolute'
    this.debugState.stats.dom.style.top = '0px'
    this.debugState.stats.dom.style.left = '0px'
    this.container.appendChild(this.debugState.stats.dom)
    
    // Create legacy GUI for backward compatibility
    this.debugState.gui = new GUI()
    this.debugState.gui.domElement.style.position = 'absolute'
    this.debugState.gui.domElement.style.top = '0px'
    this.debugState.gui.domElement.style.right = '0px'
    this.container.appendChild(this.debugState.gui.domElement)
    
    // Note: DebugGUIManager and ParameterGUI removed - using legacy GUI only
    
    // Add character shader controls (deferred — waits for player mesh to load)
    this.playerController.ready.then(() => this.setupCharacterShaderGUI())
    
    // Create Gameplay GUI column (separate panel to the left of Controls)
    this.setupGameplayGUI()
    
    // Create Lighting GUI column
    this.setupLightingGUI()
    
    // Add helpers
    this.addHelpers()
    
    // Enable performance monitoring
    performanceMonitor.enable()
    
    // Show player debug wireframe (camera mode check removed - no 'player' mode exists)
    // this.playerController.setDebugVisible(true)
    
    logger.info(LogModule.SYSTEM, 'Debug mode enabled with centralized GUI Manager and Parameter GUI')
  }

  private disableDebug(): void {
    this.debugState.active = false
    
    // Remove stats
    if (this.debugState.stats) {
      this.container.removeChild(this.debugState.stats.dom)
      this.debugState.stats = null
    }
    
    // Remove legacy GUI
    if (this.debugState.gui) {
      this.debugState.gui.destroy()
      this.debugState.gui = null
    }
    
    // Remove gameplay GUI
    if (this.debugState.gameplayGui) {
      this.debugState.gameplayGui.destroy()
      this.debugState.gameplayGui = null
    }
    
    // Remove lighting GUI
    if (this.debugState.lightingGui) {
      this.debugState.lightingGui.destroy()
      this.debugState.lightingGui = null
    }
    
    // Dispose of centralized GUI Manager
    if (this.debugState.debugGUIManager) {
      this.debugState.debugGUIManager.dispose()
      this.debugState.debugGUIManager = null
    }
    
    // Hide Parameter GUI (don't dispose, just hide to preserve parameters)
    this.parameterGUI.hide()
    
    // Remove helpers
    this.removeHelpers()
    
    // Disable performance monitoring
    performanceMonitor.disable()
    
    // Hide player debug wireframe
    this.playerController.setDebugVisible(false)
    
    logger.info(LogModule.SYSTEM, 'Debug mode disabled - parameters preserved')
  }

  // setupGUI method removed - now handled by DebugGUIManager

  // All GUI setup methods removed - now handled by DebugGUIManager

  /**
   * Setup lil-gui controls for the character shader uniforms.
   * Collects all ShaderMaterials from the player mesh and binds sliders + color pickers.
   */
  private setupCharacterShaderGUI(): void {
    const gui = this.debugState.gui
    if (!gui) return

    const playerMesh = this.playerController.getMesh()
    if (!playerMesh) {
      console.warn('⚠️ Player mesh not available for character shader GUI')
      return
    }

    // Collect all ShaderMaterials from the player model
    const shaderMaterials: THREE.ShaderMaterial[] = []
    playerMesh.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material
        if (mat && (mat as THREE.ShaderMaterial).isShaderMaterial) {
          shaderMaterials.push(mat as THREE.ShaderMaterial)
        }
      }
    })

    if (shaderMaterials.length === 0) {
      console.warn('⚠️ No ShaderMaterials found on player mesh')
      return
    }

    // Read initial values from the first material
    const ref = shaderMaterials[0].uniforms

    // Proxy object for lil-gui (works with hex strings for colours)
    const params = {
      // colour
      modelColor:     '#' + (ref.uModelColor?.value as THREE.Color).getHexString(),
      // shading
      ambient:        ref.uAmbient?.value ?? 0.55,
      brightBoost:    ref.uBrightBoost?.value ?? 0.18,
      bands:          ref.uBands?.value ?? 3.0,
      // primary light (read-only direction set by dominant-light system)
      lightIntensity: ref.uLightIntensity?.value ?? 1.0,
      lightColor:     '#' + (ref.uLightColor?.value as THREE.Color ?? new THREE.Color(1,1,0.95)).getHexString(),
      // secondary light
      light2Intensity: ref.uLight2Intensity?.value ?? 0.0,
      light2Color:     '#' + (ref.uLight2Color?.value as THREE.Color ?? new THREE.Color(0.6,0.7,1)).getHexString(),
      // rim light
      rimColor:       '#' + (ref.uRimColor?.value as THREE.Color ?? new THREE.Color(1,1,1)).getHexString(),
      rimStrength:    ref.uRimStrength?.value ?? 0.45,
      rimPower:       ref.uRimPower?.value ?? 2.5,
      // specular
      specStrength:   ref.uSpecStrength?.value ?? 0.15,
      specPower:      ref.uSpecPower?.value ?? 32.0,
      // outline
      outlineWidth:   ref.uOutlineWidth?.value ?? 0.38,
      outlineColor:   '#' + (ref.uOutlineColor?.value as THREE.Color).getHexString(),
      // manual light direction override
      lightDirX:      ref.uLightDir?.value?.x ?? 0.5,
      lightDirY:      ref.uLightDir?.value?.y ?? 0.8,
      lightDirZ:      ref.uLightDir?.value?.z ?? 0.3
    }

    // Helper: update a uniform on every collected material
    const setUniform = (name: string, value: any) => {
      for (const mat of shaderMaterials) {
        if (mat.uniforms[name]) mat.uniforms[name].value = value
      }
    }
    const setColorUniform = (name: string, hex: string) => {
      for (const mat of shaderMaterials) {
        if (mat.uniforms[name]) (mat.uniforms[name].value as THREE.Color).set(hex)
      }
    }

    const folder = gui.addFolder('🎨 Character Shader')

    // ---- Colour & Shading ----
    folder.addColor(params, 'modelColor').name('Model Color').onChange((v: string) => setColorUniform('uModelColor', v))
    folder.add(params, 'ambient',     0,   1,   0.01).name('Ambient').onChange((v: number) => setUniform('uAmbient', v))
    folder.add(params, 'brightBoost', 0,   0.5, 0.01).name('Bright Boost').onChange((v: number) => setUniform('uBrightBoost', v))
    folder.add(params, 'bands',       1,   8,   1).name('Toon Bands').onChange((v: number) => setUniform('uBands', v))

    // ---- Rim / Back Light ----
    const rimFolder = folder.addFolder('💡 Rim Light')
    rimFolder.addColor(params, 'rimColor').name('Rim Color').onChange((v: string) => setColorUniform('uRimColor', v))
    rimFolder.add(params, 'rimStrength', 0,   1.5, 0.01).name('Rim Strength').onChange((v: number) => setUniform('uRimStrength', v))
    rimFolder.add(params, 'rimPower',    0.5, 8.0, 0.1).name('Rim Power').onChange((v: number) => setUniform('uRimPower', v))

    // ---- Specular ----
    const specFolder = folder.addFolder('✨ Specular')
    specFolder.add(params, 'specStrength', 0,  0.5, 0.01).name('Spec Strength').onChange((v: number) => setUniform('uSpecStrength', v))
    specFolder.add(params, 'specPower',    4, 128,  1).name('Spec Power').onChange((v: number) => setUniform('uSpecPower', v))
    specFolder.close()

    // ---- Outline ----
    const outFolder = folder.addFolder('🖊️ Outline')
    outFolder.add(params, 'outlineWidth', 0, 1, 0.01).name('Width').onChange((v: number) => setUniform('uOutlineWidth', v))
    outFolder.addColor(params, 'outlineColor').name('Color').onChange((v: string) => setColorUniform('uOutlineColor', v))
    outFolder.close()

    // ---- Dominant Lights (artist overrides) ----
    const lightFolder = folder.addFolder('☀️ Dominant Lights')
    lightFolder.addColor(params, 'lightColor').name('Light 1 Color').onChange((v: string) => setColorUniform('uLightColor', v))
    lightFolder.add(params, 'lightIntensity', 0, 3, 0.01).name('Light 1 Intensity').onChange((v: number) => setUniform('uLightIntensity', v))
    lightFolder.addColor(params, 'light2Color').name('Light 2 Color').onChange((v: string) => setColorUniform('uLight2Color', v))
    lightFolder.add(params, 'light2Intensity', 0, 3, 0.01).name('Light 2 Intensity').onChange((v: number) => setUniform('uLight2Intensity', v))
    lightFolder.close()

    folder.open()
    console.log(`🎨 Character shader GUI created (${shaderMaterials.length} material(s))`)
  }

  // ============================================================================
  // LIGHTING GUI
  // ============================================================================

  /**
   * Create a "Lighting" lil-gui panel with World and Local lighting controls.
   */
  private setupLightingGUI(): void {
    if (this.debugState.lightingGui) return

    const gui = new GUI({ title: 'Lighting' })
    gui.domElement.style.position = 'absolute'
    gui.domElement.style.top = '0px'
    gui.domElement.style.right = '490px' // 3rd column to the left
    this.container.appendChild(gui.domElement)
    this.debugState.lightingGui = gui

    // ----------------------------------------------------------------
    // WORLD LIGHTING
    // ----------------------------------------------------------------
    const world = gui.addFolder('🌍 World Lighting')

    // --- Ambient ---
    const ambientParams = {
      color: '#' + this.ambientLight.color.getHexString(),
      intensity: this.ambientLight.intensity,
    }
    const ambFolder = world.addFolder('Ambient')
    ambFolder.addColor(ambientParams, 'color').name('Color')
      .onChange((v: string) => this.ambientLight.color.set(v))
    ambFolder.add(ambientParams, 'intensity', 0, 2, 0.01).name('Intensity')
      .onChange((v: number) => { this.ambientLight.intensity = v })
    ambFolder.open()

    // --- Key Light ---
    const kl = this.keyLight
    const keyParams = {
      color: '#' + kl.color.getHexString(),
      intensity: kl.intensity,
      posX: kl.position.x,
      posY: kl.position.y,
      posZ: kl.position.z,
      castShadow: kl.castShadow,
      shadowRadius: kl.shadow.radius,
      shadowBias: kl.shadow.bias,
    }
    const keyFolder = world.addFolder('☀️ Key Light')
    keyFolder.addColor(keyParams, 'color').name('Color')
      .onChange((v: string) => kl.color.set(v))
    keyFolder.add(keyParams, 'intensity', 0, 5, 0.01).name('Intensity')
      .onChange((v: number) => { kl.intensity = v })
    keyFolder.add(keyParams, 'posX', -100, 100, 0.5).name('Pos X')
      .onChange((v: number) => { kl.position.x = v })
    keyFolder.add(keyParams, 'posY', 0, 100, 0.5).name('Pos Y')
      .onChange((v: number) => { kl.position.y = v })
    keyFolder.add(keyParams, 'posZ', -100, 100, 0.5).name('Pos Z')
      .onChange((v: number) => { kl.position.z = v })
    keyFolder.add(keyParams, 'castShadow').name('Cast Shadow')
      .onChange((v: boolean) => { kl.castShadow = v })
    keyFolder.add(keyParams, 'shadowRadius', 0, 10, 0.1).name('Shadow Radius')
      .onChange((v: number) => { kl.shadow.radius = v })
    keyFolder.add(keyParams, 'shadowBias', -0.01, 0.01, 0.0001).name('Shadow Bias')
      .onChange((v: number) => { kl.shadow.bias = v })
    keyFolder.close()

    // --- Fill Light ---
    const fl = this.fillLight
    const fillParams = {
      color: '#' + fl.color.getHexString(),
      intensity: fl.intensity,
      posX: fl.position.x,
      posY: fl.position.y,
      posZ: fl.position.z,
    }
    const fillFolder = world.addFolder('🌙 Fill Light')
    fillFolder.addColor(fillParams, 'color').name('Color')
      .onChange((v: string) => fl.color.set(v))
    fillFolder.add(fillParams, 'intensity', 0, 3, 0.01).name('Intensity')
      .onChange((v: number) => { fl.intensity = v })
    fillFolder.add(fillParams, 'posX', -100, 100, 0.5).name('Pos X')
      .onChange((v: number) => { fl.position.x = v })
    fillFolder.add(fillParams, 'posY', 0, 100, 0.5).name('Pos Y')
      .onChange((v: number) => { fl.position.y = v })
    fillFolder.add(fillParams, 'posZ', -100, 100, 0.5).name('Pos Z')
      .onChange((v: number) => { fl.position.z = v })
    fillFolder.close()

    world.open()

    // ----------------------------------------------------------------
    // LOCAL LIGHTING
    // ----------------------------------------------------------------
    const local = gui.addFolder('💡 Local Lighting')

    // --- Player Spotlight ---
    const spotlight = this.cameraManager.getPlayerSpotlight()
    if (spotlight) {
      const RAD2DEG = 180 / Math.PI
      const DEG2RAD = Math.PI / 180
      const spotParams = {
        color: '#' + spotlight.color.getHexString(),
        intensity: spotlight.intensity,
        angle: spotlight.angle * RAD2DEG,
        penumbra: spotlight.penumbra,
        decay: spotlight.decay,
        distance: spotlight.distance,
        posX: spotlight.position.x,
        posY: spotlight.position.y,
        posZ: spotlight.position.z,
        castShadow: spotlight.castShadow,
        shadowNear: spotlight.shadow.camera.near,
        shadowFar: spotlight.shadow.camera.far,
        visible: spotlight.visible,
      }

      const spotFolder = local.addFolder('🔦 Player Spotlight')
      spotFolder.add(spotParams, 'visible').name('Enabled')
        .onChange((v: boolean) => { spotlight.visible = v })
      spotFolder.addColor(spotParams, 'color').name('Color')
        .onChange((v: string) => spotlight.color.set(v))
      spotFolder.add(spotParams, 'intensity', 0, 20, 0.1).name('Intensity')
        .onChange((v: number) => { spotlight.intensity = v })
      spotFolder.add(spotParams, 'angle', 1, 90, 0.5).name('Cone Angle (°)')
        .onChange((v: number) => { spotlight.angle = v * DEG2RAD })
      spotFolder.add(spotParams, 'penumbra', 0, 1, 0.01).name('Penumbra')
        .onChange((v: number) => { spotlight.penumbra = v })
      spotFolder.add(spotParams, 'decay', 0, 5, 0.1).name('Decay')
        .onChange((v: number) => { spotlight.decay = v })
      spotFolder.add(spotParams, 'distance', 0, 200, 1).name('Distance')
        .onChange((v: number) => { spotlight.distance = v })
      spotFolder.add(spotParams, 'posX', -50, 50, 0.5).name('Offset X')
        .onChange((v: number) => { spotlight.position.x = v })
      spotFolder.add(spotParams, 'posY', 0, 100, 0.5).name('Height')
        .onChange((v: number) => { spotlight.position.y = v })
      spotFolder.add(spotParams, 'posZ', -50, 50, 0.5).name('Offset Z')
        .onChange((v: number) => { spotlight.position.z = v })
      spotFolder.add(spotParams, 'castShadow').name('Cast Shadow')
        .onChange((v: boolean) => { spotlight.castShadow = v })
      spotFolder.add(spotParams, 'shadowNear', 0.1, 50, 0.1).name('Shadow Near')
        .onChange((v: number) => { spotlight.shadow.camera.near = v; spotlight.shadow.camera.updateProjectionMatrix() })
      spotFolder.add(spotParams, 'shadowFar', 10, 500, 1).name('Shadow Far')
        .onChange((v: number) => { spotlight.shadow.camera.far = v; spotlight.shadow.camera.updateProjectionMatrix() })
      spotFolder.open()
    } else {
      local.add({ note: 'Spotlight disabled' }, 'note').name('Status').disable()
    }

    local.open()
    gui.open()
    console.log('💡 Lighting GUI created')
  }

  // ============================================================================
  // GAMEPLAY GUI
  // ============================================================================

  /**
   * Create a "Gameplay" lil-gui panel to the left of the Controls panel.
   * Exposes walk/run speed, jump force, gravity and friction.
   */
  private setupGameplayGUI(): void {
    if (this.debugState.gameplayGui) return // already created

    const gui = new GUI({ title: 'Gameplay' })
    gui.domElement.style.position = 'absolute'
    gui.domElement.style.top = '0px'
    gui.domElement.style.right = '245px' // offset to the left of the Controls panel (~245px)
    this.container.appendChild(gui.domElement)
    this.debugState.gameplayGui = gui

    const config = this.playerController.getConfig()

    const params = {
      walkSpeed:  config.walkSpeed,
      runSpeed:   config.runSpeed,
      jumpForce:  config.jumpForce,
      gravity:    config.gravity,
      friction:   config.friction,
    }

    const movement = gui.addFolder('🏃 Movement')
    movement.add(params, 'walkSpeed', 0.5, 10, 0.1).name('Walk Speed')
      .onChange((v: number) => this.playerController.updateConfig({ walkSpeed: v }))
    movement.add(params, 'runSpeed', 1, 20, 0.5).name('Run Speed')
      .onChange((v: number) => this.playerController.updateConfig({ runSpeed: v }))
    movement.open()

    const physics = gui.addFolder('⚡ Physics')
    physics.add(params, 'jumpForce', 1, 30, 0.5).name('Jump Force')
      .onChange((v: number) => this.playerController.updateConfig({ jumpForce: v }))
    physics.add(params, 'gravity', 1, 60, 0.5).name('Gravity')
      .onChange((v: number) => this.playerController.updateConfig({ gravity: v }))
    physics.add(params, 'friction', 0, 1, 0.01).name('Friction')
      .onChange((v: number) => this.playerController.updateConfig({ friction: v }))
    physics.open()

    gui.open()
    console.log('🎮 Gameplay GUI created')
  }

  private addHelpers(): void {
    // Grid helper
    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x444444)
    this.scene.add(gridHelper)
    this.debugState.helpers.push(gridHelper)
    
    // Axes helper
    const axesHelper = new THREE.AxesHelper(5)
    this.scene.add(axesHelper)
    this.debugState.helpers.push(axesHelper)
    
    // Camera helper (for seeing camera frustum)
    const cameraHelper = new THREE.CameraHelper(this.camera)
    this.scene.add(cameraHelper)
    this.debugState.helpers.push(cameraHelper)
  }

  private removeHelpers(): void {
    this.debugState.helpers.forEach(helper => {
      this.scene.remove(helper)
    })
    this.debugState.helpers = []
  }

  private async createContent(onProgress?: (text: string) => void): Promise<void> {
    const progress = (msg: string) => { if (onProgress) onProgress(msg) }

    progress('Creating lighting...')
    this.addLighting()
    this.createSkySystem()

    progress('Building ocean...')
    await this.createOceanSystem()
    
    // Create land system first
    progress('Building terrain...')
    await this.createLandSystem()
    
    // CRITICAL FIX: Connect collision system to land system AFTER creation
    if (this.landSystem) {
      this.landSystem.setCollisionSystem(this.collisionSystem)
      console.log('🏔️ Collision system connected to land system AFTER creation')
      
      // Register land meshes for primitive collision detection
      // Note: Using imported model geometry directly - no dynamic collision generation
      const landMeshes = this.landSystem.getLandMeshes()
      if (landMeshes.length > 0) {
        this.collisionSystem.registerLandMeshes(landMeshes)
        console.log(`🏔️ Registered ${landMeshes.length} land meshes for primitive collision detection`)

        // Also register land meshes for third-person camera collision
        this.cameraManager.setCollisionMeshes(landMeshes)
      }
      
      // Link land system to camera manager for spotlight updates
      this.cameraManager.setLandSystem(this.landSystem)
    }
    
    // Set up camera switching controls
    this.setupCameraSwitching()
    
    // Initialize ObjectLoader with required systems
    // Initialize ObjectLoader with landUniforms for shader materials
    ObjectLoader.initialize(this.scene, this.objectManager, this.animationSystem, this.landSystem?.getLandUniforms(), this.collisionSystem)
    
    // Load all objects using the unified ObjectLoader system
    progress('Loading scene objects...')
    await ObjectLoader.loadDefaultScene(progress)
    
    // CRITICAL FIX: Load saved positions AFTER objects are created
    // This ensures saved positions override default positions from JSON config
    this.objectManager.loadPersistentStates()
    
    // Also register loaded object meshes for camera collision (buildings, props, etc.)
    const allObjects = this.objectManager.getAllObjects()
    const objectMeshes = allObjects
      .filter(obj => obj.type === 'model' || obj.type === 'custom')
      .map(obj => obj.mesh as THREE.Object3D)
    if (objectMeshes.length > 0) {
      this.cameraManager.addCollisionMeshes(objectMeshes)
    }

    // Log loaded positions for debugging
    const tslObjects = allObjects.filter(obj => obj.type === 'tsl' || obj.id.includes('tsl'))
    if (tslObjects.length > 0) {
      console.log(`📦 Loaded ${tslObjects.length} TSL objects with positions:`)
      tslObjects.forEach(obj => {
        const pos = obj.persistentState.position
        console.log(`  ${obj.id}: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`)
      })
    }
    
    // Load saved camera state
    const cameraLoaded = this.objectManager.loadCameraState()
    if (cameraLoaded) {
      // console.log('📷 Camera state restored from previous session')
    } else {
      // console.log('📷 No saved camera state found, using default position')
    }
    
    // Initialize parameter integration after all systems are created
    progress('Configuring systems...')
    this.parameterIntegration = new ParameterIntegration(this.parameterManager, {
      oceanSystem: this.oceanLODSystem,
      landSystem: this.landSystem,
      skySystem: this.sky,
      lightingSystem: null, // Will be set after lighting is created
      cameraManager: this.cameraManager,
      playerController: this.playerController
    })
    
    // Update all systems with current parameter values
    this.parameterIntegration.updateAllSystems()
    
    // Load state "1" as default, or create it if it doesn't exist
    const savedStates = this.parameterManager.getSavedStateNames()
    if (savedStates.includes('1')) {
      // Load state "1" as default
      const loaded = this.parameterManager.loadState('1')
      if (loaded) {
        // Update all systems with loaded parameters
        this.parameterIntegration.updateAllSystems()
        logger.info(LogModule.SYSTEM, 'Load state "1" applied as default startup state')
      } else {
        logger.warn(LogModule.SYSTEM, 'Failed to load state "1", using current parameters')
      }
    } else {
      // Create state "1" with current parameters as the new default
      this.parameterManager.saveState('1')
      logger.info(LogModule.SYSTEM, 'Created state "1" as default startup state with current parameters')
    }
    
    // AUTHORITATIVE speed sync — runs AFTER all localStorage / state loads.
    // Uses setParameter() so ParameterManager, localStorage, AND PlayerController
    // all agree on the canonical values from PLAYER_DEFAULTS.
    this.parameterManager.setParameter('player', 'walkSpeed', PLAYER_DEFAULTS.walkSpeed, 'startup_override')
    this.parameterManager.setParameter('player', 'runSpeed', PLAYER_DEFAULTS.runSpeed, 'startup_override')
    this.playerController.updateConfig({ walkSpeed: PLAYER_DEFAULTS.walkSpeed, runSpeed: PLAYER_DEFAULTS.runSpeed })
    
    // Also save an 'initial' state for reference if no saved states exist
    if (savedStates.length === 0) {
      this.parameterManager.saveState('initial')
      logger.info(LogModule.SYSTEM, 'Initial parameters also saved as "initial" state for reference')
    }
    
    // console.log('🔄 All objects created via ObjectLoader, positions loaded via ObjectManager')
    // console.log('🎯 Unified object system ready! Use help() in console for available commands')
    // console.log('📷 Camera Controls: C = Switch between System/Player cameras')
  }

  /**
   * Set up camera switching functionality
   */
  private setupCameraSwitching(): void {
    // Create camera mode indicator
    this.createCameraModeIndicator()
    
    // Add keyboard listener for camera switching
    document.addEventListener('keydown', (event) => {
      // C key - Cycle between SHOULDER and THIRD PERSON gameplay cameras
      if (event.code === 'KeyC') {
        this.cycleCameraMode()
      }

      // F key - Toggle FREE VIEW debug camera (keyboard-only, not part of gameplay cycle)
      if (event.code === 'KeyF') {
        this.toggleFreeViewCamera()
      }
      
      // Enter/Return key - Menu/Pause (only when overlay is NOT already shown,
      // to avoid double-toggling; PauseOverlay handles its own Enter key)
      if ((event.code === 'Enter' || event.code === 'NumpadEnter') && !this.pauseOverlay.isVisible()) {
        console.log('🎮 Menu/Pause button pressed')
        this.togglePause()
      }
    })
    
    // Set initial debug visibility for player
    if (this.debugState.active) {
      this.playerController.setDebugVisible(true)
    }

    // Create mobile touch action buttons (camera / jump / start)
    this.createMobileActionButtons()
    
    // console.log('📷 Camera controls: C = Switch camera | V = Cycle 3rd person views')
  }

  /**
   * Create mobile touch action buttons:
   * - Camera (upper-left): cycle gameplay camera modes
   * - A (lower-right): jump while held/pressed
   * - Start (bottom-center): toggle pause menu
   */
  private createMobileActionButtons(): void {
    // Only show on touch devices
    if (!('ontouchstart' in window)) return

    const touchControlScale = 0.85
    const scaleSize = (value: number): number => Math.max(1, Math.round(value * touchControlScale))

    const createButton = (id: string, text: string, style: string): HTMLButtonElement => {
      const existing = document.getElementById(id)
      if (existing) existing.remove()

      const btn = document.createElement('button')
      btn.id = id
      btn.textContent = text
      btn.style.cssText = `
        position: fixed;
        width: ${scaleSize(56)}px;
        height: ${scaleSize(56)}px;
        border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.5);
        background: rgba(0,0,0,0.45);
        color: white;
        font-size: ${scaleSize(22)}px;
        z-index: 12000;
        pointer-events: auto;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.15s;
        ${style}
      `
      document.body.appendChild(btn)
      return btn
    }

    const consumeEvent = (e: Event): void => {
      e.preventDefault()
      e.stopPropagation()
    }

    const bindPress = (btn: HTMLButtonElement, onPress: () => void, onRelease?: () => void): void => {
      let lastPressTime = 0
      const guardWindowMs = 120

      const tryPress = (e: Event) => {
        consumeEvent(e)
        const now = performance.now()
        if (now - lastPressTime < guardWindowMs) return
        lastPressTime = now
        onPress()
      }

      btn.addEventListener('pointerdown', tryPress, { passive: false })
      btn.addEventListener('touchstart', tryPress, { passive: false })
      btn.addEventListener('click', tryPress, { passive: false })

      if (onRelease) {
        const release = (e: Event) => {
          consumeEvent(e)
          onRelease()
        }
        btn.addEventListener('pointerup', release, { passive: false })
        btn.addEventListener('touchend', release, { passive: false })
        btn.addEventListener('touchcancel', release, { passive: false })
        btn.addEventListener('pointercancel', release, { passive: false })
      }
    }

    // Camera button (upper-left)
    const cameraBtn = createButton(
      'mobile-camera-btn',
      '📷',
      `top: calc(env(safe-area-inset-top, 0px) + ${scaleSize(12)}px); left: calc(env(safe-area-inset-left, 0px) + ${scaleSize(12)}px);`
    )
    bindPress(cameraBtn, () => {
      cameraBtn.style.background = 'rgba(255,255,255,0.25)'
      this.toggleMobileGameplayCamera()
    }, () => {
      cameraBtn.style.background = 'rgba(0,0,0,0.45)'
    })

    // Jump button A (lower-right)
    const jumpBtn = createButton(
      'mobile-jump-btn',
      'A',
      `right: ${scaleSize(20)}px; bottom: ${scaleSize(20)}px;`
    )
    const setJumpPressed = (pressed: boolean): void => {
      this.playerController.setVirtualJumpPressed(pressed)
      jumpBtn.style.background = pressed ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.45)'
    }
    bindPress(jumpBtn, () => {
      setJumpPressed(true)
    }, () => {
      setJumpPressed(false)
    })

    // Start button (center-bottom) for pause toggle
    const startBtn = createButton(
      'mobile-start-btn',
      'START',
      `left: 50%; bottom: ${scaleSize(20)}px; transform: translateX(-50%); width: ${scaleSize(88)}px; border-radius: ${scaleSize(18)}px; font-size: ${scaleSize(12)}px;`
    )
    bindPress(startBtn, () => {
      startBtn.style.background = 'rgba(255,255,255,0.25)'
      this.togglePause()
    }, () => {
      startBtn.style.background = 'rgba(0,0,0,0.45)'
    })
  }

  /**
   * Create a persistent camera mode indicator
   */
  private createCameraModeIndicator(): void {
    const indicator = document.createElement('div')
    indicator.id = 'camera-mode-indicator'
    indicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-family: Arial, sans-serif;
      font-size: 12px;
      z-index: 1000;
      pointer-events: none;
      transition: all 0.3s ease;
    `
    document.body.appendChild(indicator)
    // Initialize with current camera mode
    this.updateCameraModeIndicator(this.cameraManager.getCurrentMode())
  }

  /**
   * Cycle gameplay camera modes: thirdperson → shoulder → thirdperson …
   * Free view is NOT part of this cycle — use F key or debug options.
   */
  private cycleCameraMode(): void {
    const currentMode = this.cameraManager.getCurrentMode()

    // If currently in freeview (debug), snap back to thirdperson
    if (currentMode === 'freeview') {
      this.cameraManager.switchCamera('thirdperson', true)
      this.updateCameraModeIndicator('thirdperson')
      this.playerController.setDebugVisible(false)
      this.showTemporaryMessage('THIRD PERSON Camera - Press C / Select to cycle', 2000)
      return
    }

    const gameplayCycle: Array<'shoulder' | 'thirdperson'> = ['thirdperson', 'shoulder']
    const idx = gameplayCycle.indexOf(currentMode as 'shoulder' | 'thirdperson')
    const newMode = gameplayCycle[(idx + 1) % gameplayCycle.length]

    this.cameraManager.switchCamera(newMode, true)
    this.updateCameraModeIndicator(newMode)

    // Toggle player debug wireframe based on debug mode and camera mode
    if (newMode === 'shoulder' && this.debugState.active) {
      this.playerController.setDebugVisible(true)
    } else {
      this.playerController.setDebugVisible(false)
    }

    const modeLabels: Record<string, string> = {
      shoulder: 'SHOULDER',
      thirdperson: 'THIRD PERSON'
    }
    this.showTemporaryMessage(`${modeLabels[newMode]} Camera - Press C / Select to cycle`, 2000)
  }

  /**
   * Mobile camera button behavior: swap strictly between SHOULDER and THIRD PERSON.
   */
  private toggleMobileGameplayCamera(): void {
    const currentMode = this.cameraManager.getCurrentMode()
    const targetMode: 'shoulder' | 'thirdperson' = currentMode === 'shoulder' ? 'thirdperson' : 'shoulder'

    this.cameraManager.switchCamera(targetMode, true)
    this.updateCameraModeIndicator(targetMode)

    if (targetMode === 'shoulder' && this.debugState.active) {
      this.playerController.setDebugVisible(true)
    } else {
      this.playerController.setDebugVisible(false)
    }

    const modeLabels: Record<'shoulder' | 'thirdperson', string> = {
      shoulder: 'SHOULDER',
      thirdperson: 'THIRD PERSON'
    }
    this.showTemporaryMessage(`${modeLabels[targetMode]} Camera`, 1200)
  }

  /**
   * Toggle FREE VIEW debug camera (keyboard F key only).
   * Not available on gamepad or mobile — debug-only.
   */
  private toggleFreeViewCamera(): void {
    const currentMode = this.cameraManager.getCurrentMode()
    if (currentMode === 'freeview') {
      // Return to thirdperson
      this.cameraManager.switchCamera('thirdperson', true)
      this.updateCameraModeIndicator('thirdperson')
      this.playerController.setDebugVisible(false)
      this.showTemporaryMessage('Exiting FREE VIEW → THIRD PERSON', 2000)
    } else {
      // Enter freeview
      this.cameraManager.switchCamera('freeview', true)
      this.updateCameraModeIndicator('freeview')
      this.playerController.setDebugVisible(this.debugState.active)
      this.showTemporaryMessage('FREE VIEW Camera (debug) — Press F to exit', 2000)
    }
  }

  /**
   * Update the camera mode indicator
   */
  private updateCameraModeIndicator(mode: 'freeview' | 'shoulder' | 'thirdperson'): void {
    const indicator = document.getElementById('camera-mode-indicator')
    if (indicator) {
      const labels: Record<string, { text: string; bg: string }> = {
        freeview: { text: 'Camera: FREE VIEW', bg: 'rgba(30, 144, 255, 0.8)' },
        shoulder: { text: 'Camera: SHOULDER', bg: 'rgba(0, 128, 0, 0.8)' },
        thirdperson: { text: 'Camera: THIRD PERSON', bg: 'rgba(180, 80, 220, 0.8)' }
      }
      const cfg = labels[mode] || labels.freeview
      indicator.textContent = cfg.text
      indicator.style.background = cfg.bg
      indicator.style.color = 'white'
    }
  }

  /**
   * Show a temporary message on screen
   */
  private showTemporaryMessage(message: string, duration: number = 3000): void {
    // Remove any existing message
    const existingMessage = document.getElementById('temp-message')
    if (existingMessage) {
      existingMessage.remove()
    }
    
    // Create new message element
    const messageElement = document.createElement('div')
    messageElement.id = 'temp-message'
    messageElement.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: Arial, sans-serif;
      font-size: 14px;
      z-index: 1000;
      pointer-events: none;
      transition: opacity 0.3s ease;
    `
    messageElement.textContent = message
    
    document.body.appendChild(messageElement)
    
    // Remove after duration
    setTimeout(() => {
      if (messageElement.parentNode) {
        messageElement.style.opacity = '0'
        setTimeout(() => {
          if (messageElement.parentNode) {
            messageElement.remove()
          }
        }, 300)
      }
    }, duration)
  }

  /**
   * Toggle the game pause state
   */
  private togglePause(): void {
    const now = performance.now()
    if (now - this.lastPauseToggleTime < this.pauseToggleCooldownMs) {
      return
    }
    this.lastPauseToggleTime = now

    if (this.pauseOverlay.isVisible()) {
      // If pause overlay is visible, hide it and resume
      this.pauseOverlay.hide()
      this.pauseManager.setPaused(false)
    } else {
      // Show pause overlay and pause the game
      this.pauseOverlay.show()
      this.pauseManager.setPaused(true)
    }
  }

  // ============================================================================
  // DOMINANT LIGHT SELECTION — picks 1-2 strongest lights for character shader
  // Runs per-frame; pushes results into all player ShaderMaterial uniforms.
  // ============================================================================

  /** Reusable scratch vectors to avoid per-frame allocations */
  private _lightScratchDir = new THREE.Vector3()

  private updateCharacterLighting(): void {
    const playerMesh = this.playerController.getMesh()
    if (!playerMesh) return

    const playerPos = playerMesh.position

    // ---- Collect candidate lights from the scene ----
    interface LightCandidate {
      dir: THREE.Vector3    // direction FROM object TO light (normalised)
      color: THREE.Color
      influence: number     // intensity × attenuation
    }
    const candidates: LightCandidate[] = []

    this.scene.traverse((obj: THREE.Object3D) => {
      if (obj === this.ambientLight) return // skip ambient
      if (!obj.visible) return

      if (obj instanceof THREE.DirectionalLight) {
        // Directional lights have no position attenuation — influence = intensity
        const dir = this._lightScratchDir
          .copy(obj.position)
          .sub(obj.target.position)
          .normalize()
        candidates.push({
          dir: dir.clone(),
          color: obj.color.clone(),
          influence: obj.intensity
        })
      } else if (obj instanceof THREE.PointLight) {
        const dir = this._lightScratchDir.copy(obj.position).sub(playerPos)
        const dist = dir.length()
        if (dist < 0.01) return
        dir.normalize()
        const attenuation = 1.0 / (1.0 + dist * dist * 0.01)
        candidates.push({
          dir: dir.clone(),
          color: obj.color.clone(),
          influence: obj.intensity * attenuation
        })
      } else if (obj instanceof THREE.SpotLight) {
        const dir = this._lightScratchDir.copy(obj.position).sub(playerPos)
        const dist = dir.length()
        if (dist < 0.01) return
        dir.normalize()
        const attenuation = 1.0 / (1.0 + dist * dist * 0.01)
        candidates.push({
          dir: dir.clone(),
          color: obj.color.clone(),
          influence: obj.intensity * attenuation * 0.5 // spot lights contribute less broadly
        })
      }
    })

    // Sort descending by influence
    candidates.sort((a, b) => b.influence - a.influence)

    // ---- Push top 1-2 lights into character shader uniforms ----
    const setAll = (name: string, value: any) => {
      playerMesh.traverse((child: THREE.Object3D) => {
        const m = (child as THREE.Mesh).material as THREE.ShaderMaterial | undefined
        if (m?.isShaderMaterial && m.uniforms[name]) {
          const u = m.uniforms[name]
          if (value instanceof THREE.Vector3)      (u.value as THREE.Vector3).copy(value)
          else if (value instanceof THREE.Color)   (u.value as THREE.Color).copy(value)
          else                                      u.value = value
        }
      })
    }

    // Primary dominant light
    if (candidates.length >= 1) {
      const c = candidates[0]
      setAll('uLightDir',       c.dir)
      setAll('uLightColor',     c.color)
      setAll('uLightIntensity', c.influence)
    }

    // Secondary light (or zero-out)
    if (candidates.length >= 2) {
      const c = candidates[1]
      setAll('uLight2Dir',       c.dir)
      setAll('uLight2Color',     c.color)
      setAll('uLight2Intensity', c.influence)
    } else {
      setAll('uLight2Intensity', 0.0)
    }
  }

  private addLighting(): void {
    // Retro arcade-style lighting: key light + ambient fill
    
    // Ambient fill light (softer, lower intensity for retro look)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.15) // Reduced for spotlight visibility
    this.scene.add(this.ambientLight)

    // Key light (main directional light - arcade style)
    // Positioned at angle for dramatic lighting (typical arcade setup)
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.5) // Reduced for spotlight visibility
    this.keyLight.position.set(30, 40, 20) // Angled key light position
    this.keyLight.castShadow = this.rendererConfig.shadows
    const keyLight = this.keyLight
    
    if (keyLight.castShadow) {
      // Lower resolution shadow map for retro look (harder edges)
      keyLight.shadow.mapSize.width = 1024  // Reduced from 4096
      keyLight.shadow.mapSize.height = 1024 // Reduced from 4096
      keyLight.shadow.camera.near = 0.5
      keyLight.shadow.camera.far = 500
      
      // Shadow camera frustum
      const shadowCameraSize = 200
      keyLight.shadow.camera.left = -shadowCameraSize
      keyLight.shadow.camera.right = shadowCameraSize
      keyLight.shadow.camera.top = shadowCameraSize
      keyLight.shadow.camera.bottom = -shadowCameraSize
      
      // Hard shadows for retro look (no blur)
      keyLight.shadow.radius = 0 // No blur for hard edges
      keyLight.shadow.bias = -0.0001
    }
    
    keyLight.target.position.set(0, 0, 0)
    this.scene.add(keyLight)
    this.scene.add(keyLight.target)

    // Subtle fill light from opposite side (arcade style)
    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.15) // Reduced for spotlight visibility
    this.fillLight.position.set(-20, 20, -15)
    this.fillLight.castShadow = false // Fill light doesn't cast shadows
    this.scene.add(this.fillLight)
    
    // console.log('💡 Retro arcade-style lighting initialized')
  }

  private createSkySystem(): void {
    // Create the sky dome using Three.js Sky addon
    this.sky = new Sky()
    this.sky.scale.setScalar(450000) // Large scale for sky dome
    this.scene.add(this.sky)

    // Configure sky uniforms with Preetham atmospheric scattering model
    const skyUniforms = this.sky.material.uniforms
    skyUniforms['turbidity'].value = this.skyConfig.turbidity
    skyUniforms['rayleigh'].value = this.skyConfig.rayleigh
    skyUniforms['mieCoefficient'].value = this.skyConfig.mieCoefficient
    skyUniforms['mieDirectionalG'].value = this.skyConfig.mieDirectionalG

    // Update sun position
    this.updateSunPosition()

    // Set renderer exposure for proper HDR tone mapping
    this.renderer.toneMappingExposure = this.skyConfig.exposure

    // Enable tone mapping for realistic sky rendering
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping

    // console.log('🌅 Sky system initialized')
  }

  private updateSunPosition(): void {
    const phi = THREE.MathUtils.degToRad(90 - this.skyConfig.elevation)
    const theta = THREE.MathUtils.degToRad(this.skyConfig.azimuth)

    this.sun.setFromSphericalCoords(1, phi, theta)

    if (this.sky) {
      const skyUniforms = this.sky.material.uniforms
      skyUniforms['sunPosition'].value.copy(this.sun)
    }

    // Update directional light to match sun position for realistic lighting
    const directionalLight = this.scene.children.find(
      child => child instanceof THREE.DirectionalLight
    ) as THREE.DirectionalLight

    if (directionalLight) {
      directionalLight.position.copy(this.sun.clone().multiplyScalar(50))
      directionalLight.target.position.set(0, 0, 0)
      
      // Adjust light intensity based on sun elevation (realistic day/night cycle)
      const sunElevation = this.skyConfig.elevation
      const intensity = Math.max(0.1, Math.sin(THREE.MathUtils.degToRad(sunElevation)) * 1.2)
      directionalLight.intensity = intensity
      
      // Adjust light color based on time of day (sunset/sunrise colors)
      const sunsetColor = new THREE.Color(1, 0.4, 0.1)
      const dayColor = new THREE.Color(1, 1, 0.9)
      const nightColor = new THREE.Color(0.2, 0.3, 0.6)
      // const t = Math.max(0, Math.sin(THREE.MathUtils.degToRad(sunElevation))) // Unused for now
      
      // Interpolate between night, sunset, and day colors
      let finalColor: THREE.Color
      if (sunElevation < -10) {
        // Night time
        finalColor = nightColor.clone()
      } else if (sunElevation < 10) {
        // Sunset/sunrise
        finalColor = new THREE.Color().lerpColors(nightColor, sunsetColor, (sunElevation + 10) / 20)
      } else {
        // Day time
        finalColor = new THREE.Color().lerpColors(sunsetColor, dayColor, Math.min(1, (sunElevation - 10) / 30))
      }
      
      directionalLight.color.copy(finalColor)
      
      // Update ocean shader uniforms to match sun position, color, and intensity
      if (this.oceanLODSystem) {
        this.oceanLODSystem.setSunDirection(this.sun)
        this.oceanLODSystem.setSunColor(finalColor)
        this.oceanLODSystem.setSunIntensity(intensity)
      }
      
      // Update land shader uniforms to match sun position, color, and intensity
      if (this.landSystem) {
        this.landSystem.setSunDirection(this.sun)
        this.landSystem.setSunColor(finalColor)
        this.landSystem.setSunIntensity(intensity)
      }
    }
  }

  // UNUSED: Method for updating sky uniforms - kept for future use
  // private updateSkyUniforms(): void {
  //   if (!this.sky) return
  //   
  //   const skyUniforms = this.sky.material.uniforms
  //   skyUniforms['turbidity'].value = this.skyConfig.turbidity
  //   skyUniforms['rayleigh'].value = this.skyConfig.rayleigh
  //   skyUniforms['mieCoefficient'].value = this.skyConfig.mieCoefficient
  //   skyUniforms['mieDirectionalG'].value = this.skyConfig.mieDirectionalG
  // }

  private async createOceanSystem(): Promise<void> {
    try {
      // Load ocean shaders
      const { vertex: oceanVertexShader, fragment: oceanFragmentShader } = await ShaderLoader.loadShaderPair({
        vertexPath: 'src/shaders/ocean-vertex.glsl',
        fragmentPath: 'src/shaders/ocean-fragment.glsl'
      })

      // Initialize Ocean LOD System
      this.oceanLODSystem = new OceanLODSystem(this.camera, this.scene)
      
      // Create LOD levels with loaded shaders
      await this.oceanLODSystem.createLODLevels({
        vertex: oceanVertexShader,
        fragment: oceanFragmentShader
      })

      // console.log('🌊 Ocean system initialized')

    } catch (error) {
      // console.error('❌ Failed to create ocean system:', error)
      
      // Fallback: create a simple water plane
      const geometry = new THREE.PlaneGeometry(200, 200, 64, 64)
      geometry.rotateX(-Math.PI / 2)
      
      const material = new THREE.MeshStandardMaterial({
        color: 0x006994,
        transparent: true,
        opacity: 0.8,
        roughness: 0.1,
        metalness: 0.1
      })
      
      const waterMesh = new THREE.Mesh(geometry, material)
      waterMesh.position.set(0, -2, 0)
      waterMesh.userData = { id: 'fallback-water', type: 'water' }
      this.scene.add(waterMesh)
      
              // console.log('🌊 Fallback water created')
    }
  }

  private async createLandSystem(): Promise<void> {
    try {
      // Load land shaders
      const { vertex: landVertexShader, fragment: landFragmentShader } = await ShaderLoader.loadShaderPair({
        vertexPath: 'src/shaders/land-vertex.glsl',
        fragmentPath: 'src/shaders/land-fragment.glsl'
      })

      // Initialize Land System
      this.landSystem = new LandSystem(this.scene)

      // Create some sample land pieces
      await this.landSystem.createLandPiece('plane', {
        vertex: landVertexShader,
        fragment: landFragmentShader
      }, {
        id: 'main-terrain',
        position: new THREE.Vector3(0, 0, 0),
        size: 100,
        segments: 128
      })

      // Create a hill
      await this.landSystem.createLandPiece('sphere', {
        vertex: landVertexShader,
        fragment: landFragmentShader
      }, {
        id: 'hill-1',
        position: new THREE.Vector3(30, 0, 30),
        size: 25,
        segments: 64
      })

      // Create a rocky outcrop
      await this.landSystem.createLandPiece('box', {
        vertex: landVertexShader,
        fragment: landFragmentShader
      }, {
        id: 'rocky-outcrop',
        position: new THREE.Vector3(-40, 0, 20),
        size: 20,
        segments: 32
      })

      // Note: Land meshes will be registered with collision system in createContent() method
      // This ensures proper initialization order

      // console.log('🏔️ Land system initialized')

    } catch (error) {
      // console.error('❌ Failed to create land system:', error)
    }
  }

  // Object creation methods moved to ObjectLoader system

  // Legacy animation creation moved to ObjectLoader system



  private setupEventListeners(): void {
    window.addEventListener('resize', this.onWindowResize.bind(this))
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.onWindowResize.bind(this))
      window.visualViewport.addEventListener('scroll', this.onWindowResize.bind(this))
    }
    document.addEventListener('visibilitychange', this.onVisibilityChange.bind(this))
    
    // Click handler for objects
    this.renderer.domElement.addEventListener('click', this.onCanvasClick.bind(this))
    // Double-click handler for freeview mesh selection & zoom
    this.renderer.domElement.addEventListener('dblclick', this.onCanvasDblClick.bind(this))
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
      switch (event.key.toLowerCase()) {
        case 'd':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            ;(window as any).toggleDebug()
          }
          break
        case ' ':
          event.preventDefault()
          if (this.animationSystem.getAnimationCount() > 0) {
            this.animationSystem.stop()
          } else {
            this.animationSystem.start()
          }
          break
        case 'p':
          if (this.playerController) {
            const poseName = this.playerController.cyclePose()
            console.log(`🧍 Pose: ${poseName}`)
          }
          break
      }
    })
  }

  private onWindowResize(): void {
    const { width, height } = this.getViewportSize()
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    
    // Update retro post-processing on resize
    if (this.retroPostProcessing) {
      this.retroPostProcessing.handleResize()
    }
    
    const newDeviceType = this.detectDeviceType()
    if (newDeviceType !== this.deviceType) {
      this.deviceType = newDeviceType
      this.adjustCameraForDevice()
    }
  }

  private onVisibilityChange(): void {
    if (document.hidden) {
      this.animationSystem.stop()
    } else {
      this.animationSystem.start()
    }
  }

  private onCanvasClick(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
    
    // Use CameraManager's active camera for raycasting
    const activeCamera = this.cameraManager.getCamera() as THREE.PerspectiveCamera
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, activeCamera)
    
    // Get ALL meshes in the scene (recursive traversal)
    const allMeshes: THREE.Mesh[] = []
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        allMeshes.push(object)
      }
    })
    
    const intersects = raycaster.intersectObjects(allMeshes)
    
    if (intersects.length > 0) {
      const clickedObject = intersects[0].object as THREE.Mesh
      const point = intersects[0].point
      
      // Find the mesh index in scene traversal order
      // const meshIndex = allMeshes.findIndex(mesh => mesh.uuid === clickedObject.uuid) // Unused for now
      
      // Enhanced mesh identification
      // console.group('🎯 Mesh Click Detection')
      // console.log('🔢 Mesh Index:', meshIndex >= 0 ? meshIndex : 'Not found')
      // console.log('📍 Clicked Mesh:', clickedObject)
      // console.log('🏷️  User Data:', clickedObject.userData)
      // console.log('📏 Distance from Camera:', distance.toFixed(2))
      // console.log('🎯 World Position:', {
      //   x: point.x.toFixed(2),
      //   y: point.y.toFixed(2),
      //   z: point.z.toFixed(2)
      // })
      // console.log('📐 Mesh Position:', {
      //   x: clickedObject.position.x.toFixed(2),
      //   y: clickedObject.position.y.toFixed(2),
      //   z: clickedObject.position.z.toFixed(2)
      // })
      // console.log('📏 Mesh Scale:', {
      //   x: clickedObject.scale.x.toFixed(2),
      //   y: clickedObject.scale.y.toFixed(2),
      //   z: clickedObject.scale.z.toFixed(2)
      // })
      // console.log('🎨 Material Type:', clickedObject.material.constructor.name)
      
      // Identify mesh type based on userData or material properties
      let meshType = 'Unknown'
      // let meshDescription = '' // Unused for now
      
      if (clickedObject.userData.type) {
        meshType = clickedObject.userData.type
        // meshDescription = clickedObject.userData.id || 'No ID' // Unused for now
      } else if (clickedObject.userData.id) {
        meshType = 'Identified'
        // meshDescription = clickedObject.userData.id // Unused for now
      } else {
        // Try to identify by material or geometry properties
        if (clickedObject.material instanceof THREE.ShaderMaterial) {
          if (clickedObject.material.uniforms?.uWaterColor) {
            meshType = 'Ocean'
            // meshDescription = 'Ocean LOD System' // Unused for now
          } else if (clickedObject.material.uniforms?.uLandColor) {
            meshType = 'Land'
            // meshDescription = 'Terrain System' // Unused for now
          } else {
            meshType = 'Shader'
            // meshDescription = 'Custom Shader Material' // Unused for now
          }
        } else if (clickedObject.material instanceof THREE.MeshStandardMaterial) {
          meshType = 'Standard'
          // meshDescription = 'Standard Material Mesh' // Unused for now
        }
      }
      
      // console.log('🔍 Mesh Type:', meshType)
      // console.log('📝 Description:', meshDescription)
      // console.log('🆔 Object UUID:', clickedObject.uuid)
      // console.log(`📋 Use: moveMesh(${meshIndex}, yOffset) to move this mesh`)
      // console.groupEnd()
      
      // Create highlight animation only for small meshes (exclude ocean and land)
      if (meshType !== 'Ocean' && meshType !== 'ocean' && meshType !== 'Land' && meshType !== 'land') {
      const originalScale = clickedObject.scale.clone()
      const highlightAnimation = this.animationSystem.createAnimation(clickedObject, {
        duration: 200,
        easing: Easing.easeOutQuad,
        yoyo: true,
        onComplete: () => clickedObject.scale.copy(originalScale)
      })
      highlightAnimation.to({ scale: originalScale.clone().multiplyScalar(1.3) }).start()
      this.animationSystem.addAnimation(highlightAnimation)
      } else {
        // For large meshes (ocean/land), just log a special message
        if (meshType === 'Ocean' || meshType === 'ocean') {
          // console.log('🌊 Ocean mesh clicked - no highlight animation (too large)')
        } else if (meshType === 'Land' || meshType === 'land') {
          // console.log('🏔️ Land mesh clicked - no highlight animation (too large)')
        }
      }

    } else {
      // console.log('❌ No mesh clicked - clicked on empty space')
    }
  }

  /**
   * Double-click handler: in freeview mode, raycast and zoom to selected mesh.
   */
  private onCanvasDblClick(event: MouseEvent): void {
    if (this.cameraManager.getCurrentMode() !== 'freeview') return

    const rect = this.renderer.domElement.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )

    const activeCamera = this.cameraManager.getCamera() as THREE.PerspectiveCamera
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, activeCamera)

    const allMeshes: THREE.Mesh[] = []
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        allMeshes.push(object)
      }
    })

    const intersects = raycaster.intersectObjects(allMeshes)
    if (intersects.length > 0) {
      const clickedObject = intersects[0].object as THREE.Mesh
      const point = intersects[0].point
      this.zoomToSelection(clickedObject, point)
    }
  }

  // ============================================================================
  // FREEVIEW MESH SELECTION & ZOOM
  // ============================================================================

  /**
   * In freeview mode, zoom OrbitControls to the bounding box of the
   * clicked mesh (or its parent group).  Walks up the hierarchy to find
   * the nearest meaningful group so that multi-mesh models are framed as
   * a unit.
   */
  private zoomToSelection(clickedMesh: THREE.Object3D, hitPoint: THREE.Vector3): void {
    // Walk up to find a meaningful parent group (skip Scene)
    let target: THREE.Object3D = clickedMesh
    let parent = clickedMesh.parent
    while (parent && !(parent instanceof THREE.Scene)) {
      // If the parent is a Group / Object3D with a name or userData.id, treat it as the unit
      if (parent instanceof THREE.Group || (parent.children.length > 1 && parent.name)) {
        target = parent
        break
      }
      parent = parent.parent
    }

    // Compute world-space bounding box of the selection
    const box = new THREE.Box3().setFromObject(target)
    if (box.isEmpty()) return

    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const freeCamera = this.cameraManager.getFreeViewCamera()
    const fov = freeCamera.fov * (Math.PI / 180)
    // Distance so the bounding sphere roughly fills 60 % of the viewport
    const fitDistance = Math.max(maxDim / (2 * Math.tan(fov / 2)) * 1.4, 2)

    const orbitControls = this.cameraManager.getOrbitControls()

    // Smoothly animate target & camera position
    const startTarget = orbitControls.target.clone()
    const startPos = freeCamera.position.clone()

    // Desired camera position: keep same direction but at fitDistance from center
    const direction = startPos.clone().sub(startTarget).normalize()
    const endPos = center.clone().add(direction.multiplyScalar(fitDistance))

    const duration = 600 // ms
    const startTime = performance.now()

    const animateZoom = () => {
      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / duration, 1)
      // Ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3)

      orbitControls.target.lerpVectors(startTarget, center, ease)
      freeCamera.position.lerpVectors(startPos, endPos, ease)
      orbitControls.update()

      if (t < 1) {
        requestAnimationFrame(animateZoom)
      } else {
        this.showTemporaryMessage(`Selected: ${target.name || target.type} (${target.children.length} children)`, 2000)
      }
    }
    requestAnimationFrame(animateZoom)
  }

  private animate(): void {
    const animate = (currentTime: number) => {
      requestAnimationFrame(animate)
      
      // Start performance monitoring
      performanceMonitor.startFrame()
      
      // Calculate delta time for physics
      const deltaTime = Math.min((currentTime - (this.lastTime || currentTime)) / 1000, 0.1)
      this.lastTime = currentTime
      this.frameCount++
      
      // Skip game updates when paused (but still render)
      if (this.pauseManager.getPaused()) {
        // Still render the scene even when paused
        if (this.retroPostProcessing) {
          this.retroPostProcessing.render()
        } else {
          this.renderer.render(this.scene, this.camera)
        }
        return
      }
      
      // Update controls (camera system manages this internally now)
      // this.controls.update()
      
      // Update camera manager
      this.cameraManager.update(deltaTime)
      
      // Update player controller (physics, movement, collision)
      this.playerController.update(deltaTime)

      // Update dominant light selection for the character shader
      this.updateCharacterLighting()
      
      // Update HUD with current data
      this.updateHUD(deltaTime)
      
      // Update collision system (gravity, collision resolution) - throttled for performance
      performanceMonitor.startCollisionCheck()
      this.collisionSystem.updateDynamicObjects(deltaTime)
      performanceMonitor.endCollisionCheck()
      
      // Update animation system
      this.animationSystem.update(currentTime)

      // Update character skeletal animations
      if (this.playerAnimStateMachine) {
        this.playerAnimStateMachine.setParams(this.getPlayerAnimParams())
        this.playerAnimStateMachine.update(deltaTime)
      }
      this.characterAnimationSystem.update(deltaTime)
      
      // Update shader material uniforms for all ObjectManager objects
      this.objectManager.getAllObjects().forEach((managedObject) => {
        const mesh = managedObject.mesh
        if (mesh.material instanceof THREE.ShaderMaterial && mesh.material.uniforms) {
          // Only update if uniforms exist
          if (mesh.material.uniforms.uTime) {
            mesh.material.uniforms.uTime.value = currentTime * 0.001
          }
          
          // Add type-specific amplitude variations
          if (mesh.material.uniforms.uAmplitude) {
            if (managedObject.id.startsWith('animated-')) {
              const variation = Math.sin(currentTime * 0.0003 + mesh.position.x) * 0.05
              mesh.material.uniforms.uAmplitude.value = 0.2 + variation
            } else if (managedObject.id === 'shader-plane') {
              mesh.material.uniforms.uAmplitude.value = 0.2 + Math.sin(currentTime * 0.0005) * 0.1
            } else if (managedObject.id === 'hologram') {
              mesh.material.uniforms.uAmplitude.value = 0.15 + Math.sin(currentTime * 0.0008) * 0.05
            }
          }
        }
      })

      // Update ocean LOD system
      if (this.oceanLODSystem) {
        this.oceanLODSystem.update(currentTime)
      }

      // Update land system
      if (this.landSystem) {
        this.landSystem.update(currentTime)
      }

      // Update sky system for automatic day/night cycle
      if (this.sky) {
        // Animate sun elevation for day/night cycle (slow rotation)
        const cycleSpeed = 0.0001 // Very slow for realistic effect
        this.skyConfig.elevation = Math.sin(currentTime * cycleSpeed) * 45 + 15 // -30 to 60 degrees
        this.updateSunPosition()
      }
      
      // Update debug stats
      if (this.debugState.stats) {
        this.debugState.stats.update()
      }
      
      // Start render timing
      performanceMonitor.startRender()
      
      // Render with current camera from camera manager
      const currentCamera = this.cameraManager.getCamera()
      
      // TEMP: Debug logging for camera and rendering on mobile
      if (this.frameCount === 1) { // Log on first frame
        console.log(`🎥 First frame render check:`)
        console.log(`  - Current camera: ${currentCamera.name}`)
        console.log(`  - Camera position:`, currentCamera.position)
        console.log(`  - Scene children count: ${this.scene.children.length}`)
        console.log(`  - Renderer size:`, this.renderer.getSize(new THREE.Vector2()))
        console.log(`  - Canvas size: ${this.renderer.domElement.width}x${this.renderer.domElement.height}`)
        console.log(`  - Device type: ${this.deviceType}`)
        console.log(`  - Ambient light:`, this.ambientLight ? 'exists' : 'missing')
        console.log(`  - Key light:`, this.keyLight ? 'exists' : 'missing')
        console.log(`  - Renderer info:`, {
          programs: this.renderer.info.programs?.length || 0,
          memory: this.renderer.info.memory,
          render: this.renderer.info.render
        })
        
        // Check for shader materials
        let shaderCount = 0
        let standardCount = 0
        this.scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            if (obj.material instanceof THREE.ShaderMaterial) shaderCount++
            else if (obj.material instanceof THREE.MeshStandardMaterial) standardCount++
          }
        })
        console.log(`  - Materials: ${shaderCount} shader, ${standardCount} standard`)
        
        if ('zoom' in currentCamera) {
          console.log(`  - Camera zoom: ${(currentCamera as any).zoom}`)
        }
      }
      
      if (this.frameCount % 120 === 0) { // Log every 2 seconds
        console.log(`🎥 Camera: ${currentCamera.name} at`, currentCamera.position)
      }
      
      // Render with retro post-processing
      if (this.retroPostProcessing) {
        this.retroPostProcessing.render(currentCamera)
      } else {
        // Fallback to normal render
        this.renderer.render(this.scene, currentCamera)
      }
      
      // End render timing and performance monitoring
      performanceMonitor.endRender()
      performanceMonitor.endFrame()
    }
    
    animate(performance.now())
  }

  // Legacy methods moved to ConsoleCommands module for better organization
  // Use help() in console to see available commands

  setPlayerPosition(x: number, y: number, z: number): void {
    this.playerController.setPosition(new THREE.Vector3(x, y, z))
  }

  getPlayerStatus(): void {
    // console.log('Player Status:', this.playerController.getStatus())
  }

  togglePlayerDebug(): void {
    if (this.playerController) {
      const isVisible = this.playerController.isDebugWireframeVisible()
      this.playerController.setDebugVisible(!isVisible)
      // console.log(`🎮 Player debug wireframe ${!isVisible ? 'enabled' : 'disabled'}`)
    }
  }

  testCollisionAtPlayerPosition(): void {
    if (this.playerController) {
      const position = this.playerController.getPosition()
      this.collisionSystem.debugCollisionTest(position)
    }
  }

  testPlayerCollision(): void {
    if (this.playerController && this.collisionSystem) {
      const position = this.playerController.getPosition()
      console.log('🧪 Testing player collision detection...')
      console.log(`Player position: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`)
      
      // Test collision at player position
      const collision = this.collisionSystem.checkCollision('player', position)
      console.log('Collision result:', collision)
      
      // Test ground height at player position
      const groundHeight = this.collisionSystem.getGroundHeight(position.x, position.z)
      console.log(`Ground height at (${position.x.toFixed(2)}, ${position.z.toFixed(2)}): ${groundHeight.toFixed(2)}`)
      
      // Test collision at origin
      console.log('🧪 Testing collision at origin (0, 10, 0)...')
      this.collisionSystem.debugCollisionTest(new THREE.Vector3(0, 10, 0))
    }
  }

  testCollisionAtPosition(x: number, y: number, z: number): void {
    const position = new THREE.Vector3(x, y, z)
    this.collisionSystem.debugCollisionTest(position)
  }

  getCollisionSystem(): any {
    return this.collisionSystem
  }

  getLandSystem(): LandSystem | null {
    return this.landSystem
  }

  getHUDSystem(): HUDSystem {
    return this.hudSystem
  }

  /**
   * Update HUD with current game data
   */
  private updateHUD(deltaTime: number): void {
    // Get player data
    const playerStatus = this.playerController.getStatus()
    const playerPosition = this.playerController.getPosition()
    const playerVelocity = this.playerController.getVelocity()
    const terrainHeight = this.collisionSystem.getTerrainHeight(playerPosition.x, playerPosition.z)
    
    // Get input states from player controller
    const inputState = this.playerController.getInputState()
    
    // Get performance data
    const fps = Math.round(1 / deltaTime)
    
    // Get renderer info
    const renderInfo = this.renderer.info
    
    // Prepare HUD data
    const hudData: Partial<HUDData> = {
      // Player state
      position: {
        x: playerPosition.x,
        y: playerPosition.y,
        z: playerPosition.z
      },
      velocity: {
        x: playerVelocity.x,
        y: playerVelocity.y,
        z: playerVelocity.z
      },
      onGround: (playerStatus as any).onGround,
      terrainHeight: terrainHeight,
      
      // Input states
      keys: {
        w: inputState.forward,
        a: inputState.left,
        s: inputState.backward,
        d: inputState.right,
        space: inputState.jump,
        shift: inputState.run,
        c: inputState.camera
      },
      mouse: {
        x: inputState.mouseX || 0,
        y: inputState.mouseY || 0,
        leftButton: inputState.mouseLeft || false,
        rightButton: inputState.mouseRight || false
      },
      
      // Gamepad state
      gamepad: this.inputSystem.isGamepadConnected() ? (() => {
        const gamepadState = this.inputSystem.getGamepadState()!
        return {
          connected: gamepadState.connected,
          id: gamepadState.id,
          leftStick: {
            x: gamepadState.axes.leftStickX,
            y: gamepadState.axes.leftStickY
          },
          rightStick: {
            x: gamepadState.axes.rightStickX,
            y: gamepadState.axes.rightStickY
          },
          buttons: {
            a: gamepadState.buttons.a,
            b: gamepadState.buttons.b,
            x: gamepadState.buttons.x,
            y: gamepadState.buttons.y,
            lb: gamepadState.buttons.lb,
            rb: gamepadState.buttons.rb,
            lt: gamepadState.buttons.lt,
            rt: gamepadState.buttons.rt
          }
        }
      })() : undefined,
      
      // System states
      mode: this.cameraManager.getCurrentMode(),
      fps: fps,
      
      // Performance
      triangles: renderInfo.render.triangles,
      drawCalls: renderInfo.render.calls
    }
    
    // Update HUD
    this.hudSystem.updateData(hudData)
  }

  /**
   * Dispose of the Parameter GUI
   */
  public dispose(): void {
    // Dispose of Parameter Integration
    if (this.parameterIntegration) {
      this.parameterIntegration.dispose()
    }
    
    // Dispose of Parameter GUI
    if (this.parameterGUI) {
      this.parameterGUI.dispose()
    }
    
    // Dispose of Parameter Manager
    if (this.parameterManager) {
      this.parameterManager.dispose()
    }
  }

  /**
   * Show initial help overlay
   */
  private showInitialHelp(): void {
    // Help overlay removed - instructions moved to INSTRUCTIONS.md
    // Users can access instructions via console help() command or read the markdown file
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

const cameraConfig: CameraConfig = {
  fov: 75,
  aspect: window.innerWidth / window.innerHeight,
  near: 0.1, // Balanced to prevent z-fighting while allowing close viewing
  far: 15000, // Increased for large ocean LOD system
  position: new THREE.Vector3(0, 5, 5) // Start higher to see ocean better
}

const rendererConfig: RendererConfig = {
  antialias: true,
  shadows: true
}

const sceneConfig: SceneConfig = {
  backgroundColor: new THREE.Color(0x333333), // Slightly brighter background
  fog: new THREE.Fog(0x333333, 50, 200)
}

// Initialize the integrated app
const app = new IntegratedThreeJSApp(
  document.body,
  cameraConfig,
  rendererConfig,
  sceneConfig
)

// Make it available globally for debugging
;(window as any).threeJSApp = app
;(window as any).debugLandMeshes = () => app.getCollisionSystem().debugLandMeshes()
;(window as any).debugTerrainHeight = (x: number = 0, z: number = 0) => app.getCollisionSystem().debugTerrainHeight(x, z)
;(window as any).getTerrainHeight = (x: number = 0, z: number = 0) => app.getCollisionSystem().getTerrainHeight(x, z)
;(window as any).testTerrainFix = () => app.getCollisionSystem().testTerrainFix()

;(window as any).refreshCollisionMeshes = () => {
  console.log('🔄 Refreshing land meshes for collision...')
  if (app.getLandSystem()) {
    const landMeshes = app.getLandSystem()!.getLandMeshes()
    app.getCollisionSystem().registerLandMeshes(landMeshes)
    console.log(`✅ Refreshed ${landMeshes.length} land meshes for primitive collision`)
  } else {
    console.error('❌ Land system not available')
  }
}
;(window as any).checkCollisionMeshes = () => {
  console.log('🔍 CHECKING LAND MESH STATUS:')
  if (app.getLandSystem()) {
    const landMeshes = app.getLandSystem()!.getLandMeshes()
    console.log(`Found ${landMeshes.length} land meshes:`)
    landMeshes.forEach((mesh, index) => {
      console.log(`  ${index}: ${mesh.userData.id || 'unnamed'} (${mesh.userData.type || 'unknown'}) at (${mesh.position.x.toFixed(1)}, ${mesh.position.y.toFixed(1)}, ${mesh.position.z.toFixed(1)})`)
    })
  }
  
  const collisionSystem = app.getCollisionSystem()
  const landMeshInfos = collisionSystem.getLandMeshes()
  console.log(`CollisionSystem has ${landMeshInfos?.length || 0} registered land meshes`)
  app.getCollisionSystem().debugLandMeshes()
}

// HUD debug functions
;(window as any).toggleHUD = () => {
  app.getHUDSystem().toggle()
  console.log('🖥️ HUD toggled')
}
;(window as any).showHUD = () => {
  app.getHUDSystem().show()
  console.log('🖥️ HUD shown')
}
;(window as any).hideHUD = () => {
  app.getHUDSystem().hide()
  console.log('🖥️ HUD hidden')
}
;(window as any).testCollisionDisplacement = () => {
  console.log('🧪 TESTING COLLISION DISPLACEMENT:')
  ;(window as any).refreshCollisionMeshes()
  setTimeout(() => {
    ;(window as any).debugTerrainHeight(0, 0)
    ;(window as any).debugTerrainHeight(10, 10)
    ;(window as any).debugTerrainHeight(25, 25)
  }, 500)
}

// Register debug methods globally
;(window as any).testPlayerCollision = () => app.testPlayerCollision()
;(window as any).testFallbackGroundHeight = (x: number = 0, z: number = 0) => {
  const collisionSystem = app.getCollisionSystem()
  if (collisionSystem && collisionSystem.getGroundHeightFallback) {
    const height = collisionSystem.getGroundHeightFallback(x, z)
    console.log(`🔧 Fallback ground height at (${x}, ${z}): ${height.toFixed(2)}`)
    return height
  } else {
    console.error('❌ Collision system or fallback method not available')
    return -4.0
  }
}

// Console commands are now handled by the ConsoleCommands module
// Type help() in the console to see available commands

// Example automatic movement (commented out - use console commands instead)
// setTimeout(() => {
//   console.log('🎯 Example: Moving mesh to new position...')
//   // Use moveMesh(id, x, y, z) in console for manual control
//   // Example: moveMesh(0, 0, 15, 0) moves mesh 0 to position (0, 15, 0)
// }, 1000)

// Instructions moved to INSTRUCTIONS.md

// Export types for potential module usage
export { 
  IntegratedThreeJSApp, 
  DeviceType, 
  type InputMethod, 
  type CameraConfig,
  type AnimationConfig,
  type QualityPreset
}

// Export initialization function for titlescreen
export async function initializeGame(isNewGame: boolean = true, onProgress?: (text: string) => void): Promise<void> {
  console.log(`🎮 Initializing game (${isNewGame ? 'New Game' : 'Continue'})...`)
  
  // The app is already initialized as a singleton, just call init
  await app.init(onProgress)
  
  if (!isNewGame) {
    // Load saved game state if continuing
    console.log('📂 Loading saved game state...')
    // You can add load game logic here if needed
  }
}

// Configure logging for development
logger.setDevelopmentMode()

// Enable only specific modules for focused debugging
logger.enableModule(LogModule.PLAYER)
logger.enableModule(LogModule.CAMERA)
// Enable collision debug logging temporarily to diagnose the issue
logger.enableModule(LogModule.COLLISION)