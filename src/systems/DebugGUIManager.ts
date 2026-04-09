import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import * as THREE from 'three'
import { logger, LogModule } from './Logger'
import { SHOT_PARAMS, type BattleShotType } from './BattleCameraController'
import type { BattleAnimSync } from './BattleAnimSync'

export interface SystemReferences {
  scene: THREE.Scene
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer
  cameraManager?: any
  playerController?: any
  battleAnimSync?: BattleAnimSync
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
      this.setupDialogueCameraControls()
      this.setupBattleCameraControls()
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

    this.folders.sky.add({
      printConfig: () => {
        console.log('☀️ [Sky Config]', JSON.parse(JSON.stringify(skyConfig)))
      }
    }, 'printConfig').name('📋 Print config to console')

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

    this.folders.light.add({
      printConfig: () => {
        console.log('💡 [Spotlight Config]', {
          intensity: spotlight.intensity,
          distance: spotlight.distance,
          angle: spotlight.angle,
          penumbra: spotlight.penumbra,
          decay: spotlight.decay,
          color: '#' + spotlight.color.getHexString(),
        })
      }
    }, 'printConfig').name('📋 Print config to console')

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

    this.folders.camera.add({
      printConfig: () => {
        const fov = this.systems.camera instanceof THREE.PerspectiveCamera
          ? (this.systems.camera as THREE.PerspectiveCamera).fov
          : undefined
        console.log('📷 [Camera Config]', {
          mode: cameraManager.currentMode,
          followDistance: config.followDistance,
          followHeight: config.followHeight,
          rotationSpeed: config.rotationSpeed,
          smoothing: config.smoothing,
          fov,
        })
      }
    }, 'printConfig').name('📋 Print config to console')

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
    this.folders.player.add(config, 'walkSpeed', 0.5, 10, 0.1)
      .name('Walk Speed')
    
    // Run speed
    this.folders.player.add(config, 'runSpeed', 1, 20, 0.5)
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

    this.folders.player.add({
      printConfig: () => {
        console.log('🎮 [Player Config]', JSON.parse(JSON.stringify(config)))
      }
    }, 'printConfig').name('📋 Print config to console')

    this.folders.player.close()
  }

  // ============================================================================
  // DIALOGUE CAMERA TUNING
  // ============================================================================

  /**
   * Live-tweakable dialogue camera parameters.
   *
   * Sliders for frontDist, bodyCenter and FOV.  Changes take effect on the
   * NEXT dialogue entry.  Click "Print Config" to copy values into CameraManager.
   */
  private setupDialogueCameraControls(): void {
    const cam = this.systems.cameraManager
    if (!cam || !cam.dialogueCameraParams) return

    const folder = this.gui!.addFolder('\uD83D\uDCFD\uFE0F Dialogue Camera')
    const params = cam.dialogueCameraParams

    folder.add(params, 'frontDist', 1, 10, 0.1).name('Front Distance')
    folder.add(params, 'bodyCenter', 0, 3, 0.05).name('Body Center Y')
    folder.add(params, 'fov', 20, 90, 1).name('FOV')

    folder.add({
      printConfig: () => {
        console.log('\uD83D\uDCFD\uFE0F [Dialogue Camera Config]', JSON.parse(JSON.stringify(params)))
      },
    }, 'printConfig').name('\uD83D\uDCCB Print config to console')

    folder.close()
  }

  // ============================================================================
  // BATTLE CAMERA TUNING
  // ============================================================================

  /**
   * Live-tweakable battle camera shot parameters.
   *
   * Each shot type gets its own sub-folder with sliders for every offset
   * value.  Changes take effect on the NEXT cut-to for that shot, or
   * instantly when you hit the "Preview" button.
   *
   * When you've found values you like, click "Print Config" and paste the
   * JSON from the browser console back into SHOT_PARAMS in
   * BattleCameraController.ts.
   */
  private setupBattleCameraControls(): void {
    const battleCtrl = this.systems.cameraManager?.getBattleCameraController?.()
    if (!battleCtrl) return

    const folder = this.gui!.addFolder('\u2694\ufe0f Battle Camera')

    // ── Shot parameters (existing) ─────────────────────────────────────
    const shotsFolder = folder.addFolder('Shot Params')

    const shots: BattleShotType[] = [
      'menuIdle', 'attackerFocus', 'strikeImpact', 'targetReaction',
      'enemyFocus', 'playerReaction', 'deathHold', 'wideAction', 'overShoulder',
    ]

    for (const type of shots) {
      const params = SHOT_PARAMS[type]
      const sub = shotsFolder.addFolder(type)

      sub.add(params, 'fwdOffset',        -12, 12,  0.1).name('fwd offset')
      sub.add(params, 'sideOffset',       -12, 12,  0.1).name('side offset')
      sub.add(params, 'heightOffset',       0, 16,  0.1).name('height offset')
      sub.add(params, 'lookFwdOffset',    -6,   6,  0.05).name('look fwd offset')
      sub.add(params, 'lookSideOffset',   -6,   6,  0.05).name('look side offset')
      sub.add(params, 'lookHeightOffset',   0,  4,  0.05).name('look height')
      sub.add(params, 'fov',              20, 90,  1).name('FOV')

      const actions = {
        preview: () => {
          if (battleCtrl.active) {
            battleCtrl.previewShot(type)
          } else {
            console.warn(`\u2694\ufe0f [BattleCam] Controller not active — enter a battle first, or call battleCtrl.start() + setBattlePositions() manually.`)
          }
        },
      }
      sub.add(actions, 'preview').name('\u25b6 Preview shot')
      sub.close()
    }

    shotsFolder.close()

    // ── Animation sync points ──────────────────────────────────────────
    const animSync = this.systems.battleAnimSync
    if (animSync) {
      const syncFolder = folder.addFolder('Anim Sync Points')

      const clips = animSync.getRegisteredClips()
      for (const clipName of clips) {
        const clipFolder = syncFolder.addFolder(clipName)
        const points = animSync.getSyncPoints(clipName)

        for (const point of points) {
          clipFolder
            .add(point, 'fraction', 0, 1, 0.01)
            .name(point.label)
            .onChange(() => animSync.resortSyncPoints(clipName))
        }
        clipFolder.close()
      }

      syncFolder.close()
    }

    // ── Live status monitor ────────────────────────────────────────────
    if (animSync) {
      const statusFolder = folder.addFolder('Live Status')
      const statusProxy = {
        clip: '—',
        character: '—',
        mode: '—',
        fraction: 0,
        nextEvent: '—',
        queue: 0,
      }
      const clipCtrl   = statusFolder.add(statusProxy, 'clip').name('clip').listen().disable()
      const charCtrl   = statusFolder.add(statusProxy, 'character').name('character').listen().disable()
      const modeCtrl   = statusFolder.add(statusProxy, 'mode').name('mode').listen().disable()
      const fracCtrl   = statusFolder.add(statusProxy, 'fraction', 0, 1).name('progress').listen().disable()
      const nextCtrl   = statusFolder.add(statusProxy, 'nextEvent').name('next event').listen().disable()
      const queueCtrl  = statusFolder.add(statusProxy, 'queue', 0, 10, 1).name('queue').listen().disable()

      // Poll at 10 Hz
      setInterval(() => {
        const s = animSync.getActiveStatus()
        statusProxy.clip      = s.clipName ?? '—'
        statusProxy.character = s.characterId ?? '—'
        statusProxy.mode      = s.mode ?? '—'
        statusProxy.fraction  = s.fraction
        statusProxy.nextEvent = s.nextEvent ?? '—'
        statusProxy.queue     = s.queueLength
      }, 100)

      statusFolder.open()
    }

    // ── Global actions ─────────────────────────────────────────────────
    const globalActions: Record<string, () => void> = {
      printShotConfig: () => battleCtrl.printConfig(),
    }
    folder.add(globalActions, 'printShotConfig').name('\ud83d\udccb Print shot config')

    if (animSync) {
      const syncActions: Record<string, () => void> = {
        printSyncPoints: () => animSync.printSyncPoints(),
        printAll: () => { battleCtrl.printConfig(); animSync.printSyncPoints() },
      }
      folder.add(syncActions, 'printSyncPoints').name('\ud83c\udfac Print sync points')
      folder.add(syncActions, 'printAll').name('\ud83d\udcbe Print all (shots + sync)')
    }

    folder.close()
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
