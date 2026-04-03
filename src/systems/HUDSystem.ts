/**
 * HUD System - DOM-based overlay for displaying game information
 * Features:
 * - Input state display (WASD, mouse, etc.)
 * - Mode switching interface
 * - Toggle visibility with 'G' key
 * - CSS-styled modern appearance
 */

export interface HUDData {
  // Player state
  position: { x: number; y: number; z: number }
  velocity: { x: number; y: number; z: number }
  onGround: boolean
  
  // Input states
  keys: {
    w: boolean
    a: boolean
    s: boolean
    d: boolean
    space: boolean
    shift: boolean
    c: boolean // Camera mode switching
  }
  mouse: {
    x: number
    y: number
    leftButton: boolean
    rightButton: boolean
  }
  gamepad?: {
    connected: boolean
    id: string
    leftStick: { x: number; y: number }
    rightStick: { x: number; y: number }
    buttons: {
      a: boolean
      b: boolean
      x: boolean
      y: boolean
      lb: boolean
      rb: boolean
      lt: number
      rt: number
    }
  }
  
  // System states
  mode: string
  fps: number
  terrainHeight: number
  groundHeight?: number
  centerDelta?: number
  snapApplied?: boolean
  
  // Performance
  triangles: number
  drawCalls: number

  // Adaptive quality (debug-only)
  qualityTier?: string
  qualityFpsRange?: string
}

export class HUDSystem {
  private container: HTMLElement
  private isVisible: boolean = false // Start hidden by default
  private data: Partial<HUDData> = {}
  private updateCallbacks: Map<string, () => void> = new Map()
  
  // Smoothing for velocity values to prevent flickering
  private smoothedVelocity: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
  private readonly velocitySmoothingFactor: number = 0.3 // Lower = more smoothing (0.0 to 1.0)
  
  // DOM elements
  private elements: {
    playerInfo?: HTMLElement
    inputDisplay?: HTMLElement
    systemInfo?: HTMLElement
    performanceInfo?: HTMLElement
  } = {}

  constructor() {
    this.container = this.createHUDContainer()
    this.createHUDElements()
    this.setupEventListeners()
    this.setupStyles()
    
    // Hide HUD by default on initialization
    this.container.classList.add('hidden')
    
    console.log('🖥️ HUD System initialized (hidden by default)')
  }

  /**
   * Create main HUD container
   */
  private createHUDContainer(): HTMLElement {
    const container = document.createElement('div')
    container.id = 'hud-container'
    container.className = 'hud-container'
    
    // Insert at the beginning of body to ensure it's on top
    document.body.insertBefore(container, document.body.firstChild)
    
    return container
  }

  /**
   * Create all HUD elements
   */
  private createHUDElements(): void {
    // Player info panel
    this.elements.playerInfo = this.createPanel('player-info', 'Player Info', [
      { id: 'position', label: 'Position', value: '0, 0, 0' },
      { id: 'velocity', label: 'Velocity', value: '0, 0, 0' },
      { id: 'on-ground', label: 'On Ground', value: 'false' },
      { id: 'terrain-height', label: 'Terrain Height', value: '0.0' },
      { id: 'ground-height', label: 'Ground Height', value: '0.0' },
      { id: 'center-delta', label: 'Center Delta', value: '0.000' },
      { id: 'snap-applied', label: 'Snap Applied', value: 'false' }
    ])

    // Input display panel
    this.elements.inputDisplay = this.createPanel('input-display', 'Input State', [
      { id: 'keys-wasd', label: 'WASD', value: '----' },
      { id: 'keys-other', label: 'Space/Shift/C', value: '---' },
      { id: 'mouse-pos', label: 'Mouse', value: '0, 0' },
      { id: 'mouse-buttons', label: 'Buttons', value: '--' },
      { id: 'mouse-mode', label: 'Mouse Mode', value: 'Camera Look' },
      { id: 'gamepad-status', label: 'Gamepad', value: 'Not Connected' },
      { id: 'gamepad-sticks', label: 'Sticks L/R', value: '(0,0) / (0,0)' },
      { id: 'gamepad-buttons', label: 'Xbox Buttons', value: 'A:- B:- X:- Y:-' },
      { id: 'gamepad-triggers', label: 'Triggers L/R', value: '0.0 / 0.0' }
    ])

    // System info panel
    this.elements.systemInfo = this.createPanel('system-info', 'System Info', [
      { id: 'fps', label: 'FPS', value: '60' },
      { id: 'quality', label: 'Quality', value: '-' },
      { id: 'quality-range', label: 'FPS Range', value: '-' },
      { id: 'mode', label: 'Mode', value: 'Normal' },
      { id: 'triangles', label: 'Triangles', value: '0' },
      { id: 'draw-calls', label: 'Draw Calls', value: '0' }
    ])

    // Add toggle hint
    this.createToggleHint()
  }

  /**
   * Create a data panel
   */
  private createPanel(id: string, title: string, fields: Array<{id: string, label: string, value: string}>): HTMLElement {
    const panel = document.createElement('div')
    panel.className = 'hud-panel'
    panel.id = id

    const titleElement = document.createElement('div')
    titleElement.className = 'hud-panel-title'
    titleElement.textContent = title
    panel.appendChild(titleElement)

    const content = document.createElement('div')
    content.className = 'hud-panel-content'

    fields.forEach(field => {
      const row = document.createElement('div')
      row.className = 'hud-row'

      const label = document.createElement('span')
      label.className = 'hud-label'
      label.textContent = field.label + ':'

      const value = document.createElement('span')
      value.className = 'hud-value'
      value.id = `hud-${field.id}`
      value.textContent = field.value

      row.appendChild(label)
      row.appendChild(value)
      content.appendChild(row)
    })

    panel.appendChild(content)
    this.container.appendChild(panel)

    return panel
  }

  /**
   * Create toggle hint
   */
  private createToggleHint(): void {
    const hint = document.createElement('div')
    hint.className = 'hud-toggle-hint'
    hint.textContent = 'Press G to toggle HUD'
    this.container.appendChild(hint)
  }

  /**
   * Setup CSS styles
   */
  private setupStyles(): void {
    const style = document.createElement('style')
    style.textContent = `
      .hud-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10000;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        color: #00ff00;
        transition: opacity 0.3s ease;
      }

      .hud-container.hidden {
        opacity: 0;
        pointer-events: none;
        display: none;
      }

      .hud-panel {
        position: absolute;
        background: rgba(0, 20, 0, 0.8);
        border: 1px solid #00ff00;
        border-radius: 4px;
        padding: 8px;
        backdrop-filter: blur(4px);
        box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
        min-width: 200px;
        pointer-events: auto;
      }

      .hud-panel-title {
        font-weight: bold;
        color: #00ffff;
        margin-bottom: 8px;
        text-align: center;
        border-bottom: 1px solid #00ff0040;
        padding-bottom: 4px;
      }

      .hud-panel-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .hud-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .hud-label {
        color: #88ff88;
        min-width: 80px;
      }

      .hud-value {
        color: #ffffff;
        font-weight: bold;
        text-align: right;
        font-family: 'Courier New', monospace;
      }

      .hud-toggle-hint {
        position: absolute;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 20, 0, 0.6);
        color: #88ff88;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 10px;
        pointer-events: none;
      }

      /* Panel positioning */
      #player-info {
        top: 20px;
        left: 20px;
      }

      #input-display {
        top: 20px;
        left: 250px;
        min-width: 280px; /* Wider for mouse mode text */
      }

      #system-info {
        top: 20px;
        right: 20px;
      }

      /* Active input highlighting */
      .hud-value.active {
        color: #ffff00;
        text-shadow: 0 0 3px #ffff00;
      }

      /* Performance indicators */
      .hud-value.good { color: #00ff00; }
      .hud-value.warning { color: #ffff00; }
      .hud-value.critical { color: #ff0000; }

      /* Responsive design */
      @media (max-width: 768px) {
        .hud-panel {
          font-size: 10px;
          padding: 6px;
          min-width: 150px;
        }
        
        #input-display {
          top: 140px;
          left: 20px;
          min-width: 200px;
        }
        
        #system-info {
          top: 280px;
          left: 20px;
        }
      }
    `
    
    document.head.appendChild(style)
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Toggle HUD with 'G' key
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && !e.repeat) {
        this.toggle()
      }
    })

    // Prevent HUD from interfering with game input
    this.container.addEventListener('keydown', (e) => {
      e.stopPropagation()
    })

    this.container.addEventListener('keyup', (e) => {
      e.stopPropagation()
    })
  }

  /**
   * Update HUD data
   */
  public updateData(newData: Partial<HUDData>): void {
    this.data = { ...this.data, ...newData }
    this.render()
  }

  /**
   * Render HUD with current data
   */
  private render(): void {
    if (!this.isVisible) return

    // Update player info
    if (this.data.position) {
      this.updateElement('position', 
        `${this.data.position.x.toFixed(1)}, ${this.data.position.y.toFixed(1)}, ${this.data.position.z.toFixed(1)}`)
    }
    
    if (this.data.velocity) {
      // Smooth velocity values to prevent flickering
      this.smoothedVelocity.x += (this.data.velocity.x - this.smoothedVelocity.x) * this.velocitySmoothingFactor
      this.smoothedVelocity.y += (this.data.velocity.y - this.smoothedVelocity.y) * this.velocitySmoothingFactor
      this.smoothedVelocity.z += (this.data.velocity.z - this.smoothedVelocity.z) * this.velocitySmoothingFactor
      
      this.updateElement('velocity', 
        `${this.smoothedVelocity.x.toFixed(1)}, ${this.smoothedVelocity.y.toFixed(1)}, ${this.smoothedVelocity.z.toFixed(1)}`)
    }
    
    if (this.data.onGround !== undefined) {
      this.updateElement('on-ground', this.data.onGround ? 'true' : 'false', 
        this.data.onGround ? 'good' : 'warning')
    }
    
    if (this.data.terrainHeight !== undefined) {
      this.updateElement('terrain-height', this.data.terrainHeight.toFixed(2))
    }

    if (this.data.groundHeight !== undefined) {
      this.updateElement('ground-height', this.data.groundHeight.toFixed(2))
    }

    if (this.data.centerDelta !== undefined) {
      const deltaClass = Math.abs(this.data.centerDelta) > 0.05 ? 'warning' : 'good'
      this.updateElement('center-delta', this.data.centerDelta.toFixed(3), deltaClass)
    }

    if (this.data.snapApplied !== undefined) {
      this.updateElement('snap-applied', this.data.snapApplied ? 'true' : 'false', this.data.snapApplied ? 'active' : '')
    }

    // Update input display
    if (this.data.keys) {
      const wasd = [
        this.data.keys.w ? 'W' : '-',
        this.data.keys.a ? 'A' : '-',
        this.data.keys.s ? 'S' : '-',
        this.data.keys.d ? 'D' : '-'
      ].join('')
      this.updateElement('keys-wasd', wasd, this.hasActiveKeys() ? 'active' : '')
      
      const other = [
        this.data.keys.space ? 'SP' : '--',
        this.data.keys.shift ? 'SH' : '--',
        this.data.keys.c ? 'C' : '-'
      ].join(' ')
      this.updateElement('keys-other', other, 
        (this.data.keys.space || this.data.keys.shift || this.data.keys.c) ? 'active' : '')
    }
    
    if (this.data.mouse) {
      this.updateElement('mouse-pos', `${this.data.mouse.x.toFixed(0)}, ${this.data.mouse.y.toFixed(0)}`)
      
      const buttons = [
        this.data.mouse.leftButton ? 'L' : '-',
        this.data.mouse.rightButton ? 'R' : '-'
      ].join('')
      this.updateElement('mouse-buttons', buttons, 
        (this.data.mouse.leftButton || this.data.mouse.rightButton) ? 'active' : '')
    }

    // Update mouse mode functionality based on current mode
    if (this.data.mode) {
      const mouseFunctionality = this.getMouseFunctionality(this.data.mode.toLowerCase())
      this.updateElement('mouse-mode', mouseFunctionality)
    }

    // Update gamepad display
    if (this.data.gamepad) {
      if (this.data.gamepad.connected) {
        // Gamepad status
        const gamepadName = this.data.gamepad.id.includes('Xbox') ? 'Xbox Controller' : 
                           this.data.gamepad.id.includes('PlayStation') ? 'PlayStation Controller' : 
                           'Gamepad'
        this.updateElement('gamepad-status', gamepadName, 'good')
        
        // Stick positions
        const leftStick = `(${this.data.gamepad.leftStick.x.toFixed(1)},${this.data.gamepad.leftStick.y.toFixed(1)})`
        const rightStick = `(${this.data.gamepad.rightStick.x.toFixed(1)},${this.data.gamepad.rightStick.y.toFixed(1)})`
        this.updateElement('gamepad-sticks', `${leftStick} / ${rightStick}`, 
          (Math.abs(this.data.gamepad.leftStick.x) > 0.1 || Math.abs(this.data.gamepad.leftStick.y) > 0.1 ||
           Math.abs(this.data.gamepad.rightStick.x) > 0.1 || Math.abs(this.data.gamepad.rightStick.y) > 0.1) ? 'active' : '')
        
        // Button states
        const buttons = [
          `A:${this.data.gamepad.buttons.a ? '●' : '-'}`,
          `B:${this.data.gamepad.buttons.b ? '●' : '-'}`,
          `X:${this.data.gamepad.buttons.x ? '●' : '-'}`,
          `Y:${this.data.gamepad.buttons.y ? '●' : '-'}`
        ].join(' ')
        this.updateElement('gamepad-buttons', buttons, 
          (this.data.gamepad.buttons.a || this.data.gamepad.buttons.b || 
           this.data.gamepad.buttons.x || this.data.gamepad.buttons.y) ? 'active' : '')
        
        // Trigger values
        const triggers = `${this.data.gamepad.buttons.lt.toFixed(1)} / ${this.data.gamepad.buttons.rt.toFixed(1)}`
        this.updateElement('gamepad-triggers', triggers, 
          (this.data.gamepad.buttons.lt > 0.1 || this.data.gamepad.buttons.rt > 0.1) ? 'active' : '')
      } else {
        this.updateElement('gamepad-status', 'Not Connected', 'warning')
        this.updateElement('gamepad-sticks', '(0,0) / (0,0)', '')
        this.updateElement('gamepad-buttons', 'A:- B:- X:- Y:-', '')
        this.updateElement('gamepad-triggers', '0.0 / 0.0', '')
      }
    } else {
      this.updateElement('gamepad-status', 'Not Detected', 'error')
      this.updateElement('gamepad-sticks', '(0,0) / (0,0)', '')
      this.updateElement('gamepad-buttons', 'A:- B:- X:- Y:-', '')
      this.updateElement('gamepad-triggers', '0.0 / 0.0', '')
    }

    // Update system info
    if (this.data.fps !== undefined) {
      let fpsClass = 'good'
      if (this.data.fps < 30) fpsClass = 'critical'
      else if (this.data.fps < 50) fpsClass = 'warning'
      this.updateElement('fps', this.data.fps.toFixed(0), fpsClass)
    }

    // Adaptive quality telemetry (only populated in debug mode)
    if (this.data.qualityTier) {
      const tier = this.data.qualityTier
      let tierClass = ''
      if (tier.startsWith('LOW')) tierClass = 'critical'
      else if (tier.startsWith('MEDIUM')) tierClass = 'warning'
      else tierClass = 'good'
      this.updateElement('quality', tier, tierClass)
    }
    if (this.data.qualityFpsRange) {
      this.updateElement('quality-range', this.data.qualityFpsRange)
    }
    
    if (this.data.mode) {
      this.updateElement('mode', this.data.mode)
    }
    
    if (this.data.triangles !== undefined) {
      this.updateElement('triangles', this.formatNumber(this.data.triangles))
    }
    
    if (this.data.drawCalls !== undefined) {
      this.updateElement('draw-calls', this.data.drawCalls.toString())
    }
  }

  /**
   * Update a specific element
   */
  private updateElement(id: string, value: string, className: string = ''): void {
    const element = document.getElementById(`hud-${id}`)
    if (element) {
      element.textContent = value
      element.className = `hud-value ${className}`
    }
  }

  /**
   * Check if any movement keys are active
   */
  private hasActiveKeys(): boolean {
    if (!this.data.keys) return false
    return this.data.keys.w || this.data.keys.a || this.data.keys.s || this.data.keys.d
  }

  /**
   * Get mouse/trackpad functionality description based on current mode
   */
  private getMouseFunctionality(mode: string): string {
    switch (mode) {
      case 'system':
        return 'Orbit Camera (L: Rotate, R: Pan, Wheel: Zoom)'
      case 'player':
        return 'Look Around (Move: Look, L: Select, R: Context)'
      case 'debug':
        return 'Debug View (L: Inspect, R: Measure, Wheel: Zoom)'
      case 'performance':
        return 'Performance Mode (L: Profile, Wheel: Scale)'
      case 'wireframe':
        return 'Wireframe View (L: Select, R: Toggle, Wheel: Zoom)'
      case 'collision':
        return 'Collision Debug (L: Test Point, R: Show Bounds)'
      default:
        return 'Camera Look (Move: Look Around)'
    }
  }

  /**
   * Format large numbers
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
    return num.toString()
  }

  /**
   * Toggle HUD visibility
   */
  public toggle(): void {
    this.isVisible = !this.isVisible
    this.container.classList.toggle('hidden', !this.isVisible)
    console.log(`🖥️ HUD ${this.isVisible ? 'shown' : 'hidden'}`)
  }

  /**
   * Show HUD
   */
  public show(): void {
    this.isVisible = true
    this.container.classList.remove('hidden')
  }

  /**
   * Hide HUD
   */
  public hide(): void {
    this.isVisible = false
    this.container.classList.add('hidden')
  }

  /**
   * Register callback for specific updates
   */
  public onUpdate(type: string, callback: () => void): void {
    this.updateCallbacks.set(type, callback)
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container)
    }
    this.updateCallbacks.clear()
    console.log('🖥️ HUD System disposed')
  }
}
