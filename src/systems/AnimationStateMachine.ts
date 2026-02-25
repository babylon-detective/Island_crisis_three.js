import { CharacterAnimationSystem } from './CharacterAnimationSystem'
import { logger, LogModule } from './Logger'

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single state in the animation state machine.
 */
export interface AnimState {
  /** State name (must match a clip name in the animation set unless `clipName` is specified) */
  name: string
  /** Explicit clip name to play (defaults to state name) */
  clipName?: string
  /** Override crossfade duration when entering this state */
  crossfadeDuration?: number
  /** Override playback speed */
  timeScale?: number
  /** If true, this state will auto-transition to `nextState` when the clip finishes */
  autoTransition?: boolean
  /** State to transition to when the clip finishes (requires autoTransition: true) */
  nextState?: string
  /** Callback fired when this state is entered */
  onEnter?: () => void
  /** Callback fired when this state is exited */
  onExit?: () => void
}

/**
 * A transition rule between states.
 */
export interface AnimTransition {
  /** Source state name (or '*' for any state) */
  from: string
  /** Target state name */
  to: string
  /** Condition function — transition fires when this returns true */
  condition: () => boolean
  /** Priority (higher = checked first). Default: 0 */
  priority?: number
  /** Override crossfade duration for this specific transition */
  crossfadeDuration?: number
}

/**
 * Parameters that the state machine reads each frame to evaluate transitions.
 * Updated externally by game systems (PlayerController, AI, etc.).
 */
export interface AnimStateParams {
  speed: number
  isGrounded: boolean
  isJumping: boolean
  isFalling: boolean
  isRunning: boolean
  isAttacking: boolean
  isDead: boolean
  isCrouching: boolean
  movementX: number
  movementZ: number
  /** Extensible: add custom properties */
  [key: string]: any
}

/**
 * Full state machine configuration.
 */
export interface AnimStateMachineConfig {
  characterId: string
  states: AnimState[]
  transitions: AnimTransition[]
  initialState: string
}

// ============================================================================
// ANIMATION STATE MACHINE
// ============================================================================

/**
 * A finite state machine that drives character animations based on game state.
 *
 * The state machine evaluates transition conditions every frame and triggers
 * crossfade transitions on the CharacterAnimationSystem when conditions are met.
 *
 * Usage:
 * ```ts
 * const fsm = new AnimationStateMachine(charAnimSystem)
 * fsm.configure(playerStateMachineConfig)
 * fsm.setParams({ speed: 5, isGrounded: true, ... })
 * // In game loop:
 * fsm.update()
 * ```
 */
export class AnimationStateMachine {
  private charAnimSystem: CharacterAnimationSystem
  private characterId: string = ''
  private states: Map<string, AnimState> = new Map()
  private transitions: AnimTransition[] = []
  private currentStateName: string = ''
  private params: AnimStateParams = {
    speed: 0,
    isGrounded: true,
    isJumping: false,
    isFalling: false,
    isRunning: false,
    isAttacking: false,
    isDead: false,
    isCrouching: false,
    movementX: 0,
    movementZ: 0,
  }
  private locked: boolean = false
  private lockTimer: number = 0
  private finishedCallback: (() => void) | null = null
  private enabled: boolean = true

  constructor(charAnimSystem: CharacterAnimationSystem) {
    this.charAnimSystem = charAnimSystem
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  /**
   * Load a full state machine configuration.
   */
  configure(config: AnimStateMachineConfig): void {
    this.characterId = config.characterId
    this.states.clear()
    this.transitions = []

    for (const state of config.states) {
      this.states.set(state.name, state)
    }

    // Sort transitions by priority (descending)
    this.transitions = [...config.transitions].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    )

    // Set initial state
    this.currentStateName = config.initialState

    // Set up auto-transition listeners
    for (const state of config.states) {
      if (state.autoTransition && state.nextState) {
        const nextState = state.nextState
        this.charAnimSystem.onClipFinished(this.characterId, state.clipName ?? state.name, () => {
          if (this.currentStateName === state.name) {
            this.transitionTo(nextState)
          }
        })
      }
    }

    logger.info(LogModule.SYSTEM, `AnimationStateMachine configured for "${this.characterId}" with ${this.states.size} states and ${this.transitions.length} transitions`)
  }

  // ============================================================================
  // PARAMETER CONTROL
  // ============================================================================

  /**
   * Update state machine parameters. Call this every frame from the game system.
   */
  setParams(params: Partial<AnimStateParams>): void {
    Object.assign(this.params, params)
  }

  /**
   * Get current parameters (read-only).
   */
  getParams(): Readonly<AnimStateParams> {
    return this.params
  }

  // ============================================================================
  // STATE CONTROL
  // ============================================================================

  /**
   * Get the current state name.
   */
  getCurrentState(): string {
    return this.currentStateName
  }

  /**
   * Enable or disable the state machine. When disabled, update() is a no-op.
   * Used by the AnimationBrowser to prevent the FSM from overriding manual clip selection.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * Force-transition to a specific state (bypasses condition checks).
   */
  transitionTo(stateName: string, crossfadeDuration?: number): void {
    if (this.locked) return

    const targetState = this.states.get(stateName)
    if (!targetState) {
      logger.warn(LogModule.SYSTEM, `State "${stateName}" not found in state machine`)
      return
    }

    // Exit current state
    const currentState = this.states.get(this.currentStateName)
    currentState?.onExit?.()

    // Enter new state
    const clipName = targetState.clipName ?? targetState.name
    const fadeDuration = crossfadeDuration ?? targetState.crossfadeDuration

    this.charAnimSystem.crossfadeTo(
      this.characterId,
      clipName,
      fadeDuration,
      targetState.timeScale
    )

    this.currentStateName = stateName
    targetState.onEnter?.()

    logger.debug(LogModule.SYSTEM, `State machine transition: → "${stateName}"`)
  }

  /**
   * Lock the state machine for a duration (prevents transitions).
   * Useful for attack animations or cutscenes.
   */
  lock(duration: number = 0): void {
    this.locked = true
    this.lockTimer = duration
  }

  /**
   * Unlock the state machine.
   */
  unlock(): void {
    this.locked = false
    this.lockTimer = 0
  }

  /**
   * Check if the state machine is locked.
   */
  isLocked(): boolean {
    return this.locked
  }

  // ============================================================================
  // UPDATE LOOP
  // ============================================================================

  /**
   * Evaluate transitions and update lock timer.
   * Call this every frame BEFORE CharacterAnimationSystem.update().
   *
   * @param deltaTime  Seconds since last frame (only needed for lock timer)
   */
  update(deltaTime: number = 0): void {
    if (!this.enabled) return

    // Update lock timer
    if (this.locked && this.lockTimer > 0) {
      this.lockTimer -= deltaTime
      if (this.lockTimer <= 0) {
        this.locked = false
        this.lockTimer = 0
      }
    }

    if (this.locked) return

    // Evaluate transitions (already sorted by priority)
    for (const transition of this.transitions) {
      // Check if this transition applies from the current state
      if (transition.from !== '*' && transition.from !== this.currentStateName) {
        continue
      }

      // Don't transition to current state
      if (transition.to === this.currentStateName) {
        continue
      }

      // Evaluate condition
      if (transition.condition()) {
        this.transitionTo(transition.to, transition.crossfadeDuration)
        break // Only one transition per frame
      }
    }
  }

  // ============================================================================
  // DIAGNOSTICS
  // ============================================================================

  /**
   * Get a diagnostic snapshot of the state machine.
   */
  getStatus(): {
    characterId: string
    currentState: string
    locked: boolean
    lockTimer: number
    stateCount: number
    transitionCount: number
    params: Readonly<AnimStateParams>
  } {
    return {
      characterId: this.characterId,
      currentState: this.currentStateName,
      locked: this.locked,
      lockTimer: this.lockTimer,
      stateCount: this.states.size,
      transitionCount: this.transitions.length,
      params: { ...this.params },
    }
  }
}

// ============================================================================
// PRESET CONFIGURATIONS
// ============================================================================

/**
 * Create a standard player animation state machine config.
 * This maps common player states to Quaternius animation clip names.
 *
 * @param characterId     The character ID registered with CharacterAnimationSystem
 * @param paramsGetter    Function that returns the current AnimStateParams each frame
 */
export function createPlayerStateMachineConfig(
  characterId: string,
  paramsGetter: () => AnimStateParams
): AnimStateMachineConfig {
  const p = paramsGetter

  const states: AnimState[] = [
    { name: 'idle',           clipName: 'idle' },
    { name: 'walk',           clipName: 'walk' },
    { name: 'run',            clipName: 'run' },
    { name: 'walk_backward',  clipName: 'walk_backward' },
    { name: 'run_backward',   clipName: 'run_backward' },
    { name: 'strafe_left',    clipName: 'strafe_left' },
    { name: 'strafe_right',   clipName: 'strafe_right' },
    { name: 'jump',           clipName: 'jump',  autoTransition: true, nextState: 'fall', crossfadeDuration: 0.1 },
    { name: 'fall',           clipName: 'fall' },
    { name: 'land',           clipName: 'land',  autoTransition: true, nextState: 'idle', crossfadeDuration: 0.1 },
    { name: 'attack',         clipName: 'attack', autoTransition: true, nextState: 'idle', crossfadeDuration: 0.15 },
    { name: 'death',          clipName: 'death' },
    { name: 'crouch_idle',    clipName: 'crouch_idle' },
    { name: 'crouch_walk',    clipName: 'crouch_walk' },
  ]

  const transitions: AnimTransition[] = [
    // Death — highest priority
    { from: '*', to: 'death',          condition: () => p().isDead, priority: 100 },

    // Attack — high priority
    { from: '*', to: 'attack',         condition: () => p().isAttacking && p().isGrounded, priority: 90 },

    // Jump → fall chain (only from jump state, not wildcard)
    { from: 'jump', to: 'fall',        condition: () => !p().isGrounded && p().isFalling, priority: 82 },

    // Jump initiation
    { from: 'idle', to: 'jump',        condition: () => p().isJumping, priority: 80 },
    { from: 'walk', to: 'jump',        condition: () => p().isJumping, priority: 80 },
    { from: 'run',  to: 'jump',        condition: () => p().isJumping, priority: 80 },

    // Fall — only from grounded states when truly airborne (NOT from land)
    { from: 'idle', to: 'fall',        condition: () => p().isFalling && !p().isGrounded, priority: 70 },
    { from: 'walk', to: 'fall',        condition: () => p().isFalling && !p().isGrounded, priority: 70 },
    { from: 'run',  to: 'fall',        condition: () => p().isFalling && !p().isGrounded, priority: 70 },

    // Land — only from fall
    { from: 'fall', to: 'land',        condition: () => p().isGrounded, priority: 75 },

    // Crouch
    { from: '*', to: 'crouch_walk',    condition: () => p().isCrouching && p().speed > 0.5 && p().isGrounded, priority: 55 },
    { from: '*', to: 'crouch_idle',    condition: () => p().isCrouching && p().speed <= 0.5 && p().isGrounded, priority: 50 },

    // Locomotion — thresholds tuned for walkSpeed=1.4, runSpeed=5.0
    { from: '*', to: 'run',            condition: () => p().isRunning && p().speed > 0.5 && p().isGrounded, priority: 40 },
    { from: '*', to: 'walk',           condition: () => p().speed > 0.2 && !p().isRunning && p().isGrounded, priority: 30 },

    // Idle — lowest priority, fallback
    { from: '*', to: 'idle',           condition: () => p().speed <= 0.2 && p().isGrounded && !p().isCrouching, priority: 0 },
  ]

  return {
    characterId,
    states,
    transitions,
    initialState: 'idle',
  }
}

/**
 * Create a simple NPC state machine (idle + walk only).
 */
export function createNPCStateMachineConfig(
  characterId: string,
  paramsGetter: () => AnimStateParams
): AnimStateMachineConfig {
  const p = paramsGetter

  return {
    characterId,
    initialState: 'idle',
    states: [
      { name: 'idle', clipName: 'idle' },
      { name: 'walk', clipName: 'walk' },
      { name: 'death', clipName: 'death' },
    ],
    transitions: [
      { from: '*', to: 'death', condition: () => p().isDead, priority: 100 },
      { from: '*', to: 'walk',  condition: () => p().speed > 0.5, priority: 10 },
      { from: '*', to: 'idle',  condition: () => p().speed <= 0.5, priority: 0 },
    ],
  }
}
