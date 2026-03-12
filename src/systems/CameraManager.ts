import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type CameraMode = 'freeview' | 'shoulder' | 'thirdperson' | 'dialogue' | 'battle'
export type ThirdPersonView = 'shoulder' // Only shoulder view remains

export interface CameraConfig {
  fov: number
  near: number
  far: number
  position: THREE.Vector3
  target?: THREE.Vector3
}

export interface PlayerCameraConfig extends CameraConfig {
  height: number // Height above ground
  mouseSensitivity: number
  smoothing: number // Camera movement smoothing
}

export interface ThirdPersonCameraOffset {
  position: THREE.Vector3 // Offset from player position
  lookAtOffset: THREE.Vector3 // Offset for look-at target
  smoothing: number // Camera smoothing factor
  fov: number // Field of view for this perspective
}

// ============================================================================
// CAMERA MANAGER CONFIGURATION
// ============================================================================
export interface CameraManagerConfig {
  // Default states
  defaultMode: CameraMode
  defaultView: ThirdPersonView
  defaultZoom: number
  
  // Free View camera (orbital camera with free movement)
  freeViewCamera: {
    fov: number
    position: THREE.Vector3
    targetHeight: number
  }
  
  // Player controls
  playerControls: {
    enabled: boolean
    sensitivity: number
    smoothing: number
    height: number
  }
  
  // Spotlight
  spotlight: {
    enabled: boolean
    intensity: number
    angle: number // In radians
    penumbra: number
    decay: number
    distance: number
    height: number
    offset: number
  }
  
  // Transitions
  transitionDuration: number
  
  // Shoulder view configuration
  shoulderView: ThirdPersonCameraOffset

  // Third-person camera configuration
  thirdPerson: {
    distance: number       // Distance behind player
    height: number         // Height above player pivot
    lookAtHeight: number   // Height of look-at target above player pivot
    fov: number
    smoothing: number      // Position smoothing (0-1, lower = smoother)
    rotationSmoothing: number // Orbit rotation smoothing
    pitchMin: number       // Min pitch angle (radians, negative = look down)
    pitchMax: number       // Max pitch angle (radians)
    sensitivity: number    // Mouse sensitivity for orbit
    collisionEnabled: boolean
    collisionPadding: number
  }
}

// Default configuration
const DEFAULT_CAMERA_CONFIG: CameraManagerConfig = {
  defaultMode: 'thirdperson',
  defaultView: 'shoulder',
  defaultZoom: 2,
  
  freeViewCamera: {
    fov: 75,
    position: new THREE.Vector3(0.138, 1.716, -1.884),
    targetHeight: 2
  },
  
  playerControls: {
    enabled: true,
    sensitivity: 0.002,
    smoothing: 0.1,
    height: 1.8
  },
  
  spotlight: {
    enabled: true,
    intensity: 3,
    angle: Math.PI / 8, // 22.5 degrees
    penumbra: 0.3,
    decay: 2,
    distance: 80,
    height: 30,
    offset: 5
  },
  
  transitionDuration: 1.0,
  
  shoulderView: {
    position: new THREE.Vector3(1.0, 1.8, -4.0),
    lookAtOffset: new THREE.Vector3(0, 1.2, 2),
    smoothing: 0.15,
    fov: 65
  },

  thirdPerson: {
    distance: 6,
    height: 2.5,
    lookAtHeight: 1.2,
    fov: 60,
    smoothing: 0.08,
    rotationSmoothing: 0.12,
    pitchMin: -Math.PI / 6,   // -30° (look slightly down)
    pitchMax: Math.PI / 3,    // 60° (look up)
    sensitivity: 0.003,
    collisionEnabled: true,
    collisionPadding: 0.3
  }
}

export class CameraManager {
  private scene: THREE.Scene
  private renderer: THREE.WebGLRenderer
  private container: HTMLElement
  private config: CameraManagerConfig
  
  // Cameras
  private freeViewCamera!: THREE.PerspectiveCamera // Free orbital camera
  private shoulderCamera!: THREE.PerspectiveCamera // Shoulder view camera
  private thirdPersonCamera!: THREE.PerspectiveCamera // Third-person action camera
  private currentCamera!: THREE.Camera
  private currentMode: CameraMode
  
  // Shoulder view configuration
  private shoulderViewOffset: ThirdPersonCameraOffset

  // Third-person orbit state
  private tpYaw: number = 0
  private tpPitch: number = 0.3  // Slight downward angle
  private tpCurrentPos: THREE.Vector3 = new THREE.Vector3()
  private tpCurrentLookAt: THREE.Vector3 = new THREE.Vector3()
  private tpInitialised: boolean = false
  
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
  private dialogueCamera!: THREE.PerspectiveCamera
  private battleCamera!: THREE.PerspectiveCamera
  private priorMode: CameraMode = 'thirdperson'
  private dialogueTargetPos: THREE.Vector3 = new THREE.Vector3()
  private dialogueTargetLookAt: THREE.Vector3 = new THREE.Vector3()
  private battleTargetPos: THREE.Vector3 = new THREE.Vector3()
  private battleTargetLookAt: THREE.Vector3 = new THREE.Vector3()
  private dialogueFadeOverlay: HTMLDivElement | null = null
  private dialogueFading: boolean = false
  private pendingFadeRequest: { halfDuration: number; onMidFade: () => void; label: string } | null = null
  private gameplayMode: CameraMode = 'thirdperson'
  private modalRecoveryCallback: ((reason: string) => void) | null = null
  
  // Controls
  private orbitControls!: OrbitControls
  private playerControls!: {
    enabled: boolean
    mouseX: number
    mouseY: number
    pitch: number
    yaw: number
    smoothing: number
    sensitivity: number
  }
  
  // Player camera properties
  private playerPosition: THREE.Vector3 = new THREE.Vector3(0, 5, 0)
  private previousPlayerPosition: THREE.Vector3 = new THREE.Vector3(0, 5, 0)
  private playerHeight: number
  
  // Orbit camera tracking
  private orbitCameraOffset: THREE.Vector3 | null = null
  
  // Camera offset tracking
  private currentCameraOffset: THREE.Vector3 = new THREE.Vector3()
  private targetCameraOffset: THREE.Vector3 = new THREE.Vector3()
  
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
    config: Partial<CameraManagerConfig> = {}
  ) {
    this.scene = scene
    this.renderer = renderer
    this.container = container
    
    // Merge user config with defaults
    this.config = this.mergeConfig(DEFAULT_CAMERA_CONFIG, config)
    
    // Set initial states from config
    this.currentMode = this.config.defaultMode
    this.playerHeight = this.config.playerControls.height
    this.transitionDuration = this.config.transitionDuration
    
    // Initialize shoulder view offset from config
    this.shoulderViewOffset = this.config.shoulderView
    
    // Initialize cameras
    this.initializeCameras()
    this.initializeControls()
    this.initializePlayerSpotlight()
    this.setupEventListeners()
    
    console.log(`📷 CameraManager initialized - Mode: ${this.currentMode}`)
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  private mergeConfig(defaults: CameraManagerConfig, overrides: Partial<CameraManagerConfig>): CameraManagerConfig {
    return {
      ...defaults,
      ...overrides,
      freeViewCamera: { ...defaults.freeViewCamera, ...overrides.freeViewCamera },
      playerControls: { ...defaults.playerControls, ...overrides.playerControls },
      spotlight: { ...defaults.spotlight, ...overrides.spotlight },
      shoulderView: { ...defaults.shoulderView, ...overrides.shoulderView },
      thirdPerson: { ...defaults.thirdPerson, ...overrides.thirdPerson }
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): CameraManagerConfig {
    return { ...this.config }
  }

  /**
   * Update configuration at runtime
   */
  public updateConfig(updates: Partial<CameraManagerConfig>): void {
    this.config = this.mergeConfig(this.config, updates)
    console.log('📷 Camera configuration updated', updates)
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  private initializeCameras(): void {
    const aspect = window.innerWidth / window.innerHeight
    
    // Free View Camera (orbital camera for free observation)
    this.freeViewCamera = new THREE.PerspectiveCamera(
      this.config.freeViewCamera.fov, 
      aspect, 
      0.1, 
      1000
    )
    this.freeViewCamera.position.copy(this.config.freeViewCamera.position)
    this.freeViewCamera.name = 'FreeViewCamera'
    
    // Shoulder Camera (third-person shoulder view)
    this.shoulderCamera = new THREE.PerspectiveCamera(
      this.shoulderViewOffset.fov, 
      aspect, 
      0.1, 
      1000
    )
    this.shoulderCamera.position.copy(this.playerPosition)
    this.shoulderCamera.position.y += this.playerHeight
    this.shoulderCamera.name = 'ShoulderCamera'
    
    // Third-Person Action Camera (orbits around player)
    this.thirdPersonCamera = new THREE.PerspectiveCamera(
      this.config.thirdPerson.fov,
      aspect,
      0.1,
      1000
    )
    this.thirdPersonCamera.position.copy(this.playerPosition)
    this.thirdPersonCamera.position.y += this.config.thirdPerson.height
    this.thirdPersonCamera.position.z -= this.config.thirdPerson.distance
    this.thirdPersonCamera.name = 'ThirdPersonCamera'
    
    // Dialogue Camera (static frontal NPC shot)
    this.dialogueCamera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000)
    this.dialogueCamera.name = 'DialogueCamera'

    // Battle Camera (static player-vs-NPC framing)
    this.battleCamera = new THREE.PerspectiveCamera(42, aspect, 0.1, 1000)
    this.battleCamera.name = 'BattleCamera'

    // Set initial camera based on default mode
    switch (this.currentMode) {
      case 'shoulder': this.currentCamera = this.shoulderCamera; break
      case 'thirdperson': this.currentCamera = this.thirdPersonCamera; break
      case 'dialogue': this.currentCamera = this.dialogueCamera; break
      case 'battle': this.currentCamera = this.battleCamera; break
      default: this.currentCamera = this.freeViewCamera; break
    }
    
    console.log('📷 Cameras initialized: Free View + Shoulder + Third Person + Dialogue')
    console.log(`📷 Current mode: ${this.currentMode}`)
    console.log(`📷 Current camera is: ${this.currentCamera.name}`)
  }

  private initializeControls(): void {
    // Orbit controls for free view camera
    this.orbitControls = new OrbitControls(this.freeViewCamera, this.renderer.domElement)
    this.orbitControls.enableDamping = true
    this.orbitControls.dampingFactor = 0.05
    this.orbitControls.minDistance = 2
    this.orbitControls.maxDistance = 1000
    this.orbitControls.maxPolarAngle = Math.PI * 0.95
    this.orbitControls.minPolarAngle = Math.PI * 0.05
    this.orbitControls.target.set(0, this.config.freeViewCamera.targetHeight, 0)
    this.orbitControls.update()
    
    // Player controls configuration
    this.playerControls = {
      enabled: this.config.playerControls.enabled,
      mouseX: 0,
      mouseY: 0,
      pitch: 0,
      yaw: 0,
      smoothing: this.config.playerControls.smoothing,
      sensitivity: this.config.playerControls.sensitivity
    }
  }

  private setupEventListeners(): void {
    // Mouse movement for shoulder camera
    this.container.addEventListener('mousemove', this.onMouseMove.bind(this))
    
    // Pointer lock for shoulder camera
    this.container.addEventListener('click', () => {
      if (this.currentMode === 'shoulder' || this.currentMode === 'thirdperson') {
        this.container.requestPointerLock().catch(() => {
          // Pointer lock may fail if not user-initiated, that's okay
        })
      }
    })
    
    // Handle pointer lock change
    document.addEventListener('pointerlockchange', this.onPointerLockChange.bind(this))
    
    // Auto-request pointer lock on initial load if in shoulder or thirdperson mode
    if (this.currentMode === 'shoulder' || this.currentMode === 'thirdperson') {
      setTimeout(() => {
        if ((this.currentMode === 'shoulder' || this.currentMode === 'thirdperson') && document.pointerLockElement !== this.container) {
          this.container.requestPointerLock().catch(() => {
            // Pointer lock requires user interaction, so this may fail initially
            // User will need to click once to enable it
          })
        }
      }, 100)
    }
    
    // Window resize
    window.addEventListener('resize', this.handleResize.bind(this))
  }

  /**
   * Initialize player spotlight for dramatic overhead lighting
   */
  private initializePlayerSpotlight(): void {
    if (!this.config.spotlight.enabled) {
      console.log('💡 Player spotlight disabled via config')
      return
    }
    
    // Create spotlight that follows player
    this.playerSpotlight = new THREE.SpotLight(0xffffff, this.config.spotlight.intensity)
    this.playerSpotlight.position.set(0, 40, -20)
    this.playerSpotlight.angle = this.config.spotlight.angle
    this.playerSpotlight.penumbra = this.config.spotlight.penumbra
    this.playerSpotlight.decay = this.config.spotlight.decay
    this.playerSpotlight.distance = this.config.spotlight.distance
    
    // Enable shadows for dramatic effect
    this.playerSpotlight.castShadow = true
    this.playerSpotlight.shadow.mapSize.width = 2048
    this.playerSpotlight.shadow.mapSize.height = 2048
    this.playerSpotlight.shadow.camera.near = 10
    this.playerSpotlight.shadow.camera.far = 100
    
    // Add to scene
    this.scene.add(this.playerSpotlight)
    this.scene.add(this.playerSpotlight.target)
    
    // Always visible
    this.playerSpotlight.visible = true
    
    const angleDegrees = (this.config.spotlight.angle * 180 / Math.PI).toFixed(1)
    console.log(`💡 Player spotlight initialized - Intensity: ${this.config.spotlight.intensity}, Angle: ${angleDegrees}°, Distance: ${this.config.spotlight.distance}`)
  }

  // ============================================================================
  // CAMERA SWITCHING
  // ============================================================================

  /**
   * Switch between camera modes with smooth transition
   */
  public switchCamera(mode: CameraMode, immediate: boolean = false): void {
    if (this.currentMode === mode || this.isTransitioning) {
      return
    }

    // console.log(`📷 Switching camera mode: ${this.currentMode} → ${mode}`)

    const fromCamera = this.currentCamera
    const toCameraMap: Record<CameraMode, THREE.PerspectiveCamera> = {
      freeview: this.freeViewCamera,
      shoulder: this.shoulderCamera,
      thirdperson: this.thirdPersonCamera,
      dialogue: this.dialogueCamera,
      battle: this.battleCamera
    }
    const toCamera = toCameraMap[mode]

    if (immediate) {
      this.setActiveCamera(mode, true)
    } else {
      this.startCameraTransition(fromCamera, toCamera, mode)
    }
  }

  /**
   * Start smooth camera transition
   */
  private startCameraTransition(from: THREE.Camera, to: THREE.Camera, targetMode: CameraMode): void {
    this.isTransitioning = true
    this.transitionStart = performance.now()
    
    // Store transition start and end states
    this.transitionFromPosition.copy(from.position)
    this.transitionFromRotation.copy(from.rotation)
    this.transitionToPosition.copy(to.position)
    this.transitionToRotation.copy(to.rotation)
    
    // Update target mode
    this.currentMode = targetMode
  }

  /**
   * Set active camera immediately
   */
  private setActiveCamera(mode: CameraMode, requestPointerLock: boolean = false): void {
    this.currentMode = mode
    if (mode !== 'dialogue' && mode !== 'battle') {
      this.gameplayMode = mode
    }
    const cameraMap: Record<CameraMode, THREE.PerspectiveCamera> = {
      freeview: this.freeViewCamera,
      shoulder: this.shoulderCamera,
      thirdperson: this.thirdPersonCamera,
      dialogue: this.dialogueCamera,
      battle: this.battleCamera
    }
    this.currentCamera = cameraMap[mode]
    
    // Enable/disable appropriate controls
    this.orbitControls.enabled = (mode === 'freeview')
    this.playerControls.enabled = (mode === 'shoulder')
    // thirdperson uses its own orbit state (tpYaw/tpPitch) via mouse events
    
    // Handle pointer lock for shoulder/thirdperson modes when explicitly requested
    if ((mode === 'shoulder' || mode === 'thirdperson') && requestPointerLock) {
      if (document.pointerLockElement !== this.container) {
        this.container.requestPointerLock().catch((error) => {
        })
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
    
    // console.log(`📷 Active camera: ${this.currentCamera.name}`)
  }

  private getResumeMode(): CameraMode {
    if (this.priorMode === 'dialogue' || this.priorMode === 'battle') {
      return this.gameplayMode
    }
    return this.priorMode
  }

  private shouldPlayerMeshBeVisible(mode: CameraMode = this.currentMode): boolean {
    return mode !== 'dialogue' && this.playerMeshHiddenReasons.size === 0
  }

  private applyPlayerMeshVisibility(mode: CameraMode = this.currentMode): void {
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
  // PLAYER CAMERA CONTROLS
  // ============================================================================

  private onMouseMove(event: MouseEvent): void {
    // Third-person mode handles its own mouse input
    if (this.currentMode === 'thirdperson') {
      this.onMouseMoveThirdPerson(event)
      return
    }

    // Only process mouse movement if player controls are enabled (shoulder mode)
    if (!this.playerControls.enabled) {
      return
    }
    
    // For trackpad/mouse input, we can work without pointer lock
    // Pointer lock is preferred but not required for basic mouse movement
    // Check if we have movementX/Y (pointer lock) or calculate from clientX/Y (normal mouse)
    let movementX = 0
    let movementY = 0
    
    if (document.pointerLockElement === this.container) {
      // Pointer lock mode - use movementX/Y directly
      movementX = event.movementX || 0
      movementY = event.movementY || 0
    } else {
      // Normal mouse mode - calculate movement from position change
      // This allows trackpad to work without pointer lock
      const rect = this.container.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      
      // Only process if mouse is over the container
      if (event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom) {
        // Calculate movement relative to center (normalized)
        movementX = (event.clientX - centerX) * 0.1
        movementY = (event.clientY - centerY) * 0.1
        
        // Reset to center for next frame (this is a workaround for non-pointer-lock mode)
        // In practice, we'll use the delta from the last position
        if (this.lastMouseX === null || this.lastMouseY === null) {
          this.lastMouseX = event.clientX
          this.lastMouseY = event.clientY
          return // Skip first frame
        }
        
        movementX = (event.clientX - this.lastMouseX) * this.playerControls.sensitivity * 100
        movementY = (event.clientY - this.lastMouseY) * this.playerControls.sensitivity * 100
        
        this.lastMouseX = event.clientX
        this.lastMouseY = event.clientY
      } else {
        return // Mouse not over container
      }
    }

    this.playerControls.yaw -= movementX * this.playerControls.sensitivity
    this.playerControls.pitch -= movementY * this.playerControls.sensitivity  // Standard: Mouse UP = Look UP

    // Clamp pitch to prevent over-rotation
    this.playerControls.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.playerControls.pitch))
  }

  private onPointerLockChange(): void {
    const isLocked = document.pointerLockElement === this.container
    // console.log(`📷 Pointer lock: ${isLocked ? 'enabled' : 'disabled'}`)
  }

  // ============================================================================
  // THIRD-PERSON CAMERA
  // ============================================================================

  /**
   * Handle mouse movement for third-person orbit camera
   */
  private onMouseMoveThirdPerson(event: MouseEvent): void {
    let movementX = 0
    let movementY = 0

    if (document.pointerLockElement === this.container) {
      movementX = event.movementX || 0
      movementY = event.movementY || 0
    } else {
      // Fallback for non-pointer-lock (trackpad)
      if (this.lastMouseX === null || this.lastMouseY === null) {
        this.lastMouseX = event.clientX
        this.lastMouseY = event.clientY
        return
      }
      movementX = (event.clientX - this.lastMouseX)
      movementY = (event.clientY - this.lastMouseY)
      this.lastMouseX = event.clientX
      this.lastMouseY = event.clientY
    }

    const sens = this.config.thirdPerson.sensitivity
    this.tpYaw -= movementX * sens
    this.tpPitch += movementY * sens  // inverted: mouse up = pitch up = camera goes lower behind

    // Clamp pitch
    this.tpPitch = Math.max(this.config.thirdPerson.pitchMin, Math.min(this.config.thirdPerson.pitchMax, this.tpPitch))
  }

  /**
   * Update third-person camera — orbits around player at configured distance
   */
  private updateThirdPersonCamera(deltaTime: number): void {
    const cfg = this.config.thirdPerson

    // Desired camera position in spherical coordinates around the player
    const desiredPos = new THREE.Vector3()
    desiredPos.x = Math.sin(this.tpYaw) * Math.cos(this.tpPitch) * cfg.distance
    desiredPos.y = Math.sin(this.tpPitch) * cfg.distance + cfg.height
    desiredPos.z = Math.cos(this.tpYaw) * Math.cos(this.tpPitch) * cfg.distance
    desiredPos.add(this.playerPosition)

    // Desired look-at target
    const desiredLookAt = this.playerPosition.clone()
    desiredLookAt.y += cfg.lookAtHeight

    // Camera collision: raycast from look-at target toward desired position
    if (cfg.collisionEnabled) {
      // Floor clamp — never go below player feet + padding
      const groundY = this.playerPosition.y + cfg.collisionPadding
      if (desiredPos.y < groundY) {
        desiredPos.y = groundY
      }

      // Raycast from look-at target toward desired camera position
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
            // Pull camera forward to the first hit minus a small safety padding
            const safeDist = Math.max(hits[0].distance - cfg.collisionPadding, 0.5)
            desiredPos.copy(origin).addScaledVector(direction, safeDist)
          }
        }
      }
    }

    // Smooth interpolation
    if (!this.tpInitialised) {
      this.tpCurrentPos.copy(desiredPos)
      this.tpCurrentLookAt.copy(desiredLookAt)
      this.tpInitialised = true
    } else {
      this.tpCurrentPos.lerp(desiredPos, cfg.smoothing)
      this.tpCurrentLookAt.lerp(desiredLookAt, cfg.rotationSmoothing)
    }

    // Apply to camera
    this.thirdPersonCamera.position.copy(this.tpCurrentPos)
    this.thirdPersonCamera.lookAt(this.tpCurrentLookAt)

    // Update FOV if changed
    if (this.thirdPersonCamera.fov !== cfg.fov) {
      this.thirdPersonCamera.fov = cfg.fov
      this.thirdPersonCamera.updateProjectionMatrix()
    }

    this.applyPlayerMeshVisibility('thirdperson')
  }

  // ============================================================================
  // UPDATE METHODS
  // ============================================================================

  /**
   * Update camera system (call this in animation loop)
   */
  public update(deltaTime: number): void {
    // Handle camera transition
    if (this.isTransitioning) {
      this.updateCameraTransition()
    }
    
    // Update player spotlight (always, in all modes)
    this.updatePlayerSpotlight()
    
    // Update active camera based on mode
    if (this.currentMode === 'freeview') {
      // Initialize offset on first frame using config position
      if (!this.orbitCameraOffset) {
        this.orbitCameraOffset = new THREE.Vector3()
        // Use the configured initial position relative to player
        this.orbitCameraOffset.copy(this.config.freeViewCamera.position)
        // Position camera at the configured offset from player
        this.freeViewCamera.position.copy(this.playerPosition).add(this.orbitCameraOffset)
        this.previousPlayerPosition.copy(this.playerPosition)
      }
      
      // Calculate player movement delta
      const playerDelta = new THREE.Vector3().subVectors(this.playerPosition, this.previousPlayerPosition)
      
      // Move camera and orbit target by player movement delta (keeps camera following player)
      this.freeViewCamera.position.add(playerDelta)
      this.orbitControls.target.add(playerDelta)
      
      // Update orbit controls (applies mouse and gamepad rotations with smooth damping)
      this.orbitControls.update()
      
      // Update offset after orbit controls modify position
      this.orbitCameraOffset.copy(this.freeViewCamera.position).sub(this.playerPosition)
      
      // Store current player position for next frame
      this.previousPlayerPosition.copy(this.playerPosition)
    } else if (this.currentMode === 'shoulder') {
      this.updateShoulderCamera(deltaTime)
    } else if (this.currentMode === 'thirdperson') {
      this.updateThirdPersonCamera(deltaTime)
    } else if (this.currentMode === 'dialogue') {
      // Static camera — position was set during enterDialogueMode, nothing to update.
      // Player mesh stays hidden during dialogue.
    } else if (this.currentMode === 'battle') {
      // Static camera — position was set during enterBattleMode, nothing to update.
    }
  }

  /**
   * Update camera transition animation
   */
  private updateCameraTransition(): void {
    const elapsed = (performance.now() - this.transitionStart) / 1000
    const progress = Math.min(elapsed / this.transitionDuration, 1)
    
    // Smooth easing function
    const easedProgress = 1 - Math.pow(1 - progress, 3)
    
    // Interpolate position and rotation
    this.currentCamera.position.lerpVectors(this.transitionFromPosition, this.transitionToPosition, easedProgress)
    
    // Interpolate rotation using quaternions for smooth rotation
    const fromQuaternion = new THREE.Quaternion().setFromEuler(this.transitionFromRotation)
    const toQuaternion = new THREE.Quaternion().setFromEuler(this.transitionToRotation)
    const currentQuaternion = new THREE.Quaternion().slerpQuaternions(fromQuaternion, toQuaternion, easedProgress)
    this.currentCamera.setRotationFromQuaternion(currentQuaternion)
    
    // Complete transition
    if (progress >= 1) {
      this.isTransitioning = false
      this.setActiveCamera(this.currentMode, false) // Don't auto-request pointer lock during transition
    }
  }

  /**
   * Update shoulder camera based on mouse input
   */
  private updateShoulderCamera(deltaTime: number): void {
    if (!this.playerControls.enabled) return
    
    // Use shoulder view offset configuration
    const offsetConfig = this.shoulderViewOffset
    
    // Calculate target camera offset in world space
    const playerRotation = this.playerControls.yaw
    const rotationMatrix = new THREE.Matrix4().makeRotationY(playerRotation)
    
    // Shoulder view uses rotation
    this.targetCameraOffset.copy(offsetConfig.position)
    this.targetCameraOffset.applyMatrix4(rotationMatrix)
    
    // Smooth camera offset transition
    this.currentCameraOffset.lerp(this.targetCameraOffset, offsetConfig.smoothing)
    
    // Set camera position
    this.shoulderCamera.position.copy(this.playerPosition)
    this.shoulderCamera.position.add(this.currentCameraOffset)
    
    // Calculate look-at target
    const lookAtTarget = new THREE.Vector3()
    lookAtTarget.copy(offsetConfig.lookAtOffset)
    lookAtTarget.applyMatrix4(rotationMatrix)
    lookAtTarget.add(this.playerPosition)
    
    // Make camera look at target
    this.shoulderCamera.lookAt(lookAtTarget)
    
    // Update FOV
    if (this.shoulderCamera.fov !== offsetConfig.fov) {
      this.shoulderCamera.fov = offsetConfig.fov
      this.shoulderCamera.updateProjectionMatrix()
    }
    
    this.applyPlayerMeshVisibility('shoulder')
  }

  /**
   * Update player spotlight position and targeting
   */
  private updatePlayerSpotlight(): void {
    if (!this.playerSpotlight) return

    // Spotlight follows player, but intensity/visibility are controlled by day-night cycle.
    const effectiveIntensity = this.config.spotlight.intensity * this.spotlightNightFactor
    this.playerSpotlight.intensity = effectiveIntensity
    this.playerSpotlight.visible = effectiveIntensity > 0.01
    
    // Always update position to follow player
    const spotlightHeight = this.config.spotlight.height
    const cameraOffset = this.config.spotlight.offset
    
    // Position spotlight above player
    this.playerSpotlight.position.set(
      this.playerPosition.x,
      this.playerPosition.y + spotlightHeight,
      this.playerPosition.z - cameraOffset
    )
    
    // Point spotlight at player
    this.playerSpotlight.target.position.copy(this.playerPosition)
    this.playerSpotlight.target.position.y += 0.5
    this.playerSpotlight.target.updateMatrixWorld()
    
    // Always update land system with spotlight data
    if (this.landSystem) {
      this.landSystem.setSpotlightPosition(this.playerSpotlight.position)
      
      // Calculate direction vector from spotlight to target
      const direction = new THREE.Vector3()
      direction.subVectors(this.playerSpotlight.target.position, this.playerSpotlight.position).normalize()
      this.landSystem.setSpotlightDirection(direction)
      
      this.landSystem.setSpotlightColor(this.playerSpotlight.color)
      this.landSystem.setSpotlightIntensity(effectiveIntensity)
    }
  }

  /**
   * Set day/night blend for the player spotlight.
   * 0 = fully off (day), 1 = full configured intensity (night).
   */
  public setPlayerSpotlightNightFactor(factor: number): void {
    this.spotlightNightFactor = THREE.MathUtils.clamp(factor, 0, 1)
  }

  // ============================================================================
  // PLAYER POSITION MANAGEMENT
  // ============================================================================

  /**
   * Set player position (affects shoulder camera)
   */
  public setPlayerPosition(position: THREE.Vector3): void {
    this.playerPosition.copy(position)
    if (this.currentMode === 'shoulder') {
      this.shoulderCamera.position.copy(position)
      this.shoulderCamera.position.y += this.playerHeight
    }
  }

  /**
   * Get player position
   */
  public getPlayerPosition(): THREE.Vector3 {
    return this.playerPosition.clone()
  }

  /**
   * Set player height above ground
   */
  public setPlayerHeight(height: number): void {
    this.playerHeight = height
  }

  // ============================================================================
  // GETTERS AND SETTERS
  // ============================================================================

  /**
   * Get current active camera
   */
  public getCamera(): THREE.Camera {
    return this.currentCamera
  }

  public setModalRecoveryCallback(callback: ((reason: string) => void) | null): void {
    this.modalRecoveryCallback = callback
  }

  /**
   * Get current camera mode
   */
  public getCurrentMode(): CameraMode {
    return this.currentMode
  }

  public refreshViewport(width: number, height: number): void {
    const safeWidth = Math.max(width, 1)
    const safeHeight = Math.max(height, 1)
    const aspect = safeWidth / safeHeight

    this.freeViewCamera.aspect = aspect
    this.freeViewCamera.updateProjectionMatrix()

    this.shoulderCamera.aspect = aspect
    this.shoulderCamera.updateProjectionMatrix()

    this.thirdPersonCamera.aspect = aspect
    this.thirdPersonCamera.updateProjectionMatrix()

    this.dialogueCamera.aspect = aspect
    this.dialogueCamera.updateProjectionMatrix()

    this.battleCamera.aspect = aspect
    this.battleCamera.updateProjectionMatrix()
  }

  /**
   * Register player mesh for visibility control
   */
  public registerPlayerMesh(mesh: THREE.Object3D): void {
    this.playerMesh = mesh
    this.applyPlayerMeshVisibility()
  }

  /**
   * Get free view camera
   */
  public getFreeViewCamera(): THREE.PerspectiveCamera {
    return this.freeViewCamera
  }

  /**
   * Get shoulder camera
   */
  public getShoulderCamera(): THREE.PerspectiveCamera {
    return this.shoulderCamera
  }

  /**
   * Get third-person camera
   */
  public getThirdPersonCamera(): THREE.PerspectiveCamera {
    return this.thirdPersonCamera
  }

  /**
   * Get third-person camera yaw (useful for player movement relative to camera)
   */
  public getThirdPersonYaw(): number {
    return this.tpYaw
  }

  /**
   * Get orbit controls (for free view camera)
   */
  public getOrbitControls(): OrbitControls {
    return this.orbitControls
  }

  /**
   * Get the player spotlight (may be null if disabled)
   */
  public getPlayerSpotlight(): THREE.SpotLight | null {
    return this.playerSpotlight
  }

  /**
   * Get player controls (for reading camera rotation)
   */
  public getPlayerControls() {
    return this.playerControls
  }

  /**
   * Set player camera sensitivity
   */
  public setPlayerSensitivity(sensitivity: number): void {
    this.playerControls.sensitivity = sensitivity
  }

  /**
   * Update camera rotation from gamepad input (works for both shoulder and freeview/orbital modes)
   * @param deltaX - Right stick horizontal movement (-1 to 1)
   * @param deltaY - Right stick vertical movement (-1 to 1)
   * @param deltaTime - Time since last frame in seconds
   */
  public updatePlayerCameraFromGamepad(deltaX: number, deltaY: number, deltaTime: number): void {
    if (this.currentMode === 'shoulder') {
      // Shoulder mode: direct camera control
      if (!this.playerControls.enabled) {
        return
      }

      // Apply gamepad sensitivity (higher than mouse for responsiveness)
      const gamepadSensitivity = this.playerControls.sensitivity * 100 // Scale up for gamepad
      
      this.playerControls.yaw -= deltaX * gamepadSensitivity * deltaTime * 60 // Scale by deltaTime and fps
      this.playerControls.pitch += deltaY * gamepadSensitivity * deltaTime * 60  // INVERTED: Changed -= to +=

      // Clamp pitch to prevent over-rotation
      this.playerControls.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.playerControls.pitch))
    } else if (this.currentMode === 'freeview') {
      // Free View mode: manually rotate camera using spherical coordinates
      // This gives smooth rotation similar to OrbitControls mouse dragging
      const rotateSpeed = 0.08 // Gamepad rotation speed
      
      // Get current camera position relative to target
      const offset = new THREE.Vector3()
      offset.copy(this.freeViewCamera.position).sub(this.orbitControls.target)
      
      // Convert to spherical coordinates
      const spherical = new THREE.Spherical()
      spherical.setFromVector3(offset)
      
      // Apply rotation deltas (with damping from OrbitControls)
      spherical.theta -= deltaX * rotateSpeed * deltaTime * 60
      spherical.phi -= deltaY * rotateSpeed * deltaTime * 60
      
      // Clamp phi to prevent gimbal lock (same limits as OrbitControls)
      spherical.phi = Math.max(
        this.orbitControls.minPolarAngle,
        Math.min(this.orbitControls.maxPolarAngle, spherical.phi)
      )
      
      // Convert back to Cartesian and update camera position
      offset.setFromSpherical(spherical)
      this.freeViewCamera.position.copy(this.orbitControls.target).add(offset)
      this.freeViewCamera.lookAt(this.orbitControls.target)
      
      // Update orbit camera offset
      if (this.orbitCameraOffset) {
        this.orbitCameraOffset.copy(offset)
      }
    } else if (this.currentMode === 'thirdperson') {
      // Third-person mode: orbit around player
      const gamepadSensitivity = this.config.thirdPerson.sensitivity * 100
      this.tpYaw -= deltaX * gamepadSensitivity * deltaTime * 60
      this.tpPitch += deltaY * gamepadSensitivity * deltaTime * 60
      this.tpPitch = Math.max(this.config.thirdPerson.pitchMin, Math.min(this.config.thirdPerson.pitchMax, this.tpPitch))
    }
  }

  /**
   * Set transition duration
   */
  public setTransitionDuration(duration: number): void {
    this.transitionDuration = duration
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Handle window resize
   */
  private handleResize = (): void => {
    const width = Math.max(window.innerWidth, 1)
    const height = Math.max(window.innerHeight, 1)
    const aspect = width / height
    
    this.freeViewCamera.aspect = aspect
    this.freeViewCamera.updateProjectionMatrix()
    
    this.shoulderCamera.aspect = aspect
    this.shoulderCamera.updateProjectionMatrix()

    this.thirdPersonCamera.aspect = aspect
    this.thirdPersonCamera.updateProjectionMatrix()

    this.dialogueCamera.aspect = aspect
    this.dialogueCamera.updateProjectionMatrix()

    this.battleCamera.aspect = aspect
    this.battleCamera.updateProjectionMatrix()
  }

  /**
   * Get camera info for debugging
   */
  public getCameraInfo(): object {
    return {
      currentMode: this.currentMode,
      isTransitioning: this.isTransitioning,
      freeViewCamera: {
        position: this.freeViewCamera.position.toArray(),
        rotation: this.freeViewCamera.rotation.toArray()
      },
      shoulderCamera: {
        position: this.shoulderCamera.position.toArray(),
        rotation: this.shoulderCamera.rotation.toArray()
      },
      thirdPersonCamera: {
        position: this.thirdPersonCamera.position.toArray(),
        rotation: this.thirdPersonCamera.rotation.toArray(),
        yaw: this.tpYaw,
        pitch: this.tpPitch
      },
      playerControls: {
        enabled: this.playerControls.enabled,
        pitch: this.playerControls.pitch,
        yaw: this.playerControls.yaw,
        sensitivity: this.playerControls.sensitivity
      }
    }
  }

  /**
   * Register meshes that the third-person camera should collide with
   * (terrain, buildings, etc.).  Meshes are tested recursively.
   */
  public setCollisionMeshes(meshes: THREE.Object3D[]): void {
    this.collisionMeshes = meshes
    console.log(`📷 Camera collision meshes updated (${meshes.length} root objects)`)
  }

  /**
   * Append additional meshes to the existing camera collision list.
   */
  public addCollisionMeshes(meshes: THREE.Object3D[]): void {
    this.collisionMeshes.push(...meshes)
    console.log(`📷 Camera collision meshes appended (+${meshes.length}, total ${this.collisionMeshes.length})`)
  }

  /**
   * Set land system reference for spotlight updates
   */
  public setLandSystem(landSystem: any): void {
    this.landSystem = landSystem
    console.log('📷 Land system linked to CameraManager for spotlight updates')
  }

  // ============================================================================
  // DIALOGUE CAMERA
  // ============================================================================

  /**
   * Enter dialogue camera mode.
   * Positions the camera for a frontal shot of the given NPC.
   * @param npcPosition  World position of the NPC.
   * @param npcRotation  Y-axis rotation of the NPC (radians).
   */
  public enterDialogueMode(npcPosition: THREE.Vector3, npcRotation: number): void {
    this.priorMode = this.currentMode === 'dialogue' || this.currentMode === 'battle'
      ? this.gameplayMode
      : this.currentMode
    console.log(`📷 Dialogue enter requested: current=${this.currentMode}, prior=${this.priorMode}, gameplay=${this.gameplayMode}`)

    // NPC forward direction (the way the NPC faces)
    const npcForward = new THREE.Vector3(Math.sin(npcRotation), 0, Math.cos(npcRotation))

    // Camera: directly in front of the NPC, centered for a full-body frontal shot
    const bodyCenter = 0.9   // mid-height of ~1.8m character
    const frontDist = 3.5    // far enough to see the full body

    this.dialogueTargetPos.copy(npcPosition)
      .addScaledVector(npcForward, frontDist)
    this.dialogueTargetPos.y = npcPosition.y + bodyCenter

    // Look-at target: NPC body center
    this.dialogueTargetLookAt.copy(npcPosition)
    this.dialogueTargetLookAt.y += bodyCenter

    // Fade transition overlay — snap camera at mid-fade
    this.fadeTransition(0.3, () => {
      this.setPlayerMeshRenderSuppressed('dialogue', true)
      this.dialogueCamera.position.copy(this.dialogueTargetPos)
      this.dialogueCamera.lookAt(this.dialogueTargetLookAt)
      this.switchCamera('dialogue', true)
      console.log(`📷 Dialogue camera activated: prior=${this.priorMode}, current=${this.currentMode}`)
    }, 'enter-dialogue')
  }

  /**
   * Exit dialogue camera mode — return to whichever mode was active before.
   */
  public exitDialogueMode(): void {
    if (this.currentMode !== 'dialogue') return
    const resumeMode = this.getResumeMode()
    console.log(`📷 Dialogue exit requested: current=${this.currentMode}, prior=${this.priorMode}, resume=${resumeMode}`)
    this.fadeTransition(0.3, () => {
      this.setPlayerMeshRenderSuppressed('dialogue', false)
      this.switchCamera(resumeMode, true)
      this.requestModalRecovery('exit-dialogue')
      console.log(`📷 Dialogue camera exited: resumed=${resumeMode}, current=${this.currentMode}`)
    }, 'exit-dialogue')
  }

  /**
   * Enter battle camera mode — frame player and NPC together while keeping the player visible.
   */
  public enterBattleMode(playerPosition: THREE.Vector3, npcPosition: THREE.Vector3): void {
    this.priorMode = this.currentMode === 'dialogue' || this.currentMode === 'battle'
      ? this.gameplayMode
      : this.currentMode
    console.log(`📷 Battle enter requested: current=${this.currentMode}, prior=${this.priorMode}, gameplay=${this.gameplayMode}`)

    const playerToNpc = npcPosition.clone().sub(playerPosition)
    playerToNpc.y = 0

    let npcDistance = playerToNpc.length()
    if (npcDistance < 0.0001) {
      playerToNpc.set(0, 0, 1)
      npcDistance = 1
    } else {
      playerToNpc.normalize()
    }

    const side = new THREE.Vector3(-playerToNpc.z, 0, playerToNpc.x)
    const sideSign = side.x >= 0 ? 1 : -1

    // Keep the world positions unchanged, but push the player into stronger foreground
    // and the NPC deeper into frame so the shot reads with more depth.
    const backOffset = THREE.MathUtils.clamp(npcDistance * 0.42, 3.6, 5.6)
    const sideOffset = THREE.MathUtils.clamp(npcDistance * 0.4, 3.1, 5.0) * sideSign
    const verticalOffset = THREE.MathUtils.clamp(1.45 + npcDistance * 0.05, 1.6, 2.3)
    const targetPullback = THREE.MathUtils.clamp(npcDistance * 0.1, 0.15, 0.45)
    const targetSideBias = THREE.MathUtils.clamp(npcDistance * 0.16, 0.45, 1.1) * -sideSign
    const playerForegroundBias = THREE.MathUtils.clamp(npcDistance * 0.14, 0.4, 0.95)

    this.battleTargetPos.copy(playerPosition)
      .addScaledVector(playerToNpc, -backOffset)
      .addScaledVector(side, sideOffset)
    this.battleTargetPos.y = playerPosition.y + verticalOffset

    this.battleTargetLookAt.copy(npcPosition)
      .addScaledVector(playerToNpc, -targetPullback)
      .addScaledVector(side, targetSideBias)
    this.battleTargetLookAt.y = npcPosition.y + 1.35
    this.battleTargetLookAt.addScaledVector(
      playerPosition.clone().sub(npcPosition).normalize(),
      -playerForegroundBias,
    )

    this.fadeTransition(0.3, () => {
      // A slightly wider lens exaggerates foreground/background separation.
      if (this.battleCamera.fov !== 46) {
        this.battleCamera.fov = 46
        this.battleCamera.updateProjectionMatrix()
      }
      this.battleCamera.position.copy(this.battleTargetPos)
      this.battleCamera.lookAt(this.battleTargetLookAt)
      this.switchCamera('battle', true)
      console.log(
        `📷 Battle camera activated: prior=${this.priorMode}, current=${this.currentMode}, ` +
        `pos=(${this.battleTargetPos.x.toFixed(2)}, ${this.battleTargetPos.y.toFixed(2)}, ${this.battleTargetPos.z.toFixed(2)}), ` +
        `lookAt=(${this.battleTargetLookAt.x.toFixed(2)}, ${this.battleTargetLookAt.y.toFixed(2)}, ${this.battleTargetLookAt.z.toFixed(2)})`
      )
    }, 'enter-battle')
  }

  /**
   * Exit battle camera mode.
   */
  public exitBattleMode(): void {
    if (this.currentMode !== 'battle') return
    const resumeMode = this.getResumeMode()
    console.log(`📷 Battle exit requested: current=${this.currentMode}, prior=${this.priorMode}, resume=${resumeMode}`)
    this.fadeTransition(0.3, () => {
      this.switchCamera(resumeMode, true)
      this.requestModalRecovery('exit-battle')
      console.log(`📷 Battle camera exited: resumed=${resumeMode}, current=${this.currentMode}`)
    }, 'exit-battle')
  }

  /**
   * Quick full-screen fade to black and back, calling `onMidFade` at the peak.
   */
  private fadeTransition(halfDuration: number, onMidFade: () => void, label: string = 'modal-transition'): void {
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
        'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:9998;transition-property:opacity;'
      document.body.appendChild(this.dialogueFadeOverlay)
    }
    const el = this.dialogueFadeOverlay
    el.style.display = 'block'
    el.style.visibility = 'visible'
    el.style.transitionDuration = `${halfDuration}s`
    el.style.opacity = '0'
    // Force reflow then fade to black
    void el.offsetWidth
    el.style.opacity = '1'

    // Safety timeout: force-clear the overlay if something goes wrong (mobile timer throttling, etc.)
    const safetyMs = (halfDuration * 2 + 0.5) * 1000
    const safetyTimer = setTimeout(() => {
      if (this.dialogueFading) {
        this.forceClearFadeOverlay(`safety-timeout:${label}`)
      }
    }, safetyMs)

    setTimeout(() => {
      onMidFade()
      // Fade back
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
   * Whether the camera is currently in dialogue mode.
   */
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

  /**
   * Dispose of camera manager resources
   */
  public dispose(): void {
    this.orbitControls.dispose()
    
    // Remove event listeners
    this.container.removeEventListener('mousemove', this.onMouseMove.bind(this))
    document.removeEventListener('pointerlockchange', this.onPointerLockChange.bind(this))
    window.removeEventListener('resize', this.handleResize.bind(this))
    
    // console.log('📷 CameraManager disposed')
  }
} 