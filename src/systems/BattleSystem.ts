import * as THREE from 'three'
import { NPCSystem, NPCInstance } from './NPCSystem'
import { NPCAISystem } from './NPCAISystem'
import { CharacterAnimationSystem } from './CharacterAnimationSystem'
import { CameraManager } from './CameraManager'
import type { BattleCameraShot } from './BattleCameraController'
import type { PlayerController } from './PlayerController'
import type { DialogueManager } from './DialogueSystem'
import { logger, LogModule } from './Logger'

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
  private cameraManager: CameraManager | null = null
  private playerController: PlayerController | null = null
  private dialogueManager: DialogueManager | null = null

  private isActive = false
  private activeNpcId: string | null = null
  private nearestBattleNpc: string | null = null
  private phase: BattlePhase = 'player-turn'
  private highlightedActionIndex = 0
  private promptVisible = false
  private guardActive = false
  private playerHP = 30
  private enemyHP = 18
  private readonly maxPlayerHP = 30
  private readonly maxEnemyHP = 18
  private statusText = 'Choose an action.'

  private readonly interactionRange = 4.5
  private readonly hostileAutoTriggerRange = 1.85
  private readonly recentBattleCooldownMs = 3000

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

  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null

  private overlayRoot: HTMLDivElement | null = null
  private overlayPrompt: HTMLDivElement | null = null
  private overlayPanel: HTMLDivElement | null = null
  private overlayTitle: HTMLDivElement | null = null
  private overlayHP: HTMLDivElement | null = null
  private overlayStatus: HTMLDivElement | null = null
  private overlayChoices: HTMLDivElement | null = null
  private inputMode: ActiveInputMode = 'keyboard'
  private pendingScriptedBattleNpcId: string | null = null

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

  setCameraManager(cam: CameraManager): void {
    this.cameraManager = cam
  }

  setPlayerController(playerController: PlayerController): void {
    this.playerController = playerController
  }

  setDialogueManager(dialogueManager: DialogueManager): void {
    this.dialogueManager = dialogueManager
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

    const hostileRed = this.npcSystem.getNPCsInRadius(playerPosition, this.hostileAutoTriggerRange)
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

  handleAttackButton(): boolean {
    if (this.isActive) return false
    if (this.dialogueManager?.isDialogueActive()) return false

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

    if (!candidate) return false
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

  handleConfirmActionButton(): boolean {
    if (!this.isActive) return false
    if (this.attackSequencePlaying) return true  // Block input during attack animation
    if (this.phase === 'ended') {
      this.leaveBattle(true)
      return true
    }

    const action = this.menuActions[this.highlightedActionIndex]
    if (!action) return true

    return this.handleMenuAction(action.id)
  }

  handleMenuAction(actionId: BattleActionId): boolean {
    if (!this.isActive) return false
    if (this.attackSequencePlaying) return true
    if (this.phase === 'ended') {
      this.leaveBattle(true)
      return true
    }

    switch (actionId) {
      case 'attack':
        this.performAttackTurn()
        return true
      case 'guard':
        this.performGuardTurn()
        return true
      case 'escape':
        this.handleEscapeInput()
        return true
      case 'item':
        this.performItemAction()
        return true
    }
  }

  handleEscapeInput(): boolean {
    if (!this.isActive) return false
    this.statusText = 'You escaped the battle.'
    this.renderBattleOverlay()
    this.leaveBattle(true)
    return true
  }

  private startBattle(npcId: string, trigger: 'player' | 'enemy'): boolean {
    if (this.isActive || this.dialogueManager?.isDialogueActive()) return false

    const npc = this.npcSystem.getNPC(npcId)
    if (!npc || !this.playerController) return false

    this.isActive = true
    this.activeNpcId = npcId
    this.phase = 'player-turn'
    this.highlightedActionIndex = 0
    this.playerHP = this.maxPlayerHP
    this.enemyHP = this.maxEnemyHP
    this.guardActive = false
    this.statusText = trigger === 'enemy'
      ? `${npc.id} closes in and forces a battle.`
      : `You challenge ${npc.id}.`

    this.dialogueManager?.hideInteractionPrompt()
    this.clearPromptState()
    this.stageBattlePositions(npc)
    this.syncBattleFacing()

    if (this.cameraManager && this.battlePlayerPos && this.battleEnemyPos) {
      console.log(`⚔️ Battle start: npc=${npcId}, trigger=${trigger}, cameraModeBefore=${this.cameraManager.getCurrentMode()}`)
      this.cameraManager.enterBattleMode(this.battlePlayerPos, this.battleEnemyPos)
    }

    this.renderBattleOverlay()
    logger.info(LogModule.SYSTEM, `Battle started with NPC "${npcId}" (${trigger})`)
    return true
  }

  private performAttackTurn(): void {
    const npc = this.npcSystem.getNPC(this.activeNpcId ?? '')
    if (!npc) {
      this.leaveBattle(true)
      return
    }
    if (!this.cameraManager || !this.battlePlayerPos || !this.battleEnemyPos || !this.playerController) {
      // Fallback: no camera choreography
      this.performAttackDamage(npc)
      return
    }

    this.attackSequencePlaying = true

    // Compute the strike position: 0.8 units from enemy, along player→enemy axis
    const fwd = this.battleEnemyPos.clone().sub(this.battlePlayerPos)
    fwd.y = 0
    fwd.normalize()
    const strikePos = this.battleEnemyPos.clone().addScaledVector(fwd, -this.strikeRange)
    strikePos.y = this.battlePlayerPos.y

    const originalPlayerPos = this.battlePlayerPos.clone()

    // Camera choreography sequence
    const sequence: BattleCameraShot[] = [
      {
        type: 'playerCloseUp',
        duration: 0.3,
        onComplete: () => {
          // Teleport player to strike range
          this.playerController!.setPosition(strikePos)
          this.cameraManager!.updateBattlePositions(strikePos, this.battleEnemyPos!)
        },
      },
      {
        type: 'attackAction',
        duration: 0.5,
        onStart: () => {
          // Play attack animation
          try { this.charAnimSystem.crossfadeTo('player', 'attack', 0.18) } catch (_) {}
        },
        onComplete: () => {
          // Apply damage
          this.performAttackDamage(npc)
          // Teleport player back to standing position
          this.playerController!.setPosition(originalPlayerPos)
          this.cameraManager!.updateBattlePositions(originalPlayerPos, this.battleEnemyPos!)
        },
      },
      {
        type: 'enemyCloseUp',
        duration: 0.5,
        onComplete: () => {
          this.attackSequencePlaying = false
          if (this.phase === 'ended') {
            // Enemy was defeated — stay on enemy close-up, overlay already shows result
            return
          }
          // Enemy counter-attacks
          this.resolveEnemyTurnWithCamera(`You hit ${npc.id} for ${this.lastDamageDealt}.`)
        },
      },
    ]

    this.cameraManager.battlePlaySequence(sequence)
  }

  /** Damage-only portion of the attack turn (no camera). */
  private lastDamageDealt = 0
  private performAttackDamage(npc: NPCInstance): void {
    const damage = 5 + Math.floor(Math.random() * 5)
    this.lastDamageDealt = damage
    this.enemyHP = Math.max(0, this.enemyHP - damage)

    if (this.enemyHP <= 0) {
      this.npcSystem.defeatNPC(npc.id)
      this.aiSystem.disengageFromPlayer(npc.id)
      this.phase = 'ended'
      this.statusText = `You hit ${npc.id} for ${damage}. ${npc.id} is defeated.`
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
    this.resolveEnemyTurn(`You brace for ${npc.id}'s counterattack.`)
  }

  private performItemAction(): void {
    this.statusText = 'Items are not available yet.'
    this.renderBattleOverlay()
  }

  private resolveEnemyTurn(prefix: string): void {
    const npc = this.npcSystem.getNPC(this.activeNpcId ?? '')
    if (!npc) {
      this.leaveBattle(true)
      return
    }

    const baseDamage = 4 + Math.floor(Math.random() * 4)
    const damage = this.guardActive ? Math.max(1, Math.floor(baseDamage * 0.5)) : baseDamage
    this.guardActive = false
    this.playerHP = Math.max(0, this.playerHP - damage)

    if (this.playerHP <= 0) {
      this.phase = 'ended'
      this.statusText = `${prefix} ${npc.id} strikes back for ${damage}. You were overwhelmed.`
      this.renderBattleOverlay()
      return
    }

    this.phase = 'player-turn'
    this.statusText = `${prefix} ${npc.id} counters for ${damage}. Choose your next action.`
    this.renderBattleOverlay()
  }

  /**
   * Enemy turn with camera choreography:
   * enemyCloseUp → establishing (attack) → playerCloseUp (reaction) → overShoulder
   */
  private resolveEnemyTurnWithCamera(prefix: string): void {
    const npc = this.npcSystem.getNPC(this.activeNpcId ?? '')
    if (!npc || !this.cameraManager) {
      this.resolveEnemyTurn(prefix)
      return
    }

    this.attackSequencePlaying = true

    const baseDamage = 4 + Math.floor(Math.random() * 4)
    const damage = this.guardActive ? Math.max(1, Math.floor(baseDamage * 0.5)) : baseDamage
    this.guardActive = false

    const sequence: BattleCameraShot[] = [
      {
        type: 'enemyCloseUp',
        duration: 0.3,
      },
      {
        type: 'establishing',
        duration: 0.4,
        onStart: () => {
          // Apply damage during the establishing shot
          this.playerHP = Math.max(0, this.playerHP - damage)
        },
      },
      {
        type: 'playerCloseUp',
        duration: 0.5,
        onStart: () => {
          // Show damage reaction
          if (this.playerHP <= 0) {
            this.phase = 'ended'
            this.statusText = `${prefix} ${npc.id} strikes back for ${damage}. You were overwhelmed.`
          } else {
            this.phase = 'player-turn'
            this.statusText = `${prefix} ${npc.id} counters for ${damage}. Choose your next action.`
          }
          this.renderBattleOverlay()
        },
      },
      {
        type: 'overShoulder',
        duration: 0.3,
        onComplete: () => {
          this.attackSequencePlaying = false
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
    this.battlePlayerPos = null
    this.battleEnemyPos = null
    this.restorePlayerPositionAfterBattle()
    this.playerController?.clearForcedFacingTarget()
    this.hideBattleOverlay()
    console.log(`⚔️ Battle end: npc=${resolvedNpcId ?? 'none'}, applyCooldown=${applyCooldown}, cameraModeBeforeExit=${this.cameraManager?.getCurrentMode() ?? 'none'}`)
    this.cameraManager?.exitBattleMode()
  }

  private syncBattleFacing(): void {
    if (!this.playerController || !this.activeNpcId) return
    const npc = this.npcSystem.getNPC(this.activeNpcId)
    if (!npc) return

    const playerPos = this.playerController.getPosition()
    this.playerController.setForcedFacingTarget(npc.position)

    const toPlayer = playerPos.clone().sub(npc.position)
    toPlayer.y = 0
    if (toPlayer.lengthSq() > 0.0001) {
      npc.rotation = Math.atan2(toPlayer.x, toPlayer.z)
    }
  }

  private stageBattlePositions(npc: NPCInstance): void {
    if (!this.playerController || this.stagedPlayerStartPosition) return

    const currentPlayerPos = this.playerController.getPosition()
    const toNpc = npc.position.clone().sub(currentPlayerPos)
    toNpc.y = 0

    if (toNpc.lengthSq() < 0.0001) {
      toNpc.set(0, 0, 1)
    } else {
      toNpc.normalize()
    }

    // Place combatants exactly battleStandingDistance apart, centered on the midpoint
    // between the current player position and NPC.
    const midpoint = currentPlayerPos.clone().lerp(npc.position, 0.5)
    midpoint.y = currentPlayerPos.y

    const halfDist = this.battleStandingDistance / 2
    const playerBattlePos = midpoint.clone().addScaledVector(toNpc, -halfDist)
    playerBattlePos.y = currentPlayerPos.y
    const enemyBattlePos = midpoint.clone().addScaledVector(toNpc, halfDist)
    enemyBattlePos.y = npc.position.y

    this.stagedPlayerStartPosition = currentPlayerPos.clone()
    this.battlePlayerPos = playerBattlePos.clone()
    this.battleEnemyPos = enemyBattlePos.clone()
    this.playerController.setPosition(playerBattlePos)

    console.log(
      `⚔️ Battle staging (${this.battleStandingDistance}u apart): player moved from ` +
      `(${currentPlayerPos.x.toFixed(2)}, ${currentPlayerPos.y.toFixed(2)}, ${currentPlayerPos.z.toFixed(2)}) ` +
      `to (${playerBattlePos.x.toFixed(2)}, ${playerBattlePos.y.toFixed(2)}, ${playerBattlePos.z.toFixed(2)}) | ` +
      `enemy at (${enemyBattlePos.x.toFixed(2)}, ${enemyBattlePos.y.toFixed(2)}, ${enemyBattlePos.z.toFixed(2)})`
    )
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

    if (this.phase === 'ended') {
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'KeyK' || e.code === 'KeyL') {
        e.preventDefault()
        this.leaveBattle(true)
      }
      return
    }

    if (e.code === 'Escape' || e.code === 'KeyL') {
      e.preventDefault()
      this.handleMenuAction('escape')
      return
    }

    if (this.phase !== 'player-turn') return

    if (e.code === 'KeyJ') {
      e.preventDefault()
      this.handleMenuAction('attack')
      return
    }

    if (e.code === 'KeyK') {
      e.preventDefault()
      this.handleMenuAction('guard')
      return
    }

    if (e.code === 'KeyI') {
      e.preventDefault()
      this.handleMenuAction('item')
      return
    }
  }

  private cycleChoice(dir: number): void {
    this.highlightedActionIndex =
      (this.highlightedActionIndex + dir + this.menuActions.length) % this.menuActions.length
    this.updateChoiceHighlight()
  }

  private renderBattleOverlay(): void {
    if (!this.overlayRoot || !this.overlayPanel) return

    this.applyOverlayLayout()

    this.overlayRoot.style.display = 'block'
    this.overlayPanel.style.display = 'block'
    if (this.overlayPrompt) this.overlayPrompt.style.display = 'none'

    const npc = this.activeNpcId ? this.npcSystem.getNPC(this.activeNpcId) : null
    if (this.overlayTitle) {
      this.overlayTitle.textContent = npc ? `Battle: ${npc.id}` : 'Battle'
    }

    if (this.overlayHP) {
      this.overlayHP.textContent = `Player ${this.playerHP}/${this.maxPlayerHP}   |   Enemy ${this.enemyHP}/${this.maxEnemyHP}`
    }

    if (this.overlayStatus) {
      this.overlayStatus.textContent = this.statusText
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
      const item = document.createElement('div')
      item.textContent = this.getActionDisplayText(action, index)
      item.style.cssText = `color:${index === this.highlightedActionIndex ? '#ff8f6b' : '#ffe7d8'};padding:${this.inputMode === 'touch' ? '10px 4px' : '4px 0'};font-size:${this.inputMode === 'touch' ? '18px' : '16px'};cursor:pointer;transition:color 0.15s;text-shadow:${this.inputMode === 'touch' ? '0 0 14px rgba(0,0,0,0.9)' : 'none'};pointer-events:auto;touch-action:manipulation;`
      item.addEventListener('mouseenter', () => {
        this.highlightedActionIndex = index
        this.updateChoiceHighlight()
      })
      item.addEventListener('pointerdown', (event) => {
        if (this.inputMode === 'touch' || (event as PointerEvent).pointerType === 'touch') {
          event.preventDefault()
          this.highlightedActionIndex = index
          this.updateChoiceHighlight()
        }
      })
      item.addEventListener('touchend', (event) => {
        event.preventDefault()
        this.highlightedActionIndex = index
        this.handleMenuAction(action.id)
      }, { passive: false })
      item.addEventListener('click', (event) => {
        if (this.inputMode === 'touch') {
          event.preventDefault()
          return
        }
        this.highlightedActionIndex = index
        this.handleMenuAction(action.id)
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
      el.style.color = index === this.highlightedActionIndex ? '#ff8f6b' : '#ffe7d8'
    })
  }

  private getActionDisplayText(action: BattleMenuAction, index: number): string {
    const bindingLabel = this.getActionBindingLabel(action.id)
    const label = bindingLabel ? `${bindingLabel}. ${action.label}` : action.label
    if (this.inputMode === 'touch') {
      return `${index === this.highlightedActionIndex ? '▶ ' : ''}${label}`
    }
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

    this.overlayPanel = document.createElement('div')
    this.overlayPanel.style.cssText =
      'position:absolute;bottom:0;left:0;right:0;padding:28px 32px 34px;display:none;pointer-events:auto;' +
      'background:linear-gradient(to top,rgba(24,6,4,0.94),rgba(52,12,8,0.72) 72%,transparent);'
    this.overlayRoot.appendChild(this.overlayPanel)

    this.overlayTitle = document.createElement('div')
    this.overlayTitle.style.cssText = 'color:#ff8f6b;font-size:18px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;'
    this.overlayPanel.appendChild(this.overlayTitle)

    this.overlayHP = document.createElement('div')
    this.overlayHP.style.cssText = 'color:#ffd9c7;font-size:14px;letter-spacing:1px;margin-bottom:10px;'
    this.overlayPanel.appendChild(this.overlayHP)

    this.overlayStatus = document.createElement('div')
    this.overlayStatus.style.cssText = 'color:#fff7f1;font-size:18px;line-height:1.45;max-width:760px;margin-bottom:16px;'
    this.overlayPanel.appendChild(this.overlayStatus)

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

  private getEngagePromptText(npcId: string): string {
    switch (this.inputMode) {
      case 'touch':
        return `FIGHT`
      case 'gamepad':
        return `X • Engage ${npcId}`
      default:
        return `Press J to engage ${npcId}`
    }
  }

  private getContinueHintText(): string {
    switch (this.inputMode) {
      case 'touch':
        return '[Tap to continue]'
      case 'gamepad':
        return '[Press A to return to gameplay]'
      default:
        return '[Press K / Return to return to gameplay]'
    }
  }

  private applyOverlayLayout(): void {
    if (!this.overlayPrompt || !this.overlayPanel || !this.overlayStatus || !this.overlayChoices) return

    if (this.inputMode === 'touch') {
      this.overlayPrompt.style.cssText =
        'position:absolute;left:50%;bottom:calc(60px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);' +
        'color:rgba(255,200,170,0.85);font-size:22px;letter-spacing:3px;display:none;text-align:center;' +
        'background:transparent;border:none;padding:10px 32px;' +
        'text-shadow:0 2px 18px rgba(0,0,0,0.95);pointer-events:auto;cursor:pointer;white-space:nowrap;touch-action:manipulation;'

      this.overlayPanel.style.cssText =
        'position:absolute;left:16px;right:16px;bottom:calc(48px + env(safe-area-inset-bottom, 0px));' +
        'padding:0;display:none;pointer-events:auto;background:transparent;'

      this.overlayStatus.style.cssText =
        'color:#fff7f1;font-size:18px;line-height:1.45;max-width:none;margin-bottom:16px;text-shadow:0 0 16px rgba(0,0,0,0.92);'

      this.overlayChoices.style.cssText = 'display:flex;flex-direction:column;gap:10px;max-width:none;pointer-events:auto;'
    } else {
      this.overlayPrompt.style.cssText =
        'position:absolute;bottom:168px;left:50%;transform:translateX(-50%);' +
        'background:rgba(36,8,4,0.7);border:1px solid rgba(255,143,107,0.45);' +
        'color:#fff2e8;padding:10px 18px;border-radius:8px;font-size:14px;letter-spacing:1px;display:none;'

      this.overlayPanel.style.cssText =
        'position:absolute;bottom:0;left:0;right:0;padding:28px 32px 34px;display:none;pointer-events:auto;' +
        'background:linear-gradient(to top,rgba(24,6,4,0.94),rgba(52,12,8,0.72) 72%,transparent);'

      this.overlayStatus.style.cssText = 'color:#fff7f1;font-size:18px;line-height:1.45;max-width:760px;margin-bottom:16px;'
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
    if (this.overlayPanel) this.overlayPanel.style.display = 'none'
    if (this.overlayRoot) this.overlayRoot.style.display = 'none'
  }

  private clearPromptState(): void {
    this.nearestBattleNpc = null
    this.hidePromptOverlay()
  }
}