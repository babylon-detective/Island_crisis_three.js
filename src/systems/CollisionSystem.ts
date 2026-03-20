import * as THREE from 'three'
import { logger, LogModule } from './Logger'
import { HeightmapCollider } from './HeightmapCollider'

export interface CollisionVolume {
  type: 'box' | 'sphere' | 'capsule'
  position: THREE.Vector3
  rotation: THREE.Euler
  dimensions: THREE.Vector3 // For box: width, height, depth; For sphere: radius, 0, 0; For capsule: radius, height, 0
}

export interface CollisionResult {
  hasCollision: boolean
  penetrationDepth: number
  normal: THREE.Vector3
  correctedPosition: THREE.Vector3
}

export interface CollidableObject {
  id: string
  mesh: THREE.Mesh
  collisionVolume: CollisionVolume
  isStatic: boolean // Static objects don't move when colliding
}

interface GroundHeightCache {
  x: number
  z: number
  height: number
  timestamp: number
}

interface LandMeshInfo {
  mesh: THREE.Mesh
  boundingBox: THREE.Box3
  priority: number // Higher priority = checked first
}

export class CollisionSystem {
  private collidableObjects: Map<string, CollidableObject> = new Map()
  private landMeshes: LandMeshInfo[] = []
  private landMeshObjects: THREE.Mesh[] = []
  private heightmaps: HeightmapCollider[] = [] // Baked heightmap colliders for GLB models
  private raycaster: THREE.Raycaster = new THREE.Raycaster()
  private tempVector: THREE.Vector3 = new THREE.Vector3()
  private tempVector2: THREE.Vector3 = new THREE.Vector3()
  private tempQuaternion: THREE.Quaternion = new THREE.Quaternion()
  private tempNormal: THREE.Vector3 = new THREE.Vector3()
  private tempBox: THREE.Box3 = new THREE.Box3()

  // Cached vectors for capsule collision (avoids per-frame allocations)
  private readonly _capsulePoints: THREE.Vector3[] = Array.from({ length: 7 }, () => new THREE.Vector3())
  private readonly _capsuleNormal: THREE.Vector3 = new THREE.Vector3()
  private readonly _capsuleCorrected: THREE.Vector3 = new THREE.Vector3()
  // Cached ray directions for point collision (static, never change)
  private static readonly RAY_DIRECTIONS: ReadonlyArray<THREE.Vector3> = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 1, 0),
  ]
  private readonly _ptColNormal: THREE.Vector3 = new THREE.Vector3()
  private readonly _ptColCorrected: THREE.Vector3 = new THREE.Vector3()
  private readonly _noColNormal: THREE.Vector3 = new THREE.Vector3(0, 1, 0)

  // Performance optimizations
  private groundHeightCache: Map<string, GroundHeightCache> = new Map()
  private cacheTimeout: number = 500 // Increased cache time to 500ms
  private lastCollisionCheck: number = 0
  private collisionCheckInterval: number = 32 // Reduced to 30fps collision checks
  private maxRaycastDistance: number = 200 // Increased to check land within 200 units
  private playerPosition: THREE.Vector3 = new THREE.Vector3()
  private lastPlayerPosition: THREE.Vector3 = new THREE.Vector3()
  private positionThreshold: number = 0.1 // Only update if player moved more than 0.1 units
  
  // ============================================================================
  // COLLISION HEIGHT OFFSET - ADJUST THIS TO MATCH LAND MESH SURFACE
  // ============================================================================
  // Increase this value to raise collision detection higher (positive = up)
  // Decrease this value to lower collision detection (negative = down)
  // Raycast already returns the actual surface intersection Y — no offset needed.
  // You can also adjust at runtime using: collisionSystem.setGroundHeightOffset(value)
  private groundHeightOffset: number = 0

  constructor() {
    logger.info(LogModule.COLLISION, 'CollisionSystem initialized with performance optimizations')
  }

  // ============================================================================
  // HEIGHTMAP REGISTRATION
  // ============================================================================

  /**
   * Register a pre-baked heightmap collider for fast ground-height queries.
   * Heightmaps are checked before raycasting against land meshes.
   */
  public registerHeightmap(heightmap: HeightmapCollider): void {
    this.heightmaps.push(heightmap)
    logger.info(LogModule.COLLISION, `Registered heightmap "${heightmap.id}" (${heightmap.cols}×${heightmap.rows})`)
  }

  /**
   * Re-bake a specific heightmap by id (call after model transform changes).
   */
  public async rebakeHeightmap(id: string): Promise<boolean> {
    const hm = this.heightmaps.find(h => h.id === id)
    if (!hm) {
      console.warn(`⚠️ No heightmap with id "${id}" registered`)
      return false
    }
    // Clear ground height cache since bounds/values changed
    this.groundHeightCache.clear()
    return await hm.rebake()
  }

  /**
   * Re-bake all registered heightmaps (call after bulk transform changes).
   */
  public async rebakeAllHeightmaps(): Promise<void> {
    this.groundHeightCache.clear()
    for (const hm of this.heightmaps) {
      await hm.rebake()
    }
    logger.info(LogModule.COLLISION, `Re-baked ${this.heightmaps.length} heightmap(s)`)
  }

  // ============================================================================
  // OBJECT REGISTRATION
  // ============================================================================

  public registerObject(object: CollidableObject): void {
    this.collidableObjects.set(object.id, object)
    logger.debug(LogModule.COLLISION, `Registered collidable object: ${object.id}`)
  }

  public unregisterObject(id: string): void {
    this.collidableObjects.delete(id)
    logger.debug(LogModule.COLLISION, `Unregistered collidable object: ${id}`)
  }

  public registerLandMeshes(meshes: THREE.Mesh[]): void {
    console.log(`🏔️ CollisionSystem.registerLandMeshes() called with ${meshes.length} meshes`)
    
    // Filter out ocean meshes - only register actual land terrain
    // Note: Using imported model geometry directly - no separate collision meshes
    const landMeshes = meshes.filter(mesh => {
      const userData = mesh.userData
      // Include meshes that are explicitly marked as land
      const isLand = userData.type === 'land' || 
                     userData.landType === 'plane' || 
                     userData.landType === 'box' ||
                     userData.landType === 'sphere' ||
                     userData.landType === 'cylinder'
      
      return isLand
    })
    
    // Create optimized land mesh info with bounding boxes and priorities
    this.landMeshes = landMeshes.map(mesh => {
      const boundingBox = new THREE.Box3().setFromObject(mesh)
      let priority = 1
      
      // Store mesh info for debugging (one-time log)
      const size = boundingBox.getSize(new THREE.Vector3())
      console.log(`🏔️ Land mesh: ${mesh.userData.id} at (${mesh.position.x.toFixed(1)}, ${mesh.position.y.toFixed(1)}, ${mesh.position.z.toFixed(1)}) size: ${size.x.toFixed(1)}x${size.z.toFixed(1)}`)
      
      // Prioritize main terrain (usually at origin)
      if (mesh.userData.id === 'main-terrain') {
        priority = 10
      }
      // Prioritize larger meshes (more likely to be ground)
      else if (boundingBox.getSize(this.tempVector).x > 50) {
        priority = 5
      }
      
      return {
        mesh,
        boundingBox,
        priority
      }
    }).sort((a, b) => b.priority - a.priority) // Sort by priority (highest first)

    this.landMeshObjects = this.landMeshes.map(info => info.mesh)
    
    logger.info(LogModule.COLLISION, `Registered ${this.landMeshes.length} land meshes for collision detection`)
    
    // Log details about registered meshes for debugging
    this.landMeshes.forEach((info, index) => {
      logger.info(LogModule.COLLISION, `Land mesh ${index}: ${info.mesh.userData.id} (${info.mesh.userData.type}) priority=${info.priority} at (${info.mesh.position.x.toFixed(1)}, ${info.mesh.position.y.toFixed(1)}, ${info.mesh.position.z.toFixed(1)})`)
    })
    
    // Clear cache when land meshes change
    this.groundHeightCache.clear()
    
    if (this.landMeshes.length === 0) {
      logger.warn(LogModule.COLLISION, 'No land meshes registered! Player will fall through terrain.')
    }
  }

  /**
   * Refresh land meshes - update bounding boxes and clear cache
   * Call this when land meshes are modified (position, scale, etc.)
   */
  public refreshLandMeshes(): void {
    // Update bounding boxes for all registered land meshes
    this.landMeshes.forEach(info => {
      info.boundingBox.setFromObject(info.mesh)
    })
    
    // Clear cache to force recalculation
    this.groundHeightCache.clear()
    
    logger.info(LogModule.COLLISION, `Refreshed ${this.landMeshes.length} land meshes - updated bounding boxes and cleared cache`)
  }

  /**
   * Update land mesh bounding boxes and cache
   * Call this when land parameters change (elevation, roughness, etc.)
   */
  public updateLandMesh(meshId: string): void {
    const landMeshInfo = this.landMeshes.find(info => info.mesh.userData.id === meshId)
    if (landMeshInfo) {
      // Update bounding box for this specific mesh
      landMeshInfo.boundingBox.setFromObject(landMeshInfo.mesh)
      
      // Clear cache to force recalculation
      this.groundHeightCache.clear()
      
      logger.debug(LogModule.COLLISION, `Updated land mesh: ${meshId} - refreshed bounding box and cleared cache`)
    } else {
      logger.warn(LogModule.COLLISION, `Land mesh not found for update: ${meshId}`)
    }
  }

  // ============================================================================
  // COLLISION DETECTION
  // ============================================================================

  /**
   * Check collision for a specific object at a given position
   */
  public checkCollision(objectId: string, newPosition: THREE.Vector3): CollisionResult {
    const object = this.collidableObjects.get(objectId)
    if (!object) {
      return {
        hasCollision: false,
        penetrationDepth: 0,
        normal: new THREE.Vector3(0, 1, 0),
        correctedPosition: newPosition.clone()
      }
    }

    // Check collision with land
    const landCollision = this.checkLandCollision(object.collisionVolume, newPosition)
    
    // Check collision with other objects
    const objectCollision = this.checkObjectCollisions(objectId, object.collisionVolume, newPosition)

    // Combine results (prioritize land collision)
    if (landCollision.hasCollision) {
      return landCollision
    } else if (objectCollision.hasCollision) {
      return objectCollision
    }

    return {
      hasCollision: false,
      penetrationDepth: 0,
      normal: new THREE.Vector3(0, 1, 0),
      correctedPosition: newPosition.clone()
    }
  }

  /**
   * Check collision with land meshes (optimized)
   */
  private checkLandCollision(volume: CollisionVolume, position: THREE.Vector3): CollisionResult {
    if (this.landMeshes.length === 0) {
      return {
        hasCollision: false,
        penetrationDepth: 0,
        normal: new THREE.Vector3(0, 1, 0),
        correctedPosition: position.clone()
      }
    }

    switch (volume.type) {
      case 'capsule':
        return this.checkCapsuleLandCollision(volume, position)
      case 'box':
        return this.checkBoxLandCollision(volume, position)
      case 'sphere':
        return this.checkSphereLandCollision(volume, position)
      default:
        return {
          hasCollision: false,
          penetrationDepth: 0,
          normal: new THREE.Vector3(0, 1, 0),
          correctedPosition: position.clone()
        }
    }
  }

  /**
   * Check capsule collision with land (improved with proper mesh collision)
   */
  private checkCapsuleLandCollision(volume: CollisionVolume, position: THREE.Vector3): CollisionResult {
    const radius = volume.dimensions.x
    const height = volume.dimensions.y
    const halfHeight = height * 0.5

    // Reuse cached check-point vectors instead of allocating new ones
    const cp = this._capsulePoints
    cp[0].set(position.x, position.y + halfHeight - radius, position.z) // top
    cp[1].set(position.x, position.y, position.z)                      // center
    cp[2].set(position.x, position.y - halfHeight + radius, position.z) // bottom
    cp[3].set(position.x + radius, position.y, position.z)             // +X
    cp[4].set(position.x - radius, position.y, position.z)             // -X
    cp[5].set(position.x, position.y, position.z + radius)             // +Z
    cp[6].set(position.x, position.y, position.z - radius)             // -Z

    let maxPenetration = 0
    this._capsuleNormal.set(0, 1, 0)
    let hasAnyCollision = false

    for (let i = 0; i < 7; i++) {
      const collision = this.checkPointCollision(cp[i], radius)
      if (collision.hasCollision && collision.penetrationDepth > maxPenetration) {
        maxPenetration = collision.penetrationDepth
        this._capsuleNormal.copy(collision.normal)
        hasAnyCollision = true
      }
    }

    if (hasAnyCollision) {
      this._capsuleCorrected.copy(position)
      this._capsuleCorrected.addScaledVector(this._capsuleNormal, maxPenetration)

      return {
        hasCollision: true,
        penetrationDepth: maxPenetration,
        normal: this._capsuleNormal,
        correctedPosition: this._capsuleCorrected
      }
    }

    return {
      hasCollision: false,
      penetrationDepth: 0,
      normal: this._noColNormal,
      correctedPosition: position
    }
  }

  /**
   * Check if a point collides with any land mesh
   */
  private checkPointCollision(point: THREE.Vector3, radius: number): CollisionResult {
    if (this.landMeshes.length === 0) {
      return {
        hasCollision: false,
        penetrationDepth: 0,
        normal: this._noColNormal,
        correctedPosition: point
      }
    }

    // First, try to get ground height using the existing method
    const groundHeight = this.getGroundHeightOptimized(point.x, point.z)
    
    // CRITICAL FIX: Check if point is below ground + radius (proper sphere collision)
    if (point.y < groundHeight + radius) {
      const penetration = (groundHeight + radius) - point.y
      this._ptColCorrected.copy(point)
      this._ptColCorrected.y = groundHeight + radius
      
      return {
        hasCollision: true,
        penetrationDepth: penetration,
        normal: this._noColNormal,
        correctedPosition: this._ptColCorrected
      }
    }

    // Raycast in cardinal directions for wall collisions
    const dirs = CollisionSystem.RAY_DIRECTIONS
    let bestPenetration = 0
    let hasWallCollision = false

    const allMeshes = this.landMeshes.map(info => info.mesh)

    for (const direction of dirs) {
      this.raycaster.set(point, direction)
      const intersects = this.raycaster.intersectObjects(allMeshes, true)

      for (const intersect of intersects) {
        const distance = intersect.distance
        if (distance <= radius) {
          const penetration = radius - distance
          if (penetration > bestPenetration) {
            bestPenetration = penetration
            hasWallCollision = true
            if (intersect.face) {
              this._ptColNormal.copy(intersect.face.normal)
              intersect.object.getWorldQuaternion(this.tempQuaternion)
              this._ptColNormal.applyQuaternion(this.tempQuaternion)
            } else {
              this._ptColNormal.copy(direction)
            }
            this._ptColCorrected.copy(point).addScaledVector(direction, penetration)
          }
        }
      }
    }

    if (hasWallCollision) {
      return {
        hasCollision: true,
        penetrationDepth: bestPenetration,
        normal: this._ptColNormal,
        correctedPosition: this._ptColCorrected
      }
    }

    return {
      hasCollision: false,
      penetrationDepth: 0,
      normal: this._noColNormal,
      correctedPosition: point
    }
  }

  /**
   * Check box collision with land (optimized)
   */
  private checkBoxLandCollision(volume: CollisionVolume, position: THREE.Vector3): CollisionResult {
    // Only check center point for performance
    const groundHeight = this.getGroundHeightOptimized(position.x, position.z)
    const halfHeight = volume.dimensions.y * 0.5
    const penetration = groundHeight - (position.y - halfHeight)

    if (penetration > 0) {
      const correctedPosition = position.clone()
      correctedPosition.y += penetration

      return {
        hasCollision: true,
        penetrationDepth: penetration,
        normal: new THREE.Vector3(0, 1, 0),
        correctedPosition
      }
    }

    return {
      hasCollision: false,
      penetrationDepth: 0,
      normal: new THREE.Vector3(0, 1, 0),
      correctedPosition: position.clone()
    }
  }

  /**
   * Check sphere collision with land (optimized)
   */
  private checkSphereLandCollision(volume: CollisionVolume, position: THREE.Vector3): CollisionResult {
    const radius = volume.dimensions.x
    const groundHeight = this.getGroundHeightOptimized(position.x, position.z)
    const penetration = groundHeight - (position.y - radius)

    if (penetration > 0) {
      const correctedPosition = position.clone()
      correctedPosition.y = groundHeight + radius // CRITICAL FIX: Set absolute position at ground level

      return {
        hasCollision: true,
        penetrationDepth: penetration,
        normal: new THREE.Vector3(0, 1, 0),
        correctedPosition
      }
    }

    return {
      hasCollision: false,
      penetrationDepth: 0,
      normal: new THREE.Vector3(0, 1, 0),
      correctedPosition: position.clone()
    }
  }

  /**
   * Check collisions with other objects
   */
  private checkObjectCollisions(objectId: string, volume: CollisionVolume, position: THREE.Vector3): CollisionResult {
    // TODO: Implement object-to-object collision detection
    // For now, return no collision
    return {
      hasCollision: false,
      penetrationDepth: 0,
      normal: new THREE.Vector3(0, 1, 0),
      correctedPosition: position.clone()
    }
  }

  // ============================================================================
  // OPTIMIZED GROUND HEIGHT CALCULATION
  // ============================================================================

  /**
   * Get ground height using raycasting for exact mesh surface detection
   * CRITICAL: Only uses top surface intersections (highest Y value)
   * Uses mesh world matrix to ensure correct coordinate transformation
   */
  private getGroundHeightOptimized(x: number, z: number): number {
    if (this.landMeshes.length === 0 && this.heightmaps.length === 0) {
      return -2.0 // Ocean surface level
    }

    // ── 0. Check cache first ──
    const now = performance.now()
    const cacheKey = `${Math.round(x * 10)}_${Math.round(z * 10)}`
    const cached = this.groundHeightCache.get(cacheKey)
    if (cached && (now - cached.timestamp) < this.cacheTimeout) {
      return cached.height
    }

    let maxGroundHeight = -2.0 // Start with ocean surface level

    // ── 1. Check baked heightmaps first (O(1) per heightmap) ──
    for (const hm of this.heightmaps) {
      const h = hm.getHeight(x, z)
      if (h !== null && h > maxGroundHeight) {
        maxGroundHeight = h
      }
    }
    
    // ── 2. Check raycasted land meshes ──
    
    // Use raycasting to get exact surface height at this point
    const allMeshes = this.landMeshObjects
    
    // Find the highest bounding box to start raycast from
    let highestY = -2.0
    for (const info of this.landMeshes) {
      const boundingBox = info.boundingBox
      if (x >= boundingBox.min.x && x <= boundingBox.max.x &&
          z >= boundingBox.min.z && z <= boundingBox.max.z) {
        highestY = Math.max(highestY, boundingBox.max.y)
      }
    }
    
    // If we found a mesh in bounds, raycast down to get exact surface
    if (highestY > -2.0) {
      // Cast from well above the mesh to ensure we hit the top surface
      const rayStartY = Math.max(highestY + 200, 500)
      this.tempVector.set(x, rayStartY, z)
      this.tempVector2.set(0, -1, 0) // Cast straight down
      
      this.raycaster.set(this.tempVector, this.tempVector2)
      const intersects = this.raycaster.intersectObjects(allMeshes, true)
      
      if (intersects.length > 0) {
        let topIntersection: THREE.Intersection | null = null
        let bestY = -Infinity
        
        for (const intersect of intersects) {
          const worldY = intersect.point.y
          
          // Check if this is a top surface (normal pointing up)
          let isTopSurface = true
          if (intersect.face) {
            const worldNormal = this.tempNormal.copy(intersect.face.normal)
            if (intersect.object instanceof THREE.Mesh) {
              intersect.object.getWorldQuaternion(this.tempQuaternion)
              worldNormal.applyQuaternion(this.tempQuaternion)
            }
            isTopSurface = worldNormal.y > 0.5
          }
          
          if (isTopSurface && worldY > bestY) {
            bestY = worldY
            topIntersection = intersect
          }
        }
        
        if (topIntersection) {
          maxGroundHeight = topIntersection.point.y
        } else {
          for (const intersect of intersects) {
            if (intersect.point.y > maxGroundHeight) {
              maxGroundHeight = intersect.point.y
            }
          }
        }
      } else {
        // Fallback to bounding box if raycast fails
        for (const info of this.landMeshes) {
          const boundingBox = info.boundingBox
          if (x >= boundingBox.min.x && x <= boundingBox.max.x &&
              z >= boundingBox.min.z && z <= boundingBox.max.z) {
            maxGroundHeight = Math.max(maxGroundHeight, boundingBox.max.y)
          }
        }
      }
    }
    
    const result = maxGroundHeight + this.groundHeightOffset

    // ── 3. Write to cache ──
    this.groundHeightCache.set(cacheKey, { x, z, height: result, timestamp: now })
    // Prune cache periodically to avoid unbounded growth
    if (this.groundHeightCache.size > 200) {
      const cutoff = now - this.cacheTimeout
      for (const [k, v] of this.groundHeightCache) {
        if (v.timestamp < cutoff) this.groundHeightCache.delete(k)
      }
    }

    return result
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    const now = performance.now()
    for (const [key, entry] of this.groundHeightCache.entries()) {
      if ((now - entry.timestamp) > this.cacheTimeout * 2) {
        this.groundHeightCache.delete(key)
      }
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Update all dynamic objects (apply gravity, resolve collisions) - optimized
   */
  public updateDynamicObjects(deltaTime: number): void {
    const now = performance.now()
    
    // Throttle collision checks for better performance
    if (now - this.lastCollisionCheck < this.collisionCheckInterval) {
      return
    }
    
    this.lastCollisionCheck = now

    for (const [id, object] of this.collidableObjects) {
      // Skip player - player controller handles its own physics
      if (id === 'player') {
        continue
      }
      
      if (!object.isStatic) {
        // Apply gravity
        const currentPosition = object.mesh.position.clone()
        currentPosition.y -= 9.81 * deltaTime // Simple gravity

        // Check collision and correct position
        const collision = this.checkCollision(id, currentPosition)
        
        if (collision.hasCollision) {
          object.mesh.position.copy(collision.correctedPosition)
        } else {
          object.mesh.position.copy(currentPosition)
        }
      }
    }
  }

  /**
   * Update player position for optimization
   */
  public updatePlayerPosition(position: THREE.Vector3): void {
    this.lastPlayerPosition.copy(this.playerPosition)
    this.playerPosition.copy(position)
  }

  /**
   * Check if player has moved significantly enough to warrant collision checks
   */
  public shouldCheckCollision(): boolean {
    return this.playerPosition.distanceTo(this.lastPlayerPosition) > this.positionThreshold
  }

  /**
   * Create a debug wireframe for a collision volume
   */
  public createDebugWireframe(volume: CollisionVolume, color: number = 0x00ff00): THREE.Object3D {
    let geometry: THREE.BufferGeometry

    switch (volume.type) {
      case 'capsule':
        // Create capsule wireframe (cylinder + 2 spheres)
        const group = new THREE.Group()
        
        // Cylinder body
        const cylinderGeometry = new THREE.CylinderGeometry(
          volume.dimensions.x, // radius
          volume.dimensions.x, // radius
          volume.dimensions.y - volume.dimensions.x * 2, // height minus sphere caps
          8, 1, true
        )
        const cylinderWireframe = new THREE.WireframeGeometry(cylinderGeometry)
        const cylinderMesh = new THREE.LineSegments(cylinderWireframe, new THREE.LineBasicMaterial({ color }))
        group.add(cylinderMesh)

        // Top sphere cap
        const topSphereGeometry = new THREE.SphereGeometry(volume.dimensions.x, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)
        const topSphereWireframe = new THREE.WireframeGeometry(topSphereGeometry)
        const topSphereMesh = new THREE.LineSegments(topSphereWireframe, new THREE.LineBasicMaterial({ color }))
        topSphereMesh.position.y = (volume.dimensions.y - volume.dimensions.x * 2) * 0.5
        group.add(topSphereMesh)

        // Bottom sphere cap
        const bottomSphereGeometry = new THREE.SphereGeometry(volume.dimensions.x, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
        const bottomSphereWireframe = new THREE.WireframeGeometry(bottomSphereGeometry)
        const bottomSphereMesh = new THREE.LineSegments(bottomSphereWireframe, new THREE.LineBasicMaterial({ color }))
        bottomSphereMesh.position.y = -(volume.dimensions.y - volume.dimensions.x * 2) * 0.5
        group.add(bottomSphereMesh)

        return group

      case 'box':
        geometry = new THREE.BoxGeometry(volume.dimensions.x, volume.dimensions.y, volume.dimensions.z)
        break

      case 'sphere':
        geometry = new THREE.SphereGeometry(volume.dimensions.x, 8, 6)
        break

      default:
        geometry = new THREE.BoxGeometry(1, 1, 1)
    }

    const wireframe = new THREE.WireframeGeometry(geometry)
    const mesh = new THREE.LineSegments(wireframe, new THREE.LineBasicMaterial({ color }))
    
    return mesh
  }

  /**
   * Get all registered objects
   */
  public getObjects(): Map<string, CollidableObject> {
    return this.collidableObjects
  }

  /**
   * Clear all registered objects
   */
  public clear(): void {
    this.collidableObjects.clear()
    this.landMeshes = []
    this.groundHeightCache.clear()
    logger.info(LogModule.COLLISION, 'CollisionSystem cleared')
  }

  /**
   * Set ground height offset to adjust collision detection height
   * @param offset Positive values raise collision, negative values lower it
   */
  public setGroundHeightOffset(offset: number): void {
    this.groundHeightOffset = offset
    logger.info(LogModule.COLLISION, `Ground height offset set to ${offset.toFixed(2)}`)
  }

  /**
   * Get current ground height offset
   */
  public getGroundHeightOffset(): number {
    return this.groundHeightOffset
  }

  /**
   * Get performance statistics
   */
  public getPerformanceStats(): object {
    return {
      registeredObjects: this.collidableObjects.size,
      landMeshes: this.landMeshes.length,
      cacheSize: this.groundHeightCache.size,
      cacheTimeout: this.cacheTimeout,
      collisionCheckInterval: this.collisionCheckInterval,
      maxRaycastDistance: this.maxRaycastDistance,
      groundHeightOffset: this.groundHeightOffset
    }
  }

  /**
   * Get registered land meshes for debugging
   */
  public getLandMeshes(): LandMeshInfo[] {
    return this.landMeshes.map(info => ({
      mesh: info.mesh,
      boundingBox: info.boundingBox.clone(),
      priority: info.priority
    }))
  }

  /**
   * Get ground height at position (public wrapper for debugging)
   */
  public getGroundHeight(x: number, z: number): number {
    return this.getGroundHeightOptimized(x, z)
  }

  /**
   * Fallback ground height detection using bounding boxes
   */
  public getGroundHeightFallback(x: number, z: number): number {
    if (this.landMeshes.length === 0) {
      return -4.0
    }

    let groundHeight = -4.0 // Default to sea level
    let closestDistance = Infinity
    let closestMesh = null
    
    // Check each land mesh's bounding box
    for (const info of this.landMeshes) {
      const mesh = info.mesh
      const boundingBox = info.boundingBox
      
      // Calculate distance to mesh center for better fallback
      const center = new THREE.Vector3()
      boundingBox.getCenter(center)
      const distance = new THREE.Vector3(x, 0, z).distanceTo(new THREE.Vector3(center.x, 0, center.z))
      
      if (distance < closestDistance) {
        closestDistance = distance
        closestMesh = mesh
      }
      
      // Check if point is within this mesh's X-Z bounds
      if (x >= boundingBox.min.x && x <= boundingBox.max.x &&
          z >= boundingBox.min.z && z <= boundingBox.max.z) {
        
        // For plane meshes, the ground height is the mesh's Y position
        if (mesh.userData.landType === 'plane') {
          groundHeight = Math.max(groundHeight, mesh.position.y)
        }
        // For other types, use the bottom of the bounding box
        else {
          groundHeight = Math.max(groundHeight, boundingBox.min.y)
        }
      }
    }
    
    // If we're outside all bounds, use the closest mesh as reference
    if (groundHeight === -4.0 && closestMesh) {
      const boundingBox = this.landMeshes.find(info => info.mesh === closestMesh)?.boundingBox
      if (boundingBox) {
        // Use the mesh's Y position as a reasonable fallback
        groundHeight = closestMesh.position.y
        // logger.debug(LogModule.COLLISION, `Using closest mesh fallback: ${closestMesh.userData.id} at Y=${groundHeight.toFixed(2)} (${closestDistance.toFixed(1)} units away)`)
      }
    }
    
    return groundHeight
  }

  /**
   * Debug method to test collision detection at a specific position
   */
  public debugCollisionTest(position: THREE.Vector3): void {
    console.log(`=== 🔍 COLLISION DEBUG TEST at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}) ===`)
    
    // Test ground height detection
    const groundHeight = this.getGroundHeightOptimized(position.x, position.z)
    console.log(`Ground height: ${groundHeight.toFixed(2)}`)
    
    // List all land meshes with their bounds
    console.log(`Land meshes (${this.landMeshes.length}):`)
    this.landMeshes.forEach((info, index) => {
      const bbox = info.boundingBox
      const contains = position.x >= bbox.min.x && position.x <= bbox.max.x && 
                      position.z >= bbox.min.z && position.z <= bbox.max.z
      console.log(`  ${index}: ${info.mesh.userData.id} bounds: X(${bbox.min.x.toFixed(1)} to ${bbox.max.x.toFixed(1)}) Z(${bbox.min.z.toFixed(1)} to ${bbox.max.z.toFixed(1)}) contains: ${contains}`)
    })
    
    console.log(`=== End Debug Test ===`)
  }

  /**
   * Simple debug method to check land mesh info
   */
  public debugLandMeshes(): void {
    console.log(`🏔️ LAND MESHES DEBUG (${this.landMeshes.length} registered):`)
    this.landMeshes.forEach((info, index) => {
      const mesh = info.mesh
      const bbox = info.boundingBox
      const size = bbox.getSize(new THREE.Vector3())
      console.log(`${index}: ${mesh.userData.id}`)
      console.log(`  Position: (${mesh.position.x}, ${mesh.position.y}, ${mesh.position.z})`)
      console.log(`  Size: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}`)
      console.log(`  Bounds: X(${bbox.min.x.toFixed(1)} to ${bbox.max.x.toFixed(1)}) Z(${bbox.min.z.toFixed(1)} to ${bbox.max.z.toFixed(1)})`)
      
      // Show shader parameters if available
      if (mesh.material instanceof THREE.ShaderMaterial && mesh.material.uniforms) {
        const uniforms = mesh.material.uniforms
        console.log(`  Shader Parameters:`)
        if (uniforms.uElevation) console.log(`    Elevation: ${uniforms.uElevation.value}`)
        if (uniforms.uRoughness) console.log(`    Roughness: ${uniforms.uRoughness.value}`)
        if (uniforms.uScale) console.log(`    Scale: ${uniforms.uScale.value}`)
        if (uniforms.uIslandRadius) console.log(`    Island Radius: ${uniforms.uIslandRadius.value}`)
        if (uniforms.uCoastSmoothness) console.log(`    Coast Smoothness: ${uniforms.uCoastSmoothness.value}`)
      }
    })
  }

  /**
   * Get terrain height using primitive bounding boxes
   */
  public getTerrainHeight(x: number, z: number): number {
    return this.getGroundHeightOptimized(x, z)
  }

  /**
   * Debug terrain height calculation at a specific point
   */
  public debugTerrainHeight(x: number, z: number): void {
    console.log(`🏔️ TERRAIN HEIGHT DEBUG at (${x.toFixed(2)}, ${z.toFixed(2)}):`)
    
    const groundHeight = this.getGroundHeightOptimized(x, z)
    console.log(`  Final Ground Height: ${groundHeight.toFixed(2)}`)
    
    // Test raycast directly
    const allMeshes = this.landMeshObjects
    this.tempVector.set(x, 500, z)
    this.tempVector2.set(0, -1, 0)
    this.raycaster.set(this.tempVector, this.tempVector2)
    const intersects = this.raycaster.intersectObjects(allMeshes, true)
    console.log(`  Raycast intersections: ${intersects.length}`)
    if (intersects.length > 0) {
      intersects.forEach((intersect, i) => {
        console.log(`    Intersection ${i}: Y=${intersect.point.y.toFixed(2)}, distance=${intersect.distance.toFixed(2)}, object=${intersect.object.userData.id || 'unnamed'}`)
        if (intersect.face) {
          const worldNormal = new THREE.Vector3()
          worldNormal.copy(intersect.face.normal)
          if (intersect.object instanceof THREE.Mesh) {
            intersect.object.getWorldQuaternion(this.tempQuaternion)
            worldNormal.applyQuaternion(this.tempQuaternion)
          }
          console.log(`      Normal: (${worldNormal.x.toFixed(2)}, ${worldNormal.y.toFixed(2)}, ${worldNormal.z.toFixed(2)})`)
        }
      })
    }
    
    // Show breakdown for each land mesh
    this.landMeshes.forEach((info, index) => {
      const mesh = info.mesh
      const boundingBox = info.boundingBox
      
      if (x >= boundingBox.min.x && x <= boundingBox.max.x &&
          z >= boundingBox.min.z && z <= boundingBox.max.z) {
        console.log(`  ${mesh.userData.id || 'unnamed'}: bbox min.y=${boundingBox.min.y.toFixed(2)}, max.y=${boundingBox.max.y.toFixed(2)}`)
        console.log(`    Mesh position: (${mesh.position.x.toFixed(2)}, ${mesh.position.y.toFixed(2)}, ${mesh.position.z.toFixed(2)})`)
        console.log(`    Mesh rotation: (${mesh.rotation.x.toFixed(2)}, ${mesh.rotation.y.toFixed(2)}, ${mesh.rotation.z.toFixed(2)})`)
        console.log(`    Mesh scale: (${mesh.scale.x.toFixed(2)}, ${mesh.scale.y.toFixed(2)}, ${mesh.scale.z.toFixed(2)})`)
      }
    })
  }

  /**
   * Quick test for terrain height
   */
  public testTerrainFix(): void {
    console.log(`🧪 TESTING TERRAIN HEIGHT:`)
    this.debugTerrainHeight(0, 0)
  }
} 