import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CollisionSystem } from './CollisionSystem'
import { CharacterAnimationSystem } from './CharacterAnimationSystem'
import { AnimationStateMachine, createNPCStateMachineConfig, AnimStateParams } from './AnimationStateMachine'
import { SHADERS } from '../shaderImports'
import { logger, LogModule } from './Logger'

// ============================================================================
// NPC TYPES
// ============================================================================

export type NPCClass = 'red' | 'green' | 'blue'

/** Tint colours per class — blended with the mesh's base colour. */
const CLASS_TINTS: Record<NPCClass, THREE.Color> = {
  red:   new THREE.Color(0.95, 0.25, 0.2),
  green: new THREE.Color(0.2, 0.9, 0.3),
  blue:  new THREE.Color(0.2, 0.35, 0.95),
}

export interface NPCConfig {
  id: string
  npcClass: NPCClass
  position: THREE.Vector3
  rotation?: number
}

export interface NPCInstance {
  id: string
  npcClass: NPCClass
  model: THREE.Group
  stateMachine: AnimationStateMachine | null
  position: THREE.Vector3
  velocity: THREE.Vector3
  rotation: number
  state: NPCState
  animParams: AnimStateParams
}

export type NPCState = 'idle' | 'walking' | 'talking' | 'interacting' | 'dead'

// ============================================================================
// NPC SYSTEM — Simplified: single shader, colour via uniform, lean animations
// ============================================================================

export class NPCSystem {
  private scene: THREE.Scene
  private collisionSystem: CollisionSystem
  private charAnimSystem: CharacterAnimationSystem

  private npcs: Map<string, NPCInstance> = new Map()
  private cachedNPCList: NPCInstance[] | null = null

  private gltfLoader = new GLTFLoader()
  private sourceModel: THREE.Group | null = null

  // Shared shader source (same as player)
  private vertexShader = ''
  private fragmentShader = ''

  constructor(scene: THREE.Scene, collisionSystem: CollisionSystem, charAnimSystem: CharacterAnimationSystem) {
    this.scene = scene
    this.collisionSystem = collisionSystem
    this.charAnimSystem = charAnimSystem
  }

  // --------------------------------------------------------------------------
  // INIT
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    this.vertexShader = SHADERS['src/shaders/default-character-vertex.glsl']
    this.fragmentShader = SHADERS['src/shaders/default-character-fragment.glsl']
    await this.loadTemplate()
    logger.info(LogModule.SYSTEM, 'NPCSystem initialized')
  }

  private loadTemplate(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        '/models/characters/Ideal_Low_Poly_Male_01.glb',
        (gltf) => { this.sourceModel = gltf.scene; resolve() },
        undefined,
        (err) => { logger.error(LogModule.SYSTEM, 'NPC template load failed', err); reject(err) },
      )
    })
  }

  // --------------------------------------------------------------------------
  // CLONE — same mesh, same shader, different uModelColor per class
  // --------------------------------------------------------------------------

  private cloneModel(npcClass: NPCClass): THREE.Group {
    if (!this.sourceModel) throw new Error('NPC template not loaded')

    const clone = this.sourceModel.clone(true)

    // Rebuild skeleton on cloned SkinnedMeshes ---------------------
    const sourceSkinned: THREE.SkinnedMesh[] = []
    this.sourceModel.traverse(c => { if ((c as THREE.SkinnedMesh).isSkinnedMesh) sourceSkinned.push(c as THREE.SkinnedMesh) })

    const cloneSkinned: THREE.SkinnedMesh[] = []
    clone.traverse(c => { if ((c as THREE.SkinnedMesh).isSkinnedMesh) cloneSkinned.push(c as THREE.SkinnedMesh) })

    const boneMap = new Map<string, THREE.Bone>()
    clone.traverse(c => { if ((c as THREE.Bone).isBone) boneMap.set(c.name, c as THREE.Bone) })

    for (let i = 0; i < cloneSkinned.length; i++) {
      const src = sourceSkinned[i]
      const cln = cloneSkinned[i]
      const bones: THREE.Bone[] = []
      const inverses: THREE.Matrix4[] = []
      for (let b = 0; b < src.skeleton.bones.length; b++) {
        const found = boneMap.get(src.skeleton.bones[b].name)
        if (found) { bones.push(found); inverses.push(src.skeleton.boneInverses[b].clone()) }
      }
      if (bones.length) cln.bind(new THREE.Skeleton(bones, inverses), src.bindMatrix.clone())
    }

    // Apply tinted shader material (same shader, different uModelColor) ----
    const tint = CLASS_TINTS[npcClass]
    clone.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return
      const orig = child.material as THREE.Material
      let base = new THREE.Color(0xcccccc)
      if (orig instanceof THREE.MeshStandardMaterial) {
        base = orig.color.clone().lerp(new THREE.Color(1, 1, 1), 0.45)
      }
      // Blend base colour toward class tint
      const modelColor = base.clone().lerp(tint, 0.6)

      child.material = new THREE.ShaderMaterial({
        uniforms: {
          uModelColor:      { value: modelColor },
          uLightDir:        { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
          uLightColor:      { value: new THREE.Color(1.0, 1.0, 0.95) },
          uLightIntensity:  { value: 1.0 },
          uLight2Dir:       { value: new THREE.Vector3(-0.4, 0.3, -0.6).normalize() },
          uLight2Color:     { value: new THREE.Color(0.6, 0.7, 1.0) },
          uLight2Intensity: { value: 0.0 },
          uAmbient:         { value: 0.55 },
          uBrightBoost:     { value: 0.18 },
          uBands:           { value: 3.0 },
          uRimColor:        { value: new THREE.Color(1.0, 1.0, 1.0) },
          uRimStrength:     { value: 0.45 },
          uRimPower:        { value: 2.5 },
          uSpecStrength:    { value: 0.15 },
          uSpecPower:       { value: 32.0 },
          uOutlineWidth:    { value: 0.38 },
          uOutlineColor:    { value: new THREE.Color(0.08, 0.06, 0.12) },
        },
        vertexShader: this.vertexShader,
        fragmentShader: this.fragmentShader,
        side: THREE.DoubleSide,
      })
      child.castShadow = true
      child.receiveShadow = true
    })

    return clone
  }

  // --------------------------------------------------------------------------
  // SPAWN / DESPAWN
  // --------------------------------------------------------------------------

  async spawn(config: NPCConfig): Promise<NPCInstance> {
    const model = this.cloneModel(config.npcClass)

    // Scale to ~1.8 m (same capsule height as player)
    const bbox = new THREE.Box3().setFromObject(model)
    const h = bbox.max.y - bbox.min.y
    if (h > 0) model.scale.setScalar(1.8 / h)

    model.position.copy(config.position)
    if (config.rotation !== undefined) model.rotation.y = config.rotation
    model.name = `NPC_${config.id}`

    this.scene.add(model)

    const animParams: AnimStateParams = {
      speed: 0, isGrounded: true, isJumping: false, isFalling: false,
      isRunning: false, isAttacking: false, isDead: false, isCrouching: false,
      movementX: 0, movementZ: 0,
    }

    const npc: NPCInstance = {
      id: config.id, npcClass: config.npcClass, model,
      stateMachine: null,
      position: config.position.clone(), velocity: new THREE.Vector3(),
      rotation: config.rotation ?? 0, state: 'idle', animParams,
    }

    this.npcs.set(config.id, npc)
    this.cachedNPCList = null

    // Animation — register, load only the 3 clips the NPC FSM uses, start idle
    try {
      await this.charAnimSystem.registerCharacter(
        { id: config.id, model, animationSetId: 'quaternius-universal', defaultCrossfadeDuration: 0.3 },
        false, // don't preload all 45 clips
      )
      await this.charAnimSystem.loadSpecificClips(config.id, ['idle', 'walk', 'talking'])
      this.charAnimSystem.play(config.id, 'idle')

      const fsm = new AnimationStateMachine(this.charAnimSystem)
      fsm.configure(createNPCStateMachineConfig(config.id, () => npc.animParams))
      npc.stateMachine = fsm
    } catch (err) {
      logger.warn(LogModule.SYSTEM, `Anim setup skipped for ${config.id}: ${err}`)
    }

    return npc
  }

  despawn(id: string): void {
    const npc = this.npcs.get(id)
    if (!npc) return
    this.scene.remove(npc.model)
    this.charAnimSystem.unregisterCharacter(id)
    this.npcs.delete(id)
    this.cachedNPCList = null
  }

  // --------------------------------------------------------------------------
  // BATCH SPAWN
  // --------------------------------------------------------------------------

  async spawnCrowd(count: number = 10, radius: number = 40): Promise<void> {
    const classes: NPCClass[] = ['red', 'green', 'blue']
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
      const dist  = 8 + Math.random() * (radius - 8)
      const x = Math.cos(angle) * dist
      const z = Math.sin(angle) * dist
      const y = this.collisionSystem.getGroundHeight(x, z)
      await this.spawn({
        id: `npc-${i}`,
        npcClass: classes[i % 3],
        position: new THREE.Vector3(x, y > -Infinity ? y : 0, z),
        rotation: Math.random() * Math.PI * 2,
      })
    }
    logger.info(LogModule.SYSTEM, `NPC crowd: ${count} spawned`)
  }

  // --------------------------------------------------------------------------
  // UPDATE — same ground-snap approach as PlayerController
  // --------------------------------------------------------------------------

  update(deltaTime: number): void {
    for (const npc of this.npcs.values()) {
      if (npc.stateMachine) {
        npc.stateMachine.setParams(npc.animParams)
        npc.stateMachine.update(deltaTime)
      }

      // Ground snap only while moving (same getGroundHeight as player)
      if (npc.animParams.speed > 0.1) {
        const gH = this.collisionSystem.getGroundHeight(npc.position.x, npc.position.z)
        if (gH > -Infinity) npc.position.y = gH
      }

      npc.model.position.copy(npc.position)
      npc.model.rotation.y = npc.rotation
    }
  }

  // --------------------------------------------------------------------------
  // ACCESSORS
  // --------------------------------------------------------------------------

  getNPC(id: string): NPCInstance | undefined { return this.npcs.get(id) }

  getAllNPCs(): NPCInstance[] {
    if (!this.cachedNPCList) this.cachedNPCList = Array.from(this.npcs.values())
    return this.cachedNPCList
  }

  getNPCsByClass(cls: NPCClass): NPCInstance[] {
    return this.getAllNPCs().filter(n => n.npcClass === cls)
  }

  getNPCsInRadius(center: THREE.Vector3, radius: number): NPCInstance[] {
    const r2 = radius * radius
    return this.getAllNPCs().filter(n => n.position.distanceToSquared(center) <= r2)
  }

  getCount(): number { return this.npcs.size }
}
