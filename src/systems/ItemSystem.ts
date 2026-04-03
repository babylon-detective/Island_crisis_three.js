/**
 * ItemSystem — core item data model and inventory management.
 *
 * Items are either **unique** (equipment, key items — quantity always 1)
 * or **fungible** (potions, materials — stackable by id).
 *
 * The single inventory array is shared across all game modes:
 *   Navigation → circular 3-D display (InventoryDisplay)
 *   Battle     → item sub-menu via BattleSystem
 *   Dialogue   → condition/reward hooks
 *   Menu       → management card
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ItemCategory = 'consumable' | 'equipment' | 'key' | 'material'
export type ItemShape = 'cube' | 'cone' | 'sphere' | 'cylinder' | 'octahedron' | 'torus' | 'tetrahedron' | 'dodecahedron'

export interface ItemEffect {
  stat: string          // e.g. 'hp', 'mp', 'attack', 'defense'
  value: number         // positive = buff / heal, negative = debuff
  duration?: number     // seconds; omit for instant
}

export interface ItemDefinition {
  id: string
  name: string
  category: ItemCategory
  description: string
  icon: string          // emoji or short token for the HUD
  shape: ItemShape      // 3-D primitive used in InventoryDisplay
  color: number         // hex colour for the primitive mesh
  stackable: boolean
  maxStack: number      // ignored when stackable === false
  effects: ItemEffect[]
  /** If true the item is removed from inventory after use. */
  consumeOnUse: boolean
  /** Optional: restrict to specific modes ('battle' | 'navigation' | 'any'). */
  usableIn: 'battle' | 'navigation' | 'any'
}

export interface InventorySlot {
  item: ItemDefinition
  quantity: number
}

// ─── Built-in item catalogue (extend as needed) ─────────────────────────────

const ITEM_CATALOGUE: Record<string, ItemDefinition> = {
  potion: {
    id: 'potion',
    name: 'Potion',
    category: 'consumable',
    description: 'Restores a small amount of HP.',
    icon: '🧪',
    shape: 'cylinder',
    color: 0x44bb66,
    stackable: true,
    maxStack: 99,
    effects: [{ stat: 'hp', value: 25 }],
    consumeOnUse: true,
    usableIn: 'any',
  },
  ether: {
    id: 'ether',
    name: 'Ether',
    category: 'consumable',
    description: 'Restores a small amount of MP.',
    icon: '💧',
    shape: 'sphere',
    color: 0x4488dd,
    stackable: true,
    maxStack: 99,
    effects: [{ stat: 'mp', value: 15 }],
    consumeOnUse: true,
    usableIn: 'any',
  },
  antidote: {
    id: 'antidote',
    name: 'Antidote',
    category: 'consumable',
    description: 'Cures poison.',
    icon: '💊',
    shape: 'dodecahedron',
    color: 0xaa44cc,
    stackable: true,
    maxStack: 99,
    effects: [],
    consumeOnUse: true,
    usableIn: 'any',
  },
  iron_sword: {
    id: 'iron_sword',
    name: 'Iron Sword',
    category: 'equipment',
    description: 'A sturdy iron blade.',
    icon: '⚔️',
    shape: 'cone',
    color: 0xaaaacc,
    stackable: false,
    maxStack: 1,
    effects: [{ stat: 'attack', value: 5, duration: undefined }],
    consumeOnUse: false,
    usableIn: 'navigation',
  },
  old_key: {
    id: 'old_key',
    name: 'Old Key',
    category: 'key',
    description: 'Opens a forgotten door.',
    icon: '🗝️',
    shape: 'torus',
    color: 0xddaa33,
    stackable: false,
    maxStack: 1,
    effects: [],
    consumeOnUse: false,
    usableIn: 'navigation',
  },
}

// ─── ItemSystem class ────────────────────────────────────────────────────────

export class ItemSystem {
  private inventory: InventorySlot[] = []
  private catalogue: Record<string, ItemDefinition> = { ...ITEM_CATALOGUE }
  private onChangeCallbacks: Array<() => void> = []

  // ── Catalogue management ──────────────────────────────────────────────────

  /** Register a custom item definition at runtime. */
  registerItem(def: ItemDefinition): void {
    this.catalogue[def.id] = def
  }

  /** Look up an item definition by id. */
  getDefinition(id: string): ItemDefinition | undefined {
    return this.catalogue[id]
  }

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
