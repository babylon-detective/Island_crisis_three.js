/**
 * InventoryDisplay — 3-D circular item display around the player.
 *
 * Navigation mode:  keeps the live camera view, pauses world physics/AI,
 *   player stays stationary with idle animation playing.  Items are placed
 *   on the vertices of a rotating circle around the player as 3-D polygon
 *   primitives (cube, cone, sphere …) that spin on their own axis.
 *
 * Battle / Dialogue mode:  camera cuts to the player (attackerFocus-style),
 *   items are displayed the same way, and on confirm the camera returns.
 */

import * as THREE from 'three'
import type { ItemSystem, InventorySlot, ItemShape } from './ItemSystem'
import type { CameraManager } from './CameraManager'
import type { PlayerController } from './PlayerController'
import type { PauseManager } from './PauseManager'
import type { SoundSystem } from './SoundSystem'

type ActiveInputMode = 'touch' | 'gamepad' | 'keyboard' | 'mouse'

// ─── Constants ───────────────────────────────────────────────────────────────

const CIRCLE_RADIUS = 2.2
const CIRCLE_SEGMENTS = 64
const CIRCLE_COLOR = 0xffd866
const CIRCLE_OPACITY = 0.45
const ITEM_MESH_SCALE = 0.35
const SLOT_Y_OFFSET = 1.0          // height above the circle plane (navigation mode)
const SPIN_SPEED = 1.5             // radians/sec for item self-rotation
const ORBIT_SPEED = 0.15           // radians/sec for auto-orbit (battle/dialogue mode)
const RING_LERP_SPEED = 8.0        // radians/sec — ring snaps to new selection (navigation)
const SIDE_OFFSET = 2.5            // world units to player's right (battle/dialogue)
const SIDE_OFFSET_Y = 0.8          // height offset for side ring (battle/dialogue)
const OVERLAY_Z = 12150

// ─── Shape factory ───────────────────────────────────────────────────────────

function createItemGeometry(shape: ItemShape): THREE.BufferGeometry {
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

// ─── InventoryDisplay ────────────────────────────────────────────────────────

export class InventoryDisplay {
  private scene: THREE.Scene
  private itemSystem: ItemSystem
  private cameraManager: CameraManager
  private playerController: PlayerController
  private pauseManager: PauseManager

  private isActive = false
  private selectedIndex = 0
  private mode: 'navigation' | 'battle' | 'dialogue' = 'navigation'

  // 3-D objects
  private circleGroup: THREE.Group | null = null   // inner group: holds ring + meshes
  private tiltGroup: THREE.Group | null = null     // outer group: tilt + side-offset (battle/dialogue)
  private circleLine: THREE.LineLoop | null = null
  private slotMeshes: THREE.Mesh[] = []
  private slotLabels: THREE.Sprite[] = []          // quantity badges

  // Ring orientation tracking (navigation mode)
  private frontYaw: number = 0        // player facing yaw captured at open() time
  private soundSystem: SoundSystem | null = null
  private currentRingYaw: number = 0  // animated current Y rotation
  private targetRingYaw: number = 0   // destination Y rotation for current selection

  // DOM overlay
  private overlayRoot: HTMLDivElement | null = null
  private overlayName: HTMLDivElement | null = null
  private overlayDesc: HTMLDivElement | null = null
  private overlayHint: HTMLDivElement | null = null

  // Input
  private inputMode: ActiveInputMode = 'keyboard'
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null
  private boundKeyUp: ((e: KeyboardEvent) => void) | null = null

  // Prevent repeated confirm while key is held
  private confirmConsumed = false

  // Touch state for swipe detection
  private touchStartX = 0
  private touchStartY = 0

  // Document-level touch listeners for inventory swipe (added when open, removed when closed).
  // Using document rather than the panel lets the canvas also receive the same touches so
  // camera look continues to work while the inventory is visible.
  private boundDocTouchStart: ((e: TouchEvent) => void) | null = null
  private boundDocTouchEnd: ((e: TouchEvent) => void) | null = null

  // Callback fired when the display closes (used by BattleSystem to resume)
  private onCloseCallback: (() => void) | null = null

  constructor(
    scene: THREE.Scene,
    itemSystem: ItemSystem,
    cameraManager: CameraManager,
    playerController: PlayerController,
    pauseManager: PauseManager,
  ) {
    this.scene = scene
    this.itemSystem = itemSystem
    this.cameraManager = cameraManager
    this.playerController = playerController
    this.pauseManager = pauseManager
  }

  public setSoundSystem(sound: SoundSystem): void {
    this.soundSystem = sound
  }

  // ── Public API ────────────────────────────────────────────────────────────

  public isInventoryActive(): boolean { return this.isActive }

  public setInputMode(mode: ActiveInputMode): void { this.inputMode = mode }

  public toggle(): void {
    if (this.isActive) this.close()
    else this.open()
  }

  /**
   * Open the inventory display.
   * @param mode  'navigation' keeps the live camera; 'battle'/'dialogue'
   *              cuts the camera to the player and restores on close.
   * @param onClose  optional callback fired when the display closes.
   */
  public open(mode: 'navigation' | 'battle' | 'dialogue' = 'navigation', onClose?: () => void): void {
    if (this.isActive) return
    this.isActive = true
    this.selectedIndex = 0
    this.mode = mode
    this.onCloseCallback = onClose ?? null
    this.soundSystem?.playUISfx('menuOpen')

    // In navigation mode, pause world physics/AI (rendering stays live)
    if (mode === 'navigation') {
      this.pauseManager.setPaused(true)
    }

    // In battle/dialogue, cut camera to the player
    if (mode === 'battle' || mode === 'dialogue') {
      this.cameraManager.battleCutTo('playerCloseUp')
    }

    const playerPos = this.playerController.getPosition()
    this.frontYaw = this.playerController.getFacingYaw()

    // Build 3-D circle + item meshes
    this.buildCircleGroup(playerPos)

    // Set initial ring rotation so slot 0 is already at its facing position (all modes)
    this.computeTargetRingYaw()
    this.currentRingYaw = this.targetRingYaw
    if (this.circleGroup) {
      this.circleGroup.rotation.y = this.currentRingYaw
    }

    this.buildSlotMeshes()

    // DOM overlay
    this.buildOverlay()
    this.updateSelection()

    // Input
    this.boundKeyDown = (e: KeyboardEvent) => this.handleKey(e)
    this.boundKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e)
    document.addEventListener('keydown', this.boundKeyDown)
    document.addEventListener('keyup', this.boundKeyUp)

    // Document-level swipe detection for mobile item navigation.
    // The panel itself has pointer-events:none so these touches also reach the
    // canvas, keeping camera look fully functional during inventory.
    this.boundDocTouchStart = (e: TouchEvent) => {
      if (!this.isActive) return
      this.touchStartX = e.changedTouches[0].clientX
      this.touchStartY = e.changedTouches[0].clientY
    }
    this.boundDocTouchEnd = (e: TouchEvent) => {
      if (!this.isActive) return
      // Only treat as an inventory swipe if the gesture started in the bottom
      // panel region (lower 35 % of the screen).
      if (this.touchStartY < window.innerHeight * 0.65) return
      const dx = e.changedTouches[0].clientX - this.touchStartX
      const dy = e.changedTouches[0].clientY - this.touchStartY
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      if (absDx > 40 && absDx > absDy) {
        this.navigate(dx < 0 ? 1 : -1)
      } else if (absDy > 40 && absDy > absDx) {
        this.navigate(dy < 0 ? 1 : -1)
      }
    }
    document.addEventListener('touchstart', this.boundDocTouchStart, { passive: true })
    document.addEventListener('touchend', this.boundDocTouchEnd, { passive: true })

    console.log(`🎒 Inventory opened (${mode})`)
  }

  public close(): void {
    if (!this.isActive) return
    this.isActive = false
    this.soundSystem?.playUISfx('menuClose')

    // Remove 3-D objects
    this.removeCircleGroup()
    this.removeSlotMeshes()

    // DOM
    this.removeOverlay()

    // Input
    if (this.boundKeyDown) {
      document.removeEventListener('keydown', this.boundKeyDown)
      this.boundKeyDown = null
    }
    if (this.boundKeyUp) {
      document.removeEventListener('keyup', this.boundKeyUp)
      this.boundKeyUp = null
    }
    if (this.boundDocTouchStart) {
      document.removeEventListener('touchstart', this.boundDocTouchStart)
      this.boundDocTouchStart = null
    }
    if (this.boundDocTouchEnd) {
      document.removeEventListener('touchend', this.boundDocTouchEnd)
      this.boundDocTouchEnd = null
    }
    this.confirmConsumed = false

    // Camera: return to default for the mode
    if (this.mode === 'battle') {
      this.cameraManager.battleCutTo('menuIdle')
    } else if (this.mode === 'dialogue') {
      // dialogue camera is managed by DialogueManager, nothing to do
    }

    // Unpause only if we paused (navigation mode)
    if (this.mode === 'navigation') {
      this.pauseManager.setPaused(false)
    }

    // Fire callback
    if (this.onCloseCallback) {
      this.onCloseCallback()
      this.onCloseCallback = null
    }

    console.log('🎒 Inventory closed')
  }

  /**
   * Called every frame (even while paused) to spin items and rotate the ring.
   * All modes: ring lerps to bring the selected item to its designated facing position.
   *   Navigation  → selected item faces the player (front of flat horizontal ring).
   *   Battle/Dialogue → selected item rises to the top of the upright vertical ring.
   */
  public update(dt: number): void {
    if (!this.isActive || !this.circleGroup) return

    {
      // All modes: smoothly rotate ring toward target
      let delta = this.targetRingYaw - this.currentRingYaw
      // Wrap delta to shortest arc [-PI, PI]
      delta = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI
      if (delta < -Math.PI) delta += Math.PI * 2
      this.currentRingYaw += delta * Math.min(1, RING_LERP_SPEED * dt)
      this.circleGroup.rotation.y = this.currentRingYaw
    }

    // Spin each item mesh on its own local axes
    for (const mesh of this.slotMeshes) {
      mesh.rotation.y += SPIN_SPEED * dt
      mesh.rotation.x += SPIN_SPEED * 0.3 * dt
    }
  }

  // ── Input handling ────────────────────────────────────────────────────────

  private handleKey(e: KeyboardEvent): void {
    if (!this.isActive) return
    const slots = this.itemSystem.getInventory()

    // Stop propagation so BattleSystem / DialogueSystem don't also handle this key
    e.stopPropagation()

    if (e.code === 'Escape' || e.code === 'KeyI' || e.code === 'KeyL') {
      e.preventDefault()
      this.close()
      return
    }
    if (slots.length === 0) return

    if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault()
      this.navigate(-1)
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault()
      this.navigate(1)
    } else if (e.code === 'KeyJ') {
      e.preventDefault()
      if (!this.confirmConsumed) {
        this.confirmConsumed = true
        this.useSelected()
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (e.code === 'KeyJ') {
      this.confirmConsumed = false
    }
  }

  public handleNavigateInput(dir: number): boolean {
    if (!this.isActive) return false
    this.navigate(dir)
    return true
  }

  public handleConfirmInput(): boolean {
    if (!this.isActive) return false
    this.useSelected()
    return true
  }

  public handleCancelInput(): boolean {
    if (!this.isActive) return false
    this.close()
    return true
  }

  // ── Navigation helpers ────────────────────────────────────────────────────

  private navigate(dir: number): void {
    const slots = this.itemSystem.getInventory()
    if (slots.length === 0) {
      this.soundSystem?.playUISfx('dud')
      return
    }
    this.selectedIndex = (this.selectedIndex + dir + slots.length) % slots.length
    this.computeTargetRingYaw()
    this.updateSelection()
    this.soundSystem?.playUISfx('itemHighlight')
  }

  /**
   * Compute targetRingYaw so the selected slot faces the player-forward direction.
   * Slot i lives at local XZ angle a_i = (i/n)*2π - π/2.
   * rot = a_sel - π/2 + frontYaw
   */
  private computeTargetRingYaw(): void {
    const n = this.itemSystem.getInventory().length
    if (n === 0) return
    const a_sel = (this.selectedIndex / n) * Math.PI * 2 - Math.PI / 2
    this.targetRingYaw = a_sel - Math.PI / 2 + this.frontYaw
  }

  private useSelected(): void {
    const slots = this.itemSystem.getInventory()
    if (slots.length === 0) return
    const slot = slots[this.selectedIndex]
    if (!slot) return

    const useMode = this.mode === 'dialogue' ? 'navigation' : this.mode
    const effects = this.itemSystem.useItem(slot.item.id, useMode)
    if (effects === null) {
      this.soundSystem?.playUISfx('dud')
      this.flashStatus(`Can't use ${slot.item.name} here.`)
      return
    }
    this.soundSystem?.playUISfx('confirm')
    console.log(`🎒 Used ${slot.item.icon} ${slot.item.name}`, effects)
    this.flashStatus(`Used ${slot.item.name}!`)

    // Refresh
    const remaining = this.itemSystem.getInventory()
    if (this.selectedIndex >= remaining.length) {
      this.selectedIndex = Math.max(0, remaining.length - 1)
    }
    this.rebuildSlots()
    this.updateSelection()
  }

  // ── 3-D circle group ──────────────────────────────────────────────────────

  private buildCircleGroup(center: THREE.Vector3): void {
    this.circleGroup = new THREE.Group()

    // Flat horizontal ring centred on the player (all modes)
    this.circleGroup.position.copy(center)
    this.circleGroup.position.y += 0.05
    this.scene.add(this.circleGroup)

    // Thin circle outline (in circleGroup's local XZ plane)
    const geom = new THREE.BufferGeometry()
    const verts: number[] = []
    for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2
      verts.push(Math.cos(a) * CIRCLE_RADIUS, 0, Math.sin(a) * CIRCLE_RADIUS)
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))

    const mat = new THREE.LineBasicMaterial({
      color: CIRCLE_COLOR,
      transparent: true,
      opacity: CIRCLE_OPACITY,
    })
    this.circleLine = new THREE.LineLoop(geom, mat)
    this.circleGroup.add(this.circleLine)
  }

  private removeCircleGroup(): void {
    if (this.circleLine) {
      this.circleLine.geometry.dispose()
      ;(this.circleLine.material as THREE.Material).dispose()
      this.circleLine = null
    }
    if (this.circleGroup) {
      this.scene.remove(this.circleGroup)
    }
    this.circleGroup = null
  }

  // ── Slot meshes (3-D primitives) ──────────────────────────────────────────

  private buildSlotMeshes(): void {
    this.removeSlotMeshes()
    if (!this.circleGroup) return
    const slots = this.itemSystem.getInventory()
    if (slots.length === 0) return

    const yOff = SLOT_Y_OFFSET

    for (let i = 0; i < slots.length; i++) {
      const angle = (i / slots.length) * Math.PI * 2 - Math.PI / 2
      const x = Math.cos(angle) * CIRCLE_RADIUS
      const z = Math.sin(angle) * CIRCLE_RADIUS

      const mesh = this.makeItemMesh(slots[i])
      mesh.position.set(x, yOff, z)
      this.slotMeshes.push(mesh)
      this.circleGroup.add(mesh)

      // Quantity label (canvas sprite) for stackable items
      if (slots[i].item.stackable && slots[i].quantity > 1) {
        const label = this.makeQtyLabel(slots[i].quantity)
        label.position.set(x, yOff + 0.55, z)
        this.slotLabels.push(label)
        this.circleGroup.add(label)
      }
    }
  }

  private removeSlotMeshes(): void {
    for (const m of this.slotMeshes) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
      m.parent?.remove(m)
    }
    this.slotMeshes = []

    for (const s of this.slotLabels) {
      ;(s.material as THREE.SpriteMaterial).map?.dispose()
      ;(s.material as THREE.SpriteMaterial).dispose()
      s.parent?.remove(s)
    }
    this.slotLabels = []
  }

  private rebuildSlots(): void {
    this.removeSlotMeshes()
    this.buildSlotMeshes()
    // Recompute and snap to target immediately for all modes (item count may have changed)
    this.computeTargetRingYaw()
    this.currentRingYaw = this.targetRingYaw
    if (this.circleGroup) this.circleGroup.rotation.y = this.currentRingYaw
  }

  private makeItemMesh(slot: InventorySlot): THREE.Mesh {
    const geom = createItemGeometry(slot.item.shape)
    const mat = new THREE.MeshStandardMaterial({
      color: slot.item.color,
      roughness: 0.5,
      metalness: 0.3,
      flatShading: true,
    })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.scale.setScalar(ITEM_MESH_SCALE)
    return mesh
  }

  private makeQtyLabel(qty: number): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 32
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, 64, 32)
    ctx.font = 'bold 22px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffd866'
    ctx.fillText(`x${qty}`, 32, 16)

    const tex = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(0.5, 0.25, 1)
    return sprite
  }

  // ── Selection highlight ───────────────────────────────────────────────────

  private updateSelection(): void {
    const slots = this.itemSystem.getInventory()

    for (let i = 0; i < this.slotMeshes.length; i++) {
      const m = this.slotMeshes[i]
      const sel = i === this.selectedIndex
      m.scale.setScalar(sel ? ITEM_MESH_SCALE * 1.6 : ITEM_MESH_SCALE)
      const mat = m.material as THREE.MeshStandardMaterial
      mat.emissive.set(sel ? 0xffd866 : 0x000000)
      mat.emissiveIntensity = sel ? 0.4 : 0
    }

    // Update DOM info
    if (slots.length > 0 && this.overlayName && this.overlayDesc) {
      const slot = slots[this.selectedIndex]
      this.overlayName.textContent = `${slot.item.icon} ${slot.item.name}`
      const qty = slot.item.stackable ? ` (x${slot.quantity})` : ''
      this.overlayDesc.textContent = `${slot.item.description}${qty}`
    } else if (this.overlayName && this.overlayDesc) {
      this.overlayName.textContent = 'No items'
      this.overlayDesc.textContent = ''
    }

    this.updateHint()
  }

  private updateHint(): void {
    if (!this.overlayHint) return
    const slots = this.itemSystem.getInventory()
    if (slots.length === 0) {
      this.overlayHint.textContent = this.getCloseHint()
      return
    }
    this.overlayHint.textContent = `${this.getNavHint()}  •  ${this.getConfirmHint()}  •  ${this.getCloseHint()}`
  }

  private getNavHint(): string {
    if (this.inputMode === 'gamepad') return '← → Navigate'
    if (this.inputMode === 'touch') return 'Swipe to navigate'
    return 'A/D Navigate'
  }
  private getConfirmHint(): string {
    if (this.inputMode === 'gamepad') return 'A Use'
    if (this.inputMode === 'touch') return 'Tap to use'
    return 'J Use'
  }
  private getCloseHint(): string {
    if (this.inputMode === 'gamepad') return 'B Close'
    if (this.inputMode === 'touch') return '✕ Close'
    return 'I / Esc Close'
  }

  // ── DOM overlay ───────────────────────────────────────────────────────────

  private buildOverlay(): void {
    this.removeOverlay()

    const root = document.createElement('div')
    root.id = 'inventory-overlay'
    root.style.cssText =
      `position:fixed;inset:0;z-index:${OVERLAY_Z};pointer-events:none;` +
      'font-family:"Courier New",monospace;color:#eee;user-select:none;' +
      'opacity:0;transition:opacity 0.25s ease;'

    // Title
    const title = document.createElement('div')
    title.style.cssText =
      'position:absolute;top:20px;left:0;right:0;text-align:center;' +
      'color:#ffd866;font-size:16px;font-weight:bold;text-transform:uppercase;letter-spacing:3px;'
    title.textContent = 'Inventory'
    root.appendChild(title)

    // Bottom info panel — pointer-events:none so touch events fall through to the
    // canvas underneath, keeping camera-look available on mobile while the
    // inventory is open.  Only the nav buttons below override this back to auto.
    const panel = document.createElement('div')
    panel.style.cssText =
      'position:absolute;bottom:0;left:50%;transform:translateX(-50%);' +
      'width:min(400px,calc(100vw - 24px));pointer-events:none;' +
      'background:linear-gradient(to top,rgba(0,0,0,0.88),rgba(0,0,0,0.55) 80%,transparent);' +
      'border-radius:14px 14px 0 0;padding:24px 28px env(safe-area-inset-bottom,12px);' +
      'text-align:center;'

    this.overlayName = document.createElement('div')
    this.overlayName.style.cssText = 'font-size:18px;color:#ffd866;font-weight:bold;margin-bottom:6px;'
    panel.appendChild(this.overlayName)

    this.overlayDesc = document.createElement('div')
    this.overlayDesc.style.cssText = 'font-size:14px;color:#b9d0d8;margin-bottom:14px;'
    panel.appendChild(this.overlayDesc)

    this.overlayHint = document.createElement('div')
    this.overlayHint.style.cssText = 'font-size:12px;color:#888;letter-spacing:1px;'
    panel.appendChild(this.overlayHint)

    // ── Mobile nav buttons (← →) ───────────────────────────────────────────
    // pointer-events:auto restores interactivity for buttons only; the panel
    // background above remains passthrough so camera look reaches the canvas.
    const navRow = document.createElement('div')
    navRow.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;margin-top:10px;' +
      'pointer-events:auto;'

    const mkNavBtn = (label: string, dir: number): HTMLButtonElement => {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText =
        'background:none;border:none;color:#ffd866;font-size:22px;cursor:pointer;' +
        'font-family:"Courier New",monospace;padding:6px 20px;' +
        'touch-action:manipulation;-webkit-tap-highlight-color:transparent;'
      btn.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation()
        this.navigate(dir)
      })
      return btn
    }

    const useBtn = document.createElement('button')
    useBtn.textContent = 'Use'
    useBtn.style.cssText =
      'background:rgba(255,216,102,0.15);border:1px solid rgba(255,216,102,0.4);' +
      'border-radius:6px;color:#ffd866;font-size:14px;font-weight:bold;cursor:pointer;' +
      'font-family:"Courier New",monospace;padding:6px 24px;' +
      'touch-action:manipulation;-webkit-tap-highlight-color:transparent;'
    useBtn.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation()
      this.useSelected()
    })

    navRow.appendChild(mkNavBtn('◀', -1))
    navRow.appendChild(useBtn)
    navRow.appendChild(mkNavBtn('▶', +1))
    panel.appendChild(navRow)

    root.appendChild(panel)
    document.body.appendChild(root)
    this.overlayRoot = root

    requestAnimationFrame(() => {
      if (this.overlayRoot) this.overlayRoot.style.opacity = '1'
    })
  }

  private removeOverlay(): void {
    if (this.overlayRoot) {
      this.overlayRoot.remove()
      this.overlayRoot = null
      this.overlayName = null
      this.overlayDesc = null
      this.overlayHint = null
    }
  }

  private flashStatus(msg: string): void {
    if (!this.overlayDesc) return
    this.overlayDesc.textContent = msg
    this.overlayDesc.style.color = '#ffd866'
    setTimeout(() => {
      if (this.overlayDesc) {
        this.overlayDesc.style.color = '#b9d0d8'
        this.updateSelection()
      }
    }, 900)
  }
}
