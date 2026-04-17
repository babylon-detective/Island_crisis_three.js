import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import * as THREE from 'three'
import { logger, LogModule } from './Logger'
import { SHOT_PARAMS, type BattleShotType } from './BattleCameraController'
import type { BattleAnimSync } from './BattleAnimSync'
import type { CollisionSystem } from './CollisionSystem'

export interface SystemReferences {
  scene: THREE.Scene
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer
  cameraManager?: any
  playerController?: any
  battleAnimSync?: BattleAnimSync
  sky?: any
  skyConfig?: any
  // Extended refs for full debug GUI
  ambientLight?: THREE.AmbientLight
  keyLight?: THREE.DirectionalLight
  fillLight?: THREE.DirectionalLight
  retroPostProcessing?: any
  landSystem?: any
  npcSystem?: any
  collisionSystem?: CollisionSystem
  updateSunPosition?: () => void
  sunCycle?: { frozen: boolean, speed: number }
}

interface TabDef {
  label: string
  gui: GUI
}

/**
 * Tabbed Debug GUI — left/right navigable panels.
 *
 * Tab 0  "General"    — Camera, Movement, Physics
 * Tab 1  "Lighting"   — World Lighting, Post FX, Player Spotlight
 * Tab 2  "Characters" — Player character shader, NPC shader
 * Tab 3  "Materials"  — per-material shader uniform controls
 * Tab 4  "Battle"     — Dialogue Camera, Battle Camera
 */
export class DebugGUIManager {
  private tabs: TabDef[] = []
  private activeTabIndex = 0
  private wrapper: HTMLElement | null = null
  private tabBar: HTMLElement | null = null
  private container: HTMLElement
  private systems: SystemReferences

  constructor(container: HTMLElement, systems: SystemReferences) {
    this.container = container
    this.systems = systems
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  public initialize(): void {
    // ── Outer wrapper ────────────────────────────────────────────────────
    this.wrapper = document.createElement('div')
    this.wrapper.id = 'debug-gui-wrapper'
    Object.assign(this.wrapper.style, {
      position: 'fixed',
      top: '10px',
      right: '10px',
      zIndex: '15000',
      width: '320px',
      fontFamily: 'monospace',
    } as Partial<CSSStyleDeclaration>)
    this.container.appendChild(this.wrapper)

    // ── Prevent GUI interactions from stealing game input ────────────────
    // lil-gui inputs capture keyboard focus; stop those key events from
    // reaching the game's InputSystem (on window) and, more importantly,
    // blur focused GUI elements on any mouse-up so the game regains control.
    this.wrapper.addEventListener('keydown', (e) => e.stopPropagation())
    this.wrapper.addEventListener('keyup',   (e) => e.stopPropagation())
    this.wrapper.addEventListener('pointerup', () => {
      // After slider drag / checkbox click, return focus to the game
      requestAnimationFrame(() => {
        const active = document.activeElement as HTMLElement | null
        if (active && this.wrapper!.contains(active)) {
          active.blur()
        }
      })
    })
    this.tabBar = document.createElement('div')
    Object.assign(this.tabBar.style, {
      display: 'flex',
      alignItems: 'center',
      background: '#1a1a2e',
      borderBottom: '1px solid #444',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>)
    this.wrapper.appendChild(this.tabBar)

    // ── Create tabs ──────────────────────────────────────────────────────
    const generalGui    = this.createGUI('General')
    const lightingGui   = this.createGUI('Lighting')
    const charactersGui = this.createGUI('Characters')
    const matGui        = this.createGUI('Materials')
    const battleGui     = this.createGUI('Battle')

    this.tabs = [
      { label: 'General',    gui: generalGui },
      { label: 'Lighting',   gui: lightingGui },
      { label: 'Characters', gui: charactersGui },
      { label: 'Materials',  gui: matGui },
      { label: 'Battle',     gui: battleGui },
    ]

    this.buildTabBar()

    // ── Populate tabs ────────────────────────────────────────────────────
    try {
      // General
      this.setupCameraControls(generalGui)
      this.setupMovementControls(generalGui)
      this.setupPhysicsControls(generalGui)
      this.setupCollisionControls(generalGui)

      // Lighting
      this.setupWorldLightingControls(lightingGui)
      this.setupPostFXControls(lightingGui)
      this.setupSpotlightControls(lightingGui)

      // Characters
      this.setupCharacterShaderControls(charactersGui)
      this.setupNPCShaderControls(charactersGui)

      // Materials
      this.setupMaterialControls(matGui)

      // Battle
      this.setupDialogueCameraControls(battleGui)
      this.setupBattleCameraControls(battleGui)
    } catch (error) {
      logger.error(LogModule.SYSTEM, 'Error setting up debug controls:', error)
    }

    this.switchTab(0)

    logger.info(LogModule.SYSTEM, 'Debug GUI initialized with tabbed controls')
  }

  // ==========================================================================
  // TAB: GENERAL
  // ==========================================================================

  private setupCameraControls(gui: GUI): void {
    if (!this.systems.cameraManager) return

    const folder = gui.addFolder('\uD83D\uDCF7 Camera')
    const cameraManager = this.systems.cameraManager
    const config = cameraManager.config || {}

    const modes = ['orbit', 'follow', 'firstPerson', 'topDown']
    folder.add({ mode: cameraManager.currentMode || 'follow' }, 'mode', modes)
      .name('Camera Mode')
      .onChange((value: string) => {
        if (cameraManager.setMode) cameraManager.setMode(value)
      })

    if (config.followDistance !== undefined) {
      folder.add(config, 'followDistance', 5, 50, 0.5).name('Distance')
        .onChange((v: number) => { if (cameraManager.setFollowDistance) cameraManager.setFollowDistance(v) })
    }
    if (config.followHeight !== undefined) {
      folder.add(config, 'followHeight', 2, 30, 0.5).name('Height')
        .onChange((v: number) => { if (cameraManager.setFollowHeight) cameraManager.setFollowHeight(v) })
    }
    if (config.rotationSpeed !== undefined) {
      folder.add(config, 'rotationSpeed', 0.1, 5, 0.1).name('Rotation Speed')
    }
    if (config.smoothing !== undefined) {
      folder.add(config, 'smoothing', 0, 0.3, 0.01).name('Smoothing')
    }
    if (this.systems.camera instanceof THREE.PerspectiveCamera) {
      folder.add(this.systems.camera, 'fov', 30, 120, 1).name('FOV')
        .onChange(() => { (this.systems.camera as THREE.PerspectiveCamera).updateProjectionMatrix() })
    }

    this.addPrintButton(folder, '\uD83D\uDCF7 Camera', () => ({
      mode: cameraManager.currentMode,
      followDistance: config.followDistance,
      followHeight: config.followHeight,
      rotationSpeed: config.rotationSpeed,
      smoothing: config.smoothing,
      fov: this.systems.camera instanceof THREE.PerspectiveCamera
        ? (this.systems.camera as THREE.PerspectiveCamera).fov : undefined,
    }))
    folder.close()
  }

  private setupMovementControls(gui: GUI): void {
    const player = this.systems.playerController
    if (!player) return
    const config = player.getConfig?.() ?? player.config
    if (!config) return

    const folder = gui.addFolder('\uD83C\uDFC3 Movement')
    const params = { walkSpeed: config.walkSpeed, runSpeed: config.runSpeed }

    folder.add(params, 'walkSpeed', 0.5, 10, 0.1).name('Walk Speed')
      .onChange((v: number) => { if (player.updateConfig) player.updateConfig({ walkSpeed: v }); else config.walkSpeed = v })
    folder.add(params, 'runSpeed', 1, 20, 0.5).name('Run Speed')
      .onChange((v: number) => { if (player.updateConfig) player.updateConfig({ runSpeed: v }); else config.runSpeed = v })

    this.addPrintButton(folder, '\uD83C\uDFC3 Movement', () => params)
    folder.close()
  }

  private setupPhysicsControls(gui: GUI): void {
    const player = this.systems.playerController
    if (!player) return
    const config = player.getConfig?.() ?? player.config
    if (!config) return

    const folder = gui.addFolder('\u26A1 Physics')
    const params = {
      jumpForce: config.jumpForce,
      gravity: config.gravity,
      friction: config.friction,
      airResistance: config.airResistance,
    }

    folder.add(params, 'jumpForce', 1, 30, 0.5).name('Jump Force')
      .onChange((v: number) => { if (player.updateConfig) player.updateConfig({ jumpForce: v }); else config.jumpForce = v })
    folder.add(params, 'gravity', 1, 60, 0.5).name('Gravity')
      .onChange((v: number) => { if (player.updateConfig) player.updateConfig({ gravity: v }); else config.gravity = v })
    folder.add(params, 'friction', 0, 1, 0.01).name('Friction')
      .onChange((v: number) => { if (player.updateConfig) player.updateConfig({ friction: v }); else config.friction = v })
    folder.add(params, 'airResistance', 0.8, 1, 0.001).name('Air Resistance')
      .onChange((v: number) => { if (player.updateConfig) player.updateConfig({ airResistance: v }); else config.airResistance = v })

    this.addPrintButton(folder, '\u26A1 Physics', () => params)
    folder.close()
  }

  private setupCollisionControls(gui: GUI): void {
    const cs = this.systems.collisionSystem
    const scene = this.systems.scene
    if (!cs || !scene) return

    const folder = gui.addFolder('🧱 Collision Debug')
    const state = { wireframes: false }

    folder.add(state, 'wireframes').name('Show Wireframes')
      .onChange((v: boolean) => {
        cs.toggleDebugWireframes(scene, v)
      })

    folder.add({ refresh: () => cs.refreshDebugWireframes() }, 'refresh').name('↻ Refresh Wireframes')

    const stats = cs.getPerformanceStats() as Record<string, unknown>
    folder.add({ log: () => {
      const s = cs.getPerformanceStats() as Record<string, unknown>
      console.table(s)
    } }, 'log').name('📊 Log Stats')

    folder.close()
  }

  // ==========================================================================
  // TAB: LIGHTING
  // ==========================================================================

  private setupWorldLightingControls(gui: GUI): void {
    const folder = gui.addFolder('\uD83C\uDF0D World Lighting')

    // ── Ambient ──────────────────────────────────────────────────────────
    if (this.systems.ambientLight) {
      const amb = this.systems.ambientLight
      const ambParams = { color: '#' + amb.color.getHexString(), intensity: amb.intensity }
      const ambFolder = folder.addFolder('Ambient')
      ambFolder.addColor(ambParams, 'color').name('Color')
        .onChange((v: string) => amb.color.set(v))
      ambFolder.add(ambParams, 'intensity', 0, 2, 0.01).name('Intensity')
        .onChange((v: number) => { amb.intensity = v })
      ambFolder.close()
    }

    // ── Sun / Key Light ──────────────────────────────────────────────────
    if (this.systems.keyLight) {
      const key = this.systems.keyLight
      const skyConfig = this.systems.skyConfig || {}
      const sunCycle = this.systems.sunCycle
      const sunParams = {
        elevation: skyConfig.elevation ?? 45,
        azimuth: skyConfig.azimuth ?? 180,
        castShadow: key.castShadow,
        shadowRadius: key.shadow.radius,
        shadowBias: key.shadow.bias,
        frozen: sunCycle ? sunCycle.frozen : true,
        cycleSpeed: sunCycle ? sunCycle.speed : 0.0001,
      }
      const sunFolder = folder.addFolder('\u2600\uFE0F Sun / Key Light')
      sunFolder.add(sunParams, 'elevation', -10, 90, 0.5).name('Elevation (\u00B0)')
        .onChange((v: number) => { skyConfig.elevation = v; this.systems.updateSunPosition?.() })
      sunFolder.add(sunParams, 'azimuth', 0, 360, 1).name('Azimuth (\u00B0)')
        .onChange((v: number) => { skyConfig.azimuth = v; this.systems.updateSunPosition?.() })
      if (sunCycle) {
        sunFolder.add(sunParams, 'frozen').name('⏸ Freeze Sun')
          .onChange((v: boolean) => { sunCycle.frozen = v })
        sunFolder.add(sunParams, 'cycleSpeed', 0.00001, 0.001, 0.00001).name('Cycle Speed')
          .onChange((v: number) => { sunCycle.speed = v })
      }
      sunFolder.add(sunParams, 'castShadow').name('Cast Shadow')
        .onChange((v: boolean) => { key.castShadow = v })
      sunFolder.add(sunParams, 'shadowRadius', 0, 10, 0.1).name('Shadow Radius')
        .onChange((v: number) => { key.shadow.radius = v })
      sunFolder.add(sunParams, 'shadowBias', -0.01, 0.01, 0.0001).name('Shadow Bias')
        .onChange((v: number) => { key.shadow.bias = v })
      this.addPrintButton(sunFolder, '\u2600\uFE0F Sun', () => sunParams)
      sunFolder.close()
    }

    // ── Fill Light ───────────────────────────────────────────────────────
    if (this.systems.fillLight) {
      const fl = this.systems.fillLight
      const fillParams = {
        color: '#' + fl.color.getHexString(),
        intensity: fl.intensity,
        posX: fl.position.x, posY: fl.position.y, posZ: fl.position.z,
      }
      const fillFolder = folder.addFolder('\uD83C\uDF19 Fill Light')
      fillFolder.addColor(fillParams, 'color').name('Color').onChange((v: string) => fl.color.set(v))
      fillFolder.add(fillParams, 'intensity', 0, 3, 0.01).name('Intensity').onChange((v: number) => { fl.intensity = v })
      fillFolder.add(fillParams, 'posX', -100, 100, 0.5).name('Pos X').onChange((v: number) => { fl.position.x = v })
      fillFolder.add(fillParams, 'posY', 0, 100, 0.5).name('Pos Y').onChange((v: number) => { fl.position.y = v })
      fillFolder.add(fillParams, 'posZ', -100, 100, 0.5).name('Pos Z').onChange((v: number) => { fl.position.z = v })
      this.addPrintButton(fillFolder, '\uD83C\uDF19 Fill Light', () => fillParams)
      fillFolder.close()
    }

    this.addPrintButton(folder, '\uD83C\uDF0D World Lighting', () => ({
      ambient: this.systems.ambientLight ? {
        color: '#' + this.systems.ambientLight.color.getHexString(),
        intensity: this.systems.ambientLight.intensity,
      } : null,
      keyLight: this.systems.keyLight ? {
        castShadow: this.systems.keyLight.castShadow,
        shadowRadius: this.systems.keyLight.shadow.radius,
        shadowBias: this.systems.keyLight.shadow.bias,
      } : null,
    }))
    folder.close()
  }

  private setupPostFXControls(gui: GUI): void {
    const retro = this.systems.retroPostProcessing
    if (!retro) return

    const folder = gui.addFolder('\uD83E\uDDEA Post FX')
    const retroConfig = retro.getConfig()
    const params = {
      dithering: retroConfig.ditheringEnabled ?? (retroConfig.ditherAmount > 0.0001),
      ditherAmount: Math.max(retroConfig.ditherAmount, 0.3),
    }

    folder.add(params, 'dithering').name('Dithering')
      .onChange((enabled: boolean) => {
        const current = retro.getConfig().ditherAmount
        if (current > 0.0001) params.ditherAmount = current
        retro.setDitheringEnabled(enabled)
        retro.setDitherAmount(enabled ? params.ditherAmount : 0)
      })

    this.addPrintButton(folder, '\uD83E\uDDEA Post FX', () => params)
    folder.close()
  }

  private setupSpotlightControls(gui: GUI): void {
    const cam = this.systems.cameraManager
    if (!cam) return

    const spotlight = cam.getPlayerSpotlight?.() ?? cam.playerSpotlight
    if (!spotlight) return

    const folder = gui.addFolder('\uD83D\uDD26 Player Spotlight')
    const RAD2DEG = 180 / Math.PI
    const DEG2RAD = Math.PI / 180
    const spotConfig = cam.getConfig?.()?.spotlight ?? {}
    let savedIntensity = spotConfig.intensity ?? spotlight.intensity

    const params = {
      visible: spotlight.visible,
      color: '#' + spotlight.color.getHexString(),
      intensity: spotConfig.intensity ?? spotlight.intensity,
      angle: spotlight.angle * RAD2DEG,
      penumbra: spotlight.penumbra,
      decay: spotlight.decay,
      distance: spotlight.distance,
      height: spotConfig.height ?? 40,
      offset: spotConfig.offset ?? 0,
      castShadow: spotlight.castShadow,
      shadowNear: spotlight.shadow.camera.near,
      shadowFar: spotlight.shadow.camera.far,
    }

    const landSystem = this.systems.landSystem

    folder.add(params, 'visible').name('Enabled')
      .onChange((v: boolean) => {
        const cfg = cam.getConfig?.()?.spotlight
        if (!cfg) { spotlight.visible = v; return }
        if (v) {
          cam.updateConfig({ spotlight: { ...cfg, intensity: savedIntensity } })
        } else {
          savedIntensity = cfg.intensity
          cam.updateConfig({ spotlight: { ...cfg, intensity: 0 } })
        }
      })
    folder.addColor(params, 'color').name('Color')
      .onChange((v: string) => { spotlight.color.set(v); landSystem?.setSpotlightColor?.(spotlight.color) })
    folder.add(params, 'intensity', 0, 20, 0.1).name('Intensity')
      .onChange((v: number) => {
        savedIntensity = v
        if (cam.updateConfig) cam.updateConfig({ spotlight: { ...(cam.getConfig?.()?.spotlight ?? {}), intensity: v } })
        else spotlight.intensity = v
        landSystem?.setSpotlightIntensity?.(v)
      })
    folder.add(params, 'angle', 1, 90, 0.5).name('Cone Angle (\u00B0)')
      .onChange((v: number) => { spotlight.angle = v * DEG2RAD; landSystem?.setSpotlightAngle?.(v * DEG2RAD) })
    folder.add(params, 'penumbra', 0, 1, 0.01).name('Penumbra')
      .onChange((v: number) => { spotlight.penumbra = v; landSystem?.setSpotlightPenumbra?.(v) })
    folder.add(params, 'decay', 0, 5, 0.1).name('Decay')
      .onChange((v: number) => { spotlight.decay = v })
    folder.add(params, 'distance', 0, 200, 1).name('Distance')
      .onChange((v: number) => { spotlight.distance = v; landSystem?.setSpotlightDistance?.(v) })
    folder.add(params, 'height', 0, 100, 0.5).name('Height Above Player')
      .onChange((v: number) => { if (cam.updateConfig) cam.updateConfig({ spotlight: { ...(cam.getConfig?.()?.spotlight ?? {}), height: v } }) })
    folder.add(params, 'offset', -20, 20, 0.5).name('Camera Offset')
      .onChange((v: number) => { if (cam.updateConfig) cam.updateConfig({ spotlight: { ...(cam.getConfig?.()?.spotlight ?? {}), offset: v } }) })
    folder.add(params, 'castShadow').name('Cast Shadow')
      .onChange((v: boolean) => { spotlight.castShadow = v })
    folder.add(params, 'shadowNear', 0.1, 50, 0.1).name('Shadow Near')
      .onChange((v: number) => { spotlight.shadow.camera.near = v; spotlight.shadow.camera.updateProjectionMatrix() })
    folder.add(params, 'shadowFar', 10, 500, 1).name('Shadow Far')
      .onChange((v: number) => { spotlight.shadow.camera.far = v; spotlight.shadow.camera.updateProjectionMatrix() })

    this.addPrintButton(folder, '\uD83D\uDD26 Spotlight', () => params)
    folder.close()
  }

  // ==========================================================================
  // TAB: CHARACTERS
  // ==========================================================================

  /**
   * Player character toon shader controls.
   * Collects all ShaderMaterials from the player mesh.
   */
  private setupCharacterShaderControls(gui: GUI): void {
    const player = this.systems.playerController
    if (!player) return

    // Deferred — player mesh may not be ready yet
    const build = () => {
      const playerMesh = player.getMesh?.()
      if (!playerMesh) return

      const shaderMaterials: THREE.ShaderMaterial[] = []
      playerMesh.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material
          if (mat && (mat as THREE.ShaderMaterial).isShaderMaterial) {
            shaderMaterials.push(mat as THREE.ShaderMaterial)
          }
        }
      })
      if (shaderMaterials.length === 0) return

      const ref = shaderMaterials[0].uniforms
      this.addToonShaderFolder(gui, '\uD83C\uDFA8 Player Shader', shaderMaterials, ref)
    }

    if (player.ready) {
      player.ready.then(build)
    } else {
      build()
    }
  }

  /**
   * NPC toon shader controls.
   * Finds ShaderMaterials on NPC meshes in the scene.
   */
  private setupNPCShaderControls(gui: GUI): void {
    const scene = this.systems.scene
    if (!scene) return

    // Collect NPC ShaderMaterials — they have uModelColor + uBands + uRimColor
    // but NOT uLandColor / uSandColor / etc. (those are level materials)
    const npcMaterials: THREE.ShaderMaterial[] = []
    const seen = new Set<THREE.ShaderMaterial>()

    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mat = child.material as THREE.ShaderMaterial
      if (!mat?.isShaderMaterial || !mat.uniforms) return
      if (seen.has(mat)) return
      const u = mat.uniforms
      // NPC character shader: has uModelColor + uBands + uRimColor but no level-material uniforms
      if (u['uModelColor'] && u['uBands'] && u['uRimColor']
          && !u['uLandColor'] && !u['uSandColor'] && !u['uConcreteColor']
          && !u['uWoodColor'] && !u['uWaterColor']) {
        // Skip if it's the player mesh
        const playerMesh = this.systems.playerController?.getMesh?.()
        let isPlayer = false
        if (playerMesh) {
          playerMesh.traverse((pc: THREE.Object3D) => {
            if (pc === child) isPlayer = true
          })
        }
        if (!isPlayer) {
          npcMaterials.push(mat)
          seen.add(mat)
        }
      }
    })

    if (npcMaterials.length === 0) {
      const folder = gui.addFolder('\uD83E\uDDCC NPC Shader')
      folder.add({ note: 'No NPC ShaderMaterials found (NPCs may not be loaded yet)' }, 'note').name('Status').disable()
      folder.close()
      return
    }

    const ref = npcMaterials[0].uniforms
    this.addToonShaderFolder(gui, '\uD83E\uDDCC NPC Shader', npcMaterials, ref)
  }

  /**
   * Shared helper: create a toon shader folder with the standard cel-shading uniforms.
   * Works for both player and NPC ShaderMaterials.
   */
  private addToonShaderFolder(
    gui: GUI,
    title: string,
    materials: THREE.ShaderMaterial[],
    ref: Record<string, { value: any }>,
  ): void {
    const folder = gui.addFolder(title)

    const setUniform = (name: string, value: any) => {
      for (const mat of materials) {
        if (mat.uniforms[name]) mat.uniforms[name].value = value
      }
    }
    const setColorUniform = (name: string, hex: string) => {
      for (const mat of materials) {
        if (mat.uniforms[name]) (mat.uniforms[name].value as THREE.Color).set(hex)
      }
    }

    const params: Record<string, any> = {}

    // Color & shading
    if (ref.uModelColor) {
      params.modelColor = '#' + (ref.uModelColor.value as THREE.Color).getHexString()
      folder.addColor(params, 'modelColor').name('Model Color').onChange((v: string) => setColorUniform('uModelColor', v))
    }
    if (ref.uAmbient) {
      params.ambient = ref.uAmbient.value
      folder.add(params, 'ambient', 0, 1, 0.01).name('Ambient').onChange((v: number) => setUniform('uAmbient', v))
    }
    if (ref.uBrightBoost) {
      params.brightBoost = ref.uBrightBoost.value
      folder.add(params, 'brightBoost', 0, 0.5, 0.01).name('Bright Boost').onChange((v: number) => setUniform('uBrightBoost', v))
    }
    if (ref.uBands) {
      params.bands = ref.uBands.value
      folder.add(params, 'bands', 1, 8, 1).name('Toon Bands').onChange((v: number) => setUniform('uBands', v))
    }

    // Rim light
    if (ref.uRimColor) {
      const rimFolder = folder.addFolder('\uD83D\uDCA1 Rim Light')
      params.rimColor = '#' + (ref.uRimColor.value as THREE.Color).getHexString()
      rimFolder.addColor(params, 'rimColor').name('Rim Color').onChange((v: string) => setColorUniform('uRimColor', v))
      if (ref.uRimStrength) {
        params.rimStrength = ref.uRimStrength.value
        rimFolder.add(params, 'rimStrength', 0, 1.5, 0.01).name('Rim Strength').onChange((v: number) => setUniform('uRimStrength', v))
      }
      if (ref.uRimPower) {
        params.rimPower = ref.uRimPower.value
        rimFolder.add(params, 'rimPower', 0.5, 8.0, 0.1).name('Rim Power').onChange((v: number) => setUniform('uRimPower', v))
      }
      rimFolder.close()
    }

    // Specular
    if (ref.uSpecStrength) {
      const specFolder = folder.addFolder('\u2728 Specular')
      params.specStrength = ref.uSpecStrength.value
      specFolder.add(params, 'specStrength', 0, 0.5, 0.01).name('Spec Strength').onChange((v: number) => setUniform('uSpecStrength', v))
      if (ref.uSpecPower) {
        params.specPower = ref.uSpecPower.value
        specFolder.add(params, 'specPower', 4, 128, 1).name('Spec Power').onChange((v: number) => setUniform('uSpecPower', v))
      }
      specFolder.close()
    }

    // Outline
    if (ref.uOutlineWidth) {
      const outFolder = folder.addFolder('\uD83D\uDD8A\uFE0F Outline')
      params.outlineWidth = ref.uOutlineWidth.value
      outFolder.add(params, 'outlineWidth', 0, 1, 0.01).name('Width').onChange((v: number) => setUniform('uOutlineWidth', v))
      if (ref.uOutlineColor) {
        params.outlineColor = '#' + (ref.uOutlineColor.value as THREE.Color).getHexString()
        outFolder.addColor(params, 'outlineColor').name('Color').onChange((v: string) => setColorUniform('uOutlineColor', v))
      }
      outFolder.close()
    }

    // Dominant lights
    if (ref.uLightColor) {
      const lightFolder = folder.addFolder('\u2600\uFE0F Dominant Lights')
      params.lightColor = '#' + (ref.uLightColor.value as THREE.Color).getHexString()
      lightFolder.addColor(params, 'lightColor').name('Light 1 Color').onChange((v: string) => setColorUniform('uLightColor', v))
      if (ref.uLightIntensity) {
        params.lightIntensity = ref.uLightIntensity.value
        lightFolder.add(params, 'lightIntensity', 0, 3, 0.01).name('Light 1 Intensity').onChange((v: number) => setUniform('uLightIntensity', v))
      }
      if (ref.uLight2Color) {
        params.light2Color = '#' + (ref.uLight2Color.value as THREE.Color).getHexString()
        lightFolder.addColor(params, 'light2Color').name('Light 2 Color').onChange((v: string) => setColorUniform('uLight2Color', v))
      }
      if (ref.uLight2Intensity) {
        params.light2Intensity = ref.uLight2Intensity.value
        lightFolder.add(params, 'light2Intensity', 0, 3, 0.01).name('Light 2 Intensity').onChange((v: number) => setUniform('uLight2Intensity', v))
      }
      lightFolder.close()
    }

    // Mesh shadow toggles
    const meshes: THREE.Mesh[] = []
    this.systems.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      if (mats.some(m => materials.includes(m as THREE.ShaderMaterial))) meshes.push(child)
    })
    if (meshes.length > 0) {
      const shadowProxy = { castShadow: meshes[0].castShadow, receiveShadow: meshes[0].receiveShadow }
      folder.add(shadowProxy, 'castShadow').name('Cast Shadow')
        .onChange((v: boolean) => { for (const m of meshes) m.castShadow = v })
      folder.add(shadowProxy, 'receiveShadow').name('Receive Shadow')
        .onChange((v: boolean) => { for (const m of meshes) m.receiveShadow = v })
    }

    this.addPrintButton(folder, title, () => params)
    folder.close()
  }

  // ==========================================================================
  // TAB: MATERIALS
  // ==========================================================================

  /**
   * Scan the scene for ShaderMaterial meshes and create per-material
   * sub-folders with controls for colors, lighting, shadow, and noise uniforms.
   */
  private setupMaterialControls(gui: GUI): void {
    const scene = this.systems.scene
    if (!scene) return

    // Collect unique level ShaderMaterials keyed by a display name
    const matMap = new Map<string, THREE.ShaderMaterial>()
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      for (const m of mats) {
        if (!(m instanceof THREE.ShaderMaterial) || !m.uniforms) continue
        const key = this.classifyLevelMaterial(m)
        if (key && !matMap.has(key)) matMap.set(key, m)
      }
    })

    if (matMap.size === 0) {
      gui.add({ note: 'No level ShaderMaterials found' }, 'note').name('(empty)').disable()
      return
    }

    // Shared lighting uniforms (shared by reference across all land-type materials)
    const firstMat = matMap.values().next().value as THREE.ShaderMaterial
    if (firstMat.uniforms['uSunDirection']) {
      this.addSharedLightingFolder(gui, firstMat)
    }

    // Per-material folders
    for (const [name, mat] of matMap) {
      this.addLevelMaterialFolder(gui, name, mat)
    }
  }

  private classifyLevelMaterial(mat: THREE.ShaderMaterial): string | null {
    const u = mat.uniforms
    if (u['uLandColor'])         return 'Land'
    if (u['uSandColor'] && u['uSandDarkColor']) return 'Sand'
    if (u['uConcreteColor'])     return 'Concrete'
    if (u['uWoodColor'])         return 'Wood'
    if (u['uWaterColor'])        return 'Ocean'
    if (u['uBaseColor'])         return 'Platform'
    return null
  }

  private addSharedLightingFolder(gui: GUI, mat: THREE.ShaderMaterial): void {
    const folder = gui.addFolder('\u2600\uFE0F Shared Shader Lighting')
    const u = mat.uniforms

    if (u['uSunIntensity']) folder.add(u['uSunIntensity'], 'value', 0, 3, 0.05).name('Sun Intensity')
    if (u['uSunColor']) {
      const proxy = { color: (u['uSunColor'].value as THREE.Color).getHex() }
      folder.addColor(proxy, 'color').name('Sun Color').onChange((v: number) => (u['uSunColor'].value as THREE.Color).setHex(v))
    }
    if (u['uSunDirection']) {
      const dir = u['uSunDirection'].value as THREE.Vector3
      const sub = folder.addFolder('Sun Direction')
      sub.add(dir, 'x', -1, 1, 0.01).name('X')
      sub.add(dir, 'y', -1, 1, 0.01).name('Y')
      sub.add(dir, 'z', -1, 1, 0.01).name('Z')
      sub.close()
    }
    if (u['uSpotlightIntensity']) folder.add(u['uSpotlightIntensity'], 'value', 0, 5, 0.1).name('Spot Intensity')
    if (u['uSpotlightColor']) {
      const proxy = { color: (u['uSpotlightColor'].value as THREE.Color).getHex() }
      folder.addColor(proxy, 'color').name('Spot Color').onChange((v: number) => (u['uSpotlightColor'].value as THREE.Color).setHex(v))
    }
    if (u['uSpotlightAngle']) folder.add(u['uSpotlightAngle'], 'value', 0, Math.PI / 2, 0.01).name('Spot Angle')
    if (u['uSpotlightPenumbra']) folder.add(u['uSpotlightPenumbra'], 'value', 0, 1, 0.01).name('Spot Penumbra')
    if (u['uSpotlightDistance']) folder.add(u['uSpotlightDistance'], 'value', 0, 200, 1).name('Spot Distance')

    this.addPrintButton(folder, '\u2600\uFE0F Shared Shader Lighting', () => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(u)) {
        if (!k.startsWith('uSun') && !k.startsWith('uSpotlight')) continue
        out[k] = v.value instanceof THREE.Color ? '#' + v.value.getHexString()
          : v.value instanceof THREE.Vector3 ? { x: v.value.x, y: v.value.y, z: v.value.z }
          : v.value
      }
      return out
    })
    folder.close()
  }

  private addLevelMaterialFolder(gui: GUI, name: string, mat: THREE.ShaderMaterial): void {
    const folder = gui.addFolder(`\uD83C\uDFA8 ${name}`)
    const u = mat.uniforms

    // Colors
    const colorUniforms = [
      'uLandColor', 'uRockColor', 'uSandColor', 'uSandDarkColor',
      'uConcreteColor', 'uConcreteDarkColor', 'uWoodColor', 'uWoodDarkColor',
      'uBaseColor', 'uWaterColor', 'uDeepWaterColor', 'uFoamColor',
    ]
    for (const key of colorUniforms) {
      if (!u[key]) continue
      const proxy = { color: (u[key].value as THREE.Color).getHex() }
      folder.addColor(proxy, 'color').name(key.replace(/^u/, '')).onChange((v: number) => (u[key].value as THREE.Color).setHex(v))
    }

    // Numeric per-material uniforms
    const numericUniforms: Array<[string, string, number, number, number]> = [
      ['uElevation',          'Elevation',           0, 20, 0.1],
      ['uRoughness',          'Roughness',           0, 5, 0.05],
      ['uMoisture',           'Moisture',            0, 1, 0.01],
      ['uIslandRadius',       'Island Radius',       1, 100, 0.5],
      ['uCoastSmoothness',    'Coast Smoothness',    0, 20, 0.1],
      ['uSeaLevel',           'Sea Level',         -20, 10, 0.1],
      ['uScale',              'Scale',             0.1, 5, 0.05],
      ['uTransparency',       'Transparency',        0, 1, 0.01],
      ['uReflectionStrength', 'Reflection',          0, 1, 0.01],
      ['uAmplitude',          'Wave Amplitude',      0, 5, 0.05],
      ['uWaveLength',         'Wave Length',       0.1, 10, 0.1],
      ['uWaveSpeed',          'Wave Speed',        0.1, 5, 0.1],
      ['uWindStrength',       'Wind Strength',       0, 5, 0.1],
    ]
    for (const [key, label, min, max, step] of numericUniforms) {
      if (u[key] === undefined) continue
      folder.add(u[key], 'value', min, max, step).name(label)
    }

    if (u['uWindDirection']) {
      const wd = u['uWindDirection'].value as THREE.Vector2
      const sub = folder.addFolder('Wind Direction')
      sub.add(wd, 'x', -1, 1, 0.01).name('X')
      sub.add(wd, 'y', -1, 1, 0.01).name('Y')
      sub.close()
    }

    // Mesh shadow toggles
    const meshes: THREE.Mesh[] = []
    this.systems.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      if (mats.includes(mat)) meshes.push(child)
    })
    if (meshes.length > 0) {
      const shadowProxy = { castShadow: meshes[0].castShadow, receiveShadow: meshes[0].receiveShadow }
      folder.add(shadowProxy, 'castShadow').name('Cast Shadow')
        .onChange((v: boolean) => { for (const m of meshes) m.castShadow = v })
      folder.add(shadowProxy, 'receiveShadow').name('Receive Shadow')
        .onChange((v: boolean) => { for (const m of meshes) m.receiveShadow = v })
    }

    this.addPrintButton(folder, `\uD83C\uDFA8 ${name}`, () => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(u)) {
        if (k.startsWith('uSun') || k.startsWith('uSpotlight') || k === 'isOrthographic') continue
        if (v.value instanceof THREE.Color) out[k] = '#' + v.value.getHexString()
        else if (v.value instanceof THREE.Vector3) out[k] = { x: v.value.x, y: v.value.y, z: v.value.z }
        else if (v.value instanceof THREE.Vector2) out[k] = { x: v.value.x, y: v.value.y }
        else if (typeof v.value === 'number') out[k] = v.value
      }
      if (meshes.length > 0) {
        out._castShadow = meshes[0].castShadow
        out._receiveShadow = meshes[0].receiveShadow
      }
      return out
    })
    folder.close()
  }

  // ==========================================================================
  // TAB: BATTLE
  // ==========================================================================

  private setupDialogueCameraControls(gui: GUI): void {
    const cam = this.systems.cameraManager
    if (!cam || !cam.dialogueCameraParams) return

    const folder = gui.addFolder('\uD83D\uDCFD\uFE0F Dialogue Camera')
    const params = cam.dialogueCameraParams

    folder.add(params, 'frontDist', 1, 10, 0.1).name('Front Distance')
    folder.add(params, 'bodyCenter', 0, 3, 0.05).name('Body Center Y')
    folder.add(params, 'fov', 20, 90, 1).name('FOV')

    this.addPrintButton(folder, '\uD83D\uDCFD\uFE0F Dialogue Camera', () => params)
    folder.close()
  }

  private setupBattleCameraControls(gui: GUI): void {
    const battleCtrl = this.systems.cameraManager?.getBattleCameraController?.()
    if (!battleCtrl) return

    const folder = gui.addFolder('\u2694\uFE0F Battle Camera')
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

      sub.add({
        preview: () => {
          if (battleCtrl.active) battleCtrl.previewShot(type)
          else console.warn(`\u2694\uFE0F [BattleCam] Not active \u2014 enter a battle first.`)
        },
      }, 'preview').name('\u25B6 Preview shot')
      sub.close()
    }
    shotsFolder.close()

    const animSync = this.systems.battleAnimSync
    if (animSync) {
      const syncFolder = folder.addFolder('Anim Sync Points')
      const clips = animSync.getRegisteredClips()
      for (const clipName of clips) {
        const clipFolder = syncFolder.addFolder(clipName)
        const points = animSync.getSyncPoints(clipName)
        for (const point of points) {
          clipFolder.add(point, 'fraction', 0, 1, 0.01).name(point.label)
            .onChange(() => animSync.resortSyncPoints(clipName))
        }
        clipFolder.close()
      }
      syncFolder.close()

      // Live status
      const statusFolder = folder.addFolder('Live Status')
      const statusProxy = { clip: '\u2014', character: '\u2014', mode: '\u2014', fraction: 0, nextEvent: '\u2014', queue: 0 }
      statusFolder.add(statusProxy, 'clip').name('clip').listen().disable()
      statusFolder.add(statusProxy, 'character').name('character').listen().disable()
      statusFolder.add(statusProxy, 'mode').name('mode').listen().disable()
      statusFolder.add(statusProxy, 'fraction', 0, 1).name('progress').listen().disable()
      statusFolder.add(statusProxy, 'nextEvent').name('next event').listen().disable()
      statusFolder.add(statusProxy, 'queue', 0, 10, 1).name('queue').listen().disable()

      setInterval(() => {
        const s = animSync.getActiveStatus()
        statusProxy.clip      = s.clipName ?? '\u2014'
        statusProxy.character = s.characterId ?? '\u2014'
        statusProxy.mode      = s.mode ?? '\u2014'
        statusProxy.fraction  = s.fraction
        statusProxy.nextEvent = s.nextEvent ?? '\u2014'
        statusProxy.queue     = s.queueLength
      }, 100)
      statusFolder.open()
    }

    // Global actions
    folder.add({ print: () => battleCtrl.printConfig() }, 'print').name('\uD83D\uDCCB Print shot config')
    if (animSync) {
      folder.add({ print: () => animSync.printSyncPoints() }, 'print').name('\uD83C\uDFAC Print sync points')
      folder.add({ print: () => { battleCtrl.printConfig(); animSync.printSyncPoints() } }, 'print').name('\uD83D\uDCBE Print all')
    }

    folder.close()
  }

  // ==========================================================================
  // TAB INFRASTRUCTURE
  // ==========================================================================

  private createGUI(title: string): GUI {
    const gui = new GUI({ width: 320, title: `\uD83C\uDFAE ${title}` })
    gui.domElement.style.position = 'static'
    gui.domElement.style.width = '100%'
    gui.domElement.style.display = 'none'
    this.wrapper!.appendChild(gui.domElement)
    return gui
  }

  private buildTabBar(): void {
    if (!this.tabBar) return
    this.tabBar.innerHTML = ''

    const left = this.makeTabArrow('\u25C0', () => this.switchTab(this.activeTabIndex - 1))
    this.tabBar.appendChild(left)

    for (let i = 0; i < this.tabs.length; i++) {
      const btn = document.createElement('div')
      btn.textContent = this.tabs[i].label
      btn.dataset.tabIndex = String(i)
      Object.assign(btn.style, {
        flex: '1', textAlign: 'center', padding: '6px 4px', cursor: 'pointer',
        fontSize: '11px', color: '#aaa', borderBottom: '2px solid transparent',
        transition: 'color 0.15s, border-color 0.15s',
      } as Partial<CSSStyleDeclaration>)
      btn.addEventListener('click', () => this.switchTab(i))
      this.tabBar.appendChild(btn)
    }

    const right = this.makeTabArrow('\u25B6', () => this.switchTab(this.activeTabIndex + 1))
    this.tabBar.appendChild(right)
  }

  private makeTabArrow(symbol: string, onClick: () => void): HTMLElement {
    const el = document.createElement('div')
    el.textContent = symbol
    Object.assign(el.style, {
      padding: '6px 8px', cursor: 'pointer', color: '#888',
      fontSize: '12px', userSelect: 'none',
    } as Partial<CSSStyleDeclaration>)
    el.addEventListener('click', onClick)
    return el
  }

  private switchTab(index: number): void {
    if (index < 0) index = this.tabs.length - 1
    if (index >= this.tabs.length) index = 0
    this.activeTabIndex = index

    for (let i = 0; i < this.tabs.length; i++) {
      this.tabs[i].gui.domElement.style.display = i === index ? '' : 'none'
    }

    if (this.tabBar) {
      const labels = this.tabBar.querySelectorAll<HTMLElement>('[data-tab-index]')
      labels.forEach((el) => {
        const isActive = el.dataset.tabIndex === String(index)
        el.style.color = isActive ? '#fff' : '#aaa'
        el.style.borderBottomColor = isActive ? '#58a6ff' : 'transparent'
      })
    }
  }

  // ==========================================================================
  // SHARED UTILITIES
  // ==========================================================================

  private addPrintButton(folder: any, label: string, getData: () => unknown): void {
    folder.add(
      { print: () => console.log(`\uD83D\uDCCB [${label}]`, JSON.parse(JSON.stringify(getData()))) },
      'print'
    ).name('\uD83D\uDCCB Print config to console')
  }

  public show(): void {
    if (this.wrapper) this.wrapper.style.display = ''
  }

  public hide(): void {
    if (this.wrapper) this.wrapper.style.display = 'none'
  }

  public toggle(): void {
    if (this.wrapper) this.wrapper.style.display = this.wrapper.style.display === 'none' ? '' : 'none'
  }

  public dispose(): void {
    for (const tab of this.tabs) tab.gui.destroy()
    this.tabs = []
    if (this.wrapper) { this.wrapper.remove(); this.wrapper = null }
    this.tabBar = null
    logger.info(LogModule.SYSTEM, 'Debug GUI Manager disposed')
  }

  public getGUI(): GUI | null {
    return this.tabs[this.activeTabIndex]?.gui ?? null
  }
}
