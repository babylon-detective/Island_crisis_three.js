import * as THREE from 'three'
import { SHADERS } from '../shaderImports'
import { RetroPostProcessingSystem } from './RetroPostProcessingSystem'

// Game Hub URL - change this to your actual deployed hub URL
const HUB_URL = 'https://www.dreamdealer.dev'

export interface TitleScreenConfig {
  onStart: () => Promise<void>
  onContinue: () => Promise<void>
}

export class TitleScreen {
  private scene: THREE.Scene
  private camera: THREE.OrthographicCamera
  private renderer: THREE.WebGLRenderer
  private retroPostProcessing: RetroPostProcessingSystem | null = null
  private shaderMaterial: THREE.ShaderMaterial | null = null
  private animationId: number | null = null
  private container: HTMLDivElement
  private uiContainer: HTMLDivElement
  private startTime: number = Date.now()
  private config: TitleScreenConfig
  private isActive: boolean = true
  private selectedIndex: number = 0
  private menuItems: string[] = ['menu-start', 'menu-continue', 'menu-hub']
  private gamepadState: { [key: string]: boolean } = {}
  private lastNavTime: number = 0

  constructor(config: TitleScreenConfig) {
    this.config = config
    
    // Create container
    this.container = document.createElement('div')
    this.container.id = 'titlescreen-container'
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 10000;
      background: black;
    `
    
    // Create UI container
    this.uiContainer = document.createElement('div')
    this.uiContainer.id = 'titlescreen-ui'
    this.uiContainer.innerHTML = `
      <div class="title-main">ISLAND CRISIS</div>
      <div class="title-menu">
        <div class="menu-item selected" id="menu-start">START</div>
        <div class="menu-item" id="menu-continue">CONTINUE</div>
        <div class="menu-item hub" id="menu-hub">GAME HUB</div>
      </div>
      <div class="loading-text">Loading...</div>
      <div class="controls-hint">D-pad / Arrows to navigate • A / Enter to select • B / Esc for Hub</div>
    `
    
    document.body.appendChild(this.container)
    document.body.appendChild(this.uiContainer)
    
    // Initialize Three.js scene
    this.scene = new THREE.Scene()
    
    // Orthographic camera for full-screen shader
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.container.appendChild(this.renderer.domElement)
    
    // Create shader plane
    this.createShaderPlane()
    
    // Initialize retro post-processing
    this.retroPostProcessing = new RetroPostProcessingSystem(
      this.renderer,
      this.scene,
      this.camera
    )
    
    // Setup event listeners
    this.setupEventListeners()
    
    // Start animation
    this.animate()
    
    console.log('🎬 Title Screen initialized')
  }

  private createShaderPlane(): void {
    const geometry = new THREE.PlaneGeometry(2, 2)
    
    // Load shaders
    const vertexShader = SHADERS['src/shaders/titlescreen-vertex.glsl']
    const fragmentShader = SHADERS['src/shaders/titlescreen-fragment.glsl']
    
    this.shaderMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
      }
    })
    
    const mesh = new THREE.Mesh(geometry, this.shaderMaterial)
    this.scene.add(mesh)
  }

  private setupEventListeners(): void {
    // Start button
    const startBtn = document.getElementById('menu-start')
    if (startBtn) {
      startBtn.addEventListener('click', () => this.handleStart())
      startBtn.addEventListener('mouseenter', () => {
        this.selectedIndex = 0
        this.updateMenuSelection()
        this.playHoverSound()
      })
    }
    
    // Continue button
    const continueBtn = document.getElementById('menu-continue')
    if (continueBtn) {
      continueBtn.addEventListener('click', () => this.handleContinue())
      continueBtn.addEventListener('mouseenter', () => {
        this.selectedIndex = 1
        this.updateMenuSelection()
        this.playHoverSound()
      })
      
      // Check if save data exists
      const hasSaveData = this.checkSaveData()
      if (!hasSaveData) {
        continueBtn.classList.add('disabled')
      }
    }
    
    // Hub button
    const hubBtn = document.getElementById('menu-hub')
    if (hubBtn) {
      hubBtn.addEventListener('click', () => this.handleHub())
      hubBtn.addEventListener('mouseenter', () => {
        this.selectedIndex = 2
        this.updateMenuSelection()
        this.playHoverSound()
      })
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!this.isActive) return
      
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        this.navigateMenu(-1)
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault()
        this.navigateMenu(1)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.selectCurrentItem()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.handleHub()
      }
    })
    
    // Window resize
    window.addEventListener('resize', () => this.onWindowResize())
    
    // Initial menu selection
    this.updateMenuSelection()
  }
  
  private navigateMenu(direction: number): void {
    this.selectedIndex = (this.selectedIndex + direction + this.menuItems.length) % this.menuItems.length
    this.updateMenuSelection()
    this.playHoverSound()
  }
  
  private updateMenuSelection(): void {
    this.menuItems.forEach((id, index) => {
      const item = document.getElementById(id)
      if (item) {
        if (index === this.selectedIndex) {
          item.classList.add('selected')
        } else {
          item.classList.remove('selected')
        }
      }
    })
  }
  
  private selectCurrentItem(): void {
    switch (this.selectedIndex) {
      case 0:
        this.handleStart()
        break
      case 1:
        this.handleContinue()
        break
      case 2:
        this.handleHub()
        break
    }
  }
  
  private pollGamepad(): void {
    const gamepads = navigator.getGamepads()
    const gp = gamepads[0]
    
    if (!gp) return
    
    const now = Date.now()
    const navCooldown = 200 // ms between navigation
    
    // D-pad or left stick navigation
    const upPressed = gp.buttons[12]?.pressed || gp.axes[1] < -0.5
    const downPressed = gp.buttons[13]?.pressed || gp.axes[1] > 0.5
    
    if (now - this.lastNavTime > navCooldown) {
      if (upPressed && !this.gamepadState['up']) {
        this.navigateMenu(-1)
        this.lastNavTime = now
      } else if (downPressed && !this.gamepadState['down']) {
        this.navigateMenu(1)
        this.lastNavTime = now
      }
    }
    
    this.gamepadState['up'] = upPressed
    this.gamepadState['down'] = downPressed
    
    // A button (confirm)
    const aPressed = gp.buttons[0]?.pressed
    if (aPressed && !this.gamepadState['a']) {
      this.selectCurrentItem()
    }
    this.gamepadState['a'] = aPressed
    
    // B button (hub)
    const bPressed = gp.buttons[1]?.pressed
    if (bPressed && !this.gamepadState['b']) {
      this.handleHub()
    }
    this.gamepadState['b'] = bPressed
    
    // Start button (confirm)
    const startPressed = gp.buttons[9]?.pressed
    if (startPressed && !this.gamepadState['start']) {
      this.selectCurrentItem()
    }
    this.gamepadState['start'] = startPressed
  }

  private checkSaveData(): boolean {
    // Check if there's saved game data in localStorage
    const persistentStates = localStorage.getItem('garden-persistent-states')
    const cameraState = localStorage.getItem('garden-camera-state')
    return !!(persistentStates || cameraState)
  }

  private playHoverSound(): void {
    // Placeholder for sound effect
    // You can add Web Audio API sound here
  }

  private async handleStart(): Promise<void> {
    if (!this.isActive) return
    this.isActive = false // prevent double-clicks while loading
    
    console.log('🎮 Starting new game...')
    
    // Load the game while the title screen is still visible.
    // The onStart callback updates loading text as it progresses.
    await this.config.onStart()
    
    // Content is ready — fade out and reveal the running game
    this.fadeOut(() => {
      this.dispose()
    })
  }

  private async handleContinue(): Promise<void> {
    if (!this.isActive) return
    
    const hasSaveData = this.checkSaveData()
    if (!hasSaveData) {
      console.log('⚠️ No save data found')
      return
    }
    this.isActive = false // prevent double-clicks while loading
    
    console.log('🎮 Continuing game...')
    
    // Load the game while the title screen is still visible
    await this.config.onContinue()
    
    // Content is ready — fade out and reveal the running game
    this.fadeOut(() => {
      this.dispose()
    })
  }

  private handleHub(): void {
    if (!this.isActive) return
    
    console.log('🎮 Navigating to Game Hub...')
    this.fadeOut(() => {
      window.location.href = HUB_URL
    })
  }

  private fadeOut(callback: () => void): void {
    this.isActive = false
    
    // Add fade-out class
    this.container.style.transition = 'opacity 1s ease-out'
    this.uiContainer.style.transition = 'opacity 1s ease-out'
    
    this.container.style.opacity = '0'
    this.uiContainer.style.opacity = '0'
    
    setTimeout(() => {
      callback()
    }, 1000)
  }

  private onWindowResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    
    if (this.shaderMaterial) {
      this.shaderMaterial.uniforms.uResolution.value.set(
        window.innerWidth,
        window.innerHeight
      )
    }
    
    // Update retro post-processing on resize
    if (this.retroPostProcessing) {
      this.retroPostProcessing.handleResize()
    }
  }

  private animate = (): void => {
    if (!this.isActive) return
    
    this.animationId = requestAnimationFrame(this.animate)
    
    // Poll gamepad input
    this.pollGamepad()
    
    // Update time uniform
    if (this.shaderMaterial) {
      const elapsed = (Date.now() - this.startTime) * 0.001
      this.shaderMaterial.uniforms.uTime.value = elapsed
    }
    
    // Render with retro post-processing
    if (this.retroPostProcessing) {
      this.retroPostProcessing.render(this.camera)
    } else {
      // Fallback to normal render
      this.renderer.render(this.scene, this.camera)
    }
  }

  public hideLoadingText(): void {
    const loadingText = document.querySelector('.loading-text') as HTMLElement
    if (loadingText) {
      loadingText.style.opacity = '0'
      setTimeout(() => {
        loadingText.style.display = 'none'
      }, 500)
    }
  }

  public updateLoadingText(text: string): void {
    const loadingText = document.querySelector('.loading-text') as HTMLElement
    if (loadingText) {
      loadingText.textContent = text
    }
  }

  public dispose(): void {
    this.isActive = false
    
    // Stop animation
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
    }
    
    // Dispose retro post-processing
    if (this.retroPostProcessing) {
      this.retroPostProcessing.dispose()
      this.retroPostProcessing = null
    }
    
    // Dispose Three.js resources
    if (this.shaderMaterial) {
      this.shaderMaterial.dispose()
    }
    
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        if (object.material instanceof THREE.Material) {
          object.material.dispose()
        }
      }
    })
    
    this.renderer.dispose()
    
    // Remove DOM elements
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container)
    }
    if (this.uiContainer.parentNode) {
      this.uiContainer.parentNode.removeChild(this.uiContainer)
    }
    
    console.log('🎬 Title Screen disposed')
  }
}
