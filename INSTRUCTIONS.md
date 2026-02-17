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

## Character Animation Architecture

The project uses a modular skeletal animation pipeline designed around the
**Quaternius Universal Animation Library** (free GLB animation packs). Each
animation clip lives in its own `.glb` file and is loaded, cached, and
retargeted to any character skeleton at runtime.

### System Overview

```
┌──────────────────────────┐
│   AnimationClipRegistry  │  Central library of available animation sets
│  (singleton)             │  registered at boot time.
└────────────┬─────────────┘
             │ provides AnimationSet
┌────────────▼─────────────┐
│ CharacterAnimationSystem │  Loads GLB clips, creates THREE.AnimationMixer
│  • registerCharacter()   │  per character, handles crossfade transitions,
│  • crossfadeTo()         │  caching, lazy loading, and playback.
│  • update(deltaTime)     │
└────────────┬─────────────┘
             │ driven by
┌────────────▼─────────────┐
│  AnimationStateMachine   │  Finite state machine that maps game state
│  • setParams(…)          │  (speed, grounded, jumping…) to animation
│  • update(deltaTime)     │  clip transitions via priority-sorted rules.
└──────────────────────────┘
```

### Key Files

| File | Purpose |
|---|---|
| `src/systems/CharacterAnimationSystem.ts` | GLB clip loader, mixer management, crossfade API, bone remapping |
| `src/systems/AnimationStateMachine.ts` | FSM with preset configs for player & NPC |
| `src/systems/AnimationBrowser.ts` | In-game overlay to scroll / test all loaded clips |
| `src/systems/AnimationSystem.ts` | Legacy property-tween animations (position, scale, etc.) |
| `config/animation-sets.json` | Declarative clip registry (file → name mapping) |
| `public/models/animations/quaternius/` | Drop GLB / packed animation files here |

### Supported Animation Formats

The system supports two Quaternius distribution formats:

- **Packed** (recommended): A single GLB containing multiple clips (e.g.
  `UAL1_Standard.glb` — 45 clips, 7.7 MB). Use `registry.registerQuaterniusPackedSet()`.
  This is the default.
- **Split**: One GLB per animation clip (e.g. `Idle.glb`, `Walk.glb`).
  Use `registry.registerQuaterniusSet()`.

### Adding Animation Files

1. Download the **Quaternius Universal Animation Library** from
   https://quaternius.com/packs/ultimateanimatedcharacter.html
2. Place `UAL1_Standard.glb` (the packed file) in `public/models/animations/quaternius/`.
3. Restart the dev server — all 45 clips load automatically.
4. Press **`` ` ``** (backtick) in-game to open the **Animation Browser** and
   scroll through every clip.

Alternatively, if you have individual split files:
1. Place `.glb` files in `public/models/animations/quaternius/`.
2. In `main.ts`, switch `registerQuaterniusPackedSet()` to `registerQuaterniusSet()`.
3. See `public/models/animations/quaternius/README.md` for the expected filenames.

### Bone Remapping & Retargeting (UAL ↔ Rigify)

The UAL animations use a **UE-style skeleton** (65 joints: `pelvis`, `spine_01`,
`upperarm_l`, `thigh_r`, etc.). Character models exported from Blender with
**Rigify** use `DEF-` prefixed bones (`DEF-spine`, `DEF-upper_arm.L`, etc.).
The names don't match, so retargeting is required.

The system provides a runtime bone-remap approach:

```ts
import { buildQuaterniusToRigifyRemap } from './systems/CharacterAnimationSystem'

await charAnimSystem.registerCharacter({
  id: 'player',
  model: playerModel,
  animationSetId: 'quaternius-universal',
  boneRemap: buildQuaterniusToRigifyRemap(),  // UAL → Rigify DEF- mapping
})
```

`remapClipBones()` rewrites the Three.js track names (e.g.
`"upperarm_l.quaternion"` → `"DEF-upper_arm.L.quaternion"`) before the
`AnimationMixer` binds them.

**Core mapping (18 bone pairs):**

| UAL (UE-style) | Rigify DEF- |
|---|---|
| `pelvis` | `DEF-spine` |
| `spine_01` / `02` / `03` | `DEF-spine.001` / `.002` / `.003` |
| `neck_01` | `DEF-spine.004` |
| `Head` | `DEF-spine.006` |
| `clavicle_l` / `_r` | `DEF-shoulder.L` / `.R` |
| `upperarm_l` / `_r` | `DEF-upper_arm.L` / `.R` |
| `lowerarm_l` / `_r` | `DEF-forearm.L` / `.R` |
| `hand_l` / `_r` | `DEF-hand.L` / `.R` |
| `thigh_l` / `_r` | `DEF-thigh.L` / `.R` |
| `calf_l` / `_r` | `DEF-shin.L` / `.R` |
| `foot_l` / `_r` | `DEF-foot.L` / `.R` |
| `ball_l` / `_r` | `DEF-toe.L` / `.R` |

**Intentionally unmapped:**
- `root` — carries root-motion translation; mapping it to `DEF-spine` would double-transform the hip.
- `DEF-spine.005` — Rigify neck-tip bone with no UAL equivalent.
- Twist bones (`DEF-thigh.L.001`, `DEF-upper_arm.L.001`, etc.) — no UAL source; stay in rest pose.
- 30 UAL finger bones — `Ideal_Low_Poly_Male_01.glb` has no finger DEF- bones. Add mappings if your model has them.

### Blender Workflow for Clean UAL ↔ Rigify Compatibility

If you want **zero-remap** perfect animation transfer, prepare your character in Blender:

1. **Export only DEF- bones**: Before exporting to GLB, delete all non-deformation
   bones (ORG-, MCH-, WGT-, metarig) or use an export script that filters them.
   This also removes the 80+ WGT- widget nodes that bloat the GLB.

2. **Rename DEF- bones to match UAL naming**: The cleanest approach — `DEF-spine` →
   `pelvis`, `DEF-spine.001` → `spine_01`, `DEF-upper_arm.L` → `upperarm_l`, etc.
   Then no `boneRemap` is needed at all.

3. **Or keep the remap table** (current default): Pass `buildQuaterniusToRigifyRemap()`
   and the system handles translation at load time. Best when using multiple character
   models without modifying their rigs.

4. **Twist/helper bones**: Rigify's `.001` twist bones (`DEF-thigh.L.001`, etc.) have
   no UAL equivalent. For low-poly characters they stay in rest pose (fine). For
   high-fidelity models, add a post-process pass to interpolate them from parent/child.

**Diagnostic utilities** (run in browser console):
```ts
import { extractBoneNamesFromModel, extractBoneNamesFromClip } from './systems/CharacterAnimationSystem'
console.log('Model bones:', extractBoneNamesFromModel(playerModel))
console.log('Clip bones:', extractBoneNamesFromClip(someClip))
```

### Registering a Custom Animation Set

```ts
import { AnimationClipRegistry } from './systems/CharacterAnimationSystem'

const registry = AnimationClipRegistry.getInstance()
registry.registerCustomSet(
  'my-anims',
  'My Custom Animations',
  '/models/animations/custom',
  [
    { name: 'idle', path: '/models/animations/custom/idle.glb', loop: true },
    { name: 'walk', path: '/models/animations/custom/walk.glb', loop: true },
  ],
  'idle'
)
```

### Animation Browser

Press **`` ` ``** (backtick) in-game to open the **Animation Browser** overlay.
This lets you scroll through all loaded clips, click to preview, and adjust
playback speed — useful for testing retargeting quality and clip timing.

| Control | Action |
|---|---|
| `` ` `` | Toggle browser |
| ↑ / ↓ or scroll | Select clip |
| ← / → | Adjust speed (0.1x – 3.0x) |
| Space | Pause / resume |
| Esc | Close |

While the browser is open, the `AnimationStateMachine` is automatically
disabled so it doesn't override your manual clip selection.

### Animation State Machine

The state machine evaluates transition rules every frame:

- **Priority-based**: higher-priority transitions are checked first (e.g. death > attack > jump > locomotion > idle).
- **Wildcard source** (`from: '*'`): transition can trigger from any state.
- **Auto-transitions**: one-shot clips (jump, attack) can auto-advance to a next state when finished.
- **Lock mechanism**: `fsm.lock(duration)` prevents transitions during cutscenes or combo windows.

Preset configurations are available:

- `createPlayerStateMachineConfig()` — full player moveset (idle, walk, run, jump, fall, land, attack, crouch, death)
- `createNPCStateMachineConfig()` — simple NPC (idle, walk, death)

### Extending the System

- **New clips**: add entries to `config/animation-sets.json` and drop the GLB.
- **New states**: add `AnimState` entries and `AnimTransition` rules.
- **Additive layers**: use `CharacterAnimationSystem.playOnce()` to overlay one-shot animations.
- **Multiple characters**: call `registerCharacter()` for each NPC/enemy with its own ID.
- **Runtime clip loading**: `charAnimSystem.loadClipOnDemand(characterId, 'dance')` fetches lazily.