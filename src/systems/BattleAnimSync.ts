import * as THREE from 'three'
import { CharacterAnimationSystem } from './CharacterAnimationSystem'
import { BattleCameraController, BattleShotType } from './BattleCameraController'

// ============================================================================
// BATTLE ANIMATION SYNC
//
// Shared clock between character animation and camera sequencer.
// Events fire at semantically meaningful animation frames (impact, peak, land)
// registered as fractions of clip duration — not arbitrary millisecond offsets.
//
// Each frame, polls AnimationAction.time to detect when sync points are
// crossed, then fires registered callbacks (camera cuts, damage, teleports).
// ============================================================================

// ── Sync Point Registry ────────────────────────────────────────────────────

/**
 * A named moment in an animation clip, defined as a fraction of clip duration.
 * e.g. { label: 'impact', fraction: 0.5 } = 50% through the clip.
 */
export interface AnimSyncPoint {
  label: string
  fraction: number  // 0.0 – 1.0
}

// ── Battle Events ──────────────────────────────────────────────────────────

/**
 * An event in a synced battle sequence.
 * Fires when the driving animation reaches the specified sync point.
 */
export interface SyncedBattleEvent {
  /** Sync point label (e.g. 'impact') or raw fraction (0.0–1.0) */
  at: string | number
  /** Camera shot to transition to */
  camera?: BattleShotType
  /** 'cut' (instant, default) or 'tween' (smooth interpolation) */
  cameraMode?: 'cut' | 'tween'
  /** Tween duration in seconds (only for cameraMode='tween') */
  tweenDuration?: number
  /** Arbitrary callback (damage, teleport, VFX, etc.) */
  action?: () => void
}

/**
 * A synced battle sequence: one character's animation drives a series of
 * camera cuts and game events.
 */
export interface SyncedBattleSequence {
  /** Character whose animation drives the timeline */
  characterId: string
  /** Clip to play on that character */
  clipName: string
  /**
   * 'synced' (default): events fire at fractions of clip duration.
   * 'timed': events fire at fractions of the wall-clock `duration`.
   *          Use for approach/setup beats on looping clips.
   */
  mode?: 'synced' | 'timed'
  /** Wall-clock duration in seconds (required for 'timed' mode) */
  duration?: number
  /** Crossfade duration into the clip */
  crossfadeDuration?: number
  /** Time scale override */
  timeScale?: number
  /** Events fired at sync points during playback */
  events: SyncedBattleEvent[]
  /** Called when the sequence completes */
  onComplete?: () => void
}

// ── Active Sequence State ──────────────────────────────────────────────────

interface ResolvedEvent {
  fraction: number
  event: SyncedBattleEvent
}

interface ActiveSequence {
  seq: SyncedBattleSequence
  resolved: ResolvedEvent[]
  nextEventIndex: number
  action: THREE.AnimationAction | null
  clipDuration: number
  /** Wall-clock elapsed (used for 'timed' mode) */
  elapsed: number
  completed: boolean
}

// ============================================================================
// BattleAnimSync
// ============================================================================

export class BattleAnimSync {
  private charAnimSystem: CharacterAnimationSystem
  private battleCamera: BattleCameraController | null = null

  /** Global sync point registry: clipName → sync points */
  private syncPoints: Map<string, AnimSyncPoint[]> = new Map()

  /** Currently active sequence (only one at a time) */
  private active: ActiveSequence | null = null

  /** Queue of sequences to play after current finishes */
  private queue: SyncedBattleSequence[] = []

  constructor(charAnimSystem: CharacterAnimationSystem) {
    this.charAnimSystem = charAnimSystem
  }

  setBattleCameraController(controller: BattleCameraController): void {
    this.battleCamera = controller
  }

  // ── Sync Point Registry ────────────────────────────────────────────────

  /**
   * Register sync points for a clip. Points are fractions of clip duration.
   * Can be called multiple times to add more points for the same clip.
   */
  registerSyncPoints(clipName: string, points: AnimSyncPoint[]): void {
    const existing = this.syncPoints.get(clipName) ?? []
    existing.push(...points)
    existing.sort((a, b) => a.fraction - b.fraction)
    this.syncPoints.set(clipName, existing)
  }

  /** Get registered sync points for a clip. */
  getSyncPoints(clipName: string): AnimSyncPoint[] {
    return this.syncPoints.get(clipName) ?? []
  }

  /**
   * Resolve a sync label (or raw number) to a fraction.
   */
  resolveFraction(clipName: string, at: string | number): number {
    if (typeof at === 'number') return at
    const points = this.syncPoints.get(clipName)
    if (!points) return 0
    const point = points.find(p => p.label === at)
    return point?.fraction ?? 0
  }

  // ── Sequence Playback ──────────────────────────────────────────────────

  /**
   * Play a synced battle sequence. The character's animation clip drives
   * the timeline — events fire at registered sync points.
   * If a sequence is already playing, the new one is queued.
   */
  play(seq: SyncedBattleSequence): void {
    if (this.active) {
      this.queue.push(seq)
      return
    }
    this.startSequence(seq)
  }

  /**
   * Play a chain of sequences back-to-back.
   */
  playChain(sequences: SyncedBattleSequence[]): void {
    if (sequences.length === 0) return
    for (let i = 1; i < sequences.length; i++) {
      this.queue.push(sequences[i])
    }
    this.play(sequences[0])
  }

  /**
   * Skip all active and queued sequences.
   * Fires all remaining events and onComplete callbacks immediately.
   */
  skip(): void {
    if (this.active && !this.active.completed) {
      for (let i = this.active.nextEventIndex; i < this.active.resolved.length; i++) {
        this.fireEvent(this.active.resolved[i].event)
      }
      this.active.completed = true
      this.active.seq.onComplete?.()
    }
    this.active = null

    for (const seq of this.queue) {
      const resolved = this.resolveEvents(seq)
      for (const r of resolved) {
        this.fireEvent(r.event)
      }
      seq.onComplete?.()
    }
    this.queue = []
  }

  /** Whether any sequence is currently active or queued. */
  get busy(): boolean {
    return this.active !== null || this.queue.length > 0
  }

  /** Stop everything without firing remaining callbacks. */
  abort(): void {
    this.active = null
    this.queue = []
  }

  // ── Per-frame Update ───────────────────────────────────────────────────

  /**
   * Call each frame from CameraManager.update() or BattleSystem.update().
   * Polls animation progress and fires events whose sync points are crossed.
   */
  update(dt: number): void {
    if (!this.active) return

    if (!this.active.completed) {
      this.processActive(dt)
    }

    if (this.active?.completed) {
      this.active = null
      if (this.queue.length > 0) {
        this.startSequence(this.queue.shift()!)
      }
    }
  }

  // ── Camera Utilities ───────────────────────────────────────────────────

  /** Instant camera cut (convenience wrapper). */
  cameraCut(shotType: BattleShotType): void {
    this.battleCamera?.cutTo(shotType)
  }

  /** Smooth camera tween to a shot type over `duration` seconds. */
  cameraTween(shotType: BattleShotType, duration: number): void {
    this.battleCamera?.tweenTo(shotType, duration)
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private startSequence(seq: SyncedBattleSequence): void {
    // Start the driving animation
    try {
      this.charAnimSystem.crossfadeTo(
        seq.characterId,
        seq.clipName,
        seq.crossfadeDuration ?? 0.08,
        seq.timeScale,
      )
    } catch (_) { /* clip may not be loaded yet — events still fire by time */ }

    // Grab the action so we can poll its .time
    const action = this.charAnimSystem.getAction(seq.characterId, seq.clipName) ?? null
    const clip = action?.getClip()
    const clipDuration = clip?.duration ?? 1.0

    const resolved = this.resolveEvents(seq)

    const active: ActiveSequence = {
      seq,
      resolved,
      nextEventIndex: 0,
      action,
      clipDuration,
      elapsed: 0,
      completed: false,
    }
    this.active = active

    // Fire any events at fraction 0 immediately
    while (active.nextEventIndex < resolved.length && resolved[active.nextEventIndex].fraction <= 0) {
      this.fireEvent(resolved[active.nextEventIndex].event)
      active.nextEventIndex++
    }
  }

  private resolveEvents(seq: SyncedBattleSequence): ResolvedEvent[] {
    const resolved = seq.events.map(event => ({
      fraction: this.resolveFraction(seq.clipName, event.at),
      event,
    }))
    resolved.sort((a, b) => a.fraction - b.fraction)
    return resolved
  }

  private processActive(dt: number): void {
    const active = this.active!
    const isTimed = active.seq.mode === 'timed'

    let fraction: number

    if (isTimed) {
      // Wall-clock mode: fraction = elapsed / duration
      active.elapsed += dt
      const dur = active.seq.duration ?? 1
      fraction = dur > 0 ? active.elapsed / dur : 1
    } else {
      // Animation-synced mode: fraction = action.time / clipDuration
      const action = active.action
      if (!action) {
        // No action — use wall-clock fallback with clip duration
        active.elapsed += dt
        fraction = active.clipDuration > 0 ? active.elapsed / active.clipDuration : 1
      } else {
        const time = action.time
        fraction = active.clipDuration > 0 ? time / active.clipDuration : 1
      }
    }

    // Fire all events whose fraction has been reached
    while (
      active.nextEventIndex < active.resolved.length &&
      fraction >= active.resolved[active.nextEventIndex].fraction
    ) {
      this.fireEvent(active.resolved[active.nextEventIndex].event)
      active.nextEventIndex++
    }

    // Completion check
    const allEventsFired = active.nextEventIndex >= active.resolved.length

    if (isTimed) {
      const dur = active.seq.duration ?? 1
      if (active.elapsed >= dur && allEventsFired) {
        active.completed = true
        active.seq.onComplete?.()
      }
    } else {
      // Synced: complete when clip finishes or all events fired past 0.99
      const action = active.action
      const clipDone = action
        ? (action.paused || !action.isRunning() || fraction >= 0.99)
        : fraction >= 0.99
      if (clipDone && allEventsFired) {
        active.completed = true
        active.seq.onComplete?.()
      }
    }
  }

  private fireEvent(event: SyncedBattleEvent): void {
    if (event.camera) {
      if (event.cameraMode === 'tween') {
        this.cameraTween(event.camera, event.tweenDuration ?? 0.3)
      } else {
        this.cameraCut(event.camera)
      }
    }
    event.action?.()
  }

  // ── Debug / GUI Helpers ────────────────────────────────────────────────

  /** List all clip names that have registered sync points. */
  getRegisteredClips(): string[] {
    return Array.from(this.syncPoints.keys())
  }

  /**
   * Get a mutable reference to a specific sync point object.
   * The GUI can bind sliders directly to the returned `.fraction` property.
   */
  getSyncPointRef(clipName: string, label: string): AnimSyncPoint | null {
    const points = this.syncPoints.get(clipName)
    return points?.find(p => p.label === label) ?? null
  }

  /**
   * Re-sort sync points for a clip after GUI edits change fractions.
   * Call after any slider change to keep firing order correct.
   */
  resortSyncPoints(clipName: string): void {
    const points = this.syncPoints.get(clipName)
    if (points) points.sort((a, b) => a.fraction - b.fraction)
  }

  /** Print current sync point registry to the browser console as JSON. */
  printSyncPoints(): void {
    const out: Record<string, Record<string, number>> = {}
    for (const [clip, points] of this.syncPoints) {
      out[clip] = {}
      for (const p of points) {
        out[clip][p.label] = parseFloat(p.fraction.toFixed(4))
      }
    }
    console.log('🎬 BattleAnimSync sync points (copy into registerDefaultSyncPoints):')
    console.log(JSON.stringify(out, null, 2))
  }

  /** Snapshot of runtime state for debug display. */
  getActiveStatus(): {
    busy: boolean
    clipName: string | null
    characterId: string | null
    mode: string | null
    fraction: number
    nextEvent: string | null
    queueLength: number
  } {
    if (!this.active) {
      return { busy: this.busy, clipName: null, characterId: null, mode: null, fraction: 0, nextEvent: null, queueLength: this.queue.length }
    }
    const a = this.active
    const isTimed = a.seq.mode === 'timed'
    let fraction = 0
    if (isTimed) {
      fraction = (a.seq.duration ?? 1) > 0 ? a.elapsed / (a.seq.duration ?? 1) : 1
    } else if (a.action) {
      fraction = a.clipDuration > 0 ? a.action.time / a.clipDuration : 0
    }
    const nextEvt = a.nextEventIndex < a.resolved.length
      ? a.resolved[a.nextEventIndex]
      : null
    return {
      busy: true,
      clipName: a.seq.clipName,
      characterId: a.seq.characterId,
      mode: a.seq.mode ?? 'synced',
      fraction: parseFloat(fraction.toFixed(3)),
      nextEvent: nextEvt ? `${typeof nextEvt.event.at === 'string' ? nextEvt.event.at : nextEvt.fraction.toFixed(2)}` : null,
      queueLength: this.queue.length,
    }
  }
}

// ============================================================================
// DEFAULT SYNC POINTS
// ============================================================================

/**
 * Register common sync points for standard animation clips.
 * Call once during initialization.
 */
export function registerDefaultSyncPoints(sync: BattleAnimSync): void {
  // Attack clip — typical Quaternius/Mixamo ~1s one-handed swing
  sync.registerSyncPoints('attack', [
    { label: 'start',          fraction: 0.0  },
    { label: 'wind-up',        fraction: 0.15 },
    { label: 'peak',           fraction: 0.35 },
    { label: 'impact',         fraction: 0.50 },
    { label: 'follow-through', fraction: 0.70 },
    { label: 'recover',        fraction: 0.90 },
    { label: 'end',            fraction: 1.0  },
  ])

  // Run/walk — useful for timed approach sequences
  sync.registerSyncPoints('run', [
    { label: 'start',      fraction: 0.0  },
    { label: 'left-step',  fraction: 0.25 },
    { label: 'mid',        fraction: 0.50 },
    { label: 'right-step', fraction: 0.75 },
    { label: 'end',        fraction: 1.0  },
  ])

  // Death clip
  sync.registerSyncPoints('death', [
    { label: 'start',    fraction: 0.0  },
    { label: 'buckle',   fraction: 0.20 },
    { label: 'collapse', fraction: 0.50 },
    { label: 'ground',   fraction: 0.80 },
    { label: 'end',      fraction: 1.0  },
  ])

  // Idle — not commonly driven, but available
  sync.registerSyncPoints('idle', [
    { label: 'start', fraction: 0.0 },
    { label: 'mid',   fraction: 0.5 },
    { label: 'end',   fraction: 1.0 },
  ])
}
