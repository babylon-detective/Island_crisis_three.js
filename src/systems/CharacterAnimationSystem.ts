import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { logger, LogModule } from './Logger'

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Descriptor for a single animation clip.
 *
 * Supports two modes:
 *  - **Per-file**: `path` points to a GLB containing one clip (Quaternius split files).
 *  - **Packed**: `path` points to a GLB containing many clips; `sourceClipName`
 *    selects which clip inside the file to use (Quaternius UAL packed files).
 */
export interface AnimationClipDescriptor {
  /** Unique key used to reference this animation (e.g. 'idle', 'walk', 'run') */
  name: string
  /** Path to the GLB/GLTF file containing the animation (relative to public/) */
  path: string
  /**
   * When the GLB contains multiple clips, specify the original clip name
   * inside the file to extract. If omitted, the first clip is used.
   */
  sourceClipName?: string
  /** Whether this clip should loop (default: true) */
  loop?: boolean
  /** Playback speed multiplier (default: 1.0) */
  timeScale?: number
  /** Crossfade duration in seconds when transitioning TO this clip (default: 0.3) */
  crossfadeDuration?: number
  /** Additive weight if this is a layered/additive animation (default: undefined = not additive) */
  additiveWeight?: number
  /** Optional root bone name override for retargeting */
  rootBoneName?: string
}

/**
 * A set of animation clips that belong together (e.g. a full character moveset).
 */
export interface AnimationSet {
  /** Unique identifier for this animation set */
  id: string
  /** Display name */
  displayName: string
  /** Base directory where animation GLBs live (relative to public/) */
  basePath: string
  /** The individual clip descriptors */
  clips: AnimationClipDescriptor[]
  /** Default animation to play when the set is first applied */
  defaultClip: string
  /**
   * When all clips live in one packed GLB, set this to the filename.
   * Individual clip descriptors can then omit `path` and just provide `sourceClipName`.
   */
  packedFile?: string
}

/**
 * Maps bone names from a source skeleton to a target skeleton.
 * Key = source bone name (animation file), Value = target bone name (character model).
 */
export type BoneRemapTable = Record<string, string>

/**
 * Configuration for a character that can be animated.
 */
export interface AnimatedCharacterConfig {
  /** Unique character ID */
  id: string
  /** The Three.js object (loaded model) to animate */
  model: THREE.Object3D
  /** Which animation set to use */
  animationSetId: string
  /** Override crossfade duration globally for this character */
  defaultCrossfadeDuration?: number
  /**
   * Bone remap table for retargeting.
   * If the animation skeleton bone names differ from the character skeleton,
   * provide a mapping: { 'animBoneName': 'characterBoneName', ... }
   */
  boneRemap?: BoneRemapTable
}

/**
 * Runtime state for a single animated character.
 */
interface CharacterAnimationState {
  id: string
  model: THREE.Object3D
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  clips: Map<string, THREE.AnimationClip>
  currentAction: THREE.AnimationAction | null
  currentClipName: string | null
  previousAction: THREE.AnimationAction | null
  animationSetId: string
  defaultCrossfadeDuration: number
  clipCrossfadeDurations: Map<string, number>
  clipTimeScales: Map<string, number>
  boneRemap?: BoneRemapTable
  paused: boolean
}

/**
 * Transition request queued for execution.
 */
interface TransitionRequest {
  characterId: string
  clipName: string
  crossfadeDuration?: number
  timeScale?: number
  onComplete?: () => void
}

// ============================================================================
// BONE REMAPPING UTILITIES
// ============================================================================

/**
 * Build a remap table between the Quaternius UAL skeleton (UE-style naming)
 * and a Blender Rigify DEF- skeleton.
 *
 * This is a best-effort automatic mapping. You can extend or override entries.
 */
export function buildQuaterniusToRigifyRemap(): BoneRemapTable {
  // Ideal_Low_Poly_Male_01.glb Rigify DEF- skeleton (35 bones):
  //   DEF-spine, .001, .002, .003, .004, .005, .006
  //   DEF-pelvis.L, DEF-pelvis.R
  //   DEF-shoulder.L/R, DEF-upper_arm.L/R, DEF-upper_arm.L/R.001 (twist)
  //   DEF-forearm.L/R, DEF-forearm.L/R.001 (twist)
  //   DEF-hand.L/R
  //   DEF-thigh.L/R, DEF-thigh.L/R.001 (twist)
  //   DEF-shin.L/R, DEF-shin.L/R.001 (twist)
  //   DEF-foot.L/R, DEF-toe.L/R
  //   DEF-breast.L/R
  //
  // UAL Armature (65 bones): root, pelvis, spine_01-03, neck_01, Head,
  //   clavicle/upperarm/lowerarm/hand + finger chains + thigh/calf/foot/ball
  //
  // NOTE: The character model has NO finger bones — finger mappings are omitted.
  // The .001 twist bones on the character have no UAL equivalent.
  return {
    // Spine / Torso  (UAL → Rigify DEF-)
    // 'root' is intentionally NOT mapped — it carries root-motion translation
    // that would move DEF-spine incorrectly. Dropped = harmless.
    'pelvis':      'DEF-spine',       // hip / root bone
    'spine_01':    'DEF-spine.001',   // lower spine
    'spine_02':    'DEF-spine.002',   // mid spine
    'spine_03':    'DEF-spine.003',   // upper spine / chest
    'neck_01':     'DEF-spine.004',   // neck
    'Head':        'DEF-spine.006',   // head
    // NOTE: DEF-spine.005 (neck tip) has no UAL equivalent.
    // Left arm
    'clavicle_l':  'DEF-shoulder.L',
    'upperarm_l':  'DEF-upper_arm.L',
    'lowerarm_l':  'DEF-forearm.L',
    'hand_l':      'DEF-hand.L',
    // Right arm
    'clavicle_r':  'DEF-shoulder.R',
    'upperarm_r':  'DEF-upper_arm.R',
    'lowerarm_r':  'DEF-forearm.R',
    'hand_r':      'DEF-hand.R',
    // Left leg
    'thigh_l':     'DEF-thigh.L',
    'calf_l':      'DEF-shin.L',
    'foot_l':      'DEF-foot.L',
    'ball_l':      'DEF-toe.L',
    // Right leg
    'thigh_r':     'DEF-thigh.R',
    'calf_r':      'DEF-shin.R',
    'foot_r':      'DEF-foot.R',
    'ball_r':      'DEF-toe.R',
    // Fingers: NOT mapped — Ideal_Low_Poly_Male_01 has no finger DEF- bones.
    // If you switch to a character model with finger bones, add them here.
  }
}

/**
 * Remap bone names inside an AnimationClip's tracks.
 *
 * Three.js AnimationClip tracks use property paths like:
 *   `"boneName.position"`, `"boneName.quaternion"`, `"boneName.scale"`
 *
 * This function rewrites those paths using the remap table.
 */
export function remapClipBones(clip: THREE.AnimationClip, remapTable: BoneRemapTable): THREE.AnimationClip {
  let remappedCount = 0
  let skippedCount = 0

  for (const track of clip.tracks) {
    const dotIndex = track.name.indexOf('.')
    if (dotIndex === -1) continue

    const boneName = track.name.substring(0, dotIndex)
    const property = track.name.substring(dotIndex)

    if (remapTable[boneName]) {
      track.name = remapTable[boneName] + property
      remappedCount++
    } else {
      skippedCount++
    }
  }

  logger.debug(LogModule.SYSTEM, `Remapped clip "${clip.name}": ${remappedCount} tracks remapped, ${skippedCount} unchanged`)
  return clip
}

/**
 * Extract all bone names from an animation clip's tracks.
 */
export function extractBoneNamesFromClip(clip: THREE.AnimationClip): string[] {
  const bones = new Set<string>()
  for (const track of clip.tracks) {
    const dotIndex = track.name.indexOf('.')
    if (dotIndex !== -1) {
      bones.add(track.name.substring(0, dotIndex))
    }
  }
  return Array.from(bones).sort()
}

/**
 * List all bone/joint names in a skinned mesh's skeleton.
 */
export function extractBoneNamesFromModel(model: THREE.Object3D): string[] {
  const bones = new Set<string>()
  model.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
      const skeleton = (child as THREE.SkinnedMesh).skeleton
      for (const bone of skeleton.bones) {
        bones.add(bone.name)
      }
    }
  })
  return Array.from(bones).sort()
}

// ============================================================================
// ANIMATION CLIP REGISTRY
// ============================================================================

export class AnimationClipRegistry {
  private static instance: AnimationClipRegistry
  private sets: Map<string, AnimationSet> = new Map()

  static getInstance(): AnimationClipRegistry {
    if (!AnimationClipRegistry.instance) {
      AnimationClipRegistry.instance = new AnimationClipRegistry()
    }
    return AnimationClipRegistry.instance
  }

  registerSet(set: AnimationSet): void {
    this.sets.set(set.id, set)
    logger.info(LogModule.SYSTEM, `Registered animation set "${set.id}" with ${set.clips.length} clips`)
  }

  getSet(id: string): AnimationSet | undefined {
    return this.sets.get(id)
  }

  listSets(): string[] {
    return Array.from(this.sets.keys())
  }

  /**
   * Register the Quaternius UAL **packed** set (single GLB, many clips).
   *
   * Maps all 45 clips in `UAL1_Standard.glb` to friendly names.
   */
  registerQuaterniusPackedSet(
    basePath: string = '/models/animations/quaternius',
    fileName: string = 'UAL1_Standard.glb'
  ): AnimationSet {
    const packedPath = `${basePath}/${fileName}`

    const clipDefs: Array<{ source: string; name: string; loop: boolean; crossfade: number; timeScale: number }> = [
      // Core locomotion
      { source: 'Idle_Loop',          name: 'idle',            loop: true,  crossfade: 0.3,  timeScale: 1.0 },
      { source: 'Walk_Loop',          name: 'walk',            loop: true,  crossfade: 0.25, timeScale: 1.0 },
      { source: 'Jog_Fwd_Loop',      name: 'run',             loop: true,  crossfade: 0.2,  timeScale: 1.0 },
      { source: 'Sprint_Loop',       name: 'sprint',          loop: true,  crossfade: 0.2,  timeScale: 1.0 },
      { source: 'Walk_Formal_Loop',  name: 'walk_formal',     loop: true,  crossfade: 0.25, timeScale: 1.0 },
      { source: 'Crouch_Fwd_Loop',   name: 'crouch_walk',     loop: true,  crossfade: 0.25, timeScale: 1.0 },
      { source: 'Crouch_Idle_Loop',  name: 'crouch_idle',     loop: true,  crossfade: 0.25, timeScale: 1.0 },
      // Jumping
      { source: 'Jump_Start',        name: 'jump',            loop: false, crossfade: 0.15, timeScale: 1.0 },
      { source: 'Jump_Loop',         name: 'fall',            loop: true,  crossfade: 0.2,  timeScale: 1.0 },
      { source: 'Jump_Land',         name: 'land',            loop: false, crossfade: 0.15, timeScale: 1.0 },
      // Combat
      { source: 'Punch_Jab',         name: 'attack',          loop: false, crossfade: 0.15, timeScale: 1.0 },
      { source: 'Punch_Cross',       name: 'attack_cross',    loop: false, crossfade: 0.15, timeScale: 1.0 },
      { source: 'Sword_Attack',      name: 'sword_attack',    loop: false, crossfade: 0.15, timeScale: 1.0 },
      { source: 'Sword_Attack_RM',   name: 'sword_attack_rm', loop: false, crossfade: 0.15, timeScale: 1.0 },
      { source: 'Sword_Idle',        name: 'sword_idle',      loop: true,  crossfade: 0.2,  timeScale: 1.0 },
      { source: 'Hit_Chest',         name: 'hit',             loop: false, crossfade: 0.1,  timeScale: 1.0 },
      { source: 'Hit_Head',          name: 'hit_head',        loop: false, crossfade: 0.1,  timeScale: 1.0 },
      { source: 'Death01',           name: 'death',           loop: false, crossfade: 0.3,  timeScale: 1.0 },
      { source: 'Roll',              name: 'roll',            loop: false, crossfade: 0.15, timeScale: 1.0 },
      { source: 'Roll_RM',           name: 'roll_rm',         loop: false, crossfade: 0.15, timeScale: 1.0 },
      // Pistol
      { source: 'Pistol_Idle_Loop',  name: 'pistol_idle',     loop: true,  crossfade: 0.2,  timeScale: 1.0 },
      { source: 'Pistol_Shoot',      name: 'pistol_shoot',    loop: false, crossfade: 0.1,  timeScale: 1.0 },
      { source: 'Pistol_Reload',     name: 'pistol_reload',   loop: false, crossfade: 0.2,  timeScale: 1.0 },
      { source: 'Pistol_Aim_Neutral',name: 'pistol_aim',      loop: false, crossfade: 0.15, timeScale: 1.0 },
      { source: 'Pistol_Aim_Up',     name: 'pistol_aim_up',   loop: false, crossfade: 0.15, timeScale: 1.0 },
      { source: 'Pistol_Aim_Down',   name: 'pistol_aim_down', loop: false, crossfade: 0.15, timeScale: 1.0 },
      // Spell
      { source: 'Spell_Simple_Enter',     name: 'spell_enter', loop: false, crossfade: 0.15, timeScale: 1.0 },
      { source: 'Spell_Simple_Idle_Loop', name: 'spell_idle',  loop: true,  crossfade: 0.2,  timeScale: 1.0 },
      { source: 'Spell_Simple_Shoot',     name: 'spell_shoot', loop: false, crossfade: 0.1,  timeScale: 1.0 },
      { source: 'Spell_Simple_Exit',      name: 'spell_exit',  loop: false, crossfade: 0.15, timeScale: 1.0 },
      // Interactions
      { source: 'Interact',          name: 'interact',        loop: false, crossfade: 0.25, timeScale: 1.0 },
      { source: 'PickUp_Table',      name: 'pick_up',         loop: false, crossfade: 0.25, timeScale: 1.0 },
      { source: 'Push_Loop',         name: 'push',            loop: true,  crossfade: 0.25, timeScale: 1.0 },
      { source: 'Fixing_Kneeling',   name: 'fixing',          loop: false, crossfade: 0.3,  timeScale: 1.0 },
      { source: 'Driving_Loop',      name: 'driving',         loop: true,  crossfade: 0.3,  timeScale: 1.0 },
      // Social
      { source: 'Idle_Talking_Loop', name: 'talking',         loop: true,  crossfade: 0.3,  timeScale: 1.0 },
      { source: 'Dance_Loop',        name: 'dance',           loop: true,  crossfade: 0.3,  timeScale: 1.0 },
      { source: 'Idle_Torch_Loop',   name: 'torch_idle',      loop: true,  crossfade: 0.25, timeScale: 1.0 },
      // Sitting
      { source: 'Sitting_Enter',        name: 'sit_enter',    loop: false, crossfade: 0.3,  timeScale: 1.0 },
      { source: 'Sitting_Idle_Loop',     name: 'sit_idle',     loop: true,  crossfade: 0.3,  timeScale: 1.0 },
      { source: 'Sitting_Talking_Loop',  name: 'sit_talking',  loop: true,  crossfade: 0.3,  timeScale: 1.0 },
      { source: 'Sitting_Exit',          name: 'sit_exit',     loop: false, crossfade: 0.3,  timeScale: 1.0 },
      // Swimming
      { source: 'Swim_Fwd_Loop',    name: 'swim',            loop: true,  crossfade: 0.25, timeScale: 1.0 },
      { source: 'Swim_Idle_Loop',   name: 'swim_idle',       loop: true,  crossfade: 0.25, timeScale: 1.0 },
      // Reference
      { source: 'A_TPose',          name: 'tpose',           loop: false, crossfade: 0.3,  timeScale: 1.0 },
    ]

    const clips: AnimationClipDescriptor[] = clipDefs.map(def => ({
      name: def.name,
      path: packedPath,
      sourceClipName: def.source,
      loop: def.loop,
      timeScale: def.timeScale,
      crossfadeDuration: def.crossfade,
    }))

    const set: AnimationSet = {
      id: 'quaternius-universal',
      displayName: 'Quaternius Universal Animation Library (Packed)',
      basePath,
      clips,
      defaultClip: 'idle',
      packedFile: fileName,
    }

    this.registerSet(set)
    return set
  }

  /**
   * Register the Quaternius set from **split files** (one GLB per animation).
   */
  registerQuaterniusSet(
    basePath: string = '/models/animations/quaternius',
    fileList?: string[]
  ): AnimationSet {
    const defaultFiles: Array<{ file: string; name: string; loop: boolean; crossfade: number; timeScale: number }> = [
      { file: 'Idle.glb',              name: 'idle',              loop: true,  crossfade: 0.3,  timeScale: 1.0 },
      { file: 'Walk.glb',              name: 'walk',              loop: true,  crossfade: 0.25, timeScale: 1.0 },
      { file: 'Run_Forward.glb',       name: 'run',               loop: true,  crossfade: 0.2,  timeScale: 1.0 },
      { file: 'Run_Backward.glb',      name: 'run_backward',      loop: true,  crossfade: 0.2,  timeScale: 1.0 },
      { file: 'Walk_Backward.glb',     name: 'walk_backward',     loop: true,  crossfade: 0.25, timeScale: 1.0 },
      { file: 'Strafe_Left.glb',       name: 'strafe_left',       loop: true,  crossfade: 0.2,  timeScale: 1.0 },
      { file: 'Strafe_Right.glb',      name: 'strafe_right',      loop: true,  crossfade: 0.2,  timeScale: 1.0 },
      { file: 'Jump.glb',              name: 'jump',              loop: false, crossfade: 0.15, timeScale: 1.0 },
      { file: 'Fall.glb',              name: 'fall',              loop: true,  crossfade: 0.2,  timeScale: 1.0 },
      { file: 'Land.glb',              name: 'land',              loop: false, crossfade: 0.15, timeScale: 1.0 },
      { file: 'Attack.glb',            name: 'attack',            loop: false, crossfade: 0.15, timeScale: 1.0 },
      { file: 'Attack_Kick.glb',       name: 'attack_kick',       loop: false, crossfade: 0.15, timeScale: 1.0 },
      { file: 'Block.glb',             name: 'block',             loop: false, crossfade: 0.15, timeScale: 1.0 },
      { file: 'Hit.glb',               name: 'hit',               loop: false, crossfade: 0.1,  timeScale: 1.0 },
      { file: 'Death.glb',             name: 'death',             loop: false, crossfade: 0.3,  timeScale: 1.0 },
      { file: 'Wave.glb',              name: 'wave',              loop: false, crossfade: 0.3,  timeScale: 1.0 },
      { file: 'Pick_Up.glb',           name: 'pick_up',           loop: false, crossfade: 0.25, timeScale: 1.0 },
      { file: 'Interact.glb',          name: 'interact',          loop: false, crossfade: 0.25, timeScale: 1.0 },
      { file: 'Dance.glb',             name: 'dance',             loop: true,  crossfade: 0.3,  timeScale: 1.0 },
      { file: 'Sit.glb',               name: 'sit',               loop: false, crossfade: 0.4,  timeScale: 1.0 },
      { file: 'Crouch_Idle.glb',       name: 'crouch_idle',       loop: true,  crossfade: 0.25, timeScale: 1.0 },
      { file: 'Crouch_Walk.glb',       name: 'crouch_walk',       loop: true,  crossfade: 0.25, timeScale: 1.0 },
    ]

    const entries = fileList
      ? fileList.map(file => ({
          file,
          name: file.replace(/\.glb$/i, '').replace(/\.gltf$/i, '').toLowerCase().replace(/\s+/g, '_'),
          loop: true,
          crossfade: 0.3,
          timeScale: 1.0,
        }))
      : defaultFiles

    const clips: AnimationClipDescriptor[] = entries.map(entry => ({
      name: entry.name,
      path: `${basePath}/${entry.file}`,
      loop: entry.loop,
      timeScale: entry.timeScale,
      crossfadeDuration: entry.crossfade,
    }))

    const set: AnimationSet = {
      id: 'quaternius-universal',
      displayName: 'Quaternius Universal Animation Library',
      basePath,
      clips,
      defaultClip: 'idle',
    }

    this.registerSet(set)
    return set
  }

  registerMinimalSet(
    basePath: string,
    files: { idle: string; walk: string; run: string; jump?: string }
  ): AnimationSet {
    const clips: AnimationClipDescriptor[] = [
      { name: 'idle', path: `${basePath}/${files.idle}`, loop: true, crossfadeDuration: 0.3 },
      { name: 'walk', path: `${basePath}/${files.walk}`, loop: true, crossfadeDuration: 0.25 },
      { name: 'run',  path: `${basePath}/${files.run}`,  loop: true, crossfadeDuration: 0.2 },
    ]
    if (files.jump) {
      clips.push({ name: 'jump', path: `${basePath}/${files.jump}`, loop: false, crossfadeDuration: 0.15 })
    }
    const set: AnimationSet = { id: 'minimal', displayName: 'Minimal Animation Set', basePath, clips, defaultClip: 'idle' }
    this.registerSet(set)
    return set
  }

  registerCustomSet(id: string, displayName: string, basePath: string, clips: AnimationClipDescriptor[], defaultClip: string): AnimationSet {
    const set: AnimationSet = { id, displayName, basePath, clips, defaultClip }
    this.registerSet(set)
    return set
  }
}

// ============================================================================
// CHARACTER ANIMATION SYSTEM
// ============================================================================

/**
 * Manages skeletal/clip-based animations for characters loaded from GLB/GLTF files.
 *
 * Supports two Quaternius distribution formats:
 *  - **Packed**: One GLB file with many clips (e.g. `UAL1_Standard.glb` — 45 clips).
 *    Use `registry.registerQuaterniusPackedSet()`.
 *  - **Split**: One GLB per animation clip.
 *    Use `registry.registerQuaterniusSet()`.
 *
 * For retargeting between mismatched skeletons, provide a `BoneRemapTable`
 * and the system rewrites clip track names before creating mixer actions.
 *
 * Usage:
 * ```ts
 * const cas = new CharacterAnimationSystem()
 * cas.registry.registerQuaterniusPackedSet('/models/animations/quaternius', 'UAL1_Standard.glb')
 * await cas.registerCharacter({
 *   id: 'player',
 *   model: playerModel,
 *   animationSetId: 'quaternius-universal',
 *   boneRemap: buildQuaterniusToRigifyRemap(),
 * })
 * cas.crossfadeTo('player', 'run')
 * // game loop:
 * cas.update(deltaTime)
 * ```
 */
export class CharacterAnimationSystem {
  private characters: Map<string, CharacterAnimationState> = new Map()
  private gltfLoader: GLTFLoader = new GLTFLoader()
  private clipCache: Map<string, THREE.AnimationClip[]> = new Map()
  private loadingPromises: Map<string, Promise<THREE.AnimationClip[]>> = new Map()
  private pendingTransitions: TransitionRequest[] = []
  private isRunning: boolean = true

  public readonly registry: AnimationClipRegistry = AnimationClipRegistry.getInstance()

  // ============================================================================
  // CHARACTER REGISTRATION
  // ============================================================================

  async registerCharacter(config: AnimatedCharacterConfig, preload: boolean = true): Promise<void> {
    const set = this.registry.getSet(config.animationSetId)
    if (!set) {
      logger.error(LogModule.SYSTEM, `Animation set "${config.animationSetId}" not found. Register it first.`)
      throw new Error(`Animation set "${config.animationSetId}" not found`)
    }

    const mixer = new THREE.AnimationMixer(config.model)

    const state: CharacterAnimationState = {
      id: config.id,
      model: config.model,
      mixer,
      actions: new Map(),
      clips: new Map(),
      currentAction: null,
      currentClipName: null,
      previousAction: null,
      animationSetId: config.animationSetId,
      defaultCrossfadeDuration: config.defaultCrossfadeDuration ?? 0.3,
      clipCrossfadeDurations: new Map(),
      clipTimeScales: new Map(),
      boneRemap: config.boneRemap,
      paused: false,
    }

    for (const desc of set.clips) {
      if (desc.crossfadeDuration !== undefined) {
        state.clipCrossfadeDurations.set(desc.name, desc.crossfadeDuration)
      }
      if (desc.timeScale !== undefined) {
        state.clipTimeScales.set(desc.name, desc.timeScale)
      }
    }

    this.characters.set(config.id, state)
    logger.info(LogModule.SYSTEM, `Registered character "${config.id}" with animation set "${config.animationSetId}"`)

    if (preload) {
      await this.loadAllClips(config.id)
      if (set.defaultClip && state.actions.has(set.defaultClip)) {
        this.play(config.id, set.defaultClip)
      }
    }
  }

  unregisterCharacter(characterId: string): void {
    const state = this.characters.get(characterId)
    if (!state) return
    state.mixer.stopAllAction()
    state.mixer.uncacheRoot(state.model)
    state.actions.clear()
    state.clips.clear()
    this.characters.delete(characterId)
    logger.info(LogModule.SYSTEM, `Unregistered character "${characterId}"`)
  }

  // ============================================================================
  // CLIP LOADING
  // ============================================================================

  /**
   * Load all animation clips for a registered character.
   * For packed GLBs, loads the file once and extracts individual clips by name.
   * For split GLBs, loads each file individually.
   */
  async loadAllClips(characterId: string): Promise<void> {
    const state = this.characters.get(characterId)
    if (!state) {
      logger.error(LogModule.SYSTEM, `Character "${characterId}" not registered`)
      return
    }

    const set = this.registry.getSet(state.animationSetId)
    if (!set) return

    // Optimization: if all clips share the same path (packed file), load once
    const uniquePaths = new Set(set.clips.map(c => c.path))

    if (uniquePaths.size === 1) {
      // Packed GLB — load all clips from one file
      const packedPath = set.clips[0].path
      try {
        const allClips = await this.loadClipFromFile(packedPath)
        const clipByName = new Map<string, THREE.AnimationClip>()
        for (const clip of allClips) {
          clipByName.set(clip.name, clip)
        }

        for (const desc of set.clips) {
          const sourceName = desc.sourceClipName ?? desc.name
          const sourceClip = clipByName.get(sourceName)
          if (!sourceClip) {
            logger.warn(LogModule.SYSTEM, `Clip "${sourceName}" not found in packed file "${packedPath}"`)
            continue
          }
          const clip = sourceClip.clone()
          clip.name = desc.name
          this.registerClipOnCharacter(state, desc, clip)
        }

        logger.info(LogModule.SYSTEM, `Character "${characterId}": loaded ${state.actions.size}/${set.clips.length} clips from packed file`)
      } catch (error) {
        logger.error(LogModule.SYSTEM, `Failed to load packed animation file "${packedPath}":`, error)
      }
    } else {
      // Split GLBs — load each individually
      const loadPromises = set.clips.map(desc => this.loadAndRegisterClip(characterId, desc))
      const results = await Promise.allSettled(loadPromises)
      const loaded = results.filter(r => r.status === 'fulfilled').length
      const failed = results.filter(r => r.status === 'rejected').length
      logger.info(LogModule.SYSTEM, `Character "${characterId}": loaded ${loaded} clips, ${failed} failed`)
    }
  }

  /**
   * Register a loaded clip on a character state (applies bone remap, creates action).
   */
  private registerClipOnCharacter(
    state: CharacterAnimationState,
    desc: AnimationClipDescriptor,
    clip: THREE.AnimationClip
  ): void {
    // Apply bone remapping if needed
    if (state.boneRemap) {
      remapClipBones(clip, state.boneRemap)
    }

    state.clips.set(desc.name, clip)

    const action = state.mixer.clipAction(clip)

    if (desc.loop === false) {
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity)
    }

    if (desc.timeScale !== undefined) {
      action.timeScale = desc.timeScale
    }

    state.actions.set(desc.name, action)
  }

  /**
   * Load a single clip GLB and register it on a character (split-file mode).
   */
  async loadAndRegisterClip(characterId: string, desc: AnimationClipDescriptor): Promise<void> {
    const state = this.characters.get(characterId)
    if (!state) {
      throw new Error(`Character "${characterId}" not registered`)
    }

    try {
      const clips = await this.loadClipFromFile(desc.path)
      if (clips.length === 0) {
        logger.warn(LogModule.SYSTEM, `No animation clips found in "${desc.path}"`)
        return
      }

      let clip: THREE.AnimationClip
      if (desc.sourceClipName) {
        const found = clips.find(c => c.name === desc.sourceClipName)
        if (!found) {
          logger.warn(LogModule.SYSTEM, `Clip "${desc.sourceClipName}" not found in "${desc.path}", using first clip`)
          clip = clips[0].clone()
        } else {
          clip = found.clone()
        }
      } else {
        clip = clips[0].clone()
      }

      clip.name = desc.name
      this.registerClipOnCharacter(state, desc, clip)

      logger.debug(LogModule.SYSTEM, `Loaded clip "${desc.name}" from "${desc.path}" (duration: ${clip.duration.toFixed(2)}s)`)
    } catch (error) {
      logger.warn(LogModule.SYSTEM, `Failed to load animation clip "${desc.name}" from "${desc.path}":`, error)
    }
  }

  /**
   * Load animation clips from a GLB/GLTF file with global caching.
   */
  private async loadClipFromFile(path: string): Promise<THREE.AnimationClip[]> {
    if (this.clipCache.has(path)) {
      return this.clipCache.get(path)!.map(clip => clip.clone())
    }

    if (this.loadingPromises.has(path)) {
      const clips = await this.loadingPromises.get(path)!
      return clips.map(clip => clip.clone())
    }

    const loadPromise = new Promise<THREE.AnimationClip[]>((resolve, reject) => {
      this.gltfLoader.load(
        path,
        (gltf) => {
          const clips = gltf.animations || []
          this.clipCache.set(path, clips)
          logger.info(LogModule.SYSTEM, `Loaded ${clips.length} animation(s) from "${path}"`)
          resolve(clips)
        },
        undefined,
        (error) => {
          reject(new Error(`Failed to load animation file: ${path} — ${error}`))
        }
      )
    })

    this.loadingPromises.set(path, loadPromise)

    try {
      const clips = await loadPromise
      return clips.map(clip => clip.clone())
    } finally {
      this.loadingPromises.delete(path)
    }
  }

  async loadClipOnDemand(characterId: string, clipName: string): Promise<boolean> {
    const state = this.characters.get(characterId)
    if (!state) return false
    if (state.actions.has(clipName)) return true

    const set = this.registry.getSet(state.animationSetId)
    if (!set) return false

    const desc = set.clips.find(c => c.name === clipName)
    if (!desc) {
      logger.warn(LogModule.SYSTEM, `Clip "${clipName}" not found in animation set "${state.animationSetId}"`)
      return false
    }

    try {
      await this.loadAndRegisterClip(characterId, desc)
      return true
    } catch {
      return false
    }
  }

  // ============================================================================
  // PLAYBACK CONTROL
  // ============================================================================

  play(characterId: string, clipName: string, timeScale?: number): void {
    const state = this.characters.get(characterId)
    if (!state) return

    const action = state.actions.get(clipName)
    if (!action) {
      logger.warn(LogModule.SYSTEM, `Clip "${clipName}" not available for "${characterId}"`)
      this.loadClipOnDemand(characterId, clipName).then(loaded => {
        if (loaded) this.play(characterId, clipName, timeScale)
      })
      return
    }

    if (state.currentAction && state.currentAction !== action) {
      state.currentAction.stop()
    }

    if (timeScale !== undefined) action.timeScale = timeScale
    action.reset().play()

    state.previousAction = state.currentAction
    state.currentAction = action
    state.currentClipName = clipName
  }

  crossfadeTo(characterId: string, clipName: string, duration?: number, timeScale?: number): void {
    const state = this.characters.get(characterId)
    if (!state) return
    if (state.currentClipName === clipName) return

    const action = state.actions.get(clipName)
    if (!action) {
      logger.warn(LogModule.SYSTEM, `Clip "${clipName}" not available for "${characterId}"`)
      this.loadClipOnDemand(characterId, clipName).then(loaded => {
        if (loaded) this.crossfadeTo(characterId, clipName, duration, timeScale)
      })
      return
    }

    const fadeDuration = duration
      ?? state.clipCrossfadeDurations.get(clipName)
      ?? state.defaultCrossfadeDuration

    if (timeScale !== undefined) {
      action.timeScale = timeScale
    } else {
      const ts = state.clipTimeScales.get(clipName)
      if (ts !== undefined) action.timeScale = ts
    }

    action.reset()
    action.play()

    if (state.currentAction) {
      state.currentAction.crossFadeTo(action, fadeDuration, true)
    }

    state.previousAction = state.currentAction
    state.currentAction = action
    state.currentClipName = clipName
  }

  queueTransition(request: TransitionRequest): void {
    this.pendingTransitions.push(request)
  }

  stopAll(characterId: string): void {
    const state = this.characters.get(characterId)
    if (!state) return
    state.mixer.stopAllAction()
    state.currentAction = null
    state.currentClipName = null
    state.previousAction = null
  }

  setPaused(characterId: string, paused: boolean): void {
    const state = this.characters.get(characterId)
    if (!state) return
    state.paused = paused
    state.mixer.timeScale = paused ? 0 : 1
  }

  setTimeScale(characterId: string, timeScale: number): void {
    const state = this.characters.get(characterId)
    if (!state || !state.currentAction) return
    state.currentAction.timeScale = timeScale
  }

  getCurrentClip(characterId: string): string | null {
    return this.characters.get(characterId)?.currentClipName ?? null
  }

  isClipReady(characterId: string, clipName: string): boolean {
    return this.characters.get(characterId)?.actions.has(clipName) ?? false
  }

  getLoadedClips(characterId: string): string[] {
    const state = this.characters.get(characterId)
    return state ? Array.from(state.actions.keys()) : []
  }

  hasCharacter(characterId: string): boolean {
    return this.characters.has(characterId)
  }

  // ============================================================================
  // ADVANCED FEATURES
  // ============================================================================

  playOnce(characterId: string, clipName: string, crossfadeDuration: number = 0.15): void {
    const state = this.characters.get(characterId)
    if (!state) return

    const action = state.actions.get(clipName)
    if (!action) return

    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.play()

    if (state.currentAction) {
      action.crossFadeFrom(state.currentAction, crossfadeDuration, false)
    }

    const onFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action === action) {
        if (state.currentAction && state.currentAction !== action) {
          state.currentAction.reset().play()
        }
        state.mixer.removeEventListener('finished', onFinished)
      }
    }
    state.mixer.addEventListener('finished', onFinished)
  }

  onClipFinished(characterId: string, clipName: string, callback: () => void): () => void {
    const state = this.characters.get(characterId)
    if (!state) return () => {}

    const handler = (event: { action: THREE.AnimationAction }) => {
      const action = state.actions.get(clipName)
      if (event.action === action) callback()
    }
    state.mixer.addEventListener('finished', handler)
    return () => { state.mixer.removeEventListener('finished', handler) }
  }

  getMixer(characterId: string): THREE.AnimationMixer | undefined {
    return this.characters.get(characterId)?.mixer
  }

  getAction(characterId: string, clipName: string): THREE.AnimationAction | undefined {
    return this.characters.get(characterId)?.actions.get(clipName)
  }

  // ============================================================================
  // UPDATE LOOP
  // ============================================================================

  update(deltaTime: number): void {
    if (!this.isRunning) return

    for (const request of this.pendingTransitions) {
      this.crossfadeTo(request.characterId, request.clipName, request.crossfadeDuration, request.timeScale)
    }
    this.pendingTransitions.length = 0

    for (const [, state] of this.characters) {
      if (!state.paused) {
        state.mixer.update(deltaTime)
      }
    }
  }

  start(): void { this.isRunning = true }
  stop(): void { this.isRunning = false }

  // ============================================================================
  // DIAGNOSTICS
  // ============================================================================

  getStatus(): {
    running: boolean
    characterCount: number
    characters: Array<{
      id: string
      animationSet: string
      currentClip: string | null
      loadedClips: string[]
      paused: boolean
      hasBoneRemap: boolean
    }>
    cachedFiles: number
  } {
    const characters = Array.from(this.characters.values()).map(state => ({
      id: state.id,
      animationSet: state.animationSetId,
      currentClip: state.currentClipName,
      loadedClips: Array.from(state.actions.keys()),
      paused: state.paused,
      hasBoneRemap: !!state.boneRemap,
    }))

    return {
      running: this.isRunning,
      characterCount: this.characters.size,
      characters,
      cachedFiles: this.clipCache.size,
    }
  }

  dispose(): void {
    for (const [id] of this.characters) {
      this.unregisterCharacter(id)
    }
    this.clipCache.clear()
    this.loadingPromises.clear()
    this.pendingTransitions.length = 0
  }
}

export function createCharacterAnimationSystem(): CharacterAnimationSystem {
  return new CharacterAnimationSystem()
}
