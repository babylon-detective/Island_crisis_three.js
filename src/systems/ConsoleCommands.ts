import * as THREE from 'three'
import { ObjectManager } from './ObjectManager'
import { AnimationSystem } from './AnimationSystem'
import { ConfigManager } from './ConfigManager'
import { logger, LogModule, LogLevel } from './Logger'
import { performanceMonitor } from './PerformanceMonitor'


// Interface for the main app reference
interface AppReference {
  scene: THREE.Scene
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer
  objectManager: ObjectManager
  animationSystem: AnimationSystem
  configManager: ConfigManager
  collisionSystem?: any
  playerController?: any
  cameraManager?: any
  oceanLODSystem?: any
  landSystem?: any
  parameterManager?: any
  parameterGUI?: any
  parameterIntegration?: any
  retroPostProcessing?: any
  deviceType: string
  inputMethods: string[]
}

// Interface for the main app reference (for static methods)
interface IntegratedThreeJSApp {
  getCollisionSystem(): any
  getPlayerStatus(): any
  setPlayerPosition(x: number, y: number, z: number): void
  togglePlayerDebug(): void
  testCollisionAtPlayerPosition(): void
  testPlayerCollision(): void
  testCollisionAtPosition(x: number, y: number, z: number): void
}

export class ConsoleCommands {
  private app: AppReference

  constructor(app: AppReference) {
    this.app = app
  }

  // ============================================================================
  // OBJECT MANAGEMENT COMMANDS
  // ============================================================================

  public listObjects(): void {
    console.group('🎯 ObjectManager Objects')
    this.app.objectManager.listAllObjects()
    console.groupEnd()
  }

  public debugObject(id: string): void {
    console.group(`🔍 Object Debug: ${id}`)
    this.app.objectManager.debugObject(id)
    console.groupEnd()
  }

  public lockObject(id: string): boolean {
    const result = this.app.objectManager.lockObject(id)
    if (result) {
      console.log(`🔒 Object "${id}" locked`)
    } else {
      console.log(`🔒 Object "${id}" lock failed`)
      // Check if object exists
      const obj = this.app.objectManager.getObject(id)
      if (!obj) {
        // List available objects to help user
        const allObjects = this.app.objectManager.getAllObjects()
        const objectIds = allObjects.map(o => o.id).filter(Boolean)
        if (objectIds.length > 0) {
          console.log(`💡 Available objects: ${objectIds.join(', ')}`)
        } else {
          console.log(`💡 No objects found. Object "${id}" does not exist.`)
        }
      }
    }
    return result
  }

  public unlockObject(id: string): boolean {
    const result = this.app.objectManager.lockObject(id, false)
    if (result) {
      console.log(`🔓 Object "${id}" unlocked`)
    } else {
      console.log(`🔓 Object "${id}" unlock failed`)
      // Check if object exists
      const obj = this.app.objectManager.getObject(id)
      if (!obj) {
        // List available objects to help user
        const allObjects = this.app.objectManager.getAllObjects()
        const objectIds = allObjects.map(o => o.id).filter(Boolean)
        if (objectIds.length > 0) {
          console.log(`💡 Available objects: ${objectIds.join(', ')}`)
        } else {
          console.log(`💡 No objects found. Object "${id}" does not exist.`)
        }
      }
    }
    return result
  }

  /**
   * Unlock multiple objects at once
   */
  public unlockObjects(...ids: string[]): void {
    if (ids.length === 0) {
      console.warn('⚠️ No object IDs provided')
      return
    }
    
    console.group(`🔓 Unlocking ${ids.length} object(s)`)
    let successCount = 0
    ids.forEach(id => {
      const result = this.unlockObject(id)
      if (result) successCount++
    })
    console.log(`✅ Successfully unlocked ${successCount}/${ids.length} objects`)
    console.groupEnd()
  }

  /**
   * Lock multiple objects at once
   */
  public lockObjects(...ids: string[]): void {
    if (ids.length === 0) {
      console.warn('⚠️ No object IDs provided')
      return
    }
    
    console.group(`🔒 Locking ${ids.length} object(s)`)
    let successCount = 0
    ids.forEach(id => {
      const result = this.lockObject(id)
      if (result) successCount++
    })
    console.log(`✅ Successfully locked ${successCount}/${ids.length} objects`)
    console.groupEnd()
  }

  public moveObject(id: string, x: number, y: number, z: number, autoLock: boolean = true): boolean {
    let shouldAutoLock = false
    
    // For animated objects, automatically lock them to prevent animation override
    if (autoLock) {
      const obj = this.app.objectManager.getObject(id)
      if (obj && obj.animations && obj.animations.length > 0) {
        console.log(`🔒 Auto-locking animated object "${id}" to prevent animation override`)
        shouldAutoLock = true
      }
    }
    
    // Move the object first (don't save yet if we're going to auto-lock)
    // Pass animationSystem to stop animations and prevent stretching
    const result = this.app.objectManager.setObjectPosition(id, new THREE.Vector3(x, y, z), !shouldAutoLock, shouldAutoLock, this.app.animationSystem)
    
    // Lock after successful move if needed (this will save everything at once)
    if (shouldAutoLock && result) {
      this.app.objectManager.lockObject(id, true)
    }
    
    console.log(`📍 Object "${id}" ${result ? `moved to (${x}, ${y}, ${z})` : 'move failed'}`)
    
    if (shouldAutoLock && result) {
      console.log(`💡 Use unlockObject('${id}') to re-enable animations`)
    }
    
    return result
  }

  /**
   * Rotate object by Euler angles (in radians)
   * @param id Object identifier
   * @param x Rotation around X axis (in radians)
   * @param y Rotation around Y axis (in radians)
   * @param z Rotation around Z axis (in radians)
   * @param autoLock Whether to auto-lock animated objects
   */
  public rotateObject(id: string, x: number, y: number, z: number, autoLock: boolean = true): boolean {
    let shouldAutoLock = false
    
    // For animated objects, automatically lock them to prevent animation override
    if (autoLock) {
      const obj = this.app.objectManager.getObject(id)
      if (obj && obj.animations && obj.animations.length > 0) {
        console.log(`🔒 Auto-locking animated object "${id}" to prevent animation override`)
        shouldAutoLock = true
      }
    }
    
    const result = this.app.objectManager.setObjectRotation(
      id,
      new THREE.Euler(x, y, z),
      true,
      false
    )
    
    if (result && shouldAutoLock) {
      this.app.objectManager.lockObject(id, true)
    }
    
    if (result) {
      const degX = (x * 180 / Math.PI).toFixed(1)
      const degY = (y * 180 / Math.PI).toFixed(1)
      const degZ = (z * 180 / Math.PI).toFixed(1)
      console.log(`🔄 Rotated object "${id}" to (${degX}°, ${degY}°, ${degZ}°)`)
    } else {
      console.log(`❌ Failed to rotate object "${id}"`)
    }
    
    return result
  }

  public clearObjectStates(): void {
    this.app.objectManager.clearPersistentStates()
    console.log('🧹 All object states cleared')
  }

  public lookAtObject(id: string): boolean {
    const obj = this.app.objectManager.getObject(id)
    if (!obj) {
      console.error(`❌ Object "${id}" not found`)
      return false
    }
    
    // Point camera at the object
    const position = obj.mesh.position
    this.app.camera.lookAt(position)
    
    // If using OrbitControls, update the target
    if ((this.app as any).controls) {
      (this.app as any).controls.target.copy(position)
      ;(this.app as any).controls.update()
    }
    
    console.log(`👁️ Camera now looking at "${id}" at position (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`)
    return true
  }

  // Legacy mesh commands removed - use ObjectManager commands instead

  // ============================================================================
  // SYSTEM STATUS AND DIAGNOSTICS
  // ============================================================================

  public showSystemStatus(): void {
    console.group('🔍 Complete System Status')
    
    console.group('📱 Device Information')
    console.log('Type:', this.app.deviceType)
    console.log('Input Methods:', this.app.inputMethods.join(', '))
    console.log('Screen:', `${window.innerWidth}x${window.innerHeight}`)
    console.groupEnd()
    
    console.group('🎨 Renderer Information')
    console.log('Triangles:', this.app.renderer.info.render.triangles)
    console.log('Draw Calls:', this.app.renderer.info.render.calls)
    console.log('Geometries:', this.app.renderer.info.memory.geometries)
    console.log('Textures:', this.app.renderer.info.memory.textures)
    console.groupEnd()
    
    console.group('🎯 Object Management')
    console.log('Managed Objects:', this.app.objectManager.getAllObjects().length)
    console.log('Locked Objects:', this.app.objectManager.getLockedPositions().size)
    console.groupEnd()
    
    console.group('🎬 Animation System')
    console.log('Active Animations:', this.app.animationSystem.getAnimationCount())
    console.groupEnd()
    
    if (this.app.oceanLODSystem) {
      console.group('🌊 Ocean LOD System')
      console.log('LOD Levels:', this.app.oceanLODSystem.getLODLevels().length)
      console.groupEnd()
    }
    
    if (this.app.landSystem) {
      console.group('🏔️ Land System')
      console.log('Land Pieces:', this.app.landSystem.getLandPieces().length)
      console.groupEnd()
    }
    
    console.groupEnd()
  }

  public showObjectStatus(): void {
    console.group('🔍 Object Management Status')
    
    const allMeshes: THREE.Mesh[] = []
    this.app.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        allMeshes.push(object)
      }
    })
    
    console.log(`📊 Total meshes in scene: ${allMeshes.length}`)
    console.log(`🎯 ObjectManager managed objects: ${this.app.objectManager.getAllObjects().length}`)
    
    console.group('📦 ObjectManager Objects')
    this.app.objectManager.listAllObjects()
    console.groupEnd()
    
    const unmanagedMeshes = allMeshes.filter(mesh => {
      const hasId = this.app.objectManager.getObject(mesh.userData.id)
      const hasUuid = this.app.objectManager.getObject(mesh.uuid)
      return !hasId && !hasUuid
    })
    
    if (unmanagedMeshes.length > 0) {
      console.group('⚠️ Unmanaged Legacy Objects')
      unmanagedMeshes.forEach((mesh, index) => {
        console.log(`${index}: ${mesh.userData.id || 'No ID'} (${mesh.userData.type || 'Unknown'}) - UUID: ${mesh.uuid.substring(0, 8)}...`)
      })
      console.log('💡 Run migrateToObjectManager() to move these to unified management')
      console.groupEnd()
    } else {
      console.log('✅ All objects are managed by ObjectManager!')
    }
    
    console.groupEnd()
  }

  public migrateToObjectManager(): void {
    console.group('🔄 Migrating to ObjectManager')
    
    const allMeshes: THREE.Mesh[] = []
    this.app.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        allMeshes.push(object)
      }
    })
    
    let migratedCount = 0
    
    allMeshes.forEach((mesh, index) => {
      if (this.app.objectManager.getObject(mesh.userData.id) || this.app.objectManager.getObject(mesh.uuid)) {
        return
      }
      
      if (mesh.userData.type === 'ocean' || mesh.userData.type === 'land' || 
          mesh.userData.type === 'ocean-shadow' || mesh.userData.type === 'land-shadow') {
        return
      }
      
      const objectId = mesh.userData.id || `mesh-${index}`
      const objectType = mesh.userData.type || 'custom'
      
      try {
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
        this.app.objectManager.createObject({
          id: objectId,
          type: objectType as any,
          geometry: mesh.geometry,
          material: material,
          position: mesh.position.clone(),
          rotation: mesh.rotation.clone(),
          scale: mesh.scale.clone(),
          userData: mesh.userData,
          persistPosition: true
        })
        
        migratedCount++
        console.log(`✅ Migrated: ${objectId} (${objectType})`)
        
      } catch (error) {
        console.warn(`⚠️ Failed to migrate: ${objectId}`, error)
      }
    })
    
    console.log(`🎯 Migration complete: ${migratedCount} objects migrated to ObjectManager`)
    console.groupEnd()
  }

  // ============================================================================
  // CAMERA MANAGEMENT COMMANDS
  // ============================================================================

  public saveCameraState(): void {
    this.app.objectManager.saveCameraState()
    console.log('📷 Camera state saved manually')
  }

  public loadCameraState(): boolean {
    const loaded = this.app.objectManager.loadCameraState()
    if (loaded) {
      console.log('📷 Camera state loaded successfully')
    } else {
      console.log('📷 No saved camera state found')
    }
    return loaded
  }

  public clearCameraState(): void {
    this.app.objectManager.clearCameraState()
    console.log('📷 Camera state cleared')
  }

  public setCameraPosition(x: number, y: number, z: number, targetX?: number, targetY?: number, targetZ?: number): void {
    const position = new THREE.Vector3(x, y, z)
    const target = targetX !== undefined && targetY !== undefined && targetZ !== undefined 
      ? new THREE.Vector3(targetX, targetY, targetZ) 
      : undefined
    
    this.app.objectManager.setCameraPosition(position, target)
    
    if (target) {
      console.log(`📷 Camera moved to (${x}, ${y}, ${z}) looking at (${targetX}, ${targetY}, ${targetZ})`)
    } else {
      console.log(`📷 Camera moved to (${x}, ${y}, ${z})`)
    }
  }

  public getCameraState(): void {
    const state = this.app.objectManager.getCameraState()
    if (state) {
      console.group('📷 Current Camera State')
      console.log('Position:', `(${state.position.x.toFixed(2)}, ${state.position.y.toFixed(2)}, ${state.position.z.toFixed(2)})`)
      console.log('Rotation:', `(${state.rotation.x.toFixed(2)}, ${state.rotation.y.toFixed(2)}, ${state.rotation.z.toFixed(2)})`)
      console.log('FOV:', state.fov.toFixed(1))
      console.log('Zoom:', state.zoom.toFixed(2))
      if (state.target) {
        console.log('Target:', `(${state.target.x.toFixed(2)}, ${state.target.y.toFixed(2)}, ${state.target.z.toFixed(2)})`)
      }
      console.groupEnd()
    } else {
      console.log('📷 No camera registered for state management')
    }
  }

  // ============================================================================
  // CAMERA MANAGER COMMANDS (New System)
  // ============================================================================

  public switchCamera(mode: 'system' | 'player' = 'system'): void {
    if ((this.app as any).cameraManager) {
      const cameraManager = (this.app as any).cameraManager
      cameraManager.switchCamera(mode)
      console.log(`📷 Switched to ${mode} camera`)
    } else {
      console.warn('⚠️ CameraManager not available')
    }
  }

  public getCameraMode(): string {
    if ((this.app as any).cameraManager) {
      const cameraManager = (this.app as any).cameraManager
      const mode = cameraManager.getCurrentMode()
      console.log(`📷 Current camera mode: ${mode}`)
      return mode
    } else {
      console.warn('⚠️ CameraManager not available')
      return 'unknown'
    }
  }

  public getCameraInfo(): void {
    if ((this.app as any).cameraManager) {
      const cameraManager = (this.app as any).cameraManager
      const info = cameraManager.getCameraInfo()
      console.group('📷 Camera Manager Info')
      console.log('Current Mode:', info.currentMode)
      console.log('Is Transitioning:', info.isTransitioning)
      console.group('System Camera')
      console.log('Position:', info.systemCamera.position)
      console.log('Rotation:', info.systemCamera.rotation)
      console.groupEnd()
      console.group('Player Camera')
      console.log('Position:', info.playerCamera.position)
      console.log('Rotation:', info.playerCamera.rotation)
      console.groupEnd()
      console.group('Player Controls')
      console.log('Enabled:', info.playerControls.enabled)
      console.log('Pitch:', info.playerControls.pitch.toFixed(3))
      console.log('Yaw:', info.playerControls.yaw.toFixed(3))
      console.log('Sensitivity:', info.playerControls.sensitivity)
      console.groupEnd()
      console.groupEnd()
    } else {
      console.warn('⚠️ CameraManager not available')
    }
  }

  public setPlayerPosition(x: number, y: number, z: number): void {
    if ((this.app as any).playerController) {
      const playerController = (this.app as any).playerController
      playerController.setPosition(new THREE.Vector3(x, y, z))
      console.log(`🎮 Player position set to (${x}, ${y}, ${z})`)
    } else {
      console.warn('⚠️ PlayerController not available')
    }
  }

  public getPlayerStatus(): void {
    if ((this.app as any).playerController) {
      const playerController = (this.app as any).playerController
      const status = playerController.getStatus()
      console.group('🎮 Player Status')
      console.log('Position:', status.position)
      console.log('Velocity:', status.velocity)
      console.log('On Ground:', status.onGround)
      console.log('Debug Visible:', status.debugVisible)
      console.group('Movement Input')
      Object.entries(status.movementInput).forEach(([key, value]) => {
        console.log(`${key}:`, value)
      })
      console.groupEnd()
      console.group('Configuration')
      Object.entries(status.config).forEach(([key, value]) => {
        console.log(`${key}:`, value)
      })
      console.groupEnd()
      console.groupEnd()
    } else {
      console.warn('⚠️ PlayerController not available')
    }
  }

  public togglePlayerDebug(): void {
    if ((this.app as any).playerController) {
      const playerController = (this.app as any).playerController
      const currentState = playerController.isDebugWireframeVisible()
      playerController.setDebugVisible(!currentState)
      console.log(`🎮 Player debug wireframe: ${!currentState ? 'visible' : 'hidden'}`)
    } else {
      console.warn('⚠️ PlayerController not available')
    }
  }

  public setMeshGroundOffset(offset: number): void {
    if ((this.app as any).playerController) {
      const playerController = (this.app as any).playerController
      playerController.setMeshGroundOffset(offset)
      console.log(`🎮 Mesh ground offset set to ${offset} (positive = lower mesh)`)
    } else {
      console.warn('⚠️ PlayerController not available')
    }
  }

  // ============================================================================
  // PERFORMANCE AND DEBUGGING
  // ============================================================================

  public getPerformanceStats(): object {
    return {
      deviceType: this.app.deviceType,
      inputMethods: this.app.inputMethods,
      animationCount: this.app.animationSystem.getAnimationCount(),
      triangles: this.app.renderer.info.render.triangles,
      drawCalls: this.app.renderer.info.render.calls,
      managedObjects: this.app.objectManager.getAllObjects().length,
      oceanLODs: this.app.oceanLODSystem?.getLODLevels().length || 0,
      landPieces: this.app.landSystem?.getLandPieces().length || 0,
      memoryUsage: {
        geometries: this.app.renderer.info.memory.geometries,
        textures: this.app.renderer.info.memory.textures
      }
    }
  }

  /**
   * Analyze rendering performance and optimization opportunities
   */
  public analyzeRenderingPerformance(): void {
    console.group('🔍 RENDERING PERFORMANCE ANALYSIS')
    
    const renderInfo = this.app.renderer.info
    const objects = this.app.objectManager.getAllObjects()
    
    // Current performance metrics
    console.log('📊 Current Performance:')
    console.log(`  Draw Calls: ${renderInfo.render.calls}`)
    console.log(`  Triangles: ${renderInfo.render.triangles.toLocaleString()}`)
    console.log(`  Geometries: ${renderInfo.memory.geometries}`)
    console.log(`  Textures: ${renderInfo.memory.textures}`)
    console.log(`  Managed Objects: ${objects.length}`)
    
    // Analyze object distribution
    const objectTypes = new Map<string, number>()
    const geometryReuse = new Map<string, number>()
    const materialReuse = new Map<string, number>()
    
    for (const obj of objects) {
      // Count by type
      objectTypes.set(obj.type, (objectTypes.get(obj.type) || 0) + 1)
      
      // Count geometry reuse
      const geoId = obj.mesh.geometry.uuid
      geometryReuse.set(geoId, (geometryReuse.get(geoId) || 0) + 1)
      
      // Count material reuse
      const matId = (obj.mesh.material as THREE.Material).uuid
      materialReuse.set(matId, (materialReuse.get(matId) || 0) + 1)
    }
    
    console.log('🎯 Object Distribution:')
    for (const [type, count] of objectTypes) {
      console.log(`  ${type}: ${count} objects`)
    }
    
    // Identify instancing opportunities
    console.log('🚀 GPU Instancing Opportunities:')
    let instancingCandidates = 0
    let potentialSavings = 0
    
    for (const [geoId, count] of geometryReuse) {
      if (count >= 3) { // 3+ objects with same geometry
        instancingCandidates++
        potentialSavings += count - 1
        console.log(`  Geometry ${geoId.substring(0, 8)}: ${count} objects → 1 draw call (save ${count - 1})`)
      }
    }
    
    if (instancingCandidates === 0) {
      console.log('  ✅ No obvious instancing opportunities (good!)')
    } else {
      console.log(`  💡 Total potential draw call savings: ${potentialSavings}`)
    }
    
    // Identify batching opportunities  
    console.log('📦 Material Batching Opportunities:')
    let batchingCandidates = 0
    
    for (const [matId, count] of materialReuse) {
      if (count >= 2) {
        batchingCandidates++
        console.log(`  Material ${matId.substring(0, 8)}: ${count} objects → potential batching`)
      }
    }
    
    if (batchingCandidates === 0) {
      console.log('  ✅ Materials are well optimized')
    }
    
    // Performance recommendations
    console.log('💡 Recommendations:')
    
    if (renderInfo.render.calls > 50) {
      console.log('  🔴 HIGH: Too many draw calls (>50). Consider instancing/batching.')
    } else if (renderInfo.render.calls > 20) {
      console.log('  🟡 MEDIUM: Moderate draw calls. Room for optimization.')
    } else {
      console.log('  🟢 GOOD: Draw call count is reasonable.')
    }
    
    if (renderInfo.render.triangles > 1000000) {
      console.log('  🔴 HIGH: High triangle count (>1M). Consider LOD system.')
    } else if (renderInfo.render.triangles > 500000) {
      console.log('  🟡 MEDIUM: Moderate triangle count. Monitor performance.')
    } else {
      console.log('  🟢 GOOD: Triangle count is reasonable.')
    }
    
    if (renderInfo.memory.geometries > 100) {
      console.log('  🟡 MEDIUM: Many geometry instances. Consider sharing.')
    }
    
    if (renderInfo.memory.textures > 50) {
      console.log('  🟡 MEDIUM: Many textures loaded. Consider atlasing.')
    }
    
    console.groupEnd()
  }

  /**
   * Show detailed object breakdown for optimization
   */
  public showObjectBreakdown(): void {
    console.group('📋 DETAILED OBJECT BREAKDOWN')
    
    const objects = this.app.objectManager.getAllObjects()
    const breakdown = new Map<string, {
      count: number,
      triangles: number,
      objects: string[]
    }>()
    
    for (const obj of objects) {
      const key = `${obj.type}`
      if (!breakdown.has(key)) {
        breakdown.set(key, { count: 0, triangles: 0, objects: [] })
      }
      
      const entry = breakdown.get(key)!
      entry.count++
      entry.objects.push(obj.id)
      
      // Calculate triangles
      const geometry = obj.mesh.geometry
      const triangleCount = geometry.index ? 
        geometry.index.count / 3 : 
        geometry.attributes.position.count / 3
      entry.triangles += triangleCount
    }
    
    // Sort by triangle count
    const sorted = Array.from(breakdown.entries()).sort((a, b) => b[1].triangles - a[1].triangles)
    
    for (const [type, data] of sorted) {
      console.log(`${type.toUpperCase()}:`)
      console.log(`  Objects: ${data.count}`)
      console.log(`  Triangles: ${Math.floor(data.triangles).toLocaleString()}`)
      console.log(`  Avg Triangles/Object: ${Math.floor(data.triangles / data.count).toLocaleString()}`)
      console.log(`  IDs: ${data.objects.join(', ')}`)
      console.log('')
    }
    
    console.groupEnd()
  }

  /**
   * Simulate instancing optimization
   */
  public simulateInstancing(): void {
    console.group('🚀 INSTANCING SIMULATION')
    
    const objects = this.app.objectManager.getAllObjects()
    const renderInfo = this.app.renderer.info
    
    // Group by geometry + material
    const groups = new Map<string, typeof objects>()
    
    for (const obj of objects) {
      if (obj.type === 'ocean' || obj.type === 'land') continue // Skip terrain
      
      const geoId = obj.mesh.geometry.uuid
      const matId = (obj.mesh.material as THREE.Material).uuid
      const key = `${geoId}-${matId}`
      
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(obj)
    }
    
    let currentDrawCalls = renderInfo.render.calls
    let optimizedDrawCalls = currentDrawCalls
    let instancedGroups = 0
    let totalInstancesSaved = 0
    
    console.log(`Current Draw Calls: ${currentDrawCalls}`)
    console.log('')
    
    for (const [key, group] of groups) {
      if (group.length >= 3) { // Worth instancing
        const savings = group.length - 1
        optimizedDrawCalls -= savings
        instancedGroups++
        totalInstancesSaved += savings
        
        console.log(`Group ${key.substring(0, 16)}...`)
        console.log(`  Objects: ${group.length} → 1 instanced mesh`)
        console.log(`  Draw Call Savings: ${savings}`)
        console.log(`  Objects: ${group.map(o => o.id).join(', ')}`)
        console.log('')
      }
    }
    
    console.log('📊 SIMULATION RESULTS:')
    console.log(`  Instanced Groups: ${instancedGroups}`)
    console.log(`  Total Draw Call Savings: ${totalInstancesSaved}`)
    console.log(`  Draw Calls: ${currentDrawCalls} → ${optimizedDrawCalls} (${Math.round((1 - optimizedDrawCalls/currentDrawCalls) * 100)}% reduction)`)
    
    if (instancedGroups === 0) {
      console.log('  ✅ No instancing opportunities found - scene is already well optimized!')
    } else {
      console.log(`  💡 Potential performance improvement: ${Math.round((totalInstancesSaved / currentDrawCalls) * 100)}%`)
    }
    
    console.groupEnd()
  }

  public printPerformanceStats(): void {
    console.group('📊 Performance Statistics')
    const stats = this.getPerformanceStats()
    Object.entries(stats).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        console.group(key)
        Object.entries(value).forEach(([subKey, subValue]) => {
          console.log(`${subKey}:`, subValue)
        })
        console.groupEnd()
      } else {
        console.log(`${key}:`, value)
      }
    })
    console.groupEnd()
  }

  // ============================================================================
  // OCEAN SYSTEM COMMANDS
  // ============================================================================

  public resetOcean(): void {
    if (this.app.oceanLODSystem) {
      this.app.oceanLODSystem.resetOceanPositions()
      console.log('🌊 Ocean positions reset')
    } else {
      console.warn('⚠️ Ocean system not available')
    }
  }

  public setWaveAmplitude(amplitude: number): void {
    if (this.app.oceanLODSystem) {
      this.app.oceanLODSystem.setWaveAmplitude(amplitude)
      console.log(`🌊 Wave amplitude set to ${amplitude}`)
    } else {
      console.warn('⚠️ Ocean system not available')
    }
  }

  public setWind(x: number, z: number, strength?: number): void {
    if (this.app.oceanLODSystem) {
      this.app.oceanLODSystem.setWindDirection(x, z)
      if (strength !== undefined) {
        this.app.oceanLODSystem.setWindStrength(strength)
      }
      console.log(`🌊 Wind set to direction (${x}, ${z})${strength !== undefined ? ` with strength ${strength}` : ''}`)
    } else {
      console.warn('⚠️ Ocean system not available')
    }
  }

  // ============================================================================
  // LAND SYSTEM COMMANDS
  // ============================================================================

  public clearLand(): void {
    if (this.app.landSystem) {
      this.app.landSystem.clearAllLand()
      console.log('🏔️ All land cleared')
    } else {
      console.warn('⚠️ Land system not available')
    }
  }

  public setTerrainHeight(elevation: number): void {
    if (this.app.landSystem) {
      this.app.landSystem.setElevation(elevation)
      console.log(`🏔️ Terrain elevation set to ${elevation}`)
    } else {
      console.warn('⚠️ Land system not available')
    }
  }

  public setTerrainRoughness(roughness: number): void {
    if (this.app.landSystem) {
      this.app.landSystem.setRoughness(roughness)
      console.log(`🏔️ Terrain roughness set to ${roughness}`)
    } else {
      console.warn('⚠️ Land system not available')
    }
  }

  // ============================================================================
  // ANIMATION SYSTEM COMMANDS
  // ============================================================================

  public startAnimations(): void {
    this.app.animationSystem.start()
    console.log('🎬 Animations started')
  }

  public stopAnimations(): void {
    this.app.animationSystem.stop()
    console.log('🎬 Animations stopped')
  }

  public toggleAnimations(): void {
    // Simple toggle - just try to start/stop
    // We can improve this later by adding a public isRunning method to AnimationSystem
    try {
      this.app.animationSystem.stop()
      console.log('🎬 Animations toggled off')
    } catch {
      this.app.animationSystem.start()
      console.log('🎬 Animations toggled on')
    }
  }

  // ============================================================================
  // HELP SYSTEM
  // ============================================================================

  public help(): void {
    console.log(`
🚀 Three.js Garden Console Commands

🎯 OBJECT MANAGEMENT:
- listObjects()                    - List all managed objects
- debugObject(id)                  - Debug specific object
- lockObject(id)                   - Lock object position
- unlockObject(id)                 - Unlock object position
- lockObjects(id1, id2, ...)       - Lock multiple objects at once
- unlockObjects(id1, id2, ...)     - Unlock multiple objects at once
- moveObject(id, x, y, z)          - Move object to position
- rotateObject(id, x, y, z)        - Rotate object (angles in radians)
- clearObjectStates()              - Clear all object states
- lookAtObject(id)                 - Point camera at object

📷 CAMERA MANAGEMENT (Legacy System):
- saveCameraState()                - Save current camera state
- loadCameraState()                - Load saved camera state
- clearCameraState()               - Clear saved camera state
- setCameraPosition(x, y, z)       - Move camera to position
- setCameraPosition(x, y, z, tx, ty, tz) - Move camera + set target
- getCameraState()                 - Show current camera state

📷 CAMERA MANAGER (New System):
- switchCamera('system'/'player')  - Switch between camera modes
- getCameraMode()                  - Get current camera mode
- getCameraInfo()                  - Show detailed camera info

🎮 PLAYER CONTROLLER:
- setPlayerPosition(x, y, z)       - Set player position
- getPlayerStatus()                - Show player status and config
- togglePlayerDebug()              - Toggle player debug wireframe
- checkPlayerSpeeds()              - Check current player speeds
- syncPlayerSpeeds()               - Sync speeds from ParameterManager
- diagnosePlayerIssues()           - Comprehensive player issue diagnosis

🔍 COLLISION SYSTEM:
- testCollision(x, y, z)           - Test collision at position
- testCollisionAt(x, y, z)         - Test collision at specific position
- testCollisionAtPlayer()          - Test collision at player position
- testCollisionAtOrigin()          - Test collision at origin (0, 10, 0)
- testCollisionPerformance()       - Test collision system performance
- testPlayerMovement()             - Test player movement and collision
- testPlayerCollision()            - Test collision at player position
- getCollisionStatus()             - Show collision system status
- showLandMeshes()                 - Show registered land meshes
- showLandBounds()                 - Show land mesh bounds and player position analysis
- movePlayerToSafePosition()       - Move player to safe position within land bounds

🔧 PARAMETER MANAGEMENT:
- showParameters()                 - Show parameter management status
- saveParameterState(name)         - Save current parameters as state
- loadParameterState(name)         - Load parameters from saved state
- setDefaultState()                - Save current parameters as default state "1"
- resetToDefault()                 - Reset to default state "1" 
- listStates()                     - List all saved parameter states
- exportState(name)                - Export state as JSON for sharing across browsers
- importState(json, name?)         - Import JSON state (defaults to state "1")
- shareDefaultState()              - Quick export of state "1" for sharing
- createOptimalDefault()           - Create optimized default state "1"
- generateHardcodedDefaults()      - Generate code to hardcode state "1" as system defaults
- resetParameters(category?)       - Reset parameters to defaults
- exportParameters()               - Export parameters as JSON

🔍 SYSTEM STATUS:
- showSystemStatus()               - Complete system overview
- showObjectStatus()               - Object management status
- migrateToObjectManager()         - Migrate legacy objects
- getPerformanceStats()            - Get performance data
- printPerformanceStats()          - Print performance stats

🌊 OCEAN SYSTEM:
- resetOcean()                     - Reset ocean positions
- setWaveAmplitude(amplitude)      - Set wave height
- setWind(x, z, strength?)         - Set wind direction/strength

🏔️ LAND SYSTEM:
- clearLand()                      - Clear all land
- setTerrainHeight(elevation)      - Set terrain elevation
- setTerrainRoughness(roughness)   - Set terrain roughness

🎬 ANIMATION SYSTEM:
- startAnimations()                - Start all animations
- stopAnimations()                 - Stop all animations
- toggleAnimations()               - Toggle animation state

📝 LOGGING CONTROL:
- enableCollisionLogging()         - Enable collision debug logs
- disableCollisionLogging()        - Disable collision debug logs
- enableAllLogging()               - Enable all debug logging
- disableAllLogging()              - Disable all debug logging
- getLoggingConfig()               - Show logging configuration

❓ HELP:
- help()                          - Show this help message

💡 Examples:
- moveObject('hologram', 0, 15, 0)  // Auto-locks animated objects
- moveObject('hologram', 0, 15, 0, false)  // Don't auto-lock
- lockObject('animated-0')
- lookAtObject('animated-0')        // Point camera at object
- setCameraPosition(10, 5, 10)     // Move camera
- setCameraPosition(10, 5, 10, 0, 0, 0) // Move camera, look at origin
- switchCamera('player')            // Switch to player camera
- setPlayerPosition(0, 10, 0)       // Move player
- togglePlayerDebug()               // Show/hide player wireframe
- setWaveAmplitude(0.8)
- showSystemStatus()

🎮 CONTROLS:
- C = Switch between System/Player cameras
- WASD = Move player (in player camera mode)
- Space = Jump (in player camera mode)
- Shift = Run (in player camera mode)
- Mouse = Look around (in player camera mode)
`)
  }

  public clearLocalStorage(): void {
    console.log('🗑️ Clearing local storage...')
    localStorage.clear()
    console.log('✅ Local storage cleared. Refresh the page to reload with new defaults.')
  }

  public forceResetAndSync(): void {
    console.group('🔄 Force Reset and Sync')
    
    // Clear local storage
    console.log('🗑️ Clearing local storage...')
    localStorage.clear()
    
    // Reset parameters to defaults
    if (this.app.parameterManager) {
      console.log('🔄 Resetting all parameters to defaults...')
      this.app.parameterManager.resetAllToDefaults()
    }
    
    // Sync player speeds
    if (this.app.playerController && this.app.parameterManager) {
      console.log('🔄 Syncing player speeds...')
      const paramWalkSpeed = this.app.parameterManager.getParameter('player', 'walkSpeed')
      const paramRunSpeed = this.app.parameterManager.getParameter('player', 'runSpeed')
      
      if (paramWalkSpeed !== null && paramRunSpeed !== null) {
        this.app.playerController.updateConfig({
          walkSpeed: paramWalkSpeed,
          runSpeed: paramRunSpeed
        })
        
        console.log(`✅ Player speeds synced:`)
        console.log(`  Walk Speed: ${paramWalkSpeed} units/s`)
        console.log(`  Run Speed: ${paramRunSpeed} units/s`)
      }
    }
    
    console.log('✅ Force reset complete! Refresh the page to apply changes.')
    console.groupEnd()
  }

  // ============================================================================
  // GLOBAL REGISTRATION
  // ============================================================================

  public registerGlobalCommands(): void {
    const win = window as any
    
    // Object Management Commands
    win.listObjects = () => this.listObjects()
    win.debugObject = (id: string) => this.debugObject(id)
    win.lockObject = (id: string) => this.lockObject(id)
    win.unlockObject = (id: string) => this.unlockObject(id)
    win.lockObjects = (...ids: string[]) => this.lockObjects(...ids)
    win.unlockObjects = (...ids: string[]) => this.unlockObjects(...ids)
    win.moveObject = (id: string, x: number, y: number, z: number) => this.moveObject(id, x, y, z)
    win.rotateObject = (id: string, x: number, y: number, z: number) => this.rotateObject(id, x, y, z)
    win.lookAtObject = (id: string) => this.lookAtObject(id)
    win.clearObjectStates = () => this.clearObjectStates()
    
    // Camera Management Commands (Legacy System)
    win.saveCameraState = () => this.saveCameraState()
    win.loadCameraState = () => this.loadCameraState()
    win.clearCameraState = () => this.clearCameraState()
    win.setCameraPosition = (x: number, y: number, z: number, targetX?: number, targetY?: number, targetZ?: number) => 
      this.setCameraPosition(x, y, z, targetX, targetY, targetZ)
    win.getCameraState = () => this.getCameraState()
    
    // Camera Manager Commands (New System)
    win.switchCamera = (mode: 'system' | 'player') => this.switchCamera(mode)
    win.getCameraMode = () => this.getCameraMode()
    win.getCameraInfo = () => this.getCameraInfo()
    
    // Player Controller Commands
    win.setPlayerPosition = (x: number, y: number, z: number) => this.setPlayerPosition(x, y, z)
    win.getPlayerStatus = () => this.getPlayerStatus()
    win.togglePlayerDebug = () => this.togglePlayerDebug()
    win.setMeshGroundOffset = (offset: number) => this.setMeshGroundOffset(offset)
    
    // Collision System Commands
    win.testCollision = (x: number = 0, y: number = 10, z: number = 0) => this.testCollision(x, y, z)
    win.getCollisionStatus = () => this.getCollisionStatus()
    win.debugCollision = (x: number = 0, y: number = 10, z: number = 0) => {
      if (this.app.collisionSystem) {
        this.app.collisionSystem.debugCollisionTest(new THREE.Vector3(x, y, z))
      } else {
        console.error('Collision system not available')
      }
    }
    win.testPlayerCollision = () => {
      if (this.app.playerController && this.app.collisionSystem) {
        const position = this.app.playerController.getPosition()
        this.app.collisionSystem.debugCollisionTest(position)
      } else {
        console.error('Player controller or collision system not available')
      }
    }
    
    win.testCollisionAt = (x: number, y: number, z: number) => this.testCollisionAt(x, y, z)
    win.testCollisionAtPlayer = () => this.testCollisionAtPlayer()
    win.testCollisionAtOrigin = () => this.testCollisionAtOrigin()
    win.testCollisionPerformance = () => this.testCollisionPerformance()
    win.testPlayerMovement = () => this.testPlayerMovement()
    win.testParameterGUI = () => this.testParameterGUI()
    win.testParameterIntegration = () => this.testParameterIntegration()
    win.debugCameraPlayerPosition = () => this.debugCameraPlayerPosition()
    win.showLandMeshes = () => this.showLandMeshes()
    win.showLandBounds = () => ConsoleCommands.showLandBounds()
    win.movePlayerToSafePosition = () => ConsoleCommands.movePlayerToSafePosition()
    win.refreshCollisionSystem = () => this.refreshCollisionSystem()
    win.checkPlayerSpeeds = () => this.checkPlayerSpeeds()
    win.syncPlayerSpeeds = () => this.syncPlayerSpeeds()
    win.diagnosePlayerIssues = () => this.diagnosePlayerIssues()
    win.clearLocalStorage = () => this.clearLocalStorage()
    win.forceResetAndSync = () => this.forceResetAndSync()
    win.testLandCollision = () => this.testLandCollision()
    win.testCollisionAtPosition = (x: number, y: number, z: number) => this.testCollisionAtPosition(x, y, z)
    win.testGroundDetection = () => this.testGroundDetection()
    
    // Retro Post-Processing Commands
    win.setRetroEnabled = (enabled: boolean) => this.setRetroEnabled(enabled)
    win.setRetroPixelSize = (size: number) => this.setRetroPixelSize(size)
    win.setRetroColorLevels = (levels: number) => this.setRetroColorLevels(levels)
    win.setRetroDitherAmount = (amount: number) => this.setRetroDitherAmount(amount)
    win.setRetroResolutionScale = (scale: number) => this.setRetroResolutionScale(scale)
    win.getRetroConfig = () => this.getRetroConfig()
    win.applyFlatShading = () => this.applyFlatShading()
    
    // Object Position Export/Import Commands
    win.exportObjectPositions = () => this.exportObjectPositions()
    win.compareObjectPositions = () => this.compareObjectPositions()
    
    // Parameter Management Commands
    win.showParameters = () => this.showParameters()
    win.saveParameterState = (name: string) => this.saveParameterState(name)
    win.loadParameterState = (name: string) => this.loadParameterState(name)
    win.setDefaultState = () => this.setDefaultState()
    win.resetToDefault = () => this.resetToDefault()
    win.listStates = () => this.listParameterStates()
    win.exportState = (name: string) => this.exportState(name)
    win.importState = (json: string, name?: string) => this.importState(json, name)
    win.shareDefaultState = () => this.shareDefaultState()
    win.createOptimalDefault = () => this.createOptimalDefault()
    win.generateHardcodedDefaults = () => this.generateHardcodedDefaults()
    win.resetParameters = (category?: string) => this.resetParameters(category)
    win.exportParameters = () => this.exportParameters()
    
    // Performance Monitoring Commands
    win.getPerformanceStats = () => {
      const metrics = performanceMonitor.getMetrics()
      const warnings = performanceMonitor.getPerformanceWarnings()
      
      console.group('📊 Performance Statistics')
      console.log(`FPS: ${metrics.fps}`)
      console.log(`Frame Time: ${metrics.frameTime}ms`)
      console.log(`Collision Checks: ${metrics.collisionChecks}`)
      console.log(`Collision Time: ${metrics.collisionTime}ms`)
      console.log(`Render Time: ${metrics.renderTime}ms`)
      if (metrics.memoryUsage) {
        console.log(`Memory Usage: ${Math.round(metrics.memoryUsage / 1024 / 1024 * 100) / 100}MB`)
      }
      
      if (warnings.length > 0) {
        console.group('⚠️ Performance Warnings')
        warnings.forEach(warning => console.warn(warning))
        console.groupEnd()
      }
      
      console.groupEnd()
    }
    win.enablePerformanceMonitoring = () => performanceMonitor.enable()
    win.disablePerformanceMonitoring = () => performanceMonitor.disable()
    win.resetPerformanceMetrics = () => performanceMonitor.reset()
    win.getCollisionStats = () => {
      if (this.app.collisionSystem) {
        const stats = this.app.collisionSystem.getPerformanceStats()
        console.group('💥 Collision System Statistics')
        console.log(`Registered Objects: ${stats.registeredObjects}`)
        console.log(`Land Meshes: ${stats.landMeshes}`)
        console.log(`Cache Size: ${stats.cacheSize}`)
        console.log(`Cache Timeout: ${stats.cacheTimeout}ms`)
        console.log(`Collision Check Interval: ${stats.collisionCheckInterval}ms`)
        console.log(`Max Raycast Distance: ${stats.maxRaycastDistance} units`)
        console.groupEnd()
      } else {
        console.warn('❌ Collision system not available')
      }
    }
    
    // System Status Commands
    win.showSystemStatus = () => this.showSystemStatus()
    win.showObjectStatus = () => this.showObjectStatus()
    win.migrateToObjectManager = () => this.migrateToObjectManager()
    win.getPerformanceStats = () => this.getPerformanceStats()
    win.printPerformanceStats = () => this.printPerformanceStats()
    
    // Ocean System Commands
    win.resetOcean = () => this.resetOcean()
    win.setWaveAmplitude = (amplitude: number) => this.setWaveAmplitude(amplitude)
    win.setWind = (x: number, z: number, strength?: number) => this.setWind(x, z, strength)
    
    // Land System Commands
    win.clearLand = () => this.clearLand()
    win.setTerrainHeight = (elevation: number) => this.setTerrainHeight(elevation)
    win.setTerrainRoughness = (roughness: number) => this.setTerrainRoughness(roughness)
    
    // Animation System Commands
    win.startAnimations = () => this.startAnimations()
    win.stopAnimations = () => this.stopAnimations()
    win.toggleAnimations = () => this.toggleAnimations()
    
    // Logging Control Commands
    win.enableCollisionLogging = () => {
      logger.enableModule(LogModule.COLLISION)
      console.log('✅ Collision debug logging enabled')
    }
    win.disableCollisionLogging = () => {
      logger.disableModule(LogModule.COLLISION)
      console.log('✅ Collision debug logging disabled')
    }
    win.enableAllLogging = () => {
      logger.enableAllModules()
      console.log('✅ All debug logging enabled')
    }
    win.disableAllLogging = () => {
      logger.disableAllModules()
      console.log('✅ All debug logging disabled')
    }
    win.getLoggingConfig = () => {
      const config = logger.getConfig()
      console.group('📝 Logging Configuration')
      console.log(`Level: ${LogLevel[config.level]}`)
      console.log(`Enabled Modules: ${config.enabledModules.join(', ')}`)
      console.log(`Silent Mode: ${config.silentMode}`)
      console.log(`Development Mode: ${config.developmentMode}`)
      console.groupEnd()
    }
    
    // Help Command
    win.help = () => this.help()
    
    // Direct access to systems
    win.objectManager = this.app.objectManager
    win.animationSystem = this.app.animationSystem
    win.configManager = this.app.configManager
    
    console.log('🎮 Console commands registered! Type help() for available commands.')
  }

  // ============================================================================
  // COLLISION SYSTEM COMMANDS
  // ============================================================================

  /**
   * Test collision detection at a specific position
   */
  public testCollision(x: number = 0, y: number = 10, z: number = 0): void {
    if (!this.app.collisionSystem) {
      console.warn('❌ Collision system not available')
      return
    }
    
    const testPosition = new THREE.Vector3(x, y, z)
    const collision = this.app.collisionSystem.checkCollision('player', testPosition)
    
    console.group('🔍 Collision Test Results')
    console.log(`Test Position: (${x}, ${y}, ${z})`)
    console.log(`Has Collision: ${collision.hasCollision}`)
    console.log(`Penetration Depth: ${collision.penetrationDepth.toFixed(3)}`)
    console.log(`Surface Normal: (${collision.normal.x.toFixed(3)}, ${collision.normal.y.toFixed(3)}, ${collision.normal.z.toFixed(3)})`)
    console.log(`Corrected Position: (${collision.correctedPosition.x.toFixed(3)}, ${collision.correctedPosition.y.toFixed(3)}, ${collision.correctedPosition.z.toFixed(3)})`)
    console.groupEnd()
  }

  /**
   * Show collision system status
   */
  public getCollisionStatus(): void {
    console.group('🔍 Collision System Status')
    
    if (!this.app.collisionSystem) {
      console.log('❌ Collision system not available')
      console.groupEnd()
      return
    }
    
    const stats = this.app.collisionSystem.getPerformanceStats()
    console.log('📊 Performance Stats:', stats)
    
    const objects = this.app.collisionSystem.getObjects()
    console.log(`🎯 Registered Objects: ${objects.size}`)
    
    objects.forEach((obj: any, id: string) => {
      console.log(`  ${id}: ${obj.isStatic ? 'Static' : 'Dynamic'} - ${obj.collisionVolume.type}`)
    })
    
    console.groupEnd()
  }

  public showLandMeshes(): void {
    console.group('🏔️ Land Meshes in Collision System')
    
    if (!this.app.collisionSystem) {
      console.log('❌ Collision system not available')
      console.groupEnd()
      return
    }
    
    // Get land meshes from collision system
    const landMeshes = this.app.collisionSystem.getLandMeshes()
    console.log(`📊 Land meshes registered: ${landMeshes.length}`)
    
    if (landMeshes.length > 0) {
      console.group('🏔️ Registered Land Meshes')
      landMeshes.forEach((info: any, index: number) => {
        const mesh = info.mesh
        console.log(`  ${index}: ${mesh.userData.id || 'No ID'} (${mesh.userData.type || mesh.userData.landType || 'Unknown'}) priority=${info.priority}`)
        console.log(`    Position: (${mesh.position.x.toFixed(1)}, ${mesh.position.y.toFixed(1)}, ${mesh.position.z.toFixed(1)})`)
        console.log(`    Scale: (${mesh.scale.x.toFixed(1)}, ${mesh.scale.y.toFixed(1)}, ${mesh.scale.z.toFixed(1)})`)
      })
      console.groupEnd()
    } else {
      console.log('⚠️ No land meshes registered in collision system')
    }
    
    // If we have access to land system, show those details too
    if (this.app.landSystem) {
      const landPieces = this.app.landSystem.getLandPieces()
      console.log(`🏔️ Land system pieces: ${landPieces.length}`)
      
      landPieces.forEach((piece: any, index: number) => {
        console.log(`  ${index}: ${piece.id} (${piece.type}) at (${piece.mesh.position.x.toFixed(1)}, ${piece.mesh.position.y.toFixed(1)}, ${piece.mesh.position.z.toFixed(1)})`)
      })
    }
    
    console.groupEnd()
  }

  /**
   * Show land mesh bounds and player position for collision debugging
   */
  public static showLandBounds(): void {
    const app = (window as any).threeJSApp as IntegratedThreeJSApp
    if (!app) {
      console.error('❌ Three.js app not found')
      return
    }

    const collisionSystem = app.getCollisionSystem()
    if (!collisionSystem) {
      console.error('❌ Collision system not found')
      return
    }

    const landMeshes = collisionSystem.getLandMeshes()
    const playerPosition = app.getPlayerStatus ? app.getPlayerStatus() : null

    console.group('🗺️ Land Mesh Bounds Analysis')
    console.log(`📍 Player Position: ${playerPosition ? `(${playerPosition.x?.toFixed(1)}, ${playerPosition.y?.toFixed(1)}, ${playerPosition.z?.toFixed(1)})` : 'Unknown'}`)
    console.log(`🏔️ Registered Land Meshes: ${landMeshes.length}`)
    
    if (landMeshes.length === 0) {
      console.warn('⚠️ No land meshes registered!')
      console.groupEnd()
      return
    }

    landMeshes.forEach((info: any, index: number) => {
      const mesh = info.mesh
      const bbox = info.boundingBox
      const center = new THREE.Vector3()
      bbox.getCenter(center)
      const size = new THREE.Vector3()
      bbox.getSize(size)
      
      console.group(`🏔️ Land Mesh ${index}: ${mesh.userData.id}`)
      console.log(`   Type: ${mesh.userData.type}/${mesh.userData.landType}`)
      console.log(`   Position: (${mesh.position.x.toFixed(1)}, ${mesh.position.y.toFixed(1)}, ${mesh.position.z.toFixed(1)})`)
      console.log(`   Bounds: X[${bbox.min.x.toFixed(1)}, ${bbox.max.x.toFixed(1)}], Y[${bbox.min.y.toFixed(1)}, ${bbox.max.y.toFixed(1)}], Z[${bbox.min.z.toFixed(1)}, ${bbox.max.z.toFixed(1)}]`)
      console.log(`   Size: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}`)
      console.log(`   Priority: ${info.priority}`)
      
      // Check if player is within bounds
      if (playerPosition) {
        const isInBounds = bbox.containsPoint(new THREE.Vector3(playerPosition.x, playerPosition.y, playerPosition.z))
        console.log(`   Player in bounds: ${isInBounds ? '✅ YES' : '❌ NO'}`)
        
        if (!isInBounds) {
          const distance = new THREE.Vector3(playerPosition.x, playerPosition.y, playerPosition.z).distanceTo(center)
          console.log(`   Distance to center: ${distance.toFixed(1)} units`)
        }
      }
      console.groupEnd()
    })

    // Overall analysis
    if (playerPosition) {
      let closestMesh: any = null
      let closestDistance = Infinity
      
      landMeshes.forEach((info: any) => {
        const center = new THREE.Vector3()
        info.boundingBox.getCenter(center)
        const distance = new THREE.Vector3(playerPosition.x, playerPosition.y, playerPosition.z).distanceTo(center)
        if (distance < closestDistance) {
          closestDistance = distance
          closestMesh = info
        }
      })
      
      console.group('📊 Analysis')
      console.log(`🎯 Closest land mesh: ${closestMesh?.mesh.userData.id} (${closestDistance.toFixed(1)} units away)`)
      
      if (closestDistance > 100) {
        console.warn('⚠️ Player is very far from any land mesh - this will cause collision issues!')
        console.log('💡 Try moving the player closer to the land or expanding the land area')
      } else if (closestDistance > 50) {
        console.warn('⚠️ Player is moderately far from land meshes')
      } else {
        console.log('✅ Player is reasonably close to land meshes')
      }
      console.groupEnd()
    }
    
    console.groupEnd()
  }

  /**
   * Move player to a safe position within land bounds
   */
  public static movePlayerToSafePosition(): void {
    const app = (window as any).threeJSApp as IntegratedThreeJSApp
    if (!app) {
      console.error('❌ Three.js app not found')
      return
    }

    const collisionSystem = app.getCollisionSystem()
    if (!collisionSystem) {
      console.error('❌ Collision system not found')
      return
    }

    const landMeshes = collisionSystem.getLandMeshes()
    if (landMeshes.length === 0) {
      console.error('❌ No land meshes available')
      return
    }

    // Find the main terrain (highest priority or largest)
    let mainTerrain = landMeshes[0]
    for (const info of landMeshes) {
      if (info.mesh.userData.id === 'main-terrain' || info.priority > mainTerrain.priority) {
        mainTerrain = info
        break
      }
    }

    const bbox = mainTerrain.boundingBox
    const center = new THREE.Vector3()
    bbox.getCenter(center)
    
    // Move player to center of main terrain, slightly above ground
    const safeX = center.x
    const safeZ = center.z
    const safeY = Math.max(bbox.max.y + 2, 10) // At least 2 units above ground, minimum 10 units up
    
    app.setPlayerPosition(safeX, safeY, safeZ)
    
    console.log(`🎯 Moved player to safe position: (${safeX.toFixed(1)}, ${safeY.toFixed(1)}, ${safeZ.toFixed(1)})`)
    console.log(`📍 This is the center of ${mainTerrain.mesh.userData.id}`)
    console.log(`💡 Use showLandBounds() to verify the player is now within collision range`)
    
    // Test collision at new position
    setTimeout(() => {
      console.log('🧪 Testing collision at new position...')
      collisionSystem.debugCollisionTest(new THREE.Vector3(safeX, safeY, safeZ))
    }, 500)
  }

  /**
   * Refresh collision system land meshes
   */
  public refreshCollisionSystem(): void {
    console.group('🔄 Refreshing Collision System')
    
    if (!this.app.collisionSystem) {
      console.log('❌ Collision system not available')
      console.groupEnd()
      return
    }

    if (!this.app.landSystem) {
      console.log('❌ Land system not available')
      console.groupEnd()
      return
    }

    // Get current land meshes
    const landPieces = this.app.landSystem.getLandPieces()
    const landMeshes = landPieces.map((piece: any) => piece.mesh)
    
    console.log(`🏔️ Refreshing collision system with ${landMeshes.length} land meshes`)
    
    // Log each land mesh for debugging
    landMeshes.forEach((mesh: THREE.Mesh, index: number) => {
      console.log(`  ${index}: ${mesh.userData.id} (${mesh.userData.type}/${mesh.userData.landType}) at (${mesh.position.x.toFixed(1)}, ${mesh.position.y.toFixed(1)}, ${mesh.position.z.toFixed(1)})`)
    })
    
    // Re-register land meshes with collision system
    this.app.collisionSystem.registerLandMeshes(landMeshes)
    
    // Test collision at player position
    if (this.app.playerController) {
      const playerPosition = this.app.playerController.getPosition()
      console.log(`🧪 Testing collision at player position: (${playerPosition.x.toFixed(1)}, ${playerPosition.y.toFixed(1)}, ${playerPosition.z.toFixed(1)})`)
      this.app.collisionSystem.debugCollisionTest(playerPosition)
    }
    
    // Test collision at origin
    console.log('🧪 Testing collision at origin (0, 10, 0)...')
    this.app.collisionSystem.debugCollisionTest(new THREE.Vector3(0, 10, 0))
    
    console.log('✅ Collision system refreshed successfully')
    console.groupEnd()
  }

  /**
   * Check current player movement speeds
   */
  public diagnosePlayerIssues(): void {
    console.group('🔍 Player Issues Diagnosis')
    
    // Check player controller
    if (!this.app.playerController) {
      console.log('❌ Player controller not available')
      console.groupEnd()
      return
    }

    // Check speeds
    const config = this.app.playerController.getConfig()
    console.log(`🚶 Walk Speed: ${config.walkSpeed} units/s`)
    console.log(`🏃 Run Speed: ${config.runSpeed} units/s`)
    
    // Check current state
    const position = this.app.playerController.getPosition()
    const velocity = this.app.playerController.getVelocity()
    const onGround = this.app.playerController.isOnGround()
    const isMoving = this.app.playerController.isMoving()
    const isRunning = this.app.playerController.isRunning()
    
    console.log(`🎮 Current State:`)
    console.log(`  Position: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`)
    console.log(`  Velocity: (${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)})`)
    console.log(`  On Ground: ${onGround}`)
    console.log(`  Moving: ${isMoving}`)
    console.log(`  Running: ${isRunning}`)
    
    // Check collision system
    if (this.app.collisionSystem) {
      const landMeshes = this.app.collisionSystem.getLandMeshes()
      console.log(`🏔️ Land Meshes: ${landMeshes.length} registered`)
      
      if (landMeshes.length === 0) {
        console.warn('⚠️ NO LAND MESHES REGISTERED! This is why player falls through land.')
      } else {
        landMeshes.forEach((info: any, index: number) => {
          const mesh = info.mesh
          console.log(`  ${index}: ${mesh.userData.id} (${mesh.userData.type}/${mesh.userData.landType}) at (${mesh.position.x.toFixed(1)}, ${mesh.position.y.toFixed(1)}, ${mesh.position.z.toFixed(1)})`)
        })
      }
      
      // Test collision at current position
      console.log('🧪 Testing collision at current position...')
      this.app.collisionSystem.debugCollisionTest(position)
    } else {
      console.log('❌ Collision system not available')
    }
    
    // Check land system
    if (this.app.landSystem) {
      const landPieces = this.app.landSystem.getLandPieces()
      console.log(`🏔️ Land System: ${landPieces.length} pieces`)
      
      landPieces.forEach((piece: any, index: number) => {
        console.log(`  ${index}: ${piece.id} (${piece.type}) at (${piece.mesh.position.x.toFixed(1)}, ${piece.mesh.position.y.toFixed(1)}, ${piece.mesh.position.z.toFixed(1)})`)
      })
    } else {
      console.log('❌ Land system not available')
    }
    
    console.log('💡 Run refreshCollisionSystem() to re-register land meshes')
    console.log('💡 Run testPlayerMovement() for detailed movement testing')
    console.groupEnd()
  }

  public checkPlayerSpeeds(): void {
    console.group('🏃 Player Movement Speeds')
    
    if (!this.app.playerController) {
      console.log('❌ Player controller not available')
      console.groupEnd()
      return
    }

    const config = this.app.playerController.getConfig()
    console.log(`🚶 Walk Speed: ${config.walkSpeed} units/s`)
    console.log(`🏃 Run Speed: ${config.runSpeed} units/s`)
    console.log(`🦘 Jump Force: ${config.jumpForce} units/s`)
    console.log(`🌍 Gravity: ${config.gravity} units/s²`)
    
    // Also check parameter manager values
    if (this.app.parameterManager) {
      const paramWalkSpeed = this.app.parameterManager.getParameter('player', 'walkSpeed')
      const paramRunSpeed = this.app.parameterManager.getParameter('player', 'runSpeed')
      const paramJumpForce = this.app.parameterManager.getParameter('player', 'jumpForce')
      
      console.log(`📊 Parameter Manager Values:`)
      console.log(`  Walk Speed: ${paramWalkSpeed} units/s`)
      console.log(`  Run Speed: ${paramRunSpeed} units/s`)
      console.log(`  Jump Force: ${paramJumpForce} units/s`)
      
      // Check if there's a mismatch
      if (config.walkSpeed !== paramWalkSpeed || config.runSpeed !== paramRunSpeed || config.jumpForce !== paramJumpForce) {
        console.warn('⚠️ Mismatch between PlayerController and ParameterManager values!')
        console.log('💡 This might be causing the slow movement issue.')
        console.log('💡 Run syncPlayerSpeeds() to fix this.')
      } else {
        console.log('✅ PlayerController and ParameterManager values match')
      }
    }
    
    // Test current player state
    const position = this.app.playerController.getPosition()
    const velocity = this.app.playerController.getVelocity()
    const onGround = this.app.playerController.isOnGround()
    const isMoving = this.app.playerController.isMoving()
    const isRunning = this.app.playerController.isRunning()
    
    console.log(`🎮 Current State:`)
    console.log(`  Position: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`)
    console.log(`  Velocity: (${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)})`)
    console.log(`  On Ground: ${onGround}`)
    console.log(`  Moving: ${isMoving}`)
    console.log(`  Running: ${isRunning}`)
    
    console.groupEnd()
  }

  public syncPlayerSpeeds(): void {
    console.group('🔄 Syncing Player Speeds')
    
    if (!this.app.playerController || !this.app.parameterManager) {
      console.log('❌ Player controller or parameter manager not available')
      console.groupEnd()
      return
    }

    const paramWalkSpeed = this.app.parameterManager.getParameter('player', 'walkSpeed')
    const paramRunSpeed = this.app.parameterManager.getParameter('player', 'runSpeed')
    
    if (paramWalkSpeed !== null && paramRunSpeed !== null) {
      this.app.playerController.updateConfig({
        walkSpeed: paramWalkSpeed,
        runSpeed: paramRunSpeed
      })
      
      console.log(`✅ Player speeds synced from ParameterManager:`)
      console.log(`  Walk Speed: ${paramWalkSpeed} units/s`)
      console.log(`  Run Speed: ${paramRunSpeed} units/s`)
      
      // Verify the sync worked
      const config = this.app.playerController.getConfig()
      if (config.walkSpeed === paramWalkSpeed && config.runSpeed === paramRunSpeed) {
        console.log('✅ Sync successful - values now match!')
      } else {
        console.warn('⚠️ Sync may have failed - values still differ')
      }
    } else {
      console.error('❌ Could not get speed values from ParameterManager')
    }
    
    console.groupEnd()
  }

  public showParameters(): void {
    console.group('🔧 Parameter Management System')
    
    if (!this.app.parameterManager) {
      console.log('❌ Parameter manager not available')
      console.groupEnd()
      return
    }
    
    const allParameters = this.app.parameterManager.getAllParameters()
    console.log(`📊 Total parameters: ${Object.keys(allParameters.categories).length} categories`)
    console.log(`🕒 Last modified: ${new Date(allParameters.lastModified).toLocaleString()}`)
    
    // Show modified parameters
    const modified = this.app.parameterManager.getModifiedParameters()
    if (modified.length > 0) {
      console.group('📝 Modified Parameters')
      modified.forEach(({ category, parameterId, defaultValue, currentValue }: any) => {
        console.log(`  ${category}.${parameterId}: ${defaultValue} → ${currentValue}`)
      })
      console.groupEnd()
    } else {
      console.log('✅ All parameters are at default values')
    }
    
    // Show saved states
    const savedStates = this.app.parameterManager.getSavedStateNames()
    if (savedStates.length > 0) {
      console.group('💾 Saved States')
      savedStates.forEach((stateName: string) => {
        console.log(`  ${stateName}`)
      })
      console.groupEnd()
    } else {
      console.log('📁 No saved states')
    }
    
    console.groupEnd()
  }

  public saveParameterState(name: string): void {
    if (!this.app.parameterManager) {
      console.error('❌ Parameter manager not available')
      return
    }
    
    this.app.parameterManager.saveState(name)
    console.log(`💾 Parameters saved as state: ${name}`)
  }

  public loadParameterState(name: string): void {
    if (!this.app.parameterManager) {
      console.error('❌ Parameter manager not available')
      return
    }
    
    const success = this.app.parameterManager.loadState(name)
    if (success) {
      console.log(`📂 Parameters loaded from state: ${name}`)
      // Update all systems with loaded parameters
      if (this.app.parameterIntegration) {
        this.app.parameterIntegration.updateAllSystems()
        console.log('🔄 All systems updated with loaded parameters')
      }
    } else {
      console.error(`❌ Failed to load state: ${name}`)
    }
  }

  /**
   * Set state "1" as the new default startup state
   */
  public setDefaultState(): void {
    if (!this.app.parameterManager) {
      console.error('❌ Parameter manager not available')
      return
    }
    
    this.app.parameterManager.saveState('1')
    console.log('💾 Current parameters saved as state "1" (default startup state)')
    console.log('🔄 State "1" will now load automatically on startup')
  }

  /**
   * Reset to state "1" (default state)
   */
  public resetToDefault(): void {
    if (!this.app.parameterManager) {
      console.error('❌ Parameter manager not available')
      return
    }
    
    const success = this.app.parameterManager.loadState('1')
    if (success) {
      console.log('📂 Reset to default state "1"')
      // Update all systems with loaded parameters
      if (this.app.parameterIntegration) {
        this.app.parameterIntegration.updateAllSystems()
        console.log('🔄 All systems updated with default parameters')
      }
    } else {
      console.warn('⚠️ Default state "1" not found. Creating it with current parameters...')
      this.setDefaultState()
    }
  }

  /**
   * List all saved parameter states
   */
  public listParameterStates(): void {
    if (!this.app.parameterManager) {
      console.error('❌ Parameter manager not available')
      return
    }
    
    const states = this.app.parameterManager.getSavedStateNames()
    if (states.length === 0) {
      console.log('📝 No saved parameter states found')
      console.log('💡 States are stored per-browser. To share across browsers:')
      console.log('   1. Use exportState("1") to get JSON')
      console.log('   2. Use importState(json) in the other browser')
      return
    }
    
    console.group('📋 Saved Parameter States')
    states.forEach((stateName: string, index: number) => {
      const isDefault = stateName === '1'
      const prefix = isDefault ? '⭐' : '  '
      console.log(`${prefix} ${index + 1}. ${stateName}${isDefault ? ' (default startup state)' : ''}`)
    })
    console.groupEnd()
    
    console.log('💡 Use loadState("name") to load a state or setDefaultState() to save current as default')
    console.log('🔄 To share states across browsers, use exportState("1") and importState(json)')
  }

  /**
   * Export a specific state as JSON for sharing across browsers
   */
  public exportState(stateName: string): void {
    if (!this.app.parameterManager) {
      console.error('❌ Parameter manager not available')
      return
    }

    if (!stateName || stateName.trim() === '') {
      console.warn('⚠️ State name cannot be empty')
      return
    }

    const states = this.app.parameterManager.getSavedStateNames()
    if (!states.includes(stateName)) {
      console.error(`❌ State "${stateName}" not found`)
      console.log('Available states:', states.join(', '))
      return
    }

    try {
      // Get the state data
      const stateData = this.app.parameterManager.exportParameters()
      
      // Load the specific state temporarily to get its data
      const currentState = this.app.parameterManager.exportParameters()
      const success = this.app.parameterManager.loadState(stateName)
      
      if (success) {
        const exportedState = this.app.parameterManager.exportParameters()
        
        // Restore the current state
        this.app.parameterManager.importParameters(currentState)
        
        console.group(`📤 Export State "${stateName}"`)
        console.log('Copy this JSON to share the state:')
        console.log('```json')
        console.log(exportedState)
        console.log('```')
        console.log(`💡 In other browser, use: importState('${exportedState}')`)
        console.groupEnd()
      } else {
        console.error(`❌ Failed to export state "${stateName}"`)
      }
    } catch (error) {
      console.error('❌ Failed to export state:', error)
    }
  }

  /**
   * Import state JSON and save it as state "1" (or specified name)
   */
  public importState(jsonString: string, stateName: string = '1'): void {
    if (!this.app.parameterManager) {
      console.error('❌ Parameter manager not available')
      return
    }

    if (!jsonString || jsonString.trim() === '') {
      console.warn('⚠️ JSON string cannot be empty')
      console.log('💡 Usage: importState(\'{"categories":...}\', "1")')
      return
    }

    try {
      // Import the parameters
      const success = this.app.parameterManager.importParameters(jsonString)
      
      if (success) {
        // Save as the specified state name
        this.app.parameterManager.saveState(stateName)
        
        // Update all systems
        if (this.app.parameterIntegration) {
          this.app.parameterIntegration.updateAllSystems()
        }
        
        console.log(`✅ State imported and saved as "${stateName}"`)
        console.log('🔄 All systems updated with imported parameters')
        
        if (stateName === '1') {
          console.log('⭐ This is now your default startup state!')
        }
      } else {
        console.error('❌ Failed to import parameters - invalid JSON format')
      }
    } catch (error) {
      console.error('❌ Failed to import state:', error)
      console.log('💡 Make sure the JSON is valid and properly formatted')
    }
  }

  /**
   * Quick share: Export state "1" for easy sharing
   */
  public shareDefaultState(): void {
    console.log('📤 Sharing default state "1"...')
    this.exportState('1')
  }

  /**
   * Create state "1" from hardcoded optimal defaults
   */
  public createOptimalDefault(): void {
    if (!this.app.parameterManager) {
      console.error('❌ Parameter manager not available')
      return
    }

    // Define optimal default parameters
    const optimalDefaults = {
      "categories": {
        "ocean": {
          "parameters": [
            { "id": "amplitude", "value": 0.3 },
            { "id": "windDirection", "value": { "x": 1, "y": 0, "z": 0.5 } },
            { "id": "windStrength", "value": 1.2 },
            { "id": "waveLength", "value": 2.5 },
            { "id": "waveSpeed", "value": 1.0 },
            { "id": "waterColor", "value": "#006994" },
            { "id": "deepWaterColor", "value": "#003366" },
            { "id": "foamColor", "value": "#ffffff" },
            { "id": "transparency", "value": 0.8 },
            { "id": "reflectionStrength", "value": 0.6 }
          ]
        },
        "land": {
          "parameters": [
            { "id": "elevation", "value": 8.0 },
            { "id": "roughness", "value": 1.2 },
            { "id": "scale", "value": 0.8 },
            { "id": "landColor", "value": "#4a7c59" },
            { "id": "rockColor", "value": "#8b7355" },
            { "id": "sandColor", "value": "#c2b280" },
            { "id": "moisture", "value": 0.3 },
            { "id": "islandRadius", "value": 35.0 },
            { "id": "coastSmoothness", "value": 8.0 },
            { "id": "seaLevel", "value": -4.0 }
          ]
        },
        "sky": {
          "parameters": [
            { "id": "turbidity", "value": 10 },
            { "id": "rayleigh", "value": 3 },
            { "id": "mieCoefficient", "value": 0.005 },
            { "id": "mieDirectionalG", "value": 0.7 },
            { "id": "elevation", "value": 15 },
            { "id": "azimuth", "value": 180 },
            { "id": "exposure", "value": 0.5 }
          ]
        },
        "lighting": {
          "parameters": [
            { "id": "shadowMapSize", "value": 4096 },
            { "id": "shadowRadius", "value": 10 },
            { "id": "shadowBlur", "value": 25 },
            { "id": "sunIntensity", "value": 1.2 },
            { "id": "ambientIntensity", "value": 0.3 },
            { "id": "shadowBias", "value": -0.0001 }
          ]
        },
        "camera": {
          "parameters": [
            { "id": "position", "value": { "x": 0, "y": 10, "z": 30 } },
            { "id": "rotation", "value": { "x": 0, "y": 0, "z": 0 } },
            { "id": "fov", "value": 75 },
            { "id": "zoom", "value": 1.0 },
            { "id": "target", "value": { "x": 0, "y": 0, "z": 0 } }
          ]
        },
        "player": {
          "parameters": [
            { "id": "walkSpeed", "value": 8 },
            { "id": "runSpeed", "value": 16 },
            { "id": "jumpHeight", "value": 12 },
            { "id": "mouseSensitivity", "value": 0.002 }
          ]
        }
      }
    }

    try {
      const jsonString = JSON.stringify(optimalDefaults)
      this.importState(jsonString, '1')
      console.log('✅ Optimal default state "1" created!')
      console.log('🎯 This provides a good starting point for most projects')
    } catch (error) {
      console.error('❌ Failed to create optimal defaults:', error)
    }
  }

  /**
   * Generate code to hardcode current state "1" as system defaults
   */
  public generateHardcodedDefaults(): void {
    if (!this.app.parameterManager) {
      console.error('❌ Parameter manager not available')
      return
    }

    const states = this.app.parameterManager.getSavedStateNames()
    if (!states.includes('1')) {
      console.error('❌ State "1" not found. Please create it first with setDefaultState()')
      return
    }

    try {
      // Load state "1" temporarily to get its data
      const currentState = this.app.parameterManager.exportParameters()
      const success = this.app.parameterManager.loadState('1')
      
      if (success) {
        const state1Data = JSON.parse(this.app.parameterManager.exportParameters())
        
        // Restore current state
        this.app.parameterManager.importParameters(currentState)
        
        console.group('🔧 HARDCODED DEFAULTS GENERATOR')
        console.log('Copy this code to replace DEFAULT_PARAMETER_SETS in src/systems/ParameterManager.ts:')
        console.log('')
        console.log('```typescript')
        console.log('export const DEFAULT_PARAMETER_SETS: Record<ParameterCategory, ParameterSet> = {')
        
        // Generate each category
        const categories = ['ocean', 'land', 'sky', 'lighting', 'camera', 'player', 'system']
        
        categories.forEach((category, index) => {
          const categoryData = state1Data.categories[category]
          if (!categoryData) return
          
          console.log(`  ${category}: {`)
          console.log(`    id: '${category}-default',`)
          console.log(`    name: '${category.charAt(0).toUpperCase() + category.slice(1)} Default',`)
          console.log(`    description: 'Default ${category} parameters from state "1"',`)
          console.log(`    version: '1.0.0',`)
          console.log(`    lastModified: Date.now(),`)
          console.log(`    parameters: [`)
          
          categoryData.parameters.forEach((param: any, paramIndex: number) => {
            const value = param.value
            let valueStr = ''
            
            if (typeof value === 'string') {
              valueStr = `'${value}'`
            } else if (typeof value === 'object' && value !== null) {
              valueStr = JSON.stringify(value)
            } else {
              valueStr = String(value)
            }
            
            // Get parameter definition for additional properties
            const paramDef = this.getParameterDefinition(category, param.id)
            
            console.log(`      { id: '${param.id}', category: '${category}', type: '${paramDef?.type || 'number'}', ${paramDef?.min !== undefined ? `min: ${paramDef.min}, ` : ''}${paramDef?.max !== undefined ? `max: ${paramDef.max}, ` : ''}${paramDef?.step !== undefined ? `step: ${paramDef.step}, ` : ''}defaultValue: ${valueStr}, currentValue: ${valueStr}, description: '${paramDef?.description || param.id}', ${paramDef?.unit ? `unit: '${paramDef.unit}', ` : ''}}${paramIndex < categoryData.parameters.length - 1 ? ',' : ''}`)
          })
          
          console.log(`    ]`)
          console.log(`  }${index < categories.length - 1 ? ',' : ''}`)
          console.log('')
        })
        
        console.log('} as const')
        console.log('```')
        console.log('')
        console.log('🎯 This will make your current state "1" the hardcoded default for all browsers!')
        console.log('💡 After updating the code, all browsers will start with these exact settings')
        console.groupEnd()
      } else {
        console.error('❌ Failed to load state "1"')
      }
    } catch (error) {
      console.error('❌ Failed to generate hardcoded defaults:', error)
    }
  }

  /**
   * Helper to get parameter definition
   */
  private getParameterDefinition(category: string, parameterId: string): any {
    try {
      // This is a simplified version - in reality you'd need to access the actual parameter definitions
      const definitions: any = {
        ocean: {
          amplitude: { type: 'number', min: 0, max: 2, step: 0.01, description: 'Wave amplitude', unit: 'units' },
          windDirectionX: { type: 'number', min: -1, max: 1, step: 0.1, description: 'Wind direction X' },
          windDirectionZ: { type: 'number', min: -1, max: 1, step: 0.1, description: 'Wind direction Z' },
          windStrength: { type: 'number', min: 0, max: 3, step: 0.1, description: 'Wind strength', unit: 'units' },
          waveLength: { type: 'number', min: 0.5, max: 5, step: 0.1, description: 'Wave length', unit: 'units' },
          waveSpeed: { type: 'number', min: 0.1, max: 3, step: 0.1, description: 'Wave speed', unit: 'units/s' },
          waterColor: { type: 'color', description: 'Shallow water color' },
          deepWaterColor: { type: 'color', description: 'Deep water color' },
          foamColor: { type: 'color', description: 'Foam color' },
          transparency: { type: 'number', min: 0, max: 1, step: 0.01, description: 'Water transparency' },
          reflectionStrength: { type: 'number', min: 0, max: 1, step: 0.01, description: 'Reflection strength' }
        },
        land: {
          elevation: { type: 'number', min: 0, max: 20, step: 0.1, description: 'Terrain elevation', unit: 'units' },
          roughness: { type: 'number', min: 0, max: 3, step: 0.1, description: 'Terrain roughness' },
          scale: { type: 'number', min: 0.1, max: 8, step: 0.1, description: 'Terrain scale' },
          landColor: { type: 'color', description: 'Land color' },
          rockColor: { type: 'color', description: 'Rock color' },
          sandColor: { type: 'color', description: 'Sand color' },
          moisture: { type: 'number', min: 0, max: 1, step: 0.01, description: 'Moisture level' },
          islandRadius: { type: 'number', min: 5, max: 150, step: 1, description: 'Island radius', unit: 'units' },
          coastSmoothness: { type: 'number', min: 1, max: 30, step: 0.5, description: 'Coast smoothness' },
          seaLevel: { type: 'number', min: -15, max: 2, step: 0.1, description: 'Sea level', unit: 'units' }
        },
        sky: {
          turbidity: { type: 'number', min: 0, max: 20, step: 0.1, description: 'Atmospheric turbidity' },
          rayleigh: { type: 'number', min: 0, max: 4, step: 0.001, description: 'Rayleigh scattering coefficient' },
          mieCoefficient: { type: 'number', min: 0, max: 0.1, step: 0.001, description: 'Mie scattering coefficient' },
          mieDirectionalG: { type: 'number', min: 0, max: 1, step: 0.001, description: 'Mie scattering direction' },
          elevation: { type: 'number', min: -90, max: 90, step: 0.1, description: 'Sun elevation', unit: 'degrees' },
          azimuth: { type: 'number', min: -180, max: 180, step: 0.1, description: 'Sun azimuth', unit: 'degrees' },
          exposure: { type: 'number', min: 0, max: 1, step: 0.01, description: 'Sky exposure' }
        },
        lighting: {
          shadowMapSize: { type: 'number', min: 512, max: 8192, step: 512, description: 'Shadow map resolution', unit: 'pixels' },
          shadowRadius: { type: 'number', min: 1, max: 25, step: 1, description: 'Shadow radius', unit: 'units' },
          shadowBlur: { type: 'number', min: 1, max: 50, step: 1, description: 'Shadow blur amount' },
          sunIntensity: { type: 'number', min: 0, max: 3, step: 0.1, description: 'Sun light intensity' },
          ambientIntensity: { type: 'number', min: 0, max: 1, step: 0.01, description: 'Ambient light intensity' },
          shadowBias: { type: 'number', min: -0.01, max: 0.01, step: 0.0001, description: 'Shadow bias' }
        },
        camera: {
          position: { type: 'vector3', description: 'Camera position' },
          rotation: { type: 'euler', description: 'Camera rotation' },
          fov: { type: 'number', min: 10, max: 150, step: 1, description: 'Field of view', unit: 'degrees' },
          zoom: { type: 'number', min: 0.1, max: 5, step: 0.1, description: 'Camera zoom' },
          target: { type: 'vector3', description: 'Camera target' }
        },
        player: {
          walkSpeed: { type: 'number', min: 1, max: 20, step: 0.5, description: 'Walk speed', unit: 'units/s' },
          runSpeed: { type: 'number', min: 5, max: 40, step: 1, description: 'Run speed', unit: 'units/s' },
          jumpHeight: { type: 'number', min: 5, max: 30, step: 1, description: 'Jump height', unit: 'units' },
          mouseSensitivity: { type: 'number', min: 0.0001, max: 0.01, step: 0.0001, description: 'Mouse sensitivity' }
        }
      }
      
      return definitions[category]?.[parameterId] || { type: 'number', description: parameterId }
    } catch (error) {
      return { type: 'number', description: parameterId }
    }
  }

  public resetParameters(category?: string): void {
    if (!this.app.parameterManager) {
      console.error('❌ Parameter manager not available')
      return
    }
    
    if (category) {
      this.app.parameterManager.resetCategory(category as any)
      console.log(`🔄 ${category} parameters reset to defaults`)
    } else {
      this.app.parameterManager.resetAllToDefaults()
      console.log('🔄 All parameters reset to defaults')
    }
  }

  public exportParameters(): void {
    if (!this.app.parameterManager) {
      console.error('❌ Parameter manager not available')
      return
    }
    
    const json = this.app.parameterManager.exportParameters()
    console.log('📤 Parameters exported:')
    console.log(json)
  }

  /**
   * Test collision at arbitrary position
   */
  public testCollisionAt(x: number, y: number, z: number): void {
    if (!this.app.collisionSystem) {
      console.warn('❌ Collision system not available')
      return
    }
    
    console.log(`🎯 Testing collision at position: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`)
    this.app.collisionSystem.debugCollisionTest(new THREE.Vector3(x, y, z))
  }

  /**
   * Test collision at player's current position
   */
  public testCollisionAtPlayer(): void {
    if (!this.app.playerController || !this.app.collisionSystem) {
      console.warn('❌ Player controller or collision system not available')
      return
    }
    
    const position = this.app.playerController.getPosition()
    console.log(`🎯 Testing collision at player position: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`)
    this.app.collisionSystem.debugCollisionTest(position)
  }

  /**
   * Test collision at origin (0, 10, 0) where main terrain should be
   */
  public testCollisionAtOrigin(): void {
    if (!this.app.collisionSystem) {
      console.warn('❌ Collision system not available')
      return
    }
    
    console.log('🎯 Testing collision at origin (0, 10, 0) where main terrain should be')
    this.app.collisionSystem.debugCollisionTest(new THREE.Vector3(0, 10, 0))
    
    // Also test fallback method
    if (this.app.collisionSystem.getGroundHeightFallback) {
      const fallbackHeight = this.app.collisionSystem.getGroundHeightFallback(0, 0)
      console.log(`🔧 Fallback ground height at (0, 0): ${fallbackHeight.toFixed(2)}`)
    }
  }

  /**
   * Test collision system performance
   */
  public testCollisionPerformance(): void {
    if (!this.app.collisionSystem) {
      console.warn('❌ Collision system not available')
      return
    }
    
    console.log('🚀 Testing collision system performance...')
    
    const startTime = performance.now()
    const iterations = 100
    
    // Test multiple collision checks
    for (let i = 0; i < iterations; i++) {
      const x = (Math.random() - 0.5) * 100
      const z = (Math.random() - 0.5) * 100
      this.app.collisionSystem.checkCollision('test', new THREE.Vector3(x, 10, z))
    }
    
    const endTime = performance.now()
    const totalTime = endTime - startTime
    const avgTime = totalTime / iterations
    
    console.log(`⏱️ Performance test results:`)
    console.log(`  Total time: ${totalTime.toFixed(2)}ms`)
    console.log(`  Average time per collision check: ${avgTime.toFixed(3)}ms`)
    console.log(`  Collision checks per second: ${(1000 / avgTime).toFixed(0)}`)
    
    // Show collision system stats
    if (this.app.collisionSystem) {
      const stats = this.app.collisionSystem.getPerformanceStats()
      console.group('💥 Collision System Statistics')
      console.log(`Registered Objects: ${stats.registeredObjects}`)
      console.log(`Land Meshes: ${stats.landMeshes}`)
      console.log(`Cache Size: ${stats.cacheSize}`)
      console.log(`Cache Timeout: ${stats.cacheTimeout}ms`)
      console.log(`Collision Check Interval: ${stats.collisionCheckInterval}ms`)
      console.log(`Max Raycast Distance: ${stats.maxRaycastDistance} units`)
      console.groupEnd()
    }
  }

  /**
   * Test player movement and collision
   */
  public testPlayerMovement(): void {
    if (!this.app.playerController || !this.app.collisionSystem) {
      console.warn('❌ Player controller or collision system not available')
      return
    }
    
    console.group('🎮 Player Movement Test')
    
    // Test new player system
    const status = this.app.playerController.getStatus()
    console.log('Player Status:', status)
    
    const position = this.app.playerController.getPosition()
    const velocity = this.app.playerController.getVelocity()
    const onGround = this.app.playerController.isOnGround()
    const isMoving = this.app.playerController.isMoving()
    
    console.log(`Current Position: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`)
    console.log(`Current Velocity: (${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)})`)
    console.log(`On Ground: ${onGround}`)
    console.log(`Moving: ${isMoving}`)
    
    // Test input state
    console.log('Input State:', status.input)
    
    // Test collision at current position
    console.log('Testing collision at current position...')
    this.app.collisionSystem.debugCollisionTest(position)
    
    // Test collision slightly below current position
    const testPosition = position.clone()
    testPosition.y -= 1
    console.log('Testing collision 1 unit below current position...')
    this.app.collisionSystem.debugCollisionTest(testPosition)
    
    // Test collision at origin (where main terrain should be)
    console.log('Testing collision at origin (0, 10, 0)...')
    this.app.collisionSystem.debugCollisionTest(new THREE.Vector3(0, 10, 0))
    
    // Test collision at origin ground level
    console.log('Testing collision at origin ground level (0, 0, 0)...')
    this.app.collisionSystem.debugCollisionTest(new THREE.Vector3(0, 0, 0))
    
    // Test input system
    console.log('Testing input system...')
    console.log('Press W, A, S, D to move')
    console.log('Press Space to jump')
    console.log('Press Shift to run')
    
    // Enable debug wireframe
    this.app.playerController.setDebugVisible(true)
    console.log('Debug wireframe enabled')
    
    // Test manual movement
    console.log('Testing manual movement...')
    const testMovePosition = position.clone()
    testMovePosition.x += 1
    this.app.playerController.setPosition(testMovePosition)
    console.log(`Moved player to (${testMovePosition.x.toFixed(2)}, ${testMovePosition.y.toFixed(2)}, ${testMovePosition.z.toFixed(2)})`)
    
    console.groupEnd()
  }

  /**
   * Test parameter GUI functionality
   */
  public testParameterGUI(): void {
    if (!this.app.parameterManager) {
      console.warn('❌ Parameter manager not available')
      return
    }
    
    console.group('🎛️ Parameter GUI Test')
    
    // Test setting a parameter
    console.log('Testing parameter setting...')
    const testValue = Math.random() * 2
    this.app.parameterManager.setParameter('ocean', 'amplitude', testValue, 'test_setting')
    console.log(`Set ocean.amplitude to ${testValue}`)
    
    // Verify the parameter was set
    const retrievedValue = this.app.parameterManager.getParameter('ocean', 'amplitude')
    console.log(`Retrieved ocean.amplitude: ${retrievedValue}`)
    
    // Test getting all parameters for a category
    const oceanParams = this.app.parameterManager.getCategoryParameters('ocean')
    console.log(`Ocean parameters count: ${oceanParams.length}`)
    
    // Test parameter validation
    console.log('Testing parameter validation...')
    this.app.parameterManager.setParameter('ocean', 'amplitude', 5, 'test_validation') // Should be clamped to max
    const clampedValue = this.app.parameterManager.getParameter('ocean', 'amplitude')
    console.log(`After setting to 5 (should be clamped): ${clampedValue}`)
    
    // Reset to a reasonable value
    this.app.parameterManager.setParameter('ocean', 'amplitude', 0.5, 'test_reset')
    
    console.groupEnd()
  }

  /**
   * Test parameter integration with systems
   */
  public testParameterIntegration(): void {
    if (!this.app.parameterManager) {
      console.warn('❌ Parameter manager not available')
      return
    }
    
    console.group('🔗 Parameter Integration Test')
    
    // Test ocean parameter integration
    console.log('Testing ocean parameter integration...')
    const originalAmplitude = this.app.parameterManager.getParameter('ocean', 'amplitude')
    const newAmplitude = 1.5
    this.app.parameterManager.setParameter('ocean', 'amplitude', newAmplitude, 'integration_test')
    console.log(`Ocean amplitude changed from ${originalAmplitude} to ${newAmplitude}`)
    
    // Test land parameter integration
    console.log('Testing land parameter integration...')
    const originalElevation = this.app.parameterManager.getParameter('land', 'elevation')
    const newElevation = 10.0
    this.app.parameterManager.setParameter('land', 'elevation', newElevation, 'integration_test')
    console.log(`Land elevation changed from ${originalElevation} to ${newElevation}`)
    
    // Test player parameter integration
    console.log('Testing player parameter integration...')
    const originalWalkSpeed = this.app.parameterManager.getParameter('player', 'walkSpeed')
    const newWalkSpeed = 12.0
    this.app.parameterManager.setParameter('player', 'walkSpeed', newWalkSpeed, 'integration_test')
    console.log(`Player walk speed changed from ${originalWalkSpeed} to ${newWalkSpeed}`)
    
    // Reset parameters to reasonable values
    setTimeout(() => {
      this.app.parameterManager.setParameter('ocean', 'amplitude', originalAmplitude, 'integration_reset')
      this.app.parameterManager.setParameter('land', 'elevation', originalElevation, 'integration_reset')
      this.app.parameterManager.setParameter('player', 'walkSpeed', originalWalkSpeed, 'integration_reset')
      console.log('✅ Parameters reset to original values')
    }, 2000)
    
    console.groupEnd()
  }

  /**
   * Debug camera and player positioning
   */
  public debugCameraPlayerPosition(): void {
    if (!this.app.playerController || !this.app.cameraManager) {
      console.warn('❌ Player controller or camera manager not available')
      return
    }
    
    console.group('📷 Camera & Player Position Debug')
    
    // Get player information
    const playerPosition = this.app.playerController.getPosition()
    const playerVelocity = this.app.playerController.getVelocity()
    const playerMesh = this.app.playerController.getMesh()
    const playerOnGround = this.app.playerController.isOnGround()
    
    // Get camera information
    const cameraInfo = this.app.cameraManager.getCameraInfo()
    const currentCamera = this.app.cameraManager.getCurrentCamera()
    const currentMode = this.app.cameraManager.getCurrentMode()
    
    console.group('🎮 Player Information')
    console.log(`Position: (${playerPosition.x.toFixed(2)}, ${playerPosition.y.toFixed(2)}, ${playerPosition.z.toFixed(2)})`)
    console.log(`Velocity: (${playerVelocity.x.toFixed(2)}, ${playerVelocity.y.toFixed(2)}, ${playerVelocity.z.toFixed(2)})`)
    console.log(`Mesh Position: (${playerMesh.position.x.toFixed(2)}, ${playerMesh.position.y.toFixed(2)}, ${playerMesh.position.z.toFixed(2)})`)
    console.log(`On Ground: ${playerOnGround}`)
    console.groupEnd()
    
    console.group('📷 Camera Information')
    console.log(`Current Mode: ${currentMode}`)
    console.log(`Camera Position: (${currentCamera.position.x.toFixed(2)}, ${currentCamera.position.y.toFixed(2)}, ${currentCamera.position.z.toFixed(2)})`)
    console.log(`Camera Rotation: (${currentCamera.rotation.x.toFixed(3)}, ${currentCamera.rotation.y.toFixed(3)}, ${currentCamera.rotation.z.toFixed(3)})`)
    console.log(`Is Transitioning: ${cameraInfo.isTransitioning}`)
    console.groupEnd()
    
    // Calculate differences
    const positionDiff = playerPosition.clone().sub(currentCamera.position)
    const meshDiff = playerMesh.position.clone().sub(currentCamera.position)
    
    console.group('🔍 Position Analysis')
    console.log(`Player to Camera Distance: ${positionDiff.length().toFixed(2)} units`)
    console.log(`Mesh to Camera Distance: ${meshDiff.length().toFixed(2)} units`)
    console.log(`Expected Camera Height: ${playerPosition.y + 1.6} (player Y + 1.6)`)
    console.log(`Actual Camera Height: ${currentCamera.position.y}`)
    console.groupEnd()
    
    console.groupEnd()
  }

  public testLandCollision(): void {
    console.group('🏔️ Land Collision Test')
    
    if (!this.app.collisionSystem) {
      console.log('❌ Collision system not available')
      console.groupEnd()
      return
    }

    const landMeshes = this.app.collisionSystem.getLandMeshes()
    console.log(`📊 Land meshes available: ${landMeshes.length}`)
    
    if (landMeshes.length === 0) {
      console.warn('⚠️ No land meshes registered! This is why the player falls through!')
      console.log('🔍 Debugging land mesh registration...')
      
      // Check if land system exists
      if (this.app.landSystem) {
        const landPieces = this.app.landSystem.getLandPieces()
        console.log(`🏔️ Land system has ${landPieces.length} pieces:`)
        landPieces.forEach((piece: any, index: number) => {
          console.log(`  ${index}: ${piece.id} (${piece.type}) at (${piece.mesh.position.x.toFixed(1)}, ${piece.mesh.position.y.toFixed(1)}, ${piece.mesh.position.z.toFixed(1)})`)
        })
      } else {
        console.log('❌ Land system not available!')
      }
      
      console.groupEnd()
      return
    }

    // Test positions
    const testPositions = [
      { name: 'Origin', pos: new THREE.Vector3(0, 0, 0) },
      { name: 'Above Ground', pos: new THREE.Vector3(0, 5, 0) },
      { name: 'Player Height', pos: new THREE.Vector3(0, 1.8, 0) },
      { name: 'Hill Area', pos: new THREE.Vector3(30, 5, 30) },
      { name: 'Rocky Area', pos: new THREE.Vector3(-40, 5, 20) }
    ]

    for (const test of testPositions) {
      console.group(`🧪 Testing: ${test.name} at (${test.pos.x.toFixed(1)}, ${test.pos.y.toFixed(1)}, ${test.pos.z.toFixed(1)})`)
      
      // Test collision with player capsule
      const collision = this.app.collisionSystem.checkCollision('player', test.pos)
      console.log(`Collision: ${collision.hasCollision ? 'YES' : 'NO'}`)
      if (collision.hasCollision) {
        console.log(`  Penetration: ${collision.penetrationDepth.toFixed(3)}`)
        console.log(`  Normal: (${collision.normal.x.toFixed(2)}, ${collision.normal.y.toFixed(2)}, ${collision.normal.z.toFixed(2)})`)
        console.log(`  Corrected: (${collision.correctedPosition.x.toFixed(2)}, ${collision.correctedPosition.y.toFixed(2)}, ${collision.correctedPosition.z.toFixed(2)})`)
      }
      
      console.groupEnd()
    }

    console.groupEnd()
  }

  public testCollisionAtPosition(x: number, y: number, z: number): void {
    console.group(`🧪 Testing Collision at Position (${x}, ${y}, ${z})`)
    
    if (!this.app.collisionSystem) {
      console.log('❌ Collision system not available')
      console.groupEnd()
      return
    }

    // Test collision with player capsule
    const collision = this.app.collisionSystem.checkCollision('player', new THREE.Vector3(x, y, z))
    console.log(`Collision: ${collision.hasCollision ? 'YES' : 'NO'}`)
    if (collision.hasCollision) {
      console.log(`  Penetration: ${collision.penetrationDepth.toFixed(3)}`)
      console.log(`  Normal: (${collision.normal.x.toFixed(2)}, ${collision.normal.y.toFixed(2)}, ${collision.normal.z.toFixed(2)})`)
      console.log(`  Corrected: (${collision.correctedPosition.x.toFixed(2)}, ${collision.correctedPosition.y.toFixed(2)}, ${collision.correctedPosition.z.toFixed(2)})`)
    }

    // Test ground height
    const groundHeight = this.app.collisionSystem.getGroundHeight(x, z)
    console.log(`Ground Height: ${groundHeight.toFixed(2)}`)
    console.log(`Distance to Ground: ${(y - groundHeight).toFixed(2)}`)

    // Test land meshes
    const landMeshes = this.app.collisionSystem.getLandMeshes()
    console.log(`Land Meshes: ${landMeshes.length}`)
    
    landMeshes.forEach((info: any, index: number) => {
      const mesh = info.mesh
      const bbox = info.boundingBox
      const center = new THREE.Vector3()
      bbox.getCenter(center)
      const distance = new THREE.Vector3(x, y, z).distanceTo(center)
      console.log(`  ${index}: ${mesh.userData.id} - distance: ${distance.toFixed(2)}`)
    })

    console.groupEnd()
  }

  public testGroundDetection(): void {
    console.group('🌊 Ground Detection Test')
    
    if (!this.app.playerController) {
      console.log('❌ Player controller not available')
      console.groupEnd()
      return
    }
    
    // Test collision system directly
    if (this.app.collisionSystem) {
      console.log('🧪 Testing collision system directly...')
      const testPos = new THREE.Vector3(0, 10, 0)
      this.app.collisionSystem.debugCollisionTest(testPos)
    }

    const position = this.app.playerController.getPosition()
    const velocity = this.app.playerController.getVelocity()
    const onGround = this.app.playerController.isOnGround()
    
    console.log(`Current Position: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`)
    console.log(`Current Velocity: (${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)})`)
    console.log(`On Ground: ${onGround}`)
    
    // Test ground height at current position
    if (this.app.collisionSystem) {
      const groundHeight = this.app.collisionSystem.getGroundHeight(position.x, position.z)
      const playerBottomY = position.y - (1.8 / 2 - 0.5) // Player height/2 - radius
      const distanceToGround = playerBottomY - groundHeight
      
      console.log(`Ground Height: ${groundHeight.toFixed(2)}`)
      console.log(`Player Bottom Y: ${playerBottomY.toFixed(2)}`)
      console.log(`Distance to Ground: ${distanceToGround.toFixed(2)}`)
      console.log(`Ground Tolerance: ${0.6 * 2} (doubled from 0.6)`)
      
      if (distanceToGround <= 0.6 * 2 && velocity.y <= 0.5) {
        console.log('✅ Should be on ground')
      } else {
        console.log('❌ Should not be on ground')
      }
    }
    
    console.groupEnd()
  }

  // ============================================================================
  // RETRO POST-PROCESSING COMMANDS
  // ============================================================================

  public setRetroEnabled(enabled: boolean): void {
    if (!this.app.retroPostProcessing) {
      console.error('❌ Retro post-processing system not available')
      return
    }
    this.app.retroPostProcessing.setEnabled(enabled)
    console.log(`🎮 Retro post-processing ${enabled ? 'enabled' : 'disabled'}`)
  }

  public setRetroPixelSize(size: number): void {
    if (!this.app.retroPostProcessing) {
      console.error('❌ Retro post-processing system not available')
      return
    }
    if (size < 1.0) {
      console.error('❌ Pixel size must be >= 1.0')
      return
    }
    this.app.retroPostProcessing.setPixelSize(size)
    console.log(`🎮 Retro pixel size set to ${size}`)
  }

  public setRetroColorLevels(levels: number): void {
    if (!this.app.retroPostProcessing) {
      console.error('❌ Retro post-processing system not available')
      return
    }
    if (levels < 2) {
      console.error('❌ Color levels must be >= 2')
      return
    }
    this.app.retroPostProcessing.setColorLevels(levels)
    console.log(`🎮 Retro color levels set to ${levels}`)
  }

  public setRetroDitherAmount(amount: number): void {
    if (!this.app.retroPostProcessing) {
      console.error('❌ Retro post-processing system not available')
      return
    }
    if (amount < 0 || amount > 1) {
      console.error('❌ Dither amount must be between 0 and 1')
      return
    }
    this.app.retroPostProcessing.setDitherAmount(amount)
    console.log(`🎮 Retro dither amount set to ${amount}`)
  }

  public setRetroResolutionScale(scale: number): void {
    if (!this.app.retroPostProcessing) {
      console.error('❌ Retro post-processing system not available')
      return
    }
    if (scale < 0.25 || scale > 1.0) {
      console.error('❌ Resolution scale must be between 0.25 and 1.0')
      return
    }
    this.app.retroPostProcessing.setResolutionScale(scale)
    console.log(`🎮 Retro resolution scale set to ${scale}`)
  }

  public getRetroConfig(): void {
    if (!this.app.retroPostProcessing) {
      console.error('❌ Retro post-processing system not available')
      return
    }
    const config = this.app.retroPostProcessing.getConfig()
    console.group('🎮 Retro Post-Processing Config')
    console.log(`Enabled: ${config.enabled}`)
    console.log(`Pixel Size: ${config.pixelSize}`)
    console.log(`Color Levels: ${config.colorLevels}`)
    console.log(`Dither Amount: ${config.ditherAmount}`)
    console.log(`Contrast: ${config.contrast}`)
    console.log(`Saturation: ${config.saturation}`)
    console.log(`Resolution Scale: ${config.resolutionScale}`)
    console.groupEnd()
  }

  public applyFlatShading(): void {
    console.group('🎨 Applying Flat Shading to All Materials')
    let count = 0
    
    this.app.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const material = object.material
        
        if (material instanceof THREE.MeshStandardMaterial) {
          material.flatShading = true
          material.needsUpdate = true
          count++
        } else if (material instanceof THREE.MeshLambertMaterial) {
          material.flatShading = true
          material.needsUpdate = true
          count++
        } else if (material instanceof THREE.MeshPhongMaterial) {
          material.flatShading = true
          material.needsUpdate = true
          count++
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
          count++
        }
      }
    })
    
    console.log(`✅ Applied flat shading to ${count} materials`)
    console.groupEnd()
  }

  // ============================================================================
  // OBJECT POSITION EXPORT/IMPORT COMMANDS
  // ============================================================================

  /**
   * Export current object positions to JSON format for committing to codebase
   */
  public exportObjectPositions(): void {
    console.group('📤 Exporting Object Positions')
    
    const positions: { [key: string]: { position: [number, number, number], rotation: [number, number, number] } } = {}
    
    this.app.objectManager.getAllObjects().forEach((obj) => {
      const pos = obj.persistentState.position
      const rot = obj.persistentState.rotation
      
      positions[obj.id] = {
        position: [pos.x, pos.y, pos.z],
        rotation: [rot.x, rot.y, rot.z]
      }
    })
    
    const jsonString = JSON.stringify(positions, null, 2)
    
    console.log('📋 Copy this JSON and paste it into src/config/objectPositions.json:')
    console.log('')
    console.log(jsonString)
    console.log('')
    console.log('💡 After updating the file, commit and push to apply positions to deployed version')
    console.groupEnd()
    
    // Also copy to clipboard if available
    if (navigator.clipboard) {
      navigator.clipboard.writeText(jsonString).then(() => {
        console.log('✅ JSON copied to clipboard!')
      }).catch(() => {
        console.warn('⚠️ Could not copy to clipboard, please copy manually')
      })
    }
  }

  /**
   * Show current positions vs default positions
   */
  public compareObjectPositions(): void {
    console.group('🔍 Comparing Current vs Default Positions')
    
    this.app.objectManager.getAllObjects().forEach((obj) => {
      const currentPos = obj.persistentState.position
      const currentRot = obj.persistentState.rotation
      
      console.log(`\n${obj.id}:`)
      console.log(`  Current Position: [${currentPos.x.toFixed(2)}, ${currentPos.y.toFixed(2)}, ${currentPos.z.toFixed(2)}]`)
      console.log(`  Current Rotation: [${currentRot.x.toFixed(4)}, ${currentRot.y.toFixed(4)}, ${currentRot.z.toFixed(4)}]`)
    })
    
    console.log('\n💡 Use exportObjectPositions() to export current positions to JSON')
    console.groupEnd()
  }
} 