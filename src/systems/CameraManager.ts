import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type CameraMode = 'freeview' | 'shoulder'
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
}

// Default configuration
const DEFAULT_CAMERA_CONFIG: CameraManagerConfig = {
  defaultMode: 'freeview',
  defaultView: 'shoulder',
  defaultZoom: 2,
  
  freeViewCamera: {
    fov: 75,
    position: new THREE.Vector3(0, 2, 20),
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
    intensity: 6,
    angle: Math.PI / 8, // 22.5 degrees
    penumbra: 0.3,
    decay: 2,
    distance: 80,
    height: 30,
    offset: 5
  },
  
  transitionDuration: 1.0,
  
  shoulderView: {
    position: new THREE.Vector3(1.2, 1.5, -3.5),
    lookAtOffset: new THREE.Vector3(0, 1.0, 2),
    smoothing: 0.15,
    fov: 70
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
  private currentCamera!: THREE.Camera
  private currentMode: CameraMode
  
  // Shoulder view configuration
  private shoulderViewOffset: ThirdPersonCameraOffset
  
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
    
    console.log(`📷 CameraManager initialized - Mode: ${this.currentMode === 'freeview' ? 'FREE VIEW' : 'SHOULDER'}`)
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
      shoulderView: { ...defaults.shoulderView, ...overrides.shoulderView }
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
    
    // Set initial camera based on default mode
    this.currentCamera = this.currentMode === 'freeview' ? this.freeViewCamera : this.shoulderCamera
    
    console.log('📷 Cameras initialized: Free View + Shoulder')
    console.log(`📷 Current mode: ${this.currentMode === 'freeview' ? 'FREE VIEW' : 'SHOULDER'}`)
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
      if (this.currentMode === 'shoulder') {
        this.container.requestPointerLock().catch(() => {
          // Pointer lock may fail if not user-initiated, that's okay
        })
      }
    })
    
    // Handle pointer lock change
    document.addEventListener('pointerlockchange', this.onPointerLockChange.bind(this))
    
    // Auto-request pointer lock on initial load if in shoulder mode
    // This allows trackpad/mouse input to work immediately
    if (this.currentMode === 'shoulder') {
      // Request pointer lock after a short delay to ensure page is fully loaded
      setTimeout(() => {
        if (this.currentMode === 'shoulder' && document.pointerLockElement !== this.container) {
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
    const toCamera = mode === 'freeview' ? this.freeViewCamera : this.shoulderCamera

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
    this.currentCamera = mode === 'freeview' ? this.freeViewCamera : this.shoulderCamera
    
    // Enable/disable appropriate controls
    this.orbitControls.enabled = (mode === 'freeview')
    this.playerControls.enabled = (mode === 'shoulder')
    
    // Handle pointer lock for shoulder mode only when explicitly requested
    if (mode === 'shoulder' && requestPointerLock) {
      // Only request pointer lock if we're not already locked
      if (document.pointerLockElement !== this.container) {
        this.container.requestPointerLock().catch((error) => {
                  // console.warn('📷 Pointer lock request failed:', error.message)
        // console.log('📷 Tip: Click on the canvas first, then press C to switch to shoulder camera')
        })
      }
    } else if (mode === 'freeview') {
      // Exit pointer lock when switching to free view camera
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
    
    // Show/hide player mesh based on view
    if (this.playerMesh) {
      // Always show player mesh in shoulder view
      this.playerMesh.visible = true
    }
  }

  /**
   * Update player spotlight position and targeting
   */
  private updatePlayerSpotlight(): void {
    if (!this.playerSpotlight) return
    
    // Spotlight always follows and is always visible
    this.playerSpotlight.visible = true
    
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
      this.landSystem.setSpotlightIntensity(this.playerSpotlight.intensity)
    }
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

  /**
   * Get current camera mode
   */
  public getCurrentMode(): CameraMode {
    return this.currentMode
  }

  /**
   * Register player mesh for visibility control
   */
  public registerPlayerMesh(mesh: THREE.Object3D): void {
    this.playerMesh = mesh
    // Always show mesh in shoulder view
    if (this.playerMesh) {
      this.playerMesh.visible = true
    }
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
   * Get orbit controls (for free view camera)
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
    const aspect = window.innerWidth / window.innerHeight
    
    this.freeViewCamera.aspect = aspect
    this.freeViewCamera.updateProjectionMatrix()
    
    this.shoulderCamera.aspect = aspect
    this.shoulderCamera.updateProjectionMatrix()
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