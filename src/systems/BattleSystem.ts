import * as THREE from 'three'
import { NPCSystem, NPCInstance } from './NPCSystem'
import { NPCAISystem } from './NPCAISystem'
import { CharacterAnimationSystem } from './CharacterAnimationSystem'
import { CameraManager } from './CameraManager'
import type { PlayerController } from './PlayerController'
import type { DialogueManager } from './DialogueSystem'
import { logger, LogModule } from './Logger'

type BattlePhase = 'player-turn' | 'ended'

interface BattleMenuAction {
  id: 'attack' | 'guard' | 'escape'
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
  private stagedPlayerStartPosition: THREE.Vector3 | null = null

  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null

  private overlayRoot: HTMLDivElement | null = null
  private overlayPrompt: HTMLDivElement | null = null
  private overlayPanel: HTMLDivElement | null = null
  private overlayTitle: HTMLDivElement | null = null
  private overlayHP: HTMLDivElement | null = null
  private overlayStatus: HTMLDivElement | null = null
  private overlayChoices: HTMLDivElement | null = null
  private overlayEscape: HTMLButtonElement | null = null

  private readonly menuActions: BattleMenuAction[] = [
    { id: 'attack', label: 'Attack' },
    { id: 'guard', label: 'Guard' },
    { id: 'escape', label: 'Escape' },
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
      const promptText = `Press J / X / 🏹 to engage ${closest.id}`
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
    return this.startBattle(npcId, 'player')
  }

  handleConfirmActionButton(): boolean {
    if (!this.isActive) return false
    if (this.phase === 'ended') {
      this.leaveBattle(true)
      return true
    }

    const action = this.menuActions[this.highlightedActionIndex]
    if (!action) return true

    switch (action.id) {
      case 'attack':
        this.performAttackTurn()
        return true
      case 'guard':
        this.performGuardTurn()
        return true
      case 'escape':
        this.handleEscapeInput()
        return true
    }

    return true
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

    if (this.cameraManager) {
      console.log(`⚔️ Battle start: npc=${npcId}, trigger=${trigger}, cameraModeBefore=${this.cameraManager.getCurrentMode()}`)
      this.cameraManager.enterBattleMode(this.playerController.getPosition(), npc.position)
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

    const damage = 5 + Math.floor(Math.random() * 5)
    this.enemyHP = Math.max(0, this.enemyHP - damage)
    try { this.charAnimSystem.crossfadeTo('player', 'attack', 0.18) } catch (_) {}

    if (this.enemyHP <= 0) {
      this.npcSystem.defeatNPC(npc.id)
      this.aiSystem.disengageFromPlayer(npc.id)
      this.phase = 'ended'
      this.statusText = `You hit ${npc.id} for ${damage}. ${npc.id} is defeated.`
      this.renderBattleOverlay()
      return
    }

    this.resolveEnemyTurn(`You hit ${npc.id} for ${damage}.`)
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
    const pushDir = currentPlayerPos.clone().sub(npc.position)
    pushDir.y = 0

    if (pushDir.lengthSq() < 0.0001) {
      pushDir.set(0, 0, 1)
    } else {
      pushDir.normalize()
    }

    const stagedPosition = currentPlayerPos.clone().addScaledVector(pushDir, 1.75)
    stagedPosition.y = currentPlayerPos.y

    this.stagedPlayerStartPosition = currentPlayerPos.clone()
    this.playerController.setPosition(stagedPosition)

    console.log(
      `⚔️ Battle staging: player moved from (${currentPlayerPos.x.toFixed(2)}, ${currentPlayerPos.y.toFixed(2)}, ${currentPlayerPos.z.toFixed(2)}) ` +
      `to (${stagedPosition.x.toFixed(2)}, ${stagedPosition.y.toFixed(2)}, ${stagedPosition.z.toFixed(2)}) while NPC stayed at ` +
      `(${npc.position.x.toFixed(2)}, ${npc.position.y.toFixed(2)}, ${npc.position.z.toFixed(2)})`
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

    if (e.code === 'Escape') {
      e.preventDefault()
      this.handleEscapeInput()
      return
    }

    if (this.phase !== 'player-turn') return

    if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault()
      this.cycleChoice(-1)
      return
    }

    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault()
      this.cycleChoice(1)
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
      hint.textContent = '[Press Space / A to return to gameplay]'
      hint.style.cssText = 'color:#ffd866;font-size:14px;padding-top:8px;'
      this.overlayChoices.appendChild(hint)
      return
    }

    this.menuActions.forEach((action, index) => {
      const item = document.createElement('div')
      item.textContent = `${index === this.highlightedActionIndex ? '▶ ' : ''}${index + 1}. ${action.label}`
      item.style.cssText = `color:${index === this.highlightedActionIndex ? '#ff8f6b' : '#ffe7d8'};padding:4px 0;font-size:16px;cursor:pointer;transition:color 0.15s;`
      item.addEventListener('mouseenter', () => {
        this.highlightedActionIndex = index
        this.updateChoiceHighlight()
      })
      item.addEventListener('click', () => {
        this.highlightedActionIndex = index
        this.handleConfirmActionButton()
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
      el.textContent = `${index === this.highlightedActionIndex ? '▶ ' : ''}${index + 1}. ${action.label}`
      el.style.color = index === this.highlightedActionIndex ? '#ff8f6b' : '#ffe7d8'
    })
  }

  private buildOverlayUI(): void {
    this.overlayRoot = document.createElement('div')
    this.overlayRoot.id = 'battle-overlay'
    this.overlayRoot.style.cssText =
      'position:fixed;inset:0;z-index:10000;pointer-events:none;display:none;font-family:"Courier New",monospace;'

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

    this.overlayEscape = document.createElement('button')
    this.overlayEscape.textContent = 'Retreat'
    this.overlayEscape.style.cssText =
      'margin-top:16px;padding:8px 14px;border:1px solid rgba(255,255,255,0.25);border-radius:999px;' +
      'background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;pointer-events:auto;'
    this.overlayEscape.addEventListener('click', () => {
      this.handleEscapeInput()
    })
    this.overlayPanel.appendChild(this.overlayEscape)

    document.body.appendChild(this.overlayRoot)
  }

  private showPromptOverlay(text: string): void {
    if (!this.overlayRoot || !this.overlayPrompt) return
    this.overlayRoot.style.display = 'block'
    this.overlayPrompt.style.display = 'block'
    this.overlayPrompt.textContent = text
    this.promptVisible = true
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