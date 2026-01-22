import * as THREE from 'three'
import { GridSystem } from './GridSystem'
import { CollisionSystem } from './CollisionSystem'
import { ObjectLoader } from './ObjectLoader'
import { logger, LogModule } from './Logger'

/**
 * Level object descriptor from JSON
 */
export interface LevelObject {
  id: string
  type: 'primitive' | 'glb' | 'group'
  
  // Primitive specific
  geometry?: 'box' | 'sphere' | 'cylinder' | 'plane'
  size?: number[] // [width, height, depth] or [radius, height]
  
  // GLB specific
  path?: string
  
  // Transform
  position: number[] // [x, y, z]
  rotation?: number[] // [x, y, z] in radians
  scale?: number[] // [x, y, z]
  
  // Material/Shader
  shader?: string // 'land' | 'character' | 'ocean' | etc
  color?: string | number // hex color
  
  // Collision
  collision: 'box' | 'sphere' | 'cylinder' | 'mesh' | 'none'
  collisionSize?: number[] // Override collision bounds
  
  // Metadata
  metadata?: {
    name?: string
    tags?: string[]
    [key: string]: any
  }
}

/**
 * Level descriptor from JSON
 */
export interface LevelDescriptor {
  name: string
  version: string
  gridSize: number
  spawnPoint: number[] // [x, y, z]
  objects: LevelObject[]
  lights?: {
    sun?: {
      direction: number[]
      color: string
      intensity: number
    }
    ambient?: {
      color: string
      intensity: number
    }
  }
}

/**
 * Level Builder - loads and constructs scenes from JSON descriptors
 */
export class LevelBuilder {
  private scene: THREE.Scene
  private gridSystem: GridSystem
  private collisionSystem: CollisionSystem
  private loadedObjects: Map<string, THREE.Object3D>
  
  constructor(
    scene: THREE.Scene,
    collisionSystem: CollisionSystem,
    gridSize: number = 5
  ) {
    this.scene = scene
    this.gridSystem = new GridSystem(gridSize)
    this.collisionSystem = collisionSystem
    this.loadedObjects = new Map()
  }
  
  /**
   * Load level from JSON descriptor
   */
  async loadLevel(descriptor: LevelDescriptor): Promise<void> {
    logger.info(LogModule.SYSTEM, `Loading level: ${descriptor.name} v${descriptor.version}`)
    
    // Update grid size if different
    if (descriptor.gridSize !== this.gridSystem.gridSize) {
      this.gridSystem = new GridSystem(descriptor.gridSize)
    }
    
    // Load all objects
    const loadPromises = descriptor.objects.map(obj => this.loadObject(obj))
    await Promise.all(loadPromises)
    
    logger.info(LogModule.SYSTEM, `Level loaded: ${this.loadedObjects.size} objects`)
  }
  
  /**
   * Load a single object from descriptor
   */
  private async loadObject(descriptor: LevelObject): Promise<THREE.Object3D | null> {
    try {
      let object: THREE.Object3D
      
      // Create object based on type
      if (descriptor.type === 'primitive') {
        object = this.createPrimitive(descriptor)
      } else if (descriptor.type === 'glb') {
        object = await this.loadGLB(descriptor)
      } else {
        logger.warn(LogModule.SYSTEM, `Unknown object type: ${descriptor.type}`)
        return null
      }
      
      // Set transform
      object.position.set(...descriptor.position as [number, number, number])
      
      if (descriptor.rotation) {
        object.rotation.set(...descriptor.rotation as [number, number, number])
      }
      
      if (descriptor.scale) {
        object.scale.set(...descriptor.scale as [number, number, number])
      }
      
      // Set name and metadata
      object.name = descriptor.id
      object.userData = descriptor.metadata || {}
      
      // Add collision
      if (descriptor.collision !== 'none') {
        this.addCollision(object, descriptor)
      }
      
      // Add to scene
      this.scene.add(object)
      this.loadedObjects.set(descriptor.id, object)
      
      logger.info(LogModule.SYSTEM, `Loaded object: ${descriptor.id} (${descriptor.type})`)
      return object
      
    } catch (error) {
      logger.error(LogModule.SYSTEM, `Failed to load object ${descriptor.id}:`, error)
      return null
    }
  }
  
  /**
   * Create a primitive mesh
   */
  private createPrimitive(descriptor: LevelObject): THREE.Mesh {
    let geometry: THREE.BufferGeometry
    
    switch (descriptor.geometry) {
      case 'box':
        const [w, h, d] = descriptor.size || [1, 1, 1]
        geometry = new THREE.BoxGeometry(w, h, d)
        break
        
      case 'sphere':
        const [radius] = descriptor.size || [1]
        geometry = new THREE.SphereGeometry(radius, 32, 32)
        break
        
      case 'cylinder':
        const [r, height] = descriptor.size || [1, 1]
        geometry = new THREE.CylinderGeometry(r, r, height, 32)
        break
        
      case 'plane':
        const [pw, pd] = descriptor.size || [1, 1]
        geometry = new THREE.PlaneGeometry(pw, pd)
        break
        
      default:
        geometry = new THREE.BoxGeometry(1, 1, 1)
    }
    
    // Create material based on shader or color
    let material: THREE.Material
    if (descriptor.shader) {
      // TODO: Load shader material based on descriptor.shader
      material = new THREE.MeshStandardMaterial({
        color: descriptor.color || 0xcccccc
      })
    } else {
      material = new THREE.MeshStandardMaterial({
        color: descriptor.color || 0xcccccc
      })
    }
    
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    
    return mesh
  }
  
  /**
   * Load a GLB model
   */
  private async loadGLB(descriptor: LevelObject): Promise<THREE.Object3D> {
    if (!descriptor.path) {
      throw new Error(`GLB path not specified for object ${descriptor.id}`)
    }
    
    const position = descriptor.position as [number, number, number]
    const rotation: [number, number, number] = descriptor.rotation ? descriptor.rotation as [number, number, number] : [0, 0, 0]
    const scale: [number, number, number] = descriptor.scale ? descriptor.scale as [number, number, number] : [1, 1, 1]
    
    const model = await ObjectLoader.loadGLTFModel(
      descriptor.path,
      descriptor.id,
      position,
      rotation,
      scale
    )
    
    return model
  }
  
  /**
   * Add collision to an object
   */
  private addCollision(object: THREE.Object3D, descriptor: LevelObject): void {
    const collisionType = descriptor.collision
    
    if (collisionType === 'none') {
      return
    }
    
    // Find the first mesh in the object hierarchy
    let mesh: THREE.Mesh | undefined
    object.traverse((child) => {
      if (!mesh && child instanceof THREE.Mesh) {
        mesh = child
      }
    })
    
    if (!mesh) {
      logger.warn(LogModule.SYSTEM, `No mesh found in object ${descriptor.id} for collision`)
      return
    }
    
    if (collisionType === 'box') {
      // Use explicit size or calculate from object bounds
      let size: THREE.Vector3
      
      if (descriptor.collisionSize) {
        size = new THREE.Vector3(...descriptor.collisionSize as [number, number, number])
      } else {
        const bbox = new THREE.Box3().setFromObject(object)
        size = bbox.getSize(new THREE.Vector3())
      }
      
      this.collisionSystem.registerObject({
        id: descriptor.id,
        mesh: mesh,
        collisionVolume: {
          type: 'box',
          position: object.position.clone(),
          rotation: object.rotation.clone(),
          dimensions: size
        },
        isStatic: true
      })
      
    } else if (collisionType === 'sphere') {
      let radius: number
      
      if (descriptor.collisionSize && descriptor.collisionSize[0]) {
        radius = descriptor.collisionSize[0]
      } else {
        const bbox = new THREE.Box3().setFromObject(object)
        const size = bbox.getSize(new THREE.Vector3())
        radius = Math.max(size.x, size.y, size.z) / 2
      }
      
      this.collisionSystem.registerObject({
        id: descriptor.id,
        mesh: mesh,
        collisionVolume: {
          type: 'sphere',
          position: object.position.clone(),
          rotation: object.rotation.clone(),
          dimensions: new THREE.Vector3(radius, 0, 0)
        },
        isStatic: true
      })
      
    } else if (collisionType === 'mesh' || collisionType === 'cylinder') {
      // For mesh/cylinder collision, calculate bounding box as approximation
      const bbox = new THREE.Box3().setFromObject(object)
      const size = bbox.getSize(new THREE.Vector3())
      
      this.collisionSystem.registerObject({
        id: descriptor.id,
        mesh: mesh,
        collisionVolume: {
          type: 'box',
          position: object.position.clone(),
          rotation: object.rotation.clone(),
          dimensions: size
        },
        isStatic: true
      })
    }
  }
  
  /**
   * Export current scene objects to JSON descriptor format
   * Useful for creating level files from positioned objects
   */
  exportToJSON(levelName: string): LevelDescriptor {
    const objects: LevelObject[] = []
    
    this.scene.traverse((obj) => {
      if (obj === this.scene) return
      if (obj.type === 'GridHelper') return
      
      const mesh = obj as THREE.Mesh
      if (!mesh.geometry) return
      
      const descriptor: LevelObject = {
        id: obj.name || `object_${objects.length}`,
        type: 'primitive', // Default, update manually for GLBs
        position: [obj.position.x, obj.position.y, obj.position.z],
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        scale: [obj.scale.x, obj.scale.y, obj.scale.z],
        collision: 'box', // Default
        metadata: obj.userData
      }
      
      // Try to detect geometry type
      if (mesh.geometry instanceof THREE.BoxGeometry) {
        descriptor.geometry = 'box'
        const params = (mesh.geometry as any).parameters
        descriptor.size = [params.width, params.height, params.depth]
      }
      
      // Get color if material has it
      if (mesh.material instanceof THREE.MeshStandardMaterial) {
        descriptor.color = mesh.material.color.getHex()
      }
      
      objects.push(descriptor)
    })
    
    return {
      name: levelName,
      version: '1.0.0',
      gridSize: this.gridSystem.gridSize,
      spawnPoint: [0, 0, 0],
      objects
    }
  }
  
  /**
   * Get object by ID
   */
  getObject(id: string): THREE.Object3D | undefined {
    return this.loadedObjects.get(id)
  }
  
  /**
   * Get grid system
   */
  getGridSystem(): GridSystem {
    return this.gridSystem
  }
  
  /**
   * Clear all loaded objects
   */
  clear(): void {
    this.loadedObjects.forEach(obj => {
      this.scene.remove(obj)
      // TODO: Dispose geometry and materials
    })
    this.loadedObjects.clear()
  }
}

export default LevelBuilder
