/**
 * SpawnSystem — WHERE something can appear + WHAT appears there + WHEN.
 *
 * This is the third layer of the item architecture (see docs/ITEM_SYSTEM.md):
 *   1. Item Definition (ItemSystem)   — what the item is
 *   2. Spawn Point      (this file)   — where something can appear
 *   3. Spawn Rule / Loot Table        — what appears there + under what condition
 *
 * Spawn points never hardcode an item id — they reference a loot_table id,
 * which is rolled at collection time. Conditions (flags, quest stage,
 * player level, respawn rules) are evaluated against GameFlags, and
 * collected/respawn state is persisted independently of the static
 * spawn-point data so authoring data can be redeployed without wiping
 * player progress.
 */

import * as THREE from 'three'
import { createItemGeometry } from './ItemSystem'
import type { ItemSystem } from './ItemSystem'
import type { LootTableRegistry } from './LootTable'
import type { GameFlags } from './GameFlags'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SpawnConditions {
  /** Requires a boolean story/dialogue flag to be set. */
  requires_flag?: string
  /** Requires a quest to have reached at least `min_stage`. */
  requires_quest_stage?: { quest_id: string; min_stage: number }
  /**
   * If true (default), the spawn is unavailable once collected until a
   * respawn rule clears it. Set false for points that should always be
   * available regardless of collection history (e.g. a shop restock point).
   */
  not_yet_collected?: boolean
  /** Don't drop tier-3 loot in the tutorial — gate by player level. */
  min_player_level?: number
  /** Hidden/secret — omitted from any future minimap, always shown in the debug visualizer. */
  hidden?: boolean
}

/** `respawns: false` = gone forever. `true` = refills on every level (re)visit.
 *  `{ interval_hours }` = refills after that many real-world hours (e.g. 24 = daily reset). */
export type RespawnRule = boolean | { interval_hours: number }

export interface SpawnDefinition {
  spawn_id: string
  position: [number, number, number]
  level: string
  loot_table: string
  /** Optional: same spawn point, different loot table per difficulty. */
  loot_tables_by_difficulty?: Record<string, string>
  conditions?: SpawnConditions
  respawns: RespawnRule
}

interface SpawnRuntimeState {
  collected: boolean
  collectedAt: number | null
}

const STORAGE_KEY = 'spawnSystem_state_v1'
const PICKUP_RADIUS = 1.6

// ─── SpawnSystem ─────────────────────────────────────────────────────────────

export class SpawnSystem {
  private scene: THREE.Scene
  private itemSystem: ItemSystem
  private lootTables: LootTableRegistry
  private gameFlags: GameFlags

  private definitions: Map<string, SpawnDefinition> = new Map()
  private runtimeState: Map<string, SpawnRuntimeState> = new Map()
  private activeLevel: string | null = null
  private difficulty = 'normal'

  private worldGroup: THREE.Group
  private pickupMeshes: Map<string, THREE.Mesh> = new Map()

  private visualizerGroup: THREE.Group | null = null
  private heatmapGroup: THREE.Group | null = null

  private onPickupCallbacks: Array<(spawnId: string, itemId: string, quantity: number) => void> = []

  constructor(scene: THREE.Scene, itemSystem: ItemSystem, lootTables: LootTableRegistry, gameFlags: GameFlags) {
    this.scene = scene
    this.itemSystem = itemSystem
    this.lootTables = lootTables
    this.gameFlags = gameFlags
    this.worldGroup = new THREE.Group()
    this.worldGroup.name = 'spawn-system-world-pickups'
    this.scene.add(this.worldGroup)
    this.loadRuntimeState()
  }

  // ── Registry ──────────────────────────────────────────────────────────

  registerSpawnPoints(defs: SpawnDefinition[]): void {
    for (const def of defs) {
      if (this.definitions.has(def.spawn_id)) {
        console.warn(`[SpawnSystem] Duplicate spawn_id "${def.spawn_id}" — overwriting.`)
      }
      this.definitions.set(def.spawn_id, def)
      if (!this.runtimeState.has(def.spawn_id)) {
        this.runtimeState.set(def.spawn_id, { collected: false, collectedAt: null })
      }
    }
  }

  removeSpawnPoint(spawnId: string): boolean {
    this.despawnMesh(spawnId)
    return this.definitions.delete(spawnId)
  }

  getDefinition(spawnId: string): SpawnDefinition | undefined {
    return this.definitions.get(spawnId)
  }

  getAllDefinitions(): SpawnDefinition[] {
    return [...this.definitions.values()]
  }

  getDefinitionsForLevel(level: string): SpawnDefinition[] {
    return this.getAllDefinitions().filter(d => d.level === level)
  }

  setDifficulty(difficulty: string): void {
    this.difficulty = difficulty
    this.refreshLevel()
  }

  getDifficulty(): string {
    return this.difficulty
  }

  // ── Level activation ─────────────────────────────────────────────────

  /** Call when a level is (re)entered — spawns eligible pickups, applies respawn rules. */
  activateLevel(level: string): void {
    this.activeLevel = level
    this.refreshLevel()
  }

  /** Re-evaluate and re-spawn the active level (e.g. after registering/removing spawn points at runtime). */
  refresh(): void {
    this.refreshLevel()
  }

  private refreshLevel(): void {
    for (const id of [...this.pickupMeshes.keys()]) this.despawnMesh(id)
    if (!this.activeLevel) return
    for (const def of this.getDefinitionsForLevel(this.activeLevel)) {
      this.tryProcessRespawn(def)
      if (this.isAvailable(def)) this.spawnMesh(def)
    }
    if (this.visualizerGroup) this.rebuildVisualizer()
    if (this.heatmapGroup) this.rebuildHeatmap()
  }

  // ── Condition / respawn evaluation ────────────────────────────────────

  private tryProcessRespawn(def: SpawnDefinition): void {
    const state = this.runtimeState.get(def.spawn_id)
    if (!state || !state.collected) return
    if (def.respawns === false) return
    if (def.respawns === true) {
      state.collected = false
      state.collectedAt = null
      return
    }
    const elapsedHours = state.collectedAt ? (Date.now() - state.collectedAt) / 3_600_000 : Infinity
    if (elapsedHours >= def.respawns.interval_hours) {
      state.collected = false
      state.collectedAt = null
    }
  }

  isAvailable(def: SpawnDefinition): boolean {
    const state = this.runtimeState.get(def.spawn_id)
    const gatedByCollection = def.conditions?.not_yet_collected ?? true
    if (gatedByCollection && state?.collected) return false

    const conditions = def.conditions
    if (conditions?.requires_flag && !this.gameFlags.hasFlag(conditions.requires_flag)) return false
    if (conditions?.requires_quest_stage) {
      const stage = this.gameFlags.getQuestStage(conditions.requires_quest_stage.quest_id)
      if (stage < conditions.requires_quest_stage.min_stage) return false
    }
    if (conditions?.min_player_level !== undefined && this.gameFlags.getPlayerLevel() < conditions.min_player_level) return false
    return true
  }

  private resolveLootTableId(def: SpawnDefinition): string {
    return def.loot_tables_by_difficulty?.[this.difficulty] ?? def.loot_table
  }

  // ── World mesh spawning ───────────────────────────────────────────────

  private spawnMesh(def: SpawnDefinition): void {
    if (this.pickupMeshes.has(def.spawn_id)) return
    const table = this.lootTables.get(this.resolveLootTableId(def))
    const previewItemId = table?.entries[0]?.item_id
    const previewDef = previewItemId ? this.itemSystem.getDefinition(previewItemId) : undefined

    const geometry = createItemGeometry(previewDef?.shape ?? 'cube')
    const material = new THREE.MeshStandardMaterial({
      color: previewDef?.color ?? 0xffd866,
      emissive: previewDef?.color ?? 0xffd866,
      emissiveIntensity: 0.3,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.setScalar(0.4)
    mesh.position.set(def.position[0], def.position[1] + 0.6, def.position[2])
    mesh.userData.spawnId = def.spawn_id
    mesh.userData.baseY = mesh.position.y
    mesh.name = `spawn-pickup-${def.spawn_id}`
    this.worldGroup.add(mesh)
    this.pickupMeshes.set(def.spawn_id, mesh)
  }

  private despawnMesh(spawnId: string): void {
    const mesh = this.pickupMeshes.get(spawnId)
    if (!mesh) return
    this.worldGroup.remove(mesh)
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of materials) m.dispose()
    this.pickupMeshes.delete(spawnId)
  }

  // ── Frame update: idle bob/spin + proximity pickup ────────────────────

  update(deltaTime: number, playerPosition: THREE.Vector3): void {
    const t = performance.now() / 1000
    for (const [spawnId, mesh] of this.pickupMeshes) {
      mesh.rotation.y += deltaTime * 1.2
      const baseY = mesh.userData.baseY as number
      mesh.position.y = baseY + Math.sin(t * 2 + mesh.position.x) * 0.08

      const def = this.definitions.get(spawnId)
      if (!def) continue
      const dx = playerPosition.x - def.position[0]
      const dz = playerPosition.z - def.position[2]
      if (dx * dx + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS) {
        this.collect(spawnId)
      }
    }
  }

  // ── Collection ────────────────────────────────────────────────────────

  collect(spawnId: string): boolean {
    const def = this.definitions.get(spawnId)
    if (!def || !this.isAvailable(def)) return false

    const tableId = this.resolveLootTableId(def)
    const rolled = this.lootTables.roll(tableId)
    if (!rolled) {
      console.warn(`[SpawnSystem] Spawn "${spawnId}" rolled nothing from table "${tableId}".`)
      return false
    }

    this.itemSystem.addItem(rolled.itemId, rolled.quantity)

    const state = this.runtimeState.get(spawnId) ?? { collected: false, collectedAt: null }
    state.collected = true
    state.collectedAt = Date.now()
    this.runtimeState.set(spawnId, state)

    this.despawnMesh(spawnId)
    this.saveRuntimeState()
    for (const cb of this.onPickupCallbacks) cb(spawnId, rolled.itemId, rolled.quantity)
    if (this.visualizerGroup) this.rebuildVisualizer()
    return true
  }

  onPickup(cb: (spawnId: string, itemId: string, quantity: number) => void): void {
    this.onPickupCallbacks.push(cb)
  }

  // ── Authoring / debug mutation ─────────────────────────────────────────

  forceCollect(spawnId: string): boolean {
    return this.collect(spawnId)
  }

  resetSpawn(spawnId: string): void {
    this.runtimeState.set(spawnId, { collected: false, collectedAt: null })
    this.saveRuntimeState()
    const def = this.definitions.get(spawnId)
    if (def && def.level === this.activeLevel && this.isAvailable(def)) this.spawnMesh(def)
    if (this.visualizerGroup) this.rebuildVisualizer()
  }

  resetAll(): void {
    for (const id of this.runtimeState.keys()) this.resetSpawn(id)
  }

  /** Author a new spawn point at a world position (e.g. the player's current position). */
  addSpawnPointAt(
    spawnId: string,
    position: THREE.Vector3,
    level: string,
    lootTable: string,
    conditions?: SpawnConditions,
    respawns: RespawnRule = false,
  ): SpawnDefinition {
    const def: SpawnDefinition = {
      spawn_id: spawnId,
      position: [round2(position.x), round2(position.y), round2(position.z)],
      level,
      loot_table: lootTable,
      conditions,
      respawns,
    }
    this.registerSpawnPoints([def])
    if (level === this.activeLevel && this.isAvailable(def)) this.spawnMesh(def)
    if (this.visualizerGroup) this.rebuildVisualizer()
    return def
  }

  // ── Debug visualizer (in-scene gizmos) ─────────────────────────────────

  toggleVisualizer(visible?: boolean): boolean {
    const show = visible ?? !this.visualizerGroup
    if (!show) {
      if (this.visualizerGroup) {
        this.scene.remove(this.visualizerGroup)
        this.visualizerGroup = null
      }
      return false
    }
    this.rebuildVisualizer()
    return true
  }

  private rebuildVisualizer(): void {
    if (this.visualizerGroup) this.scene.remove(this.visualizerGroup)
    const group = new THREE.Group()
    group.name = 'spawn-system-debug-visualizer'

    for (const def of this.getAllDefinitions()) {
      const available = this.isAvailable(def)
      const state = this.runtimeState.get(def.spawn_id)
      let color = 0x44ff66 // green: available now
      if (def.conditions?.hidden) color = 0xaa44ff       // purple: hidden/secret
      else if (state?.collected) color = 0x888888        // gray: collected
      else if (!available) color = 0xff4444               // red: condition not met

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 12, 8),
        new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.85 }),
      )
      marker.position.set(def.position[0], def.position[1] + 1.4, def.position[2])
      marker.userData.spawnId = def.spawn_id
      group.add(marker)

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(PICKUP_RADIUS - 0.05, PICKUP_RADIUS, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(def.position[0], def.position[1] + 0.02, def.position[2])
      group.add(ring)

      group.add(this.makeLabel(def, color))
    }

    this.scene.add(group)
    this.visualizerGroup = group
  }

  private makeLabel(def: SpawnDefinition, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.font = 'bold 20px monospace'
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
    ctx.fillText(def.spawn_id, 8, 26)
    ctx.font = '14px monospace'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(this.resolveLootTableId(def), 8, 48)

    const texture = new THREE.CanvasTexture(canvas)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
    sprite.scale.set(2, 0.5, 1)
    sprite.position.set(def.position[0], def.position[1] + 2.1, def.position[2])
    return sprite
  }

  // ── Debug heatmap (loot-value density overlay) ─────────────────────────

  toggleHeatmap(visible?: boolean): boolean {
    const show = visible ?? !this.heatmapGroup
    if (!show) {
      if (this.heatmapGroup) {
        this.scene.remove(this.heatmapGroup)
        this.heatmapGroup = null
      }
      return false
    }
    this.rebuildHeatmap()
    return true
  }

  private rarityWeight(rarity: string): number {
    switch (rarity) {
      case 'legendary': return 5
      case 'epic': return 4
      case 'rare': return 3
      case 'uncommon': return 2
      default: return 1
    }
  }

  private rebuildHeatmap(): void {
    if (this.heatmapGroup) this.scene.remove(this.heatmapGroup)
    const group = new THREE.Group()
    group.name = 'spawn-system-debug-heatmap'

    for (const def of this.getAllDefinitions()) {
      const table = this.lootTables.get(this.resolveLootTableId(def))
      if (!table) continue
      let value = 0
      for (const entry of table.entries) {
        const itemDef = this.itemSystem.getDefinition(entry.item_id)
        value += (itemDef ? this.rarityWeight(itemDef.rarity) : 1) * entry.weight
      }
      const t = Math.min(1, value / 300)
      // Heat colour: blue (low value) → red (high value)
      const color = new THREE.Color().setHSL((1 - t) * 0.6, 1, 0.5)
      const disk = new THREE.Mesh(
        new THREE.CircleGeometry(1.2, 20),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      )
      disk.rotation.x = -Math.PI / 2
      disk.position.set(def.position[0], def.position[1] + 0.03, def.position[2])
      group.add(disk)
    }

    this.scene.add(group)
    this.heatmapGroup = group
  }

  // ── Save/load of authoring data ────────────────────────────────────────

  /** Print (and return) spawn-point JSON for copy/paste into config, like exportObjectPositions(). */
  exportSpawnPoints(level?: string): string {
    const defs = level ? this.getDefinitionsForLevel(level) : this.getAllDefinitions()
    return JSON.stringify(defs, null, 2)
  }

  /** Hot-load spawn points from JSON at runtime (for fast authoring iteration). */
  importSpawnPoints(json: string): number {
    const parsed = JSON.parse(json) as SpawnDefinition[]
    this.registerSpawnPoints(parsed)
    this.refreshLevel()
    return parsed.length
  }

  // ── Condition validator (offline lint) ─────────────────────────────────

  validate(): string[] {
    const issues: string[] = []
    const seen = new Set<string>()

    for (const def of this.getAllDefinitions()) {
      if (seen.has(def.spawn_id)) issues.push(`Duplicate spawn_id "${def.spawn_id}".`)
      seen.add(def.spawn_id)

      if (!Array.isArray(def.position) || def.position.length !== 3) {
        issues.push(`Spawn "${def.spawn_id}" has an invalid position (expected [x, y, z]).`)
      }
      if (!this.lootTables.get(def.loot_table)) {
        issues.push(`Spawn "${def.spawn_id}" references unknown loot_table "${def.loot_table}".`)
      }
      if (def.loot_tables_by_difficulty) {
        for (const [diff, tableId] of Object.entries(def.loot_tables_by_difficulty)) {
          if (!this.lootTables.get(tableId)) {
            issues.push(`Spawn "${def.spawn_id}" difficulty "${diff}" references unknown loot_table "${tableId}".`)
          }
        }
      }
      if (def.conditions?.min_player_level !== undefined && def.conditions.min_player_level < 0) {
        issues.push(`Spawn "${def.spawn_id}" has a negative min_player_level.`)
      }
      if (def.conditions?.requires_quest_stage && def.conditions.requires_quest_stage.min_stage < 0) {
        issues.push(`Spawn "${def.spawn_id}" has a negative requires_quest_stage.min_stage.`)
      }
    }

    issues.push(...this.lootTables.validate(this.itemSystem))
    return issues
  }

  /** Run validate() and pretty-print the results to the console. */
  printValidation(): void {
    const issues = this.validate()
    if (issues.length === 0) {
      console.log('✅ Spawn/loot data OK — no issues found.')
      return
    }
    console.group(`⚠️ Spawn/loot data lint — ${issues.length} issue(s)`)
    for (const issue of issues) console.warn(issue)
    console.groupEnd()
  }

  // ── Persistence (collected/respawn state — separate from static data) ──

  private saveRuntimeState(): void {
    try {
      const obj: Record<string, SpawnRuntimeState> = Object.fromEntries(this.runtimeState)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch {
      // storage unavailable — non-fatal
    }
  }

  private loadRuntimeState(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const obj = JSON.parse(raw) as Record<string, SpawnRuntimeState>
      this.runtimeState = new Map(Object.entries(obj))
    } catch {
      // corrupt data — ignore, start fresh
    }
  }

  // ── Debug printing ────────────────────────────────────────────────────

  printAll(): void {
    console.group('🎁 Spawn Points')
    for (const def of this.getAllDefinitions()) {
      const state = this.runtimeState.get(def.spawn_id)
      const status = state?.collected ? 'collected' : this.isAvailable(def) ? 'available' : 'locked'
      console.log(`${def.spawn_id} [${def.level}] @ (${def.position.join(', ')}) — table:${this.resolveLootTableId(def)} — ${status}`)
    }
    console.groupEnd()
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
