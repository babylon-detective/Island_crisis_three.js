import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type CameraMode = 'system' | 'player'
export type ThirdPersonView = 'shoulder' | 'overhead'

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
  
  // System camera
  systemCamera: {
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
  
  // Orthographic camera
  orthographicCamera: {
    frustumSize: number
    height: number
    zoom: number
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
  
  // Third person view configurations
  thirdPersonViews: {
    overhead: ThirdPersonCameraOffset
    shoulder: ThirdPersonCameraOffset
  }
}

// Default configuration
const DEFAULT_CAMERA_CONFIG: CameraManagerConfig = {
  defaultMode: 'player',
  defaultView: 'overhead',
  defaultZoom: 2,
  
  systemCamera: {
    fov: 75,
    position: new THREE.Vector3(0, 2, 10),
    targetHeight: 2
  },
  
  playerControls: {
    enabled: true,
    sensitivity: 0.002,
    smoothing: 0.1,
    height: 1.8
  },
  
  orthographicCamera: {
    frustumSize: 50,
    height: 50,
    zoom: 10
  },
  
  spotlight: {
    enabled: true,
    intensity: 6,
    angle: Math.PI / 8, // 22.5 degrees
    penumbra: 0.3,
    decay: 2,
    distance: 80,
    height: 30,
    offset: 5
  },
  
  transitionDuration: 1.0,
  
  thirdPersonViews: {
    overhead: {
      position: new THREE.Vector3(20, 50, 1),
      lookAtOffset: new THREE.Vector3(0, 0, 0),
      smoothing: 0.1,
      fov: 60
    },
    shoulder: {
      position: new THREE.Vector3(1.2, 1.5, -3.5),
      lookAtOffset: new THREE.Vector3(0, 1.0, 2),
      smoothing: 0.15,
      fov: 70
    }
  }
}

export class CameraManager {
  private scene: THREE.Scene
  private renderer: THREE.WebGLRenderer
  private container: HTMLElement
  private config: CameraManagerConfig
  
  // Cameras
  private systemCamera!: THREE.PerspectiveCamera
  private playerCamera!: THREE.PerspectiveCamera
  private orthographicCamera!: THREE.OrthographicCamera
  private currentCamera!: THREE.Camera
  private currentMode: CameraMode
  
  // Third person view mode
  private currentThirdPersonView: ThirdPersonView
  private thirdPersonOffsets: Map<ThirdPersonView, ThirdPersonCameraOffset> = new Map()
  
  // Player spotlight
  private playerSpotlight: THREE.SpotLight | null = null
  
  // Land system reference
  private landSystem: any = null
  
  // Player visual representation
  private playerMesh: THREE.Object3D | null = null
  
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
  private playerHeight: number
  
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
    this.currentThirdPersonView = this.config.defaultView
    this.playerHeight = this.config.playerControls.height
    this.transitionDuration = this.config.transitionDuration
    
    // Initialize third person camera offsets from config
    this.thirdPersonOffsets = new Map([
      ['overhead', this.config.thirdPersonViews.overhead],
      ['shoulder', this.config.thirdPersonViews.shoulder]
    ])
    
    // Initialize cameras
    this.initializeCameras()
    this.initializeControls()
    this.initializePlayerSpotlight()
    this.setupEventListeners()
    
    console.log(`📷 CameraManager initialized - Mode: ${this.currentMode}, View: ${this.currentThirdPersonView}`)
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  private mergeConfig(defaults: CameraManagerConfig, overrides: Partial<CameraManagerConfig>): CameraManagerConfig {
    return {
      ...defaults,
      ...overrides,
      systemCamera: { ...defaults.systemCamera, ...overrides.systemCamera },
      playerControls: { ...defaults.playerControls, ...overrides.playerControls },
      orthographicCamera: { ...defaults.orthographicCamera, ...overrides.orthographicCamera },
      spotlight: { ...defaults.spotlight, ...overrides.spotlight },
      thirdPersonViews: {
        overhead: { ...defaults.thirdPersonViews.overhead, ...overrides.thirdPersonViews?.overhead },
        shoulder: { ...defaults.thirdPersonViews.shoulder, ...overrides.thirdPersonViews?.shoulder }
      }
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
    
    // System Camera (for debugging and free observation)
    this.systemCamera = new THREE.PerspectiveCamera(
      this.config.systemCamera.fov, 
      aspect, 
      0.1, 
      1000
    )
    this.systemCamera.position.copy(this.config.systemCamera.position)
    this.systemCamera.name = 'SystemCamera'
    
    // Player Camera (third-person views)
    this.playerCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000)
    this.playerCamera.position.copy(this.playerPosition)
    this.playerCamera.position.y += this.playerHeight
    this.playerCamera.name = 'PlayerCamera'
    
    // Orthographic Camera (for isometric overhead view)
    const frustumSize = this.config.orthographicCamera.frustumSize
    this.orthographicCamera = new THREE.OrthographicCamera(
      frustumSize * aspect / -2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      1000
    )
    this.orthographicCamera.position.copy(this.playerPosition)
    this.orthographicCamera.position.y += this.config.orthographicCamera.height
    this.orthographicCamera.name = 'OrthographicCamera'
    this.orthographicCamera.zoom = this.config.orthographicCamera.zoom
    this.orthographicCamera.updateProjectionMatrix()
    
    // Set initial camera based on default view
    this.currentCamera = this.currentThirdPersonView === 'overhead' 
      ? this.orthographicCamera 
      : this.playerCamera
    
    console.log('📷 Cameras initialized: Perspective + Orthographic (Isometric)')
    console.log(`📷 Current mode: ${this.currentMode}, Current view: ${this.currentThirdPersonView}`)
    console.log(`📷 Current camera is: ${this.currentCamera.name}`)
    console.log(`📷 Orthographic camera zoom set to: ${this.orthographicCamera.zoom}`)
    console.log(`📷 Orthographic camera frustumSize: ${this.config.orthographicCamera.frustumSize}`)
  }

  private initializeControls(): void {
    // Orbit controls for system camera
    this.orbitControls = new OrbitControls(this.systemCamera, this.renderer.domElement)
    this.orbitControls.enableDamping = true
    this.orbitControls.dampingFactor = 0.05
    this.orbitControls.minDistance = 2
    this.orbitControls.maxDistance = 1000
    this.orbitControls.maxPolarAngle = Math.PI * 0.95
    this.orbitControls.minPolarAngle = Math.PI * 0.05
    this.orbitControls.target.set(0, this.config.systemCamera.targetHeight, 0)
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
    // Mouse movement for player camera
    this.container.addEventListener('mousemove', this.onMouseMove.bind(this))
    
    // Pointer lock for player camera
    this.container.addEventListener('click', () => {
      if (this.currentMode === 'player') {
        this.container.requestPointerLock().catch(() => {
          // Pointer lock may fail if not user-initiated, that's okay
        })
      }
    })
    
    // Handle pointer lock change
    document.addEventListener('pointerlockchange', this.onPointerLockChange.bind(this))
    
    // Auto-request pointer lock on initial load if in player mode
    // This allows trackpad/mouse input to work immediately
    if (this.currentMode === 'player') {
      // Request pointer lock after a short delay to ensure page is fully loaded
      setTimeout(() => {
        if (this.currentMode === 'player' && document.pointerLockElement !== this.container) {
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
    
    // Initially visible for overhead view (default view)
    this.playerSpotlight.visible = this.currentThirdPersonView === 'overhead'
    
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
    const toCamera = mode === 'system' ? this.systemCamera : this.playerCamera

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
    this.currentCamera = mode === 'system' ? this.systemCamera : this.playerCamera
    
    // Enable/disable appropriate controls
    this.orbitControls.enabled = (mode === 'system')
    this.playerControls.enabled = (mode === 'player')
    
    // Handle pointer lock for player mode only when explicitly requested
    if (mode === 'player' && requestPointerLock) {
      // Only request pointer lock if we're not already locked
      if (document.pointerLockElement !== this.container) {
        this.container.requestPointerLock().catch((error) => {
                  // console.warn('📷 Pointer lock request failed:', error.message)
        // console.log('📷 Tip: Click on the canvas first, then press C to switch to player camera')
        })
      }
    } else if (mode === 'system') {
      // Exit pointer lock when switching to system camera
      if (document.pointerLockElement === this.container) {
        document.exitPointerLock()
      }
    }
    
    // console.log(`📷 Active camera: ${this.currentCamera.name}`)
  }

  // ============================================================================
  // PLAYER CAMERA CONTROLS
  // ============================================================================

  private onMouseMove(event: MouseEvent): void {
    // Only process mouse movement if player controls are enabled
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
    
    // Update active camera based on mode
    if (this.currentMode === 'system') {
      this.orbitControls.update()
    } else if (this.currentMode === 'player') {
      this.updatePlayerCamera(deltaTime)
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
   * Update player camera based on mouse input
   */
  private updatePlayerCamera(deltaTime: number): void {
    if (!this.playerControls.enabled) return
    
    // Get current third person offset configuration
    const offsetConfig = this.thirdPersonOffsets.get(this.currentThirdPersonView)
    if (!offsetConfig) return
    
    // Determine which camera to use
    const useOrthographic = this.currentThirdPersonView === 'overhead'
    const activeCamera = useOrthographic ? this.orthographicCamera : this.playerCamera
    
    // Update current camera if it changed
    if (this.currentCamera !== activeCamera) {
      this.currentCamera = activeCamera
      console.log(`📷 Switched to ${useOrthographic ? 'Orthographic' : 'Perspective'} camera`)
    }
    
    // Calculate target camera offset in world space
    const playerRotation = this.playerControls.yaw
    const rotationMatrix = new THREE.Matrix4().makeRotationY(playerRotation)
    
    this.targetCameraOffset.copy(offsetConfig.position)
    this.targetCameraOffset.applyMatrix4(rotationMatrix)
    
    // Smooth camera offset transition
    this.currentCameraOffset.lerp(this.targetCameraOffset, offsetConfig.smoothing)
    
    // Set camera position
    activeCamera.position.copy(this.playerPosition)
    activeCamera.position.add(this.currentCameraOffset)
    
    // Calculate look-at target
    const lookAtTarget = new THREE.Vector3()
    lookAtTarget.copy(offsetConfig.lookAtOffset)
    lookAtTarget.applyMatrix4(rotationMatrix)
    lookAtTarget.add(this.playerPosition)
    
    // Make camera look at target
    activeCamera.lookAt(lookAtTarget)
    
    // Update FOV only for perspective camera
    if (!useOrthographic && activeCamera instanceof THREE.PerspectiveCamera) {
      if (activeCamera.fov !== offsetConfig.fov) {
        activeCamera.fov = offsetConfig.fov
        activeCamera.updateProjectionMatrix()
      }
    }
    
    // Show/hide player mesh based on view
    if (this.playerMesh) {
      // Always show player mesh in third person views
      this.playerMesh.visible = true
    }
    
    // Update player spotlight
    this.updatePlayerSpotlight()
  }

  /**
   * Update player spotlight position and targeting
   */
  private updatePlayerSpotlight(): void {
    if (!this.playerSpotlight) return
    
    // Show spotlight in player mode (all views)
    const isPlayerMode = this.currentMode === 'player'
    this.playerSpotlight.visible = isPlayerMode
    
    if (isPlayerMode) {
      // Position spotlight directly above player for tight focused lighting
      const spotlightHeight = this.config.spotlight.height
      const cameraOffset = this.config.spotlight.offset
      
      // Position spotlight slightly in front to match orthographic camera view
      this.playerSpotlight.position.set(
        this.playerPosition.x,
        this.playerPosition.y + spotlightHeight,
        this.playerPosition.z - cameraOffset
      )
      
      // Point spotlight at player feet for clear ground illumination
      this.playerSpotlight.target.position.copy(this.playerPosition)
      this.playerSpotlight.target.position.y += 0.5 // Aim at player center
      this.playerSpotlight.target.updateMatrixWorld()
      
      // Update land system with spotlight data
      if (this.landSystem) {
        this.landSystem.setSpotlightPosition(this.playerSpotlight.position)
        
        // Calculate direction vector from spotlight to target
        const direction = new THREE.Vector3()
        direction.subVectors(this.playerSpotlight.target.position, this.playerSpotlight.position).normalize()
        this.landSystem.setSpotlightDirection(direction)
        
        this.landSystem.setSpotlightColor(this.playerSpotlight.color)
        this.landSystem.setSpotlightIntensity(this.playerSpotlight.intensity)
      }
    } else {
      // Turn off spotlight in shader when not in player mode
      if (this.landSystem) {
        this.landSystem.setSpotlightIntensity(0)
      }
    }
  }

  // ============================================================================
  // PLAYER POSITION MANAGEMENT
  // ============================================================================

  /**
   * Set player position (affects player camera)
   */
  public setPlayerPosition(position: THREE.Vector3): void {
    this.playerPosition.copy(position)
    if (this.currentMode === 'player') {
      this.playerCamera.position.copy(position)
      this.playerCamera.position.y += this.playerHeight
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

  /**
   * Get orthographic camera (for zoom control)
   */
  public getOrthographicCamera(): THREE.OrthographicCamera {
    return this.orthographicCamera
  }

  /**
   * Get current camera mode
   */
  public getCurrentMode(): CameraMode {
    return this.currentMode
  }

  /**
   * Get current third person view
   */
  public getCurrentThirdPersonView(): ThirdPersonView {
    return this.currentThirdPersonView
  }

  /**
   * Set third person view mode
   */
  public setThirdPersonView(view: ThirdPersonView): void {
    if (this.currentThirdPersonView === view) return
    
    console.log(`📷 Switching third person view: ${this.currentThirdPersonView} → ${view}`)
    this.currentThirdPersonView = view
    
    // Toggle spotlight visibility
    if (this.playerSpotlight) {
      this.playerSpotlight.visible = (view === 'overhead')
      console.log(`💡 Spotlight ${view === 'overhead' ? 'ENABLED' : 'DISABLED'} for ${view} view`)
    }
    
    // Reset camera offset for smooth transition
    const offsetConfig = this.thirdPersonOffsets.get(view)
    if (offsetConfig) {
      // Immediately set target offset
      const playerRotation = this.playerControls.yaw
      const rotationMatrix = new THREE.Matrix4().makeRotationY(playerRotation)
      this.targetCameraOffset.copy(offsetConfig.position)
      this.targetCameraOffset.applyMatrix4(rotationMatrix)
    }
  }

  /**
   * Cycle to next third person view
   */
  public cycleThirdPersonView(): void {
    const views: ThirdPersonView[] = ['shoulder', 'overhead']
    const currentIndex = views.indexOf(this.currentThirdPersonView)
    const nextIndex = (currentIndex + 1) % views.length
    this.setThirdPersonView(views[nextIndex])
  }

  /**
   * Register player mesh for visibility control
   */
  public registerPlayerMesh(mesh: THREE.Object3D): void {
    this.playerMesh = mesh
    // Initially show mesh (third person is default)
    if (this.playerMesh) {
      this.playerMesh.visible = true
    }
  }

  /**
   * Get system camera
   */
  public getSystemCamera(): THREE.PerspectiveCamera {
    return this.systemCamera
  }

  /**
   * Get player camera
   */
  public getPlayerCamera(): THREE.PerspectiveCamera {
    return this.playerCamera
  }

  /**
   * Get orbit controls (for system camera)
   */
  public getOrbitControls(): OrbitControls {
    return this.orbitControls
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
   * Update player camera rotation from gamepad input
   * @param deltaX - Right stick horizontal movement (-1 to 1)
   * @param deltaY - Right stick vertical movement (-1 to 1)
   * @param deltaTime - Time since last frame in seconds
   */
  public updatePlayerCameraFromGamepad(deltaX: number, deltaY: number, deltaTime: number): void {
    if (!this.playerControls.enabled || this.currentMode !== 'player') {
      return
    }

    // Apply gamepad sensitivity (higher than mouse for responsiveness)
    const gamepadSensitivity = this.playerControls.sensitivity * 100 // Scale up for gamepad
    
    this.playerControls.yaw -= deltaX * gamepadSensitivity * deltaTime * 60 // Scale by deltaTime and fps
    this.playerControls.pitch += deltaY * gamepadSensitivity * deltaTime * 60  // INVERTED: Changed -= to +=

    // Clamp pitch to prevent over-rotation
    this.playerControls.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.playerControls.pitch))
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
    const aspect = window.innerWidth / window.innerHeight
    
    this.systemCamera.aspect = aspect
    this.systemCamera.updateProjectionMatrix()
    
    this.playerCamera.aspect = aspect
    this.playerCamera.updateProjectionMatrix()
    
    // Update orthographic camera aspect ratio
    const frustumSize = this.config.orthographicCamera.frustumSize
    this.orthographicCamera.left = frustumSize * aspect / -2
    this.orthographicCamera.right = frustumSize * aspect / 2
    this.orthographicCamera.top = frustumSize / 2
    this.orthographicCamera.bottom = frustumSize / -2
    this.orthographicCamera.updateProjectionMatrix()
  }

  /**
   * Get camera info for debugging
   */
  public getCameraInfo(): object {
    return {
      currentMode: this.currentMode,
      isTransitioning: this.isTransitioning,
      systemCamera: {
        position: this.systemCamera.position.toArray(),
        rotation: this.systemCamera.rotation.toArray()
      },
      playerCamera: {
        position: this.playerCamera.position.toArray(),
        rotation: this.playerCamera.rotation.toArray()
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
   * Set land system reference for spotlight updates
   */
  public setLandSystem(landSystem: any): void {
    this.landSystem = landSystem
    console.log('📷 Land system linked to CameraManager for spotlight updates')
  }

  /**
   * Update a specific view's camera offset
   */
  public updateViewOffset(view: ThirdPersonView, offset: Partial<ThirdPersonCameraOffset>): void {
    const currentOffset = this.thirdPersonOffsets.get(view)
    if (currentOffset) {
      const updated = { ...currentOffset, ...offset }
      this.thirdPersonOffsets.set(view, updated)
      console.log(`📷 Updated ${view} camera view:`, offset)
    }
  }

  /**
   * Get a view's camera offset
   */
  public getViewOffset(view: ThirdPersonView): ThirdPersonCameraOffset | undefined {
    return this.thirdPersonOffsets.get(view)
  }

  /**
   * Update orthographic camera frustum size
   */
  public updateOrthographicFrustum(frustumSize: number): void {
    const aspect = this.container.clientWidth / this.container.clientHeight
    this.orthographicCamera.left = frustumSize * aspect / -2
    this.orthographicCamera.right = frustumSize * aspect / 2
    this.orthographicCamera.top = frustumSize / 2
    this.orthographicCamera.bottom = frustumSize / -2
    this.orthographicCamera.updateProjectionMatrix()
    console.log(`📷 Updated orthographic frustum size: ${frustumSize}`)
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