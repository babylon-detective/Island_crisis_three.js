# Camera Manager Configuration Guide

## Overview
The CameraManager now uses a centralized configuration system that makes it easy to customize all camera-related settings in one place.

## Default Configuration

All camera settings are now defined in the `CameraManagerConfig` interface with sensible defaults:

```typescript
const DEFAULT_CAMERA_CONFIG: CameraManagerConfig = {
  // === DEFAULT STATES ===
  defaultMode: 'player',      // 'system' or 'player'
  defaultView: 'overhead',    // 'shoulder', 'overhead', or 'far'
  defaultZoom: 2,             // Default orthographic zoom level
  
  // === SYSTEM CAMERA ===
  systemCamera: {
    fov: 75,                            // Field of view
    position: new THREE.Vector3(0, 2, 10), // Starting position
    targetHeight: 2                      // Orbit control target height
  },
  
  // === PLAYER CONTROLS ===
  playerControls: {
    enabled: true,    // Auto-enable player controls
    sensitivity: 0.002, // Mouse sensitivity
    smoothing: 0.1,   // Camera smoothing factor
    height: 1.8       // Player eye height
  },
  
  // === ORTHOGRAPHIC CAMERA ===
  orthographicCamera: {
    frustumSize: 50,  // Viewing area size (smaller = more zoomed)
    height: 50,       // Camera height above ground
    zoom: 2           // Zoom multiplier (2 = 2x zoom in)
  },
  
  // === SPOTLIGHT ===
  spotlight: {
    enabled: true,        // Enable/disable spotlight
    intensity: 15,        // Light intensity
    angle: Math.PI / 8,   // Cone angle (22.5 degrees)
    penumbra: 0.3,        // Edge softness (0=sharp, 1=very soft)
    decay: 2,             // Light falloff rate
    distance: 80,         // Maximum light distance
    height: 30,           // Height above player
    offset: 5             // Forward offset from player
  },
  
  // === TRANSITIONS ===
  transitionDuration: 1.0,  // Camera switch duration in seconds
  
  // === THIRD PERSON VIEWS ===
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
    },
    far: {
      position: new THREE.Vector3(0, 3, -8),
      lookAtOffset: new THREE.Vector3(0, 1.5, 5),
      smoothing: 0.18,
      fov: 75
    }
  }
}
```

## Usage Examples

### Basic Initialization (Uses All Defaults)
```typescript
const cameraManager = new CameraManager(scene, renderer, container)
```

### Custom Configuration
```typescript
const cameraManager = new CameraManager(scene, renderer, container, {
  // Change default mode and view
  defaultMode: 'player',
  defaultView: 'shoulder',
  defaultZoom: 3,
  
  // Customize spotlight
  spotlight: {
    intensity: 20,
    angle: Math.PI / 6,  // 30 degrees
    height: 40
  },
  
  // Adjust orthographic camera
  orthographicCamera: {
    frustumSize: 40,  // Tighter view
    zoom: 2.5         // More zoomed in
  }
})
```

### Runtime Configuration Updates
```typescript
// Update specific settings at runtime
cameraManager.updateConfig({
  spotlight: {
    intensity: 25,
    height: 35
  }
})

// Get current configuration
const config = cameraManager.getConfig()
console.log('Current zoom:', config.orthographicCamera.zoom)
```

## Key Configuration Areas

### 1. **Default States**
- `defaultMode`: Which camera system starts active
- `defaultView`: Which third-person view is default
- `defaultZoom`: Initial orthographic zoom level

### 2. **Orthographic Camera** (Overhead View)
- `frustumSize`: Controls viewing area (smaller = more zoomed)
- `height`: How high above the ground
- `zoom`: Zoom multiplier (2 = 2x closer)

### 3. **Spotlight** (Overhead View Lighting)
- `enabled`: Turn spotlight on/off
- `intensity`: Brightness (15 = moderate)
- `angle`: Cone width (Math.PI/8 = 22.5°)
- `penumbra`: Edge softness (0.3 = fairly sharp)
- `height`: Distance above player
- `offset`: Forward offset for better visibility

### 4. **Player Controls**
- `sensitivity`: Mouse movement responsiveness
- `smoothing`: Camera movement smoothing
- `height`: Eye level for first-person views

### 5. **Third Person Views**
Each view has:
- `position`: Camera offset from player
- `lookAtOffset`: Where the camera looks
- `smoothing`: Movement smoothing factor
- `fov`: Field of view (perspective only)

## Quick Configuration Guide

### Want a more zoomed-in overhead view?
```typescript
orthographicCamera: {
  zoom: 3  // Increase from default 2
}
```

### Want a brighter spotlight?
```typescript
spotlight: {
  intensity: 25  // Increase from default 15
}
```

### Want spotlight to follow closer?
```typescript
spotlight: {
  height: 20,  // Lower from default 30
  offset: 2    // Reduce from default 5
}
```

### Want to disable spotlight completely?
```typescript
spotlight: {
  enabled: false
}
```

### Want different default camera view?
```typescript
defaultMode: 'player',
defaultView: 'shoulder'  // or 'far'
```

## Variable Locations

All camera variables are now in **ONE PLACE**:
- **File**: `/src/systems/CameraManager.ts`
- **Interface**: `CameraManagerConfig`
- **Default Config**: `DEFAULT_CAMERA_CONFIG` (lines ~30-110)

No more scattered variables! Everything is organized and accessible through the config system.

## Debug GUI Integration

The lil-gui parameters automatically sync with runtime values, but the config provides the initial defaults:

- **Camera → zoom**: Syncs with `orthographicCamera.zoom`
- **Camera → overheadFrustumSize**: Syncs with `orthographicCamera.frustumSize`
- **Camera → shoulderOffset\***: Syncs with `thirdPersonViews.shoulder.position`
- **Camera → farOffset\***: Syncs with `thirdPersonViews.far.position`

## Migration Note

Old code still works! The constructor accepts an optional config parameter, so existing code continues to function with default values:

```typescript
// OLD (still works)
const cameraManager = new CameraManager(scene, renderer, container)

// NEW (with custom config)
const cameraManager = new CameraManager(scene, renderer, container, { 
  defaultZoom: 3 
})
```
