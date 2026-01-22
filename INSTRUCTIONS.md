# Three.js Boilerplate - Instructions & Controls

## 🎮 Welcome to Three.js Boilerplate

### Current Mode: System Camera
- **Mouse drag** = Rotate camera
- **Scroll** = Zoom in/out

### To Enable WASD Movement:
- Press **C** to switch to Player Camera
- Click on the canvas to enable mouse look
- Use **WASD** to move, **Space** to jump

### Other Controls:
- **F12** = Open browser console
- **#debug** in URL = Enable debug mode
- **help()** in console = Show all commands

## 🚀 Three.js Garden with Ocean - Advanced Shader Showcase

### 🎮 Controls:
- **Mouse/Touch**: Rotate camera
- **Wheel/Pinch**: Zoom camera
- **Click objects**: Highlight animation & identification
- **Space**: Toggle animations
- **Ctrl/Cmd + D**: Toggle debug mode
- **P**: Print performance stats

### 🔧 Console Commands:

All console commands are now organized in a dedicated ConsoleCommands module!
Type `help()` in the console to see the complete list of available commands.

Key commands include:
- `help()`: Show all available commands
- `listObjects()`: List all managed objects
- `debugObject(id)`: Debug specific object
- `moveObject(id, x, y, z)`: Move object to position
- `showSystemStatus()`: Complete system overview
- `migrateToObjectManager()`: Migrate unmanaged objects

### 💾 Persistent Positions & Locking:
- ObjectManager automatically saves object states to localStorage
- Positions, rotations, scales, and lock states persist across page refreshes
- Use ObjectManager commands for the best experience with managed objects

### 🎨 Unique Shader Materials:
- **LEFT PLANE**: Enhanced Wave Shader with multi-frequency waves and complex color mixing
- **BOX**: Noise/Fire Shader with multi-frequency waves and complex color mixing
- **SPHERE**: Spiral/Ocean Shader with twisting geometry and ocean-like shimmer effects
- **CONE**: Pulse/Plasma Shader with electric pulsing and arc lighting effects
- **CYLINDER**: Crystal Shader with faceted geometry and golden amber crystalline effects
- **ICOSAHEDRON**: Holographic Shader with iridescent colors and scanning line effects

### 🌊 Ocean LOD System:
- 3-Level LOD system for infinite ocean rendering
- Realistic water with waves, foam, reflections, and caustics
- Dynamic wind simulation and wave amplitude control
- Global sun shadow casting and receiving on water surface
- Performance-optimized with distance-based LOD switching

### 🐛 Debug Mode:
- Add `#debug` to URL or press **Ctrl/Cmd + D**
- Shows: Stats monitor, GUI controls for all shader parameters
- Ocean controls: Wave amplitude, wind direction/strength, water colors, shadow casting
- Land controls: Terrain generation, volcanic island parameters, shadow receiving
- Shadow system: Global sun shadows on Land and Ocean materials
- LOD info: Real-time visible level count
- Remove `#debug` to hide all debug elements

### ✨ Features Demonstrated:
- TypeScript type safety & advanced patterns
- Modular shader architecture with unique effects per mesh
- LOD-based infinite ocean with realistic water simulation
- Custom GLSL vertex and fragment shaders for water
- Real-time uniform updates and animations
- Advanced material effects (water, waves, foam, reflections)
- Responsive device detection & controls
- Comprehensive debug system with ocean parameter control

### 🌿 Garden by the Sea
Each mesh has unique identity + infinite ocean horizon!
Fly around to see the LOD system in action!

## Player Movement Controls

### Player Camera Mode:
- **WASD**: Move forward/left/backward/right
- **Mouse**: Look around (requires clicking on canvas first)
- **Space**: Jump
- **Shift**: Run (increased speed)
- **C**: Switch back to system camera

### Collision System:
- Player automatically collides with land meshes
- Ocean meshes are excluded from collision detection
- Gravity pulls player down when not on solid ground
- Collision detection uses capsule geometry for smooth movement

### Debug Commands:
- `testCollisionAtPlayerPosition()`: Test collision at current player position
- `testCollisionAt(x, y, z)`: Test collision at specific position
- `testCollisionAtPlayer()`: Test collision at player's current position
- `testCollisionAtOrigin()`: Test collision at origin (0, 10, 0) where main terrain should be
- `testCollisionPerformance()`: Test collision system performance with 100 random checks
- `testPlayerMovement()`: Test player movement and collision detection
- `setPlayerPosition(x, y, z)`: Teleport player to specific coordinates
- `getPlayerStatus()`: Get current player status and position
- `togglePlayerDebug()`: Show/hide player collision wireframe

### Logging Control:
- `enableCollisionLogging()`: Enable collision debug logs (disabled by default)
- `disableCollisionLogging()`: Disable collision debug logs
- `enableAllLogging()`: Enable all debug logging
- `disableAllLogging()`: Disable all debug logging
- `getLoggingConfig()`: Show current logging configuration

## Performance Monitoring

The app includes a comprehensive performance monitoring system:
- Frame rate tracking
- Collision check timing
- Render timing
- Memory usage monitoring
- Performance statistics available via console commands

## Development Features

### Logging System:
- Centralized logging with different levels (ERROR, WARN, INFO, DEBUG)
- Module-based filtering (SYSTEM, PLAYER, CAMERA, COLLISION, etc.)
- Development mode with enhanced logging
- Console commands for log management

### Debug GUI System:
- Centralized debug controls organized in panels
- Main system controls
- Environment controls (sky, lighting)
- Performance monitoring
- Player controls
- Real-time parameter adjustment

### Object Management:
- Unified object management system
- Persistent state saving/loading
- Position locking capabilities
- Automatic cleanup and disposal
- Scene organization and optimization 