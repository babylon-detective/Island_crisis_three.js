import * as THREE from 'three'
import { CollisionSystem, CollisionVolume, CollidableObject } from './CollisionSystem'
import { CameraManager } from './CameraManager'
import { logger, LogModule } from './Logger'
import { traceInputCommand, type InputTraceSource } from './InputTrace'
import { ObjectLoader } from './ObjectLoader'
import type { DialogueManager } from './DialogueSystem'
import type { BattleSystem } from './BattleSystem'
import type { GamepadPlayerInput } from './InputSystem'

// ============================================================================
// PLAYER CONFIGURATION
// ============================================================================

export interface PlayerConfig {
  // Physical properties
  height: number
  radius: number
  mass: number
  
  // Movement properties
  walkSpeed: number
  runSpeed: number
  jumpForce: number
  gravity: number
  
  // Physics properties
  groundCheckDistance: number
  friction: number
  airResistance: number
}

export interface PlayerState {
  position: THREE.Vector3
  velocity: THREE.Vector3
  onGround: boolean
  canJump: boolean
  isMoving: boolean
  isRunning: boolean
}

export interface PlayerInput {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  jump: boolean
  attack: boolean
  run: boolean
  camera: boolean // 'C' key for camera mode switching
  // Analog input for gamepad (0-1 values)
  analogMovement?: THREE.Vector2
  analogCamera?: THREE.Vector2
}

// ============================================================================
// PLAYER CONTROLLER
// ============================================================================

export class PlayerController {
  // Core systems
  private scene: THREE.Scene
  private collisionSystem: CollisionSystem
  private cameraManager: CameraManager
  private landUniforms?: { [key: string]: { value: any } }
  
  // Configuration
  private config: PlayerConfig
  
  // State
  private state: PlayerState
  private input: PlayerInput
  
  // Visual representation
  private mesh!: THREE.Mesh
  private debugWireframe: THREE.Object3D | null = null
  private isDebugVisible: boolean = false
  private meshGroundOffset: number = 0 // Runtime-adjustable Y offset for mesh placement (positive = move mesh down)
  private _debugFrameCount: number = 0 // Counter for periodic debug logging

  // Pose cycling
  private currentPoseIndex: number = -1 // -1 = rest pose
  private restPoseQuaternions: Map<string, THREE.Quaternion> = new Map()
  private posesInitialized: boolean = false

  // Ready promise — resolves once the player model is loaded
  private _readyResolve!: () => void
  public readonly ready: Promise<void> = new Promise(resolve => { this._readyResolve = resolve })
  
  // Collision
  private collisionVolume!: CollisionVolume
  private _tempNewPosition: THREE.Vector3 = new THREE.Vector3()
  
  // Ground detection hysteresis to prevent flickering
  private groundStateBuffer: boolean = false
  private groundStateFrames: number = 0
  private readonly groundStateThreshold: number = 3 // Require 3 frames of consistent state before changing

  // Dialogue manager (optional — set after construction for contextual action)
  private dialogueManager: DialogueManager | null = null
  private battleManager: BattleSystem | null = null
  // Guard to prevent repeated action triggers while button is held
  private actionConsumedThisPress: boolean = false
  private attackConsumedThisPress: boolean = false
  // Mobile virtual action press state
  private virtualJumpPressed: boolean = false
  private virtualAttackPressed: boolean = false
  private forcedFacingTarget: THREE.Vector3 | null = null
  
  // Input handling
  private keyStates: Map<string, boolean> = new Map()
  private boundKeyDown: (event: KeyboardEvent) => void
  private boundKeyUp: (event: KeyboardEvent) => void
  
  // Touch input handling
  private touchState: {
    activeTouches: Map<number, { x: number, y: number, startX: number, startY: number, prevX: number, prevY: number }>
    activeLookTouch: number | null
    runTouch: number | null // Double-tap + hold in navigate curtain
    lastTapTime: number
    lastTapX: number
    lastTapY: number
    lastMovementDelta: THREE.Vector2
    lastLookDelta: THREE.Vector2
    movementDirection: THREE.Vector2 // Continuous movement direction from touch position
  } = {
    activeTouches: new Map(),
    activeLookTouch: null,
    runTouch: null,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    lastMovementDelta: new THREE.Vector2(),
    lastLookDelta: new THREE.Vector2(),
    movementDirection: new THREE.Vector2() // For continuous movement based on touch position
  }
  private boundTouchStart: (event: TouchEvent) => void
  private boundTouchMove: (event: TouchEvent) => void
  private boundTouchEnd: (event: TouchEvent) => void
  private boundTouchCancel: (event: TouchEvent) => void
  private touchRaycaster: THREE.Raycaster = new THREE.Raycaster()
  private navigationTarget: THREE.Vector3 | null = null
  private touchTapCandidates: Map<number, {
    startX: number
    startY: number
    startTime: number
    moved: boolean
  }> = new Map()
  private touchZoneById: Map<number, 'navigate' | 'look'> = new Map()
  private touchCameraVelocity = new THREE.Vector2(0, 0)
  private navigationMarker: THREE.Mesh | null = null
  
  // Gamepad input
  private gamepadInput: {
    movement: THREE.Vector2
    camera: THREE.Vector2
    jump: boolean
    run: boolean
    action: boolean
    cancel: boolean
    cameraMode: boolean
    select: boolean
    menu: boolean
  } = {
    movement: new THREE.Vector2(),
    camera: new THREE.Vector2(),
    jump: false,
    run: false,
    action: false,
    cancel: false,
    cameraMode: false,
    select: false,
    menu: false
  }
  
  constructor(
    scene: THREE.Scene,
    collisionSystem: CollisionSystem,
    cameraManager: CameraManager,
    landUniforms?: { [key: string]: { value: any } },
    config?: Partial<PlayerConfig>
  ) {
    this.scene = scene
    this.collisionSystem = collisionSystem
    this.cameraManager = cameraManager
    this.landUniforms = landUniforms
    
    // Initialize configuration
    this.config = {
      height: 1.8,
      radius: 0.5,
      mass: 70,
      walkSpeed: 1.4,   // m/s — matches UAL walk animation cycle
      runSpeed: 5.0,    // m/s — matches UAL run animation cycle
      jumpForce: 8.0,
      gravity: 20.0,
      groundCheckDistance: 0.3,  // Distance below feet to check for ground
      friction: 0.8,
      airResistance: 0.95,
      ...config
    }
    
    // Initialize state – place capsule center so feet touch the ground plane at Y=0.
    // height/2 puts the capsule bottom at Y=0 (ground).  Start grounded to
    // avoid the initial "fall" animation.
    this.state = {
      position: new THREE.Vector3(0, this.config.height / 2, 0),
      velocity: new THREE.Vector3(),
      onGround: true,
      canJump: true,
      isMoving: false,
      isRunning: false
    }
    
    // Initialize input
    this.input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      attack: false,
      run: false,
      camera: false
    }
    
    // Bind input handlers
    this.boundKeyDown = this.handleKeyDown.bind(this)
    this.boundKeyUp = this.handleKeyUp.bind(this)

    // Reset all keys when the window loses focus so nothing stays "stuck"
    window.addEventListener('blur', () => {
      this.keyStates.clear()
      this.updateInputState()
    })
    this.boundTouchStart = this.handleTouchStart.bind(this)
    this.boundTouchMove = this.handleTouchMove.bind(this)
    this.boundTouchEnd = this.handleTouchEnd.bind(this)
    this.boundTouchCancel = this.handleTouchCancel.bind(this)
    
    // Initialize player (async, but don't await to avoid blocking constructor)
    this.initializePlayer().then(() => {
      this.registerWithCollisionSystem()
      this._readyResolve()
      logger.info(LogModule.PLAYER, 'PlayerController fully initialized')
    }).catch(error => {
      this._readyResolve() // resolve even on failure so waiters don't hang
      logger.error(LogModule.PLAYER, 'PlayerController initialization failed:', error)
    })
    
    this.setupInputHandlers()
    
    logger.info(LogModule.PLAYER, 'PlayerController initialized (loading player model...)')
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  private async initializePlayer(): Promise<void> {
    try {
      // Load player model from GLB file with default-character shader
      const playerModel = await ObjectLoader.loadGLTFModel(
        '/models/characters/Ideal_Low_Poly_Male_01.glb',
        'player-character',
        [0, 0, 0],
        [0, 0, 0],
        [1, 1, 1],
        true, // Use custom shader for player (default-character)
        this.landUniforms // Pass land lighting uniforms
      )
      
      // Configure the model
      playerModel.name = 'PlayerMesh'
      
      // Compute bounding box for scaling reference
      // NOTE: Box3.setFromObject uses raw geometry (bind pose), NOT skinned positions.
      // For skinned meshes, don't use bbox.min.y as foot offset — it won't match
      // the animated pose. Instead, rely on animations placing feet at y=0 relative
      // to the skeleton root, and place the mesh origin at capsuleBottom.
      const bbox = new THREE.Box3().setFromObject(playerModel)
      const actualHeight = bbox.max.y - bbox.min.y
      
      // Scale model so it matches the configured capsule height
      const scale = this.config.height / actualHeight
      playerModel.scale.setScalar(scale)
      
      logger.info(LogModule.PLAYER, `Model bbox: height=${actualHeight.toFixed(2)}, scale=${scale.toFixed(3)}, bboxMinY=${bbox.min.y.toFixed(3)}, bboxMaxY=${bbox.max.y.toFixed(3)}`)
      
      // Enable shadows for all meshes in the model
      playerModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true
          child.receiveShadow = true
        }
      })
      
      this.mesh = playerModel as any // Type cast for compatibility
      this.mesh.position.copy(this.state.position)
      // Model is already added to scene by ObjectLoader, just update position
      
      // Register mesh with camera manager for visibility control
      this.cameraManager.registerPlayerMesh(this.mesh)
      
      logger.info(LogModule.PLAYER, 'Player model loaded successfully')
    } catch (error) {
      logger.error(LogModule.PLAYER, 'Failed to load player model, using fallback', error)
      // Fallback to generated mesh
      this.createFallbackPlayerMesh()
    }
    
    // Create collision volume
    this.collisionVolume = {
      type: 'capsule',
      position: this.state.position.clone(),
      rotation: new THREE.Euler(),
      dimensions: new THREE.Vector3(
        this.config.radius,
        this.config.height,
        0
      )
    }
    
    // Create debug wireframe
    this.createDebugWireframe()
  }

  private createFallbackPlayerMesh(): void {
    // Original generated mesh code as fallback
    const playerGroup = new THREE.Group()
    playerGroup.name = 'PlayerMesh'
    
    // Create body (capsule-like shape)
    const bodyGeometry = new THREE.CylinderGeometry(
      this.config.radius,
      this.config.radius,
      this.config.height * 0.7,
      8
    )
    
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a90e2,
      emissive: 0x2a5080,
      emissiveIntensity: 0.3,
      roughness: 0.7,
      metalness: 0.3
    })
    
    const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial)
    bodyMesh.position.y = -this.config.height * 0.15
    bodyMesh.castShadow = true
    bodyMesh.receiveShadow = true
    playerGroup.add(bodyMesh)
    
    // Create head (sphere)
    const headGeometry = new THREE.SphereGeometry(this.config.radius * 0.8, 8, 8)
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xffcc99,
      emissive: 0xaa8866,
      emissiveIntensity: 0.2,
      roughness: 0.8,
      metalness: 0.1
    })
    
    const headMesh = new THREE.Mesh(headGeometry, headMaterial)
    headMesh.position.y = this.config.height * 0.4
    headMesh.castShadow = true
    headMesh.receiveShadow = true
    playerGroup.add(headMesh)
    
    // Add eyes
    const eyeGeometry = new THREE.SphereGeometry(0.08, 4, 4)
    const eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0x333333
    })
    
    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial)
    leftEye.position.set(-0.15, this.config.height * 0.42, this.config.radius * 0.6)
    playerGroup.add(leftEye)
    
    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial)
    rightEye.position.set(0.15, this.config.height * 0.42, this.config.radius * 0.6)
    playerGroup.add(rightEye)
    
    this.mesh = playerGroup as any
    this.mesh.position.copy(this.state.position)
    this.scene.add(this.mesh)
    
    // Register mesh with camera manager
    this.cameraManager.registerPlayerMesh(this.mesh)
  }

  private createDebugWireframe(): void {
    this.debugWireframe = this.collisionSystem.createDebugWireframe(this.collisionVolume, 0x00ff00)
    this.debugWireframe.position.copy(this.state.position)
    this.debugWireframe.visible = false
    this.scene.add(this.debugWireframe)
  }

  private registerWithCollisionSystem(): void {
    const collidableObject: CollidableObject = {
      id: 'player',
      mesh: this.mesh,
      collisionVolume: this.collisionVolume,
      isStatic: false
    }
    
    this.collisionSystem.registerObject(collidableObject)
    
    logger.info(LogModule.PLAYER, `Player registered with collision system at position (${this.state.position.x.toFixed(2)}, ${this.state.position.y.toFixed(2)}, ${this.state.position.z.toFixed(2)})`)
  }

  private setupInputHandlers(): void {
    // Keyboard input
    document.addEventListener('keydown', this.boundKeyDown)
    document.addEventListener('keyup', this.boundKeyUp)
    
    // Touch input for mobile
    const canvas = this.scene.parent?.userData?.canvas || document.body
    canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false })
    canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false })
    canvas.addEventListener('touchend', this.boundTouchEnd, { passive: false })
    canvas.addEventListener('touchcancel', this.boundTouchCancel, { passive: false })
  }

  // ============================================================================
  // INPUT HANDLING
  // ============================================================================

  private handleKeyDown(event: KeyboardEvent): void {
    // Prevent default for game keys
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      event.preventDefault()
    }
    
    this.keyStates.set(event.code, true)
    this.updateInputState()
    
    logger.debug(LogModule.PLAYER, `Key pressed: ${event.code}`)
  }

  private handleKeyUp(event: KeyboardEvent): void {
    this.keyStates.set(event.code, false)
    this.updateInputState()
    
    logger.debug(LogModule.PLAYER, `Key released: ${event.code}`)
  }

  private updateInputState(): void {
    // Keyboard input
    const keyForward = this.keyStates.get('KeyW') || false
    const keyBackward = this.keyStates.get('KeyS') || false
    const keyLeft = this.keyStates.get('KeyA') || false
    const keyRight = this.keyStates.get('KeyD') || false
    const keyJump = (this.keyStates.get('KeyJ') || this.keyStates.get('Enter') || this.keyStates.get('NumpadEnter') || false)
    const keyAttack = this.keyStates.get('KeyK') || false
    const keyRun = (this.keyStates.get('ShiftLeft') || this.keyStates.get('ShiftRight')) || false
    const keyCamera = this.keyStates.get('KeyI') || false
    
    // (WASD debug logging removed to avoid per-frame console.log overhead)
    
    // Touch movement is tap-to-navigate (handled separately), not virtual joystick.
    const touchForward = false
    const touchBackward = false
    const touchLeft = false
    const touchRight = false
    
    // Gamepad input (analog movement converted to digital)
    const gamepadForward = this.gamepadInput.movement.y > 0.1
    const gamepadBackward = this.gamepadInput.movement.y < -0.1
    const gamepadLeft = this.gamepadInput.movement.x < -0.1
    const gamepadRight = this.gamepadInput.movement.x > 0.1
    
    // Combine keyboard, touch, and gamepad input (OR logic - any input works)
    this.input.forward = keyForward || touchForward || gamepadForward
    this.input.backward = keyBackward || touchBackward || gamepadBackward
    this.input.left = keyLeft || touchLeft || gamepadLeft
    this.input.right = keyRight || touchRight || gamepadRight
    const touchRun = this.touchState.runTouch !== null && this.touchState.activeTouches.has(this.touchState.runTouch)
    this.input.jump = keyJump || this.gamepadInput.jump || this.virtualJumpPressed
    this.input.attack = keyAttack || this.gamepadInput.action || this.virtualAttackPressed
    this.input.run = keyRun || this.gamepadInput.run || touchRun
    this.input.camera = keyCamera || this.gamepadInput.cameraMode
    
    // Store analog values for smooth movement (gamepad only).
    if (this.gamepadInput.movement.length() > 0.1) {
      this.input.analogMovement = this.gamepadInput.movement.clone()
    } else {
      this.input.analogMovement = new THREE.Vector2()
    }
    
    // Touch camera input (single-finger drag for looking)
    if (this.touchState.activeLookTouch !== null) {
      // Convert touch delta to camera rotation
      // Use higher sensitivity for touch since deltas are pixel-based
      const lookSensitivity = 0.0085
      // Use the look delta even if small - let the camera manager handle deadzone
      this.input.analogCamera = this.touchState.lastLookDelta.clone().multiplyScalar(lookSensitivity)
    } else {
      // No touch look, use gamepad or clear
      this.input.analogCamera = this.gamepadInput.camera.clone()
    }
    
    // Reset touch deltas after processing (they'll be updated on next touch move)
    // Note: We don't reset here to allow continuous movement during touch
  }

  // ============================================================================
  // TOUCH INPUT HANDLING
  // ============================================================================
  
  private handleTouchStart(event: TouchEvent): void {
    if (!this.shouldHandleGameplayTouchEvent(event)) return
    event.preventDefault()
    
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i]
      const touchInfo = {
        x: touch.clientX,
        y: touch.clientY,
        startX: touch.clientX,
        startY: touch.clientY,
        prevX: touch.clientX,
        prevY: touch.clientY
      }
      
      this.touchState.activeTouches.set(touch.identifier, touchInfo)

      const zone: 'navigate' | 'look' = touch.clientX < (window.innerWidth * 0.5) ? 'navigate' : 'look'
      this.touchZoneById.set(touch.identifier, zone)

      if (zone === 'look' && this.touchState.activeLookTouch === null) {
        this.touchState.activeLookTouch = touch.identifier
        this.touchState.lastLookDelta.set(0, 0)
        this.touchCameraVelocity.set(0, 0) // cancel any inertia from previous swipe
        this.cameraManager.setTouchLookActive(true)
      }

      // Old-feel gesture: double-tap + hold on the navigate curtain to run.
      if (zone === 'navigate') {
        const now = performance.now()
        const dt = now - this.touchState.lastTapTime
        const dx = touch.clientX - this.touchState.lastTapX
        const dy = touch.clientY - this.touchState.lastTapY
        const distSq = dx * dx + dy * dy
        const isDoubleTap = dt < 320 && distSq < (64 * 64)
        if (isDoubleTap) {
          this.touchState.runTouch = touch.identifier
        }
        this.touchState.lastTapTime = now
        this.touchState.lastTapX = touch.clientX
        this.touchState.lastTapY = touch.clientY
      }

      // Tap-to-move should work from either side; drag can still control camera.
      this.touchTapCandidates.set(touch.identifier, {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: performance.now(),
        moved: false,
      })
    }

    this.updateInputState()
  }
  
  /**
   * Reassign touch roles: one finger drag = camera look, tap = navigation.
   */
  private reassignTouchRoles(): void {
    if (this.touchState.activeTouches.size === 0) {
      this.touchState.activeLookTouch = null
      this.touchState.runTouch = null
      this.touchState.movementDirection.set(0, 0)
      this.touchState.lastLookDelta.set(0, 0)
      return
    }

    if (
      this.touchState.activeLookTouch !== null &&
      this.touchState.activeTouches.has(this.touchState.activeLookTouch) &&
      this.touchZoneById.get(this.touchState.activeLookTouch) === 'look'
    ) {
      return
    }

    const replacementTouchId = Array.from(this.touchState.activeTouches.keys())
      .find(id => this.touchZoneById.get(id) === 'look') ?? null

    this.touchState.activeLookTouch = replacementTouchId
    this.touchState.lastLookDelta.set(0, 0)
    this.cameraManager.setTouchLookActive(replacementTouchId !== null)
  }
  
  private handleTouchMove(event: TouchEvent): void {
    if (!this.shouldHandleGameplayTouchEvent(event)) return
    event.preventDefault()
    
    // Update touch positions and calculate deltas
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i]
      const touchId = touch.identifier
      const touchInfo = this.touchState.activeTouches.get(touchId)
      
      if (!touchInfo) continue
      
      const deltaX = touch.clientX - touchInfo.x
      const deltaY = touch.clientY - touchInfo.y
      
      const tapCandidate = this.touchTapCandidates.get(touchId)
      if (tapCandidate) {
        const movedDist = Math.hypot(
          touch.clientX - tapCandidate.startX,
          touch.clientY - tapCandidate.startY,
        )
        // Slightly larger threshold improves reliability on small/mobile screens.
        if (movedDist > 16) tapCandidate.moved = true
      }
      
      // Update previous position for next frame
      touchInfo.prevX = touchInfo.x
      touchInfo.prevY = touchInfo.y
      
      // Update current position
      touchInfo.x = touch.clientX
      touchInfo.y = touch.clientY

      if (touchId === this.touchState.activeLookTouch) {
        // Accumulate deltas so sub-frame touchmove events aren't lost
        this.touchState.lastLookDelta.x += deltaX
        this.touchState.lastLookDelta.y += deltaY
      }
    }

    if (this.touchState.activeLookTouch === null) {
      this.touchState.lastLookDelta.set(0, 0)
    }

    // Update input state to process touch movement
    this.updateInputState()
  }
  
  private handleTouchEnd(event: TouchEvent): void {
    if (!this.shouldHandleGameplayTouchEvent(event)) return
    event.preventDefault()
    
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i]
      const touchId = touch.identifier

      // Tap-to-navigate: quick touch with minimal movement (from either side).
      const tapCandidate = this.touchTapCandidates.get(touchId)
      if (tapCandidate) {
        const tapDuration = performance.now() - tapCandidate.startTime
        if (!tapCandidate.moved && tapDuration < 360) {
          this.setNavigationTargetFromScreenTap(touch.clientX, touch.clientY)
        }
      }

      if (this.touchState.runTouch === touchId) {
        this.touchState.runTouch = null
      }

      if (this.touchState.activeLookTouch === touchId) {
        // Capture any un-consumed delta as the initial momentum for inertia
        const ld = this.touchState.lastLookDelta
        if (ld.lengthSq() > 0.25) {
          this.touchCameraVelocity.copy(ld)
        }
        this.touchState.activeLookTouch = null
        this.touchState.lastLookDelta.set(0, 0)
        this.cameraManager.setTouchLookActive(false)
      }
      
      this.touchState.activeTouches.delete(touchId)
      this.touchZoneById.delete(touchId)
      this.touchTapCandidates.delete(touchId)
    }
    
    // Reassign touch roles based on remaining touches
    this.reassignTouchRoles()
    
    // Clear all deltas when no touches remain
    if (this.touchState.activeTouches.size === 0) {
      this.touchState.lastLookDelta.set(0, 0)
      this.touchState.movementDirection.set(0, 0)
      this.updateInputState()
    }
  }

  private setNavigationTargetFromScreenTap(screenX: number, screenY: number): void {
    const camera = this.cameraManager.getCamera()
    const ndc = new THREE.Vector2(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1,
    )

    this.touchRaycaster.setFromCamera(ndc, camera)

    const landMeshes: THREE.Object3D[] = []
    this.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      const ud = obj.userData ?? {}
      if (ud.type === 'land' || ud.landType === 'plane' || ud.landType === 'box' || ud.landType === 'sphere' || ud.landType === 'cylinder') {
        landMeshes.push(obj)
      }
    })

    if (landMeshes.length > 0) {
      const hits = this.touchRaycaster.intersectObjects(landMeshes, true)
      if (hits.length > 0) {
        this.navigationTarget = hits[0].point.clone()
        this.showNavigationMarker(this.navigationTarget)
        traceInputCommand({
          source: 'touch',
          target: 'player',
          command: 'navigate-tap',
          result: 'executed',
          details: {
            x: Number(screenX.toFixed(1)),
            y: Number(screenY.toFixed(1)),
            world: this.navigationTarget.toArray().map(value => Number(value.toFixed(2)))
          }
        })
        return
      }
    }

    // Fallback: project to a horizontal plane at local ground height.
    const baseGround = this.collisionSystem.getGroundHeight(this.state.position.x, this.state.position.z)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -baseGround)
    const hit = new THREE.Vector3()
    if (this.touchRaycaster.ray.intersectPlane(plane, hit)) {
      hit.y = this.collisionSystem.getGroundHeight(hit.x, hit.z)
      this.navigationTarget = hit
      this.showNavigationMarker(this.navigationTarget)
      traceInputCommand({
        source: 'touch',
        target: 'player',
        command: 'navigate-tap',
        result: 'executed',
        details: {
          x: Number(screenX.toFixed(1)),
          y: Number(screenY.toFixed(1)),
          world: this.navigationTarget.toArray().map(value => Number(value.toFixed(2)))
        }
      })
    }
  }

  private showNavigationMarker(position: THREE.Vector3): void {
    if (!this.navigationMarker) {
      const ring = new THREE.RingGeometry(0.24, 0.34, 40)
      const mat = new THREE.MeshBasicMaterial({
        color: 0x2ea8ff,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      this.navigationMarker = new THREE.Mesh(ring, mat)
      this.navigationMarker.rotation.x = -Math.PI / 2
      this.navigationMarker.renderOrder = 999
      this.navigationMarker.visible = false
      this.scene.add(this.navigationMarker)
    }

    this.navigationMarker.position.set(position.x, position.y + 0.03, position.z)
    this.navigationMarker.visible = true
    this.navigationMarker.scale.setScalar(1)
  }

  private updateNavigationMarker(): void {
    if (!this.navigationMarker || !this.navigationMarker.visible) return

    const t = performance.now() * 0.004
    const pulse = 1 + Math.sin(t) * 0.08
    this.navigationMarker.scale.setScalar(pulse)

    const mat = this.navigationMarker.material as THREE.MeshBasicMaterial
    mat.opacity = this.navigationTarget ? 0.92 : 0.0
    if (!this.navigationTarget) {
      this.navigationMarker.visible = false
    }
  }
  
  private handleTouchCancel(event: TouchEvent): void {
    // Same as touch end
    this.handleTouchEnd(event)
  }

  private shouldHandleGameplayTouchEvent(event: TouchEvent): boolean {
    const target = event.target
    if (!(target instanceof Element)) return true

    return !target.closest(
      '#dialogue-overlay, #battle-overlay, #mobile-start-btn, #mobile-jump-btn, #mobile-ranged-btn, button'
    )
  }

  // ============================================================================
  // GAMEPAD INPUT HANDLING
  // ============================================================================
  
  public handleGamepadInput(input: GamepadPlayerInput): void {
    this.gamepadInput = {
      movement: input.movement.clone(),
      camera: input.camera.clone(),
      jump: input.jump,
      run: input.run,
      action: input.action,
      cancel: input.cancel,
      cameraMode: input.cameraMode,
      select: input.select,
      menu: input.menu
    }
    
    // CRITICAL FIX: Update input state immediately when gamepad input changes
    // This ensures gamepad input is processed even without keyboard events
    this.updateInputState()
  }

  // ============================================================================
  // MOVEMENT SYSTEM
  // ============================================================================

  public update(deltaTime: number): void {
    // Always update movement and input
    this.updateMovement(deltaTime)
    
    // Update collision system
    this.collisionSystem.updatePlayerPosition(this.state.position)
    
    // Don't update until player is initialized
    if (!this.mesh) return
    
    // Always update physics and visuals
    this.updatePhysics(deltaTime)
    this.updateVisuals()
    this.updateCamera(deltaTime)
    
    // Log state occasionally (commented out to reduce spam)
    // if (Math.random() < 0.01) {
    //   logger.debug(LogModule.PLAYER, `State: pos=(${this.state.position.x.toFixed(2)}, ${this.state.position.y.toFixed(2)}, ${this.state.position.z.toFixed(2)}), vel=(${this.state.velocity.x.toFixed(2)}, ${this.state.velocity.y.toFixed(2)}, ${this.state.velocity.z.toFixed(2)}), onGround=${this.state.onGround}, moving=${this.state.isMoving}`)
    // }
  }

  private updateMovement(deltaTime: number): void {
    // ---- Contextual confirm button (battle / dialogue) ----
    const confirmPressed = this.input.jump
    if (confirmPressed && !this.actionConsumedThisPress) {
      const source = this.getConfirmInputSource()
      let consumed = false
      if (this.battleManager) {
        consumed = this.battleManager.handleConfirmActionButton(source)
      }
      if (!consumed && this.dialogueManager) {
        consumed = this.dialogueManager.handleActionButton(source)
      }
      traceInputCommand({
        source,
        target: 'player',
        command: 'confirm/context',
        result: consumed ? 'consumed' : 'ignored',
        details: {
          battleActive: this.battleManager?.isBattleActive() ?? false,
          dialogueActive: this.dialogueManager?.isDialogueActive() ?? false
        }
      })
      if (consumed) {
        this.actionConsumedThisPress = true
      }
    }
    if (!confirmPressed) {
      this.actionConsumedThisPress = false
    }

    // ---- Attack button (battle initiation) ----
    const attackPressed = this.input.attack
    if (attackPressed && !this.attackConsumedThisPress) {
      const source = this.getAttackInputSource()
      if (this.battleManager) {
        const consumed = this.battleManager.handleAttackButton(source)
        traceInputCommand({
          source,
          target: 'player',
          command: 'attack/context',
          result: consumed ? 'consumed' : 'ignored',
          details: { battleActive: this.battleManager.isBattleActive() }
        })
        if (consumed) {
          this.attackConsumedThisPress = true
        }
      }
    }
    if (!attackPressed) {
      this.attackConsumedThisPress = false
    }

    if (this.battleManager?.isBattleActive() && this.gamepadInput.cancel) {
      this.battleManager.handleEscapeInput('gamepad')
    }

    // Block movement while dialogue or battle is active
    if ((this.dialogueManager && this.dialogueManager.isDialogueActive()) ||
        (this.battleManager && this.battleManager.isBattleActive())) {
      this.navigationTarget = null
      if (this.navigationMarker) {
        this.navigationMarker.visible = false
      }
      this.state.velocity.x *= 0.85
      this.state.velocity.z *= 0.85
      this.state.isMoving = false
      this.state.isRunning = false
      return
    }

    // Get camera direction for movement
    const camera = this.cameraManager.getCamera()
    const cameraDirection = new THREE.Vector3()
    camera.getWorldDirection(cameraDirection)
    
    // Create movement direction
    const moveDirection = new THREE.Vector3()
    
    // Check if we have analog gamepad input
    const hasAnalogInput = this.input.analogMovement && this.input.analogMovement.length() > 0.1
    const hasDigitalInput = this.input.forward || this.input.backward || this.input.left || this.input.right
    const hasManualMovementInput = hasAnalogInput || hasDigitalInput

    // Manual input cancels tap-to-navigate.
    if (hasManualMovementInput) {
      this.navigationTarget = null
    }
    
    let navigationDistance = Number.POSITIVE_INFINITY

    if (hasAnalogInput) {
      // Use analog gamepad input for smooth movement
      const analogX = this.input.analogMovement!.x
      const analogY = this.input.analogMovement!.y
      
      // Forward/backward based on analog Y
      if (Math.abs(analogY) > 0.1) {
        const forwardDir = cameraDirection.clone().setY(0).normalize()
        moveDirection.add(forwardDir.multiplyScalar(analogY))
      }
      
      // Left/right based on analog X
      if (Math.abs(analogX) > 0.1) {
        const rightDir = cameraDirection.clone().setY(0).cross(new THREE.Vector3(0, 1, 0)).normalize()
        moveDirection.add(rightDir.multiplyScalar(analogX))
      }
    } else {
      // Use digital keyboard/button input
      if (this.input.forward) {
        moveDirection.add(cameraDirection.clone().setY(0).normalize())
      }
      if (this.input.backward) {
        moveDirection.sub(cameraDirection.clone().setY(0).normalize())
      }
      if (this.input.left) {
        moveDirection.sub(cameraDirection.clone().setY(0).cross(new THREE.Vector3(0, 1, 0)).normalize())
      }
      if (this.input.right) {
        moveDirection.add(cameraDirection.clone().setY(0).cross(new THREE.Vector3(0, 1, 0)).normalize())
      }

      // Tap-to-navigate movement when there is no manual directional input.
      if (!hasDigitalInput && this.navigationTarget) {
        const toTarget = this.navigationTarget.clone().sub(this.state.position)
        toTarget.y = 0
        const dist = toTarget.length()
        navigationDistance = dist

        if (dist < 0.30) {
          this.navigationTarget = null
          if (this.navigationMarker) this.navigationMarker.visible = false
        } else {
          toTarget.normalize()
          moveDirection.add(toTarget)
        }
      }
    }
    
    // Apply movement
    if (moveDirection.length() > 0) {
      // For analog input, preserve the magnitude for variable speed
      const inputMagnitude = hasAnalogInput ? Math.min(this.input.analogMovement!.length(), 1.0) : 1.0
      
      // Normalize direction but preserve analog magnitude
      moveDirection.normalize()
      
      // Determine speed
      const navigating = !hasManualMovementInput && this.navigationTarget !== null
      let baseSpeed = this.input.run ? this.config.runSpeed : this.config.walkSpeed
      if (navigating) {
        // Old-feel behavior: move fast toward the marker, then ease down to walk.
        const slowDownStartDistance = 3.0
        if (navigationDistance >= slowDownStartDistance) {
          baseSpeed = this.config.runSpeed
        } else {
          const t = Math.max(0, navigationDistance / slowDownStartDistance)
          baseSpeed = this.config.walkSpeed + (this.config.runSpeed - this.config.walkSpeed) * t
        }
      }
      const speed = baseSpeed * inputMagnitude // Scale by analog input magnitude
      const movement = moveDirection.multiplyScalar(speed) // Don't multiply by deltaTime yet
      
      // Apply horizontal movement (velocity in units/second)
      this.state.velocity.x = movement.x
      this.state.velocity.z = movement.z
      this.state.isMoving = true
      this.state.isRunning = navigating ? navigationDistance > 1.1 : this.input.run
      
      // (Speed debug logging removed to avoid per-frame console.log overhead)
      
      // logger.debug(LogModule.PLAYER, `Movement: speed=${speed}, direction=(${moveDirection.x.toFixed(2)}, ${moveDirection.z.toFixed(2)}), input=(${this.input.forward},${this.input.backward},${this.input.left},${this.input.right})`)
    } else {
      // Apply friction when not moving
      this.state.velocity.x *= this.config.friction
      this.state.velocity.z *= this.config.friction
      this.state.isMoving = false
      this.state.isRunning = false
      
      // Log when no movement input (commented out to reduce spam)
      // if (this.input.forward || this.input.backward || this.input.left || this.input.right) {
      //   logger.debug(LogModule.PLAYER, `No movement despite input: forward=${this.input.forward}, backward=${this.input.backward}, left=${this.input.left}, right=${this.input.right}`)
      // }
    }
    
    // Reset jump flag when on ground
    if (this.state.onGround) {
      this.state.canJump = true
    }
  }

  private updatePhysics(deltaTime: number): void {
    // Apply gravity
    if (!this.state.onGround) { // Only apply gravity if not on ground
      this.state.velocity.y -= this.config.gravity * deltaTime
    }
    
    // Apply air resistance
    if (!this.state.onGround) {
      this.state.velocity.x *= this.config.airResistance
      this.state.velocity.z *= this.config.airResistance
    }
    
    // Calculate new position (reuse temp vector to avoid per-frame allocation)
    this._tempNewPosition.copy(this.state.position).addScaledVector(this.state.velocity, deltaTime)
    
    // Check collision
    const collision = this.collisionSystem.checkCollision('player', this._tempNewPosition)
    
    // Debug: Log collision results occasionally (disabled)
    // if (Math.random() < 0.01 && collision.hasCollision) { // 1% chance and only when collision happens
    //   console.log(`🔍 Collision Result: hasCollision=${collision.hasCollision}, penetration=${collision.penetrationDepth.toFixed(3)}, normal=(${collision.normal.x.toFixed(2)}, ${collision.normal.y.toFixed(2)}, ${collision.normal.z.toFixed(2)})`)
    // }
    
    if (collision.hasCollision) {
      // Handle collision
      this.state.position.copy(collision.correctedPosition)

      // Ground contact from collision normal (lenient threshold for uneven terrain)
      const isGroundCollision = collision.normal.y > 0.2
      if (isGroundCollision) {
        this.state.onGround = true
        if (this.state.velocity.y < 0) this.state.velocity.y = 0
      } else {
        // If this was likely a wall collision, keep grounded if we're still near terrain.
        const groundHeight = this.collisionSystem.getGroundHeight(this.state.position.x, this.state.position.z)
        const capsuleBottomY = this.state.position.y - (this.config.height * 0.5)
        this.state.onGround = capsuleBottomY <= (groundHeight + this.config.groundCheckDistance)
      }
      
      // Debug: Log collision handling (disabled)
      // if (Math.random() < 0.02) { // 2% chance per frame (was 5%)
      //   console.log(`💥 Collision: corrected to (${this.state.position.x.toFixed(2)}, ${this.state.position.y.toFixed(2)}, ${this.state.position.z.toFixed(2)}), onGround=${this.state.onGround}, normal=(${collision.normal.x.toFixed(2)}, ${this.state.velocity.y.toFixed(2)}, ${this.state.velocity.z.toFixed(2)})`)
      // }
    } else {
      // No collision, update position
      this.state.position.copy(this._tempNewPosition)

      // Probe terrain directly and derive grounded state.
      const groundHeight = this.collisionSystem.getGroundHeight(this.state.position.x, this.state.position.z)
      const capsuleBottomY = this.state.position.y - (this.config.height * 0.5)
      const distanceToGround = capsuleBottomY - groundHeight
      const isNotMovingUp = this.state.velocity.y <= 0.5
      const groundedByProbe = distanceToGround <= this.config.groundCheckDistance && isNotMovingUp

      this.state.onGround = groundedByProbe
      if (groundedByProbe) {
        // Snap capsule bottom to terrain and clear negative vertical velocity.
        this.state.position.y = groundHeight + (this.config.height * 0.5)
        if (this.state.velocity.y < 0) this.state.velocity.y = 0
      }
    }
    
    // Update collision volume
    this.collisionVolume.position.copy(this.state.position)
  }

  private updateVisuals(): void {
    if (!this.mesh) return // Guard against uninitialized mesh
    
    // Update mesh position
    // state.position = capsule center. Place mesh origin at capsuleBottom.
    // UAL animations are authored with feet at y=0 relative to skeleton root,
    // so capsuleBottom = ground level = correct mesh origin placement.
    this.mesh.position.set(
      this.state.position.x,
      this.state.position.y - this.config.height / 2 - this.meshGroundOffset,
      this.state.position.z,
    )

    this.updateNavigationMarker()
    
    // Rotate player mesh to face movement direction (smooth turn)
    const vx = this.state.velocity.x
    const vz = this.state.velocity.z
    const horizontalSpeed = Math.sqrt(vx * vx + vz * vz)

    if (this.forcedFacingTarget) {
      const toTarget = this.forcedFacingTarget.clone().sub(this.mesh.position)
      toTarget.y = 0
      if (toTarget.lengthSq() > 0.0001) {
        this.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z)
      }
    } else if (horizontalSpeed > 0.5) {
      // Calculate target yaw from velocity direction
      const targetYaw = Math.atan2(vx, vz)
      // Smoothly interpolate current rotation toward target
      let currentYaw = this.mesh.rotation.y
      // Shortest-arc delta
      let delta = targetYaw - currentYaw
      // Wrap delta to [-PI, PI]
      delta = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI
      if (delta < -Math.PI) delta += Math.PI * 2
      // Turn speed (radians per second) — higher = snappier
      const turnSpeed = 12.0
      const maxStep = turnSpeed * (1 / 60) // approximate per-frame step
      if (Math.abs(delta) > maxStep) {
        currentYaw += Math.sign(delta) * maxStep
      } else {
        currentYaw = targetYaw
      }
      this.mesh.rotation.y = currentYaw
    }
    // When not moving, keep the last facing direction (don't snap to camera)
    
    // Update debug wireframe
    if (this.debugWireframe) {
      this.debugWireframe.position.copy(this.state.position)
    }
  }

  private updateCamera(deltaTime: number): void {
    // Update camera position through camera manager
    this.cameraManager.setPlayerPosition(this.state.position)

    const usingTouchLook = this.touchState.activeLookTouch !== null

    if (usingTouchLook) {
      // Touch path: lastLookDelta is pixel-accurate and already accumulated since
      // the last render frame — do NOT multiply by deltaTime (that introduces
      // frame-rate-dependent stiffness on high-refresh-rate phones).
      const rawX = this.touchState.lastLookDelta.x
      const rawY = this.touchState.lastLookDelta.y
      if (Math.abs(rawX) > 0.5 || Math.abs(rawY) > 0.5) {
        this.cameraManager.updatePlayerCameraFromTouch(rawX, rawY)
        this.touchCameraVelocity.set(rawX, rawY) // save for inertia after lift
      }
      this.touchState.lastLookDelta.set(0, 0)
      if (this.input.analogCamera) this.input.analogCamera.set(0, 0)
    } else {
      // Gamepad path: analog stick is a continuous rate, needs deltaTime scaling
      if (this.input.analogCamera) {
        const cameraX = this.input.analogCamera.x
        const cameraY = this.input.analogCamera.y
        const deadzone = 0.05
        const adjustedX = Math.abs(cameraX) > deadzone ? cameraX : 0
        const adjustedY = Math.abs(cameraY) > deadzone ? cameraY : 0
        if (adjustedX !== 0 || adjustedY !== 0) {
          this.cameraManager.updatePlayerCameraFromGamepad(adjustedX, adjustedY, deltaTime)
        }
      }

      // Touch inertia: continue rotating after finger lifts with exponential decay
      if (this.touchCameraVelocity.lengthSq() > 0.25) {
        this.cameraManager.updatePlayerCameraFromTouch(
          this.touchCameraVelocity.x,
          this.touchCameraVelocity.y,
        )
        this.touchCameraVelocity.multiplyScalar(0.82)
        if (this.touchCameraVelocity.lengthSq() < 0.25) {
          this.touchCameraVelocity.set(0, 0)
        }
      }
    }
  }

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  public setPosition(position: THREE.Vector3): void {
    this.state.position.copy(position)
    this.state.velocity.set(0, 0, 0)
    this.state.isMoving = false
    this.state.isRunning = false
    this.collisionVolume.position.copy(position)
    this.collisionSystem.updatePlayerPosition(position)
    
    // Update mesh position
    const meshPosition = position.clone()
    meshPosition.y -= this.config.height / 2
    this.mesh.position.copy(meshPosition)
    
    // Update debug wireframe
    if (this.debugWireframe) {
      this.debugWireframe.position.copy(position)
    }
    
    // Update camera
    this.cameraManager.setPlayerPosition(position)
    
    logger.debug(LogModule.PLAYER, `Position set to (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`)
  }

  public getPosition(): THREE.Vector3 {
    return this.state.position.clone()
  }

  public getVelocity(): THREE.Vector3 {
    return this.state.velocity.clone()
  }

  public getMesh(): THREE.Mesh {
    return this.mesh
  }

  public getCollisionVolume(): CollisionVolume {
    return this.collisionVolume
  }

  public isOnGround(): boolean {
    return this.state.onGround
  }

  public isMoving(): boolean {
    return this.state.isMoving
  }

  public isRunning(): boolean {
    return this.state.isRunning
  }

  /** Late-bind the dialogue manager so the action button becomes contextual. */
  public setDialogueManager(dm: DialogueManager): void {
    this.dialogueManager = dm
  }

  public setBattleManager(battleManager: BattleSystem): void {
    this.battleManager = battleManager
  }

  public setForcedFacingTarget(target: THREE.Vector3): void {
    this.forcedFacingTarget = target.clone()
  }

  public clearForcedFacingTarget(): void {
    this.forcedFacingTarget = null
  }

  public getConfig(): PlayerConfig {
    return { ...this.config }
  }

  public updateConfig(config: Partial<PlayerConfig>): void {
    this.config = { ...this.config, ...config }
    
    // Update collision volume if dimensions changed
    if ((config.radius !== undefined || config.height !== undefined) && this.collisionVolume?.dimensions) {
      this.collisionVolume.dimensions.set(
        this.config.radius,
        this.config.height,
        0
      )
    }
    
    logger.debug(LogModule.PLAYER, 'Player config updated')
  }

  public setDebugVisible(visible: boolean): void {
    this.isDebugVisible = visible
    if (this.debugWireframe) {
      this.debugWireframe.visible = visible
    }
    logger.debug(LogModule.PLAYER, `Debug wireframe ${visible ? 'shown' : 'hidden'}`)
  }

  public isDebugWireframeVisible(): boolean {
    return this.isDebugVisible
  }

  public setMeshGroundOffset(offset: number): void {
    this.meshGroundOffset = offset
    logger.info(LogModule.PLAYER, `Mesh ground offset set to ${offset.toFixed(3)}`)
  }

  public getMeshGroundOffset(): number {
    return this.meshGroundOffset
  }

  public getStatus(): object {
    return {
      position: this.state.position.toArray(),
      velocity: this.state.velocity.toArray(),
      onGround: this.state.onGround,
      canJump: this.state.canJump,
      isMoving: this.state.isMoving,
      isRunning: this.state.isRunning,
      input: { ...this.input },
      config: this.getConfig()
    }
  }

  public getInputState(): any {
    return {
      forward: this.input.forward,
      backward: this.input.backward,
      left: this.input.left,
      right: this.input.right,
      jump: this.input.jump,
      attack: this.input.attack,
      run: this.input.run,
      camera: this.input.camera,
      mouseX: 0, // Mouse input would need to be tracked separately
      mouseY: 0,
      mouseLeft: false,
      mouseRight: false
    }
  }

  // ============================================================================
  // POSE CYCLING SYSTEM
  // ============================================================================

  /** Pose definitions – each entry maps bone names to Euler rotations (degrees). */
  private static readonly POSE_DEFINITIONS: Array<{
    name: string
    bones: Record<string, { rx?: number, ry?: number, rz?: number }>
  }> = [
    {
      name: 'T-Pose',
      bones: {
        'DEF-upper_arm.L': { rz: 0, rx: 0, ry: 0 },
        'DEF-upper_arm.R': { rz: 0, rx: 0, ry: 0 },
        'DEF-forearm.L':   { rz: 0, rx: 0, ry: 0 },
        'DEF-forearm.R':   { rz: 0, rx: 0, ry: 0 },
        'DEF-thigh.L':     { rx: 0, ry: 0, rz: 0 },
        'DEF-thigh.R':     { rx: 0, ry: 0, rz: 0 },
        'DEF-shin.L':      { rx: 0 },
        'DEF-shin.R':      { rx: 0 },
        'DEF-spine.003':   { rx: 0 },
        'DEF-spine.006':   { rx: 0 },
      }
    },
    {
      name: 'Arms Up',
      bones: {
        'DEF-upper_arm.L': { rz: 60, rx: -45 },
        'DEF-upper_arm.R': { rz: -60, rx: -45 },
        'DEF-forearm.L':   { rx: -30 },
        'DEF-forearm.R':   { rx: -30 },
        'DEF-spine.003':   { rx: -10 },
        'DEF-spine.006':   { rx: -15 },
      }
    },
    {
      name: 'Hands on Hips',
      bones: {
        'DEF-upper_arm.L': { rz: 35, rx: 20, ry: -30 },
        'DEF-upper_arm.R': { rz: -35, rx: 20, ry: 30 },
        'DEF-forearm.L':   { rx: -80, ry: 15 },
        'DEF-forearm.R':   { rx: -80, ry: -15 },
        'DEF-spine.003':   { rx: 5 },
      }
    },
    {
      name: 'Sitting',
      bones: {
        'DEF-thigh.L':     { rx: -90 },
        'DEF-thigh.R':     { rx: -90 },
        'DEF-shin.L':      { rx: 90 },
        'DEF-shin.R':      { rx: 90 },
        'DEF-upper_arm.L': { rz: 20, rx: -30 },
        'DEF-upper_arm.R': { rz: -20, rx: -30 },
        'DEF-forearm.L':   { rx: -50 },
        'DEF-forearm.R':   { rx: -50 },
      }
    },
    {
      name: 'Wave',
      bones: {
        'DEF-upper_arm.R': { rz: -80, rx: -60 },
        'DEF-forearm.R':   { rx: -90 },
        'DEF-hand.R':      { rz: -20 },
        'DEF-upper_arm.L': { rz: 15 },
        'DEF-spine.003':   { rx: -5 },
        'DEF-spine.006':   { rx: -10, ry: -5 },
      }
    },
    {
      name: 'Fighter',
      bones: {
        'DEF-upper_arm.L': { rz: 50, rx: -40, ry: -20 },
        'DEF-upper_arm.R': { rz: -45, rx: -50, ry: 20 },
        'DEF-forearm.L':   { rx: -110 },
        'DEF-forearm.R':   { rx: -100 },
        'DEF-thigh.L':     { rx: -15, rz: 10 },
        'DEF-thigh.R':     { rx: -10, rz: -15 },
        'DEF-shin.L':      { rx: 20 },
        'DEF-shin.R':      { rx: 15 },
        'DEF-spine.003':   { rx: -10, ry: 15 },
        'DEF-spine.006':   { rx: -5 },
      }
    },
    {
      name: 'Crouch',
      bones: {
        'DEF-thigh.L':     { rx: -60, rz: 15 },
        'DEF-thigh.R':     { rx: -60, rz: -15 },
        'DEF-shin.L':      { rx: 100 },
        'DEF-shin.R':      { rx: 100 },
        'DEF-spine.001':   { rx: 20 },
        'DEF-spine.003':   { rx: 15 },
        'DEF-upper_arm.L': { rz: 25, rx: -20 },
        'DEF-upper_arm.R': { rz: -25, rx: -20 },
        'DEF-forearm.L':   { rx: -40 },
        'DEF-forearm.R':   { rx: -40 },
      }
    },
  ]

  /**
   * Store the rest-pose quaternion of every bone so we can revert later.
   */
  private initializePoses(): void {
    if (this.posesInitialized || !this.mesh) return

    this.mesh.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        this.restPoseQuaternions.set(child.name, child.quaternion.clone())
      }
    })

    if (this.restPoseQuaternions.size > 0) {
      this.posesInitialized = true
      logger.info(LogModule.PLAYER, `Pose system initialised – ${this.restPoseQuaternions.size} bones cached`)
    }
  }

  /**
   * Apply a pose by index, or revert to rest pose when index === -1.
   */
  private applyPose(index: number): void {
    if (!this.posesInitialized) this.initializePoses()
    if (!this.posesInitialized) return // still no bones

    // First restore every bone to its rest quaternion
    this.mesh.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        const rest = this.restPoseQuaternions.get(child.name)
        if (rest) child.quaternion.copy(rest)
      }
    })

    if (index < 0 || index >= PlayerController.POSE_DEFINITIONS.length) return // rest pose

    const poseDef = PlayerController.POSE_DEFINITIONS[index]
    const DEG2RAD = Math.PI / 180

    this.mesh.traverse((child) => {
      if ((child as THREE.Bone).isBone && poseDef.bones[child.name]) {
        const override = poseDef.bones[child.name]
        const euler = new THREE.Euler(
          (override.rx ?? 0) * DEG2RAD,
          (override.ry ?? 0) * DEG2RAD,
          (override.rz ?? 0) * DEG2RAD,
          'XYZ'
        )
        // Compose: rest * override
        const rest = this.restPoseQuaternions.get(child.name)!
        const overrideQuat = new THREE.Quaternion().setFromEuler(euler)
        child.quaternion.copy(rest).multiply(overrideQuat)
      }
    })
  }

  /**
   * Cycle to the next pose. Wraps back to rest pose after the last named pose.
   */
  public cyclePose(): string {
    if (!this.posesInitialized) this.initializePoses()

    this.currentPoseIndex++
    if (this.currentPoseIndex >= PlayerController.POSE_DEFINITIONS.length) {
      this.currentPoseIndex = -1 // back to rest
    }

    this.applyPose(this.currentPoseIndex)

    const name = this.currentPoseIndex >= 0
      ? PlayerController.POSE_DEFINITIONS[this.currentPoseIndex].name
      : 'Rest Pose'

    logger.info(LogModule.PLAYER, `Pose: ${name}`)
    return name
  }

  /**
   * Get the name of the currently active pose.
   */
  public getCurrentPoseName(): string {
    if (this.currentPoseIndex < 0) return 'Rest Pose'
    return PlayerController.POSE_DEFINITIONS[this.currentPoseIndex].name
  }

  public setVirtualJumpPressed(pressed: boolean): void {
    this.virtualJumpPressed = pressed
    traceInputCommand({ source: 'touch', target: 'player', command: 'virtual-confirm', result: pressed ? 'received' : 'released' })
    this.updateInputState()
  }

  public setVirtualAttackPressed(pressed: boolean): void {
    this.virtualAttackPressed = pressed
    traceInputCommand({ source: 'touch', target: 'player', command: 'virtual-attack', result: pressed ? 'received' : 'released' })
    this.updateInputState()
  }

  private getConfirmInputSource(): InputTraceSource {
    if (this.virtualJumpPressed) return 'touch'
    if (this.keyStates.get('KeyJ') || this.keyStates.get('Enter') || this.keyStates.get('NumpadEnter')) return 'keyboard'
    if (this.gamepadInput.jump) return 'gamepad'
    return 'system'
  }

  private getAttackInputSource(): InputTraceSource {
    if (this.virtualAttackPressed) return 'touch'
    if (this.keyStates.get('KeyK')) return 'keyboard'
    if (this.gamepadInput.action) return 'gamepad'
    return 'system'
  }

  public isRangedModeEnabled(): boolean {
    return false
  }

  public setRangedModeEnabled(_enabled: boolean): void {
    // Ranged mode toggle — currently a stub
  }

  public triggerFleeFromCurrentTarget(): void {
    // Flee action — currently a stub
  }

  public triggerGrabCurrentTarget(): void {
    // Grab action — currently a stub
  }

  public dispose(): void {
    // Remove from collision system
    this.collisionSystem.unregisterObject('player')
    
    // Remove from scene
    this.scene.remove(this.mesh)
    if (this.debugWireframe) {
      this.scene.remove(this.debugWireframe)
    }
    
    // Remove event listeners
    document.removeEventListener('keydown', this.boundKeyDown)
    document.removeEventListener('keyup', this.boundKeyUp)
    
    // Dispose geometries and materials
    this.mesh.geometry.dispose()
    if (Array.isArray(this.mesh.material)) {
      this.mesh.material.forEach(mat => mat.dispose())
    } else {
      this.mesh.material.dispose()
    }
    
    logger.info(LogModule.PLAYER, 'PlayerController disposed')
  }
} 