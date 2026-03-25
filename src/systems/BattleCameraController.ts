import * as THREE from 'three'

// ============================================================================
// BATTLE CAMERA CONTROLLER
// Cut-based cinematic camera system for turn-based battle sequences.
//
// Design philosophy: punchy, efficient hard cuts between fixed positions —
// manga-panel rhythm. Fluid pans are reserved for the opening cinematic only.
// Each cut answers: whose action matters most right now, and what angle
// makes it hit hardest?
// ============================================================================

export type BattleShotType =
  // Base / menu state
  | 'menuIdle'          // ¾ isometric overview — full battlefield readable
  // Player action shots
  | 'attackerFocus'     // Medium low-angle on the player — physicality emphasis
  | 'strikeImpact'      // Tight shot at the point of melee impact
  | 'targetReaction'    // Cut to enemy receiving hit — recoil / damage flash
  // Enemy action shots
  | 'enemyFocus'        // Low-angle dramatic framing on the enemy attacker
  | 'playerReaction'    // Cut to player receiving hit
  // Special event shots
  | 'deathHold'         // Wider deliberate frame on a dying unit
  | 'wideAction'        // Broad frame for magic / area-of-effect skills
  | 'overShoulder'      // Utility: behind player looking at enemy
  // Legacy aliases (kept for external compatibility)
  | 'establishing'
  | 'playerCloseUp'
  | 'enemyCloseUp'

export interface BattleCameraShot {
  type: BattleShotType
  duration: number            // seconds this shot holds before advancing
  fov?: number                // override FOV for this shot
  /** When true the camera hard-cuts to position instantly (default). */
  hardCut?: boolean
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
  // Base
  menuIdle: 48,
  // Player action
  attackerFocus: 38,
  strikeImpact: 34,
  targetReaction: 40,
  // Enemy action
  enemyFocus: 36,
  playerReaction: 40,
  // Special
  deathHold: 44,
  wideAction: 52,
  overShoulder: 50,
  // Legacy aliases
  establishing: 48,
  playerCloseUp: 40,
  enemyCloseUp: 40,
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

  // Interpolation targets (used only for non-hardCut shots)
  private targetPos: THREE.Vector3 = new THREE.Vector3()
  private targetLookAt: THREE.Vector3 = new THREE.Vector3()
  private currentPos: THREE.Vector3 = new THREE.Vector3()
  private currentLookAt: THREE.Vector3 = new THREE.Vector3()
  private shotStartPos: THREE.Vector3 = new THREE.Vector3()
  private shotStartLookAt: THREE.Vector3 = new THREE.Vector3()

  // Opening cinematic state
  private openingActive: boolean = false
  private openingElapsed: number = 0
  private openingDuration: number = 2.0
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
  get openingPlaying(): boolean { return this.openingActive }

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

  /** Play the opening cinematic, then call onComplete. */
  playOpening(onComplete?: () => void): void {
    this.openingActive = true
    this.openingElapsed = 0
    this.openingDuration = 2.0
    this.openingCompleteCallback = onComplete ?? null

    // Start from a low-angle behind the player, looking toward the enemy
    const start = this.getOpeningPosition(0)
    this.camera.position.copy(start.pos)
    this.camera.lookAt(start.lookAt)
    this.camera.fov = 44
    this.camera.updateProjectionMatrix()
  }

  /** Skip the current opening or shot sequence — immediately finish all pending work. */
  skipSequence(): void {
    if (this.openingActive) {
      this.openingActive = false
      this.cutTo('menuIdle')
      const cb = this.openingCompleteCallback
      this.openingCompleteCallback = null
      cb?.()
    }
    // Drain remaining shot queue, firing all callbacks instantly
    while (this.currentShot || this.queue.length > 0) {
      if (this.currentShot) {
        const cb = this.currentShot.onComplete
        this.currentShot = null
        cb?.()
      }
      if (this.queue.length > 0) {
        const shot = this.queue.shift()!
        shot.onStart?.()
        shot.onComplete?.()
      }
    }
    this.currentShot = null
  }

  /** Immediately hard-cut to a shot type (no interpolation). */
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

      // Hard-cut shots sit at their target for the hold duration (no lerp).
      // Smooth shots interpolate from start to target.
      const isHardCut = this.currentShot.hardCut !== false // default true
      if (!isHardCut) {
        const eased = easeOutCubic(t)
        this.currentPos.lerpVectors(this.shotStartPos, this.targetPos, eased)
        this.currentLookAt.lerpVectors(this.shotStartLookAt, this.targetLookAt, eased)
        this.camera.position.copy(this.currentPos)
        this.camera.lookAt(this.currentLookAt)
      }
      // (Hard-cut shots already placed the camera in advanceQueue.)

      if (t >= 1) {
        const cb = this.currentShot.onComplete
        this.currentShot = null
        cb?.()
        this.advanceQueue()
      }
    } else if (this.queue.length > 0) {
      // Recover orphaned queue (e.g. opening cinematic overwrote currentShot)
      this.advanceQueue()
    }
  }

  // ============================================================================
  // OPENING CINEMATIC
  // ============================================================================

  /**
   * Opening cinematic: camera sweeps from a low angle behind the player
   * up to the ¾ isometric menu view, keeping both combatants in frame.
   * This is the one moment that uses a fluid motion — everything else
   * in battle is hard cuts.
   */
  private updateOpening(dt: number): void {
    this.openingElapsed += dt
    const t = Math.min(this.openingElapsed / this.openingDuration, 1)

    const frame = this.getOpeningPosition(t)
    this.camera.position.copy(frame.pos)
    this.camera.lookAt(frame.lookAt)

    this.camera.fov = THREE.MathUtils.lerp(44, SHOT_FOV.menuIdle, easeOutCubic(t))
    this.camera.updateProjectionMatrix()

    if (t >= 1) {
      this.openingActive = false
      this.cutTo('menuIdle')
      const cb = this.openingCompleteCallback
      this.openingCompleteCallback = null
      cb?.()
    }
  }

  /**
   * Compute camera pos+lookAt for the opening cinematic at normalised time `t`.
   * t=0 — low angle behind the player, gazing toward the enemy.
   * t=1 — the ¾ isometric menu idle position.
   */
  private getOpeningPosition(t: number): { pos: THREE.Vector3; lookAt: THREE.Vector3 } {
    const player = this.positions.player
    const enemy = this.positions.enemy
    const mid = this.midpoint

    // Start: low behind player, offset to side
    const startPos = player.clone()
      .addScaledVector(this.forward, -3.0)
      .addScaledVector(this.side, 2.0)
    startPos.y = player.y + 1.2 // low angle

    // End: menu idle position
    const endPosData = this.computeShotPosAndLookAt('menuIdle')

    const eased = easeInOutCubic(t)
    const pos = new THREE.Vector3().lerpVectors(startPos, endPosData.pos, eased)

    // Look-at biased toward enemy early, then settles on battlefield mid
    const startLookAt = new THREE.Vector3().lerpVectors(
      new THREE.Vector3(enemy.x, enemy.y + 1.0, enemy.z),
      new THREE.Vector3(mid.x, mid.y + 1.0, mid.z),
      0.3,
    )
    const lookAt = new THREE.Vector3().lerpVectors(startLookAt, endPosData.lookAt, eased)

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

    const isHardCut = shot.hardCut !== false // default true
    if (isHardCut) {
      // Instant placement — manga-panel cut
      this.camera.position.copy(computed.pos)
      this.camera.lookAt(computed.lookAt)
      this.currentPos.copy(computed.pos)
      this.currentLookAt.copy(computed.lookAt)
    } else {
      // Snapshot current camera state as the start of interpolation
      this.shotStartPos.copy(this.camera.position)
      this.shotStartLookAt.copy(this.currentLookAt)
    }

    shot.onStart?.()
  }

  // ============================================================================
  // SHOT TYPE COMPUTATION
  // ============================================================================

  /**
   * Given a shot type, compute the world-space camera position and lookAt.
   * All positions are derived from `this.positions` (player/enemy at 8u apart).
   *
   * Player is on the "right" of the battlefield, enemy on the "left"
   * from the camera's perspective in the menu idle view.
   */
  computeShotPosAndLookAt(type: BattleShotType): { pos: THREE.Vector3; lookAt: THREE.Vector3 } {
    const p = this.positions.player
    const e = this.positions.enemy
    const mid = this.midpoint
    const fwd = this.forward
    const side = this.side

    switch (type) {
      // ----------------------------------------------------------------
      // BASE / MENU STATE
      // ----------------------------------------------------------------
      case 'menuIdle':
      case 'establishing': {
        // ¾ isometric: offset to the side and above, angled down at the
        // battlefield. Wide enough to read both combatants and UI.
        const pos = mid.clone()
          .addScaledVector(side, 8)
          .addScaledVector(fwd, -1.5)
        pos.y = mid.y + 5.5
        const lookAt = mid.clone()
        lookAt.y += 0.8
        return { pos, lookAt }
      }

      // ----------------------------------------------------------------
      // PLAYER ACTION SHOTS
      // ----------------------------------------------------------------
      case 'attackerFocus': {
        // Medium low-angle on the player, emphasising physicality.
        // Camera slightly below chest level, in front and to the side.
        const pos = p.clone()
          .addScaledVector(fwd, -2.0)
          .addScaledVector(side, 1.5)
        pos.y = p.y + 0.6 // low angle
        const lookAt = p.clone()
        lookAt.y += 1.1 // chest-to-head
        return { pos, lookAt }
      }

      case 'strikeImpact': {
        // Tight shot at the point of melee impact — between combatants,
        // biased toward the enemy so the strike lands in frame.
        const impactPoint = p.clone().lerp(e, 0.75)
        const pos = impactPoint.clone()
          .addScaledVector(side, 2.5)
        pos.y = impactPoint.y + 1.2
        const lookAt = impactPoint.clone()
        lookAt.y += 0.8
        return { pos, lookAt }
      }

      case 'targetReaction':
      case 'enemyCloseUp': {
        // Cut to the enemy receiving a hit — front-on medium shot
        // slightly offset to the side for visual interest.
        const pos = e.clone()
          .addScaledVector(fwd, 2.2)
          .addScaledVector(side, 0.8)
        pos.y = e.y + 1.3
        const lookAt = e.clone()
        lookAt.y += 1.0
        return { pos, lookAt }
      }

      // ----------------------------------------------------------------
      // ENEMY ACTION SHOTS
      // ----------------------------------------------------------------
      case 'enemyFocus': {
        // Low-angle dramatic framing on the enemy — reinforces threat.
        // Camera below and in front, looking up.
        const pos = e.clone()
          .addScaledVector(fwd, 2.5)
          .addScaledVector(side, -1.0)
        pos.y = e.y + 0.4 // very low angle
        const lookAt = e.clone()
        lookAt.y += 1.3
        return { pos, lookAt }
      }

      case 'playerReaction':
      case 'playerCloseUp': {
        // Player receiving hit — front-on medium, mirrored from targetReaction
        const pos = p.clone()
          .addScaledVector(fwd, -2.2)
          .addScaledVector(side, -0.8)
        pos.y = p.y + 1.3
        const lookAt = p.clone()
        lookAt.y += 1.0
        return { pos, lookAt }
      }

      // ----------------------------------------------------------------
      // SPECIAL EVENT SHOTS
      // ----------------------------------------------------------------
      case 'deathHold': {
        // Wider deliberate frame on the dying enemy — gives the death
        // animation room to play out.
        const pos = e.clone()
          .addScaledVector(fwd, 3.5)
          .addScaledVector(side, 2.0)
        pos.y = e.y + 2.0
        const lookAt = e.clone()
        lookAt.y += 0.6
        return { pos, lookAt }
      }

      case 'wideAction': {
        // Broad frame for magic / area-of-effect — keeps all targets
        // visible with room for the visual spectacle.
        const pos = mid.clone()
          .addScaledVector(side, 7)
        pos.y = mid.y + 4.0
        const lookAt = mid.clone()
        lookAt.y += 1.0
        return { pos, lookAt }
      }

      case 'overShoulder': {
        // Behind player looking at enemy — transition / utility shot
        const pos = p.clone()
          .addScaledVector(fwd, -1.5)
          .addScaledVector(side, 0.8)
        pos.y = p.y + 1.8
        const lookAt = e.clone()
        lookAt.y += 1.0
        return { pos, lookAt }
      }

      default: {
        return this.computeShotPosAndLookAt('menuIdle')
      }
    }
  }
}
