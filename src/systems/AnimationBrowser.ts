/**
 * Animation Browser — overlay UI for testing character animations.
 *
 * Toggle with ` key (backtick).
 * Arrow Up / Down or scroll wheel to change animation.
 * Arrow Left / Right to adjust playback speed.
 * Space to pause/resume.
 *
 * While the browser is open the AnimationStateMachine is disconnected so
 * you can preview any clip in isolation.
 */

import { CharacterAnimationSystem } from './CharacterAnimationSystem'

export class AnimationBrowser {
  private container: HTMLElement | null = null
  private listEl: HTMLElement | null = null
  private infoEl: HTMLElement | null = null
  private visible = false
  private clips: string[] = []
  private selectedIndex = 0
  private characterId: string
  private charAnimSystem: CharacterAnimationSystem
  private paused = false
  private timeScale = 1.0
  /** Callback to disable/enable the state machine while browsing */
  private onBrowsingStateChange?: (browsing: boolean) => void
  private boundKeyHandler: (e: KeyboardEvent) => void
  private boundWheelHandler: (e: WheelEvent) => void

  constructor(
    charAnimSystem: CharacterAnimationSystem,
    characterId: string,
    onBrowsingStateChange?: (browsing: boolean) => void,
  ) {
    this.charAnimSystem = charAnimSystem
    this.characterId = characterId
    this.onBrowsingStateChange = onBrowsingStateChange
    this.boundKeyHandler = this.onKey.bind(this)
    this.boundWheelHandler = this.onWheel.bind(this)

    window.addEventListener('keydown', this.boundKeyHandler)
    window.addEventListener('wheel', this.boundWheelHandler, { passive: false })
  }

  // ── Toggle ──────────────────────────────────────────────────────────

  toggle(): void {
    if (this.visible) {
      this.hide()
    } else {
      this.show()
    }
  }

  show(): void {
    this.clips = this.charAnimSystem.getLoadedClips(this.characterId)
    if (this.clips.length === 0) {
      console.warn('AnimationBrowser: no clips loaded for', this.characterId)
      return
    }

    // Clamp selected index
    if (this.selectedIndex >= this.clips.length) this.selectedIndex = 0

    this.visible = true
    this.paused = false
    this.timeScale = 1.0
    this.onBrowsingStateChange?.(true)
    this.buildUI()
    this.playSelected()
  }

  hide(): void {
    this.visible = false
    this.onBrowsingStateChange?.(false)
    this.destroyUI()
  }

  isVisible(): boolean {
    return this.visible
  }

  // ── Input ───────────────────────────────────────────────────────────

  private onKey(e: KeyboardEvent): void {
    // Backtick toggles browser
    if (e.code === 'Backquote') {
      e.preventDefault()
      this.toggle()
      return
    }

    if (!this.visible) return

    switch (e.code) {
      case 'ArrowUp':
        e.preventDefault()
        this.navigate(-1)
        break
      case 'ArrowDown':
        e.preventDefault()
        this.navigate(1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        this.adjustSpeed(-0.1)
        break
      case 'ArrowRight':
        e.preventDefault()
        this.adjustSpeed(0.1)
        break
      case 'Space':
        e.preventDefault()
        this.togglePause()
        break
      case 'Escape':
        e.preventDefault()
        this.hide()
        break
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.visible) return
    e.preventDefault()
    const direction = e.deltaY > 0 ? 1 : -1
    this.navigate(direction)
  }

  // ── Navigation ──────────────────────────────────────────────────────

  private navigate(delta: number): void {
    this.selectedIndex = (this.selectedIndex + delta + this.clips.length) % this.clips.length
    this.playSelected()
    this.updateUI()
  }

  private adjustSpeed(delta: number): void {
    this.timeScale = Math.round(Math.max(0.1, Math.min(3.0, this.timeScale + delta)) * 10) / 10
    this.charAnimSystem.setTimeScale(this.characterId, this.timeScale)
    this.updateUI()
  }

  private togglePause(): void {
    this.paused = !this.paused
    this.charAnimSystem.setPaused(this.characterId, this.paused)
    this.updateUI()
  }

  private playSelected(): void {
    const name = this.clips[this.selectedIndex]
    this.charAnimSystem.play(this.characterId, name, this.timeScale)
    this.charAnimSystem.setPaused(this.characterId, this.paused)
  }

  // ── UI ──────────────────────────────────────────────────────────────

  private buildUI(): void {
    this.destroyUI()

    this.container = document.createElement('div')
    this.container.id = 'anim-browser'
    Object.assign(this.container.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      width: '280px',
      maxHeight: '80vh',
      background: 'rgba(10,10,18,0.92)',
      border: '1px solid rgba(100,220,255,0.35)',
      borderRadius: '6px',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: '12px',
      color: '#d0e8f0',
      zIndex: '10000',
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none',
      backdropFilter: 'blur(6px)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    } as CSSStyleDeclaration)

    // Header
    const header = document.createElement('div')
    Object.assign(header.style, {
      padding: '8px 12px',
      borderBottom: '1px solid rgba(100,220,255,0.2)',
      fontWeight: 'bold',
      fontSize: '13px',
      color: '#64dcff',
      display: 'flex',
      justifyContent: 'space-between',
    } as CSSStyleDeclaration)
    header.innerHTML = `ANIMATION BROWSER <span style="font-weight:normal;color:#888;font-size:11px">\` to close</span>`
    this.container.appendChild(header)

    // Info bar
    this.infoEl = document.createElement('div')
    Object.assign(this.infoEl.style, {
      padding: '6px 12px',
      borderBottom: '1px solid rgba(100,220,255,0.12)',
      fontSize: '11px',
      color: '#88aabb',
      lineHeight: '1.5',
    } as CSSStyleDeclaration)
    this.container.appendChild(this.infoEl)

    // Clip list
    this.listEl = document.createElement('div')
    Object.assign(this.listEl.style, {
      overflowY: 'auto',
      flex: '1',
      padding: '4px 0',
    } as CSSStyleDeclaration)
    this.container.appendChild(this.listEl)

    // Controls hint
    const hint = document.createElement('div')
    Object.assign(hint.style, {
      padding: '6px 12px',
      borderTop: '1px solid rgba(100,220,255,0.15)',
      fontSize: '10px',
      color: '#556',
      lineHeight: '1.4',
    } as CSSStyleDeclaration)
    hint.innerHTML = '↑↓ / scroll: select &nbsp; ←→ speed &nbsp; Space: pause &nbsp; Esc: close'
    this.container.appendChild(hint)

    document.body.appendChild(this.container)
    this.updateUI()
  }

  private updateUI(): void {
    if (!this.listEl || !this.infoEl) return

    const current = this.clips[this.selectedIndex] ?? '—'

    this.infoEl.innerHTML = [
      `<b style="color:#e0e0e0">${current}</b>`,
      `clip ${this.selectedIndex + 1} / ${this.clips.length}`,
      `speed: ${this.timeScale.toFixed(1)}x${this.paused ? ' &nbsp;<span style="color:#f66">⏸ PAUSED</span>' : ''}`,
    ].join(' &nbsp;·&nbsp; ')

    // Rebuild list
    this.listEl.innerHTML = ''
    for (let i = 0; i < this.clips.length; i++) {
      const row = document.createElement('div')
      const isSelected = i === this.selectedIndex
      Object.assign(row.style, {
        padding: '4px 12px',
        cursor: 'pointer',
        background: isSelected ? 'rgba(100,220,255,0.15)' : 'transparent',
        color: isSelected ? '#64dcff' : '#8899aa',
        fontWeight: isSelected ? 'bold' : 'normal',
        borderLeft: isSelected ? '3px solid #64dcff' : '3px solid transparent',
        transition: 'background 0.1s',
      } as CSSStyleDeclaration)
      row.textContent = `${(i + 1).toString().padStart(2, ' ')}  ${this.clips[i]}`
      row.addEventListener('mouseenter', () => {
        if (!isSelected) row.style.background = 'rgba(100,220,255,0.07)'
      })
      row.addEventListener('mouseleave', () => {
        if (!isSelected) row.style.background = 'transparent'
      })
      row.addEventListener('click', () => {
        this.selectedIndex = i
        this.playSelected()
        this.updateUI()
      })
      this.listEl!.appendChild(row)
    }

    // Scroll selected into view
    const selectedRow = this.listEl.children[this.selectedIndex] as HTMLElement | undefined
    selectedRow?.scrollIntoView({ block: 'nearest' })
  }

  private destroyUI(): void {
    if (this.container) {
      this.container.remove()
      this.container = null
      this.listEl = null
      this.infoEl = null
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  dispose(): void {
    window.removeEventListener('keydown', this.boundKeyHandler)
    window.removeEventListener('wheel', this.boundWheelHandler)
    this.destroyUI()
  }
}
