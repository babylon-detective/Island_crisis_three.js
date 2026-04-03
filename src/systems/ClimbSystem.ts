import * as THREE from 'three'

// ============================================================================
// CLIMB SYSTEM
// Simple AABB-based ledge-grab / vault mechanic.
//
// Usage:
//  1. Register each platform cube via addBox().
//  2. Each frame in PlayerController call checkClimbable() to see if there
//     is a climbable edge in front of the player.
//  3. When the player presses L (or the mobile climb button), call
//     getClimbImpulse() to receive the velocity kick needed to reach the top.
// ============================================================================

export interface ClimbVolume {
  id: string
  box: THREE.Box3  // world-space AABB
  topY: number     // cached top surface Y (world space)
}

export interface ClimbInfo {
  volume: ClimbVolume
  topY: number
  pushDir: THREE.Vector3  // unit vector pointing into the box (horizontal)
}

export class ClimbSystem {
  private volumes: ClimbVolume[] = []

  // --------------------------------------------------------------------------
  // Registration
  // --------------------------------------------------------------------------

  /**
   * Register a platform box by its world-space center and full extent.
   */
  addBox(id: string, center: THREE.Vector3, size: THREE.Vector3): void {
    const half = size.clone().multiplyScalar(0.5)
    const box = new THREE.Box3(
      new THREE.Vector3(center.x - half.x, center.y - half.y, center.z - half.z),
      new THREE.Vector3(center.x + half.x, center.y + half.y, center.z + half.z),
    )
    this.volumes.push({ id, box, topY: center.y + half.y })
  }

  // --------------------------------------------------------------------------
  // Detection
  // --------------------------------------------------------------------------

  /**
   * Check whether there is a climbable ledge directly in front of the player.
   *
   * @param playerFeet  World-space position of the player's feet (capsule bottom).
   * @param facingDir   Horizontal unit vector the player is currently facing.
   * @param playerRadius  Capsule radius (used for proximity detection).
   * @param playerHeight  Capsule height (1.8 m for default character).
   *
   * @returns ClimbInfo if a climbable edge is found, null otherwise.
   */
  checkClimbable(
    playerFeet: THREE.Vector3,
    facingDir: THREE.Vector3,
    playerRadius: number,
    playerHeight: number,
  ): ClimbInfo | null {
    // Probe distance: just beyond the player's radius so they must be touching
    const REACH = playerRadius + 0.55

    // We test two probe heights: chest (mid) and forehead
    const midY   = playerFeet.y + playerHeight * 0.45
    const highY  = playerFeet.y + playerHeight * 0.88

    const probeMid  = new THREE.Vector3(
      playerFeet.x + facingDir.x * REACH,
      midY,
      playerFeet.z + facingDir.z * REACH,
    )
    const probeHigh = new THREE.Vector3(
      playerFeet.x + facingDir.x * REACH,
      highY,
      playerFeet.z + facingDir.z * REACH,
    )

    let best: ClimbInfo | null = null
    let bestTopY = -Infinity

    for (const vol of this.volumes) {
      const { box, topY } = vol

      // The probe point must be inside the XZ footprint of the box
      const inXZ = (p: THREE.Vector3) =>
        p.x >= box.min.x && p.x <= box.max.x &&
        p.z >= box.min.z && p.z <= box.max.z

      const midHits  = inXZ(probeMid)
      const highHits = inXZ(probeHigh)

      if (!midHits && !highHits) continue

      // The box top must be ABOVE the player's current feet (something to climb)
      const minClimbHeight = playerFeet.y + 0.25
      if (topY <= minClimbHeight) continue

      // The box top must be within reach — no higher than 0.4 m above the head
      const maxClimbHeight = playerFeet.y + playerHeight + 0.4
      if (topY > maxClimbHeight) continue

      if (topY > bestTopY) {
        bestTopY = topY
        const pushDir = new THREE.Vector3(facingDir.x, 0, facingDir.z).normalize()
        best = { volume: vol, topY, pushDir }
      }
    }

    return best
  }

  // --------------------------------------------------------------------------
  // Impulse calculation
  // --------------------------------------------------------------------------

  /**
   * Convert a ClimbInfo into a velocity impulse (vx, vy, vz) that will arc
   * the player capsule cleanly onto the target surface.
   *
   * @param playerFeet   Current feet Y.
   * @param climbInfo    Output from checkClimbable().
   * @param gravity      Player gravity constant (e.g. 20 m/s²).
   * @param forwardSpeed Horizontal carry speed during the climb (default 3 m/s).
   */
  getClimbImpulse(
    playerFeet: THREE.Vector3,
    climbInfo: ClimbInfo,
    gravity: number,
    forwardSpeed: number = 3.0,
  ): THREE.Vector3 {
    const heightToClimb = climbInfo.topY - playerFeet.y + 0.35  // + clearance
    // v_y = sqrt(2 * g * h)  — minimum vertical velocity to reach the edge
    const vy = Math.sqrt(2 * gravity * Math.max(heightToClimb, 0.5))
    return new THREE.Vector3(
      climbInfo.pushDir.x * forwardSpeed,
      vy,
      climbInfo.pushDir.z * forwardSpeed,
    )
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  getVolumes(): ClimbVolume[] {
    return this.volumes
  }

  clear(): void {
    this.volumes = []
  }
}
