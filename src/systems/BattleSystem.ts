import * as THREE from 'three'
import { NPCSystem, NPCInstance } from './NPCSystem'
import { NPCAISystem } from './NPCAISystem'
import { CharacterAnimationSystem } from './CharacterAnimationSystem'
import { CameraManager } from './CameraManager'
import type { BattleCameraShot } from './BattleCameraController'
import { BattleAnimSync, type SyncedBattleSequence } from './BattleAnimSync'
import type { PlayerController } from './PlayerController'
import type { DialogueManager } from './DialogueSystem'
import { logger, LogModule } from './Logger'
import { traceInputCommand, type InputTraceSource } from './InputTrace'
import type { SoundSystem } from './SoundSystem'
import type { ItemSystem } from './ItemSystem'
import type { InventoryDisplay } from './InventoryDisplay'
import type { PlayerStatsSystem } from './PlayerStatsSystem'

type ActiveInputMode = 'touch' | 'gamepad' | 'keyboard' | 'mouse'

type BattlePhase = 'player-turn' | 'ended'
type BattleActionId = 'attack' | 'guard' | 'escape' | 'item'

interface BattleMenuAction {
  id: BattleActionId
  label: string
}

export class BattleSystem {
  private npcSystem: NPCSystem
  private aiSystem: NPCAISystem
  private charAnimSystem: CharacterAnimationSystem
  private scene: THREE.Scene | null = null
  private cameraManager: CameraManager | null = null
  private playerController: PlayerController | null = null
  private dialogueManager: DialogueManager | null = null
  private soundSystem: SoundSystem | null = null
  private itemSystem: ItemSystem | null = null
  private inventoryDisplay: InventoryDisplay | null = null
  private animSync: BattleAnimSync | null = null

  private isActive = false
  private activeNpcId: string | null = null
  private nearestBattleNpc: string | null = null
  private phase: BattlePhase = 'player-turn'
  private highlightedActionIndex = 0
  private promptVisible = false
  private guardActive = false
  private playerStats: PlayerStatsSystem | null = null
  /** Fallback HP store used only if no PlayerStatsSystem has been attached. */
  private localPlayerHP = 30
  private readonly localMaxPlayerHP = 30
  private enemyHP = 18
  private readonly maxEnemyHP = 18
  private statusText = 'Choose an action.'

  // ── Cluster (multi-NPC) support ──
  private clusterNpcIds: string[] = []
  private selectedClusterIndex = 0
  private clusterPositions: Map<string, THREE.Vector3> = new Map()
  private clusterOriginalPositions: Map<string, THREE.Vector3> = new Map()
  private clusterHPs: Map<string, number> = new Map()
  /** Horizontal spacing between cluster NPCs in battle staging (world units). */
  private readonly clusterSpacing = 2.5

  private readonly interactionRange = 3.5
  private readonly hostileAutoTriggerRange = 1.85
  private readonly recentBattleCooldownMs = 3000
  private readonly postDialogueAutoTriggerGraceMs = 3000
  private hostileAutoTriggerSuppressedUntil = 0

  /** Standard distance between combatants in battle (world units). */
  private readonly battleStandingDistance = 8
  /** Strike range — how close the player teleports to the enemy for an attack. */
  private readonly strikeRange = 0.8

  /** The player's fixed battle position (set during staging). */
  private battlePlayerPos: THREE.Vector3 | null = null
  /** The enemy's fixed battle position (set during staging). */
  private battleEnemyPos: THREE.Vector3 | null = null

  /** True while an attack camera sequence is playing (blocks input). */
  private attackSequencePlaying = false
  private stagedPlayerStartPosition: THREE.Vector3 | null = null
  /** Counts rapid taps during a blocked sequence — skip after threshold. */
  private skipTapCount = 0
  private readonly skipTapThreshold = 3

  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null
  private onPauseRequest: (() => void) | null = null

  private overlayRoot: HTMLDivElement | null = null
  private overlayTopBox: HTMLDivElement | null = null
  private overlayPrompt: HTMLDivElement | null = null
  private overlayPanel: HTMLDivElement | null = null
  private overlayTitle: HTMLDivElement | null = null
  private overlayHP: HTMLDivElement | null = null
  private overlayHPText: HTMLDivElement | null = null
  private overlayPlayerHPBarFill: HTMLDivElement | null = null
  private overlayStatus: HTMLDivElement | null = null
  private overlayChoices: HTMLDivElement | null = null
  private inputMode: ActiveInputMode = 'keyboard'
  private pendingScriptedBattleNpcId: string | null = null

  /** Tuned live in the Battle tab of the debug GUI. */
  public victoryParams = {
    titleDuration: 3,
    fadeDuration: 0.65,
    expPerEnemy: 25,
    expForNextLevel: 100,
  }
  private experience = 0
  private playerLevel = 1
  private victoryActive = false
  private victoryOverlay: HTMLDivElement | null = null
  private victorySavedVisibility: Map<string, boolean> = new Map()
  private victorySavedBackground: THREE.Color | THREE.Texture | null = null
  private victoryAmbient: THREE.AmbientLight | null = null
  private victoryTimer: number | null = null
  private setOceanVisible: ((visible: boolean) => void) | null = null

  /** Visually eased player HP value shown in the battle overlay bar/text. */
  private displayedPlayerHP = this.maxPlayerHP
  private hpAnimHandle: number | null = null

  /** Game Over presentation: death anim → slow camera spin → white fade → GAME OVER → restart. */
  private gameOverActive = false
  private gameOverOverlay: HTMLDivElement | null = null
  private gameOverSpinHandle: number | null = null

  /** Enemy HP/stats stay hidden until a special condition is met (currently: using Guard once). */
  private enemyStatsRevealed = false

  /** Delegates to the shared PlayerStatsSystem when attached, so HP persists across battles/exploration. */
  private get playerHP(): number {
    return this.playerStats ? this.playerStats.getHP() : this.localPlayerHP
  }
  private set playerHP(value: number) {
    if (this.playerStats) this.playerStats.setHP(value)
    else this.localPlayerHP = value
  }
  private get maxPlayerHP(): number {
    return this.playerStats ? this.playerStats.getMaxHP() : this.localMaxPlayerHP
  }

  private readonly menuActions: BattleMenuAction[] = [
    { id: 'attack', label: 'Attack' },
    { id: 'guard', label: 'Guard' },
    { id: 'escape', label: 'Escape' },
    { id: 'item', label: 'Items' },
  ]

  constructor(
    npcSystem: NPCSystem,
    aiSystem: NPCAISystem,
    charAnimSystem: CharacterAnimationSystem,
  ) {
    this.npcSystem = npcSystem
    this.aiSystem = aiSystem
    this.charAnimSystem = charAnimSystem
    this.buildOverlayUI()
  }

  setScene(scene: THREE.Scene): void {
    this.scene = scene
  }

  setPlayerStats(stats: PlayerStatsSystem): void {
    this.playerStats = stats
  }

  setOceanVisibility(setVisible: (visible: boolean) => void): void {
    this.setOceanVisible = setVisible
  }

  setCameraManager(cam: CameraManager): void {
    this.cameraManager = cam
  }

  setPlayerController(playerController: PlayerController): void {
    this.playerController = playerController
  }

  setDialogueManager(dialogueManager: DialogueManager): void {
    this.dialogueManager = dialogueManager
  }

  setSoundSystem(soundSystem: SoundSystem): void {
    this.soundSystem = soundSystem
  }

  setItemSystem(itemSystem: ItemSystem): void {
    this.itemSystem = itemSystem
  }

  setInventoryDisplay(inventoryDisplay: InventoryDisplay): void {
    this.inventoryDisplay = inventoryDisplay
  }

  setAnimSync(sync: BattleAnimSync): void {
    this.animSync = sync
  }

  setPauseCallback(fn: () => void): void {
    this.onPauseRequest = fn
  }

  suppressHostileAutoTrigger(durationMs: number = this.postDialogueAutoTriggerGraceMs): void {
    this.hostileAutoTriggerSuppressedUntil = Math.max(
      this.hostileAutoTriggerSuppressedUntil,
      performance.now() + durationMs,
    )
  }

  setInputMode(mode: ActiveInputMode): void {
    this.inputMode = mode
    this.applyOverlayLayout()
    if (this.promptVisible && this.nearestBattleNpc) {
      this.showPromptOverlay(this.getEngagePromptText(this.nearestBattleNpc))
    }
    if (this.isActive) {
      this.renderBattleOverlay()
    }
  }

  enable(): void {
    if (this.boundKeyDown) return
    this.boundKeyDown = (e: KeyboardEvent) => this.handleKey(e)
    document.addEventListener('keydown', this.boundKeyDown)
  }

  disable(): void {
    if (this.boundKeyDown) {
      document.removeEventListener('keydown', this.boundKeyDown)
      this.boundKeyDown = null
    }
    this.leaveBattle(false)
    this.hidePromptOverlay()
  }

  update(playerPosition: THREE.Vector3): void {
    this.reconcileInputLock()

    if (this.dialogueManager?.isDialogueActive()) {
      this.clearPromptState()
      return
    }
    // Don't start new battles while camera is fading between modes
    if (this.cameraManager?.isFading()) return

    if (this.isActive) {
      this.syncBattleFacing()
      return
    }

    const nearbyNPCs = this.npcSystem.getNPCsInRadius(playerPosition, this.interactionRange)
      .filter(npc => !this.npcSystem.isInteractionOnCooldown(npc.id))
      .filter(npc => this.aiSystem.getBehaviour(npc.id) !== 'flee')

    let closest: NPCInstance | null = null
    let closestDist = Infinity
    for (const npc of nearbyNPCs) {
      const dist = npc.position.distanceTo(playerPosition)
      if (dist < closestDist) {
        closest = npc
        closestDist = dist
      }
    }

    this.nearestBattleNpc = closest?.id ?? null
    if (closest) {
      const promptText = this.getEngagePromptText(closest.id)
      if (!this.promptVisible || this.overlayPrompt?.textContent !== promptText) {
        this.showPromptOverlay(promptText)
      }
    } else {
      this.clearPromptState()
    }

    const hostileAutoTriggerSuppressed = performance.now() < this.hostileAutoTriggerSuppressedUntil
    const hostileRed = hostileAutoTriggerSuppressed
      ? undefined
      : this.npcSystem.getNPCsInRadius(playerPosition, this.hostileAutoTriggerRange)
      .filter(npc => npc.npcClass === 'red')
      .filter(npc => this.npcSystem.isHostile(npc.id))
      .filter(npc => !this.npcSystem.isInteractionOnCooldown(npc.id))
      .find(npc => this.aiSystem.getBehaviour(npc.id) !== 'flee')

    if (hostileRed) {
      this.startBattle(hostileRed.id, 'enemy')
    }
  }

  isBattleActive(): boolean {
    return this.isActive
  }

  getActiveNpcId(): string | null {
    return this.activeNpcId
  }

  public getPlayerHP(): number { return this.playerHP }
  public getMaxPlayerHP(): number { return this.maxPlayerHP }
  public getPlayerLevel(): number { return this.playerLevel }
  public getExperience(): number { return this.experience }
  public getExpForNextLevel(): number { return this.victoryParams.expForNextLevel }

  public isEnemyStatsRevealed(): boolean { return this.enemyStatsRevealed }
  public setEnemyStatsRevealed(revealed: boolean): void {
    this.enemyStatsRevealed = revealed
    if (this.isActive) this.renderBattleOverlay()
  }

  handleAttackButton(source: InputTraceSource = 'system'): boolean {
    if (this.isActive) {
      traceInputCommand({ source, target: 'battle', command: 'engage', result: 'ignored', details: { reason: 'battle-already-active' } })
      return false
    }
    if (this.dialogueManager?.isDialogueActive()) {
      traceInputCommand({ source, target: 'battle', command: 'engage', result: 'blocked', details: { reason: 'dialogue-active' } })
      return false
    }
    if (this.cameraManager?.isFading()) {
      traceInputCommand({ source, target: 'battle', command: 'engage', result: 'blocked', details: { reason: 'camera-fading' } })
      return false
    }
    if (this.cameraManager?.isInDialogueMode()) {
      traceInputCommand({ source, target: 'battle', command: 'engage', result: 'blocked', details: { reason: 'camera-dialogue-mode' } })
      return false
    }
    if (this.cameraManager?.isInBattleMode()) {
      traceInputCommand({ source, target: 'battle', command: 'engage', result: 'blocked', details: { reason: 'camera-battle-mode' } })
      return false
    }

    const candidate = this.npcSystem.getNPCsInRadius(
      this.playerController?.getPosition() ?? new THREE.Vector3(),
      this.interactionRange,
    )
      .filter(npc => !this.npcSystem.isInteractionOnCooldown(npc.id))
      .filter(npc => this.aiSystem.getBehaviour(npc.id) !== 'flee')
      .sort((a, b) => {
        const playerPos = this.playerController?.getPosition() ?? new THREE.Vector3()
        return a.position.distanceToSquared(playerPos) - b.position.distanceToSquared(playerPos)
      })[0]

    if (!candidate) {
      traceInputCommand({ source, target: 'battle', command: 'engage', result: 'ignored', details: { reason: 'no-nearby-battle-npc' } })
      return false
    }
    traceInputCommand({ source, target: 'battle', command: 'engage', result: 'consumed', details: { npcId: candidate.id } })
    return this.startBattle(candidate.id, 'player')
  }

  startScriptedBattle(npcId: string): boolean {
    if (this.dialogueManager?.isDialogueActive() || this.cameraManager?.isInDialogueMode() || this.cameraManager?.isFading()) {
      this.pendingScriptedBattleNpcId = npcId
      return true
    }
    return this.startBattle(npcId, 'player')
  }

  consumePendingScriptedBattle(npcId: string): boolean {
    if (this.pendingScriptedBattleNpcId !== npcId) return false
    this.pendingScriptedBattleNpcId = null
    return this.startBattle(npcId, 'player')
  }

  handleConfirmActionButton(source: InputTraceSource = 'system'): boolean {
    if (this.gameOverActive) {
      this.restartGame()
      return true
    }
    if (!this.isActive) {
      traceInputCommand({ source, target: 'battle', command: 'confirm', result: 'ignored' })
      return false
    }
    if (this.inventoryDisplay?.isInventoryActive()) {
      // Item browser owns confirm while open — don't fall through to the battle menu's highlighted action.
      const consumed = this.inventoryDisplay.handleConfirmInput()
      traceInputCommand({ source, target: 'battle', command: 'confirm', result: consumed ? 'consumed' : 'ignored', details: { reason: 'inventory-active' } })
      return consumed
    }
    if (this.phase === 'ended') {
      traceInputCommand({ source, target: 'battle', command: 'confirm', result: 'executed', details: { phase: this.phase } })
      this.leaveBattle(true)
      return true
    }

    const action = this.menuActions[this.highlightedActionIndex]
    if (!action) return true

    return this.executeBattleCommand(action.id, source)
  }

  public handleConfirmInput(source: InputTraceSource = 'system'): boolean {
    return this.handleConfirmActionButton(source)
  }

  public handleCancelInput(source: InputTraceSource = 'system'): boolean {
    return this.handleEscapeInput(source)
  }

  public handleNavigateInput(dir: number, source: InputTraceSource = 'system'): boolean {
    const blocked = this.isCommandInputBlocked()
    if (!this.isActive || this.phase !== 'player-turn' || blocked) {
      traceInputCommand({
        source,
        target: 'battle',
        command: dir < 0 ? 'navigate-up' : 'navigate-down',
        result: blocked ? 'blocked' : 'ignored',
        details: { isActive: this.isActive, phase: this.phase, attackSequencePlaying: this.attackSequencePlaying, battleCameraBusy: this.isBattleCameraBusy() }
      })
      return false
    }
    this.cycleChoice(dir)
    traceInputCommand({
      source,
      target: 'battle',
      command: dir < 0 ? 'navigate-up' : 'navigate-down',
      result: 'consumed',
      details: { highlightedActionIndex: this.highlightedActionIndex, actionId: this.menuActions[this.highlightedActionIndex]?.id ?? null }
    })
    return true
  }

  public handleDirectActionInput(actionId: BattleActionId, source: InputTraceSource = 'system'): boolean {
    if (!this.isActive) {
      const consumed = actionId === 'attack' ? this.handleAttackButton(source) : false
      if (!consumed && actionId !== 'attack') {
        traceInputCommand({ source, target: 'battle', command: actionId, result: 'ignored', details: { reason: 'battle-inactive' } })
      }
      return consumed
    }
    return this.executeBattleCommand(actionId, source)
  }

  handleMenuAction(actionId: BattleActionId, source: InputTraceSource = 'system'): boolean {
    return this.executeBattleCommand(actionId, source)
  }

  private executeBattleCommand(actionId: BattleActionId, source: InputTraceSource = 'system'): boolean {
    if (!this.isActive) {
      traceInputCommand({ source, target: 'battle', command: actionId, result: 'ignored' })
      return false
    }
    if (this.phase === 'ended') {
      traceInputCommand({ source, target: 'battle', command: actionId, result: 'executed', details: { phase: this.phase } })
      this.leaveBattle(true)
      return true
    }

    if (actionId !== 'escape' && this.isCommandInputBlocked()) {
      // Count rapid taps — skip the animation sequence after threshold
      this.skipTapCount++
      if (this.skipTapCount >= this.skipTapThreshold) {
        this.skipBattleSequence()
        traceInputCommand({
          source,
          target: 'battle',
          command: actionId,
          result: 'executed',
          details: { skipped: true, taps: this.skipTapCount }
        })
        this.skipTapCount = 0
        return true
      }
      traceInputCommand({
        source,
        target: 'battle',
        command: actionId,
        result: 'blocked',
        details: { attackSequencePlaying: this.attackSequencePlaying, battleCameraBusy: this.isBattleCameraBusy(), phase: this.phase, skipTapCount: this.skipTapCount }
      })
      return true
    }

    traceInputCommand({
      source,
      target: 'battle',
      command: actionId,
      result: 'executed',
      details: { phase: this.phase, activeNpcId: this.activeNpcId }
    })

    switch (actionId) {
      case 'attack':
        this.performAttackTurn()
        return true
      case 'guard':
        this.performGuardTurn()
        return true
      case 'escape':
        this.handleEscapeInput(source)
        return true
      case 'item':
        this.performItemAction()
        return true
    }

    return false
  }

  handleEscapeInput(source: InputTraceSource = 'system'): boolean {
    if (!this.isActive) {
      traceInputCommand({ source, target: 'battle', command: 'escape', result: 'ignored' })
      return false
    }
    traceInputCommand({ source, target: 'battle', command: 'escape', result: 'executed', details: { phase: this.phase } })
    this.statusText = 'You escaped the battle.'
    this.renderBattleOverlay()
    this.leaveBattle(true)
    return true
  }

  private startBattle(npcId: string, trigger: 'player' | 'enemy'): boolean {
    if (this.isActive || this.dialogueManager?.isDialogueActive()) return false

    const npc = this.npcSystem.getNPC(npcId)
    if (!npc || !this.playerController) return false

    // ── Form cluster: nearby same-class NPCs join, others flee ──
    this.clusterNpcIds = this.aiSystem.formCluster(npcId, 'battle')
    this.selectedClusterIndex = 0
    this.clusterPositions.clear()
    this.clusterOriginalPositions.clear()
    this.clusterHPs.clear()
    for (const id of this.clusterNpcIds) {
      const n = this.npcSystem.getNPC(id)
      if (n) this.clusterOriginalPositions.set(id, n.position.clone())
      this.clusterHPs.set(id, this.maxEnemyHP)
    }

    this.isActive = true
    this.activeNpcId = npcId
    this.phase = 'player-turn'
    this.highlightedActionIndex = 0
    this.enemyHP = this.clusterHPs.get(npcId) ?? this.maxEnemyHP
    this.guardActive = false
    if (this.hpAnimHandle !== null) { cancelAnimationFrame(this.hpAnimHandle); this.hpAnimHandle = null }
    this.displayedPlayerHP = this.playerHP
    this.enemyStatsRevealed = false
    this.statusText = trigger === 'enemy'
      ? `${npc.id} closes in and forces a battle.`
      : `You challenge ${npc.id}.`

    this.dialogueManager?.hideInteractionPrompt()
    this.clearPromptState()
    this.stageClusterBattlePositions()
    this.syncBattleFacing()

    if (this.cameraManager && this.battlePlayerPos && this.battleEnemyPos) {
      console.log(`⚔️ Battle start: npc=${npcId}, trigger=${trigger}, cluster=${this.clusterNpcIds.length}, cameraModeBefore=${this.cameraManager.getCurrentMode()}`)
      this.cameraManager.enterBattleMode(this.battlePlayerPos, this.battleEnemyPos)
    }

    this.renderBattleOverlay()
    logger.info(LogModule.SYSTEM, `Battle started with NPC "${npcId}" (${trigger}), cluster size ${this.clusterNpcIds.length}`)
    this.soundSystem?.pauseAreaMusic(1)
    this.soundSystem?.startBattleTheme_01()
    return true
  }

  /**
   * Player attack turn — deterministic two-shot sequence:
   * 1. strikeImpact — player teleports next to the enemy, attack anim plays, damage applied on completion.
   * 2. attackerFocus — player returns to original position; idle camera resumes; enemy turn follows.
   */
  private performAttackTurn(): void {
    const npc = this.npcSystem.getNPC(this.activeNpcId ?? '')
    if (!npc) {
      this.leaveBattle(true)
      return
    }
    if (
      !this.cameraManager ||
      !this.battlePlayerPos ||
      !this.battleEnemyPos ||
      !this.playerController ||
      !this.cameraManager.isInBattleMode()
    ) {
      // Fallback: no camera choreography
      this.performAttackDamage(npc)
      if (this.phase !== 'ended') {
        this.resolveEnemyTurn(`You hit ${npc.id} for ${this.lastDamageDealt}.`)
      }
      return
    }

    this.attackSequencePlaying = true
    this.skipTapCount = 0

    // Strike position: strikeRange units from the enemy, along the player→enemy axis
    const fwd = this.battleEnemyPos.clone().sub(this.battlePlayerPos)
    fwd.y = 0
    fwd.normalize()
    const strikePos = this.battleEnemyPos.clone().addScaledVector(fwd, -this.strikeRange)
    strikePos.y = this.battlePlayerPos.y
    const originalPlayerPos = this.battlePlayerPos.clone()

    const sequence: BattleCameraShot[] = [
      {
        type: 'strikeImpact',
        duration: 0.55,
        onStart: () => {
          this.playerController!.setPosition(strikePos)
          this.cameraManager!.updateBattlePositions(strikePos, this.battleEnemyPos!)
          try { this.charAnimSystem.crossfadeTo('player', 'attack', 0.08) } catch (_) {}
        },
        onComplete: () => {
          this.performAttackDamage(npc)
          if (this.npcSystem.isDefeated(npc.id)) {
            try { this.charAnimSystem.crossfadeTo(npc.id, 'death', 0.15) } catch (_) {}
          } else {
            try { this.charAnimSystem.crossfadeTo(npc.id, 'idle', 0.1) } catch (_) {}
          }
        },
      },
      {
        type: 'attackerFocus',
        duration: 0.35,
        onStart: () => {
          this.playerController!.setPosition(originalPlayerPos)
          this.cameraManager!.updateBattlePositions(originalPlayerPos, this.battleEnemyPos!)
          try { this.charAnimSystem.crossfadeTo('player', 'idle', 0.15) } catch (_) {}
        },
        onComplete: () => {
          this.attackSequencePlaying = false
          if (this.phase === 'ended') return
          this.resolveEnemyTurn(`You hit ${npc.id} for ${this.lastDamageDealt}.`)
        },
      },
    ]

    this.cameraManager.battlePlaySequence(sequence)
  }

  private isBattleCameraBusy(): boolean {
    if (this.animSync?.busy) return true
    return this.cameraManager?.getBattleCameraController().busy ?? false
  }

  /** Battle input only unblocks on the player's turn — always show attackerFocus at that moment. */
  private forceAttackerFocusIfWaitingForInput(): void {
    if (this.phase !== 'player-turn' || !this.cameraManager?.isInBattleMode()) return
    this.cameraManager.getBattleCameraController().cutTo('attackerFocus')
  }

  private isOpeningCinematicPlaying(): boolean {
    return this.cameraManager?.getBattleCameraController().openingPlaying ?? false
  }

  private isCommandInputBlocked(): boolean {
    if (this.isOpeningCinematicPlaying()) return true
    return this.attackSequencePlaying && this.isBattleCameraBusy()
  }

  /** Skip all pending battle camera sequences, firing callbacks instantly. */
  private skipBattleSequence(): void {
    // Skip animation-synced sequences first
    this.animSync?.skip()
    // Skip opening cinematic / legacy queue
    const ctrl = this.cameraManager?.getBattleCameraController()
    if (ctrl) {
      ctrl.skipSequence()
    }
    this.attackSequencePlaying = false
  }

  private reconcileInputLock(): void {
    if (this.attackSequencePlaying && !this.isBattleCameraBusy()) {
      traceInputCommand({
        source: 'system',
        target: 'battle',
        command: 'reconcile-input-lock',
        result: 'executed',
        details: { staleAttackSequencePlaying: true }
      })
      this.attackSequencePlaying = false
    }
  }

  /** Damage-only portion of the attack turn (no camera). */
  private lastDamageDealt = 0
  private performAttackDamage(npc: NPCInstance): void {
    const damage = 5 + Math.floor(Math.random() * 5)
    this.lastDamageDealt = damage
    const hp = Math.max(0, (this.clusterHPs.get(npc.id) ?? this.enemyHP) - damage)
    this.clusterHPs.set(npc.id, hp)
    this.enemyHP = hp

    if (this.enemyHP <= 0) {
      this.npcSystem.defeatNPC(npc.id)
      this.aiSystem.disengageFromPlayer(npc.id)

      // Remove defeated NPC from cluster
      const idx = this.clusterNpcIds.indexOf(npc.id)
      if (idx !== -1) this.clusterNpcIds.splice(idx, 1)
      this.clusterHPs.delete(npc.id)

      if (this.clusterNpcIds.length === 0) {
        // The last defeated target triggers the victory presentation.
        this.phase = 'ended'
        this.statusText = `You hit ${npc.id} for ${damage}. All enemies defeated!`
        this.renderBattleOverlay()
        this.startVictoryEvent()
        return
      }

      // Auto-select next NPC in the cluster
      this.selectedClusterIndex = Math.min(this.selectedClusterIndex, this.clusterNpcIds.length - 1)
      this.activeNpcId = this.clusterNpcIds[this.selectedClusterIndex]
      this.enemyHP = this.clusterHPs.get(this.activeNpcId!) ?? this.maxEnemyHP
      this.updateBattleTarget()
      this.statusText = `You hit ${npc.id} for ${damage}. ${npc.id} is defeated. Targeting ${this.activeNpcId}.`
      this.renderBattleOverlay()
      return
    }

    this.statusText = `You hit ${npc.id} for ${damage}.`
    this.renderBattleOverlay()
  }

  private performGuardTurn(): void {
    const npc = this.npcSystem.getNPC(this.activeNpcId ?? '')
    if (!npc) {
      this.leaveBattle(true)
      return
    }

    this.guardActive = true
    // Bracing lets the player size up the opponent — reveals enemy stats for the rest of the battle.
    this.enemyStatsRevealed = true
    this.resolveEnemyTurn(`You brace for ${npc.id}'s counterattack.`)
  }

  private performItemAction(): void {
    if (!this.itemSystem) {
      this.statusText = 'Items are not available yet.'
      this.renderBattleOverlay()
      return
    }
    const inventory = this.itemSystem.getInventory()
    const usable = inventory.filter(s =>
      s.item.usableIn === 'any' || s.item.usableIn === 'battle'
    )
    if (usable.length === 0) {
      this.statusText = 'No usable items.'
      this.renderBattleOverlay()
      return
    }

    // Open the full inventory display in battle mode
    if (this.inventoryDisplay) {
      this.statusText = 'Browsing items…'
      this.renderBattleOverlay()
      this.inventoryDisplay.open('battle', () => {
        // Callback: inventory closed — check if an item was consumed
        // and give the enemy a turn
        this.statusText = 'Choose an action.'
        this.renderBattleOverlay()
        // If an item was used, enemy retaliates
        const npc = this.npcSystem.getNPC(this.activeNpcId ?? '')
        if (npc) {
          setTimeout(() => this.resolveEnemyTurn(`${npc.id} retaliates!`), 400)
        }
      })
      return
    }

    // Fallback: auto-use first item if no inventory display
    const slot = usable[0]
    const effects = this.itemSystem.useItem(slot.item.id, 'battle')
    if (!effects) {
      this.statusText = `Can't use ${slot.item.name} right now.`
      this.renderBattleOverlay()
      return
    }
    for (const fx of effects) {
      if (fx.stat === 'hp') {
        this.playerHP = Math.min(this.playerHP + fx.value, this.maxPlayerHP)
      } else if (fx.stat === 'hpPercent') {
        this.playerHP = Math.min(this.playerHP + Math.round(this.maxPlayerHP * (fx.value / 100)), this.maxPlayerHP)
      }
    }
    this.animatePlayerHPTo(this.playerHP)
    this.statusText = `Used ${slot.item.icon} ${slot.item.name}!`
    this.renderBattleOverlay()
    const npc = this.npcSystem.getNPC(this.activeNpcId ?? '')
    if (npc) {
      setTimeout(() => this.resolveEnemyTurn(`${npc.id} retaliates!`), 700)
    }
  }

  /**
   * Enemy attack turn — deterministic four-shot sequence:
   * 1. enemyFocus     — attack banner shows while camera holds on the enemy.
   * 2. playerReaction — enemy teleports next to the player, attack anim plays, damage applied on completion.
   * 3. wideAction      — 2s reaction beat showing the outcome.
   * 4. attackerFocus   — camera returns to the player; input unlocks.
   */
  private resolveEnemyTurn(prefix: string): void {
    const npc = this.npcSystem.getNPC(this.activeNpcId ?? '')
    if (!npc) {
      this.leaveBattle(true)
      return
    }

    if (!this.cameraManager || !this.battlePlayerPos || !this.battleEnemyPos || !this.cameraManager.isInBattleMode()) {
      // Fallback: no camera choreography
      const baseDamage = 4 + Math.floor(Math.random() * 4)
      const damage = this.guardActive ? Math.max(1, Math.floor(baseDamage * 0.5)) : baseDamage
      this.guardActive = false
      this.playerHP = Math.max(0, this.playerHP - damage)
      this.animatePlayerHPTo(this.playerHP)
      if (this.playerHP <= 0) {
        this.phase = 'ended'
        this.statusText = `${prefix} ${npc.id} strikes back for ${damage}. You were overwhelmed.`
        this.renderBattleOverlay()
        this.startGameOverSequence()
        return
      }
      this.phase = 'player-turn'
      this.statusText = `${prefix} ${npc.id} counters for ${damage}. Choose your next action.`
      this.renderBattleOverlay()
      this.forceAttackerFocusIfWaitingForInput()
      return
    }

    this.attackSequencePlaying = true

    const baseDamage = 4 + Math.floor(Math.random() * 4)
    const damage = this.guardActive ? Math.max(1, Math.floor(baseDamage * 0.5)) : baseDamage
    this.guardActive = false

    // Enemy strike position: strikeRange units from the player, along the enemy→player axis
    const fwd = this.battlePlayerPos.clone().sub(this.battleEnemyPos)
    fwd.y = 0
    fwd.normalize()
    const enemyStrikePos = this.battlePlayerPos.clone().addScaledVector(fwd, -this.strikeRange)
    enemyStrikePos.y = this.battleEnemyPos.y
    const originalEnemyPos = this.battleEnemyPos.clone()

    const sequence: BattleCameraShot[] = [
      {
        type: 'enemyFocus',
        duration: 0.8,
        onStart: () => {
          this.statusText = `${npc.id} attacks!`
          this.renderBattleOverlay()
        },
      },
      {
        type: 'playerReaction',
        duration: 0.6,
        onStart: () => {
          npc.position.copy(enemyStrikePos)
          npc.model.position.copy(enemyStrikePos)
          try { this.charAnimSystem.crossfadeTo(npc.id, 'attack', 0.1) } catch (_) {}
        },
        onComplete: () => {
          this.playerHP = Math.max(0, this.playerHP - damage)
          this.animatePlayerHPTo(this.playerHP)
          npc.position.copy(originalEnemyPos)
          npc.model.position.copy(originalEnemyPos)
          try { this.charAnimSystem.crossfadeTo(npc.id, 'idle', 0.15) } catch (_) {}
        },
      },
      {
        type: 'wideAction',
        duration: 2.0,
        onStart: () => {
          if (this.playerHP <= 0) {
            this.phase = 'ended'
            this.statusText = `${prefix} ${npc.id} strikes back for ${damage}. You were overwhelmed.`
            this.renderBattleOverlay()
            this.startGameOverSequence()
            return
          }
          this.phase = 'player-turn'
          this.statusText = `${prefix} ${npc.id} counters for ${damage}. Choose your next action.`
          this.renderBattleOverlay()
        },
      },
      {
        type: 'attackerFocus',
        duration: 0.3,
        onComplete: () => {
          this.attackSequencePlaying = false
          this.forceAttackerFocusIfWaitingForInput()
        },
      },
    ]

    this.cameraManager.battlePlaySequence(sequence)
  }

  private leaveBattle(applyCooldown: boolean): void {
    if (!this.isActive) return

    const resolvedNpcId = this.activeNpcId
    if (applyCooldown && resolvedNpcId) {
      this.npcSystem.setInteractionCooldown(resolvedNpcId, this.recentBattleCooldownMs)
      this.aiSystem.disengageFromPlayer(resolvedNpcId)
    }

    this.isActive = false
    this.activeNpcId = null
    this.phase = 'player-turn'
    this.highlightedActionIndex = 0
    this.guardActive = false

    this.attackSequencePlaying = false
    if (this.hpAnimHandle !== null) { cancelAnimationFrame(this.hpAnimHandle); this.hpAnimHandle = null }
    this.animSync?.abort()
    this.battlePlayerPos = null
    this.battleEnemyPos = null
    this.restoreClusterPositions()
    this.restorePlayerPositionAfterBattle()
    this.aiSystem.releaseCluster(this.clusterNpcIds)
    this.clusterNpcIds = []
    this.selectedClusterIndex = 0
    this.clusterPositions.clear()
    this.clusterOriginalPositions.clear()
    this.clusterHPs.clear()
    this.playerController?.clearForcedFacingTarget()
    this.hideBattleOverlay()
    console.log(`⚔️ Battle end: npc=${resolvedNpcId ?? 'none'}, applyCooldown=${applyCooldown}, cameraModeBeforeExit=${this.cameraManager?.getCurrentMode() ?? 'none'}`)
    this.soundSystem?.stopBattleTheme_01()
    this.soundSystem?.resumeAreaMusic(1.5)
    this.cameraManager?.exitBattleMode()
  }

  private startVictoryEvent(): void {
    if (this.victoryActive || !this.scene || !this.playerController || !this.cameraManager) {
      this.leaveBattle(true)
      return
    }

    this.victoryActive = true
    this.hideBattleOverlay()
    const defeatedCount = Math.max(1, this.clusterOriginalPositions.size)
    const earnedExperience = defeatedCount * this.victoryParams.expPerEnemy

    const title = this.createVictoryOverlay()
    title.innerHTML = '<div data-victory-title>Victory!</div>'
    const titleElement = title.firstElementChild as HTMLDivElement
    titleElement.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'color:#fff8dc;font-family:cursive;font-size:clamp(64px,16vw,220px);font-weight:bold;font-style:italic;' +
      'letter-spacing:0;text-shadow:0 0 24px rgba(255,211,106,0.7),0 4px 18px rgba(0,0,0,0.9);'
    title.style.opacity = '1'

    this.victoryTimer = window.setTimeout(() => {
      title.style.opacity = '0'
      this.victoryTimer = window.setTimeout(() => {
        this.showVictoryStats(earnedExperience)
      }, this.victoryParams.fadeDuration * 1000)
    }, this.victoryParams.titleDuration * 1000)
  }

  private showVictoryStats(earnedExperience: number): void {
    if (!this.scene || !this.playerController || !this.cameraManager || !this.victoryOverlay) return

    const playerMesh = this.playerController.getMesh()
    const playerUuids = new Set<string>()
    playerMesh.traverse(object => playerUuids.add(object.uuid))
    this.victorySavedVisibility.clear()
    this.scene.traverse(object => {
      if (object === this.scene || playerUuids.has(object.uuid)) return
      this.victorySavedVisibility.set(object.uuid, object.visible)
      object.visible = false
    })
    playerMesh.visible = true
    playerMesh.traverse(object => { object.visible = true })

    this.victorySavedBackground = this.scene.background as THREE.Color | THREE.Texture | null
    this.scene.background = new THREE.Color(0x000000)
    this.setOceanVisible?.(false)
    this.victoryAmbient = new THREE.AmbientLight(0xffffff, 0.8)
    this.scene.add(this.victoryAmbient)
    this.cameraManager.enterMenuMode(this.playerController.getPosition(), this.playerController.getFacingYaw())

    const startExperience = this.experience
    const endExperience = startExperience + earnedExperience
    this.victoryOverlay.innerHTML =
      '<div data-victory-stats>' +
        `<div style="color:#fff8dc;font-family:cursive;font-size:clamp(38px,8vw,96px);font-weight:bold;font-style:italic;">Victory!</div>` +
        `<div style="margin-top:18px;color:#ffd866;font-size:clamp(16px,3vw,28px);letter-spacing:2px;">+${earnedExperience} EXP</div>` +
        '<div data-victory-exp style="margin-top:10px;color:#eefcff;font-size:clamp(26px,5vw,52px);font-weight:bold;font-variant-numeric:tabular-nums;"></div>' +
        `<div style="margin-top:8px;color:#b9d0d8;font-size:clamp(13px,2vw,18px);letter-spacing:2px;">LEVEL ${this.playerLevel}</div>` +
      '</div>'
    const stats = this.victoryOverlay.firstElementChild as HTMLDivElement
    stats.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding:0 24px max(12vh,72px);text-align:center;'
    this.victoryOverlay.style.opacity = '1'

    const expElement = this.victoryOverlay.querySelector('[data-victory-exp]') as HTMLDivElement
    const duration = 1100
    const startedAt = performance.now()
    const countExperience = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const currentExperience = Math.round(startExperience + (endExperience - startExperience) * progress)
      expElement.textContent = `EXP ${currentExperience} / ${this.victoryParams.expForNextLevel}`
      if (progress < 1) {
        requestAnimationFrame(countExperience)
        return
      }
      this.experience = endExperience
      while (this.experience >= this.victoryParams.expForNextLevel) {
        this.experience -= this.victoryParams.expForNextLevel
        this.playerLevel++
      }
      this.victoryTimer = window.setTimeout(() => this.finishVictoryEvent(), 1400)
    }
    requestAnimationFrame(countExperience)
  }

  private createVictoryOverlay(): HTMLDivElement {
    if (!this.victoryOverlay) {
      this.victoryOverlay = document.createElement('div')
      this.victoryOverlay.id = 'battle-victory-overlay'
      this.victoryOverlay.style.cssText =
        'position:fixed;inset:0;z-index:12200;pointer-events:none;opacity:0;' +
        `transition:opacity ${this.victoryParams.fadeDuration}s ease;background:rgba(0,0,0,0.06);` +
        'font-family:"Courier New",monospace;'
      document.body.appendChild(this.victoryOverlay)
    }
    return this.victoryOverlay
  }

  private finishVictoryEvent(): void {
    if (!this.victoryActive) return
    if (this.victoryTimer !== null) window.clearTimeout(this.victoryTimer)
    this.victoryTimer = null
    this.victoryOverlay?.remove()
    this.victoryOverlay = null
    this.victorySavedVisibility.forEach((visible, uuid) => {
      const object = this.scene?.getObjectByProperty('uuid', uuid)
      if (object) object.visible = visible
    })
    this.victorySavedVisibility.clear()
    if (this.scene) this.scene.background = this.victorySavedBackground
    this.victorySavedBackground = null
    this.setOceanVisible?.(true)
    if (this.victoryAmbient) {
      this.scene?.remove(this.victoryAmbient)
      this.victoryAmbient.dispose()
      this.victoryAmbient = null
    }
    this.victoryActive = false
    this.cameraManager?.exitVictoryMode()
    this.leaveBattle(true)
  }

  private syncBattleFacing(): void {
    if (!this.playerController || !this.activeNpcId) return
    const npc = this.npcSystem.getNPC(this.activeNpcId)
    if (!npc) return

    // Use the staged cluster position for facing (not live NPC pos which may have been restored)
    const targetPos = this.clusterPositions.get(this.activeNpcId) ?? npc.position
    this.playerController.setForcedFacingTarget(targetPos)

    const playerPos = this.playerController.getPosition()
    const toPlayer = playerPos.clone().sub(targetPos)
    toPlayer.y = 0
    if (toPlayer.lengthSq() > 0.0001) {
      npc.rotation = Math.atan2(toPlayer.x, toPlayer.z)
    }
  }

  // ── Cluster staging ──────────────────────────────────────────────────────

  private stageClusterBattlePositions(): void {
    if (!this.playerController || this.stagedPlayerStartPosition) return

    const primaryNpc = this.npcSystem.getNPC(this.clusterNpcIds[0])
    if (!primaryNpc) return

    const currentPlayerPos = this.playerController.getPosition()
    const toNpc = primaryNpc.position.clone().sub(currentPlayerPos)
    toNpc.y = 0
    if (toNpc.lengthSq() < 0.0001) toNpc.set(0, 0, 1)
    else toNpc.normalize()

    const midpoint = currentPlayerPos.clone().lerp(primaryNpc.position, 0.5)
    midpoint.y = currentPlayerPos.y

    const halfDist = this.battleStandingDistance / 2
    const playerBattlePos = midpoint.clone().addScaledVector(toNpc, -halfDist)
    playerBattlePos.y = currentPlayerPos.y

    this.stagedPlayerStartPosition = currentPlayerPos.clone()
    this.battlePlayerPos = playerBattlePos.clone()
    this.playerController.setPosition(playerBattlePos)

    // Arrange cluster NPCs in an arc perpendicular to the player→enemy axis
    const right = new THREE.Vector3(-toNpc.z, 0, toNpc.x)
    const centerIndex = (this.clusterNpcIds.length - 1) / 2

    for (let i = 0; i < this.clusterNpcIds.length; i++) {
      const npc = this.npcSystem.getNPC(this.clusterNpcIds[i])
      if (!npc) continue

      const offset = (i - centerIndex) * this.clusterSpacing
      const enemyPos = midpoint.clone()
        .addScaledVector(toNpc, halfDist)
        .addScaledVector(right, offset)
      enemyPos.y = npc.position.y

      npc.position.copy(enemyPos)
      npc.model.position.copy(enemyPos)
      this.clusterPositions.set(this.clusterNpcIds[i], enemyPos.clone())
    }

    // Set camera enemy target to the selected NPC
    const selectedId = this.clusterNpcIds[this.selectedClusterIndex]
    this.battleEnemyPos = this.clusterPositions.get(selectedId) ?? null

    console.log(
      `⚔️ Cluster staging (${this.clusterNpcIds.length} NPCs, ${this.battleStandingDistance}u apart): ` +
      `player at (${playerBattlePos.x.toFixed(2)}, ${playerBattlePos.y.toFixed(2)}, ${playerBattlePos.z.toFixed(2)})`
    )
  }

  /** Restore all cluster NPCs to their original (pre-battle) positions. */
  private restoreClusterPositions(): void {
    for (const [id, origPos] of this.clusterOriginalPositions) {
      const npc = this.npcSystem.getNPC(id)
      if (npc && !this.npcSystem.isDefeated(id)) {
        npc.position.copy(origPos)
        npc.model.position.copy(origPos)
      }
    }
  }

  /** Switch the active battle target to the currently selected cluster NPC. */
  private updateBattleTarget(): void {
    const selectedId = this.clusterNpcIds[this.selectedClusterIndex]
    if (!selectedId) return

    this.activeNpcId = selectedId
    this.enemyHP = this.clusterHPs.get(selectedId) ?? this.maxEnemyHP
    this.battleEnemyPos = this.clusterPositions.get(selectedId) ?? null

    // Update camera and player facing
    if (this.battlePlayerPos && this.battleEnemyPos && this.cameraManager) {
      this.cameraManager.updateBattlePositions(this.battlePlayerPos, this.battleEnemyPos)
    }
    this.syncBattleFacing()
  }

  /**
   * Cycle the cluster NPC selection (left/right).
   * Returns true if input was consumed.
   */
  public handleClusterNavigate(dir: number, source: InputTraceSource = 'system'): boolean {
    if (!this.isActive || this.clusterNpcIds.length <= 1) {
      traceInputCommand({ source, target: 'battle', command: dir > 0 ? 'cluster-right' : 'cluster-left', result: 'ignored' })
      return false
    }
    if (this.isCommandInputBlocked()) {
      traceInputCommand({ source, target: 'battle', command: dir > 0 ? 'cluster-right' : 'cluster-left', result: 'blocked' })
      return true
    }
    this.selectedClusterIndex =
      (this.selectedClusterIndex + dir + this.clusterNpcIds.length) % this.clusterNpcIds.length
    this.updateBattleTarget()
    this.renderBattleOverlay()
    traceInputCommand({
      source, target: 'battle',
      command: dir > 0 ? 'cluster-right' : 'cluster-left',
      result: 'consumed',
      details: { selectedNpc: this.activeNpcId, index: this.selectedClusterIndex, total: this.clusterNpcIds.length }
    })
    return true
  }

  /** How many NPCs are in the current battle cluster. */
  public getClusterSize(): number {
    return this.clusterNpcIds.length
  }

  private restorePlayerPositionAfterBattle(): void {
    if (!this.playerController || !this.stagedPlayerStartPosition) return

    const restorePosition = this.stagedPlayerStartPosition.clone()
    this.stagedPlayerStartPosition = null
    this.playerController.setPosition(restorePosition)
    console.log(
      `⚔️ Battle restore: player returned to (${restorePosition.x.toFixed(2)}, ${restorePosition.y.toFixed(2)}, ${restorePosition.z.toFixed(2)})`
    )
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.isActive) return

    if (this.gameOverActive) {
      if (e.code === 'KeyJ' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        e.preventDefault()
        this.restartGame()
      }
      return
    }

    if (this.victoryActive) return

    // When the inventory display is open during battle, let it handle all input
    if (this.inventoryDisplay?.isInventoryActive()) return

    if (this.phase === 'ended') {
      if (e.code === 'Escape' || e.code === 'KeyJ' || e.code === 'KeyL') {
        e.preventDefault()
        traceInputCommand({ source: 'keyboard', target: 'battle', command: 'continue', result: 'executed', details: { phase: this.phase } })
        this.leaveBattle(true)
      }
      // Enter/Return falls through to the global keydown handler (triggers pause)
      return
    }

    if (e.code === 'Escape' || e.code === 'KeyL') {
      e.preventDefault()
      this.handleMenuAction('escape', 'keyboard')
      return
    }

    if (this.phase !== 'player-turn') return

    if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault()
      this.handleNavigateInput(-1, 'keyboard')
      return
    }

    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault()
      this.handleNavigateInput(1, 'keyboard')
      return
    }

    // Left/right: cycle cluster NPC selection
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault()
      this.handleClusterNavigate(-1, 'keyboard')
      return
    }

    if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault()
      this.handleClusterNavigate(1, 'keyboard')
      return
    }

    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault()
      this.onPauseRequest?.()
      return
    }

    if (e.code === 'KeyJ') {
      e.preventDefault()
      this.handleDirectActionInput('attack', 'keyboard')
      return
    }

    if (e.code === 'KeyK') {
      e.preventDefault()
      this.handleDirectActionInput('guard', 'keyboard')
      return
    }

    if (e.code === 'KeyI') {
      e.preventDefault()
      this.handleDirectActionInput('item', 'keyboard')
      return
    }
  }

  private cycleChoice(dir: number): void {
    this.highlightedActionIndex =
      (this.highlightedActionIndex + dir + this.menuActions.length) % this.menuActions.length
    this.updateChoiceHighlight()
  }

  private setPlayerHPDisplay(value: number): void {
    if (this.overlayHPText) {
      const enemyText = this.enemyStatsRevealed
        ? `Enemy ${this.enemyHP}/${this.maxEnemyHP}`
        : 'Enemy HP: ???'
      this.overlayHPText.textContent = `Player ${Math.round(value)}/${this.maxPlayerHP}   |   ${enemyText}`
    }
    if (this.overlayPlayerHPBarFill) {
      const pct = Math.max(0, Math.min(1, value / this.maxPlayerHP)) * 100
      this.overlayPlayerHPBarFill.style.width = `${pct}%`
      this.overlayPlayerHPBarFill.style.backgroundColor = pct <= 25 ? '#ff3b3b' : pct <= 50 ? '#ffb266' : '#ff6b6b'
    }
  }

  /** Eases the displayed player HP toward the real value so damage/healing reads as a smooth bar/text drain or fill. */
  private animatePlayerHPTo(target: number): void {
    if (this.hpAnimHandle !== null) cancelAnimationFrame(this.hpAnimHandle)
    const start = this.displayedPlayerHP
    const startedAt = performance.now()
    const duration = 450
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / duration)
      this.displayedPlayerHP = start + (target - start) * t
      this.setPlayerHPDisplay(this.displayedPlayerHP)
      if (t < 1) {
        this.hpAnimHandle = requestAnimationFrame(step)
      } else {
        this.hpAnimHandle = null
      }
    }
    this.hpAnimHandle = requestAnimationFrame(step)
  }

  private renderBattleOverlay(): void {
    if (!this.overlayRoot || !this.overlayPanel || !this.overlayTopBox) return

    this.applyOverlayLayout()

    this.overlayRoot.style.display = 'block'
    this.overlayTopBox.style.display = 'block'
    this.overlayPanel.style.display = 'block'
    if (this.overlayPrompt) this.overlayPrompt.style.display = 'none'

    const npc = this.activeNpcId ? this.npcSystem.getNPC(this.activeNpcId) : null
    if (this.overlayTitle) {
      if (this.clusterNpcIds.length > 1) {
        const navHint = this.inputMode === 'touch' ? '' : this.inputMode === 'gamepad' ? ' (◀ D-Pad ▶)' : ' (◀ A/D ▶)'
        this.overlayTitle.textContent = npc
          ? `Battle: ◀ ${npc.id} ▶  [${this.selectedClusterIndex + 1}/${this.clusterNpcIds.length}]${navHint}`
          : 'Battle'
      } else {
        this.overlayTitle.textContent = npc ? `Battle: ${npc.id}` : 'Battle'
      }
    }

    if (this.overlayHP) {
      this.setPlayerHPDisplay(this.displayedPlayerHP)
    }

    if (this.overlayStatus) {
      this.overlayStatus.textContent = this.statusText
    }

    // Mobile cluster NPC navigation buttons — placed in top box
    if (this.clusterNpcIds.length > 1 && this.inputMode === 'touch' && this.overlayTopBox) {
      let clusterNav = document.getElementById('battle-cluster-nav') as HTMLDivElement | null
      if (!clusterNav) {
        clusterNav = document.createElement('div')
        clusterNav.id = 'battle-cluster-nav'
        clusterNav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;margin-top:10px;pointer-events:auto;'
        this.overlayTopBox.appendChild(clusterNav)
      }
      clusterNav.innerHTML = ''
      const npcName = this.activeNpcId ?? '?'
      const makeTouchBtn = (label: string, handler: () => void) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = label
        btn.style.cssText = 'color:#ffd866;background:rgba(0,0,0,0.4);border:1px solid #ffd866;border-radius:6px;padding:10px 18px;font-size:20px;min-width:48px;min-height:44px;pointer-events:auto;touch-action:manipulation;cursor:pointer;'
        btn.addEventListener('touchend', (ev) => { ev.preventDefault(); ev.stopPropagation(); handler() }, { passive: false })
        return btn
      }
      clusterNav.appendChild(makeTouchBtn('◀', () => this.handleClusterNavigate(-1, 'touch')))
      const label = document.createElement('span')
      label.textContent = `${npcName}  [${this.selectedClusterIndex + 1}/${this.clusterNpcIds.length}]`
      label.style.cssText = 'color:#ffd866;font-size:16px;letter-spacing:1px;'
      clusterNav.appendChild(label)
      clusterNav.appendChild(makeTouchBtn('▶', () => this.handleClusterNavigate(1, 'touch')))
    } else {
      const clusterNav = document.getElementById('battle-cluster-nav')
      if (clusterNav) clusterNav.remove()
    }

    if (!this.overlayChoices) return
    this.overlayChoices.innerHTML = ''

    if (this.phase === 'ended') {
      const hint = document.createElement('div')
      hint.textContent = this.getContinueHintText()
      hint.style.cssText = 'color:#ffd866;font-size:14px;padding-top:8px;text-shadow:0 0 12px rgba(0,0,0,0.85);'
      if (this.inputMode === 'touch') {
        hint.style.pointerEvents = 'auto'
        hint.style.cursor = 'pointer'
        hint.style.padding = '12px 24px'
        hint.style.touchAction = 'manipulation'
        hint.addEventListener('touchend', (e) => {
          e.preventDefault()
          e.stopPropagation()
          this.leaveBattle(true)
        })
      }
      this.overlayChoices.appendChild(hint)
      return
    }

    this.menuActions.forEach((action, index) => {
      const item = document.createElement('button')
      item.type = 'button'
      const itemColor = this.getActionColor(action.id, index === this.highlightedActionIndex)
      item.textContent = this.getActionDisplayText(action, index)
      item.style.cssText = `color:${itemColor};padding:${this.inputMode === 'touch' ? '12px 18px' : '6px 14px'};font-size:${this.inputMode === 'touch' ? '18px' : '16px'};cursor:pointer;transition:color 0.15s,border-color 0.15s;text-shadow:${this.inputMode === 'touch' ? '0 0 14px rgba(0,0,0,0.9)' : 'none'};pointer-events:auto;touch-action:manipulation;background:transparent;border:1px solid ${itemColor};border-radius:4px;outline:none;text-align:left;width:100%;appearance:none;-webkit-appearance:none;box-sizing:border-box;`
      let lastActivateTime = 0
      const activate = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        const now = performance.now()
        if (now - lastActivateTime < 120) return
        lastActivateTime = now
        if (this.inputMode !== 'touch') {
          this.highlightedActionIndex = index
        }
        this.handleDirectActionInput(action.id, this.inputMode === 'touch' ? 'touch' : 'mouse')
      }
      item.addEventListener('mouseenter', () => {
        this.highlightedActionIndex = index
        this.updateChoiceHighlight()
      })
      item.addEventListener('pointerdown', (event) => {
        if (this.inputMode === 'touch' || (event as PointerEvent).pointerType === 'touch') {
          event.preventDefault()
          event.stopPropagation()
        }
      })
      item.addEventListener('touchstart', (event) => {
        event.preventDefault()
        event.stopPropagation()
      }, { passive: false })
      item.addEventListener('pointerup', (event) => {
        if (this.inputMode === 'touch' || (event as PointerEvent).pointerType === 'touch') {
          activate(event)
        }
      })
      item.addEventListener('touchend', (event) => {
        activate(event)
      }, { passive: false })
      item.addEventListener('click', (event) => {
        if (this.inputMode === 'touch') {
          event.preventDefault()
          return
        }
        activate(event)
      })
      this.overlayChoices!.appendChild(item)
    })
  }

  private updateChoiceHighlight(): void {
    if (!this.overlayChoices) return
    const items = Array.from(this.overlayChoices.children)
    items.forEach((item, index) => {
      const el = item as HTMLElement
      const action = this.menuActions[index]
      if (!action) return
      el.textContent = this.getActionDisplayText(action, index)
      const newColor = this.getActionColor(action.id, index === this.highlightedActionIndex)
      el.style.color = newColor
      el.style.borderColor = newColor
    })
  }

  private getActionDisplayText(action: BattleMenuAction, index: number): string {
    const bindingLabel = this.getActionBindingLabel(action.id)
    const label = bindingLabel ? `${bindingLabel}. ${action.label}` : action.label
    return label
  }

  private getActionBindingLabel(actionId: BattleActionId): string {
    if (this.inputMode === 'touch') return ''

    if (this.inputMode === 'gamepad') {
      switch (actionId) {
        case 'attack':
          return 'X'
        case 'guard':
          return 'A'
        case 'escape':
          return 'B'
        case 'item':
          return 'Y'
      }
    }

    switch (actionId) {
      case 'attack':
        return 'J'
      case 'guard':
        return 'K'
      case 'escape':
        return 'L'
      case 'item':
        return 'I'
    }
  }

  private buildOverlayUI(): void {
    this.overlayRoot = document.createElement('div')
    this.overlayRoot.id = 'battle-overlay'
    this.overlayRoot.style.cssText =
      'position:fixed;inset:0;z-index:12100;pointer-events:none;display:none;font-family:"Courier New",monospace;'

    this.overlayPrompt = document.createElement('div')
    this.overlayPrompt.style.cssText =
      'position:absolute;bottom:168px;left:50%;transform:translateX(-50%);' +
      'background:rgba(36,8,4,0.7);border:1px solid rgba(255,143,107,0.45);' +
      'color:#fff2e8;padding:10px 18px;border-radius:8px;font-size:14px;letter-spacing:1px;display:none;'
    this.overlayRoot.appendChild(this.overlayPrompt)

    // Top box — battle title, HP bars, status text (centred at top of viewport)
    this.overlayTopBox = document.createElement('div')
    this.overlayTopBox.id = 'battle-top-box'
    this.overlayTopBox.style.cssText =
      'position:absolute;top:0;left:0;right:0;' +
      'background:linear-gradient(to bottom,rgba(24,6,4,0.94),rgba(52,12,8,0.72) 72%,transparent);' +
      'padding:28px 32px 24px;display:none;pointer-events:none;text-align:center;'
    this.overlayRoot.appendChild(this.overlayTopBox)

    this.overlayTitle = document.createElement('div')
    this.overlayTitle.style.cssText = 'color:#ff8f6b;font-size:18px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;'
    this.overlayTopBox.appendChild(this.overlayTitle)

    this.overlayHP = document.createElement('div')
    this.overlayHP.style.cssText = 'margin-bottom:10px;'
    this.overlayTopBox.appendChild(this.overlayHP)

    this.overlayHPText = document.createElement('div')
    this.overlayHPText.style.cssText = 'color:#ffd9c7;font-size:14px;letter-spacing:1px;margin-bottom:4px;'
    this.overlayHP.appendChild(this.overlayHPText)

    const playerHPBarTrack = document.createElement('div')
    playerHPBarTrack.style.cssText = 'width:220px;max-width:60vw;height:6px;margin:0 auto;background:rgba(255,255,255,0.15);border-radius:3px;overflow:hidden;'
    this.overlayPlayerHPBarFill = document.createElement('div')
    this.overlayPlayerHPBarFill.style.cssText = 'height:100%;width:100%;background:#ff6b6b;border-radius:3px;transition:background-color 0.2s;'
    playerHPBarTrack.appendChild(this.overlayPlayerHPBarFill)
    this.overlayHP.appendChild(playerHPBarTrack)

    this.overlayStatus = document.createElement('div')
    this.overlayStatus.style.cssText = 'color:#fff7f1;font-size:18px;line-height:1.45;max-width:760px;margin:0 auto;'
    this.overlayTopBox.appendChild(this.overlayStatus)

    // Bottom panel — action choices only
    this.overlayPanel = document.createElement('div')
    this.overlayPanel.style.cssText =
      'position:absolute;bottom:0;left:0;right:0;padding:28px 32px 34px;display:none;pointer-events:auto;' +
      'background:linear-gradient(to top,rgba(24,6,4,0.94),rgba(52,12,8,0.72) 72%,transparent);'
    this.overlayRoot.appendChild(this.overlayPanel)

    this.overlayChoices = document.createElement('div')
    this.overlayChoices.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-width:360px;'
    this.overlayPanel.appendChild(this.overlayChoices)

    document.body.appendChild(this.overlayRoot)
    this.applyOverlayLayout()
  }

  public getActionCount(): number {
    return this.menuActions.length
  }

  public setHighlightedActionIndex(index: number): void {
    this.highlightedActionIndex = Math.max(0, Math.min(index, this.menuActions.length - 1))
    this.updateChoiceHighlight()
  }

  private getEngagePromptText(_npcId: string): string {
    switch (this.inputMode) {
      case 'touch':
        return 'FIGHT'
      case 'gamepad':
        return 'X. FIGHT'
      default:
        return 'K. FIGHT'
    }
  }

  private getContinueHintText(): string {
    switch (this.inputMode) {
      case 'touch':
        return '[Tap to continue]'
      case 'gamepad':
        return '[Press A to return to gameplay]'
      default:
        return '[Press J to return to gameplay]'
    }
  }

  private getPromptAccentColor(): string {
    return '#ff6b6b'
  }

  private getActionColor(actionId: BattleActionId, highlighted: boolean): string {
    switch (actionId) {
      case 'attack':
        return highlighted ? '#ff9d9d' : '#ff6b6b'
      case 'guard':
        return highlighted ? '#baffc9' : '#7CFC98'
      case 'item':
        return highlighted ? '#a9d8ff' : '#66b7ff'
      case 'escape':
        return highlighted ? '#fff1a8' : '#ffd866'
    }
  }

  private applyOverlayLayout(): void {
    if (!this.overlayPrompt || !this.overlayPanel || !this.overlayTopBox || !this.overlayStatus || !this.overlayChoices) return

    const promptColor = this.getPromptAccentColor()

    if (this.inputMode === 'touch') {
      this.overlayPrompt.style.cssText =
        'position:absolute;left:16px;bottom:calc(56px + env(safe-area-inset-bottom, 0px));transform:none;' +
        `color:${promptColor};font-size:18px;letter-spacing:2px;display:none;text-align:left;` +
        'background:transparent;border:none;padding:10px 18px;' +
        'text-shadow:0 2px 18px rgba(0,0,0,0.95);pointer-events:auto;cursor:pointer;' +
        'max-width:calc(50vw - 28px);line-height:1.1;white-space:normal;touch-action:manipulation;'

      this.overlayTopBox.style.cssText =
        'position:absolute;top:0;left:0;right:0;' +
        'background:linear-gradient(to bottom,rgba(24,6,4,0.94),rgba(52,12,8,0.72) 72%,transparent);' +
        'padding:env(safe-area-inset-top,12px) 20px 20px;display:none;pointer-events:none;text-align:center;'

      this.overlayPanel.style.cssText =
        'position:absolute;left:16px;right:16px;bottom:calc(48px + env(safe-area-inset-bottom, 0px));' +
        'padding:0;display:none;pointer-events:auto;background:transparent;'

      this.overlayStatus.style.cssText =
        'color:#fff7f1;font-size:18px;line-height:1.45;max-width:none;text-shadow:0 0 16px rgba(0,0,0,0.92);margin:0 auto;'

      this.overlayChoices.style.cssText = 'display:flex;flex-direction:column;gap:10px;max-width:none;pointer-events:auto;'
    } else {
      this.overlayPrompt.style.cssText =
        'position:absolute;left:20px;bottom:28px;transform:none;' +
        `color:${promptColor};font-size:18px;letter-spacing:2px;display:none;text-align:left;` +
        'background:transparent;border:none;padding:0;text-shadow:0 2px 18px rgba(0,0,0,0.95);pointer-events:none;white-space:nowrap;'

      this.overlayTopBox.style.cssText =
        'position:absolute;top:0;left:0;right:0;' +
        'background:linear-gradient(to bottom,rgba(24,6,4,0.94),rgba(52,12,8,0.72) 72%,transparent);' +
        'padding:28px 32px 24px;display:none;pointer-events:none;text-align:center;'

      this.overlayPanel.style.cssText =
        'position:absolute;bottom:0;left:0;right:0;padding:28px 32px 34px;display:none;pointer-events:auto;' +
        'background:linear-gradient(to top,rgba(24,6,4,0.94),rgba(52,12,8,0.72) 72%,transparent);'

      this.overlayStatus.style.cssText = 'color:#fff7f1;font-size:18px;line-height:1.45;max-width:760px;margin:0 auto;'
      this.overlayChoices.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-width:360px;'
    }
  }

  private showPromptOverlay(text: string): void {
    if (!this.overlayRoot || !this.overlayPrompt) return
    this.applyOverlayLayout()
    this.overlayRoot.style.display = 'block'
    this.overlayPrompt.style.display = 'block'
    this.overlayPrompt.textContent = text
    this.promptVisible = true

    // Touch mode: make prompt a clickable text bar that starts battle directly
    if (this.inputMode === 'touch') {
      this.overlayPrompt.style.pointerEvents = 'auto'
      this.overlayPrompt.style.cursor = 'pointer'
      this.overlayPrompt.style.touchAction = 'manipulation'
      this.overlayPrompt.ontouchend = (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (this.nearestBattleNpc && !this.isActive) {
          this.handleAttackButton()
        }
      }
      this.overlayPrompt.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (this.nearestBattleNpc && !this.isActive) {
          this.handleAttackButton()
        }
      }
    } else {
      this.overlayPrompt.style.pointerEvents = 'none'
      this.overlayPrompt.ontouchend = null
      this.overlayPrompt.onclick = null
    }
  }

  private hidePromptOverlay(): void {
    if (this.overlayPrompt) this.overlayPrompt.style.display = 'none'
    if (this.overlayRoot && !this.isActive) this.overlayRoot.style.display = 'none'
    this.promptVisible = false
  }

  private hideBattleOverlay(): void {
    if (this.overlayTopBox) this.overlayTopBox.style.display = 'none'
    if (this.overlayPanel) this.overlayPanel.style.display = 'none'
    if (this.overlayRoot) this.overlayRoot.style.display = 'none'
  }

  private clearPromptState(): void {
    this.nearestBattleNpc = null
    this.hidePromptOverlay()
  }

  // ── Game Over presentation ───────────────────────────────────────────────────────

  private startGameOverSequence(): void {
    if (this.gameOverActive || !this.cameraManager || !this.playerController) return
    this.gameOverActive = true
    this.hideBattleOverlay()
    this.attackSequencePlaying = false
    if (this.hpAnimHandle !== null) { cancelAnimationFrame(this.hpAnimHandle); this.hpAnimHandle = null }

    try { this.charAnimSystem.crossfadeTo('player', 'death', 0.2) } catch (_) {}

    // Take manual control of the battle camera — stop the shot queue so it can't fight our spin.
    this.cameraManager.getBattleCameraController().stop()
    const camera = this.cameraManager.getCamera()
    const center = this.playerController.getPosition().clone().add(new THREE.Vector3(0, 1.2, 0))
    const radius = 4.5
    const startAngle = Math.atan2(camera.position.x - center.x, camera.position.z - center.z)
    const spinSpeed = 0.35 // rad/sec — slow, deliberate
    const spinDuration = 3200 // ms
    const startedAt = performance.now()

    const overlay = this.createGameOverOverlay()

    const spin = (now: number) => {
      const elapsed = now - startedAt
      const angle = startAngle + spinSpeed * (elapsed / 1000)
      camera.position.set(
        center.x + Math.sin(angle) * radius,
        center.y + 1.6,
        center.z + Math.cos(angle) * radius,
      )
      camera.lookAt(center)
      if (elapsed < spinDuration) {
        this.gameOverSpinHandle = requestAnimationFrame(spin)
      } else {
        this.gameOverSpinHandle = null
        this.showGameOverText(overlay)
      }
    }
    this.gameOverSpinHandle = requestAnimationFrame(spin)
  }

  private createGameOverOverlay(): HTMLDivElement {
    const overlay = document.createElement('div')
    overlay.id = 'battle-gameover-overlay'
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:12300;background:#ffffff;opacity:0;pointer-events:none;' +
      'transition:opacity 0.65s ease;font-family:"Courier New",monospace;'
    overlay.addEventListener('click', () => this.restartGame())
    overlay.addEventListener('touchend', (e) => { e.preventDefault(); this.restartGame() })
    document.body.appendChild(overlay)
    this.gameOverOverlay = overlay
    return overlay
  }

  private showGameOverText(overlay: HTMLDivElement): void {
    overlay.style.opacity = '1'
    window.setTimeout(() => {
      overlay.innerHTML =
        '<div style="font-family:cursive;font-weight:bold;font-style:italic;' +
          'font-size:clamp(48px,14vw,180px);color:#000;text-align:center;line-height:1;">GAME OVER</div>' +
        '<div style="margin-top:18px;font-size:clamp(14px,2.4vw,22px);color:#000;letter-spacing:2px;">Press to restart</div>'
      overlay.style.cssText += 'display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;'
    }, 650)
  }

  private restartGame(): void {
    window.location.reload()
  }
}