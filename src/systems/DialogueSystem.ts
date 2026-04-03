import * as THREE from 'three'
import { NPCSystem, NPCInstance } from './NPCSystem'
import { NPCAISystem } from './NPCAISystem'
import { CharacterAnimationSystem } from './CharacterAnimationSystem'
import { CameraManager } from './CameraManager'
import { logger, LogModule } from './Logger'
import { traceInputCommand, type InputTraceSource } from './InputTrace'

type ActiveInputMode = 'touch' | 'gamepad' | 'keyboard' | 'mouse'

// ============================================================================
// DIALOGUE TREE — data-driven conversation system
//
// Features:
//   • Tree-structured dialogue nodes with player choices
//   • Condition-based branching (flags, NPC class, item possession)
//   • Side effects (set flags, trigger animations, give items)
//   • Proximity trigger for starting conversations
//   • Keyboard / UI interaction prompt
//   • Callbacks for HUD / UI integration
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

export type DialogueChoiceTag = 'aggressive' | 'mercantile' | 'neutral' | 'escape'

export interface DialogueChoice {
  /** Text shown to the player */
  text: string
  /** ID of the next DialogueNode to jump to */
  nextNodeId?: string
  /** Optional condition — choice is only shown when this returns true */
  condition?: () => boolean
  /** Optional side effect fired when the player picks this choice */
  onSelect?: () => void
  /** Semantic tag for color-coding the choice */
  tag?: DialogueChoiceTag
}

export interface DialogueNode {
  /** Unique ID within the tree */
  id: string
  /** NPC's spoken line */
  text: string
  /** Optional speaker name override (defaults to NPC id) */
  speaker?: string
  /** Player choices; if empty the dialogue ends after this node */
  choices: DialogueChoice[]
  /** Animation the NPC plays while speaking (defaults to 'talking') */
  animation?: string
  /** Side-effect callback fired when this node is entered */
  onEnter?: () => void
  /** If true, the dialogue ends after this node (ignores choices) */
  isTerminal?: boolean
}

export interface DialogueTree {
  /** Unique tree identifier */
  id: string
  /** Map of node id → node */
  nodes: Map<string, DialogueNode>
  /** ID of the starting node */
  startNodeId: string
}

/**
 * Callbacks the game provides so the dialogue system can
 * drive UI without depending on DOM directly.
 */
export interface DialogueUICallbacks {
  /** Show dialogue box with NPC line + player choices */
  showDialogue: (speaker: string, text: string, choices: { text: string; index: number }[]) => void
  /** Hide the dialogue box */
  hideDialogue: () => void
  /** Show interaction prompt ("Press E to talk") */
  showPrompt: (text: string) => void
  /** Hide the prompt */
  hidePrompt: () => void
}

// ============================================================================
// DIALOGUE MANAGER
// ============================================================================

export class DialogueManager {
  private npcSystem: NPCSystem
  private aiSystem: NPCAISystem
  private charAnimSystem: CharacterAnimationSystem
  private cameraManager: CameraManager | null = null
  private trees: Map<string, DialogueTree> = new Map()
  private npcDialogueMap: Map<string, string> = new Map() // npcId → treeId
  private uiCallbacks: DialogueUICallbacks | null = null

  // — runtime state —
  private activeNpcId: string | null = null
  private activeTree: DialogueTree | null = null
  private activeNodeId: string | null = null
  private isActive: boolean = false
  private terminalTimeout: ReturnType<typeof setTimeout> | null = null

  // — interaction trigger —
  private interactionRange: number = 3.5
  private autoTriggerRange: number = 2.2
  private promptVisible: boolean = false
  private nearestInteractableNpc: string | null = null

  // global dialogue flags (persist across conversations)
  private flags: Map<string, any> = new Map()

  // key listener
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null
  private pauseChecker: (() => boolean) | null = null

  // — built-in dialogue overlay DOM —
  private overlayRoot: HTMLDivElement | null = null
  private overlayBox: HTMLDivElement | null = null
  private overlayTopBox: HTMLDivElement | null = null
  private overlayPrompt: HTMLDivElement | null = null
  private overlaySpeaker: HTMLDivElement | null = null
  private overlayText: HTMLDivElement | null = null
  private overlayChoices: HTMLDivElement | null = null
  private currentVisibleChoices: DialogueChoice[] = []
  private highlightedChoiceIndex: number = 0
  private inputMode: ActiveInputMode = 'keyboard'
  private pendingBattleNpcId: string | null = null

  // ── Cluster (multi-NPC) support ──
  private clusterNpcIds: string[] = []
  private selectedClusterIndex = 0

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

  // --------------------------------------------------------------------------
  // SETUP
  // --------------------------------------------------------------------------

  /** Provide a function that returns true when the game is paused.
   *  handleKey will be a no-op while paused, preventing dialogue from advancing behind the pause overlay. */
  setPauseChecker(fn: () => boolean): void {
    this.pauseChecker = fn
  }

  /** Link the camera manager so dialogue can drive camera transitions. */
  setCameraManager(cam: CameraManager): void {
    this.cameraManager = cam
  }

  /** Provide UI callbacks so the dialogue system can show/hide prompts. */
  setUICallbacks(callbacks: DialogueUICallbacks): void {
    this.uiCallbacks = callbacks
  }

  setInputMode(mode: ActiveInputMode): void {
    this.inputMode = mode
    this.applyOverlayLayout()
    if (this.promptVisible && this.nearestInteractableNpc) {
      this.showPromptOverlay(this.getInteractionPromptText(this.nearestInteractableNpc))
    }
    if (this.isActive) {
      this.refreshOverlayContent()
    }
  }

  /** Start listening for interaction key (E). */
  enable(): void {
    if (this.boundKeyDown) return
    this.boundKeyDown = (e: KeyboardEvent) => this.handleKey(e)
    document.addEventListener('keydown', this.boundKeyDown)
  }

  /** Stop listening. */
  disable(): void {
    if (this.boundKeyDown) {
      document.removeEventListener('keydown', this.boundKeyDown)
      this.boundKeyDown = null
    }
    this.endDialogue()
  }

  // --------------------------------------------------------------------------
  // TREE REGISTRATION
  // --------------------------------------------------------------------------

  /** Register a dialogue tree and optionally bind it to an NPC. */
  registerTree(tree: DialogueTree, npcId?: string): void {
    this.trees.set(tree.id, tree)
    if (npcId) {
      this.npcDialogueMap.set(npcId, tree.id)
    }
  }

  /** Assign an already-registered tree to a specific NPC. */
  assignTreeToNPC(npcId: string, treeId: string): void {
    this.npcDialogueMap.set(npcId, treeId)
  }

  // --------------------------------------------------------------------------
  // FLAGS
  // --------------------------------------------------------------------------

  setFlag(key: string, value: any = true): void { this.flags.set(key, value) }
  getFlag(key: string): any { return this.flags.get(key) }
  hasFlag(key: string): boolean { return this.flags.has(key) }

  // --------------------------------------------------------------------------
  // UPDATE — call every frame (handles proximity prompt)
  // --------------------------------------------------------------------------

  update(playerPosition: THREE.Vector3): void {
    if (this.isActive) return // already in dialogue
    // Don't start new dialogues while camera is fading between modes
    if (this.cameraManager?.isFading()) return

    // Find closest interactable NPC
    const candidates = this.aiSystem.getInteractableNPCs(this.interactionRange)
    let closest: NPCInstance | null = null
    let closestDist = Infinity
    for (const npc of candidates) {
      if (!this.npcDialogueMap.has(npc.id)) continue // no dialogue tree assigned
      if (this.npcSystem.isInteractionOnCooldown(npc.id)) continue
      if (npc.npcClass === 'red' && this.npcSystem.isHostile(npc.id)) continue
      const d = npc.position.distanceTo(playerPosition)
      if (d < closestDist) {
        closestDist = d
        closest = npc
      }
    }

    if (closest && closest.npcClass === 'red' && closestDist <= this.autoTriggerRange) {
      this.nearestInteractableNpc = closest.id
      this.startDialogue(closest.id)
      return
    }

    if (closest) {
      if (this.nearestInteractableNpc !== closest.id) {
        this.nearestInteractableNpc = closest.id
        const promptText = this.getInteractionPromptText(closest.id)
        this.uiCallbacks?.showPrompt(promptText)
        this.showPromptOverlay(promptText)
        this.promptVisible = true
      }
    } else {
      if (this.promptVisible) {
        this.uiCallbacks?.hidePrompt()
        this.hidePromptOverlay()
        this.promptVisible = false
        this.nearestInteractableNpc = null
      }
    }
  }

  // --------------------------------------------------------------------------
  // KEY HANDLER
  // --------------------------------------------------------------------------

  private handleKey(e: KeyboardEvent): void {
    if (!this.isActive) return
    if (this.pauseChecker?.()) return

    // During active dialogue: W/S or arrows move the highlighted choice.
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

    if (e.code === 'KeyJ') {
      e.preventDefault()
      this.handleConfirmInput('keyboard')
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

    if (e.code === 'KeyL' || e.code === 'Escape') {
      e.preventDefault()
      this.handleCancelInput('keyboard')
      return
    }

    // Number keys 1-9 pick a choice directly
    if (e.code.startsWith('Digit')) {
      const digit = parseInt(e.code.replace('Digit', ''), 10)
      if (digit >= 1 && digit <= 9) {
        this.selectChoice(digit - 1, 'keyboard')
      }
    }
  }

  /** Move the highlighted choice indicator up or down. */
  private cycleChoice(dir: number): void {
    if (this.currentVisibleChoices.length === 0) return
    this.highlightedChoiceIndex =
      (this.highlightedChoiceIndex + dir + this.currentVisibleChoices.length) %
      this.currentVisibleChoices.length
    this.updateChoiceHighlight()
  }

  /** Refresh the DOM highlight to match highlightedChoiceIndex. */
  private updateChoiceHighlight(): void {
    if (!this.overlayChoices) return
    const items = this.overlayChoices.children
    for (let i = 0; i < items.length; i++) {
      const el = items[i] as HTMLElement
      const tag = this.currentVisibleChoices[i]?.tag
      if (i === this.highlightedChoiceIndex) {
        const color = this.getChoiceColor(tag, true)
        el.style.color = color
        el.style.borderColor = color
        el.textContent = el.textContent?.replace(/^\d+\./, `▶ ${i + 1}.`) ?? ''
      } else {
        const color = this.getChoiceColor(tag, false)
        el.style.color = color
        el.style.borderColor = color
        el.textContent = el.textContent?.replace(/^▶ /, '') ?? ''
      }
    }
  }

  public getChoiceCount(): number {
    return this.currentVisibleChoices.length
  }

  public setHighlightedChoice(index: number): void {
    if (this.currentVisibleChoices.length === 0) return
    this.highlightedChoiceIndex = Math.max(0, Math.min(index, this.currentVisibleChoices.length - 1))
    this.updateChoiceHighlight()
  }

  // --------------------------------------------------------------------------
  // DIALOGUE FLOW
  // --------------------------------------------------------------------------

  private getDialogueStartBlockReason(npcId: string): string | null {
    const treeId = this.npcDialogueMap.get(npcId)
    if (!treeId || !this.trees.has(treeId)) return 'missing-dialogue-tree'
    if (this.isActive) return 'dialogue-already-active'
    if (this.npcSystem.isInteractionOnCooldown(npcId)) return 'interaction-cooldown'
    if (this.cameraManager?.isFading()) return 'camera-fading'
    if (this.cameraManager?.isInDialogueMode()) return 'camera-dialogue-mode'
    if (this.cameraManager?.isInBattleMode()) return 'camera-battle-mode'
    return null
  }

  startDialogue(npcId: string): void {
    const blockReason = this.getDialogueStartBlockReason(npcId)
    if (blockReason) return

    const treeId = this.npcDialogueMap.get(npcId)
    if (!treeId) return
    const tree = this.trees.get(treeId)
    if (!tree) return

    this.activeNpcId = npcId
    this.activeTree = tree
    this.isActive = true

    // ── Form cluster: nearby same-class NPCs join, others flee ──
    this.clusterNpcIds = this.aiSystem.formCluster(npcId, 'dialogue')
      .filter(id => this.npcDialogueMap.has(id)) // only include NPCs with dialogue trees
    if (!this.clusterNpcIds.includes(npcId)) this.clusterNpcIds.unshift(npcId)
    this.selectedClusterIndex = 0

    this.uiCallbacks?.hidePrompt()
    this.hidePromptOverlay()
    this.promptVisible = false

    // Face NPC toward player (handled by AI) and play talking anim
    this.aiSystem.playAnimation(npcId, 'talking', false)

    // Transition camera to dialogue frontal shot
    const npc = this.npcSystem.getNPC(npcId)
    if (npc && this.cameraManager) {
      console.log(`💬 Dialogue start: npc=${npcId}, cameraModeBefore=${this.cameraManager.getCurrentMode()}`)
      this.cameraManager.enterDialogueMode(npc.position, npc.rotation)
    }

    this.goToNode(tree.startNodeId)
    logger.info(LogModule.SYSTEM, `Dialogue started with NPC "${npcId}" tree="${treeId}"`)
  }

  private goToNode(nodeId: string): void {
    if (!this.activeTree) return
    const node = this.activeTree.nodes.get(nodeId)
    if (!node) {
      logger.warn(LogModule.SYSTEM, `Dialogue node "${nodeId}" not found — ending dialogue`)
      this.endDialogue()
      return
    }

    this.activeNodeId = nodeId
    node.onEnter?.()

    // Play node-specific animation
    if (node.animation && this.activeNpcId) {
      this.aiSystem.playAnimation(this.activeNpcId, node.animation, false)
    }

    // Filter visible choices by condition
    const visibleChoices = node.choices
      .map((c, i) => ({ ...c, index: i }))
      .filter(c => !c.condition || c.condition())

    const speaker = node.speaker ?? this.activeNpcId ?? 'NPC'

    if (node.isTerminal || visibleChoices.length === 0) {
      // Terminal node — show text, wait for action button to end
      this.uiCallbacks?.showDialogue(speaker, node.text, [])
      this.showDialogueOverlay(speaker, node.text, [])
      this.currentVisibleChoices = []
      this.highlightedChoiceIndex = 0
      return
    }

    this.currentVisibleChoices = visibleChoices
    this.highlightedChoiceIndex = 0
    this.uiCallbacks?.showDialogue(
      speaker,
      node.text,
      visibleChoices.map((c, i) => ({ text: c.text, index: i })),
    )
    this.showDialogueOverlay(
      speaker,
      node.text,
      visibleChoices.map((c, i) => ({ text: c.text, index: i, tag: c.tag })),
    )
  }

  selectChoice(index: number, source: InputTraceSource = 'system'): void {
    if (!this.activeTree || !this.activeNodeId) {
      traceInputCommand({ source, target: 'dialogue', command: 'select-choice', result: 'ignored' })
      return
    }
    const node = this.activeTree.nodes.get(this.activeNodeId)
    if (!node) {
      traceInputCommand({ source, target: 'dialogue', command: 'select-choice', result: 'ignored' })
      return
    }

    const visibleChoices = node.choices.filter(c => !c.condition || c.condition())
    if (index < 0 || index >= visibleChoices.length) {
      traceInputCommand({
        source,
        target: 'dialogue',
        command: 'select-choice',
        result: 'ignored',
        details: { index, visibleChoiceCount: visibleChoices.length }
      })
      return
    }

    const choice = visibleChoices[index]
    traceInputCommand({
      source,
      target: 'dialogue',
      command: 'select-choice',
      result: 'executed',
      details: { index, text: choice.text, nextNodeId: choice.nextNodeId ?? null }
    })
    choice.onSelect?.()
    if (!this.isActive) return
    if (!choice.nextNodeId) {
      this.endDialogue()
      return
    }
    this.goToNode(choice.nextNodeId)
  }

  endDialogue(): void {
    if (this.terminalTimeout) { clearTimeout(this.terminalTimeout); this.terminalTimeout = null }

    const npcId = this.activeNpcId
    if (npcId) {
      // Return NPC to idle
      try { this.charAnimSystem.crossfadeTo(npcId, 'idle', 0.4) } catch (_) {}
      // Set interaction cooldown to prevent immediate re-trigger (critical on mobile)
      this.npcSystem.setInteractionCooldown(npcId, 2000)
    }

    // Release cluster NPCs back to AI
    if (this.clusterNpcIds.length > 0) {
      this.aiSystem.releaseCluster(this.clusterNpcIds)
    }
    this.clusterNpcIds = []
    this.selectedClusterIndex = 0

    this.currentVisibleChoices = []
    this.uiCallbacks?.hideDialogue()
    this.hideDialogueOverlay()
    this.promptVisible = false
    this.nearestInteractableNpc = null

    // Return camera to gameplay BEFORE clearing active state,
    // so exitDialogueMode sees currentMode === 'dialogue'
    if (this.cameraManager) {
      console.log(`💬 Dialogue end: npc=${npcId ?? 'none'}, cameraModeBeforeExit=${this.cameraManager.getCurrentMode()}`)
      this.cameraManager.exitDialogueMode()
    }

    // Clear active state AFTER camera exit is initiated
    this.isActive = false
    this.activeTree = null
    this.activeNodeId = null
    this.activeNpcId = null

    const pendingBattleNpcId = this.pendingBattleNpcId
    this.pendingBattleNpcId = null

    window.dispatchEvent(new CustomEvent('dialogue-ended', {
      detail: {
        npcId,
        scriptedBattleQueued: pendingBattleNpcId !== null,
      },
    }))

    if (pendingBattleNpcId) {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('dialogue-to-battle', {
          detail: { npcId: pendingBattleNpcId },
        }))
      }, 320)
    }
  }

  queueBattleAfterDialogue(npcId: string): void {
    this.pendingBattleNpcId = npcId
  }

  /** Whether a dialogue is currently in progress. */
  isDialogueActive(): boolean {
    return this.isActive
  }

  /** The NPC currently being talked to. */
  getActiveNpcId(): string | null {
    return this.activeNpcId
  }

  /** Whether an interactable NPC is within range right now. */
  hasNearbyInteractableNPC(): boolean {
    return this.nearestInteractableNpc !== null
  }

  /** Hide the proximity prompt when another modal system takes over the screen. */
  hideInteractionPrompt(): void {
    this.uiCallbacks?.hidePrompt()
    this.hidePromptOverlay()
    this.promptVisible = false
    this.nearestInteractableNpc = null
  }

  /**
   * Called by PlayerController when the action button is pressed.
   * Returns true if the dialogue system consumed the input.
   */
  handleActionButton(source: InputTraceSource = 'system'): boolean {
    // Start dialogue if near an NPC
    if (!this.isActive) {
      if (this.nearestInteractableNpc) {
        const blockReason = this.getDialogueStartBlockReason(this.nearestInteractableNpc)
        if (blockReason) {
          traceInputCommand({
            source,
            target: 'dialogue',
            command: 'talk',
            result: 'blocked',
            details: { npcId: this.nearestInteractableNpc, reason: blockReason }
          })
          return false
        }
        traceInputCommand({
          source,
          target: 'dialogue',
          command: 'talk',
          result: 'consumed',
          details: { npcId: this.nearestInteractableNpc }
        })
        this.startDialogue(this.nearestInteractableNpc)
        return true
      }
      traceInputCommand({ source, target: 'dialogue', command: 'talk', result: 'ignored' })
      return false
    }

    // Dialogue is active — determine what to do
    const node = this.activeTree?.nodes.get(this.activeNodeId ?? '')
    if (!node) {
      traceInputCommand({ source, target: 'dialogue', command: 'confirm', result: 'executed', details: { reason: 'missing-node' } })
      this.endDialogue()
      return true
    }

    // Terminal node or no choices → end dialogue
    if (node.isTerminal || this.currentVisibleChoices.length === 0) {
      traceInputCommand({
        source,
        target: 'dialogue',
        command: 'confirm',
        result: 'executed',
        details: { terminal: true, activeNodeId: this.activeNodeId }
      })
      this.endDialogue()
      return true
    }

    // Has choices → select the currently highlighted choice
    if (this.currentVisibleChoices.length > 0) {
      this.selectChoice(this.highlightedChoiceIndex, source)
      return true
    }

    return true
  }

  public handleNavigateInput(dir: number, source: InputTraceSource = 'system'): boolean {
    if (!this.isActive || this.currentVisibleChoices.length === 0) {
      traceInputCommand({
        source,
        target: 'dialogue',
        command: dir < 0 ? 'navigate-up' : 'navigate-down',
        result: 'ignored',
        details: { isActive: this.isActive, choiceCount: this.currentVisibleChoices.length }
      })
      return false
    }
    this.cycleChoice(dir)
    traceInputCommand({
      source,
      target: 'dialogue',
      command: dir < 0 ? 'navigate-up' : 'navigate-down',
      result: 'consumed',
      details: { highlightedChoiceIndex: this.highlightedChoiceIndex }
    })
    return true
  }

  public handleConfirmInput(source: InputTraceSource = 'system'): boolean {
    return this.handleActionButton(source)
  }

  public handleCancelInput(source: InputTraceSource = 'system'): boolean {
    if (!this.isActive) {
      traceInputCommand({ source, target: 'dialogue', command: 'cancel', result: 'ignored' })
      return false
    }
    traceInputCommand({ source, target: 'dialogue', command: 'cancel', result: 'executed', details: { activeNodeId: this.activeNodeId } })
    this.endDialogue()
    return true
  }

  /**
   * Cycle the cluster NPC selection (left/right) during dialogue.
   * Switches the active NPC and restarts their dialogue tree.
   * Returns true if input was consumed.
   */
  public handleClusterNavigate(dir: number, source: InputTraceSource = 'system'): boolean {
    if (!this.isActive || this.clusterNpcIds.length <= 1) {
      traceInputCommand({ source, target: 'dialogue', command: dir > 0 ? 'cluster-right' : 'cluster-left', result: 'ignored' })
      return false
    }
    this.selectedClusterIndex =
      (this.selectedClusterIndex + dir + this.clusterNpcIds.length) % this.clusterNpcIds.length
    const newNpcId = this.clusterNpcIds[this.selectedClusterIndex]

    // Return previous NPC to idle
    if (this.activeNpcId) {
      try { this.charAnimSystem.crossfadeTo(this.activeNpcId, 'idle', 0.3) } catch (_) {}
    }

    // Switch to the new NPC's dialogue tree
    const treeId = this.npcDialogueMap.get(newNpcId)
    const tree = treeId ? this.trees.get(treeId) : undefined
    if (!tree) {
      traceInputCommand({ source, target: 'dialogue', command: dir > 0 ? 'cluster-right' : 'cluster-left', result: 'ignored', details: { reason: 'no-tree' } })
      return true
    }

    this.activeNpcId = newNpcId
    this.activeTree = tree
    this.aiSystem.playAnimation(newNpcId, 'talking', false)

    // Update camera to face the new NPC (smooth update, no fade)
    const npc = this.npcSystem.getNPC(newNpcId)
    if (npc && this.cameraManager) {
      this.cameraManager.updateDialogueTarget(npc.position, npc.rotation)
    }

    this.goToNode(tree.startNodeId)

    traceInputCommand({
      source, target: 'dialogue',
      command: dir > 0 ? 'cluster-right' : 'cluster-left',
      result: 'consumed',
      details: { selectedNpc: newNpcId, index: this.selectedClusterIndex, total: this.clusterNpcIds.length }
    })
    return true
  }

  /** How many NPCs are in the current dialogue cluster. */
  public getClusterSize(): number {
    return this.clusterNpcIds.length
  }

  // --------------------------------------------------------------------------
  // TREE BUILDER HELPERS — convenient for programmatic tree construction
  // --------------------------------------------------------------------------

  static createTree(id: string, startNodeId: string, nodes: DialogueNode[]): DialogueTree {
    const nodeMap = new Map<string, DialogueNode>()
    for (const node of nodes) {
      nodeMap.set(node.id, node)
    }
    return { id, nodes: nodeMap, startNodeId }
  }

  static node(
    id: string,
    text: string,
    choices: DialogueChoice[] = [],
    opts?: { speaker?: string; animation?: string; onEnter?: () => void; isTerminal?: boolean },
  ): DialogueNode {
    return { id, text, choices, ...opts }
  }

  static choice(text: string, nextNodeId?: string, condition?: () => boolean, onSelect?: () => void, tag?: DialogueChoiceTag): DialogueChoice {
    return { text, nextNodeId, condition, onSelect, tag }
  }

  // --------------------------------------------------------------------------
  // BUILT-IN DIALOGUE OVERLAY UI
  // --------------------------------------------------------------------------

  private buildOverlayUI(): void {
    // Root container — full-screen overlay, hidden by default
    this.overlayRoot = document.createElement('div')
    this.overlayRoot.id = 'dialogue-overlay'
    this.overlayRoot.style.cssText =
      'position:fixed;inset:0;z-index:12100;pointer-events:none;display:none;' +
      'font-family:"Courier New",monospace;'

    // Prompt bubble ("Press Space to talk")
    this.overlayPrompt = document.createElement('div')
    this.overlayPrompt.style.cssText =
      'position:absolute;bottom:120px;left:50%;transform:translateX(-50%);' +
      'background:rgba(0,0,0,0.55);color:#fff;padding:8px 20px;border-radius:6px;' +
      'font-size:14px;letter-spacing:1px;white-space:nowrap;display:none;pointer-events:none;'
    this.overlayRoot.appendChild(this.overlayPrompt)

    // Top box — NPC speaker name + spoken text (centred at top of viewport)
    const topBox = document.createElement('div')
    topBox.id = 'dialogue-top-box'
    topBox.style.cssText =
      'position:absolute;top:0;left:0;right:0;' +
      'background:linear-gradient(to bottom,rgba(0,0,0,0.82),rgba(0,0,0,0.45) 90%,transparent);' +
      'padding:28px 32px 24px;display:none;pointer-events:none;text-align:center;'
    this.overlayTopBox = topBox
    this.overlayRoot.appendChild(topBox)

    // Speaker name
    this.overlaySpeaker = document.createElement('div')
    this.overlaySpeaker.style.cssText =
      'color:#ffd866;font-size:16px;font-weight:bold;margin-bottom:8px;text-transform:uppercase;letter-spacing:2px;'
    topBox.appendChild(this.overlaySpeaker)

    // NPC text
    this.overlayText = document.createElement('div')
    this.overlayText.style.cssText =
      'color:#eee;font-size:18px;line-height:1.5;max-width:700px;margin:0 auto;'
    topBox.appendChild(this.overlayText)

    // Bottom box — player choices only
    const choicesBox = document.createElement('div')
    choicesBox.id = 'dialogue-box'
    choicesBox.style.cssText =
      'position:absolute;bottom:0;left:0;right:0;' +
      'background:linear-gradient(to top,rgba(0,0,0,0.82),rgba(0,0,0,0.45) 90%,transparent);' +
      'padding:24px 32px 32px;display:none;pointer-events:auto;'
    this.overlayBox = choicesBox
    this.overlayRoot.appendChild(choicesBox)

    // Choices list
    this.overlayChoices = document.createElement('div')
    this.overlayChoices.style.cssText = 'display:flex;flex-direction:column;gap:6px;'
    choicesBox.appendChild(this.overlayChoices)

    document.body.appendChild(this.overlayRoot)
    this.applyOverlayLayout()
  }

  private isTouchInputMode(): boolean {
    return this.inputMode === 'touch'
  }

  private getInteractionPromptText(_npcId: string): string {
    switch (this.inputMode) {
      case 'touch':
        return 'TALK'
      case 'gamepad':
        return 'A. TALK'
      default:
        return 'J. TALK'
    }
  }

  private getContinueHintText(): string {
    switch (this.inputMode) {
      case 'touch':
        return '[Tap to continue]'
      case 'gamepad':
        return '[Press A to continue]'
      default:
        return '[Press J to continue]'
    }
  }

  private getChoiceColor(tag: DialogueChoiceTag | undefined, highlighted: boolean): string {
    switch (tag) {
      case 'aggressive': return highlighted ? '#ff9d9d' : '#ff6b6b'
      case 'mercantile': return highlighted ? '#a9d8ff' : '#66b7ff'
      case 'neutral':    return highlighted ? '#baffc9' : '#7CFC98'
      case 'escape':     return highlighted ? '#fff1a8' : '#ffd866'
      default:           return highlighted ? '#ffd866' : '#aee'
    }
  }

  private getPromptAccentColor(): string {
    return '#7CFC98'
  }

  private applyOverlayLayout(): void {
    if (!this.overlayRoot || !this.overlayPrompt || !this.overlayBox || !this.overlayTopBox || !this.overlayText || !this.overlayChoices) return

    const promptColor = this.getPromptAccentColor()

    if (this.isTouchInputMode()) {
      this.overlayPrompt.style.cssText =
        'position:absolute;right:16px;bottom:calc(56px + env(safe-area-inset-bottom, 0px));transform:none;' +
        `color:${promptColor};font-size:18px;letter-spacing:2px;display:none;pointer-events:auto;` +
        'text-align:right;text-shadow:0 2px 18px rgba(0,0,0,0.95);background:transparent;' +
        'border:none;padding:10px 18px;cursor:pointer;touch-action:manipulation;' +
        'max-width:calc(50vw - 28px);line-height:1.1;white-space:normal;'

      this.overlayTopBox.style.cssText =
        'position:absolute;top:0;left:0;right:0;' +
        'background:linear-gradient(to bottom,rgba(0,0,0,0.82),rgba(0,0,0,0.45) 90%,transparent);' +
        'padding:env(safe-area-inset-top,12px) 20px 20px;display:none;pointer-events:none;text-align:center;'

      this.overlayBox.style.cssText =
        'position:absolute;left:16px;right:16px;bottom:calc(48px + env(safe-area-inset-bottom, 0px));' +
        'display:none;pointer-events:auto;background:transparent;padding:0;'

      this.overlayText.style.cssText =
        'color:#eefcff;font-size:18px;line-height:1.5;max-width:none;text-shadow:0 0 16px rgba(0,0,0,0.92);margin:0 auto;'

      this.overlayChoices.style.cssText = 'display:flex;flex-direction:column;gap:10px;max-width:none;pointer-events:auto;'
    } else {
      this.overlayPrompt.style.cssText =
        'position:absolute;right:20px;bottom:28px;transform:none;' +
        `color:${promptColor};font-size:18px;letter-spacing:2px;white-space:nowrap;display:none;pointer-events:none;` +
        'text-align:right;text-shadow:0 2px 18px rgba(0,0,0,0.95);background:transparent;border:none;padding:0;'

      this.overlayTopBox.style.cssText =
        'position:absolute;top:0;left:0;right:0;' +
        'background:linear-gradient(to bottom,rgba(0,0,0,0.82),rgba(0,0,0,0.45) 90%,transparent);' +
        'padding:28px 32px 24px;display:none;pointer-events:none;text-align:center;'

      this.overlayBox.style.cssText =
        'position:absolute;bottom:0;left:0;right:0;' +
        'background:linear-gradient(to top,rgba(0,0,0,0.82),rgba(0,0,0,0.45) 90%,transparent);' +
        'padding:24px 32px 32px;display:none;pointer-events:auto;'

      this.overlayText.style.cssText =
        'color:#eee;font-size:18px;line-height:1.5;max-width:700px;margin:0 auto;'

      this.overlayChoices.style.cssText = 'display:flex;flex-direction:column;gap:6px;'
    }
  }

  private refreshOverlayContent(): void {
    if (!this.activeTree || !this.activeNodeId) return
    const node = this.activeTree.nodes.get(this.activeNodeId)
    if (!node) return

    const visibleChoices = node.choices
      .map((choice, index) => ({ text: choice.text, index, tag: choice.tag }))
      .filter(choice => {
        const original = node.choices[choice.index]
        return !original.condition || original.condition()
      })

    const speaker = node.speaker ?? this.activeNpcId ?? 'NPC'
    this.showDialogueOverlay(speaker, node.text, visibleChoices)
  }

  private showPromptOverlay(text: string): void {
    if (!this.overlayRoot || !this.overlayPrompt) return
    this.applyOverlayLayout()
    this.overlayRoot.style.display = 'block'
    this.overlayPrompt.style.display = 'block'
    this.overlayPrompt.textContent = text

    // Touch mode: make prompt a clickable text bar that starts dialogue directly
    if (this.isTouchInputMode()) {
      this.overlayPrompt.style.pointerEvents = 'auto'
      this.overlayPrompt.style.cursor = 'pointer'
      this.overlayPrompt.style.touchAction = 'manipulation'
      this.overlayPrompt.ontouchend = (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (this.nearestInteractableNpc && !this.isActive) {
          this.handleActionButton('touch')
        }
      }
      this.overlayPrompt.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (this.nearestInteractableNpc && !this.isActive) {
          this.handleActionButton('mouse')
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
    // Don't hide root — dialogue box may still be visible
  }

  private showDialogueOverlay(speaker: string, text: string, choices: { text: string; index: number; tag?: DialogueChoiceTag }[]): void {
    if (!this.overlayRoot) return
    this.applyOverlayLayout()
    this.overlayRoot.style.display = 'block'
    if (this.overlayTopBox) this.overlayTopBox.style.display = 'block'
    if (this.overlayBox) this.overlayBox.style.display = 'block'
    if (this.overlaySpeaker) {
      if (this.clusterNpcIds.length > 1) {
        const navHint = this.inputMode === 'touch' ? '' : this.inputMode === 'gamepad' ? ' (◀ D-Pad ▶)' : ' (◀ A/D ▶)'
        this.overlaySpeaker.textContent = `◀ ${speaker} ▶  [${this.selectedClusterIndex + 1}/${this.clusterNpcIds.length}]${navHint}`
      } else {
        this.overlaySpeaker.textContent = speaker
      }
    }
    if (this.overlayText) this.overlayText.textContent = text

    // Mobile cluster NPC navigation buttons
    if (this.overlayTopBox) {
      let clusterNav = document.getElementById('dialogue-cluster-nav') as HTMLDivElement | null
      if (this.clusterNpcIds.length > 1 && this.inputMode === 'touch') {
        if (!clusterNav) {
          clusterNav = document.createElement('div')
          clusterNav.id = 'dialogue-cluster-nav'
          clusterNav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;margin-top:10px;pointer-events:auto;'
          this.overlayTopBox.appendChild(clusterNav)
        }
        clusterNav.innerHTML = ''
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
        label.textContent = `${speaker}  [${this.selectedClusterIndex + 1}/${this.clusterNpcIds.length}]`
        label.style.cssText = 'color:#ffd866;font-size:14px;letter-spacing:1px;'
        clusterNav.appendChild(label)
        clusterNav.appendChild(makeTouchBtn('▶', () => this.handleClusterNavigate(1, 'touch')))
        clusterNav.style.display = 'flex'
      } else if (clusterNav) {
        clusterNav.remove()
      }
    }

    if (this.overlayChoices) {
      this.overlayChoices.innerHTML = ''
      for (const c of choices) {
        const isHighlighted = c.index === this.highlightedChoiceIndex
        const choiceColor = this.getChoiceColor(c.tag, isHighlighted)
        const btn = document.createElement('div')
        btn.textContent = `${isHighlighted ? '▶ ' : ''}${c.index + 1}. ${c.text}`
        btn.style.cssText =
          `color:${choiceColor};cursor:pointer;padding:${this.isTouchInputMode() ? '10px 18px' : '6px 14px'};font-size:${this.isTouchInputMode() ? '17px' : '15px'};transition:color 0.15s,border-color 0.15s;text-shadow:${this.isTouchInputMode() ? '0 0 14px rgba(0,0,0,0.9)' : 'none'};pointer-events:auto;touch-action:manipulation;border:1px solid ${choiceColor};border-radius:4px;background:transparent;box-sizing:border-box;`
        btn.addEventListener('mouseenter', () => {
          this.highlightedChoiceIndex = c.index
          this.updateChoiceHighlight()
        })
        btn.addEventListener('mouseleave', () => {
          const c2 = this.getChoiceColor(c.tag, c.index === this.highlightedChoiceIndex)
          btn.style.color = c2
          btn.style.borderColor = c2
        })
        btn.addEventListener('pointerdown', (event) => {
          if (this.inputMode === 'touch' || (event as PointerEvent).pointerType === 'touch') {
            event.preventDefault()
            this.highlightedChoiceIndex = c.index
            this.updateChoiceHighlight()
          }
        })
        btn.addEventListener('touchend', (event) => {
          event.preventDefault()
          // On touch: directly select the choice (tap-to-execute)
          this.highlightedChoiceIndex = c.index
          this.selectChoice(c.index, 'touch')
        }, { passive: false })
        btn.addEventListener('click', (event) => {
          if (this.isTouchInputMode()) {
            event.preventDefault()
            // Tap already handled by touchend
            return
          }
          this.selectChoice(c.index, 'mouse')
        })
        this.overlayChoices!.appendChild(btn)
      }
      if (choices.length === 0) {
        const hint = document.createElement('div')
        hint.textContent = this.getContinueHintText()
        hint.style.cssText = 'color:#b9d0d8;font-size:13px;margin-top:4px;text-shadow:0 0 12px rgba(0,0,0,0.85);'
        if (this.isTouchInputMode()) {
          hint.style.pointerEvents = 'auto'
          hint.style.cursor = 'pointer'
          hint.style.padding = '12px 24px'
          hint.style.touchAction = 'manipulation'
          hint.addEventListener('touchend', (e) => {
            e.preventDefault()
            e.stopPropagation()
            this.endDialogue()
          })
        }
        this.overlayChoices.appendChild(hint)
      }
    }
  }

  private hideDialogueOverlay(): void {
    if (this.overlayTopBox) this.overlayTopBox.style.display = 'none'
    if (this.overlayBox) this.overlayBox.style.display = 'none'
    if (this.overlayRoot) this.overlayRoot.style.display = 'none'
  }
}
