/**
 * PotionScatterSystem — procedurally scatters potion pickups throughout a
 * level on top of the SpawnSystem/LootTable layers (see docs/ITEM_SYSTEM.md).
 *
 * This never hardcodes an item into a location either: it registers ordinary
 * SpawnSystem spawn points that reference a shared "potion_scatter" loot
 * table, positioned with a seeded RNG + rejection sampling for spacing so
 * layouts are reproducible and non-overlapping.
 */

import type { SpawnSystem, SpawnDefinition } from './SpawnSystem'
import type { LootTableRegistry, LootTable } from './LootTable'
import type { ItemSystem } from './ItemSystem'
import type { CollisionSystem } from './CollisionSystem'

export interface PotionScatterConfig {
  level: string
  count: number
  center: [number, number]   // x, z
  radius: number
  minSpacing: number
  respawnHours: number
  seed: number
}

const DEFAULT_CONFIG: PotionScatterConfig = {
  level: 'whispering_forest',
  count: 20,
  center: [0, 0],
  radius: 50,
  minSpacing: 4,
  respawnHours: 12,
  seed: 1,
}

const SCATTER_LOOT_TABLE_ID = 'potion_scatter'
const SCATTER_ID_PREFIX = 'potion_scatter_'

/** Seeded RNG (mulberry32) so a given seed always produces the same layout. */
function mulberry32(seed: number): () => number {
  let a = seed
  return function (): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class PotionScatterSystem {
  private spawnSystem: SpawnSystem
  private lootTables: LootTableRegistry
  private collisionSystem: CollisionSystem | null

  private config: PotionScatterConfig = { ...DEFAULT_CONFIG }
  private scatteredIds: string[] = []

  constructor(spawnSystem: SpawnSystem, lootTables: LootTableRegistry, _itemSystem: ItemSystem, collisionSystem?: CollisionSystem) {
    this.spawnSystem = spawnSystem
    this.lootTables = lootTables
    this.collisionSystem = collisionSystem ?? null
    this.ensureLootTable()
  }

  private ensureLootTable(): void {
    if (this.lootTables.get(SCATTER_LOOT_TABLE_ID)) return
    const table: LootTable = {
      table_id: SCATTER_LOOT_TABLE_ID,
      entries: [
        { item_id: 'potion', weight: 55, min: 1, max: 1 },
        { item_id: 'potion_hp', weight: 30, min: 1, max: 1 },
        { item_id: 'ether', weight: 15, min: 1, max: 1 },
      ],
    }
    this.lootTables.register(table)
  }

  getConfig(): PotionScatterConfig {
    return { ...this.config }
  }

  setConfig(partial: Partial<PotionScatterConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  isEnabled(): boolean {
    return this.scatteredIds.length > 0
  }

  getScatteredCount(): number {
    return this.scatteredIds.length
  }

  /** Procedurally place potion spawn points across the level (rejection-sampled for spacing). */
  scatter(config: Partial<PotionScatterConfig> = {}): number {
    this.clear()
    this.setConfig(config)
    const { level, count, center, radius, minSpacing, respawnHours, seed } = this.config
    const rng = mulberry32(seed)
    const placed: Array<[number, number]> = []
    const defs: SpawnDefinition[] = []

    const maxAttemptsPerPoint = 30
    for (let i = 0; i < count; i++) {
      let position: [number, number] | null = null
      for (let attempt = 0; attempt < maxAttemptsPerPoint; attempt++) {
        // Uniform-disc sampling (sqrt(rng) avoids center clustering) within `radius` of `center`.
        const angle = rng() * Math.PI * 2
        const dist = Math.sqrt(rng()) * radius
        const x = center[0] + Math.cos(angle) * dist
        const z = center[1] + Math.sin(angle) * dist
        const farEnough = placed.every(([px, pz]) => {
          const dx = x - px
          const dz = z - pz
          return dx * dx + dz * dz >= minSpacing * minSpacing
        })
        if (farEnough) {
          position = [x, z]
          break
        }
      }
      if (!position) continue // couldn't find a free spot — skip rather than overlap

      placed.push(position)
      const [x, z] = position
      const y = this.collisionSystem ? this.collisionSystem.getGroundHeight(x, z) : 0
      const spawnId = `${SCATTER_ID_PREFIX}${String(i).padStart(4, '0')}`
      defs.push({
        spawn_id: spawnId,
        position: [round2(x), round2(y), round2(z)],
        level,
        loot_table: SCATTER_LOOT_TABLE_ID,
        conditions: { not_yet_collected: true },
        respawns: { interval_hours: respawnHours },
      })
    }

    this.spawnSystem.registerSpawnPoints(defs)
    this.scatteredIds = defs.map(d => d.spawn_id)
    this.spawnSystem.refresh()
    return defs.length
  }

  /** Remove every currently-scattered potion spawn point. */
  clear(): void {
    for (const id of this.scatteredIds) this.spawnSystem.removeSpawnPoint(id)
    this.scatteredIds = []
    this.spawnSystem.refresh()
  }

  /** Re-roll positions, optionally with a new seed (defaults to seed + 1). */
  regenerate(newSeed?: number): number {
    return this.scatter({ seed: newSeed ?? this.config.seed + 1 })
  }

  printConfig(): void {
    console.group('🧪 Potion Scatter')
    console.log(this.config)
    console.log('Scattered points:', this.scatteredIds.length)
    console.groupEnd()
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
