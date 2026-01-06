import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ObjectManager } from './ObjectManager'
import { AnimationSystem } from './AnimationSystem'
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

// Main object loader class
export class ObjectLoader {
  private static animationSystem: AnimationSystem
  private static objectManager: ObjectManager
  private static scene: THREE.Scene
  private static gltfLoader: GLTFLoader = new GLTFLoader()
  private static landUniforms: { [key: string]: { value: any } } | null = null

  public static initialize(scene: THREE.Scene, objectManager: ObjectManager, animationSystem: AnimationSystem, landUniforms?: { [key: string]: { value: any } }): void {
    this.scene = scene
    this.objectManager = objectManager
    this.animationSystem = animationSystem
    if (landUniforms) {
      this.landUniforms = landUniforms
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
  public static async loadDefaultScene(): Promise<void> {
    console.log('🔄 Loading default scene objects...')
    
    await Promise.all([
      this.loadAnimatedObjects(),
      this.loadShaderObjects(),
      this.loadHologramObject()
    ])
    
    // Load models separately after initial scene setup
    this.loadModelObjects().catch(err => {
      console.error('❌ Model loading failed:', err)
    })
    
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
          model.traverse(async (child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true
              child.receiveShadow = true
              
              const originalMaterial = child.material
              
              if (useCustomShader && shaderUniforms) {
                // Apply custom shader material with land-like lighting
                const shaderMaterial = await this.createModelShaderMaterial(originalMaterial, shaderUniforms)
                child.material = shaderMaterial
              } else {
                // Use standard material
                if (Array.isArray(originalMaterial)) {
                  child.material = originalMaterial.map(mat => {
                    const color = mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial
                      ? mat.color.clone()
                      : new THREE.Color(0x808080)
                    
                    return new THREE.MeshStandardMaterial({
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
                    color: color.getHex() === 0x000000 ? 0x808080 : color,
                    metalness: 0.1,
                    roughness: 0.8,
                    side: originalMaterial.side || THREE.FrontSide,
                    transparent: originalMaterial.transparent || false,
                    opacity: originalMaterial.opacity || 1
                  })
                }
              }
            }
          })
          
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
    // Extract color from original material if possible
    let baseColor = new THREE.Color(0x808080)
    const mat = Array.isArray(originalMaterial) ? originalMaterial[0] : originalMaterial
    if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
      baseColor = mat.color.clone()
    }

    // Load default-light shaders
    const shaders = await ShaderLoader.loadShaderPair({
      vertexPath: 'src/shaders/default-light-vertex.glsl',
      fragmentPath: 'src/shaders/default-light-fragment.glsl'
    })

    // Create shader material with land-like lighting
    return new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uModelColor: { value: baseColor }
      },
      vertexShader: shaders.vertex,
      fragmentShader: shaders.fragment,
      side: THREE.DoubleSide
    })
  }

  // Load model objects
  private static async loadModelObjects(): Promise<void> {
    try {
      // Load grid_01.glb model with custom shader using landUniforms
      const useShader = this.landUniforms !== null
      const gridModel = await this.loadGLTFModel(
        '/models/environments/grid_01.glb',
        'grid-01',
        [0, 0, 0],
        [0, 0, 0],
        [1, 1, 1],
        useShader,
        this.landUniforms || undefined
      )
      
      // Calculate bounding box and position based on dimensions
      const boundingBox = new THREE.Box3().setFromObject(gridModel)
      const size = new THREE.Vector3()
      boundingBox.getSize(size)
      
      // Position the grid: X based on width, Y=0 (ground), Z based on depth
      gridModel.position.set(size.x, 0, size.z)
      console.log(`📐 Grid positioned at (${size.x.toFixed(2)}, 0, ${size.z.toFixed(2)}) based on dimensions (${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)})`)
      console.log(`🎨 Grid using ${useShader ? 'custom shader with land lighting' : 'standard material'}`)
    } catch (error) {
      console.warn('⚠️ Failed to load model objects:', error)
    }
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