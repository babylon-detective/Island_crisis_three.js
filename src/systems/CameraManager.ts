import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BattleCameraController } from './BattleCameraController'
import type { BattleShotType, BattleCameraShot } from './BattleCameraController'

export type CameraMode = 'thirdperson' | 'dialogue' | 'battle'
type InternalCameraMode = CameraMode | 'freeview'

export type { BattleShotType, BattleCameraShot }

export interface CameraConfig {
  fov: number
  near: number
  far: number
  position: THREE.Vector3
  target?: THREE.Vector3
}

export interface PlayerCameraConfig extends CameraConfig {
  height: number
  mouseSensitivity: number
  smoothing: number
}

// ============================================================================
// CAMERA MANAGER CONFIGURATION
// ============================================================================
export interface CameraManagerConfig {
  // Default states
  defaultMode: CameraMode
  defaultZoom: number

  // Free View camera (debug orbital camera)
  freeViewCamera: {
    fov: number
    position: THREE.Vector3
    targetHeight: number
  }

  // Player controls
  playerControls: {
    height: number
  }

  // Spotlight
  spotlight: {
    enabled: boolean
    intensity: number
    angle: number
    penumbra: number
    decay: number
    distance: number
    height: number
    offset: number
  }

  // Transitions
  transitionDuration: number

  // Third-person camera configuration
  thirdPerson: {
    distance: number
    height: number
    lookAtHeight: number
    fov: number
    smoothing: number
    rotationSmoothing: number
    pitchMin: number
    pitchMax: number
    sensitivity: number
    collisionEnabled: boolean
    collisionPadding: number
  }
}

// Default configuration
const DEFAULT_CAMERA_CONFIG: CameraManagerConfig = {
  defaultMode: 'thirdperson',
  defaultZoom: 2,

  freeViewCamera: {
    fov: 75,
    position: new THREE.Vector3(0.138, 1.716, -1.884),
    targetHeight: 2,
  },

  playerControls: {
    height: 1.8,
  },

  spotlight: {
    enabled: true,
    intensity: 3,
    angle: Math.PI / 8,
    penumbra: 0.3,
    decay: 2,
    distance: 80,
    height: 30,
    offset: 5,
  },

  transitionDuration: 1.0,

  thirdPerson: {
    distance: 6,
    height: 2.5,
    lookAtHeight: 1.2,
    fov: 60,
    smoothing: 0.08,
    rotationSmoothing: 0.12,
    pitchMin: -Math.PI / 6,
    pitchMax: Math.PI / 3,
    sensitivity: 0.003,
    collisionEnabled: true,
    collisionPadding: 0.3,
  },
}

export class CameraManager {
  private scene: THREE.Scene
  private renderer: THREE.WebGLRenderer
  private container: HTMLElement
  private config: CameraManagerConfig

  // Cameras
  private freeViewCamera!: THREE.PerspectiveCamera
  private thirdPersonCamera!: THREE.PerspectiveCamera
  private dialogueCamera!: THREE.PerspectiveCamera
  private battleCamera!: THREE.PerspectiveCamera
  private currentCamera!: THREE.Camera
  private currentMode: InternalCameraMode

  // Third-person orbit state
  private tpYaw: number = 0
  private tpPitch: number = 0.3
  private tpCurrentPos: THREE.Vector3 = new THREE.Vector3()
  private tpCurrentLookAt: THREE.Vector3 = new THREE.Vector3()
  private tpInitialised: boolean = false
  private touchLookActive: boolean = false

  // Player spotlight
  private playerSpotlight: THREE.SpotLight | null = null
  private spotlightNightFactor: number = 1

  // Land system reference
  private landSystem: any = null

  // Player visual representation
  private playerMesh: THREE.Object3D | null = null
  private playerMeshHiddenReasons: Set<string> = new Set()

  // Camera collision
  private cameraRaycaster: THREE.Raycaster = new THREE.Raycaster()
  private collisionMeshes: THREE.Object3D[] = []

  // Dialogue camera state
  private priorMode: InternalCameraMode = 'thirdperson'
  private dialogueTargetPos: THREE.Vector3 = new THREE.Vector3()
  private dialogueTargetLookAt: THREE.Vector3 = new THREE.Vector3()
  private dialogueFadeOverlay: HTMLDivElement | null = null
  private dialogueFading: boolean = false
  private pendingFadeRequest: { halfDuration: number; onMidFade: () => void; label: string } | null = null
  private gameplayMode: InternalCameraMode = 'thirdperson'
  private modalRecoveryCallback: ((reason: string) => void) | null = null

  // Battle camera controller
  private battleCameraController: BattleCameraController

  // Debug freeview controls (OrbitControls)
  private orbitControls!: OrbitControls

  // Player camera properties
  private playerPosition: THREE.Vector3 = new THREE.Vector3(0, 5, 0)
  private previousPlayerPosition: THREE.Vector3 = new THREE.Vector3(0, 5, 0)
  private playerHeight: number

  // Orbit camera tracking (freeview debug)
  private orbitCameraOffset: THREE.Vector3 | null = null

  // Mouse tracking
  private lastMouseX: number | null = null
  private lastMouseY: number | null = null

  // Transition properties
  private isTransitioning: boolean = false
  private transitionDuration: number
  private transitionStart: number = 0
  private transitionFromPosition: THREE.Vector3 = new THREE.Vector3()
  private transitionFromRotation: THREE.Euler = new THREE.Euler()
  private transitionToPosition: THREE.Vector3 = new THREE.Vector3()
  private transitionToRotation: THREE.Euler = new THREE.Euler()

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    container: HTMLElement,
    config: Partial<CameraManagerConfig> = {},
  ) {
    this.scene = scene
    this.renderer = renderer
    this.container = container

    this.config = this.mergeConfig(DEFAULT_CAMERA_CONFIG, config)

    this.currentMode = this.config.defaultMode
    this.playerHeight = this.config.playerControls.height
    this.transitionDuration = this.config.transitionDuration

    this.initializeCameras()
    this.battleCameraController = new BattleCameraController(this.battleCamera)
    this.initializeControls()
    this.initializePlayerSpotlight()
    this.setupEventListeners()

    console.log(`📷 CameraManager initialized - Mode: ${this.currentMode}`)
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  private mergeConfig(
    defaults: CameraManagerConfig,
    overrides: Partial<CameraManagerConfig>,
  ): CameraManagerConfig {
    return {
      ...defaults,
      ...overrides,
      freeViewCamera: { ...defaults.freeViewCamera, ...overrides.freeViewCamera },
      playerControls: { ...defaults.playerControls, ...overrides.playerControls },
      spotlight: { ...defaults.spotlight, ...overrides.spotlight },
      thirdPerson: { ...defaults.thirdPerson, ...overrides.thirdPerson },
    }
  }

  public getConfig(): CameraManagerConfig {
    return { ...this.config }
  }

  public updateConfig(updates: Partial<CameraManagerConfig>): void {
    this.config = this.mergeConfig(this.config, updates)
    console.log('📷 Camera configuration updated', updates)
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  private initializeCameras(): void {
    const aspect = window.innerWidth / window.innerHeight

    // Free View Camera (debug-only orbital camera)
    this.freeViewCamera = new THREE.PerspectiveCamera(
      this.config.freeViewCamera.fov,
      aspect,
      0.1,
      1000,
    )
    this.freeViewCamera.position.copy(this.config.freeViewCamera.position)
    this.freeViewCamera.name = 'FreeViewCamera'

    // Third-Person Action Camera (primary gameplay camera)
    this.thirdPersonCamera = new THREE.PerspectiveCamera(
      this.config.thirdPerson.fov,
      aspect,
      0.1,
      1000,
    )
    this.thirdPersonCamera.position.copy(this.playerPosition)
    this.thirdPersonCamera.position.y += this.config.thirdPerson.height
    this.thirdPersonCamera.position.z -= this.config.thirdPerson.distance
    this.thirdPersonCamera.name = 'ThirdPersonCamera'

    // Dialogue Camera (static frontal NPC shot)
    this.dialogueCamera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000)
    this.dialogueCamera.name = 'DialogueCamera'

    // Battle Camera (dynamic cinematic camera)
    this.battleCamera = new THREE.PerspectiveCamera(46, aspect, 0.1, 1000)
    this.battleCamera.name = 'BattleCamera'

    // Set initial camera
    this.currentCamera = this.getCameraForMode(this.currentMode)

    console.log('📷 Cameras initialized: ThirdPerson + Dialogue + Battle + FreeView(debug)')
    console.log(`📷 Current mode: ${this.currentMode}`)
  }

  private getCameraForMode(mode: InternalCameraMode): THREE.PerspectiveCamera {
    switch (mode) {
      case 'thirdperson': return this.thirdPersonCamera
      case 'dialogue': return this.dialogueCamera
      case 'battle': return this.battleCamera
      case 'freeview': return this.freeViewCamera
    }
  }

  private initializeControls(): void {
    // Orbit controls for debug freeview camera
    this.orbitControls = new OrbitControls(this.freeViewCamera, this.renderer.domElement)
    this.orbitControls.enableDamping = true
    this.orbitControls.dampingFactor = 0.05
    this.orbitControls.minDistance = 2
    this.orbitControls.maxDistance = 1000
    this.orbitControls.maxPolarAngle = Math.PI * 0.95
    this.orbitControls.minPolarAngle = Math.PI * 0.05
    this.orbitControls.target.set(0, this.config.freeViewCamera.targetHeight, 0)
    this.orbitControls.enabled = false  // Disabled by default — debug only
    this.orbitControls.update()
  }

  private setupEventListeners(): void {
    const isTouchDevice = 'ontouchstart' in window

    // Mouse movement for third-person camera orbit
    this.container.addEventListener('mousemove', this.onMouseMove.bind(this))

    // Reset manual mouse tracking on every new pointer interaction so that
    // the first subsequent mousemove recalibrates instead of computing a
    // stale delta (fixes touch-screen camera rotation bug).
    this.container.addEventListener('pointerdown', () => {
      this.lastMouseX = null
      this.lastMouseY = null
    })

    // Pointer lock for third-person camera (desktop only — mobile doesn't support it)
    if (!isTouchDevice) {
      this.container.addEventListener('click', () => {
        if (this.currentMode === 'thirdperson') {
          this.container.requestPointerLock().catch(() => {})
        }
      })

      document.addEventListener('pointerlockchange', this.onPointerLockChange.bind(this))

      // Auto-request pointer lock if starting in thirdperson mode
      if (this.currentMode === 'thirdperson') {
        setTimeout(() => {
          if (this.currentMode === 'thirdperson' && document.pointerLockElement !== this.container) {
            this.container.requestPointerLock().catch(() => {})
          }
        }, 100)
      }
    }

    window.addEventListener('resize', this.handleResize.bind(this))
  }

  private initializePlayerSpotlight(): void {
    if (!this.config.spotlight.enabled) {
      console.log('💡 Player spotlight disabled via config')
      return
    }

    this.playerSpotlight = new THREE.SpotLight(0xffffff, this.config.spotlight.intensity)
    this.playerSpotlight.position.set(0, 40, -20)
    this.playerSpotlight.angle = this.config.spotlight.angle
    this.playerSpotlight.penumbra = this.config.spotlight.penumbra
    this.playerSpotlight.decay = this.config.spotlight.decay
    this.playerSpotlight.distance = this.config.spotlight.distance

    this.playerSpotlight.castShadow = true
    this.playerSpotlight.shadow.mapSize.width = 2048
    this.playerSpotlight.shadow.mapSize.height = 2048
    this.playerSpotlight.shadow.camera.near = 10
    this.playerSpotlight.shadow.camera.far = 100

    this.scene.add(this.playerSpotlight)
    this.scene.add(this.playerSpotlight.target)
    this.playerSpotlight.visible = true

    const angleDegrees = (this.config.spotlight.angle * 180 / Math.PI).toFixed(1)
    console.log(`💡 Player spotlight initialized - Intensity: ${this.config.spotlight.intensity}, Angle: ${angleDegrees}°, Distance: ${this.config.spotlight.distance}`)
  }

  // ============================================================================
  // CAMERA SWITCHING
  // ============================================================================

  public switchCamera(mode: CameraMode | 'freeview', immediate: boolean = false): void {
    if (this.currentMode === mode || this.isTransitioning) return

    const fromCamera = this.currentCamera
    const toCamera = this.getCameraForMode(mode as InternalCameraMode)

    if (immediate) {
      this.setActiveCamera(mode as InternalCameraMode, true)
    } else {
      this.startCameraTransition(fromCamera, toCamera, mode as InternalCameraMode)
    }
  }

  private startCameraTransition(
    from: THREE.Camera,
    to: THREE.Camera,
    targetMode: InternalCameraMode,
  ): void {
    this.isTransitioning = true
    this.transitionStart = performance.now()

    this.transitionFromPosition.copy(from.position)
    this.transitionFromRotation.copy(from.rotation)
    this.transitionToPosition.copy(to.position)
    this.transitionToRotation.copy(to.rotation)

    this.currentMode = targetMode
  }

  private setActiveCamera(mode: InternalCameraMode, requestPointerLock: boolean = false): void {
    this.currentMode = mode
    if (mode !== 'dialogue' && mode !== 'battle') {
      this.gameplayMode = mode
    }
    this.currentCamera = this.getCameraForMode(mode)

    // Enable/disable controls
    this.orbitControls.enabled = (mode === 'freeview')

    // Handle pointer lock (desktop only)
    if (mode === 'thirdperson' && requestPointerLock && !('ontouchstart' in window)) {
      if (document.pointerLockElement !== this.container) {
        this.container.requestPointerLock().catch(() => {})
      }
    } else if (mode === 'freeview') {
      if (document.pointerLockElement === this.container) {
        document.exitPointerLock()
      }
    }

    this.applyPlayerMeshVisibility(mode)
    if (mode !== 'dialogue' && mode !== 'battle') {
      this.forceClearFadeOverlay(`setActiveCamera:${mode}`)
    }
    console.log(`📷 Active camera set: mode=${mode}, camera=${this.currentCamera.name}, gameplayMode=${this.gameplayMode}, pointerLock=${requestPointerLock}`)
  }

  private getResumeMode(): InternalCameraMode {
    if (this.priorMode === 'dialogue' || this.priorMode === 'battle') {
      return this.gameplayMode
    }
    return this.priorMode
  }

  private shouldPlayerMeshBeVisible(mode: InternalCameraMode = this.currentMode): boolean {
    return mode !== 'dialogue' && this.playerMeshHiddenReasons.size === 0
  }

  private applyPlayerMeshVisibility(mode: InternalCameraMode = this.currentMode): void {
    if (!this.playerMesh) return
    this.playerMesh.visible = this.shouldPlayerMeshBeVisible(mode)
  }

  public setPlayerMeshRenderSuppressed(reason: string, suppressed: boolean): void {
    if (suppressed) {
      this.playerMeshHiddenReasons.add(reason)
    } else {
      this.playerMeshHiddenReasons.delete(reason)
    }
    this.applyPlayerMeshVisibility()
  }

  // ============================================================================
  // MOUSE INPUT
  // ============================================================================

  private onMouseMove(event: MouseEvent): void {
    if (this.currentMode === 'thirdperson') {
      this.onMouseMoveThirdPerson(event)
    }
    // Other modes don't use mouse-driven camera rotation
  }

  private onPointerLockChange(): void {
    // No-op — kept for potential future use
  }

  // ============================================================================
  // THIRD-PERSON CAMERA
  // ============================================================================

  private onMouseMoveThirdPerson(event: MouseEvent): void {
    // Skip mouse-driven rotation while touch is actively controlling the camera.
    // The touch path (PlayerController → updatePlayerCameraFromGamepad) handles
    // this instead; letting stale mousemove deltas through here would fight it.
    if (this.touchLookActive) return

    let movementX = 0
    let movementY = 0

    if (document.pointerLockElement === this.container) {
      movementX = event.movementX || 0
      movementY = event.movementY || 0
    } else {
      if (this.lastMouseX === null || this.lastMouseY === null) {
        this.lastMouseX = event.clientX
        this.lastMouseY = event.clientY
        return
      }
      movementX = event.clientX - this.lastMouseX
      movementY = event.clientY - this.lastMouseY
      this.lastMouseX = event.clientX
      this.lastMouseY = event.clientY

      // Discard obviously stale deltas (e.g. from a compatibility mousemove
      // that references a position from a previous, distant touch session).
      const MAX_SANE_DELTA = 60
      if (Math.abs(movementX) > MAX_SANE_DELTA || Math.abs(movementY) > MAX_SANE_DELTA) {
        return
      }
    }

    const sens = this.config.thirdPerson.sensitivity
    this.tpYaw -= movementX * sens
    this.tpPitch += movementY * sens

    this.tpPitch = Math.max(
      this.config.thirdPerson.pitchMin,
      Math.min(this.config.thirdPerson.pitchMax, this.tpPitch),
    )
  }

  private updateThirdPersonCamera(deltaTime: number): void {
    const cfg = this.config.thirdPerson

    const desiredPos = new THREE.Vector3()
    desiredPos.x = Math.sin(this.tpYaw) * Math.cos(this.tpPitch) * cfg.distance
    desiredPos.y = Math.sin(this.tpPitch) * cfg.distance + cfg.height
    desiredPos.z = Math.cos(this.tpYaw) * Math.cos(this.tpPitch) * cfg.distance
    desiredPos.add(this.playerPosition)

    const desiredLookAt = this.playerPosition.clone()
    desiredLookAt.y += cfg.lookAtHeight

    if (cfg.collisionEnabled) {
      const groundY = this.playerPosition.y + cfg.collisionPadding
      if (desiredPos.y < groundY) {
        desiredPos.y = groundY
      }

      if (this.collisionMeshes.length > 0) {
        const origin = desiredLookAt.clone()
        const direction = new THREE.Vector3().subVectors(desiredPos, origin)
        const maxDist = direction.length()
        if (maxDist > 0.01) {
          direction.normalize()
          this.cameraRaycaster.set(origin, direction)
          this.cameraRaycaster.near = 0
          this.cameraRaycaster.far = maxDist

          const hits = this.cameraRaycaster.intersectObjects(this.collisionMeshes, true)
          if (hits.length > 0) {
            const safeDist = Math.max(hits[0].distance - cfg.collisionPadding, 0.5)
            desiredPos.copy(origin).addScaledVector(direction, safeDist)
          }
        }
      }
    }

    if (!this.tpInitialised) {
      this.tpCurrentPos.copy(desiredPos)
      this.tpCurrentLookAt.copy(desiredLookAt)
      this.tpInitialised = true
    } else {
      this.tpCurrentPos.lerp(desiredPos, cfg.smoothing)
      this.tpCurrentLookAt.lerp(desiredLookAt, cfg.rotationSmoothing)
    }

    this.thirdPersonCamera.position.copy(this.tpCurrentPos)
    this.thirdPersonCamera.lookAt(this.tpCurrentLookAt)

    if (this.thirdPersonCamera.fov !== cfg.fov) {
      this.thirdPersonCamera.fov = cfg.fov
      this.thirdPersonCamera.updateProjectionMatrix()
    }

    this.applyPlayerMeshVisibility('thirdperson')
  }

  // ============================================================================
  // UPDATE METHODS
  // ============================================================================

  public update(deltaTime: number): void {
    if (this.isTransitioning) {
      this.updateCameraTransition()
    }

    this.updatePlayerSpotlight()

    if (this.currentMode === 'freeview') {
      if (!this.orbitCameraOffset) {
        this.orbitCameraOffset = new THREE.Vector3()
        this.orbitCameraOffset.copy(this.config.freeViewCamera.position)
        this.freeViewCamera.position.copy(this.playerPosition).add(this.orbitCameraOffset)
        this.previousPlayerPosition.copy(this.playerPosition)
      }

      const playerDelta = new THREE.Vector3().subVectors(
        this.playerPosition,
        this.previousPlayerPosition,
      )
      this.freeViewCamera.position.add(playerDelta)
      this.orbitControls.target.add(playerDelta)
      this.orbitControls.update()
      this.orbitCameraOffset.copy(this.freeViewCamera.position).sub(this.playerPosition)
      this.previousPlayerPosition.copy(this.playerPosition)
    } else if (this.currentMode === 'thirdperson') {
      this.updateThirdPersonCamera(deltaTime)
    } else if (this.currentMode === 'dialogue') {
      // Static — position set during enterDialogueMode
    } else if (this.currentMode === 'battle') {
      // Battle camera controller drives the camera
      this.battleCameraController.update(deltaTime)
    }
  }

  private updateCameraTransition(): void {
    const elapsed = (performance.now() - this.transitionStart) / 1000
    const progress = Math.min(elapsed / this.transitionDuration, 1)
    const easedProgress = 1 - Math.pow(1 - progress, 3)

    this.currentCamera.position.lerpVectors(
      this.transitionFromPosition,
      this.transitionToPosition,
      easedProgress,
    )

    const fromQuaternion = new THREE.Quaternion().setFromEuler(this.transitionFromRotation)
    const toQuaternion = new THREE.Quaternion().setFromEuler(this.transitionToRotation)
    const currentQuaternion = new THREE.Quaternion().slerpQuaternions(
      fromQuaternion,
      toQuaternion,
      easedProgress,
    )
    this.currentCamera.setRotationFromQuaternion(currentQuaternion)

    if (progress >= 1) {
      this.isTransitioning = false
      this.setActiveCamera(this.currentMode, false)
    }
  }

  // ============================================================================
  // SPOTLIGHT
  // ============================================================================

  private updatePlayerSpotlight(): void {
    if (!this.playerSpotlight) return

    const effectiveIntensity = this.config.spotlight.intensity * this.spotlightNightFactor
    this.playerSpotlight.intensity = effectiveIntensity
    this.playerSpotlight.visible = effectiveIntensity > 0.01

    const spotlightHeight = this.config.spotlight.height
    const cameraOffset = this.config.spotlight.offset

    this.playerSpotlight.position.set(
      this.playerPosition.x,
      this.playerPosition.y + spotlightHeight,
      this.playerPosition.z - cameraOffset,
    )

    this.playerSpotlight.target.position.copy(this.playerPosition)
    this.playerSpotlight.target.position.y += 0.5
    this.playerSpotlight.target.updateMatrixWorld()

    if (this.landSystem) {
      this.landSystem.setSpotlightPosition(this.playerSpotlight.position)
      const direction = new THREE.Vector3()
      direction
        .subVectors(this.playerSpotlight.target.position, this.playerSpotlight.position)
        .normalize()
      this.landSystem.setSpotlightDirection(direction)
      this.landSystem.setSpotlightColor(this.playerSpotlight.color)
      this.landSystem.setSpotlightIntensity(effectiveIntensity)
    }
  }

  public setPlayerSpotlightNightFactor(factor: number): void {
    this.spotlightNightFactor = THREE.MathUtils.clamp(factor, 0, 1)
  }

  // ============================================================================
  // PLAYER POSITION MANAGEMENT
  // ============================================================================

  public setPlayerPosition(position: THREE.Vector3): void {
    this.playerPosition.copy(position)
  }

  /**
   * Signal whether touch-based camera look is active.
   * When active, onMouseMoveThirdPerson is suppressed to prevent stale
   * compatibility-mouse-event deltas from fighting the touch camera path.
   */
  public setTouchLookActive(active: boolean): void {
    this.touchLookActive = active
    if (active) {
      this.lastMouseX = null
      this.lastMouseY = null
    }
  }

  public getPlayerPosition(): THREE.Vector3 {
    return this.playerPosition.clone()
  }

  public setPlayerHeight(height: number): void {
    this.playerHeight = height
  }

  // ============================================================================
  // GETTERS
  // ============================================================================

  public getCamera(): THREE.Camera {
    return this.currentCamera
  }

  public setModalRecoveryCallback(callback: ((reason: string) => void) | null): void {
    this.modalRecoveryCallback = callback
  }

  public getCurrentMode(): CameraMode | 'freeview' {
    return this.currentMode
  }

  public refreshViewport(width: number, height: number): void {
    const safeWidth = Math.max(width, 1)
    const safeHeight = Math.max(height, 1)
    const aspect = safeWidth / safeHeight

    this.freeViewCamera.aspect = aspect
    this.freeViewCamera.updateProjectionMatrix()

    this.thirdPersonCamera.aspect = aspect
    this.thirdPersonCamera.updateProjectionMatrix()

    this.dialogueCamera.aspect = aspect
    this.dialogueCamera.updateProjectionMatrix()

    this.battleCamera.aspect = aspect
    this.battleCamera.updateProjectionMatrix()
  }

  public registerPlayerMesh(mesh: THREE.Object3D): void {
    this.playerMesh = mesh
    this.applyPlayerMeshVisibility()
  }

  /** Debug-only: get the freeview camera for zoom-to-selection etc. */
  public getFreeViewCamera(): THREE.PerspectiveCamera {
    return this.freeViewCamera
  }

  public getThirdPersonCamera(): THREE.PerspectiveCamera {
    return this.thirdPersonCamera
  }

  public getThirdPersonYaw(): number {
    return this.tpYaw
  }

  /** Debug-only: get orbit controls for freeview. */
  public getOrbitControls(): OrbitControls {
    return this.orbitControls
  }

  public getPlayerSpotlight(): THREE.SpotLight | null {
    return this.playerSpotlight
  }

  /** Get the battle camera controller for choreography. */
  public getBattleCameraController(): BattleCameraController {
    return this.battleCameraController
  }

  /**
   * Update camera rotation from gamepad input.
   */
  public updatePlayerCameraFromGamepad(
    deltaX: number,
    deltaY: number,
    deltaTime: number,
  ): void {
    if (this.currentMode === 'freeview') {
      const rotateSpeed = 0.08
      const offset = new THREE.Vector3()
      offset.copy(this.freeViewCamera.position).sub(this.orbitControls.target)
      const spherical = new THREE.Spherical()
      spherical.setFromVector3(offset)

      spherical.theta -= deltaX * rotateSpeed * deltaTime * 60
      spherical.phi -= deltaY * rotateSpeed * deltaTime * 60
      spherical.phi = Math.max(
        this.orbitControls.minPolarAngle,
        Math.min(this.orbitControls.maxPolarAngle, spherical.phi),
      )

      offset.setFromSpherical(spherical)
      this.freeViewCamera.position.copy(this.orbitControls.target).add(offset)
      this.freeViewCamera.lookAt(this.orbitControls.target)

      if (this.orbitCameraOffset) {
        this.orbitCameraOffset.copy(offset)
      }
    } else if (this.currentMode === 'thirdperson') {
      const gamepadSensitivity = this.config.thirdPerson.sensitivity * 100
      this.tpYaw -= deltaX * gamepadSensitivity * deltaTime * 60
      this.tpPitch += deltaY * gamepadSensitivity * deltaTime * 60
      this.tpPitch = Math.max(
        this.config.thirdPerson.pitchMin,
        Math.min(this.config.thirdPerson.pitchMax, this.tpPitch),
      )
    }
  }

  /**
   * Update camera rotation from touch input.
   * Unlike the gamepad path this does NOT multiply by deltaTime — touch deltas
   * are already per-frame accumulated pixel values, so time-scaling would make
   * sensitivity frame-rate dependent (too slow on high-refresh-rate phones).
   * Sensitivity: ~150° rotation for a full 375 px phone-width swipe.
   */
  public updatePlayerCameraFromTouch(rawDeltaX: number, rawDeltaY: number): void {
    const touchSens = 0.007 // rad per raw CSS pixel
    if (this.currentMode === 'thirdperson') {
      this.tpYaw -= rawDeltaX * touchSens
      this.tpPitch += rawDeltaY * touchSens
      this.tpPitch = Math.max(
        this.config.thirdPerson.pitchMin,
        Math.min(this.config.thirdPerson.pitchMax, this.tpPitch),
      )
    } else if (this.currentMode === 'freeview') {
      const orbitSens = 0.005
      const offset = new THREE.Vector3()
      offset.copy(this.freeViewCamera.position).sub(this.orbitControls.target)
      const spherical = new THREE.Spherical()
      spherical.setFromVector3(offset)
      spherical.theta -= rawDeltaX * orbitSens
      spherical.phi -= rawDeltaY * orbitSens
      spherical.phi = Math.max(
        this.orbitControls.minPolarAngle,
        Math.min(this.orbitControls.maxPolarAngle, spherical.phi),
      )
      offset.setFromSpherical(spherical)
      this.freeViewCamera.position.copy(this.orbitControls.target).add(offset)
      this.freeViewCamera.lookAt(this.orbitControls.target)
      if (this.orbitCameraOffset) {
        this.orbitCameraOffset.copy(offset)
      }
    }
  }

  public setTransitionDuration(duration: number): void {
    this.transitionDuration = duration
  }

  // ============================================================================
  // UTILITY
  // ============================================================================

  private handleResize = (): void => {
    const width = Math.max(window.innerWidth, 1)
    const height = Math.max(window.innerHeight, 1)
    const aspect = width / height

    this.freeViewCamera.aspect = aspect
    this.freeViewCamera.updateProjectionMatrix()

    this.thirdPersonCamera.aspect = aspect
    this.thirdPersonCamera.updateProjectionMatrix()

    this.dialogueCamera.aspect = aspect
    this.dialogueCamera.updateProjectionMatrix()

    this.battleCamera.aspect = aspect
    this.battleCamera.updateProjectionMatrix()
  }

  public getCameraInfo(): object {
    return {
      currentMode: this.currentMode,
      isTransitioning: this.isTransitioning,
      freeViewCamera: {
        position: this.freeViewCamera.position.toArray(),
        rotation: this.freeViewCamera.rotation.toArray(),
      },
      thirdPersonCamera: {
        position: this.thirdPersonCamera.position.toArray(),
        rotation: this.thirdPersonCamera.rotation.toArray(),
        yaw: this.tpYaw,
        pitch: this.tpPitch,
      },
      battleCameraActive: this.battleCameraController.active,
    }
  }

  public setCollisionMeshes(meshes: THREE.Object3D[]): void {
    this.collisionMeshes = meshes
    console.log(`📷 Camera collision meshes updated (${meshes.length} root objects)`)
  }

  public addCollisionMeshes(meshes: THREE.Object3D[]): void {
    this.collisionMeshes.push(...meshes)
    console.log(`📷 Camera collision meshes appended (+${meshes.length}, total ${this.collisionMeshes.length})`)
  }

  public setLandSystem(landSystem: any): void {
    this.landSystem = landSystem
    console.log('📷 Land system linked to CameraManager for spotlight updates')
  }

  // ============================================================================
  // DEBUG FREEVIEW
  // ============================================================================

  /** Enable debug freeview (orbital camera). */
  public enableDebugFreeview(): void {
    this.switchCamera('freeview', true)
  }

  /** Disable debug freeview — return to thirdperson. */
  public disableDebugFreeview(): void {
    if (this.currentMode === 'freeview') {
      this.switchCamera('thirdperson', true)
    }
  }

  // ============================================================================
  // DIALOGUE CAMERA
  // ============================================================================

  public enterDialogueMode(npcPosition: THREE.Vector3, npcRotation: number): void {
    this.priorMode =
      this.currentMode === 'dialogue' || this.currentMode === 'battle'
        ? this.gameplayMode
        : this.currentMode
    console.log(`📷 Dialogue enter requested: current=${this.currentMode}, prior=${this.priorMode}, gameplay=${this.gameplayMode}`)

    const npcForward = new THREE.Vector3(Math.sin(npcRotation), 0, Math.cos(npcRotation))
    const bodyCenter = 0.9
    const frontDist = 3.5

    this.dialogueTargetPos
      .copy(npcPosition)
      .addScaledVector(npcForward, frontDist)
    this.dialogueTargetPos.y = npcPosition.y + bodyCenter

    this.dialogueTargetLookAt.copy(npcPosition)
    this.dialogueTargetLookAt.y += bodyCenter

    this.fadeTransition(
      0.3,
      () => {
        this.setPlayerMeshRenderSuppressed('dialogue', true)
        this.dialogueCamera.position.copy(this.dialogueTargetPos)
        this.dialogueCamera.lookAt(this.dialogueTargetLookAt)
        this.switchCamera('dialogue', true)
        console.log(`📷 Dialogue camera activated: prior=${this.priorMode}, current=${this.currentMode}`)
      },
      'enter-dialogue',
      '#000',
    )
  }

  public exitDialogueMode(): void {
    if (this.currentMode !== 'dialogue') return
    const resumeMode = this.getResumeMode()
    console.log(`📷 Dialogue exit requested: current=${this.currentMode}, prior=${this.priorMode}, resume=${resumeMode}`)
    this.fadeTransition(
      0.3,
      () => {
        this.setPlayerMeshRenderSuppressed('dialogue', false)
        this.switchCamera(resumeMode as CameraMode, true)
        this.requestModalRecovery('exit-dialogue')
        console.log(`📷 Dialogue camera exited: resumed=${resumeMode}, current=${this.currentMode}`)
      },
      'exit-dialogue',
      '#000',
    )
  }

  // ============================================================================
  // BATTLE CAMERA
  // ============================================================================

  /**
   * Enter battle camera mode.
   * White-flash transition → opening cinematic → menu idle (¾ isometric).
   * Positions should already be staged to 8 units apart by BattleSystem.
   */
  public enterBattleMode(playerPosition: THREE.Vector3, npcPosition: THREE.Vector3): void {
    this.priorMode =
      this.currentMode === 'dialogue' || this.currentMode === 'battle'
        ? this.gameplayMode
        : this.currentMode
    console.log(`📷 Battle enter requested: current=${this.currentMode}, prior=${this.priorMode}, gameplay=${this.gameplayMode}`)

    // Configure the battle camera controller with combatant positions
    this.battleCameraController.setBattlePositions(playerPosition, npcPosition)

    this.flashTransition(0.25, () => {
      // Switch to battle camera
      this.setActiveCamera('battle', false)
      this.battleCameraController.start()

      // Play the opening cinematic → settles on ¾ isometric menu idle
      this.battleCameraController.playOpening(() => {
        console.log('📷 Battle opening cinematic complete — menu idle active')
      })

      console.log(
        `📷 Battle camera activated: prior=${this.priorMode}, current=${this.currentMode}, ` +
        `player=(${playerPosition.x.toFixed(2)}, ${playerPosition.y.toFixed(2)}, ${playerPosition.z.toFixed(2)}), ` +
        `enemy=(${npcPosition.x.toFixed(2)}, ${npcPosition.y.toFixed(2)}, ${npcPosition.z.toFixed(2)})`,
      )
    }, 'enter-battle')
  }

  /**
   * Exit battle camera mode — white flash back to thirdperson.
   */
  public exitBattleMode(): void {
    if (this.currentMode !== 'battle') return
    const resumeMode = this.getResumeMode()
    console.log(`📷 Battle exit requested: current=${this.currentMode}, prior=${this.priorMode}, resume=${resumeMode}`)

    this.flashTransition(0.25, () => {
      this.battleCameraController.stop()
      this.switchCamera(resumeMode as CameraMode, true)
      this.requestModalRecovery('exit-battle')
      console.log(`📷 Battle camera exited: resumed=${resumeMode}, current=${this.currentMode}`)
    }, 'exit-battle')
  }

  /**
   * Request a battle camera shot cut (for use by BattleSystem during turns).
   */
  public battleCutTo(shotType: BattleShotType): void {
    if (this.currentMode !== 'battle') return
    this.battleCameraController.cutTo(shotType)
  }

  /**
   * Queue a battle camera sequence (for use by BattleSystem during attacks).
   */
  public battlePlaySequence(shots: BattleCameraShot[]): void {
    if (this.currentMode !== 'battle') return
    this.battleCameraController.playSequence(shots)
  }

  /**
   * Update battle positions (e.g. after player teleports for attack).
   */
  public updateBattlePositions(player: THREE.Vector3, enemy: THREE.Vector3): void {
    this.battleCameraController.setBattlePositions(player, enemy)
  }

  // ============================================================================
  // TRANSITIONS
  // ============================================================================

  /**
   * Fade to colour and back, calling onMidFade at the peak.
   * Used for dialogue (black fade) and can be used for other transitions.
   */
  private fadeTransition(
    halfDuration: number,
    onMidFade: () => void,
    label: string = 'modal-transition',
    colour: string = '#000',
  ): void {
    if (this.dialogueFading) {
      this.pendingFadeRequest = { halfDuration, onMidFade, label }
      console.log(`📷 Fade queued: label=${label}, current=${this.currentMode}, prior=${this.priorMode}, gameplay=${this.gameplayMode}`)
      return
    }
    this.dialogueFading = true
    console.log(`📷 Fade start: label=${label}, current=${this.currentMode}, prior=${this.priorMode}, gameplay=${this.gameplayMode}`)

    if (!this.dialogueFadeOverlay) {
      this.dialogueFadeOverlay = document.createElement('div')
      this.dialogueFadeOverlay.style.cssText =
        'position:fixed;inset:0;opacity:0;pointer-events:none;z-index:9998;transition-property:opacity;'
      document.body.appendChild(this.dialogueFadeOverlay)
    }
    const el = this.dialogueFadeOverlay
    el.style.background = colour
    el.style.display = 'block'
    el.style.visibility = 'visible'
    el.style.transitionDuration = `${halfDuration}s`
    el.style.opacity = '0'
    void el.offsetWidth
    el.style.opacity = '1'

    const safetyMs = (halfDuration * 2 + 0.5) * 1000
    const safetyTimer = setTimeout(() => {
      if (this.dialogueFading) {
        this.forceClearFadeOverlay(`safety-timeout:${label}`)
      }
    }, safetyMs)

    setTimeout(() => {
      onMidFade()
      el.style.opacity = '0'
      setTimeout(() => {
        clearTimeout(safetyTimer)
        this.dialogueFading = false
        el.style.display = 'none'
        el.style.visibility = 'hidden'
        console.log(`📷 Fade end: label=${label}, current=${this.currentMode}, prior=${this.priorMode}, gameplay=${this.gameplayMode}`)
        const pending = this.pendingFadeRequest
        this.pendingFadeRequest = null
        if (pending) {
          this.fadeTransition(pending.halfDuration, pending.onMidFade, pending.label)
        }
      }, halfDuration * 1000)
    }, halfDuration * 1000)
  }

  /**
   * White flash transition — fast flash to white and back.
   * Used for battle enter/exit.
   */
  private flashTransition(
    halfDuration: number,
    onMidFlash: () => void,
    label: string = 'flash-transition',
  ): void {
    this.fadeTransition(halfDuration, onMidFlash, label, '#fff')
  }

  public isInDialogueMode(): boolean {
    return this.currentMode === 'dialogue'
  }

  public isInBattleMode(): boolean {
    return this.currentMode === 'battle'
  }

  public isFading(): boolean {
    return this.dialogueFading || this.pendingFadeRequest !== null
  }

  private forceClearFadeOverlay(reason: string): void {
    if (!this.dialogueFadeOverlay) return
    this.dialogueFadeOverlay.style.transitionDuration = '0s'
    this.dialogueFadeOverlay.style.opacity = '0'
    this.dialogueFadeOverlay.style.display = 'none'
    this.dialogueFadeOverlay.style.visibility = 'hidden'
    this.dialogueFading = false
    this.pendingFadeRequest = null
    console.log(`📷 Fade overlay force-cleared: reason=${reason}, current=${this.currentMode}, gameplay=${this.gameplayMode}`)
  }

  private requestModalRecovery(reason: string): void {
    if (!this.modalRecoveryCallback) return
    requestAnimationFrame(() => {
      this.modalRecoveryCallback?.(`${reason}:raf`)
      setTimeout(() => {
        this.modalRecoveryCallback?.(`${reason}:timeout`)
      }, 150)
    })
  }

  // ============================================================================
  // DISPOSE
  // ============================================================================

  public dispose(): void {
    this.orbitControls.dispose()
    this.container.removeEventListener('mousemove', this.onMouseMove.bind(this))
    document.removeEventListener('pointerlockchange', this.onPointerLockChange.bind(this))
    window.removeEventListener('resize', this.handleResize.bind(this))
  }
}
