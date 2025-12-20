import * as THREE from 'three'
import { SHADERS } from '../shaderImports'
import { RetroPostProcessingSystem } from './RetroPostProcessingSystem'

export interface TitleScreenConfig {
  onStart: () => void
  onContinue: () => void
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
        <div class="menu-item" id="menu-start">START</div>
        <div class="menu-item" id="menu-continue">CONTINUE</div>
      </div>
      <div class="loading-text">Loading...</div>
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
      startBtn.addEventListener('mouseenter', () => this.playHoverSound())
    }
    
    // Continue button
    const continueBtn = document.getElementById('menu-continue')
    if (continueBtn) {
      continueBtn.addEventListener('click', () => this.handleContinue())
      continueBtn.addEventListener('mouseenter', () => this.playHoverSound())
      
      // Check if save data exists
      const hasSaveData = this.checkSaveData()
      if (!hasSaveData) {
        continueBtn.classList.add('disabled')
      }
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!this.isActive) return
      
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.handleStart()
      }
    })
    
    // Window resize
    window.addEventListener('resize', () => this.onWindowResize())
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

  private handleStart(): void {
    if (!this.isActive) return
    
    console.log('🎮 Starting new game...')
    this.fadeOut(() => {
      this.config.onStart()
      this.dispose()
    })
  }

  private handleContinue(): void {
    if (!this.isActive) return
    
    const hasSaveData = this.checkSaveData()
    if (!hasSaveData) {
      console.log('⚠️ No save data found')
      return
    }
    
    console.log('🎮 Continuing game...')
    this.fadeOut(() => {
      this.config.onContinue()
      this.dispose()
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
