/**
 * BattleActionConfig — shared definition + display order for the battle
 * action bar (ATK/GRD/TLK/ITM/ESC). The order is persisted so it can be
 * rearranged from the Stats Menu and read back by BattleSystem.
 */

export type BattleActionId = 'attack' | 'guard' | 'talk' | 'item' | 'escape'

export interface BattleActionDef {
  id: BattleActionId
  /** Shown on the square icon button. */
  acronym: string
  /** Glyph shown above the acronym. */
  icon: string
  /** Full word, used in the Stats Menu list. */
  fullLabel: string
}

export const BATTLE_ACTION_DEFS: Record<BattleActionId, BattleActionDef> = {
  attack: { id: 'attack', acronym: 'ATK', icon: '⚔', fullLabel: 'Attack' },
  guard: { id: 'guard', acronym: 'GRD', icon: '🛡', fullLabel: 'Guard' },
  talk: { id: 'talk', acronym: 'TLK', icon: '💬', fullLabel: 'Talk' },
  item: { id: 'item', acronym: 'ITM', icon: '🎒', fullLabel: 'Items' },
  escape: { id: 'escape', acronym: 'ESC', icon: '🏃', fullLabel: 'Escape' },
}

const DEFAULT_ORDER: BattleActionId[] = ['attack', 'guard', 'talk', 'item', 'escape']
const STORAGE_KEY = 'battleActionOrder_v1'

/** Current left-to-right order of the battle action bar (persisted). */
export function getBattleActionOrder(): BattleActionId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULT_ORDER]
    const parsed = JSON.parse(raw) as string[]
    const valid = parsed.filter((id): id is BattleActionId => id in BATTLE_ACTION_DEFS)
    // Backfill any actions missing from stored/corrupt data (e.g. newly added ids).
    const missing = DEFAULT_ORDER.filter(id => !valid.includes(id))
    return [...valid, ...missing]
  } catch {
    return [...DEFAULT_ORDER]
  }
}

export function setBattleActionOrder(order: BattleActionId[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch {
    // storage unavailable — non-fatal
  }
}

/** Swap an action with its neighbor. dir -1 moves it earlier (left), +1 later (right). */
export function moveBattleAction(id: BattleActionId, dir: -1 | 1): BattleActionId[] {
  const order = getBattleActionOrder()
  const idx = order.indexOf(id)
  const swapIdx = idx + dir
  if (idx === -1 || swapIdx < 0 || swapIdx >= order.length) return order
  ;[order[idx], order[swapIdx]] = [order[swapIdx], order[idx]]
  setBattleActionOrder(order)
  return order
}

export function resetBattleActionOrder(): BattleActionId[] {
  setBattleActionOrder([...DEFAULT_ORDER])
  return [...DEFAULT_ORDER]
}
