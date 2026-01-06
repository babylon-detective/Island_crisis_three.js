// @ts-nocheck
import * as THREE from 'three'

// Advanced TypeScript: String literal types for input events
type InputEventType = 
  | 'pointerdown' | 'pointerup' | 'pointermove' 
  | 'keydown' | 'keyup' 
  | 'wheel' 
  | 'touchstart' | 'touchmove' | 'touchend'
  | 'gesturestart' | 'gesturechange' | 'gestureend'
  | 'gamepad'

// Xbox controller button mapping
interface GamepadState {
  buttons: {
    a: boolean          // 0 - Jump
    b: boolean          // 1 - Run/Sprint
    x: boolean          // 2 - Action
    y: boolean          // 3 - Camera mode
    lb: boolean         // 4 - Left bumper
    rb: boolean         // 5 - Right bumper
    lt: number          // 6 - Left trigger (0-1)
    rt: number          // 7 - Right trigger (0-1)
    select: boolean     // 8 - Select/Back
    start: boolean      // 9 - Start/Menu
    ls: boolean         // 10 - Left stick click
    rs: boolean         // 11 - Right stick click
    dpadUp: boolean     // 12 - D-pad up
    dpadDown: boolean   // 13 - D-pad down
    dpadLeft: boolean   // 14 - D-pad left
    dpadRight: boolean  // 15 - D-pad right
  }
  axes: {
    leftStickX: number    // 0 - Left stick horizontal (-1 to 1)
    leftStickY: number    // 1 - Left stick vertical (-1 to 1)
    rightStickX: number   // 2 - Right stick horizontal (-1 to 1)
    rightStickY: number   // 3 - Right stick vertical (-1 to 1)
  }
  connected: boolean
  index: number
  id: string
}

// Discriminated union for different input events
type InputEvent = 
  | { type: 'pointer'; event: PointerEvent; position: THREE.Vector2 }
  | { type: 'key'; event: KeyboardEvent; key: string; code: string }
  | { type: 'wheel'; event: WheelEvent; delta: number }
  | { type: 'touch'; event: TouchEvent; touches: TouchPoint[] }
  | { type: 'gesture'; event: any; scale: number; rotation: number }
  | { type: 'gamepad'; gamepad: GamepadState }

// Touch point interface
interface TouchPoint {
  id: number
  position: THREE.Vector2
  pressure: number
  radiusX: number
  radiusY: number
}

// Input state interface
interface InputState {
  pointers: Map<number, THREE.Vector2>
  keys: Set<string>
  wheelDelta: number
  touches: Map<number, TouchPoint>
  gesture: {
    scale: number
    rotation: number
    active: boolean
  }
  gamepad: GamepadState | null
}

// Device capability detection
interface DeviceCapabilities {
  hasTouch: boolean
  hasPointer: boolean
  hasKeyboard: boolean
  hasMouse: boolean
  hasGamepad: boolean
  maxTouchPoints: number
  isAppleDevice: boolean
}

// Input handler interface - allows for dependency injection pattern
interface InputHandler {
  handleInput(event: InputEvent, state: Readonly<InputState>): void
  priority: number
  active: boolean
}

// Abstract base class for input handlers
abstract class BaseInputHandler implements InputHandler {
  public abstract priority: number
  public active: boolean = true

  public abstract handleInput(event: InputEvent, state: Readonly<InputState>): void

  // Helper method for coordinate transformation
  protected screenToNormalized(position: THREE.Vector2, canvas: HTMLCanvasElement): THREE.Vector2 {
    return new THREE.Vector2(
      (position.x / canvas.clientWidth) * 2 - 1,
      -(position.y / canvas.clientHeight) * 2 + 1
    )
  }

  // Helper for raycasting
  protected raycast(
    normalizedPosition: THREE.Vector2, 
    camera: THREE.Camera, 
    objects: THREE.Object3D[]
  ): THREE.Intersection[] {
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(normalizedPosition, camera)
    return raycaster.intersectObjects(objects, true)
  }
}

// Camera control handler with device-specific behavior
class CameraControlHandler extends BaseInputHandler {
  public priority = 10

  private isDragging = false
  private lastPointerPosition = new THREE.Vector2()
  private cameraDistance = 5
  private spherical = new THREE.Spherical()

  constructor(
    private camera: THREE.Camera,
    private target: THREE.Vector3 = new THREE.Vector3(),
    private capabilities: DeviceCapabilities
  ) {
    super()
    this.spherical.setFromVector3(this.camera.position.clone().sub(this.target))
  }

  public handleInput(event: InputEvent, state: Readonly<InputState>): void {
    switch (event.type) {
      case 'pointer':
        this.handlePointerInput(event, state)
        break
      case 'touch':
        this.handleTouchInput(event, state)
        break
      case 'wheel':
        this.handleWheelInput(event, state)
        break
      case 'key':
        this.handleKeyInput(event, state)
        break
    }
  }

  private handlePointerInput(event: InputEvent & { type: 'pointer' }, state: Readonly<InputState>): void {
    const { event: pointerEvent, position } = event

    switch (pointerEvent.type) {
      case 'pointerdown':
        this.isDragging = true
        this.lastPointerPosition.copy(position)
        break

      case 'pointermove':
        if (this.isDragging) {
          const deltaX = position.x - this.lastPointerPosition.x
          const deltaY = position.y - this.lastPointerPosition.y

          // Adjust sensitivity based on device
          const sensitivity = this.capabilities.hasTouch ? 0.01 : 0.005

          this.spherical.theta -= deltaX * sensitivity
          this.spherical.phi += deltaY * sensitivity

          // Clamp phi to prevent camera flipping
          this.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.spherical.phi))

          this.updateCameraPosition()
          this.lastPointerPosition.copy(position)
        }
        break

      case 'pointerup':
        this.isDragging = false
        break
    }
  }

  private handleTouchInput(event: InputEvent & { type: 'touch' }, state: Readonly<InputState>): void {
    const { touches } = event

    if (touches.length === 1) {
      // Single touch - rotation
      const touch = touches[0]
      if (this.lastPointerPosition) {
        const deltaX = touch.position.x - this.lastPointerPosition.x
        const deltaY = touch.position.y - this.lastPointerPosition.y

        this.spherical.theta -= deltaX * 0.01
        this.spherical.phi += deltaY * 0.01
        this.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.spherical.phi))

        this.updateCameraPosition()
      }
      this.lastPointerPosition.copy(touch.position)

    } else if (touches.length === 2) {
      // Two touches - zoom/pan
      const touch1 = touches[0]
      const touch2 = touches[1]
      const distance = touch1.position.distanceTo(touch2.position)

      // This would need state tracking for proper zoom implementation
      // Simplified for demonstration
      this.spherical.radius = Math.max(1, Math.min(50, this.spherical.radius))
      this.updateCameraPosition()
    }
  }

  private handleWheelInput(event: InputEvent & { type: 'wheel' }, state: Readonly<InputState>): void {
    const zoomSpeed = this.capabilities.hasTouch ? 0.1 : 0.05
    this.spherical.radius += event.delta * zoomSpeed
    this.spherical.radius = Math.max(1, Math.min(50, this.spherical.radius))
    this.updateCameraPosition()
  }

  private handleKeyInput(event: InputEvent & { type: 'key' }, state: Readonly<InputState>): void {
    if (!this.capabilities.hasKeyboard) return

    const moveSpeed = 0.1
    const rotateSpeed = 0.05

    switch (event.key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        this.spherical.phi -= rotateSpeed
        break
      case 's':
      case 'arrowdown':
        this.spherical.phi += rotateSpeed
        break
      case 'a':
      case 'arrowleft':
        this.spherical.theta -= rotateSpeed
        break
      case 'd':
      case 'arrowright':
        this.spherical.theta += rotateSpeed
        break
      case '+':
      case '=':
        this.spherical.radius -= moveSpeed
        break
      case '-':
      case '_':
        this.spherical.radius += moveSpeed
        break
    }

    this.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.spherical.phi))
    this.spherical.radius = Math.max(1, Math.min(50, this.spherical.radius))
    this.updateCameraPosition()
  }

  private updateCameraPosition(): void {
    const position = new THREE.Vector3().setFromSpherical(this.spherical).add(this.target)
    this.camera.position.copy(position)
    this.camera.lookAt(this.target)
  }

  public setTarget(target: THREE.Vector3): void {
    this.target.copy(target)
    this.updateCameraPosition()
  }
}

// Xbox Controller Input Handler
class GamepadInputHandler extends BaseInputHandler {
  public priority = 15 // Higher priority than camera controls

  private deadzone = 0.1
  private previousState: GamepadState | null = null

  constructor(
    private onPlayerInput?: (input: {
      movement: THREE.Vector2
      camera: THREE.Vector2
      jump: boolean
      run: boolean
      action: boolean
      cameraMode: boolean
    }) => void
  ) {
    super()
  }

  public handleInput(event: InputEvent, state: Readonly<InputState>): void {
    if (event.type === 'gamepad') {
      this.handleGamepadInput(event.gamepad)
    }
  }

  private handleGamepadInput(gamepad: GamepadState): void {
    if (!gamepad.connected) return

    // Apply deadzone to stick inputs
    const leftStickX = this.applyDeadzone(gamepad.axes.leftStickX)
    const leftStickY = this.applyDeadzone(-gamepad.axes.leftStickY) // Invert Y for forward/backward
    const rightStickX = this.applyDeadzone(gamepad.axes.rightStickX)
    const rightStickY = this.applyDeadzone(-gamepad.axes.rightStickY) // Invert Y for camera

    // Create movement vector from left stick or D-pad
    const movement = new THREE.Vector2(leftStickX, leftStickY)
    
    // Add D-pad input (digital movement)
    if (gamepad.buttons.dpadLeft) movement.x = -1
    if (gamepad.buttons.dpadRight) movement.x = 1
    if (gamepad.buttons.dpadUp) movement.y = 1
    if (gamepad.buttons.dpadDown) movement.y = -1

    // Camera control from right stick
    const camera = new THREE.Vector2(rightStickX, rightStickY)

    // Button states
    const jump = gamepad.buttons.a
    const run = gamepad.buttons.b || gamepad.rt > 0.5 // B button or right trigger
    const action = gamepad.buttons.x
    const cameraMode = this.wasButtonPressed('rs', gamepad) // Right stick button (R3) for camera mode toggle
    const menu = this.wasButtonPressed('start', gamepad) // Start button for menu/pause

    // Send processed input to player controller
    if (this.onPlayerInput) {
      this.onPlayerInput({
        movement,
        camera,
        jump,
        run,
        action,
        cameraMode,
        menu
      })
    }

    this.previousState = { ...gamepad }
  }

  private applyDeadzone(value: number): number {
    return Math.abs(value) < this.deadzone ? 0 : value
  }

  private wasButtonPressed(button: keyof GamepadState['buttons'], currentState: GamepadState): boolean {
    const current = currentState.buttons[button]
    const previous = this.previousState?.buttons[button] || false
    return current && !previous
  }

  public setDeadzone(deadzone: number): void {
    this.deadzone = Math.max(0, Math.min(1, deadzone))
  }
}

// Object interaction handler
class ObjectInteractionHandler extends BaseInputHandler {
  public priority = 5

  constructor(
    private camera: THREE.Camera,
    private scene: THREE.Scene,
    private canvas: HTMLCanvasElement,
    private onObjectClick?: (object: THREE.Object3D, point: THREE.Vector3) => void,
    private onObjectHover?: (object: THREE.Object3D | null) => void
  ) {
    super()
  }

  public handleInput(event: InputEvent, state: Readonly<InputState>): void {
    switch (event.type) {
      case 'pointer':
        if (event.event.type === 'pointerdown') {
          this.handleObjectClick(event.position)
        } else if (event.event.type === 'pointermove') {
          this.handleObjectHover(event.position)
        }
        break
      case 'touch':
        if (event.touches.length === 1) {
          this.handleObjectClick(event.touches[0].position)
        }
        break
    }
  }

  private handleObjectClick(position: THREE.Vector2): void {
    const normalizedPosition = this.screenToNormalized(position, this.canvas)
    const intersections = this.raycast(normalizedPosition, this.camera, [this.scene])

    if (intersections.length > 0) {
      const intersection = intersections[0]
      this.onObjectClick?.(intersection.object, intersection.point)
    }
  }

  private handleObjectHover(position: THREE.Vector2): void {
    const normalizedPosition = this.screenToNormalized(position, this.canvas)
    const intersections = this.raycast(normalizedPosition, this.camera, [this.scene])

    const hoveredObject = intersections.length > 0 ? intersections[0].object : null
    this.onObjectHover?.(hoveredObject)
  }
}

// Main Input System class
export class InputSystem {
  private canvas: HTMLCanvasElement
  private handlers: Set<InputHandler> = new Set()
  private state: InputState = {
    pointers: new Map(),
    keys: new Set(),
    wheelDelta: 0,
    touches: new Map(),
    gesture: { scale: 1, rotation: 0, active: false },
    gamepad: null
  }
  private capabilities: DeviceCapabilities
  private boundEventListeners: Map<string, EventListener> = new Map()
  private gamepadPollingInterval: number | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.capabilities = this.detectCapabilities()
    this.setupEventListeners()
    
    // Start gamepad polling if supported
    if (this.capabilities.hasGamepad) {
      this.startGamepadPolling()
    }
  }

  private detectCapabilities(): DeviceCapabilities {
    const nav = navigator as any
    
    return {
      hasTouch: 'ontouchstart' in window,
      hasPointer: 'onpointerdown' in window,
      hasKeyboard: window.matchMedia('(hover: hover)').matches,
      hasMouse: window.matchMedia('(pointer: fine)').matches,
      hasGamepad: 'getGamepads' in navigator,
      maxTouchPoints: nav.maxTouchPoints || 0,
      isAppleDevice: /iPad|iPhone|iPod|Mac/.test(navigator.userAgent)
    }
  }

  private startGamepadPolling(): void {
    // Poll gamepad state at 60fps
    this.gamepadPollingInterval = window.setInterval(() => {
      this.pollGamepads()
    }, 16) // ~60fps
  }

  private pollGamepads(): void {
    const gamepads = navigator.getGamepads()
    
    // Find the first connected gamepad (typically Xbox controller)
    for (let i = 0; i < gamepads.length; i++) {
      const gamepad = gamepads[i]
      if (gamepad && gamepad.connected) {
        const gamepadState = this.parseGamepadState(gamepad)
        
        // Update state
        this.state.gamepad = gamepadState
        
        // Dispatch gamepad event
        const inputEvent: InputEvent = {
          type: 'gamepad',
          gamepad: gamepadState
        }
        
        this.dispatchToHandlers(inputEvent)
        break // Use first connected gamepad only
      }
    }
    
    // If no gamepad found, clear state
    if (!this.state.gamepad?.connected) {
      this.state.gamepad = null
    }
  }

  private parseGamepadState(gamepad: Gamepad): GamepadState {
    return {
      buttons: {
        a: gamepad.buttons[0]?.pressed || false,
        b: gamepad.buttons[1]?.pressed || false,
        x: gamepad.buttons[2]?.pressed || false,
        y: gamepad.buttons[3]?.pressed || false,
        lb: gamepad.buttons[4]?.pressed || false,
        rb: gamepad.buttons[5]?.pressed || false,
        lt: gamepad.buttons[6]?.value || 0,
        rt: gamepad.buttons[7]?.value || 0,
        select: gamepad.buttons[8]?.pressed || false,
        start: gamepad.buttons[9]?.pressed || false,
        ls: gamepad.buttons[10]?.pressed || false,
        rs: gamepad.buttons[11]?.pressed || false,
        dpadUp: gamepad.buttons[12]?.pressed || false,
        dpadDown: gamepad.buttons[13]?.pressed || false,
        dpadLeft: gamepad.buttons[14]?.pressed || false,
        dpadRight: gamepad.buttons[15]?.pressed || false,
      },
      axes: {
        leftStickX: gamepad.axes[0] || 0,
        leftStickY: gamepad.axes[1] || 0,
        rightStickX: gamepad.axes[2] || 0,
        rightStickY: gamepad.axes[3] || 0,
      },
      connected: gamepad.connected,
      index: gamepad.index,
      id: gamepad.id
    }
  }

  private setupEventListeners(): void {
    // Modern pointer events (preferred)
    if (this.capabilities.hasPointer) {
      this.addEventListeners([
        'pointerdown', 'pointerup', 'pointermove', 'pointercancel'
      ], this.handlePointerEvent.bind(this))
    }

    // Touch events (fallback)
    if (this.capabilities.hasTouch) {
      this.addEventListeners([
        'touchstart', 'touchmove', 'touchend', 'touchcancel'
      ], this.handleTouchEvent.bind(this))

      // iOS gesture events
      if (this.capabilities.isAppleDevice) {
        this.addEventListeners([
          'gesturestart', 'gesturechange', 'gestureend'
        ], this.handleGestureEvent.bind(this))
      }
    }

    // Wheel events
    this.addEventListeners(['wheel'], this.handleWheelEvent.bind(this))

    // Keyboard events (on window)
    if (this.capabilities.hasKeyboard) {
      const keydownListener = this.handleKeyEvent.bind(this)
      const keyupListener = this.handleKeyEvent.bind(this)
      
      window.addEventListener('keydown', keydownListener)
      window.addEventListener('keyup', keyupListener)
      
      this.boundEventListeners.set('keydown', keydownListener)
      this.boundEventListeners.set('keyup', keyupListener)
    }

    // Prevent context menu on canvas
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private addEventListeners(events: string[], handler: EventListener): void {
    events.forEach(eventType => {
      this.canvas.addEventListener(eventType, handler, { passive: false })
      this.boundEventListeners.set(eventType, handler)
    })
  }

  private handlePointerEvent(event: PointerEvent): void {
    event.preventDefault()

    const position = new THREE.Vector2(
      event.clientX - this.canvas.offsetLeft,
      event.clientY - this.canvas.offsetTop
    )

    // Update state
    if (event.type === 'pointerdown' || event.type === 'pointermove') {
      this.state.pointers.set(event.pointerId, position)
    } else if (event.type === 'pointerup' || event.type === 'pointercancel') {
      this.state.pointers.delete(event.pointerId)
    }

    // Dispatch to handlers
    const inputEvent: InputEvent = {
      type: 'pointer',
      event,
      position
    }

    this.dispatchToHandlers(inputEvent)
  }

  private handleTouchEvent(event: TouchEvent): void {
    event.preventDefault()

    const touches: TouchPoint[] = Array.from(event.touches).map(touch => ({
      id: touch.identifier,
      position: new THREE.Vector2(
        touch.clientX - this.canvas.offsetLeft,
        touch.clientY - this.canvas.offsetTop
      ),
      pressure: touch.force || 1,
      radiusX: touch.radiusX || 1,
      radiusY: touch.radiusY || 1
    }))

    // Update state
    this.state.touches.clear()
    touches.forEach(touch => {
      this.state.touches.set(touch.id, touch)
    })

    // Dispatch to handlers
    const inputEvent: InputEvent = {
      type: 'touch',
      event,
      touches
    }

    this.dispatchToHandlers(inputEvent)
  }

  private handleWheelEvent(event: WheelEvent): void {
    event.preventDefault()

    // Normalize wheel delta across browsers
    let delta = event.deltaY
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      delta *= 16
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      delta *= 400
    }

    this.state.wheelDelta = delta

    // Dispatch to handlers
    const inputEvent: InputEvent = {
      type: 'wheel',
      event,
      delta: delta * 0.01 // Normalize
    }

    this.dispatchToHandlers(inputEvent)
  }

  private handleKeyEvent(event: KeyboardEvent): void {
    // Update state
    if (event.type === 'keydown') {
      this.state.keys.add(event.code)
    } else if (event.type === 'keyup') {
      this.state.keys.delete(event.code)
    }

    // Dispatch to handlers
    const inputEvent: InputEvent = {
      type: 'key',
      event,
      key: event.key,
      code: event.code
    }

    this.dispatchToHandlers(inputEvent)
  }

  private handleGestureEvent(event: any): void {
    event.preventDefault()

    // Update state
    this.state.gesture = {
      scale: event.scale || 1,
      rotation: event.rotation || 0,
      active: event.type !== 'gestureend'
    }

    // Dispatch to handlers
    const inputEvent: InputEvent = {
      type: 'gesture',
      event,
      scale: event.scale || 1,
      rotation: event.rotation || 0
    }

    this.dispatchToHandlers(inputEvent)
  }

  private dispatchToHandlers(event: InputEvent): void {
    // Sort handlers by priority (higher first)
    const sortedHandlers = Array.from(this.handlers)
      .filter(handler => handler.active)
      .sort((a, b) => b.priority - a.priority)

    for (const handler of sortedHandlers) {
      try {
        handler.handleInput(event, this.state)
      } catch (error) {
        console.error('Error in input handler:', error)
      }
    }
  }

  // Public API methods
  public addHandler(handler: InputHandler): void {
    this.handlers.add(handler)
  }

  public removeHandler(handler: InputHandler): void {
    this.handlers.delete(handler)
  }

  public createCameraHandler(
    camera: THREE.Camera,
    target?: THREE.Vector3
  ): CameraControlHandler {
    return new CameraControlHandler(camera, target, this.capabilities)
  }

  public createObjectInteractionHandler(
    camera: THREE.Camera,
    scene: THREE.Scene,
    onObjectClick?: (object: THREE.Object3D, point: THREE.Vector3) => void,
    onObjectHover?: (object: THREE.Object3D | null) => void
  ): ObjectInteractionHandler {
    return new ObjectInteractionHandler(
      camera, 
      scene, 
      this.canvas, 
      onObjectClick, 
      onObjectHover
    )
  }

  public createGamepadHandler(
    onPlayerInput?: (input: {
      movement: THREE.Vector2
      camera: THREE.Vector2
      jump: boolean
      run: boolean
      action: boolean
      cameraMode: boolean
      menu: boolean
    }) => void
  ): GamepadInputHandler {
    return new GamepadInputHandler(onPlayerInput)
  }

  public getCapabilities(): Readonly<DeviceCapabilities> {
    return this.capabilities
  }

  public getState(): Readonly<InputState> {
    return this.state
  }

  public isKeyPressed(key: string): boolean {
    return this.state.keys.has(key)
  }

  public getPointerCount(): number {
    return this.state.pointers.size
  }

  public getTouchCount(): number {
    return this.state.touches.size
  }

  public getGamepadState(): GamepadState | null {
    return this.state.gamepad
  }

  public isGamepadConnected(): boolean {
    return this.state.gamepad?.connected || false
  }

  // Cleanup
  public dispose(): void {
    // Stop gamepad polling
    if (this.gamepadPollingInterval) {
      clearInterval(this.gamepadPollingInterval)
      this.gamepadPollingInterval = null
    }

    // Remove all event listeners
    for (const [eventType, listener] of this.boundEventListeners) {
      if (['keydown', 'keyup'].includes(eventType)) {
        window.removeEventListener(eventType, listener)
      } else {
        this.canvas.removeEventListener(eventType, listener)
      }
    }
    
    this.boundEventListeners.clear()
    this.handlers.clear()
  }
}

// Export types and classes
export type {
  InputEvent,
  InputEventType,
  TouchPoint,
  InputState,
  DeviceCapabilities,
  InputHandler,
  GamepadState
}
export {
  BaseInputHandler,
  CameraControlHandler,
  ObjectInteractionHandler,
  GamepadInputHandler
} 