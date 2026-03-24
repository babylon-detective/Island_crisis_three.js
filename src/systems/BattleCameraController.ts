import * as THREE from 'three'

// ============================================================================
// BATTLE CAMERA CONTROLLER
// Cinematic camera system for turn-based battle sequences.
// Manages shot types, shot queues, timed sequences, and the opening cinematic.
// ============================================================================

export type BattleShotType =
  | 'establishing'
  | 'playerCloseUp'
  | 'enemyCloseUp'
  | 'attackAction'
  | 'overShoulder'

export interface BattleCameraShot {
  type: BattleShotType
  duration: number            // seconds this shot holds
  fov?: number                // override FOV for this shot
  onStart?: () => void        // fires when shot begins
  onComplete?: () => void     // fires when shot ends
}

export interface BattlePositions {
  player: THREE.Vector3
  enemy: THREE.Vector3
}

/** Easing: ease-in-out cubic */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Easing: ease-out cubic */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// ============================================================================
// Default FOVs per shot type
// ============================================================================
const SHOT_FOV: Record<BattleShotType, number> = {
  establishing: 46,
  playerCloseUp: 40,
  enemyCloseUp: 40,
  attackAction: 50,
  overShoulder: 55,
}

export class BattleCameraController {
  private camera: THREE.PerspectiveCamera
  private positions: BattlePositions = {
    player: new THREE.Vector3(),
    enemy: new THREE.Vector3(),
  }

  // Derived helpers (cached on setBattlePositions)
  private midpoint: THREE.Vector3 = new THREE.Vector3()
  private forward: THREE.Vector3 = new THREE.Vector3()  // player→enemy normalised, Y=0
  private side: THREE.Vector3 = new THREE.Vector3()      // perpendicular (right-hand rule)

  // Shot queue
  private queue: BattleCameraShot[] = []
  private currentShot: BattleCameraShot | null = null
  private shotElapsed: number = 0

  // Interpolation targets for the active shot
  private targetPos: THREE.Vector3 = new THREE.Vector3()
  private targetLookAt: THREE.Vector3 = new THREE.Vector3()
  private currentPos: THREE.Vector3 = new THREE.Vector3()
  private currentLookAt: THREE.Vector3 = new THREE.Vector3()
  private shotStartPos: THREE.Vector3 = new THREE.Vector3()
  private shotStartLookAt: THREE.Vector3 = new THREE.Vector3()

  // Opening cinematic state
  private openingActive: boolean = false
  private openingElapsed: number = 0
  private openingDuration: number = 3.0
  private openingCompleteCallback: (() => void) | null = null

  // Flag: is the controller actively driving the camera?
  private _active: boolean = false

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  get active(): boolean { return this._active }
  get busy(): boolean { return this.openingActive || this.currentShot !== null || this.queue.length > 0 }

  /** Set the fixed battle positions (exactly 8 units apart). */
  setBattlePositions(player: THREE.Vector3, enemy: THREE.Vector3): void {
    this.positions.player.copy(player)
    this.positions.enemy.copy(enemy)
    this.midpoint.lerpVectors(player, enemy, 0.5)

    this.forward.subVectors(enemy, player)
    this.forward.y = 0
    const len = this.forward.length()
    if (len > 0.001) this.forward.divideScalar(len)
    else this.forward.set(0, 0, 1)

    // Right-hand perpendicular in XZ plane
    this.side.set(-this.forward.z, 0, this.forward.x)
  }

  /** Start the controller — it will now drive the camera each frame. */
  start(): void {
    this._active = true
    this.queue = []
    this.currentShot = null
    this.openingActive = false
  }

  /** Stop the controller and clear queues. */
  stop(): void {
    this._active = false
    this.queue = []
    this.currentShot = null
    this.openingActive = false
    this.openingCompleteCallback = null
  }

  /** Play the 3-second opening cinematic, then call onComplete. */
  playOpening(onComplete?: () => void): void {
    this.openingActive = true
    this.openingElapsed = 0
    this.openingDuration = 3.0
    this.openingCompleteCallback = onComplete ?? null

    // Set initial camera to the front-of-player hero shot
    const heroPos = this.getHeroFrontPosition(0)
    this.camera.position.copy(heroPos.pos)
    this.camera.lookAt(heroPos.lookAt)
    this.camera.fov = 48
    this.camera.updateProjectionMatrix()
  }

  /** Immediately cut to a shot type (no interpolation). */
  cutTo(type: BattleShotType, fovOverride?: number): void {
    const { pos, lookAt } = this.computeShotPosAndLookAt(type)
    this.camera.position.copy(pos)
    this.camera.lookAt(lookAt)
    const fov = fovOverride ?? SHOT_FOV[type]
    if (this.camera.fov !== fov) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    this.currentPos.copy(pos)
    this.currentLookAt.copy(lookAt)
    this.currentShot = null
  }

  /** Queue a sequence of shots to play in order. */
  playSequence(shots: BattleCameraShot[]): void {
    this.queue = [...shots]
    this.currentShot = null
    this.advanceQueue()
  }

  /** Per-frame update — call from CameraManager.update(). */
  update(deltaTime: number): void {
    if (!this._active) return

    // Opening cinematic has priority
    if (this.openingActive) {
      this.updateOpening(deltaTime)
      return
    }

    // Process shot queue
    if (this.currentShot) {
      this.shotElapsed += deltaTime
      const t = Math.min(this.shotElapsed / Math.max(this.currentShot.duration, 0.01), 1)
      const eased = easeOutCubic(t)

      // Lerp camera
      this.currentPos.lerpVectors(this.shotStartPos, this.targetPos, eased)
      this.currentLookAt.lerpVectors(this.shotStartLookAt, this.targetLookAt, eased)
      this.camera.position.copy(this.currentPos)
      this.camera.lookAt(this.currentLookAt)

      if (t >= 1) {
        const cb = this.currentShot.onComplete
        this.currentShot = null
        cb?.()
        this.advanceQueue()
      }
    }
  }

  // ============================================================================
  // OPENING CINEMATIC
  // ============================================================================

  /**
   * 0–1.5 s  : Camera in front of player at low angle, hero framing
   * 1.5–3.0 s: Camera pivots 180° around player, ending behind looking at enemy
   */
  private updateOpening(dt: number): void {
    this.openingElapsed += dt
    const t = Math.min(this.openingElapsed / this.openingDuration, 1)

    const hero = this.getHeroFrontPosition(t)
    this.camera.position.copy(hero.pos)
    this.camera.lookAt(hero.lookAt)

    // Animate FOV: start at 48, settle at establishing 46
    this.camera.fov = THREE.MathUtils.lerp(48, SHOT_FOV.establishing, easeOutCubic(t))
    this.camera.updateProjectionMatrix()

    if (t >= 1) {
      this.openingActive = false
      // Snap to establishing shot
      this.cutTo('establishing')
      this.openingCompleteCallback?.()
      this.openingCompleteCallback = null
    }
  }

  /**
   * Compute a camera pos+lookAt for the opening cinematic at normalised time `t` [0..1].
   * t=0: camera directly in front of player at low angle.
   * t=1: camera behind player looking at enemy.
   */
  private getHeroFrontPosition(t: number): { pos: THREE.Vector3; lookAt: THREE.Vector3 } {
    const player = this.positions.player
    const enemy = this.positions.enemy

    // Orbit radius around the player
    const radius = 4.0
    const height = THREE.MathUtils.lerp(1.0, 2.5, easeInOutCubic(t))

    // Angle: start at 0 (in front of player, facing them), end at PI (behind player facing enemy)
    // "In front" means in the direction opposite to the forward (player→enemy) vector
    const angle = easeInOutCubic(t) * Math.PI

    // Camera orbits in XZ plane around the player
    // At angle=0: camera is on the -forward side (facing the player)
    // At angle=PI: camera is on the +forward side (behind the player, facing enemy)
    const orbitDir = new THREE.Vector3()
    orbitDir.x = -this.forward.x * Math.cos(angle) + this.side.x * Math.sin(angle)
    orbitDir.z = -this.forward.z * Math.cos(angle) + this.side.z * Math.sin(angle)

    const pos = new THREE.Vector3(
      player.x + orbitDir.x * radius,
      player.y + height,
      player.z + orbitDir.z * radius,
    )

    // LookAt: first half looks at player, second half transitions to enemy
    const lookAt = new THREE.Vector3()
    const lookBlend = easeInOutCubic(Math.max(0, (t - 0.4) / 0.6)) // starts blending at t=0.4
    lookAt.lerpVectors(
      new THREE.Vector3(player.x, player.y + 1.2, player.z),
      new THREE.Vector3(enemy.x, enemy.y + 1.2, enemy.z),
      lookBlend,
    )

    return { pos, lookAt }
  }

  // ============================================================================
  // SHOT QUEUE
  // ============================================================================

  private advanceQueue(): void {
    if (this.queue.length === 0) {
      this.currentShot = null
      return
    }

    const shot = this.queue.shift()!
    this.currentShot = shot
    this.shotElapsed = 0

    // Snapshot current camera state as the start of interpolation
    this.shotStartPos.copy(this.camera.position)
    this.shotStartLookAt.copy(this.currentLookAt)

    // Compute target for the new shot
    const computed = this.computeShotPosAndLookAt(shot.type)
    this.targetPos.copy(computed.pos)
    this.targetLookAt.copy(computed.lookAt)

    // Apply FOV
    const fov = shot.fov ?? SHOT_FOV[shot.type]
    if (this.camera.fov !== fov) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }

    shot.onStart?.()
  }

  // ============================================================================
  // SHOT TYPE COMPUTATION
  // ============================================================================

  /**
   * Given a shot type, compute the world-space camera position and lookAt.
   * All positions are derived from `this.positions` (player/enemy at 8u apart).
   */
  computeShotPosAndLookAt(type: BattleShotType): { pos: THREE.Vector3; lookAt: THREE.Vector3 } {
    const p = this.positions.player
    const e = this.positions.enemy
    const mid = this.midpoint
    const fwd = this.forward
    const side = this.side

    switch (type) {
      case 'establishing': {
        // Side view, ~10u back from midpoint, 3u up
        const pos = mid.clone()
          .addScaledVector(side, 10)
        pos.y = mid.y + 3
        const lookAt = mid.clone()
        lookAt.y += 1.2
        return { pos, lookAt }
      }

      case 'playerCloseUp': {
        // 2.5u in front of player (facing them), 1.5u up
        const pos = p.clone()
          .addScaledVector(fwd, -2.5)
        pos.y = p.y + 1.5
        const lookAt = p.clone()
        lookAt.y += 1.0  // chest height
        return { pos, lookAt }
      }

      case 'enemyCloseUp': {
        // 2.5u in front of enemy (facing them), 1.5u up
        const pos = e.clone()
          .addScaledVector(fwd, 2.5)
        pos.y = e.y + 1.5
        const lookAt = e.clone()
        lookAt.y += 1.0
        return { pos, lookAt }
      }

      case 'attackAction': {
        // Side angle capturing the strike — offset from midpoint biased toward enemy
        const strikePoint = p.clone().lerp(e, 0.7)
        const pos = strikePoint.clone()
          .addScaledVector(side, 4)
        pos.y = strikePoint.y + 1.8
        const lookAt = strikePoint.clone()
        lookAt.y += 0.9
        return { pos, lookAt }
      }

      case 'overShoulder': {
        // 1.5u behind + 0.8u to side of player, 1.8u up — looking at enemy
        const pos = p.clone()
          .addScaledVector(fwd, -1.5)
          .addScaledVector(side, 0.8)
        pos.y = p.y + 1.8
        const lookAt = e.clone()
        lookAt.y += 1.0
        return { pos, lookAt }
      }

      default: {
        // Fallback to establishing
        return this.computeShotPosAndLookAt('establishing')
      }
    }
  }
}
