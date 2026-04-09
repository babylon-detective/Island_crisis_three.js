import * as THREE from 'three'

/**
 * HeightmapCollider — bakes a uniform grid of ground heights from a mesh
 * at load time so that runtime ground-height queries are an O(1) grid lookup
 * with bilinear interpolation instead of per-frame raycasts.
 *
 * Usage:
 *   const hm = HeightmapCollider.fromObject(model, 64)
 *   const y = hm.getHeight(worldX, worldZ) // returns ground Y or null if outside
 */
export class HeightmapCollider {
  /** 1-D row-major float array: heights[row * cols + col] */
  heights: Float32Array
  /** World-space bounding rect */
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  /** Grid dimensions */
  cols: number
  rows: number
  /** Cell size in world units */
  cellW: number
  cellH: number
  /** Identifier for debugging */
  readonly id: string
  /** Source object reference for re-baking */
  private sourceObject: THREE.Object3D | null = null
  /** Resolution used when baking */
  private resolution: number = 64
  /** Padding used when baking */
  private padding: number = 0.5

  private constructor(
    id: string,
    heights: Float32Array,
    cols: number,
    rows: number,
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number
  ) {
    this.id = id
    this.heights = heights
    this.cols = cols
    this.rows = rows
    this.minX = minX
    this.minZ = minZ
    this.maxX = maxX
    this.maxZ = maxZ
    this.cellW = (maxX - minX) / (cols - 1)
    this.cellH = (maxZ - minZ) / (rows - 1)
  }

  // ──────────────────────────────────────────────────────
  // Factory — bake a heightmap from any Object3D
  // ──────────────────────────────────────────────────────

  /**
   * Create a HeightmapCollider by raycasting a grid of points downward
   * onto the given object's meshes.
   *
   * @param object  The THREE.Object3D (Group/Mesh) to sample
   * @param resolution  Grid resolution along the longest axis (default 64)
   * @param id  Optional identifier for debug logging
   * @param padding  Extra world units to pad around the bounding box (default 0.5)
   */
  static async fromObject(
    object: THREE.Object3D,
    resolution: number = 64,
    id: string = 'heightmap',
    padding: number = 0.5
  ): Promise<HeightmapCollider> {
    // Make sure world matrices are up-to-date
    object.updateMatrixWorld(true)

    // Compute world-space bounding box
    const bbox = new THREE.Box3().setFromObject(object)
    const minX = bbox.min.x - padding
    const maxX = bbox.max.x + padding
    const minZ = bbox.min.z - padding
    const maxZ = bbox.max.z + padding
    const spanX = maxX - minX
    const spanZ = maxZ - minZ

    // Determine grid size — preserve aspect ratio
    let cols: number, rows: number
    if (spanX >= spanZ) {
      cols = resolution
      rows = Math.max(2, Math.round(resolution * (spanZ / spanX)))
    } else {
      rows = resolution
      cols = Math.max(2, Math.round(resolution * (spanX / spanZ)))
    }

    // Collect all child meshes for raycasting and pre-compute their
    // world-space bounding boxes once so we can cull per column.
    const meshes: THREE.Mesh[] = []
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshes.push(child)
      }
    })

    // Pre-compute / warm-up bounding boxes & spheres so Three.js can do
    // fast early-rejection checks inside intersectObjects().
    const meshBounds: Array<{ mesh: THREE.Mesh; box: THREE.Box3 }> = meshes.map(mesh => {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
      const box = new THREE.Box3().setFromObject(mesh)
      return { mesh, box }
    })

    const raycaster = new THREE.Raycaster()
    const rayOrigin = new THREE.Vector3()
    const rayDir = new THREE.Vector3(0, -1, 0)
    const rayStartY = bbox.max.y + 100 // well above

    const heights = new Float32Array(rows * cols)
    // Initialise with -Infinity so missed cells are clearly "no ground"
    heights.fill(-Infinity)

    // Yield to the event loop every row so the browser stays responsive.
    for (let r = 0; r < rows; r++) {
      const z = minZ + (r / (rows - 1)) * spanZ
      for (let c = 0; c < cols; c++) {
        const x = minX + (c / (cols - 1)) * spanX

        // Only raycast meshes whose XZ bounds contain this column — avoids
        // testing thousands of triangles on meshes that can't possibly be hit.
        const candidateMeshes = meshBounds
          .filter(({ box }) => x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z)
          .map(({ mesh }) => mesh)

        if (candidateMeshes.length === 0) continue

        rayOrigin.set(x, rayStartY, z)
        raycaster.set(rayOrigin, rayDir)
        const hits = raycaster.intersectObjects(candidateMeshes, false)

        if (hits.length > 0) {
          // Take the highest upward-facing intersection
          let bestY = -Infinity
          for (const hit of hits) {
            let isUpward = true
            if (hit.face) {
              const worldNormal = hit.face.normal.clone()
              if (hit.object instanceof THREE.Mesh) {
                worldNormal.applyQuaternion(hit.object.getWorldQuaternion(new THREE.Quaternion()))
              }
              isUpward = worldNormal.y > 0.3
            }
            if (isUpward && hit.point.y > bestY) bestY = hit.point.y
          }
          if (bestY > -Infinity) {
            heights[r * cols + c] = bestY
          }
        }
      }

      // Yield after every row so the browser can paint & handle input.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }

    const hm = new HeightmapCollider(id, heights, cols, rows, minX, minZ, maxX, maxZ)
    hm.sourceObject = object
    hm.resolution = resolution
    hm.padding = padding

    // Count valid cells
    let validCells = 0
    for (let i = 0; i < heights.length; i++) {
      if (heights[i] > -Infinity) validCells++
    }
    console.log(
      `🗺️ HeightmapCollider "${id}" baked: ${cols}×${rows} grid (${validCells}/${cols * rows} valid), ` +
      `world bounds X[${minX.toFixed(1)}..${maxX.toFixed(1)}] Z[${minZ.toFixed(1)}..${maxZ.toFixed(1)}]`
    )
    return hm
  }

  // ──────────────────────────────────────────────────────
  // Re-bake — call after transform/scale changes
  // ──────────────────────────────────────────────────────

  /**
   * Re-bake this heightmap from the original source object.
   * Call this after changing position, rotation, or scale on the source model.
   * Returns true if re-bake succeeded, false if source was lost.
   */
  async rebake(): Promise<boolean> {
    if (!this.sourceObject) {
      console.warn(`⚠️ HeightmapCollider "${this.id}": no source object — cannot rebake`)
      return false
    }
    const fresh = await HeightmapCollider.fromObject(this.sourceObject, this.resolution, this.id, this.padding)
    // Copy all data from the fresh bake into this instance (preserves the reference)
    this.heights = fresh.heights
    this.cols = fresh.cols
    this.rows = fresh.rows
    this.minX = fresh.minX
    this.minZ = fresh.minZ
    this.maxX = fresh.maxX
    this.maxZ = fresh.maxZ
    this.cellW = fresh.cellW
    this.cellH = fresh.cellH
    return true
  }

  // ──────────────────────────────────────────────────────
  // Runtime query — bilinear interpolation
  // ──────────────────────────────────────────────────────

  /**
   * Get the interpolated ground height at (x, z) in world coordinates.
   * Returns `null` if (x,z) is outside the heightmap bounds or all
   * surrounding cells are empty (no ground).
   */
  getHeight(x: number, z: number): number | null {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) {
      return null
    }

    // Continuous grid coordinates
    const gx = ((x - this.minX) / (this.maxX - this.minX)) * (this.cols - 1)
    const gz = ((z - this.minZ) / (this.maxZ - this.minZ)) * (this.rows - 1)

    const c0 = Math.floor(gx)
    const r0 = Math.floor(gz)
    const c1 = Math.min(c0 + 1, this.cols - 1)
    const r1 = Math.min(r0 + 1, this.rows - 1)

    const fx = gx - c0 // fractional x
    const fz = gz - r0 // fractional z

    const h00 = this.heights[r0 * this.cols + c0]
    const h10 = this.heights[r0 * this.cols + c1]
    const h01 = this.heights[r1 * this.cols + c0]
    const h11 = this.heights[r1 * this.cols + c1]

    // If any corner is -Infinity (no geometry), try nearest-neighbour fallback
    if (h00 === -Infinity || h10 === -Infinity || h01 === -Infinity || h11 === -Infinity) {
      // Find the closest valid sample
      const candidates = [h00, h10, h01, h11].filter(h => h > -Infinity)
      if (candidates.length === 0) return null
      // Use highest valid neighbour
      return Math.max(...candidates)
    }

    // Bilinear interpolation
    const h0 = h00 + (h10 - h00) * fx
    const h1 = h01 + (h11 - h01) * fx
    return h0 + (h1 - h0) * fz
  }

  /**
   * Check if a world point is within this heightmap's XZ bounds.
   */
  contains(x: number, z: number): boolean {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ
  }
}
