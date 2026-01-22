import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import * as THREE from 'three'
import { logger, LogModule } from './Logger'

export interface SystemReferences {
  scene: THREE.Scene
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer
  cameraManager?: any
  playerController?: any
  sky?: any
  skyConfig?: any
}

/**
 * Simplified Debug GUI - only essential controls
 * Sky, Light, Camera, Player
 */
export class DebugGUIManager {
  private gui: GUI | null = null
  private container: HTMLElement
  private systems: SystemReferences
  private folders: {
    sky?: any
    light?: any
    camera?: any
    player?: any
  } = {}

  constructor(container: HTMLElement, systems: SystemReferences) {
    this.container = container
    this.systems = systems
  }

  /**
   * Initialize focused debug GUI with only essential controls
   */
  public initialize(): void {
    this.gui = new GUI({ width: 320, title: '🎮 Debug Controls' })
    this.gui.domElement.style.position = 'fixed'
    this.gui.domElement.style.top = '10px'
    this.gui.domElement.style.right = '10px'
    this.gui.domElement.style.zIndex = '1000'
    this.container.appendChild(this.gui.domElement)
    
    // Setup controls only for systems that exist
    try {
      this.setupSkyControls()
      this.setupLightControls()
      this.setupCameraControls()
      this.setupPlayerControls()
    } catch (error) {
      logger.error(LogModule.SYSTEM, 'Error setting up debug controls:', error)
    }
    
    // Start closed
    this.gui.close()
    
    logger.info(LogModule.SYSTEM, 'Debug GUI initialized with essential controls')
  }

  /**
   * Sky/Environment Controls
   */
  private setupSkyControls(): void {
    if (!this.systems.sky || !this.systems.skyConfig) {
      logger.warn(LogModule.SYSTEM, 'Sky system not available for debug GUI')
      return
    }
    
    this.folders.sky = this.gui!.addFolder('☀️ Sky & Environment')
    
    const skyConfig = this.systems.skyConfig
    const sky = this.systems.sky
    
    // Time of day
    this.folders.sky.add(skyConfig, 'timeOfDay', 0, 24, 0.1)
      .name('Time of Day')
      .onChange((value: number) => {
        if (sky.updateTimeOfDay) sky.updateTimeOfDay(value)
      })
    
    // Sun intensity
    this.folders.sky.add(skyConfig, 'sunIntensity', 0, 2, 0.05)
      .name('Sun Intensity')
      .onChange(() => {
        if (sky.updateSkyUniforms) sky.updateSkyUniforms()
      })
    
    // Turbidity (atmospheric haze)
    this.folders.sky.add(skyConfig, 'turbidity', 0, 20, 0.1)
      .name('Turbidity')
      .onChange(() => {
        if (sky.updateSkyUniforms) sky.updateSkyUniforms()
      })
    
    // Rayleigh (sky color)
    this.folders.sky.add(skyConfig, 'rayleigh', 0, 4, 0.1)
      .name('Rayleigh')
      .onChange(() => {
        if (sky.updateSkyUniforms) sky.updateSkyUniforms()
      })
    
    this.folders.sky.close()
  }

  /**
   * Light Controls (Spotlight)
   */
  private setupLightControls(): void {
    if (!this.systems.cameraManager) {
      logger.warn(LogModule.SYSTEM, 'Camera manager not available for debug GUI')
      return
    }
    
    this.folders.light = this.gui!.addFolder('💡 Spotlight')
    
    const spotlight = this.systems.cameraManager.playerSpotlight
    if (!spotlight) {
      logger.warn(LogModule.SYSTEM, 'Player spotlight not available for debug GUI')
      return
    }
    
    // Intensity
    this.folders.light.add(spotlight, 'intensity', 0, 5, 0.1)
      .name('Intensity')
    
    // Distance
    this.folders.light.add(spotlight, 'distance', 0, 200, 1)
      .name('Distance')
    
    // Angle
    this.folders.light.add(spotlight, 'angle', 0, Math.PI / 2, 0.01)
      .name('Angle')
    
    // Penumbra (soft edge)
    this.folders.light.add(spotlight, 'penumbra', 0, 1, 0.01)
      .name('Penumbra')
    
    // Decay
    this.folders.light.add(spotlight, 'decay', 0, 2, 0.1)
      .name('Decay')
    
    // Color
    const lightColor = { color: spotlight.color.getHex() }
    this.folders.light.addColor(lightColor, 'color')
      .name('Color')
      .onChange((value: number) => {
        spotlight.color.setHex(value)
      })
    
    this.folders.light.close()
  }

  /**
   * Camera Controls
   */
  private setupCameraControls(): void {
    if (!this.systems.cameraManager) {
      logger.warn(LogModule.SYSTEM, 'Camera manager not available for debug GUI')
      return
    }
    
    this.folders.camera = this.gui!.addFolder('📷 Camera')
    
    const cameraManager = this.systems.cameraManager
    const config = cameraManager.config || {}
    
    // Camera mode
    const modes = ['orbit', 'follow', 'firstPerson', 'topDown']
    this.folders.camera.add({ mode: cameraManager.currentMode || 'follow' }, 'mode', modes)
      .name('Camera Mode')
      .onChange((value: string) => {
        if (cameraManager.setMode) cameraManager.setMode(value)
      })
    
    // Distance
    if (config.followDistance !== undefined) {
      this.folders.camera.add(config, 'followDistance', 5, 50, 0.5)
        .name('Distance')
        .onChange((value: number) => {
          if (cameraManager.setFollowDistance) {
            cameraManager.setFollowDistance(value)
          }
        })
    }
    
    // Height
    if (config.followHeight !== undefined) {
      this.folders.camera.add(config, 'followHeight', 2, 30, 0.5)
        .name('Height')
        .onChange((value: number) => {
          if (cameraManager.setFollowHeight) {
            cameraManager.setFollowHeight(value)
          }
        })
    }
    
    // Rotation speed
    if (config.rotationSpeed !== undefined) {
      this.folders.camera.add(config, 'rotationSpeed', 0.1, 5, 0.1)
        .name('Rotation Speed')
    }
    
    // Smoothing
    if (config.smoothing !== undefined) {
      this.folders.camera.add(config, 'smoothing', 0, 0.3, 0.01)
        .name('Smoothing')
    }
    
    // FOV
    if (this.systems.camera instanceof THREE.PerspectiveCamera) {
      this.folders.camera.add(this.systems.camera, 'fov', 30, 120, 1)
        .name('FOV')
        .onChange(() => {
          (this.systems.camera as THREE.PerspectiveCamera).updateProjectionMatrix()
        })
    }
    
    this.folders.camera.close()
  }

  /**
   * Player Controls
   */
  private setupPlayerControls(): void {
    if (!this.systems.playerController) {
      logger.warn(LogModule.SYSTEM, 'Player controller not available for debug GUI')
      return
    }
    
    this.folders.player = this.gui!.addFolder('🎮 Player')
    
    const player = this.systems.playerController
    const config = player.config
    
    if (!config) return
    
    // Movement speed
    this.folders.player.add(config, 'walkSpeed', 10, 500, 5)
      .name('Walk Speed')
    
    // Run speed
    this.folders.player.add(config, 'runSpeed', 50, 2000, 10)
      .name('Run Speed')
    
    // Jump force
    this.folders.player.add(config, 'jumpForce', 1, 20, 0.5)
      .name('Jump Force')
    
    // Gravity
    this.folders.player.add(config, 'gravity', 5, 50, 0.5)
      .name('Gravity')
    
    // Friction
    this.folders.player.add(config, 'friction', 0, 1, 0.05)
      .name('Friction')
    
    // Air resistance
    this.folders.player.add(config, 'airResistance', 0.8, 1, 0.01)
      .name('Air Resistance')
    
    // Position display (read-only)
    if (player.getPosition) {
      const posDisplay = { x: 0, y: 0, z: 0 }
      const updatePos = () => {
        const pos = player.getPosition()
        posDisplay.x = Math.round(pos.x * 10) / 10
        posDisplay.y = Math.round(pos.y * 10) / 10
        posDisplay.z = Math.round(pos.z * 10) / 10
      }
      updatePos()
      
      const posFolder = this.folders.player.addFolder('Position')
      posFolder.add(posDisplay, 'x').name('X').disable().listen()
      posFolder.add(posDisplay, 'y').name('Y').disable().listen()
      posFolder.add(posDisplay, 'z').name('Z').disable().listen()
      posFolder.close()
      
      // Update position display periodically
      setInterval(updatePos, 100)
    }
    
    this.folders.player.close()
  }

  /**
   * Show debug GUI
   */
  public show(): void {
    if (this.gui) {
      this.gui.show()
    }
  }

  /**
   * Hide debug GUI
   */
  public hide(): void {
    if (this.gui) {
      this.gui.hide()
    }
  }

  /**
   * Toggle debug GUI visibility
   */
  public toggle(): void {
    if (this.gui) {
      if (this.gui._hidden) {
        this.gui.show()
      } else {
        this.gui.hide()
      }
    }
  }

  /**
   * Dispose of all GUI elements
   */
  public dispose(): void {
    if (this.gui) {
      this.gui.destroy()
      this.gui = null
    }
    
    logger.info(LogModule.SYSTEM, 'Debug GUI Manager disposed')
  }

  /**
   * Get GUI instance
   */
  public getGUI(): GUI | null {
    return this.gui
  }
}
