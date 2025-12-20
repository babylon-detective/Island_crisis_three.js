import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import * as THREE from 'three'
import { ObjectManager } from './ObjectManager'
import { AnimationSystem } from './AnimationSystem'
import { ConfigManager } from './ConfigManager'
import { performanceMonitor } from './PerformanceMonitor'
import { logger, LogModule } from './Logger'

export interface DebugGUIConfig {
  mainGUIPosition?: { top: string; right: string }
  environmentGUIPosition?: { top: string; right: string }
  performanceGUIPosition?: { top: string; right: string }
  playerGUIPosition?: { top: string; right: string }
}

export interface SystemReferences {
  scene: THREE.Scene
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer
  objectManager: ObjectManager
  animationSystem: AnimationSystem
  configManager?: ConfigManager
  collisionSystem?: any
  cameraManager?: any
  playerController?: any
  oceanLODSystem?: any
  landSystem?: any
  sky?: any
  skyConfig?: any
  parameterManager?: any
  parameterGUI?: any
  deviceType: string
  inputMethods: string[]
}

export class DebugGUIManager {
  private mainGUI: GUI | null = null
  private container: HTMLElement
  private systems: SystemReferences
  private config: DebugGUIConfig

  constructor(container: HTMLElement, systems: SystemReferences, config: DebugGUIConfig = {}) {
    this.container = container
    this.systems = systems
    this.config = {
      mainGUIPosition: { top: '0px', right: '0px' },
      environmentGUIPosition: { top: '0px', right: '320px' },
      performanceGUIPosition: { top: '0px', right: '640px' },
      playerGUIPosition: { top: '0px', right: '960px' },
      ...config
    }
  }

  /**
   * Initialize GUI (empty for now, ready for future debug controls)
   */
  public initialize(): void {
    // Create hidden GUI ready for future debug controls
    this.mainGUI = new GUI({ width: 300 })
    this.mainGUI.domElement.style.position = 'fixed'
    this.mainGUI.domElement.style.top = this.config.mainGUIPosition!.top
    this.mainGUI.domElement.style.right = this.config.mainGUIPosition!.right
    this.mainGUI.domElement.style.zIndex = '1000'
    this.mainGUI.domElement.style.display = 'none' // Hidden by default
    this.container.appendChild(this.mainGUI.domElement)
    
    logger.info(LogModule.SYSTEM, 'Debug GUI Manager initialized (empty, ready for future controls)')
  }

  /**
   * Show debug GUI
   */
  public show(): void {
    if (this.mainGUI) {
      this.mainGUI.domElement.style.display = 'block'
    }
  }

  /**
   * Hide debug GUI
   */
  public hide(): void {
    if (this.mainGUI) {
      this.mainGUI.domElement.style.display = 'none'
    }
  }

  /**
   * Toggle debug GUI visibility
   */
  public toggle(): void {
    if (this.mainGUI) {
      const isVisible = this.mainGUI.domElement.style.display !== 'none'
      this.mainGUI.domElement.style.display = isVisible ? 'none' : 'block'
    }
  }

  /**
   * Dispose of all GUI elements
   */
  public dispose(): void {
    if (this.mainGUI) {
      this.mainGUI.destroy()
      this.mainGUI = null
    }
    
    logger.info(LogModule.SYSTEM, 'Debug GUI Manager disposed')
  }

  /**
   * Get GUI instance (for adding custom controls later)
   */
  public getGUI(): GUI | null {
    return this.mainGUI
  }

  /**
   * Get all GUI instances (backward compatibility)
   */
  public getGUIs(): { main: GUI | null; environment: GUI | null; performance: GUI | null; player: GUI | null } {
    return {
      main: this.mainGUI,
      environment: null,
      performance: null,
      player: null
    }
  }
}
