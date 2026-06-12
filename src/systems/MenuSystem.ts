import * as THREE from 'three'
import type { CameraManager } from './CameraManager'
import type { PlayerController } from './PlayerController'
import type { SoundSystem } from './SoundSystem'

// ============================================================================
// MENU EVENT STATE SYSTEM
//
// The Menu Event is a distinct game state that:
//   - Pauses world gameplay (player movement, NPC AI) but NOT the clock
//   - Hides all world geometry (land, ocean, NPCs, lights)
//   - Sets a black background
//   - Positions the camera in front of the player avatar (character screen view)
//   - Shows a bottom-anchored swipeable card carousel for in-game data
//
// Triggers:
//   - Keyboard:  M  (close) · ← → (navigate cards)
//   - Gamepad:   Select (button 8)
//   - Mobile:    ≡ button (upper-right) · touch swipe left/right
//
// Card system:
//   - addCard(MenuCard) registers new data screens at runtime
//   - Default cards: VITALS, COMBAT
//   - Cards are full-width, bottom-anchored — player avatar always visible above
// ============================================================================

/**
 * A data screen inside the Menu card carousel.
 * Implement `build()` to return inner HTML rendered inside the card body.
 * The footer (navigation, dots, close hint) is managed by MenuSystem.
 */
export interface MenuCard {
  id: string
  title: string
  /** Returns inner HTML for this card. Called each time the menu opens. */
  build(stats: PlayerMenuStats): string
}

export interface PlayerMenuStats {
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  level: number
  exp: number
  maxExp: number
  attack: number
  defense: number
  speed: number
  luck: number
  name: string
}

export class MenuSystem {
  private isActive = false

  private scene: THREE.Scene
  private cameraManager: CameraManager
  private playerController: PlayerController

  // Scene visibility snapshot — restored on close
  private savedVisibility: Map<string, boolean> = new Map()
  private savedBackground: THREE.Color | THREE.Texture | null = null

  // Dedicated menu lighting (soft showcase)
  private menuAmbient: THREE.AmbientLight | null = null

  // DOM
  private panelRoot: HTMLDivElement | null = null
  private cardTrack: HTMLDivElement | null = null
  private cardTitleEl: HTMLSpanElement | null = null
  private dotsEl: HTMLDivElement | null = null

  // Card carousel
  private cards: MenuCard[] = []
  private currentCardIndex = 0

  // Input — keyboard listener removed on close; touch swipe delta
  private boundMenuKeyDown: ((e: KeyboardEvent) => void) | null = null
  private touchStartX = 0

  // Playtime tracking
  /** Accumulated game-time in milliseconds. Updated via update(deltaTime), so it
   *  automatically freezes when the game loop's pause guard skips update calls. */
  private gameTimeMs: number = 0
  /** Throttle: last value of gameTimeMs (in whole seconds) that was written to the DOM. */
  private lastDisplayedSec: number = -1
  private timerEl: HTMLDivElement | null = null

  // Stats applied at open time (can be updated between opens)
  private stats: Partial<PlayerMenuStats> = {}
  private soundSystem: SoundSystem | null = null

  constructor(
    scene: THREE.Scene,
    cameraManager: CameraManager,
    playerController: PlayerController,
  ) {
    this.scene = scene
    this.cameraManager = cameraManager
    this.playerController = playerController
    this.initDefaultCards()
  }

  public setSoundSystem(sound: SoundSystem): void {
    this.soundSystem = sound
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  public isMenuActive(): boolean {
    return this.isActive
  }

  public setStats(stats: Partial<PlayerMenuStats>): void {
    this.stats = stats
  }

  /**
   * Register a new data screen.
   * Cards appear in registration order and are navigated with ← →.
   * Safe to call before or after the menu is first opened.
   */
  public addCard(card: MenuCard): void {
    this.cards.push(card)
  }

  /** Open the Menu Event state. */
  public open(stats?: Partial<PlayerMenuStats>): void {
    if (this.isActive) return
    this.isActive = true
    this.soundSystem?.playUISfx('menuOpen')

    if (stats) this.stats = stats

    const playerMesh = this.playerController.getMesh()
    const playerPos = this.playerController.getPosition()
    const playerYaw = playerMesh.rotation.y

    // -- Build the set of all player mesh descendants so we can keep them visible --
    const playerUuids = new Set<string>()
    playerMesh.traverse(obj => playerUuids.add(obj.uuid))

    // -- Snapshot and hide all scene objects not belonging to the player --
    this.savedVisibility.clear()
    this.scene.traverse((object) => {
      if (object === this.scene) return
      if (playerUuids.has(object.uuid)) return
      this.savedVisibility.set(object.uuid, object.visible)
      if (object.visible) object.visible = false
    })

    // Ensure the player avatar remains fully visible
    playerMesh.visible = true
    playerMesh.traverse(child => { child.visible = true })

    // -- Black background --
    this.savedBackground = this.scene.background as THREE.Color | THREE.Texture | null
    this.scene.background = new THREE.Color(0x000000)

    // -- Soft ambient lighting for the isolated player avatar --
    // No scene PointLight — the character shader has its own lighting uniforms.
    // A bright PointLight here causes harsh white projection on standard-material parts.
    this.menuAmbient = new THREE.AmbientLight(0x9090b0, 0.5)
    this.scene.add(this.menuAmbient)

    // -- Record session start on first open --
    // (no-op now — time is accumulated via update(deltaTime) instead)

    // -- Position the dedicated menu camera --
    this.cameraManager.enterMenuMode(playerPos, playerYaw)

    // -- Show DOM stat panels --
    this.showPanels()

    console.log('📋 Menu Event opened')
  }

  /** Close the Menu Event state. */
  public close(): void {
    if (!this.isActive) return
    this.isActive = false
    this.soundSystem?.playUISfx('menuClose')

    // -- Restore world object visibility --
    this.scene.traverse((object) => {
      const saved = this.savedVisibility.get(object.uuid)
      if (saved !== undefined) object.visible = saved
    })
    this.savedVisibility.clear()

    // -- Restore background --
    this.scene.background = this.savedBackground
    this.savedBackground = null

    // -- Remove showcase lighting --
    if (this.menuAmbient) {
      this.scene.remove(this.menuAmbient)
      this.menuAmbient.dispose()
      this.menuAmbient = null
    }
    // -- Return to gameplay camera --
    this.cameraManager.exitMenuMode()

    // -- Remove stat panels --
    this.hidePanels()

    console.log('📋 Menu Event closed')
  }

  /** Toggle open / closed. */
  public toggle(stats?: Partial<PlayerMenuStats>): void {
    if (this.isActive) {
      this.close()
    } else {
      this.open(stats)
    }
  }

  /**
   * Called every frame by the game loop.
   * deltaTime is 0 when the game is paused (the loop returns early before
   * calling update), so the playtime clock automatically freezes on pause.
   */
  public update(deltaTime: number): void {
    this.gameTimeMs += deltaTime * 1000

    // Update the DOM timer at most once per second to keep things cheap.
    if (this.timerEl) {
      const currentSec = Math.floor(this.gameTimeMs / 1000)
      if (currentSec !== this.lastDisplayedSec) {
        this.lastDisplayedSec = currentSec
        this.timerEl.textContent = this.formatPlaytime()
      }
    }
  }

  public dispose(): void {
    if (this.isActive) this.close()
  }

  // ============================================================================
  // DEFAULT CARD REGISTRY
  // ============================================================================

  private initDefaultCards(): void {
    this.cards = [
      {
        id: 'vitals',
        title: 'VITALS',
        build: (s) => [
          this.statRow('♥', 'HP',  `${s.hp} / ${s.maxHp}`, s.hp / s.maxHp),
          this.statRow('◈', 'MP',  `${s.mp} / ${s.maxMp}`, s.mp / s.maxMp),
          this.statRow('★', 'LVL', `${s.level}`),
          this.statRow('◆', 'EXP', `${s.exp} / ${s.maxExp}`, s.exp / s.maxExp),
        ].join(''),
      },
      {
        id: 'combat',
        title: 'COMBAT',
        build: (s) => [
          this.statRow('⚔', 'ATK', `${s.attack}`),
          this.statRow('⬡', 'DEF', `${s.defense}`),
          this.statRow('⚡', 'SPD', `${s.speed}`),
          this.statRow('✦', 'LCK', `${s.luck}`),
        ].join(''),
      },
    ]
  }

  // ============================================================================
  // CARD CAROUSEL DOM
  // ============================================================================

  private showPanels(): void {
    if (this.panelRoot) this.hidePanels()

    const s = this.resolveStats()
    this.currentCardIndex = 0

    // ── Root overlay ────────────────────────────────────────────────────────
    // Full-screen, pointer-events disabled by default so Three.js canvas
    // still receives clicks in the upper zone where the avatar is visible.
    const root = document.createElement('div')
    root.id = 'menu-event-overlay'
    root.style.cssText =
      'position:fixed;inset:0;z-index:12100;pointer-events:none;' +
      'font-family:"Courier New",monospace;color:#eee;user-select:none;' +
      'opacity:0;transition:opacity 0.3s ease;'

    // ── Player name — top center, small and unobtrusive ────────────────────
    const nameTag = document.createElement('div')
    nameTag.style.cssText =
      'position:absolute;top:20px;left:0;right:0;text-align:center;' +
      'color:#ffd866;font-size:16px;font-weight:bold;' +
      'text-transform:uppercase;letter-spacing:2px;'
    nameTag.textContent = s.name
    root.appendChild(nameTag)

    // ── Bottom card panel — mirrors Dialogue box layout ─────────────────────
    // Sits at the bottom of the viewport; player avatar is visible above it.
    // pointer-events:auto re-enabled here so nav buttons and swipe work.
    const cardPanel = document.createElement('div')
    cardPanel.style.cssText =
      'position:absolute;bottom:0;left:50%;transform:translateX(-50%);' +
      'width:min(420px,calc(100vw - 24px));pointer-events:auto;' +
      'background:linear-gradient(to top,rgba(0,0,0,0.90),rgba(0,0,0,0.60) 80%,transparent);' +
      'border-radius:14px 14px 0 0;' +
      'padding-bottom:env(safe-area-inset-bottom,0px);'

    // ── Card header: ◀  TITLE  N/N  ▶ ─────────────────────────────────────
    const header = document.createElement('div')
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:18px 28px 10px;'

    const mkNavBtn = (label: string, delta: number): HTMLButtonElement => {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText =
        'background:none;border:none;color:#ffd866;font-size:24px;cursor:pointer;' +
        'font-family:"Courier New",monospace;padding:10px 24px;' +
        'touch-action:manipulation;-webkit-tap-highlight-color:transparent;' +
        'min-width:56px;min-height:44px;display:flex;align-items:center;justify-content:center;'
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        this.navigateCard(delta)
      })
      return btn
    }

    this.cardTitleEl = document.createElement('span')
    this.cardTitleEl.style.cssText =
      'color:#ffd866;font-size:15px;font-weight:bold;letter-spacing:2px;' +
      'text-transform:uppercase;flex:1;text-align:center;'

    header.appendChild(mkNavBtn('◀', -1))
    header.appendChild(this.cardTitleEl)
    header.appendChild(mkNavBtn('▶', +1))
    cardPanel.appendChild(header)

    // ── Card track (overflow-clipped viewport containing all cards) ─────────
    const clip = document.createElement('div')
    clip.style.cssText = 'overflow:hidden;'

    this.cardTrack = document.createElement('div')
    this.cardTrack.style.cssText =
      'display:flex;transition:transform 0.28s cubic-bezier(0.4,0,0.2,1);'

    for (const card of this.cards) {
      const cardEl = document.createElement('div')
      // min-width:100% makes each card exactly the panel width → one visible at a time
      cardEl.style.cssText =
        'min-width:100%;box-sizing:border-box;' +
        'padding:4px 32px 12px;display:flex;flex-direction:column;gap:10px;'
      cardEl.innerHTML = card.build(s)
      this.cardTrack.appendChild(cardEl)
    }

    clip.appendChild(this.cardTrack)
    cardPanel.appendChild(clip)

    // ── Dot indicators ──────────────────────────────────────────────────────
    this.dotsEl = document.createElement('div')
    this.dotsEl.style.cssText =
      'display:flex;justify-content:center;gap:10px;padding:10px 0 6px;'
    cardPanel.appendChild(this.dotsEl)

    // ── Playtime counter ────────────────────────────────────────────────────
    this.timerEl = document.createElement('div')
    this.timerEl.style.cssText =
      'text-align:center;color:#b9d0d8;font-size:14px;letter-spacing:2px;' +
      'padding:4px 0 20px;font-variant-numeric:tabular-nums;'
    this.timerEl.textContent = this.formatPlaytime()
    cardPanel.appendChild(this.timerEl)
    // Timer is updated each frame via update(deltaTime) — no setInterval needed.

    root.appendChild(cardPanel)

    // ── Touch swipe ─────────────────────────────────────────────────────────
    cardPanel.addEventListener('touchstart', (e) => {
      this.touchStartX = e.changedTouches[0].clientX
    }, { passive: true })
    cardPanel.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - this.touchStartX
      if (Math.abs(dx) > 40) this.navigateCard(dx < 0 ? +1 : -1)
    }, { passive: true })

    // ── Keyboard left/right (active only while menu is open) ────────────────
    this.boundMenuKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') { e.preventDefault(); this.navigateCard(-1) }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); this.navigateCard(+1) }
    }
    document.addEventListener('keydown', this.boundMenuKeyDown)

    document.body.appendChild(root)
    this.panelRoot = root

    this.applyCardState()

    requestAnimationFrame(() => {
      if (this.panelRoot) this.panelRoot.style.opacity = '1'
    })
  }

  private hidePanels(): void {
    if (this.boundMenuKeyDown) {
      document.removeEventListener('keydown', this.boundMenuKeyDown)
      this.boundMenuKeyDown = null
    }
    this.timerEl = null
    if (!this.panelRoot) return
    const root = this.panelRoot
    this.panelRoot = null
    this.cardTrack = null
    this.cardTitleEl = null
    this.dotsEl = null
    root.style.opacity = '0'
    setTimeout(() => { if (root.parentNode) root.remove() }, 380)
  }

  // ============================================================================
  // CARD NAVIGATION
  // ============================================================================

  /** Step through cards by delta (+1 = next, -1 = prev), wrapping around. */
  private navigateCard(delta: number): void {
    const n = this.cards.length
    if (n === 0) return
    this.currentCardIndex = ((this.currentCardIndex + delta) % n + n) % n
    this.soundSystem?.playUISfx('click')
    this.applyCardState()
  }

  /** Sync track position, title label, and dot indicators to currentCardIndex. */
  private applyCardState(): void {
    if (!this.cardTrack || !this.cardTitleEl || !this.dotsEl) return
    const i = this.currentCardIndex
    const n = this.cards.length

    this.cardTrack.style.transform = `translateX(${-i * 100}%)`
    this.cardTitleEl.textContent = `${this.cards[i].title}  ${i + 1} / ${n}`

    this.dotsEl.innerHTML = ''
    for (let j = 0; j < n; j++) {
      const dot = document.createElement('span')
      dot.style.cssText =
        `font-size:11px;color:${j === i ? '#ffd866' : 'rgba(255,255,255,0.22)'};` +
        'transition:color 0.2s;line-height:1;'
      dot.textContent = '●'
      this.dotsEl.appendChild(dot)
    }
  }

  // ============================================================================
  // STAT ROW HELPER (used by default cards and any externally-built card)
  // ============================================================================

  /**
   * Single stat row: icon · label · value, with an optional progress bar.
   * Font sizes match Dialogue system: value at 18 px bold, label at 15 px.
   */
  private statRow(icon: string, label: string, value: string, barRatio?: number): string {
    const pct = barRatio !== undefined
      ? Math.round(Math.max(0, Math.min(1, barRatio)) * 100) : -1

    const barHtml = pct >= 0
      ? `<div style="height:3px;background:rgba(255,255,255,0.12);border-radius:2px;overflow:hidden;margin-top:5px;">` +
        `<div style="height:100%;width:${pct}%;background:#7CFC98;border-radius:2px;"></div></div>`
      : ''

    return (
      `<div style="display:flex;flex-direction:column;">` +
        `<div style="display:flex;align-items:baseline;gap:8px;">` +
          `<span style="color:#ffd866;font-size:13px;min-width:16px;text-align:center;">${icon}</span>` +
          `<span style="font-size:15px;letter-spacing:1px;flex:1;color:#eee;">${label}</span>` +
          `<span style="font-size:18px;font-weight:bold;color:#eefcff;letter-spacing:1px;">${value}</span>` +
        `</div>` +
        barHtml +
      `</div>`
    )
  }

  private formatPlaytime(): string {
    const totalSec = Math.floor(this.gameTimeMs / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(h)}:${pad(m)}:${pad(s)}`
  }

  private resolveStats(): PlayerMenuStats {
    return {
      hp:     this.stats.hp     ?? 30,
      maxHp:  this.stats.maxHp  ?? 30,
      mp:     this.stats.mp     ?? 15,
      maxMp:  this.stats.maxMp  ?? 15,
      level:  this.stats.level  ?? 1,
      exp:    this.stats.exp    ?? 0,
      maxExp: this.stats.maxExp ?? 100,
      attack: this.stats.attack  ?? 12,
      defense:this.stats.defense ?? 8,
      speed:  this.stats.speed   ?? 14,
      luck:   this.stats.luck    ?? 10,
      name:   this.stats.name   ?? 'Player',
    }
  }
}
