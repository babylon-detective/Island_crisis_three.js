# Third Person Camera System

## Overview

The game now features a dynamic 3rd person camera system with multiple perspective views, replacing the previous first-person-only view. This provides players with various strategic viewpoints and enhances gameplay experience.

## Camera Modes

### System Camera
- Free-flight camera for debugging and scene observation
- Controlled with mouse drag and scroll
- Press **C** to switch to/from player camera

### Player Camera (Default)
- Third person perspective following the player
- Multiple view modes available
- Player character is always visible
- Mouse look controls camera rotation

## Third Person Views

### 1. **Shoulder View** (Default)
- **Position**: Over the right shoulder
- **Player Visibility**: Player model visible in lower left corner
- **FOV**: 70°
- **Use Case**: Close-quarters combat, precision aiming
- **Offset**: Right 1.2m, Up 1.5m, Back 3.5m

### 2. **Overhead View**
- **Position**: High tactical view
- **Player Visibility**: Top-down perspective
- **FOV**: 60°
- **Use Case**: Strategic planning, situational awareness
- **Offset**: Up 12m, Back 8m

### 3. **Far View**
- **Position**: Classic third person, centered behind player
- **FOV**: 75°
- **Use Case**: General exploration, platforming
- **Offset**: Up 3m, Back 8m

### 4. **Cinematic View**
- **Position**: Dramatic left-side angle
- **Player Visibility**: Left side, elevated
- **FOV**: 65°
- **Use Case**: Dramatic gameplay, artistic view
- **Offset**: Left 2.5m, Up 2.5m, Back 5m

## Controls

| Key | Action |
|-----|--------|
| **C** | Switch between System and Player cameras |
| **V** | Cycle through third person views (Shoulder → Overhead → Far → Cinematic) |
| **Mouse** | Look around (rotate camera) |
| **WASD** | Move player |
| **Shift** | Sprint |
| **Space** | Jump |

## Player Model

The player character is now fully visible in third person views:

- **Body**: Blue cylinder (torso)
- **Head**: Skin-toned sphere at top
- **Face**: Two eye markers indicating forward direction
- **Rotation**: Character faces the camera direction
- **Shadows**: Casts and receives shadows for depth perception

## Technical Implementation

### CameraManager Enhancements

```typescript
// New camera view types
export type ThirdPersonView = 'shoulder' | 'overhead' | 'far' | 'cinematic'

// Camera offset configuration
interface ThirdPersonCameraOffset {
  position: THREE.Vector3       // Offset from player
  lookAtOffset: THREE.Vector3   // Look-at target offset
  smoothing: number             // Camera smoothing factor
  fov: number                   // Field of view
}
```

### Key Methods

- `setThirdPersonView(view)` - Switch to specific view
- `cycleThirdPersonView()` - Cycle to next view
- `registerPlayerMesh(mesh)` - Register player model for visibility control
- `getCurrentThirdPersonView()` - Get active view mode

### Smooth Transitions

All camera movements use interpolation for smooth transitions:
- Position lerping for camera offset
- FOV transitions when changing views
- Rotation smoothing for player model

## On-Screen Indicators

### Camera Mode Indicator
- **Location**: Top-right corner
- **Green Background**: Player camera active
- **Black Background**: System camera active
- **Text**: Shows current camera mode and view

Example: `Player Camera: SHOULDER`

### Temporary Messages
- Brief notifications when switching views
- Duration: 2-3 seconds
- Location: Top-center of screen

## Gameplay Strategies by View

### Shoulder View
- **Best For**: Combat, aiming, close encounters
- **Visibility**: Clear view of what's directly ahead
- **Advantage**: Player head visible shows your position clearly

### Overhead View
- **Best For**: Tactical planning, maze navigation
- **Visibility**: Wide area view, see surroundings
- **Advantage**: Strategic positioning, avoiding ambushes

### Far View
- **Best For**: General exploration, platforming
- **Visibility**: Balanced view of player and environment
- **Advantage**: Classic third-person experience

### Cinematic View
- **Best For**: Scenic exploration, screenshots
- **Visibility**: Dramatic angle of player
- **Advantage**: Beautiful perspective for exploration

## Developer Notes

### Camera Offset Calculation
```typescript
// Offset is relative to player rotation
const playerRotation = cameraManager.getPlayerControls().yaw
const rotationMatrix = new Matrix4().makeRotationY(playerRotation)
targetOffset.copy(offsetConfig.position).applyMatrix4(rotationMatrix)
```

### Player Mesh Visibility
- Player mesh is always shown in player camera mode
- Hidden in system camera mode (not implemented yet - future feature)
- Mesh rotates to face camera direction

### Collision Considerations
- Camera doesn't collide with terrain (potential future feature)
- Player collision works independent of camera view
- All views maintain same collision detection

## Future Enhancements

Potential additions:
- [ ] Camera collision to prevent clipping through walls
- [ ] Customizable camera offsets per view
- [ ] Save preferred camera view in settings
- [ ] Dynamic FOV adjustment based on speed
- [ ] First-person view option (remove player mesh)
- [ ] Camera shake effects for impacts
- [ ] Zoom in/out controls
- [ ] Lock-on targeting camera

## Troubleshooting

### Camera feels sluggish
- Adjust `smoothing` value in camera offset configuration
- Lower values = faster camera, higher values = smoother

### Can't see player
- Make sure you're in player camera mode (not system)
- Press V to cycle views if player is off-screen
- Check if player mesh is hidden (debug mode)

### Mouse look not working
- Click on the canvas to capture pointer lock
- Pointer lock auto-requests in player mode
- Check browser console for pointer lock errors

---

**Created**: December 2025  
**Version**: 1.0  
**Status**: Fully Implemented
