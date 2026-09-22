/**
 * GameFlags — story/quest state used to gate spawn conditions.
 *
 * Deliberately tiny: boolean flags (`met_elder`), integer quest stages
 * (`forest_quest` → 2), and a player level counter. Persisted to
 * localStorage so world state (e.g. "already met the elder") survives reloads.
 */

const STORAGE_KEY = 'gameFlags_v1'

interface GameFlagsState {
  flags: string[]
  questStages: Record<string, number>
  playerLevel: number
}

export class GameFlags {
  private flags: Set<string> = new Set()
  private questStages: Map<string, number> = new Map()
  private playerLevel = 1

  constructor() {
    this.load()
  }

  // ── Flags ─────────────────────────────────────────────────────────────

  hasFlag(name: string): boolean {
    return this.flags.has(name)
  }

  setFlag(name: string, value: boolean = true): void {
    if (value) this.flags.add(name)
    else this.flags.delete(name)
    this.save()
  }

  // ── Quest stages ──────────────────────────────────────────────────────

  getQuestStage(questId: string): number {
    return this.questStages.get(questId) ?? 0
  }

  setQuestStage(questId: string, stage: number): void {
    this.questStages.set(questId, stage)
    this.save()
  }

  // ── Player level ──────────────────────────────────────────────────────

  getPlayerLevel(): number {
    return this.playerLevel
  }

  setPlayerLevel(level: number): void {
    this.playerLevel = Math.max(1, level)
    this.save()
  }

  // ── Reset / persistence ───────────────────────────────────────────────

  reset(): void {
    this.flags.clear()
    this.questStages.clear()
    this.playerLevel = 1
    this.save()
  }

  private save(): void {
    try {
      const state: GameFlagsState = {
        flags: [...this.flags],
        questStages: Object.fromEntries(this.questStages),
        playerLevel: this.playerLevel,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // storage unavailable — non-fatal
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const state: GameFlagsState = JSON.parse(raw)
      this.flags = new Set(state.flags ?? [])
      this.questStages = new Map(Object.entries(state.questStages ?? {}))
      this.playerLevel = state.playerLevel ?? 1
    } catch {
      // corrupt data — ignore, start fresh
    }
  }

  // ── Debug ─────────────────────────────────────────────────────────────

  printState(): void {
    console.group('🚩 GameFlags')
    console.log('Player level:', this.playerLevel)
    console.log('Flags:', [...this.flags])
    console.log('Quest stages:', Object.fromEntries(this.questStages))
    console.groupEnd()
  }
}
