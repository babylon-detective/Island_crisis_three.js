import * as THREE from 'three'
import { NPCSystem, NPCInstance, NPCClass } from './NPCSystem'
import { CollisionSystem } from './CollisionSystem'
import { CharacterAnimationSystem } from './CharacterAnimationSystem'
import { logger, LogModule } from './Logger'

// ============================================================================
// NPC AI — lightweight behaviour layer
// ============================================================================

export type AIBehaviour = 'idle' | 'wander' | 'goto' | 'socialize' | 'follow' | 'flee' | 'group-wander'

export interface AIConfig {
  thinkInterval: number
  walkSpeed: number
  arrivalThreshold: number
  wanderRadius: number
  redPursuitLeashRadius: number
  socializeChance: number
  socialRange: number
  socializeDuration: number
  playerAwarenessRange: number
}

const DEFAULT_AI: AIConfig = {
  thinkInterval: 3,
  walkSpeed: 1.2,
  arrivalThreshold: 0.6,
  wanderRadius: 15,
  redPursuitLeashRadius: 12,
  socializeChance: 0.25,
  socialRange: 5,
  socializeDuration: 4,
  playerAwarenessRange: 8,
}

interface AIState {
  behaviour: AIBehaviour
  thinkTimer: number
  spawnPos: THREE.Vector3
  waypoint: THREE.Vector3 | null
  socialPartner: string | null
  socialTimer: number
  socialAnimStarted: boolean
  playerNearby: boolean
  /** Non-null for every NPC that belongs to a formation group */
  groupId?: string
  /** Set only on followers; the leader has no groupLeaderId */
  groupLeaderId?: string
  /** World-space offset from the leader that this follower maintains */
  formationOffset?: THREE.Vector3
}

// ============================================================================

export class NPCAISystem {
  private npcSystem: NPCSystem
  private collisionSystem: CollisionSystem
  private charAnimSystem: CharacterAnimationSystem
  private states = new Map<string, AIState>()
  private cfg: AIConfig
  private playerPos = new THREE.Vector3()
  private enabled = true
  private _tmp = new THREE.Vector3()
  private _waypointScratch = new THREE.Vector3()

  constructor(
    npcSystem: NPCSystem, collisionSystem: CollisionSystem,
    charAnimSystem: CharacterAnimationSystem, config?: Partial<AIConfig>,
  ) {
    this.npcSystem = npcSystem
    this.collisionSystem = collisionSystem
    this.charAnimSystem = charAnimSystem
    this.cfg = { ...DEFAULT_AI, ...config }
  }

  // ---- lifecycle -----------------------------------------------------------

  initAll(): void {
    for (const npc of this.npcSystem.getAllNPCs()) {
      this.states.set(npc.id, {
        behaviour: 'idle',
        thinkTimer: Math.random() * this.cfg.thinkInterval,
        spawnPos: npc.position.clone(),
        waypoint: null,
        socialPartner: null,
        socialTimer: 0,
        socialAnimStarted: false,
        playerNearby: false,
      })
    }
    logger.info(LogModule.SYSTEM, `NPCAISystem: ${this.states.size} NPCs`)
  }

  setEnabled(v: boolean): void { this.enabled = v }
  setPlayerPosition(p: THREE.Vector3): void { this.playerPos.copy(p) }

  // ---- update --------------------------------------------------------------

  /** Distance beyond which AI is completely frozen. */
  private aiFreezeDistance = 80

  update(dt: number): void {
    if (!this.enabled) return
    for (const npc of this.npcSystem.getAllNPCs()) {
      const ai = this.states.get(npc.id)
      if (!ai) continue

      // Distance-based AI throttling: scale think interval + freeze distant NPCs
      const distToPlayer = npc.position.distanceTo(this.playerPos)
      if (distToPlayer > this.aiFreezeDistance) continue // fully frozen

      // Scale think interval by distance (nearby = base, mid = 3×, far = 6×)
      const distFactor = distToPlayer < 20 ? 1 : distToPlayer < 40 ? 3 : 6

      ai.thinkTimer -= dt
      if (ai.thinkTimer <= 0) {
        ai.thinkTimer = (this.cfg.thinkInterval + (Math.random() - 0.5) * 0.5) * distFactor
        this.think(npc, ai)
      }
      this.execute(npc, ai, dt)
    }
  }

  // ---- think ---------------------------------------------------------------

  private think(npc: NPCInstance, ai: AIState): void {
    // Group followers always stay in group-wander — don't apply solo logic
    if (ai.groupLeaderId) {
      ai.behaviour = 'group-wander'
      return
    }

    ai.playerNearby = npc.position.distanceTo(this.playerPos) < this.cfg.playerAwarenessRange

    if (npc.npcClass === 'red') {
      if (this.npcSystem.isInteractionOnCooldown(npc.id)) {
        this.disengageFromPlayer(npc.id)
        return
      }

      const playerWithinLeash = ai.spawnPos.distanceTo(this.playerPos) <= this.cfg.redPursuitLeashRadius
      if (ai.playerNearby && playerWithinLeash) {
        ai.behaviour = 'follow'
        if (!ai.waypoint) ai.waypoint = new THREE.Vector3()
        ai.waypoint.copy(this.playerPos)
        return
      }
      if (ai.behaviour === 'follow') {
        ai.behaviour = 'idle'
        ai.waypoint = null
      }
    }

    if (ai.behaviour === 'socialize') return

    // try socialize
    if (Math.random() < this.cfg.socializeChance) {
      const nearby = this.npcSystem.getNPCsInRadius(npc.position, this.cfg.socialRange)
        .filter(n => n.id !== npc.id && this.states.get(n.id)?.behaviour !== 'socialize')
      if (nearby.length) {
        this.startSocialize(npc, ai, nearby[Math.floor(Math.random() * nearby.length)])
        return
      }
    }

    if (ai.behaviour === 'idle' && Math.random() < 0.6) {
      ai.behaviour = 'wander'
      const wp = this.randomWaypoint(ai.spawnPos)
      if (!ai.waypoint) ai.waypoint = new THREE.Vector3()
      ai.waypoint.copy(wp)
    } else if (ai.behaviour === 'wander' && !ai.waypoint) {
      ai.behaviour = 'idle'
    }
  }

  // ---- execute -------------------------------------------------------------

  private execute(npc: NPCInstance, ai: AIState, dt: number): void {
    switch (ai.behaviour) {
      case 'idle':          this.doIdle(npc); break
      case 'wander': case 'goto': this.doMove(npc, ai, dt); break
      case 'socialize':     this.doSocialize(npc, ai, dt); break
      case 'follow':        if (!ai.waypoint) ai.waypoint = new THREE.Vector3(); ai.waypoint.copy(this.playerPos); this.doMove(npc, ai, dt); break
      case 'flee':          this.doFlee(npc, ai, dt); break
      case 'group-wander':  this.doGroupFollow(npc, ai, dt); break
    }
  }

  private doIdle(npc: NPCInstance): void {
    npc.velocity.set(0, 0, 0)
    npc.animParams.speed = 0
    npc.state = 'idle'
  }

  private doMove(npc: NPCInstance, ai: AIState, dt: number): void {
    if (!ai.waypoint) { ai.behaviour = 'idle'; return }
    const dir = this._tmp.copy(ai.waypoint).sub(npc.position); dir.y = 0
    if (dir.length() < this.cfg.arrivalThreshold) {
      ai.waypoint = null; ai.behaviour = 'idle'
      npc.velocity.set(0, 0, 0); npc.animParams.speed = 0; npc.state = 'idle'
      return
    }
    dir.normalize()
    npc.velocity.copy(dir).multiplyScalar(this.cfg.walkSpeed)
    npc.position.x += npc.velocity.x * dt
    npc.position.z += npc.velocity.z * dt
    const gH = this.collisionSystem.getGroundHeight(npc.position.x, npc.position.z)
    if (gH > -Infinity) npc.position.y = gH
    npc.rotation = Math.atan2(dir.x, dir.z)
    npc.animParams.speed = this.cfg.walkSpeed
    npc.state = 'walking'
  }

  private doSocialize(npc: NPCInstance, ai: AIState, dt: number): void {
    ai.socialTimer -= dt
    if (ai.socialTimer <= 0) { this.endSocialize(npc, ai); return }
    if (ai.socialPartner) {
      const p = this.npcSystem.getNPC(ai.socialPartner)
      if (p) { const d = this._tmp.copy(p.position).sub(npc.position); d.y = 0; if (d.length() > 0.01) npc.rotation = Math.atan2(d.x, d.z) }
    }
    npc.velocity.set(0, 0, 0); npc.animParams.speed = 0; npc.state = 'talking'
    if (!ai.socialAnimStarted) {
      ai.socialAnimStarted = true
      try { this.charAnimSystem.crossfadeTo(npc.id, 'talking', 0.4) } catch (_) {}
    }
  }

  private doGroupFollow(npc: NPCInstance, ai: AIState, dt: number): void {
    if (!ai.groupLeaderId || !ai.formationOffset) { ai.behaviour = 'idle'; return }
    const leader = this.npcSystem.getNPC(ai.groupLeaderId)
    if (!leader) { ai.behaviour = 'idle'; return }

    // World-space target = leader position + fixed formation offset
    const target = this._waypointScratch.copy(leader.position).add(ai.formationOffset)
    const dir = this._tmp.copy(target).sub(npc.position)
    dir.y = 0
    const dist = dir.length()
    if (dist < this.cfg.arrivalThreshold) {
      npc.velocity.set(0, 0, 0); npc.animParams.speed = 0; npc.state = 'idle'
      return
    }
    dir.normalize()
    npc.velocity.copy(dir).multiplyScalar(this.cfg.walkSpeed)
    npc.position.x += npc.velocity.x * dt
    npc.position.z += npc.velocity.z * dt
    const gH = this.collisionSystem.getGroundHeight(npc.position.x, npc.position.z)
    if (gH > -Infinity) npc.position.y = gH
    npc.rotation = Math.atan2(dir.x, dir.z)
    npc.animParams.speed = this.cfg.walkSpeed
    npc.state = 'walking'
  }

  private doFlee(npc: NPCInstance, ai: AIState, dt: number): void {
    const away = this._tmp.copy(npc.position).sub(this.playerPos); away.y = 0
    if (away.length() < 0.01) away.set(1, 0, 0)
    away.normalize()
    if (!ai.waypoint) ai.waypoint = new THREE.Vector3()
    ai.waypoint.copy(npc.position).add(this._waypointScratch.copy(away).multiplyScalar(this.cfg.wanderRadius))
    this.doMove(npc, ai, dt)
  }

  // ---- social --------------------------------------------------------------

  private startSocialize(npc: NPCInstance, ai: AIState, partner: NPCInstance): void {
    const pAI = this.states.get(partner.id); if (!pAI) return
    const dur = this.cfg.socializeDuration + (Math.random() - 0.5) * 2
    ai.behaviour = 'socialize'; ai.socialPartner = partner.id; ai.socialTimer = dur; ai.socialAnimStarted = false
    pAI.behaviour = 'socialize'; pAI.socialPartner = npc.id; pAI.socialTimer = dur; pAI.socialAnimStarted = false
  }

  private endSocialize(npc: NPCInstance, ai: AIState): void {
    if (ai.socialPartner) {
      const pAI = this.states.get(ai.socialPartner)
      if (pAI?.behaviour === 'socialize') { pAI.behaviour = 'idle'; pAI.socialPartner = null; pAI.socialTimer = 0; pAI.socialAnimStarted = false }
    }
    ai.behaviour = 'idle'; ai.socialPartner = null; ai.socialTimer = 0; ai.socialAnimStarted = false
  }

  private randomWaypoint(origin: THREE.Vector3): THREE.Vector3 {
    const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * this.cfg.wanderRadius
    const x = origin.x + Math.cos(a) * d, z = origin.z + Math.sin(a) * d
    const y = this.collisionSystem.getGroundHeight(x, z)
    return this._waypointScratch.set(x, y > -Infinity ? y : origin.y, z)
  }

  // ---- animation helpers ---------------------------------------------------

  playAnimation(npcId: string, clipName: string, returnToIdle = true): void {
    try {
      this.charAnimSystem.crossfadeTo(npcId, clipName, 0.25)
      if (returnToIdle) this.charAnimSystem.onClipFinished(npcId, clipName, () => { this.charAnimSystem.crossfadeTo(npcId, 'idle', 0.3) })
    } catch (_) {}
  }

  // ---- external commands ---------------------------------------------------

  sendTo(npcId: string, target: THREE.Vector3): void { const ai = this.states.get(npcId); if (ai) { ai.behaviour = 'goto'; ai.waypoint = target.clone() } }
  followPlayer(npcId: string): void { const ai = this.states.get(npcId); if (ai) ai.behaviour = 'follow' }
  fleeFromPlayer(npcId: string): void { const ai = this.states.get(npcId); if (ai) ai.behaviour = 'flee' }
  disengageFromPlayer(npcId: string): void {
    const ai = this.states.get(npcId)
    const npc = this.npcSystem.getNPC(npcId)
    if (!ai || !npc) return
    if (this.npcSystem.isDefeated(npcId)) return
    ai.behaviour = 'idle'
    ai.waypoint = null
    npc.velocity.set(0, 0, 0)
    npc.animParams.speed = 0
    npc.animParams.isRunning = false
    npc.state = 'idle'
  }

  resetToSpawn(npcId: string): void {
    const ai = this.states.get(npcId); const npc = this.npcSystem.getNPC(npcId)
    if (ai && npc) { ai.behaviour = 'idle'; ai.waypoint = null; npc.position.copy(ai.spawnPos) }
  }

  // ---- cluster formation ----------------------------------------------------

  /** Radius around trigger NPC to scan for cluster candidates. */
  private readonly clusterRadius = 12

  /**
   * Gather nearby NPCs into a cluster around the trigger NPC.
   * NPCs of the same class join; others flee.
   * Returns the IDs of NPCs that joined (trigger NPC is always first).
   */
  formCluster(triggerNpcId: string, mode: 'battle' | 'dialogue'): string[] {
    const triggerNpc = this.npcSystem.getNPC(triggerNpcId)
    if (!triggerNpc) return [triggerNpcId]

    const nearby = this.npcSystem.getNPCsInRadius(triggerNpc.position, this.clusterRadius)
      .filter(n => n.id !== triggerNpcId)
      .filter(n => !this.npcSystem.isDefeated(n.id))
      .filter(n => !this.npcSystem.isInteractionOnCooldown(n.id))

    const joined: string[] = [triggerNpcId]

    for (const npc of nearby) {
      const ai = this.states.get(npc.id)
      if (!ai || ai.behaviour === 'flee') continue

      // Same class as trigger → joins the cluster; different class → flees
      if (npc.npcClass === triggerNpc.npcClass) {
        joined.push(npc.id)
        ai.behaviour = 'idle'
        ai.waypoint = null
        npc.velocity.set(0, 0, 0)
        npc.animParams.speed = 0
        npc.state = 'idle'
      } else {
        this.fleeFromPlayer(npc.id)
      }
    }

    logger.info(LogModule.SYSTEM, `Cluster formed (${mode}): ${joined.length} NPCs joined, trigger=${triggerNpcId}`)
    return joined
  }

  /**
   * Release all NPCs in a cluster back to idle AI behaviour.
   */
  releaseCluster(npcIds: string[]): void {
    for (const id of npcIds) {
      this.disengageFromPlayer(id)
    }
  }

  // ---- formation groups ----------------------------------------------------

  /**
   * Spawn `count` NPCs of `npcClass` around `center` and wire them as a
   * cohesive formation unit.  The first NPC becomes the group leader and
   * wanders freely; the rest are followers that continuously track
   * leaderPosition + their fixed formation offset.
   *
   * @param groupId   A unique string identifier (e.g. 'unit-red')
   * @param npcClass  'red' | 'green' | 'blue'
   * @param center    World-space centre for the group
   * @param count     Number of NPCs (including leader)
   * @param spread    Radius within which followers spawn around the leader
   * @returns IDs of all spawned NPCs (leader first)
   */
  async spawnFormationGroup(
    groupId: string,
    npcClass: NPCClass,
    center: THREE.Vector3,
    count: number,
    spread: number,
  ): Promise<string[]> {
    const ids: string[] = []
    const positions: THREE.Vector3[] = []

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const r = i === 0 ? 0 : spread * (0.5 + Math.random() * 0.5)
      const x = center.x + Math.cos(angle) * r
      const z = center.z + Math.sin(angle) * r
      const y = this.collisionSystem.getGroundHeight(x, z)
      const pos = new THREE.Vector3(x, y > -Infinity ? y : center.y, z)
      const id = `${groupId}-${i}`
      await this.npcSystem.spawn({ id, npcClass, position: pos, rotation: Math.random() * Math.PI * 2 })
      ids.push(id)
      positions.push(pos)
    }

    const leaderId = ids[0]
    const leaderPos = positions[0]

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      const pos = positions[i]

      if (i === 0) {
        // Leader — normal wander AI
        this.states.set(id, {
          behaviour: 'idle',
          thinkTimer: Math.random() * this.cfg.thinkInterval,
          spawnPos: pos.clone(),
          waypoint: null,
          socialPartner: null,
          socialTimer: 0,
          socialAnimStarted: false,
          playerNearby: false,
          groupId,
        })
      } else {
        // Follower — permanently tracks leader + formation offset
        this.states.set(id, {
          behaviour: 'group-wander',
          thinkTimer: Math.random() * this.cfg.thinkInterval,
          spawnPos: pos.clone(),
          waypoint: null,
          socialPartner: null,
          socialTimer: 0,
          socialAnimStarted: false,
          playerNearby: false,
          groupId,
          groupLeaderId: leaderId,
          formationOffset: pos.clone().sub(leaderPos),
        })
      }
    }

    logger.info(LogModule.SYSTEM, `Formation group '${groupId}': ${count} ${npcClass} NPCs spawned`)
    return ids
  }

  // ---- queries -------------------------------------------------------------

  getBehaviour(npcId: string): AIBehaviour | undefined { return this.states.get(npcId)?.behaviour }
  isPlayerNearby(npcId: string): boolean { return this.states.get(npcId)?.playerNearby ?? false }

  getInteractableNPCs(range = 4): NPCInstance[] {
    return this.npcSystem.getNPCsInRadius(this.playerPos, range)
      .filter(n => { const ai = this.states.get(n.id); return ai && ai.behaviour !== 'flee' })
  }

  getHostileNPCs(range = 4): NPCInstance[] {
    return this.npcSystem.getNPCsInRadius(this.playerPos, range)
      .filter(n => n.npcClass === 'red')
      .filter(n => { const ai = this.states.get(n.id); return ai && ai.behaviour !== 'flee' })
  }
}
