import * as THREE from 'three'
import { NPCSystem, NPCInstance } from './NPCSystem'
import { NPCAISystem } from './NPCAISystem'
import { CharacterAnimationSystem } from './CharacterAnimationSystem'
import { logger, LogModule } from './Logger'

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

export interface DialogueChoice {
  /** Text shown to the player */
  text: string
  /** ID of the next DialogueNode to jump to */
  nextNodeId: string
  /** Optional condition — choice is only shown when this returns true */
  condition?: () => boolean
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
  private trees: Map<string, DialogueTree> = new Map()
  private npcDialogueMap: Map<string, string> = new Map() // npcId → treeId
  private uiCallbacks: DialogueUICallbacks | null = null

  // — runtime state —
  private activeNpcId: string | null = null
  private activeTree: DialogueTree | null = null
  private activeNodeId: string | null = null
  private isActive: boolean = false

  // — interaction trigger —
  private interactionRange: number = 3.5
  private promptVisible: boolean = false
  private nearestInteractableNpc: string | null = null

  // global dialogue flags (persist across conversations)
  private flags: Map<string, any> = new Map()

  // key listener
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null

  constructor(
    npcSystem: NPCSystem,
    aiSystem: NPCAISystem,
    charAnimSystem: CharacterAnimationSystem,
  ) {
    this.npcSystem = npcSystem
    this.aiSystem = aiSystem
    this.charAnimSystem = charAnimSystem
  }

  // --------------------------------------------------------------------------
  // SETUP
  // --------------------------------------------------------------------------

  /** Provide UI callbacks so the dialogue system can show/hide prompts. */
  setUICallbacks(callbacks: DialogueUICallbacks): void {
    this.uiCallbacks = callbacks
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

    // Find closest interactable NPC
    const candidates = this.aiSystem.getInteractableNPCs(this.interactionRange)
    let closest: NPCInstance | null = null
    let closestDist = Infinity
    for (const npc of candidates) {
      if (!this.npcDialogueMap.has(npc.id)) continue // no dialogue tree assigned
      const d = npc.position.distanceTo(playerPosition)
      if (d < closestDist) {
        closestDist = d
        closest = npc
      }
    }

    if (closest) {
      if (this.nearestInteractableNpc !== closest.id) {
        this.nearestInteractableNpc = closest.id
        this.uiCallbacks?.showPrompt(`Press E to talk to ${closest.id}`)
        this.promptVisible = true
      }
    } else {
      if (this.promptVisible) {
        this.uiCallbacks?.hidePrompt()
        this.promptVisible = false
        this.nearestInteractableNpc = null
      }
    }
  }

  // --------------------------------------------------------------------------
  // KEY HANDLER
  // --------------------------------------------------------------------------

  private handleKey(e: KeyboardEvent): void {
    if (e.code === 'KeyE') {
      if (this.isActive) return
      if (this.nearestInteractableNpc) {
        this.startDialogue(this.nearestInteractableNpc)
      }
    }

    // During active dialogue, number keys 1-9 pick a choice
    if (this.isActive && e.code.startsWith('Digit')) {
      const digit = parseInt(e.code.replace('Digit', ''), 10)
      if (digit >= 1 && digit <= 9) {
        this.selectChoice(digit - 1)
      }
    }
  }

  // --------------------------------------------------------------------------
  // DIALOGUE FLOW
  // --------------------------------------------------------------------------

  startDialogue(npcId: string): void {
    const treeId = this.npcDialogueMap.get(npcId)
    if (!treeId) return
    const tree = this.trees.get(treeId)
    if (!tree) return

    this.activeNpcId = npcId
    this.activeTree = tree
    this.isActive = true

    this.uiCallbacks?.hidePrompt()
    this.promptVisible = false

    // Face NPC toward player (handled by AI) and play talking anim
    this.aiSystem.playAnimation(npcId, 'talking', false)

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
      // Terminal node — show text then end
      this.uiCallbacks?.showDialogue(speaker, node.text, [])
      // Auto-end after a short delay (or on next E press)
      setTimeout(() => this.endDialogue(), 3000)
      return
    }

    this.uiCallbacks?.showDialogue(
      speaker,
      node.text,
      visibleChoices.map((c, i) => ({ text: c.text, index: i })),
    )
  }

  selectChoice(index: number): void {
    if (!this.activeTree || !this.activeNodeId) return
    const node = this.activeTree.nodes.get(this.activeNodeId)
    if (!node) return

    const visibleChoices = node.choices.filter(c => !c.condition || c.condition())
    if (index < 0 || index >= visibleChoices.length) return

    const choice = visibleChoices[index]
    this.goToNode(choice.nextNodeId)
  }

  endDialogue(): void {
    if (this.activeNpcId) {
      // Return NPC to idle
      try { this.charAnimSystem.crossfadeTo(this.activeNpcId, 'idle', 0.4) } catch (_) {}
    }
    this.isActive = false
    this.activeTree = null
    this.activeNodeId = null
    this.activeNpcId = null
    this.uiCallbacks?.hideDialogue()
  }

  /** Whether a dialogue is currently in progress. */
  isDialogueActive(): boolean {
    return this.isActive
  }

  /** The NPC currently being talked to. */
  getActiveNpcId(): string | null {
    return this.activeNpcId
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

  static choice(text: string, nextNodeId: string, condition?: () => boolean): DialogueChoice {
    return { text, nextNodeId, condition }
  }
}
