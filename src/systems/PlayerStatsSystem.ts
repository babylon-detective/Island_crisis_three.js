import type { ItemEffect } from './ItemSystem'

/**
 * PlayerStatsSystem — single source of truth for player HP.
 *
 * Owned once by main.ts and shared (by reference) with BattleSystem and
 * InventoryDisplay so HP persists across map exploration, battles, and
 * repeated encounters instead of resetting each time a system is entered.
 */
export class PlayerStatsSystem {
  private hp: number
  private readonly maxHp: number
  private onChangeCallbacks: Array<() => void> = []

  constructor(maxHp: number = 30) {
    this.maxHp = maxHp
    this.hp = maxHp
  }

  getHP(): number {
    return this.hp
  }

  getMaxHP(): number {
    return this.maxHp
  }

  isDefeated(): boolean {
    return this.hp <= 0
  }

  /** Set HP directly, clamped to [0, maxHp]. */
  setHP(value: number): void {
    this.hp = Math.max(0, Math.min(this.maxHp, value))
    this.notifyChange()
  }

  /** Apply damage, clamped at 0. */
  damage(amount: number): number {
    this.setHP(this.hp - amount)
    return this.hp
  }

  /** Heal by a flat amount, clamped at maxHp. */
  heal(amount: number): number {
    this.setHP(this.hp + amount)
    return this.hp
  }

  /** Heal by a percentage (0-100) of max HP. */
  healPercent(percent: number): number {
    return this.heal(Math.round(this.maxHp * (percent / 100)))
  }

  /** Interpret item effects (e.g. from ItemSystem.useItem) and apply any HP effects. */
  applyEffects(effects: ItemEffect[]): void {
    for (const fx of effects) {
      if (fx.stat === 'hp') this.heal(fx.value)
      else if (fx.stat === 'hpPercent') this.healPercent(fx.value)
    }
  }

  onChange(cb: () => void): void {
    this.onChangeCallbacks.push(cb)
  }

  private notifyChange(): void {
    for (const cb of this.onChangeCallbacks) cb()
  }
}
