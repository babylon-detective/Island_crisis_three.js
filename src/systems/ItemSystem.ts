/**
 * ItemSystem — core item data model and inventory management.
 *
 * Items are composed from a shared `ItemBase` plus one optional category
 * component (`ConsumableData` | `EquipmentData` | `KeyItemData` |
 * `MaterialData` | `CurrencyData`). Components are stored in separate
 * dictionaries keyed by item id (dictionary-of-arrays / component pattern) so
 * new categories can be added without touching existing ones, and category
 * queries ("give me all Equipment") are cheap.
 *
 * `getDefinition()` / `getInventory()` return a flattened `ItemDefinition`
 * (ItemBase + the consumable-relevant fields) — the rest of the game
 * (BattleSystem, InventoryDisplay, PlayerStatsSystem) only ever needs this
 * merged view and doesn't care how the data is authored underneath.
 *
 * The single inventory array is shared across all game modes:
 *   Navigation → circular 3-D display (InventoryDisplay)
 *   Battle     → item sub-menu via BattleSystem
 *   Dialogue   → condition/reward hooks
 *   Menu       → management card
 *
 * Item *placement* (where things appear in the world) is intentionally NOT
 * part of this file — see SpawnSystem + LootTable for that layer. Never
 * hardcode an item id into a level/object; register a spawn point + loot
 * table instead. See docs/ITEM_SYSTEM.md.
 */

import * as THREE from 'three'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ItemCategory = 'consumable' | 'equipment' | 'key' | 'material' | 'currency'
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
export type ItemShape = 'cube' | 'cone' | 'sphere' | 'cylinder' | 'octahedron' | 'torus' | 'tetrahedron' | 'dodecahedron'

export interface ItemEffect {
  stat: string          // e.g. 'hp', 'mp', 'attack', 'defense'
  value: number         // positive = buff / heal, negative = debuff
  duration?: number     // seconds; omit for instant
}

/** Universal fields every item has, regardless of category. */
export interface ItemBase {
  id: string
  name: string
  category: ItemCategory
  description: string
  icon: string          // emoji or short token for the HUD
  shape: ItemShape      // 3-D primitive used in InventoryDisplay / world pickups
  color: number         // hex colour for the primitive mesh
  stackable: boolean
  maxStack: number      // ignored when stackable === false
  rarity: ItemRarity
  sellValue: number
}

// ─── Category components (composition over one flat struct) ────────────────

export interface ConsumableData {
  effectType: 'HealHP' | 'HealMP' | 'CureStatus' | 'Buff'
  effects: ItemEffect[]
  target: 'Self' | 'Party' | 'Enemy'
  /** If true the item is removed from inventory after use. */
  consumeOnUse: boolean
  /** Restrict to specific modes ('battle' | 'navigation' | 'any'). */
  usableIn: 'battle' | 'navigation' | 'any'
}

export interface EquipmentData {
  slot: 'Weapon' | 'Armor' | 'Accessory'
  statMods: Partial<Record<'attack' | 'defense' | 'speed' | 'magic', number>>
  elementAffinity?: string
}

export interface KeyItemData {
  questId?: string
  isDiscardable: boolean
}

export interface MaterialData {
  usedInRecipes: string[]
}

export interface CurrencyData {
  /** Value relative to the base currency unit (e.g. 1 gem = 100 gold). */
  exchangeRate: number
}

/**
 * Flattened, ready-to-use view merging ItemBase with the consumable
 * component (if any). This is the shape the rest of the game consumes.
 */
export interface ItemDefinition extends ItemBase {
  effects: ItemEffect[]
  consumeOnUse: boolean
  usableIn: 'battle' | 'navigation' | 'any'
}

export interface InventorySlot {
  item: ItemDefinition
  quantity: number
}

/** Authoring shape passed to `registerItem()` — base + optional category data. */
export interface ItemRegistration {
  base: ItemBase
  consumable?: ConsumableData
  equipment?: EquipmentData
  keyItem?: KeyItemData
  material?: MaterialData
  currency?: CurrencyData
}

// ─── Shared shape factory (used by InventoryDisplay and world pickups) ──────

export function createItemGeometry(shape: ItemShape): THREE.BufferGeometry {
  switch (shape) {
    case 'cube':         return new THREE.BoxGeometry(1, 1, 1)
    case 'cone':         return new THREE.ConeGeometry(0.5, 1.2, 8)
    case 'sphere':       return new THREE.SphereGeometry(0.5, 8, 6)
    case 'cylinder':     return new THREE.CylinderGeometry(0.35, 0.35, 1, 8)
    case 'octahedron':   return new THREE.OctahedronGeometry(0.55)
    case 'torus':        return new THREE.TorusGeometry(0.4, 0.15, 8, 16)
    case 'tetrahedron':  return new THREE.TetrahedronGeometry(0.6)
    case 'dodecahedron': return new THREE.DodecahedronGeometry(0.5)
    default:             return new THREE.BoxGeometry(1, 1, 1)
  }
}

// ─── Built-in item catalogue (extend as needed) ─────────────────────────────
// Never hardcode WHERE an item appears here — this is only the item's
// definition. Placement lives in SpawnSystem + LootTable data.

const DEFAULT_ITEM_CATALOGUE: ItemRegistration[] = [
  {
    base: {
      id: 'potion', name: 'Potion', category: 'consumable',
      description: 'Restores a portion of HP.', icon: '🧪',
      shape: 'cylinder', color: 0x44bb66, stackable: true, maxStack: 99,
      rarity: 'common', sellValue: 10,
    },
    consumable: { effectType: 'HealHP', effects: [{ stat: 'hpPercent', value: 25 }], target: 'Self', consumeOnUse: true, usableIn: 'any' },
  },
  {
    base: {
      id: 'potion_hp', name: 'HP Potion', category: 'consumable',
      description: 'A stronger brew that restores a large portion of HP.', icon: '🧪',
      shape: 'cylinder', color: 0x2ecc71, stackable: true, maxStack: 99,
      rarity: 'common', sellValue: 25,
    },
    consumable: { effectType: 'HealHP', effects: [{ stat: 'hpPercent', value: 40 }], target: 'Self', consumeOnUse: true, usableIn: 'any' },
  },
  {
    base: {
      id: 'ether', name: 'Ether', category: 'consumable',
      description: 'Restores a small amount of MP.', icon: '💧',
      shape: 'sphere', color: 0x4488dd, stackable: true, maxStack: 99,
      rarity: 'common', sellValue: 15,
    },
    consumable: { effectType: 'HealMP', effects: [{ stat: 'mp', value: 15 }], target: 'Self', consumeOnUse: true, usableIn: 'any' },
  },
  {
    base: {
      id: 'antidote', name: 'Antidote', category: 'consumable',
      description: 'Cures poison.', icon: '💊',
      shape: 'dodecahedron', color: 0xaa44cc, stackable: true, maxStack: 99,
      rarity: 'common', sellValue: 12,
    },
    consumable: { effectType: 'CureStatus', effects: [], target: 'Self', consumeOnUse: true, usableIn: 'any' },
  },
  {
    base: {
      id: 'phoenix_down', name: 'Phoenix Down', category: 'consumable',
      description: 'Fully restores HP. Rare and precious.', icon: '🪶',
      shape: 'octahedron', color: 0xffcc33, stackable: true, maxStack: 9,
      rarity: 'epic', sellValue: 250,
    },
    consumable: { effectType: 'HealHP', effects: [{ stat: 'hpPercent', value: 100 }], target: 'Self', consumeOnUse: true, usableIn: 'any' },
  },
  {
    base: {
      id: 'iron_sword', name: 'Iron Sword', category: 'equipment',
      description: 'A sturdy iron blade.', icon: '⚔️',
      shape: 'cone', color: 0xaaaacc, stackable: false, maxStack: 1,
      rarity: 'uncommon', sellValue: 80,
    },
    equipment: { slot: 'Weapon', statMods: { attack: 5 } },
  },
  {
    base: {
      id: 'old_key', name: 'Old Key', category: 'key',
      description: 'Opens a forgotten door.', icon: '🗝️',
      shape: 'torus', color: 0xddaa33, stackable: false, maxStack: 1,
      rarity: 'rare', sellValue: 0,
    },
    keyItem: { questId: 'old_key_door', isDiscardable: false },
  },
  {
    base: {
      id: 'wood_plank', name: 'Wood Plank', category: 'material',
      description: 'Sturdy timber used for crafting.', icon: '🪵',
      shape: 'cube', color: 0x8b5a2b, stackable: true, maxStack: 99,
      rarity: 'common', sellValue: 3,
    },
    material: { usedInRecipes: ['iron_sword_upgrade'] },
  },
  {
    base: {
      id: 'gold_coin', name: 'Gold Coin', category: 'currency',
      description: 'Standard currency.', icon: '🪙',
      shape: 'cylinder', color: 0xffd700, stackable: true, maxStack: 999999,
      rarity: 'common', sellValue: 1,
    },
    currency: { exchangeRate: 1 },
  },
]

// ─── ItemSystem class ────────────────────────────────────────────────────────

export class ItemSystem {
  private inventory: InventorySlot[] = []

  // Universal lookup (flattened view) + per-category component dictionaries.
  private catalogue: Record<string, ItemDefinition> = {}
  private consumableData: Record<string, ConsumableData> = {}
  private equipmentData: Record<string, EquipmentData> = {}
  private keyItemData: Record<string, KeyItemData> = {}
  private materialData: Record<string, MaterialData> = {}
  private currencyData: Record<string, CurrencyData> = {}

  private onChangeCallbacks: Array<() => void> = []

  constructor() {
    for (const reg of DEFAULT_ITEM_CATALOGUE) this.registerItem(reg)
  }

  // ── Catalogue management ──────────────────────────────────────────────────

  /** Register an item definition (base + optional category component) at runtime. */
  registerItem(reg: ItemRegistration): void {
    const { base } = reg
    this.catalogue[base.id] = {
      ...base,
      effects: reg.consumable?.effects ?? [],
      consumeOnUse: reg.consumable?.consumeOnUse ?? false,
      usableIn: reg.consumable?.usableIn ?? 'navigation',
    }
    if (reg.consumable) this.consumableData[base.id] = reg.consumable
    if (reg.equipment) this.equipmentData[base.id] = reg.equipment
    if (reg.keyItem) this.keyItemData[base.id] = reg.keyItem
    if (reg.material) this.materialData[base.id] = reg.material
    if (reg.currency) this.currencyData[base.id] = reg.currency
  }

  /** Look up the flattened item definition by id. */
  getDefinition(id: string): ItemDefinition | undefined {
    return this.catalogue[id]
  }

  /** All items belonging to a given category (cheap component-pattern query). */
  getItemsByCategory(category: ItemCategory): ItemDefinition[] {
    return Object.values(this.catalogue).filter(d => d.category === category)
  }

  getConsumableData(id: string): ConsumableData | undefined { return this.consumableData[id] }
  getEquipmentData(id: string): EquipmentData | undefined { return this.equipmentData[id] }
  getKeyItemData(id: string): KeyItemData | undefined { return this.keyItemData[id] }
  getMaterialData(id: string): MaterialData | undefined { return this.materialData[id] }
  getCurrencyData(id: string): CurrencyData | undefined { return this.currencyData[id] }

  // ── Inventory queries ─────────────────────────────────────────────────────

  /** Returns a shallow copy of the inventory. */
  getInventory(): InventorySlot[] {
    return [...this.inventory]
  }

  /** Total number of distinct item stacks. */
  getSlotCount(): number {
    return this.inventory.length
  }

  /** Find a slot by item id, or undefined. */
  findSlot(itemId: string): InventorySlot | undefined {
    return this.inventory.find(s => s.item.id === itemId)
  }

  /** Check if the inventory contains at least `qty` of `itemId`. */
  hasItem(itemId: string, qty: number = 1): boolean {
    const slot = this.findSlot(itemId)
    return slot !== undefined && slot.quantity >= qty
  }

  // ── Inventory mutations ───────────────────────────────────────────────────

  /** Add qty of an item (by catalogue id). Returns true on success. */
  addItem(itemId: string, qty: number = 1): boolean {
    const def = this.catalogue[itemId]
    if (!def) {
      console.warn(`[ItemSystem] Unknown item id: ${itemId}`)
      return false
    }

    const existing = this.findSlot(itemId)
    if (existing && def.stackable) {
      existing.quantity = Math.min(existing.quantity + qty, def.maxStack)
    } else if (!existing) {
      this.inventory.push({ item: def, quantity: def.stackable ? qty : 1 })
    } else {
      // non-stackable item already owned
      return false
    }
    this.notifyChange()
    return true
  }

  /** Remove qty of an item. Returns true if the item was removed. */
  removeItem(itemId: string, qty: number = 1): boolean {
    const idx = this.inventory.findIndex(s => s.item.id === itemId)
    if (idx === -1) return false

    const slot = this.inventory[idx]
    slot.quantity -= qty
    if (slot.quantity <= 0) {
      this.inventory.splice(idx, 1)
    }
    this.notifyChange()
    return true
  }

  /**
   * Use an item. Returns the item's effects array (caller applies them),
   * or null if the item can't be used in the given mode.
   */
  useItem(itemId: string, mode: 'battle' | 'navigation'): ItemEffect[] | null {
    const slot = this.findSlot(itemId)
    if (!slot) return null
    const def = slot.item
    if (def.usableIn !== 'any' && def.usableIn !== mode) return null

    if (def.consumeOnUse) {
      this.removeItem(itemId, 1)
    }
    return [...def.effects]
  }

  /** Move a slot from one index to another (for manual arrangement). */
  moveSlot(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.inventory.length) return
    if (toIndex < 0 || toIndex >= this.inventory.length) return
    const [slot] = this.inventory.splice(fromIndex, 1)
    this.inventory.splice(toIndex, 0, slot)
    this.notifyChange()
  }

  // ── Change notification ───────────────────────────────────────────────────

  /** Register a callback that fires whenever the inventory changes. */
  onChange(cb: () => void): void {
    this.onChangeCallbacks.push(cb)
  }

  private notifyChange(): void {
    for (const cb of this.onChangeCallbacks) cb()
  }

  // ── Debug helpers ─────────────────────────────────────────────────────────

  /** Pretty-print the inventory to the console. */
  printInventory(): void {
    console.log('🎒 Inventory:')
    if (this.inventory.length === 0) {
      console.log('  (empty)')
      return
    }
    for (const slot of this.inventory) {
      const qty = slot.item.stackable ? ` x${slot.quantity}` : ''
      console.log(`  ${slot.item.icon} ${slot.item.name}${qty} — ${slot.item.description}`)
    }
  }
}
