import * as THREE from 'three'
import { logger, LogModule } from './Logger'

/**
 * Grid-based positioning and snapping system
 * Helps with level design and object placement consistency
 */
export class GridSystem {
  public readonly gridSize: number
  private gridHelper?: THREE.GridHelper
  
  constructor(gridSize: number = 5) {
    this.gridSize = gridSize
  }
  
  /**
   * Snap a position to the nearest grid point
   */
  snapToGrid(position: THREE.Vector3 | [number, number, number]): THREE.Vector3 {
    const pos = Array.isArray(position) ? new THREE.Vector3(...position) : position.clone()
    
    return new THREE.Vector3(
      Math.round(pos.x / this.gridSize) * this.gridSize,
      Math.round(pos.y / this.gridSize) * this.gridSize,
      Math.round(pos.z / this.gridSize) * this.gridSize
    )
  }
  
  /**
   * Snap only X and Z (horizontal plane), leave Y alone
   */
  snapToGridXZ(position: THREE.Vector3 | [number, number, number]): THREE.Vector3 {
    const pos = Array.isArray(position) ? new THREE.Vector3(...position) : position.clone()
    
    return new THREE.Vector3(
      Math.round(pos.x / this.gridSize) * this.gridSize,
      pos.y,
      Math.round(pos.z / this.gridSize) * this.gridSize
    )
  }
  
  /**
   * Convert grid coordinates to world position
   */
  gridToWorld(gridX: number, gridY: number, gridZ: number): THREE.Vector3 {
    return new THREE.Vector3(
      gridX * this.gridSize,
      gridY * this.gridSize,
      gridZ * this.gridSize
    )
  }
  
  /**
   * Convert world position to grid coordinates
   */
  worldToGrid(position: THREE.Vector3 | [number, number, number]): { x: number; y: number; z: number } {
    const pos = Array.isArray(position) ? new THREE.Vector3(...position) : position
    
    return {
      x: Math.round(pos.x / this.gridSize),
      y: Math.round(pos.y / this.gridSize),
      z: Math.round(pos.z / this.gridSize)
    }
  }
  
  /**
   * Create visual grid helper for debugging
   */
  createGridHelper(size: number = 200, scene?: THREE.Scene): THREE.GridHelper {
    const divisions = Math.floor(size / this.gridSize)
    this.gridHelper = new THREE.GridHelper(size, divisions, 0x444444, 0x222222)
    this.gridHelper.position.y = 0.01 // Slightly above ground
    
    if (scene) {
      scene.add(this.gridHelper)
    }
    
    logger.info(LogModule.SYSTEM, `Grid helper created: ${size}x${size} units, ${divisions} divisions`)
    return this.gridHelper
  }
  
  /**
   * Toggle grid helper visibility
   */
  toggleGridHelper(visible: boolean): void {
    if (this.gridHelper) {
      this.gridHelper.visible = visible
    }
  }
  
  /**
   * Get nearest grid-aligned bounding box for an object
   */
  getGridAlignedBounds(object: THREE.Object3D): {
    min: THREE.Vector3
    max: THREE.Vector3
    size: THREE.Vector3
    center: THREE.Vector3
  } {
    const bbox = new THREE.Box3().setFromObject(object)
    const min = this.snapToGrid(bbox.min)
    const max = this.snapToGrid(bbox.max)
    const size = max.clone().sub(min)
    const center = min.clone().add(max).multiplyScalar(0.5)
    
    return { min, max, size, center }
  }
}

export default GridSystem
