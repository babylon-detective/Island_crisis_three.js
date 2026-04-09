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
// PER-SHOT CAMERA PARAMETERS  (edit these to dial in angles)
// ============================================================================
//
// posAnchor / lookAnchor: the world-space reference point.
//   'player'  — player's battle position
//   'enemy'   — enemy's battle position
//   'mid'     — midpoint between the two
//   'impact'  — lerp(player, enemy, 0.75): the melee contact zone
//
// Offsets are in world units, relative to the anchor, along the
// battlefield-local axes:
//   fwdOffset    — along the player→enemy direction (positive = toward enemy)
//   sideOffset   — perpendicular (positive = camera's right in menu-idle view)
//   heightOffset — above the anchor's Y
//
// lookFwdOffset / lookSideOffset fine-shift the look-at point along those
// same axes (leave 0 in the common case).
//
export interface ShotParams {
  posAnchor: 'player' | 'enemy' | 'mid' | 'impact'
  fwdOffset: number
  sideOffset: number
  heightOffset: number
  lookAnchor: 'player' | 'enemy' | 'mid' | 'impact'
  lookFwdOffset: number
  lookSideOffset: number
  lookHeightOffset: number
  fov: number
}

export const SHOT_PARAMS: Record<BattleShotType, ShotParams> = {
  // ¾ isometric overview — wide enough to read both combatants + UI
  menuIdle:       { posAnchor: 'mid',    fwdOffset: -8.2, sideOffset: -10.3, heightOffset: 3.3, lookAnchor: 'mid',    lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 0.2,  fov: 30 },
  // Player action shots
  attackerFocus:  { posAnchor: 'player', fwdOffset:  7.1, sideOffset:  -1.1, heightOffset: 1.5, lookAnchor: 'player', lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 0.75, fov: 35 },
  strikeImpact:   { posAnchor: 'impact', fwdOffset: -12.0, sideOffset: 12.0, heightOffset: 0.0, lookAnchor: 'impact', lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 1.15, fov: 46 },
  targetReaction: { posAnchor: 'enemy',  fwdOffset: -6.7, sideOffset:   0.0, heightOffset: 1.3, lookAnchor: 'enemy',  lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 1.0,  fov: 40 },
  // Enemy action shots
  enemyFocus:     { posAnchor: 'enemy',  fwdOffset:  8.3, sideOffset:   4.2, heightOffset: 1.5, lookAnchor: 'enemy',  lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 0.15, fov: 28 },
  playerReaction: { posAnchor: 'player', fwdOffset:  8.3, sideOffset:  -4.1, heightOffset: 0.5, lookAnchor: 'player', lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 0.35, fov: 27 },
  // Special event shots
  deathHold:      { posAnchor: 'enemy',  fwdOffset:  5.9, sideOffset:   0.6, heightOffset: 2.3, lookAnchor: 'enemy',  lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 0.7,  fov: 32 },
  wideAction:     { posAnchor: 'mid',    fwdOffset: -3.8, sideOffset:   7.7, heightOffset: 2.1, lookAnchor: 'mid',    lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 0.65, fov: 60 },
  overShoulder:   { posAnchor: 'player', fwdOffset: -1.5, sideOffset:   0.8, heightOffset: 1.0, lookAnchor: 'enemy',  lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 0.4,  fov: 81 },
  // Legacy aliases — unchanged
  establishing:   { posAnchor: 'mid',    fwdOffset: -1.5, sideOffset:   8.0, heightOffset: 5.5, lookAnchor: 'mid',    lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 0.8,  fov: 48 },
  playerCloseUp:  { posAnchor: 'player', fwdOffset: -2.2, sideOffset:  -0.8, heightOffset: 1.3, lookAnchor: 'player', lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 1.0,  fov: 40 },
  enemyCloseUp:   { posAnchor: 'enemy',  fwdOffset:  2.2, sideOffset:   0.8, heightOffset: 1.3, lookAnchor: 'enemy',  lookFwdOffset: 0, lookSideOffset: 0, lookHeightOffset: 1.0,  fov: 40 },
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

  // Standalone tween state (used by BattleAnimSync's cameraTween)
  private tweenState: {
    startPos: THREE.Vector3
    startLookAt: THREE.Vector3
    targetPos: THREE.Vector3
    targetLookAt: THREE.Vector3
    startFov: number
    targetFov: number
    duration: number
    elapsed: number
  } | null = null

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

  /**
   * Smooth camera tween to a shot type over `duration` seconds.
   * Cancels any in-progress tween.
   */
  tweenTo(type: BattleShotType, duration: number): void {
    const { pos, lookAt } = this.computeShotPosAndLookAt(type)
    this.tweenState = {
      startPos: this.camera.position.clone(),
      startLookAt: this.currentLookAt.clone(),
      targetPos: pos,
      targetLookAt: lookAt,
      startFov: this.camera.fov,
      targetFov: SHOT_PARAMS[type].fov,
      duration: Math.max(duration, 0.01),
      elapsed: 0,
    }
  }

  /** Immediately hard-cut to a shot type (no interpolation). */
  cutTo(type: BattleShotType, fovOverride?: number): void {
    const { pos, lookAt } = this.computeShotPosAndLookAt(type)
    this.camera.position.copy(pos)
    this.camera.lookAt(lookAt)
    const fov = fovOverride ?? SHOT_PARAMS[type].fov
    if (this.camera.fov !== fov) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    this.currentPos.copy(pos)
    this.currentLookAt.copy(lookAt)
    this.currentShot = null
    this.tweenState = null  // hard cut cancels any active tween
  }

  /**
   * Instantly preview any shot type without a live battle.
   * Useful for tuning angles in the debug GUI — call this and the camera
   * jumps to the computed position immediately.
   */
  previewShot(type: BattleShotType): void {
    this.cutTo(type)
  }

  /** Return a direct (live) reference to the params for a given shot type,
   * so the debug GUI can mutate values and see changes in real time. */
  getShotParams(type: BattleShotType): ShotParams {
    return SHOT_PARAMS[type]
  }

  /** Print the current SHOT_PARAMS table to the browser console as JSON
   * so you can copy tweaked values back into the source. */
  printConfig(): void {
    const out: Record<string, object> = {}
    for (const [key, val] of Object.entries(SHOT_PARAMS)) {
      out[key] = { ...val }
    }
    console.log('⚔️ BattleCameraController SHOT_PARAMS (copy into source):')
    console.log(JSON.stringify(out, null, 2))
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

    // Standalone tween (driven by BattleAnimSync)
    if (this.tweenState) {
      this.tweenState.elapsed += deltaTime
      const t = Math.min(this.tweenState.elapsed / this.tweenState.duration, 1)
      const eased = easeOutCubic(t)
      this.currentPos.lerpVectors(this.tweenState.startPos, this.tweenState.targetPos, eased)
      this.currentLookAt.lerpVectors(this.tweenState.startLookAt, this.tweenState.targetLookAt, eased)
      this.camera.position.copy(this.currentPos)
      this.camera.lookAt(this.currentLookAt)
      const fov = THREE.MathUtils.lerp(this.tweenState.startFov, this.tweenState.targetFov, eased)
      if (Math.abs(this.camera.fov - fov) > 0.01) {
        this.camera.fov = fov
        this.camera.updateProjectionMatrix()
      }
      if (t >= 1) this.tweenState = null
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

    this.camera.fov = THREE.MathUtils.lerp(44, SHOT_PARAMS.menuIdle.fov, easeOutCubic(t))
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

  private resolveAnchor(anchor: ShotParams['posAnchor']): THREE.Vector3 {
    const impact = this.positions.player.clone().lerp(this.positions.enemy, 0.75)
    switch (anchor) {
      case 'player': return this.positions.player.clone()
      case 'enemy':  return this.positions.enemy.clone()
      case 'mid':    return this.midpoint.clone()
      case 'impact': return impact
    }
  }

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
    const fov = shot.fov ?? SHOT_PARAMS[shot.type].fov
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
   * Resolve world-space camera pos + lookAt for a shot type, reading all
   * numeric values from the mutable SHOT_PARAMS table so the debug GUI
   * (and console commands) can tweak angles without touching logic code.
   */
  computeShotPosAndLookAt(type: BattleShotType): { pos: THREE.Vector3; lookAt: THREE.Vector3 } {
    const params = SHOT_PARAMS[type]
    const fwd  = this.forward
    const side = this.side

    const posBase = this.resolveAnchor(params.posAnchor)
    const basePosY = posBase.y
    const pos = posBase
      .addScaledVector(fwd,  params.fwdOffset)
      .addScaledVector(side, params.sideOffset)
    pos.y = basePosY + params.heightOffset

    const lookBase = this.resolveAnchor(params.lookAnchor)
    const baseLookY = lookBase.y
    if (params.lookFwdOffset  !== 0) lookBase.addScaledVector(fwd,  params.lookFwdOffset)
    if (params.lookSideOffset !== 0) lookBase.addScaledVector(side, params.lookSideOffset)
    lookBase.y = baseLookY + params.lookHeightOffset

    return { pos, lookAt: lookBase }
  }
}
