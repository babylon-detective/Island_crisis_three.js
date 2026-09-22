/**
 * LootTable — reusable, weighted loot tables referenced by spawn points.
 *
 * A loot table is a separate asset from any given spawn point so the same
 * table (e.g. "forest_common") can be reused across many spawn points/levels.
 * Rolling uses the standard cumulative-weight + random-draw approach.
 */

import type { ItemSystem } from './ItemSystem'

export interface LootTableEntry {
  item_id: string
  weight: number
  min: number
  max: number
}

export interface LootTable {
  table_id: string
  entries: LootTableEntry[]
}

export interface RolledLoot {
  itemId: string
  quantity: number
}

export class LootTableRegistry {
  private tables: Record<string, LootTable> = {}

  register(table: LootTable): void {
    this.tables[table.table_id] = table
  }

  registerMany(tables: LootTable[]): void {
    for (const t of tables) this.register(t)
  }

  get(tableId: string): LootTable | undefined {
    return this.tables[tableId]
  }

  getAll(): LootTable[] {
    return Object.values(this.tables)
  }

  /** Weighted-random roll: cumulative weight + random draw over the entries. */
  roll(tableId: string, rng: () => number = Math.random): RolledLoot | null {
    const table = this.tables[tableId]
    if (!table || table.entries.length === 0) return null

    const totalWeight = table.entries.reduce((sum, e) => sum + e.weight, 0)
    if (totalWeight <= 0) return null

    let r = rng() * totalWeight
    for (const entry of table.entries) {
      if (r < entry.weight) {
        const span = Math.max(0, entry.max - entry.min)
        const quantity = entry.min + Math.floor(rng() * (span + 1))
        return { itemId: entry.item_id, quantity }
      }
      r -= entry.weight
    }

    // Floating point edge case — fall back to the last entry.
    const last = table.entries[table.entries.length - 1]
    return { itemId: last.item_id, quantity: last.min }
  }

  /** Offline lint: catch bad data before it ships (unknown items, zero weights, etc). */
  validate(itemSystem: ItemSystem): string[] {
    const issues: string[] = []
    for (const table of this.getAll()) {
      if (table.entries.length === 0) {
        issues.push(`Loot table "${table.table_id}" has no entries.`)
        continue
      }
      let totalWeight = 0
      for (const entry of table.entries) {
        if (!itemSystem.getDefinition(entry.item_id)) {
          issues.push(`Loot table "${table.table_id}" references unknown item_id "${entry.item_id}".`)
        }
        if (entry.weight <= 0) {
          issues.push(`Loot table "${table.table_id}" entry "${entry.item_id}" has non-positive weight (${entry.weight}).`)
        }
        if (entry.min < 1) {
          issues.push(`Loot table "${table.table_id}" entry "${entry.item_id}" has min < 1.`)
        }
        if (entry.max < entry.min) {
          issues.push(`Loot table "${table.table_id}" entry "${entry.item_id}" has max (${entry.max}) < min (${entry.min}).`)
        }
        totalWeight += entry.weight
      }
      if (totalWeight <= 0) {
        issues.push(`Loot table "${table.table_id}" has zero total weight.`)
      }
    }
    return issues
  }

  printAll(): void {
    console.group('🎲 Loot Tables')
    for (const table of this.getAll()) {
      const totalWeight = table.entries.reduce((s, e) => s + e.weight, 0)
      console.log(`${table.table_id}:`)
      for (const e of table.entries) {
        const pct = totalWeight > 0 ? ((e.weight / totalWeight) * 100).toFixed(1) : '0.0'
        console.log(`  ${e.item_id} — ${pct}% (weight ${e.weight}, qty ${e.min}-${e.max})`)
      }
    }
    console.groupEnd()
  }
}
