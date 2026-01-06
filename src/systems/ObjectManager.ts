import * as THREE from 'three'
import { ConfigManager } from './ConfigManager'

// Object type definitions
export interface ManagedObject {
  uuid: string
  id: string
  type: 'animated' | 'shader' | 'tsl' | 'ocean' | 'land' | 'hologram' | 'custom' | 'model'
  mesh: THREE.Mesh
  shadowMesh?: THREE.Mesh
  userData: any
  persistentState: {
    position: THREE.Vector3
    rotation: THREE.Euler
    scale: THREE.Vector3
    visible: boolean
    locked: boolean
    baseY?: number // For animated objects
  }
  lodLevel?: number
  parentSystem?: string
  animations?: string[]
}

export interface ObjectConfig {
  id: string
  type: 'animated' | 'shader' | 'tsl' | 'ocean' | 'land' | 'hologram' | 'custom' | 'model'
  geometry: THREE.BufferGeometry
  material: THREE.Material
  position?: THREE.Vector3
  rotation?: THREE.Euler
  scale?: THREE.Vector3
  userData?: any
  shadowMaterial?: THREE.Material
  parentSystem?: string
  persistPosition?: boolean
  animations?: string[]
}

export interface CameraState {
  position: THREE.Vector3
  rotation: THREE.Euler
  fov: number
  zoom: number
  target?: THREE.Vector3 // For orbit controls
}

export class ObjectManager {
  private objects: Map<string, ManagedObject> = new Map()
  private scene: THREE.Scene
  private configManager: ConfigManager
  private lockedPositions: Set<string> = new Set()
  
  // Camera state management
  private camera: THREE.PerspectiveCamera | null = null
  private cameraControls: any = null // OrbitControls
  
  // System tracking
  private systemObjects: Map<string, Set<string>> = new Map() // system -> object IDs
  
  constructor(scene: THREE.Scene, configManager: ConfigManager) {
    this.scene = scene
    this.configManager = configManager
    
    // Initialize system tracking
    this.systemObjects.set('animated', new Set())
    this.systemObjects.set('shader', new Set())
    this.systemObjects.set('tsl', new Set())
    this.systemObjects.set('ocean', new Set())
    this.systemObjects.set('land', new Set())
    this.systemObjects.set('hologram', new Set())
    this.systemObjects.set('custom', new Set())
    
    // console.log('🎯 ObjectManager initialized')
  }
  
  /**
   * Create and register a managed object
   */
  public createObject(config: ObjectConfig): ManagedObject {
    // Create main mesh
    const mesh = new THREE.Mesh(config.geometry, config.material)
    mesh.position.copy(config.position || new THREE.Vector3())
    mesh.rotation.copy(config.rotation || new THREE.Euler())
    mesh.scale.copy(config.scale || new THREE.Vector3(1, 1, 1))
    mesh.userData = { ...config.userData, id: config.id, type: config.type }
    
    // Create shadow mesh if shadow material provided
    let shadowMesh: THREE.Mesh | undefined
    if (config.shadowMaterial) {
      shadowMesh = new THREE.Mesh(config.geometry.clone(), config.shadowMaterial)
      shadowMesh.position.copy(mesh.position)
      shadowMesh.rotation.copy(mesh.rotation)
      shadowMesh.scale.copy(mesh.scale)
      shadowMesh.visible = false // Hidden by default
      shadowMesh.userData = { ...mesh.userData, isShadowMesh: true }
      this.scene.add(shadowMesh)
    }
    
    // Create managed object
    const managedObject: ManagedObject = {
      uuid: mesh.uuid,
      id: config.id,
      type: config.type,
      mesh,
      shadowMesh,
      userData: mesh.userData,
      persistentState: {
        position: mesh.position.clone(),
        rotation: mesh.rotation.clone(),
        scale: mesh.scale.clone(),
        visible: mesh.visible,
        locked: false,
        baseY: config.userData?.baseY
      },
      parentSystem: config.parentSystem,
      animations: config.animations || []
    }
    
    // Add to scene
    this.scene.add(mesh)
    
    // Register object
    this.objects.set(config.id, managedObject)
    this.objects.set(mesh.uuid, managedObject) // Also register by UUID for compatibility
    
    // Track by system
    if (config.parentSystem) {
      if (!this.systemObjects.has(config.parentSystem)) {
        this.systemObjects.set(config.parentSystem, new Set())
      }
      this.systemObjects.get(config.parentSystem)!.add(config.id)
    }
    this.systemObjects.get(config.type)!.add(config.id)
    
    // console.log(`📦 Created managed object: ${config.id} (${config.type})`)
    
    return managedObject
  }
  
  /**
   * Get managed object by ID or UUID
   */
  public getObject(identifier: string): ManagedObject | undefined {
    return this.objects.get(identifier)
  }
  
  /**
   * Get all objects of a specific type
   */
  public getObjectsByType(type: string): ManagedObject[] {
    const objectIds = this.systemObjects.get(type) || new Set()
    return Array.from(objectIds).map(id => this.objects.get(id)!).filter(Boolean)
  }
  
  /**
   * Get all objects in a system
   */
  public getObjectsBySystem(system: string): ManagedObject[] {
    const objectIds = this.systemObjects.get(system) || new Set()
    return Array.from(objectIds).map(id => this.objects.get(id)!).filter(Boolean)
  }
  
  /**
   * Get all managed objects
   */
  public getAllObjects(): ManagedObject[] {
    const allObjects: ManagedObject[] = []
    this.objects.forEach((obj, key) => {
      // Only include objects by ID (not UUID) to avoid duplicates
      if (key === obj.id) {
        allObjects.push(obj)
      }
    })
    return allObjects
  }
  
  /**
   * Update object position and persist if enabled
   */
  public setObjectPosition(identifier: string, position: THREE.Vector3, persist: boolean = true, forceMove: boolean = false, animationSystem?: any): boolean {
    const obj = this.getObject(identifier)
    if (!obj) return false
    
    // Check if position is locked (unless forcing move)
    if (obj.persistentState.locked && !forceMove) {
      // console.warn(`🔒 Object ${identifier} position is locked`)
      return false
    }
    
    // CRITICAL FIX: Stop animations for this object to prevent stretching/distortion
    // This fixes issues with animated-1, animated-2, animated-3, and hologram
    if (animationSystem && obj.animations && obj.animations.length > 0) {
      animationSystem.removeAnimationsForObject(obj.mesh)
      // Reset scale to (1,1,1) if object had scale animations to prevent stretching
      // obj.animations is an array of animation type strings like ['scale', 'combined', etc.]
      const hasScaleAnimation = obj.animations.some(animType => animType === 'scale' || animType === 'combined')
      if (hasScaleAnimation) {
        obj.mesh.scale.set(1, 1, 1)
        obj.persistentState.scale.set(1, 1, 1)
        if (obj.shadowMesh) {
          obj.shadowMesh.scale.set(1, 1, 1)
        }
      }
    }
    
    // Update mesh position
    obj.mesh.position.copy(position)
    obj.persistentState.position.copy(position)
    
    // Update shadow mesh if exists
    if (obj.shadowMesh) {
      obj.shadowMesh.position.copy(position)
    }
    
    // Update baseY for animated objects
    if (obj.type === 'animated' && obj.userData.baseY !== undefined) {
      obj.userData.baseY = position.y
      obj.mesh.userData.baseY = position.y
    }
    
    // Persist to storage if enabled
    if (persist) {
      this.savePersistentStates()
    }
    
    // console.log(`📍 Updated position for ${identifier}: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`)
    return true
  }
  
  /**
   * Set object rotation
   */
  public setObjectRotation(identifier: string, rotation: THREE.Euler, persist: boolean = true, forceMove: boolean = false): boolean {
    const obj = this.getObject(identifier)
    if (!obj) return false
    
    // Check if position is locked (unless forcing move)
    if (obj.persistentState.locked && !forceMove) {
      // console.warn(`🔒 Object ${identifier} rotation is locked`)
      return false
    }
    
    // Update mesh rotation
    obj.mesh.rotation.copy(rotation)
    obj.persistentState.rotation.copy(rotation)
    
    // Update shadow mesh if exists
    if (obj.shadowMesh) {
      obj.shadowMesh.rotation.copy(rotation)
    }
    
    // Persist to storage if enabled
    if (persist) {
      this.savePersistentStates()
    }
    
    // console.log(`🔄 Updated rotation for ${identifier}: (${rotation.x.toFixed(2)}, ${rotation.y.toFixed(2)}, ${rotation.z.toFixed(2)})`)
    return true
  }
  
  /**
   * Lock/unlock object position
   */
  public lockObject(identifier: string, locked: boolean = true): boolean {
    const obj = this.getObject(identifier)
    if (!obj) return false
    
    obj.persistentState.locked = locked
    if (locked) {
      this.lockedPositions.add(obj.uuid)
    } else {
      this.lockedPositions.delete(obj.uuid)
    }
    
    // Persist the lock state change
    this.savePersistentStates()
    
    // console.log(`${locked ? '🔒' : '🔓'} ${locked ? 'Locked' : 'Unlocked'} object: ${identifier}`)
    return true
  }
  
  /**
   * Check if object is locked
   */
  public isObjectLocked(identifier: string): boolean {
    const obj = this.getObject(identifier)
    return obj ? obj.persistentState.locked : false
  }
  
  /**
   * Save all persistent states to localStorage
   */
  public savePersistentStates(): void {
    const persistentData: { [key: string]: any } = {}
    
    this.objects.forEach((obj, key) => {
      // Only save by ID (not UUID) to avoid duplicates
      if (key === obj.id) {
        persistentData[key] = {
          position: {
            x: obj.persistentState.position.x,
            y: obj.persistentState.position.y,
            z: obj.persistentState.position.z
          },
          rotation: {
            x: obj.persistentState.rotation.x,
            y: obj.persistentState.rotation.y,
            z: obj.persistentState.rotation.z
          },
          scale: {
            x: obj.persistentState.scale.x,
            y: obj.persistentState.scale.y,
            z: obj.persistentState.scale.z
          },
          visible: obj.persistentState.visible,
          locked: obj.persistentState.locked,
          baseY: obj.persistentState.baseY,
          type: obj.type,
          uuid: obj.uuid
        }
      }
    })
    
    localStorage.setItem('objectManager_persistentStates', JSON.stringify(persistentData))
    // console.log(`💾 Saved ${Object.keys(persistentData).length} object states to localStorage`)
  }
  
  /**
   * Load all persistent states from localStorage
   */
  public loadPersistentStates(): void {
    try {
      const savedData = localStorage.getItem('objectManager_persistentStates')
      if (!savedData) {
        // No saved data - save current positions as defaults for next time
        this.savePersistentStates()
        return
      }
      
      const persistentData = JSON.parse(savedData)
      let restoredCount = 0
      
      Object.entries(persistentData).forEach(([id, data]: [string, any]) => {
        const obj = this.getObject(id)
        if (obj) {
          // Restore position
          const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z)
          obj.mesh.position.copy(pos)
          obj.persistentState.position.copy(pos)
          
          // Restore rotation
          const rot = new THREE.Euler(data.rotation.x, data.rotation.y, data.rotation.z)
          obj.mesh.rotation.copy(rot)
          obj.persistentState.rotation.copy(rot)
          
          // Restore scale
          const scale = new THREE.Vector3(data.scale.x, data.scale.y, data.scale.z)
          obj.mesh.scale.copy(scale)
          obj.persistentState.scale.copy(scale)
          
          // Restore visibility
          obj.mesh.visible = data.visible
          obj.persistentState.visible = data.visible
          
          // Restore lock state
          obj.persistentState.locked = data.locked
          if (data.locked) {
            this.lockedPositions.add(obj.uuid)
          }
          
          // Restore baseY for animated objects
          if (data.baseY !== undefined) {
            obj.persistentState.baseY = data.baseY
            obj.userData.baseY = data.baseY
            obj.mesh.userData.baseY = data.baseY
          }
          
          // Update shadow mesh if exists
          if (obj.shadowMesh) {
            obj.shadowMesh.position.copy(pos)
            obj.shadowMesh.rotation.copy(rot)
            obj.shadowMesh.scale.copy(scale)
          }
          
          restoredCount++
        }
      })
      
      console.log(`📂 Restored ${restoredCount} object states from localStorage`)
      
    } catch (error) {
      console.warn('⚠️ Failed to load persistent states:', error)
    }
  }
  
  /**
   * Clear all persistent states
   */
  public clearPersistentStates(): void {
    localStorage.removeItem('objectManager_persistentStates')
    this.lockedPositions.clear()
    
    // Reset all object lock states
    this.objects.forEach(obj => {
      obj.persistentState.locked = false
    })
    
    // console.log('🗑️ Cleared all persistent object states')
  }
  
  /**
   * Get all meshes for compatibility with existing code
   */
  public getAllMeshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = []
    this.objects.forEach((obj, key) => {
      // Only add each mesh once (by ID, not UUID)
      if (key === obj.id) {
        meshes.push(obj.mesh)
      }
    })
    return meshes
  }
  
  /**
   * Find mesh by index (for compatibility)
   */
  public getMeshByIndex(index: number): THREE.Mesh | null {
    const meshes = this.getAllMeshes()
    return index >= 0 && index < meshes.length ? meshes[index] : null
  }
  
  /**
   * Remove object from management
   */
  public removeObject(identifier: string): boolean {
    const obj = this.getObject(identifier)
    if (!obj) return false
    
    // Remove from scene
    this.scene.remove(obj.mesh)
    if (obj.shadowMesh) {
      this.scene.remove(obj.shadowMesh)
    }
    
    // Remove from tracking
    this.objects.delete(obj.id)
    this.objects.delete(obj.uuid)
    this.systemObjects.get(obj.type)?.delete(obj.id)
    if (obj.parentSystem) {
      this.systemObjects.get(obj.parentSystem)?.delete(obj.id)
    }
    this.lockedPositions.delete(obj.uuid)
    
    // console.log(`🗑️ Removed managed object: ${identifier}`)
    return true
  }
  
  /**
   * Debug info for an object
   */
  public debugObject(identifier: string): void {
    const obj = this.getObject(identifier)
    if (!obj) {
      console.error(`❌ Object "${identifier}" not found`)
      return
    }
    
    console.group(`🔍 Object Debug: ${identifier}`)
    console.log('🏷️  ID:', obj.id)
    console.log('🆔 UUID:', obj.uuid)
    console.log('🎭 Type:', obj.type)
    console.log('🏠 Parent System:', obj.parentSystem)
    console.log('📍 Position:', `(${obj.persistentState.position.x.toFixed(2)}, ${obj.persistentState.position.y.toFixed(2)}, ${obj.persistentState.position.z.toFixed(2)})`)
    console.log('🔄 Rotation:', `(${obj.persistentState.rotation.x.toFixed(2)}, ${obj.persistentState.rotation.y.toFixed(2)}, ${obj.persistentState.rotation.z.toFixed(2)})`)
    console.log('📏 Scale:', `(${obj.persistentState.scale.x.toFixed(2)}, ${obj.persistentState.scale.y.toFixed(2)}, ${obj.persistentState.scale.z.toFixed(2)})`)
    console.log('👁️  Visible:', obj.persistentState.visible)
    console.log('🔒 Locked:', obj.persistentState.locked)
    console.log('📊 Base Y:', obj.persistentState.baseY)
    console.log('🎬 Animations:', obj.animations?.length || 0, 'animation(s)')
    console.log('👥 User Data:', obj.userData)
    console.groupEnd()
  }
  
  /**
   * List all managed objects
   */
  public listAllObjects(): void {
    const objects = this.getAllObjects()
    
    if (objects.length === 0) {
      console.log('📋 No managed objects found')
      return
    }
    
    console.log(`📋 All Managed Objects (${objects.length} total):`)
    objects.forEach((obj, index) => {
      const lockStatus = obj.persistentState.locked ? '🔒' : '🔓'
      const visStatus = obj.persistentState.visible ? '👁️' : '🙈'
      const pos = obj.persistentState.position
      console.log(`  ${index}: ${obj.id} (${obj.type}) ${lockStatus} ${visStatus} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`)
    })
  }
  
  /**
   * Get locked positions set for compatibility
   */
  public getLockedPositions(): Set<string> {
    return this.lockedPositions
  }
  
  /**
   * Update object from external changes (for system integration)
   */
  public syncObjectState(identifier: string): void {
    const obj = this.getObject(identifier)
    if (!obj) return
    
    // Sync current mesh state to persistent state
    obj.persistentState.position.copy(obj.mesh.position)
    obj.persistentState.rotation.copy(obj.mesh.rotation)
    obj.persistentState.scale.copy(obj.mesh.scale)
    obj.persistentState.visible = obj.mesh.visible
  }

  // ==========================================
  // CAMERA STATE MANAGEMENT
  // ==========================================

  /**
   * Register camera and controls for persistence
   */
  public registerCamera(camera: THREE.PerspectiveCamera, controls?: any): void {
    this.camera = camera
    this.cameraControls = controls
    // console.log('📷 Camera registered for state persistence')
  }

  /**
   * Save camera state to persistent storage
   */
  public saveCameraState(): void {
    if (!this.camera) {
      // console.warn('⚠️ No camera registered for state persistence')
      return
    }

    const cameraState: CameraState = {
      position: this.camera.position.clone(),
      rotation: this.camera.rotation.clone(),
      fov: this.camera.fov,
      zoom: this.camera.zoom
    }

    // Save orbit controls target if available
    if (this.cameraControls && this.cameraControls.target) {
      cameraState.target = this.cameraControls.target.clone()
    }

    // Save directly to localStorage
    try {
      localStorage.setItem('garden-camera-state', JSON.stringify({
        position: { x: cameraState.position.x, y: cameraState.position.y, z: cameraState.position.z },
        rotation: { x: cameraState.rotation.x, y: cameraState.rotation.y, z: cameraState.rotation.z },
        fov: cameraState.fov,
        zoom: cameraState.zoom,
        target: cameraState.target ? { x: cameraState.target.x, y: cameraState.target.y, z: cameraState.target.z } : undefined
      }))
      
      // console.log('📷 Camera state saved:', {
      //   position: `(${cameraState.position.x.toFixed(2)}, ${cameraState.position.y.toFixed(2)}, ${cameraState.position.z.toFixed(2)})`,
      //   fov: cameraState.fov,
      //   zoom: cameraState.zoom
      // })
    } catch (error) {
      // console.error('❌ Failed to save camera state:', error)
    }
  }

  /**
   * Load and apply camera state from persistent storage
   */
  public loadCameraState(): boolean {
    if (!this.camera) {
      // console.warn('⚠️ No camera registered for state persistence')
      return false
    }

    try {
      const savedState = localStorage.getItem('garden-camera-state')
      if (!savedState) {
        // console.log('📷 No saved camera state found')
        return false
      }

      const cameraData = JSON.parse(savedState)
      
      // Apply camera state
      this.camera.position.set(cameraData.position.x, cameraData.position.y, cameraData.position.z)
      this.camera.rotation.set(cameraData.rotation.x, cameraData.rotation.y, cameraData.rotation.z)
      this.camera.fov = cameraData.fov
      this.camera.zoom = cameraData.zoom

      // Update projection matrix
      this.camera.updateProjectionMatrix()

      // Apply orbit controls target if available
      if (this.cameraControls && cameraData.target) {
        this.cameraControls.target.set(cameraData.target.x, cameraData.target.y, cameraData.target.z)
        this.cameraControls.update()
      }

      // console.log('📷 Camera state loaded:', {
      //   position: `(${cameraData.position.x.toFixed(2)}, ${cameraData.position.y.toFixed(2)}, ${cameraData.position.z.toFixed(2)})`,
      //   fov: cameraData.fov,
      //   zoom: cameraData.zoom
      // })
      
      return true
    } catch (error) {
      // console.error('❌ Failed to load camera state:', error)
      return false
    }
  }

  /**
   * Clear saved camera state
   */
  public clearCameraState(): void {
    try {
      localStorage.removeItem('garden-camera-state')
      // console.log('📷 Camera state cleared')
    } catch (error) {
      // console.error('❌ Failed to clear camera state:', error)
    }
  }

  /**
   * Get current camera state
   */
  public getCameraState(): CameraState | null {
    if (!this.camera) return null

    const state: CameraState = {
      position: this.camera.position.clone(),
      rotation: this.camera.rotation.clone(),
      fov: this.camera.fov,
      zoom: this.camera.zoom
    }

    if (this.cameraControls && this.cameraControls.target) {
      state.target = this.cameraControls.target.clone()
    }

    return state
  }

  /**
   * Set camera position and save state
   */
  public setCameraPosition(position: THREE.Vector3, target?: THREE.Vector3): void {
    if (!this.camera) {
      // console.warn('⚠️ No camera registered')
      return
    }

    this.camera.position.copy(position)

    if (this.cameraControls && target) {
      this.cameraControls.target.copy(target)
      this.cameraControls.update()
    }

    this.saveCameraState()
    // console.log(`📷 Camera position updated: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`)
  }
} 