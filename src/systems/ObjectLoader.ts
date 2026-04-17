import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ObjectManager } from './ObjectManager'
import { AnimationSystem } from './AnimationSystem'
import { CollisionSystem } from './CollisionSystem'
import { HeightmapCollider } from './HeightmapCollider'
import { SHADERS, ShaderPath } from '../shaderImports'
import objectPositionsConfig from '../config/objectPositions.json'

// Shader loader utility
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
        const shaderCode = SHADERS[path as ShaderPath]
        this.cache.set(path, shaderCode)
        return shaderCode
      }
      
      // Fallback to fetch for development/custom shaders
      const response = await fetch(path)
      if (!response.ok) {
        throw new Error(`Failed to load shader: ${path}`)
      }
      const shaderCode = await response.text()
      this.cache.set(path, shaderCode)
      return shaderCode
    } catch (error) {
      console.error(`Error loading shader from ${path}:`, error)
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

// Object configuration interfaces
export interface ObjectConfig {
  id: string
  type: 'animated' | 'shader' | 'hologram' | 'custom' | 'model'
  modelPath?: string
  geometry: {
    type: 'box' | 'sphere' | 'cone' | 'cylinder' | 'plane' | 'icosahedron'
    params?: any[]
  }
  material: {
    type: 'shader' | 'standard'
    shaderConfig?: ShaderConfig
    standardConfig?: {
      color?: number
      metalness?: number
      roughness?: number
      emissive?: number
    }
    uniforms?: { [key: string]: { value: any } }
    transparent?: boolean
    side?: THREE.Side
    blending?: THREE.Blending
  }
  transform: {
    position: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number]
  }
  shadow?: {
    cast?: boolean
    receive?: boolean
  }
  animations?: AnimationConfig[]
  userData?: any
}

export interface AnimationConfig {
  type: 'rotation' | 'position' | 'scale' | 'combined'
  duration: number
  easing: string
  loop: boolean
  yoyo?: boolean
  target?: {
    position?: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number]
  }
}

// Easing functions
export class Easing {
  static linear = (t: number): number => t
  static easeInOutCubic = (t: number): number => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1
  static easeOutElastic = (t: number): number => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
  static easeInOutQuad = (t: number): number => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

// Scene configuration
export interface SceneConfig {
  objects: ObjectConfig[]
  environment?: {
    backgroundColor?: number
    fog?: {
      color: number
      near: number
      far: number
    }
  }
}

export interface LoadDefaultSceneOptions {
  deferBackgroundModels?: boolean
  onDeferredTask?: (task: Promise<void>) => void
}

interface ModelLoadConfig {
  id: string
  modelPath: string
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
  useCustomShader?: boolean
  shaderUniforms?: { [key: string]: { value: any } }
  collisionMode?: 'none' | 'heightmap'
  collisionResolution?: number
  onLoaded?: (model: THREE.Group) => void
}

// Main object loader class
export class ObjectLoader {
  private static animationSystem: AnimationSystem
  private static objectManager: ObjectManager
  private static scene: THREE.Scene
  private static gltfLoader: GLTFLoader = new GLTFLoader()
  private static landUniforms: { [key: string]: { value: any } } | null = null
  private static collisionSystem: CollisionSystem | null = null

  public static initialize(scene: THREE.Scene, objectManager: ObjectManager, animationSystem: AnimationSystem, landUniforms?: { [key: string]: { value: any } }, collisionSystem?: CollisionSystem): void {
    this.scene = scene
    this.objectManager = objectManager
    this.animationSystem = animationSystem
    if (landUniforms) {
      this.landUniforms = landUniforms
    }
    if (collisionSystem) {
      this.collisionSystem = collisionSystem
    }
  }

  // Load all objects from configuration
  public static async loadFromConfig(config: SceneConfig): Promise<void> {
    console.log('🔄 Loading objects from configuration...')
    
    for (const objectConfig of config.objects) {
      try {
        await this.createObjectFromConfig(objectConfig)
      } catch (error) {
        console.error(`❌ Failed to create object ${objectConfig.id}:`, error)
      }
    }
    
    console.log(`✅ Loaded ${config.objects.length} objects from configuration`)
  }

  // Load default scene objects
  public static async loadDefaultScene(options: LoadDefaultSceneOptions = {}): Promise<void> {
    console.log('🔄 Loading default scene objects...')
    
    await Promise.all([
      this.loadAnimatedObjects(),
      this.loadShaderObjects(),
      this.loadHologramObject()
    ])

    const backgroundModelsTask = this.loadModelObjects().catch((error) => {
      console.warn('⚠️ Deferred model loading failed:', error)
    })

    if (options.deferBackgroundModels) {
      options.onDeferredTask?.(backgroundModelsTask)
      console.log('✅ Default scene core objects loaded; background model loading started')
      return
    }

    await backgroundModelsTask
    console.log('✅ Default scene objects loaded')
  }

  // Create object from configuration
  private static async createObjectFromConfig(config: ObjectConfig): Promise<void> {
    // Create geometry
    const geometry = this.createGeometry(config.geometry)
    
    // Add random attributes if needed for shaders
    if (config.material.type === 'shader') {
      this.addRandomAttributes(geometry)
    }
    
    // Create material
    const material = await this.createMaterial(config.material)
    
    // Load position from config file if available, otherwise use default
    let position = config.transform.position
    let rotation = config.transform.rotation
    
    // Try to load from committed config file
    try {
      const configPositions = objectPositionsConfig as any
      if (configPositions[config.id]) {
        if (configPositions[config.id].position && Array.isArray(configPositions[config.id].position) && configPositions[config.id].position.length === 3) {
          position = configPositions[config.id].position as [number, number, number]
        }
        if (configPositions[config.id].rotation && Array.isArray(configPositions[config.id].rotation) && configPositions[config.id].rotation.length === 3) {
          rotation = configPositions[config.id].rotation as [number, number, number]
        }
      }
    } catch (error) {
      // Config file not found or invalid, use defaults
      console.warn(`⚠️ Could not load position config for ${config.id}, using defaults`)
    }
    
    // Create object using ObjectManager
    const managedObject = this.objectManager.createObject({
      id: config.id,
      type: config.type,
      geometry: geometry,
      material: material,
      position: new THREE.Vector3(...position),
      rotation: rotation ? new THREE.Euler(...rotation) : undefined,
      scale: config.transform.scale ? new THREE.Vector3(...config.transform.scale) : undefined,
      userData: { ...config.userData, id: config.id, type: config.type },
      persistPosition: true,
      animations: config.animations?.map(anim => anim.type) || []
    })
    
    const mesh = managedObject.mesh
    
    // Set shadow properties
    if (config.shadow) {
      mesh.castShadow = config.shadow.cast ?? false
      mesh.receiveShadow = config.shadow.receive ?? false
    }
    
    // Create animations
    if (config.animations) {
      this.createAnimations(mesh, config.animations)
    }
    
    console.log(`✅ Created object: ${config.id}`)
  }

  // Create geometry from configuration
  private static createGeometry(geometryConfig: ObjectConfig['geometry']): THREE.BufferGeometry {
    const { type, params = [] } = geometryConfig
    
    switch (type) {
      case 'box':
        return new THREE.BoxGeometry(...(params as [number?, number?, number?]))
      case 'sphere':
        return new THREE.SphereGeometry(...(params as [number?, number?, number?]))
      case 'cone':
        return new THREE.ConeGeometry(...(params as [number?, number?, number?]))
      case 'cylinder':
        return new THREE.CylinderGeometry(...(params as [number?, number?, number?, number?]))
      case 'plane':
        return new THREE.PlaneGeometry(...(params as [number?, number?, number?, number?]))
      case 'icosahedron':
        return new THREE.IcosahedronGeometry(...(params as [number?, number?]))
      default:
        return new THREE.BoxGeometry(1, 1, 1)
    }
  }

  // Create material from configuration
  private static async createMaterial(materialConfig: ObjectConfig['material']): Promise<THREE.Material> {
    if (materialConfig.type === 'shader' && materialConfig.shaderConfig) {
      // Load shader files
      const { vertex, fragment } = await ShaderLoader.loadShaderPair(materialConfig.shaderConfig)
      
      return new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: materialConfig.uniforms || {
          uTime: { value: 0 },
          uAmplitude: { value: 0.2 },
          uColorA: { value: new THREE.Color(0xff0040) },
          uColorB: { value: new THREE.Color(0x0040ff) }
        },
        transparent: materialConfig.transparent ?? false,
        side: materialConfig.side ?? THREE.FrontSide,
        blending: materialConfig.blending ?? THREE.NormalBlending
      })
    } else {
      // Standard material
      const config = materialConfig.standardConfig || {}
      return new THREE.MeshStandardMaterial({
        color: config.color ?? 0xff0040,
        metalness: config.metalness ?? 0.1,
        roughness: config.roughness ?? 0.4,
        emissive: config.emissive ?? 0x000000
      })
    }
  }

  // Add random attributes to geometry for shader effects
  private static addRandomAttributes(geometry: THREE.BufferGeometry): void {
    const positionAttribute = geometry.getAttribute('position')
    const randomValues = new Float32Array(positionAttribute.count)
    
    for (let i = 0; i < randomValues.length; i++) {
      randomValues[i] = Math.random()
    }
    
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randomValues, 1))
  }

  // Create animations for object
  private static createAnimations(mesh: THREE.Object3D, animationConfigs: AnimationConfig[]): void {
    animationConfigs.forEach((config, index) => {
      const easingFunction = this.getEasingFunction(config.easing)
      
      switch (config.type) {
        case 'rotation':
          this.createRotationAnimation(mesh, config, easingFunction)
          break
        case 'position':
          this.createPositionAnimation(mesh, config, easingFunction)
          break
        case 'scale':
          this.createScaleAnimation(mesh, config, easingFunction)
          break
        case 'combined':
          this.createCombinedAnimation(mesh, config, easingFunction)
          break
      }
    })
  }

  // Animation creation methods
  private static createRotationAnimation(mesh: THREE.Object3D, config: AnimationConfig, easing: (t: number) => number): void {
    const targetRotation = config.target?.rotation || [0, Math.PI * 2, 0]
    const animation = this.animationSystem.createAnimation(mesh, {
      duration: config.duration,
      easing: easing,
      loop: config.loop
    })
    
    animation.to({ rotation: new THREE.Euler(...targetRotation) }).start()
    this.animationSystem.addAnimation(animation)
  }

  private static createPositionAnimation(mesh: THREE.Object3D, config: AnimationConfig, easing: (t: number) => number): void {
    const baseY = mesh.userData.baseY || mesh.position.y
    const targetPosition = config.target?.position || [mesh.position.x, baseY + 2, mesh.position.z]
    const animation = this.animationSystem.createAnimation(mesh, {
      duration: config.duration,
      easing: easing,
      loop: config.loop,
      yoyo: config.yoyo ?? false
    })
    
    animation.to({ position: new THREE.Vector3(...targetPosition) }).start()
    this.animationSystem.addAnimation(animation)
  }

  private static createScaleAnimation(mesh: THREE.Object3D, config: AnimationConfig, easing: (t: number) => number): void {
    const targetScale = config.target?.scale || [1.5, 1.5, 1.5]
    const animation = this.animationSystem.createAnimation(mesh, {
      duration: config.duration,
      easing: easing,
      loop: config.loop,
      yoyo: config.yoyo ?? false
    })
    
    animation.to({ scale: new THREE.Vector3(...targetScale) }).start()
    this.animationSystem.addAnimation(animation)
  }

  private static createCombinedAnimation(mesh: THREE.Object3D, config: AnimationConfig, easing: (t: number) => number): void {
    // Create multiple animations for combined effect
    if (config.target?.rotation) {
      this.createRotationAnimation(mesh, { ...config, type: 'rotation' }, easing)
    }
    if (config.target?.position) {
      this.createPositionAnimation(mesh, { ...config, type: 'position' }, easing)
    }
    if (config.target?.scale) {
      this.createScaleAnimation(mesh, { ...config, type: 'scale' }, easing)
    }
  }

  // Get easing function by name
  private static getEasingFunction(easingName: string): (t: number) => number {
    switch (easingName) {
      case 'linear': return Easing.linear
      case 'easeInOutCubic': return Easing.easeInOutCubic
      case 'easeOutElastic': return Easing.easeOutElastic
      case 'easeInOutQuad': return Easing.easeInOutQuad
      default: return Easing.linear
    }
  }

  // Load animated objects (4 meshes with different shaders)
  private static async loadAnimatedObjects(): Promise<void> {
    const animatedConfigs: ObjectConfig[] = [
      {
        id: 'animated-0',
        type: 'animated',
        geometry: { type: 'box', params: [1, 1, 1] },
        material: {
          type: 'shader',
          shaderConfig: {
            vertexPath: 'src/shaders/noise-vertex.glsl',
            fragmentPath: 'src/shaders/noise-fragment.glsl'
          },
          uniforms: {
            uTime: { value: 0 },
            uAmplitude: { value: 0.2 },
            uColorA: { value: new THREE.Color(0xff0040) },
            uColorB: { value: new THREE.Color(0x0040ff) }
          },
          side: THREE.DoubleSide
        },
        transform: { position: [-4.5, 10, 0] },
        animations: [
          {
            type: 'rotation',
            duration: 2000,
            easing: 'linear',
            loop: true,
            target: { rotation: [0, Math.PI * 2, 0] }
          }
        ],
        userData: { baseY: 10 }
      },
      {
        id: 'animated-1',
        type: 'animated',
        geometry: { type: 'sphere', params: [0.5, 32, 32] },
        material: {
          type: 'shader',
          shaderConfig: {
            vertexPath: 'src/shaders/spiral-vertex.glsl',
            fragmentPath: 'src/shaders/spiral-fragment.glsl'
          },
          uniforms: {
            uTime: { value: 0 },
            uAmplitude: { value: 0.2 },
            uColorA: { value: new THREE.Color(0xff0040) },
            uColorB: { value: new THREE.Color(0x0040ff) }
          },
          side: THREE.DoubleSide
        },
        transform: { position: [-1.5, 30, 0] }, // Pre-moved up by 20 units
        animations: [
          {
            type: 'position',
            duration: 1000,
            easing: 'easeOutElastic',
            loop: true,
            yoyo: true,
            target: { position: [-1.5, 32, 0] }
          }
        ],
        userData: { baseY: 30 }
      },
      {
        id: 'animated-2',
        type: 'animated',
        geometry: { type: 'cone', params: [0.5, 1, 8] },
        material: {
          type: 'shader',
          shaderConfig: {
            vertexPath: 'src/shaders/pulse-vertex.glsl',
            fragmentPath: 'src/shaders/pulse-fragment.glsl'
          },
          uniforms: {
            uTime: { value: 0 },
            uAmplitude: { value: 0.2 },
            uColorA: { value: new THREE.Color(0xff0040) },
            uColorB: { value: new THREE.Color(0x0040ff) }
          },
          side: THREE.DoubleSide
        },
        transform: { position: [1.5, 30, 0] }, // Pre-moved up by 20 units
        animations: [
          {
            type: 'scale',
            duration: 1500,
            easing: 'easeInOutCubic',
            loop: true,
            yoyo: true,
            target: { scale: [1.5, 1.5, 1.5] }
          }
        ],
        userData: { baseY: 30 }
      },
      {
        id: 'animated-3',
        type: 'animated',
        geometry: { type: 'cylinder', params: [0.3, 0.3, 1, 16] },
        material: {
          type: 'shader',
          shaderConfig: {
            vertexPath: 'src/shaders/crystal-vertex.glsl',
            fragmentPath: 'src/shaders/crystal-fragment.glsl'
          },
          uniforms: {
            uTime: { value: 0 },
            uAmplitude: { value: 0.2 },
            uColorA: { value: new THREE.Color(0xff0040) },
            uColorB: { value: new THREE.Color(0x0040ff) }
          },
          side: THREE.DoubleSide
        },
        transform: { position: [4.5, 10, 0] },
        animations: [
          {
            type: 'combined',
            duration: 3000,
            easing: 'linear',
            loop: true,
            target: {
              rotation: [Math.PI * 2, Math.PI * 2, 0],
              scale: [0.5, 0.5, 0.5]
            }
          }
        ],
        userData: { baseY: 10 }
      }
    ]

    for (const config of animatedConfigs) {
      try {
        await this.createObjectFromConfig(config)
      } catch (error) {
        console.warn(`⚠️ Failed to create ${config.id}, using fallback`, error)
        await this.createFallbackObject(config)
      }
    }
  }

  // Load shader objects
  private static async loadShaderObjects(): Promise<void> {
    const shaderConfig: ObjectConfig = {
      id: 'shader-plane',
      type: 'shader',
      geometry: { type: 'plane', params: [4, 4, 32, 32] },
      material: {
        type: 'shader',
        shaderConfig: {
          vertexPath: 'src/shaders/vertex.glsl',
          fragmentPath: 'src/shaders/fragment.glsl'
        },
        uniforms: {
          uTime: { value: 0 },
          uAmplitude: { value: 0.2 },
          uColorA: { value: new THREE.Color(0xff0040) },
          uColorB: { value: new THREE.Color(0x0040ff) }
        },
        side: THREE.DoubleSide,
        transparent: true
      },
      transform: { 
        position: [-6, 0, 0],
        rotation: [-Math.PI * 0.25, 0, 0]
      }
    }

    try {
      await this.createObjectFromConfig(shaderConfig)
    } catch (error) {
      console.warn(`⚠️ Failed to create shader plane, using fallback`, error)
      await this.createFallbackObject(shaderConfig)
    }
  }

  // Load hologram object
  private static async loadHologramObject(): Promise<void> {
    const hologramConfig: ObjectConfig = {
      id: 'hologram',
      type: 'hologram',
      geometry: { type: 'icosahedron', params: [1, 4] },
      material: {
        type: 'shader',
        shaderConfig: {
          vertexPath: 'src/shaders/hologram-vertex.glsl',
          fragmentPath: 'src/shaders/hologram-fragment.glsl'
        },
        uniforms: {
          uTime: { value: 0 },
          uAmplitude: { value: 0.15 },
          uColorA: { value: new THREE.Color(0x00ff88) },
          uColorB: { value: new THREE.Color(0xff8800) }
        },
        side: THREE.DoubleSide,
        transparent: true,
        blending: THREE.AdditiveBlending
      },
      transform: { position: [6, 0, 0] },
      shadow: { cast: false, receive: false },
      animations: [
        {
          type: 'combined',
          duration: 4000,
          easing: 'easeInOutCubic',
          loop: true,
          yoyo: true,
          target: {
            position: [6, 3, 0],
            rotation: [0, Math.PI, 0]
          }
        },
        {
          type: 'rotation',
          duration: 6000,
          easing: 'linear',
          loop: true,
          target: { rotation: [Math.PI * 2, Math.PI * 2, Math.PI * 2] }
        }
      ]
    }

    await this.createObjectFromConfig(hologramConfig)
  }

  // Create fallback object with standard material
  private static async createFallbackObject(config: ObjectConfig): Promise<void> {
    const fallbackConfig: ObjectConfig = {
      ...config,
      id: `${config.id}-fallback`,
      material: {
        type: 'standard',
        standardConfig: {
          color: 0xff0040,
          metalness: 0.1,
          roughness: 0.4,
          emissive: 0x330011
        }
      }
    }

    await this.createObjectFromConfig(fallbackConfig)
  }

  // Load GLTF/GLB model with optional shader material
  public static async loadGLTFModel(
    modelPath: string,
    id: string,
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    useCustomShader: boolean = false,
    shaderUniforms?: { [key: string]: { value: any } }
  ): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        modelPath,
        async (gltf) => {
          const model = gltf.scene
          model.position.set(...position)
          model.rotation.set(...rotation)
          model.scale.set(...scale)
          model.userData = { id, type: 'model', modelPath }
          
          // Enable shadows and apply materials to all meshes (including nested)
          // Collect meshes synchronously first, then await async shader work
          // (traverse does NOT await async callbacks)
          const meshChildren: THREE.Mesh[] = []
          model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true
              child.receiveShadow = true
              meshChildren.push(child)
            }
          })

          // Apply materials — await all shader material creations before resolving
          await Promise.all(meshChildren.map(async (child) => {
            const originalMaterial = child.material
            
            if (useCustomShader) {
              // Apply custom shader material with land-like lighting
              const shaderMaterial = await this.createModelShaderMaterial(originalMaterial, shaderUniforms || {})
              child.material = shaderMaterial
            } else {
              // Use standard material
              if (Array.isArray(originalMaterial)) {
                child.material = originalMaterial.map(mat => {
                  const color = mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial
                    ? mat.color.clone()
                    : new THREE.Color(0x808080)
                  
                  return new THREE.MeshStandardMaterial({
                    name: mat.name,
                    color: color.getHex() === 0x000000 ? 0x808080 : color,
                    metalness: 0.1,
                    roughness: 0.8,
                    side: mat.side || THREE.FrontSide,
                    transparent: mat.transparent || false,
                    opacity: mat.opacity || 1
                  })
                })
              } else {
                const color = originalMaterial instanceof THREE.MeshStandardMaterial || originalMaterial instanceof THREE.MeshPhysicalMaterial
                  ? originalMaterial.color.clone()
                  : new THREE.Color(0x808080)
                
                child.material = new THREE.MeshStandardMaterial({
                  name: originalMaterial.name,
                  color: color.getHex() === 0x000000 ? 0x808080 : color,
                  metalness: 0.1,
                  roughness: 0.8,
                  side: originalMaterial.side || THREE.FrontSide,
                  transparent: originalMaterial.transparent || false,
                  opacity: originalMaterial.opacity || 1
                })
              }
            }
          }))
          
          // Apply the first embedded animation clip at frame 0 so the model
          // shows its authored rest pose (e.g. standing) instead of the raw
          // skeleton bind pose (T-pose).
          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model)
            const clip = gltf.animations[0]
            const action = mixer.clipAction(clip)
            action.play()
            // Force one evaluation to bake the pose onto the bones.
            // Use a tiny time offset so we sample the first real keyframe.
            mixer.update(0)
            // Do NOT call action.stop() — that would revert bones to bind pose.
            // The mixer is not ticked in the render loop, so the pose stays frozen.
            // Store animations for later use (e.g. pose cycling)
            model.userData.animations = gltf.animations
            model.userData._poseMixer = mixer // keep reference so GC doesn't collect it
            console.log(`🎬 Applied rest pose from embedded clip "${clip.name}" (${gltf.animations.length} clip(s) total)`)
          }

          // Add to scene
          this.scene.add(model)
          
          console.log(`✅ Loaded model: ${id} from ${modelPath}`)
          console.log(`📦 Model bounds:`, new THREE.Box3().setFromObject(model))
          resolve(model)
        },
        (progress) => {
          const percentComplete = (progress.loaded / progress.total) * 100
          console.log(`Loading ${id}: ${percentComplete.toFixed(2)}%`)
        },
        (error) => {
          console.error(`❌ Failed to load model ${id} from ${modelPath}:`, error)
          reject(error)
        }
      )
    })
  }

  // Create shader material for models that mimics land lighting
  private static async createModelShaderMaterial(
    originalMaterial: THREE.Material | THREE.Material[],
    uniforms: { [key: string]: { value: any } }
  ): Promise<THREE.ShaderMaterial> {
    // Extract color from original material and brighten it so the character
    // stands out against darker environment colours and shadows.
    let baseColor = new THREE.Color(0xcccccc) // fallback: light grey
    const mat = Array.isArray(originalMaterial) ? originalMaterial[0] : originalMaterial
    if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
      baseColor = mat.color.clone()
      // Lift the colour toward white – keeps the hue but pushes brightness up
      baseColor.lerp(new THREE.Color(1.0, 1.0, 1.0), 0.45)
    }

    // Load default-character shaders (lightweight — no common lighting dependency)
    const shaders = await ShaderLoader.loadShaderPair({
      vertexPath: 'src/shaders/default-character-vertex.glsl',
      fragmentPath: 'src/shaders/default-character-fragment.glsl'
    })

    // Character shader uses its own minimal uniform set.
    // We still spread the caller's uniforms so land-lighting values are present
    // for any future multi-pass work, but the character shaders will ignore them.
    return new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        // ---- model colour ----
        uModelColor:      { value: baseColor },

        // ---- primary dominant light ----
        uLightDir:        { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        uLightColor:      { value: new THREE.Color(1.0, 1.0, 0.95) },
        uLightIntensity:  { value: 1.0 },

        // ---- secondary light (off by default) ----
        uLight2Dir:       { value: new THREE.Vector3(-0.4, 0.3, -0.6).normalize() },
        uLight2Color:     { value: new THREE.Color(0.6, 0.7, 1.0) },
        uLight2Intensity: { value: 0.0 },

        // ---- shading ----
        uAmbient:         { value: 0.55 },
        uBrightBoost:     { value: 0.18 },
        uBands:           { value: 3.0 },

        // ---- rim / back light ----
        uRimColor:        { value: new THREE.Color(1.0, 1.0, 1.0) },
        uRimStrength:     { value: 0.45 },
        uRimPower:        { value: 2.5 },

        // ---- specular ----
        uSpecStrength:    { value: 0.15 },
        uSpecPower:       { value: 32.0 },

        // ---- outline ----
        uOutlineWidth:    { value: 0.38 },
        uOutlineColor:    { value: new THREE.Color(0.08, 0.06, 0.12) }
      },
      vertexShader: shaders.vertex,
      fragmentShader: shaders.fragment,
      side: THREE.DoubleSide
    })
  }

  private static async loadModelSceneObject(config: ModelLoadConfig): Promise<void> {
    const model = await this.loadGLTFModel(
      config.modelPath,
      config.id,
      config.position,
      config.rotation,
      config.scale,
      config.useCustomShader ?? false,
      config.shaderUniforms
    )

    config.onLoaded?.(model)

    if (config.collisionMode === 'heightmap' && this.collisionSystem) {
      const resolution = config.collisionResolution ?? 64
      const heightmap = await HeightmapCollider.fromObject(model, resolution, config.id)
      this.collisionSystem.registerHeightmap(heightmap)
      return
    }

    if (config.collisionMode === 'none') {
      console.log(`⏭️ Skipping auto collision bake for background model: ${config.id}`)
    }
  }

  // Load model objects (background props — level terrain handled by loadLevelModel)
  private static async loadModelObjects(): Promise<void> {
    // grid-01 and landscape-island replaced by level_01.glb (loaded via loadLevelModel)
    console.log('✅ Background model objects loaded (level terrain loaded separately)')
  }

  /**
   * Load level_01.glb as the main terrain/environment model.
   *
   * • Meshes whose name starts with "COL" or "collision" (case-insensitive)
   *   are hidden and baked into a HeightmapCollider for O(1) ground queries.
   * • Materials named "land" get the full land ShaderMaterial (earth texture).
   * • Materials named "concrete" get a default-light ShaderMaterial.
   * • Other materials are kept as-is (MeshStandardMaterial).
   *
   * Returns { collisionMeshes, visibleMeshes } so the caller can register
   * them with cameraManager for clipping prevention.
   */
  public static async loadLevelModel(): Promise<{
    collisionMeshes: THREE.Mesh[]
    visibleMeshes: THREE.Mesh[]
  }> {
    const collisionMeshes: THREE.Mesh[] = []
    const visibleMeshes: THREE.Mesh[] = []

    const model = await this.loadGLTFModel(
      '/models/environments/level_01.glb',
      'level-01',
      [0, 0, 0],
      [0, 0, 0],
      [1, 1, 1],
      false // don't use the default character shader
    )

    // ── Build shader materials lazily (once per type) ────────────────────────
    let landMaterial: THREE.ShaderMaterial | null = null
    let concreteMaterial: THREE.ShaderMaterial | null = null
    let sandMaterial: THREE.ShaderMaterial | null = null
    let woodMaterial: THREE.ShaderMaterial | null = null

    const getLandMaterial = async (): Promise<THREE.ShaderMaterial> => {
      if (landMaterial) return landMaterial

      const shaders = await ShaderLoader.loadShaderPair({
        vertexPath: 'src/shaders/land-vertex.glsl',
        fragmentPath: 'src/shaders/land-fragment.glsl',
      })

      const u = this.landUniforms || {}
      landMaterial = new THREE.ShaderMaterial({
        vertexShader: shaders.vertex,
        fragmentShader: shaders.fragment,
        uniforms: {
          ...THREE.UniformsLib.lights,
          uTime:              u.uTime              ?? { value: 0 },
          uElevation:         u.uElevation         ?? { value: 8.0 },
          uRoughness:         u.uRoughness         ?? { value: 1.2 },
          uScale:             u.uScale             ?? { value: 0.8 },
          uLandColor:         u.uLandColor         ?? { value: new THREE.Color(0x4a7c59) },
          uRockColor:         u.uRockColor         ?? { value: new THREE.Color(0x8b7355) },
          uSandColor:         u.uSandColor         ?? { value: new THREE.Color(0xc2b280) },
          uMoisture:          u.uMoisture          ?? { value: 0.3 },
          uIslandRadius:      u.uIslandRadius      ?? { value: 35.0 },
          uCoastSmoothness:   u.uCoastSmoothness   ?? { value: 8.0 },
          uSeaLevel:          u.uSeaLevel          ?? { value: -4.0 },
          // Lighting — shared references
          uSunDirection:       u.uSunDirection       ?? { value: new THREE.Vector3(0.5, 0.8, 0.2) },
          uSunColor:           u.uSunColor           ?? { value: new THREE.Color(1, 1, 0.9) },
          uSunIntensity:       u.uSunIntensity       ?? { value: 1.0 },
          uSpotlightPosition:  u.uSpotlightPosition  ?? { value: new THREE.Vector3(0, 30, 0) },
          uSpotlightDirection: u.uSpotlightDirection ?? { value: new THREE.Vector3(0, -1, 0) },
          uSpotlightColor:     u.uSpotlightColor     ?? { value: new THREE.Color(1, 1, 1) },
          uSpotlightIntensity: u.uSpotlightIntensity ?? { value: 0.0 },
          uSpotlightAngle:     u.uSpotlightAngle     ?? { value: Math.PI / 8 },
          uSpotlightPenumbra:  u.uSpotlightPenumbra  ?? { value: 0.3 },
          uSpotlightDistance:  u.uSpotlightDistance  ?? { value: 80 },
        },
        lights: true,
        side: THREE.FrontSide,
      })
      return landMaterial
    }

    const getConcreteMaterial = async (): Promise<THREE.ShaderMaterial> => {
      if (concreteMaterial) return concreteMaterial

      const shaders = await ShaderLoader.loadShaderPair({
        vertexPath: 'src/shaders/concrete-vertex.glsl',
        fragmentPath: 'src/shaders/concrete-fragment.glsl',
      })

      const u = this.landUniforms || {}
      concreteMaterial = new THREE.ShaderMaterial({
        vertexShader: shaders.vertex,
        fragmentShader: shaders.fragment,
        uniforms: {
          ...THREE.UniformsLib.lights,
          uConcreteColor:      { value: new THREE.Color(0xb0aba6) },
          uConcreteDarkColor:  { value: new THREE.Color(0x7a7572) },
          // Lighting — shared references
          uSunDirection:       u.uSunDirection       ?? { value: new THREE.Vector3(0.5, 0.8, 0.2) },
          uSunColor:           u.uSunColor           ?? { value: new THREE.Color(1, 1, 0.9) },
          uSunIntensity:       u.uSunIntensity       ?? { value: 1.0 },
          uSpotlightPosition:  u.uSpotlightPosition  ?? { value: new THREE.Vector3(0, 30, 0) },
          uSpotlightDirection: u.uSpotlightDirection ?? { value: new THREE.Vector3(0, -1, 0) },
          uSpotlightColor:     u.uSpotlightColor     ?? { value: new THREE.Color(1, 1, 1) },
          uSpotlightIntensity: u.uSpotlightIntensity ?? { value: 0.0 },
          uSpotlightAngle:     u.uSpotlightAngle     ?? { value: Math.PI / 8 },
          uSpotlightPenumbra:  u.uSpotlightPenumbra  ?? { value: 0.3 },
          uSpotlightDistance:  u.uSpotlightDistance  ?? { value: 80 },
        },
        lights: true,
        side: THREE.FrontSide,
      })
      return concreteMaterial
    }

    const getSandMaterial = async (): Promise<THREE.ShaderMaterial> => {
      if (sandMaterial) return sandMaterial

      const shaders = await ShaderLoader.loadShaderPair({
        vertexPath: 'src/shaders/sand-vertex.glsl',
        fragmentPath: 'src/shaders/sand-fragment.glsl',
      })

      const u = this.landUniforms || {}
      sandMaterial = new THREE.ShaderMaterial({
        vertexShader: shaders.vertex,
        fragmentShader: shaders.fragment,
        uniforms: {
          ...THREE.UniformsLib.lights,
          uSandColor:          { value: new THREE.Color(0xd4b896) },
          uSandDarkColor:      { value: new THREE.Color(0xa08055) },
          // Lighting — shared references
          uSunDirection:       u.uSunDirection       ?? { value: new THREE.Vector3(0.5, 0.8, 0.2) },
          uSunColor:           u.uSunColor           ?? { value: new THREE.Color(1, 1, 0.9) },
          uSunIntensity:       u.uSunIntensity       ?? { value: 1.0 },
          uSpotlightPosition:  u.uSpotlightPosition  ?? { value: new THREE.Vector3(0, 30, 0) },
          uSpotlightDirection: u.uSpotlightDirection ?? { value: new THREE.Vector3(0, -1, 0) },
          uSpotlightColor:     u.uSpotlightColor     ?? { value: new THREE.Color(1, 1, 1) },
          uSpotlightIntensity: u.uSpotlightIntensity ?? { value: 0.0 },
          uSpotlightAngle:     u.uSpotlightAngle     ?? { value: Math.PI / 8 },
          uSpotlightPenumbra:  u.uSpotlightPenumbra  ?? { value: 0.3 },
          uSpotlightDistance:  u.uSpotlightDistance  ?? { value: 80 },
        },
        lights: true,
        side: THREE.FrontSide,
      })
      return sandMaterial
    }

    const getWoodMaterial = async (): Promise<THREE.ShaderMaterial> => {
      if (woodMaterial) return woodMaterial

      const shaders = await ShaderLoader.loadShaderPair({
        vertexPath: 'src/shaders/wood-vertex.glsl',
        fragmentPath: 'src/shaders/wood-fragment.glsl',
      })

      const u = this.landUniforms || {}
      woodMaterial = new THREE.ShaderMaterial({
        vertexShader: shaders.vertex,
        fragmentShader: shaders.fragment,
        uniforms: {
          ...THREE.UniformsLib.lights,
          uWoodColor:          { value: new THREE.Color(0xc8864e) },
          uWoodDarkColor:      { value: new THREE.Color(0x7d4e2a) },
          // Lighting — shared references
          uSunDirection:       u.uSunDirection       ?? { value: new THREE.Vector3(0.5, 0.8, 0.2) },
          uSunColor:           u.uSunColor           ?? { value: new THREE.Color(1, 1, 0.9) },
          uSunIntensity:       u.uSunIntensity       ?? { value: 1.0 },
          uSpotlightPosition:  u.uSpotlightPosition  ?? { value: new THREE.Vector3(0, 30, 0) },
          uSpotlightDirection: u.uSpotlightDirection ?? { value: new THREE.Vector3(0, -1, 0) },
          uSpotlightColor:     u.uSpotlightColor     ?? { value: new THREE.Color(1, 1, 1) },
          uSpotlightIntensity: u.uSpotlightIntensity ?? { value: 0.0 },
          uSpotlightAngle:     u.uSpotlightAngle     ?? { value: Math.PI / 8 },
          uSpotlightPenumbra:  u.uSpotlightPenumbra  ?? { value: 0.3 },
          uSpotlightDistance:  u.uSpotlightDistance  ?? { value: 80 },
        },
        lights: true,
        side: THREE.FrontSide,
      })
      return woodMaterial
    }

    // ── Classify meshes ──────────────────────────────────────────────────────
    const meshChildren: THREE.Mesh[] = []
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) meshChildren.push(child)
    })

    for (const mesh of meshChildren) {
      const name = mesh.name.toLowerCase()

      // ── Collision-only meshes (COL_ prefix or "collision" prefix) ───────
      // Use 'col_' (with underscore) to avoid capturing 'Column' nodes.
      if (name.startsWith('col_') || name.startsWith('collision')) {
        mesh.visible = false
        mesh.userData = { ...mesh.userData, type: 'land', landType: 'box', id: mesh.name }
        collisionMeshes.push(mesh)
        continue
      }

      // ── Material replacement ─────────────────────────────────────────────
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const replacedMats: THREE.Material[] = []

      for (const mat of materials) {
        const matName = mat.name.toLowerCase()

        if (matName === 'land') {
          replacedMats.push(await getLandMaterial())
        } else if (matName === 'concrete') {
          replacedMats.push(await getConcreteMaterial())
        } else if (matName === 'sand') {
          replacedMats.push(await getSandMaterial())
        } else if (matName === 'wood') {
          replacedMats.push(await getWoodMaterial())
        } else {
          // Keep original material as MeshStandardMaterial
          if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
            replacedMats.push(mat)
          } else {
            replacedMats.push(new THREE.MeshStandardMaterial({
              color: 0x808080,
              metalness: 0.1,
              roughness: 0.8,
            }))
          }
        }
      }

      mesh.material = replacedMats.length === 1 ? replacedMats[0] : replacedMats
      mesh.castShadow = true
      mesh.receiveShadow = true
      visibleMeshes.push(mesh)
    }

    // ── Classify collision meshes: ground vs wall/obstacle ─────────────────
    // Flat/wide meshes → heightmap (terrain, ramps, stairs).
    // Tall/narrow meshes → AABB wall colliders (trees, walls, buildings).
    // Naming convention override: col_wall_*, col_stair_*, col_ground_*
    const groundMeshes: THREE.Mesh[] = []
    const wallMeshes: THREE.Mesh[] = []
    const stairMeshes: THREE.Mesh[] = [] // walkable wall colliders

    for (const cm of collisionMeshes) {
      cm.updateMatrixWorld(true)
      const name = cm.name.toLowerCase()

      // Explicit naming overrides
      if (name.includes('ground') || name.includes('floor') || name.includes('terrain')) {
        groundMeshes.push(cm)
        continue
      }
      if (name.includes('stair') || name.includes('ramp') || name.includes('platform')) {
        stairMeshes.push(cm)
        continue
      }
      if (name.includes('wall') || name.includes('tree') || name.includes('fence') || name.includes('pillar')) {
        wallMeshes.push(cm)
        continue
      }

      // Auto-classify by aspect ratio: tall & narrow → wall, flat & wide → ground
      const cmBox = new THREE.Box3().setFromObject(cm)
      const cmSize = cmBox.getSize(new THREE.Vector3())
      const footprint = Math.max(cmSize.x, cmSize.z)
      const heightRatio = cmSize.y / Math.max(footprint, 0.01)

      if (heightRatio > 1.2) {
        // Taller than wide → wall / obstacle
        wallMeshes.push(cm)
      } else {
        groundMeshes.push(cm)
      }
    }

    console.log(`🧱 Collision classification: ${groundMeshes.length} ground, ${wallMeshes.length} wall, ${stairMeshes.length} stair/ramp`)

    // ── Bake ground meshes into a heightmap for O(1) ground queries ──────
    if (groundMeshes.length > 0 && this.collisionSystem) {
      let totalTris = 0
      for (const cm of groundMeshes) {
        const geo = cm.geometry
        if (geo.index) {
          totalTris += geo.index.count / 3
        } else {
          const pos = geo.getAttribute('position')
          if (pos) totalTris += pos.count / 3
        }
      }
      console.log(`🗺️ Baking heightmap from ${groundMeshes.length} ground meshes (${totalTris} triangles)…`)

      // Temporarily make collision meshes visible so the raycaster can hit them
      for (const cm of groundMeshes) cm.visible = true

      // Create a temporary group containing only the collision meshes so
      // HeightmapCollider doesn't raycast decorative geometry.
      const collisionGroup = new THREE.Group()
      collisionGroup.name = 'level-01-collision-bake'
      const originalParents = groundMeshes.map(cm => cm.parent)
      for (const cm of groundMeshes) collisionGroup.add(cm)
      this.scene.add(collisionGroup)
      collisionGroup.updateMatrixWorld(true)

      // Resolution 64 → ~64×46 = ~3k raycasts. Bake stays under a few
      // seconds even for 40k-triangle collision meshes.
      const heightmap = await HeightmapCollider.fromObject(collisionGroup, 64, 'level-01')
      this.collisionSystem.registerHeightmap(heightmap)

      // Restore meshes back to their original parent (the GLB model)
      for (let i = 0; i < groundMeshes.length; i++) {
        const parent = originalParents[i]
        if (parent) parent.add(groundMeshes[i])
      }
      this.scene.remove(collisionGroup)

      for (const cm of groundMeshes) cm.visible = false
    }

    // ── Register wall / obstacle meshes as AABB colliders ────────────────
    if (this.collisionSystem) {
      if (wallMeshes.length > 0) {
        this.collisionSystem.registerWallMeshes(wallMeshes, false)
      }
      if (stairMeshes.length > 0) {
        this.collisionSystem.registerWallMeshes(stairMeshes, true)
      }
    }

    // Hide all collision meshes
    for (const cm of collisionMeshes) cm.visible = false

    const bbox = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3()
    bbox.getSize(size)
    console.log(`🏗️ level_01.glb loaded — ${meshChildren.length} meshes, ${collisionMeshes.length} collision-only (${groundMeshes.length} ground + ${wallMeshes.length} wall + ${stairMeshes.length} stair), size (${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)})`)

    return { collisionMeshes, visibleMeshes }
  }

  // Get default scene configuration
  public static getDefaultSceneConfig(): SceneConfig {
    return {
      objects: [], // Will be loaded via loadDefaultScene()
      environment: {
        backgroundColor: 0x333333,
        fog: {
          color: 0x333333,
          near: 50,
          far: 200
        }
      }
    }
  }
} 