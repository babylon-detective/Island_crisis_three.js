# Island Crisis — System Architecture & Pipeline Reference

Complete documentation of the Blender ↔ Three.js workflow covering environment,
character, animation, collision, and shader pipelines.

---

## Table of Contents

1. [Controls](#controls)
2. [Environment Pipeline](#environment-pipeline-blender--threejs)
3. [Character Pipeline](#character-pipeline-blender--threejs)
4. [Animation Pipeline](#animation-pipeline)
5. [Collision Pipeline](#collision-pipeline)
6. [Shader Pipeline (GLSL)](#shader-pipeline-glsl)
7. [TSL Status](#tsl--three-shading-language)
8. [Console Commands](#console-commands)
9. [Debug System](#debug-system)
10. [Build & Config](#build--config)
11. [Blender Scripts](#blender-scripts)

---

## Controls

### Camera Modes

| Key | Action |
|-----|--------|
| **C** | Cycle gameplay cameras (Third-person ↔ Shoulder) |
| **F** | Toggle FREE VIEW debug camera (keyboard only, not in gameplay cycle) |
| **Mouse drag** | Rotate camera (free view mode) |
| **Scroll / Pinch** | Zoom |
| **Gamepad R3** | Cycle gameplay cameras (same as C key) |
| **Gamepad Select** | Cycle gameplay cameras (same as C key) |
| **Mobile 📷** | Cycle gameplay cameras (touch button) |

Free View is a debug-only camera for inspecting the scene. It is not part of
the gameplay camera cycle and is only accessible via the **F** key on a keyboard
or through the debug console (`switchCamera('freeview')`).

### Player Movement (Player Camera modes)

| Key | Action |
|-----|--------|
| **W / A / S / D** | Move forward / left / backward / right |
| **Mouse** | Look around (click canvas to capture) |
| **Space** | Jump |
| **Shift** | Run (hold) |
| **Ctrl** | Crouch (hold) |

### Animation Browser

| Key | Action |
|-----|--------|
| **`` ` ``** (backtick) | Toggle animation browser overlay |
| **↑ / ↓** or scroll | Select clip |
| **← / →** | Adjust playback speed (0.1× – 3.0×) |
| **Space** | Pause / resume |
| **Esc** | Close |

While the browser is open, the `AnimationStateMachine` is automatically
disabled so it doesn't override manual clip selection.

### Other

| Key | Action |
|-----|--------|
| **F12** | Open browser console |
| **Ctrl/Cmd + D** | Toggle debug mode |
| **P** | Print performance stats |
| **`#debug`** in URL | Enable debug GUI on load |

---

## Environment Pipeline (Blender → Three.js)

### Workflow Diagram

```
Blender                              Three.js Runtime
───────                              ────────────────
Environment .blend
  ├─ Model/sculpt terrain
  ├─ UV unwrap (optional — shader is procedural)
  └─ Export as GLB
      │
      ▼
  public/models/environments/*.glb
      │
      ▼
  ObjectLoader.loadModelObjects()
      ├─ GLTFLoader parses GLB
      ├─ Position & scale from bounding box
      ├─ Apply land shader (ShaderMaterial) or fallback MeshStandardMaterial
      ├─ Register with ObjectManager
      └─ Bake HeightmapCollider (resolution 64)
            └─ Register with CollisionSystem
```

### Environment Models

| Model | File | Position Logic | Notes |
|-------|------|---------------|-------|
| Main terrain | `grid_01.glb` | `(size.x, 0, size.z)` from bbox | Primary gameplay area |
| Landscape island | `landscape_island.glb` | `(50 + size.x/2, 0, 0)` | Flush against +X edge |

Both models are loaded in `ObjectLoader.loadModelObjects()`. The loader:

1. Parses the GLB via `THREE.GLTFLoader`
2. Computes world-space bounding box for positioning
3. Traverses all child meshes:
   - If `landUniforms` is set → creates a `ShaderMaterial` with the land shader
   - Otherwise → `MeshStandardMaterial` with the original colour (lerped 45% toward white), `metalness: 0.1`, `roughness: 0.8`
4. After positioning, bakes a `HeightmapCollider` at resolution 64 and registers it with `CollisionSystem`

### Adding a New Environment Model

1. Model in Blender, export as GLB to `public/models/environments/`
2. In `ObjectLoader.loadModelObjects()`, add a `loadGLTFModel()` call with position/scale
3. After the model loads, bake and register a heightmap:
   ```ts
   const hm = HeightmapCollider.fromObject(model, 64, 'my-model-id')
   this.collisionSystem.registerHeightmap(hm)
   ```

### Level System

`LevelBuilder` provides JSON-driven level loading via `LevelDescriptor` configs in `config/levels/`.

Supported object types: `box`, `sphere`, `cylinder`, `plane` (primitives) and GLB model references.
Each object can specify collision type: `box`, `sphere`, `cylinder`, `mesh`, or `none`.

---

## Character Pipeline (Blender → Three.js)

### Workflow Diagram

```
Blender                              Three.js Runtime
───────                              ────────────────
Character .blend
  ├─ Model low-poly character
  ├─ Rigify rig (or any skeleton)
  │
  ├─ Option A: Run rename_rigify_to_ual.py
  │   └─ Renames DEF- bones to UAL convention
  │
  ├─ Option B: Run rerig_to_ual_skeleton.py    ◄── RECOMMENDED
  │   ├─ Imports UAL skeleton from UAL1_Standard.glb
  │   ├─ Aligns & scales to character
  │   ├─ Transfers vertex weights
  │   ├─ Parents mesh to UAL armature
  │   └─ Deletes old Rigify armature
  │
  └─ Export as GLB (65 UAL bones)
      │
      ▼
  public/models/characters/*.glb
      │
      ▼
  ObjectLoader → PlayerController
      ├─ GLTFLoader parses GLB + skeleton
      ├─ Auto-scale to capsule height (1.8 units)
      ├─ Apply cel-shaded ShaderMaterial
      │     (default-character-vertex/fragment.glsl)
      ├─ GPU skinning via boneTexture
      └─ Wire to CharacterAnimationSystem
            └─ AnimationMixer + StateMachine
```

### Character Model

| Property | Value |
|----------|-------|
| File | `Ideal_Low_Poly_Male_01.glb` |
| Location | `public/models/characters/` |
| Skeleton | UAL/UE-style (65 joints) |
| Bone naming | `pelvis`, `spine_01`, `upperarm_l`, `thigh_r`, etc. |

The character was originally rigged with Blender Rigify and then re-rigged
using `scripts/rerig_to_ual_skeleton.py` to use the actual UAL skeleton from
`UAL1_Standard.glb`. This ensures 65/65 bone names match exactly, eliminating
the need for runtime bone remapping.

### Player Configuration

| Property | Default | Unit |
|----------|---------|------|
| `height` | `1.8` | world units |
| `radius` | `0.5` | world units |
| `mass` | `70` | kg |
| `walkSpeed` | `1.4` | m/s |
| `runSpeed` | `5.0` | m/s |
| `jumpForce` | `8.0` | |
| `gravity` | `20.0` | m/s² |
| `groundCheckDistance` | `0.3` | world units |

Walk and run speeds are tuned to match the UAL animation cycle lengths so
character feet don't slide.

### GPU Skinning

The character vertex shader (`default-character-vertex.glsl`) implements full
GPU skeletal skinning:

- Uses `boneTexture` (data texture of bone matrices) — the standard Three.js
  skinning path for `SkinnedMesh`
- `getBoneMatrix(float i)` reads 4 texels per bone via `textureSize(boneTexture, 0).x`
  (Three.js r176 removed the deprecated `boneTextureSize` uniform)
- 4-weight linear blend skinning applied to both position and normal
- Guarded by `#ifdef USE_SKINNING`

### Bone Mapping Reference (UAL ↔ Rigify DEF-)

If using a Rigify character **without** re-rigging, runtime bone remapping is
available via `buildQuaterniusToRigifyRemap()`. Core mapping (18 bone pairs):

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

**Intentionally unmapped:** `root` (would double-transform hip), `DEF-spine.005`
(Rigify neck-tip, no UAL equivalent), twist bones (`*.001`), 30 finger bones
(model has no finger geometry).

---

## Animation Pipeline

### Architecture

```
┌──────────────────────────┐
│   AnimationClipRegistry  │  Central library of available animation sets
│  (singleton)             │  registered at boot time from animation-sets.json
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
│  AnimationStateMachine   │  Priority-based FSM that maps game state
│  • setParams(…)          │  (speed, grounded, jumping…) to animation
│  • update(deltaTime)     │  clip transitions with crossfade.
└──────────────────────────┘
```

### Animation Source

| Property | Value |
|----------|-------|
| Pack | Quaternius Universal Animation Library |
| File | `UAL1_Standard.glb` (~7.7 MB, packed) |
| Location | `public/models/animations/quaternius/` |
| Skeleton | 65-joint UE-style |
| Total clips (packed) | 45 |
| Registered clips (used) | 22 |

See [`public/models/animations/quaternius/README.md`](public/models/animations/quaternius/README.md)
for the full clip inventory.

### Supported Formats

- **Packed** (recommended): Single GLB with multiple clips. Use
  `registry.registerQuaterniusPackedSet()`. Default configuration.
- **Split**: One GLB per clip. Use `registry.registerQuaterniusSet()`.

### Animation State Machine

The player state machine has **14 states** and **15 priority-sorted transitions**.
Higher priority wins when multiple conditions are true simultaneously.

#### States

| State | Clip | Auto-transition | Next | Crossfade |
|-------|------|:-:|------|-----------|
| `idle` | `idle` | | | |
| `walk` | `walk` | | | |
| `run` | `run` | | | |
| `walk_backward` | `walk_backward` | | | |
| `run_backward` | `run_backward` | | | |
| `strafe_left` | `strafe_left` | | | |
| `strafe_right` | `strafe_right` | | | |
| `jump` | `jump` | yes | `fall` | 0.1s |
| `fall` | `fall` | | | |
| `land` | `land` | yes | `idle` | 0.1s |
| `attack` | `attack` | yes | `idle` | 0.15s |
| `death` | `death` | | | |
| `crouch_idle` | `crouch_idle` | | | |
| `crouch_walk` | `crouch_walk` | | | |

#### Transitions (descending priority)

| Priority | From | To | Condition |
|----------|------|----|-----------|
| 100 | `*` | `death` | `isDead` |
| 90 | `*` | `attack` | `isAttacking && isGrounded` |
| 82 | `jump` | `fall` | `!isGrounded && isFalling` |
| 80 | `idle/walk/run` | `jump` | `isJumping` |
| 75 | `fall` | `land` | `isGrounded` |
| 70 | `idle/walk/run` | `fall` | `isFalling && !isGrounded` |
| 55 | `*` | `crouch_walk` | `isCrouching && speed > 0.5 && isGrounded` |
| 50 | `*` | `crouch_idle` | `isCrouching && speed ≤ 0.5 && isGrounded` |
| 40 | `*` | `run` | `isRunning && speed > 0.5 && isGrounded` |
| 30 | `*` | `walk` | `speed > 0.2 && !isRunning && isGrounded` |
| 0 | `*` | `idle` | `speed ≤ 0.2 && isGrounded && !isCrouching` |

#### Parameter Thresholds (tuned for walkSpeed 1.4 / runSpeed 5.0)

| Parameter | Source | Threshold |
|-----------|--------|-----------|
| `speed` | `velocity.length()` | idle ≤ 0.2, walk > 0.2, run > 0.5 |
| `isJumping` | `velocity.y > 2.0` | |
| `isFalling` | `velocity.y < -3.0` | |
| `isRunning` | Shift key held | |
| `isGrounded` | collision system ground check | |

### Adding New Animations

1. Drop the GLB in `public/models/animations/quaternius/`
2. Add an entry in `config/animation-sets.json` with `name`, `path`, `loop`, `timeScale`
3. Add a new `AnimState` in `createPlayerStateMachineConfig()` in `AnimationStateMachine.ts`
4. Add corresponding `AnimTransition` rules with appropriate priority

### Procedural Animation System

`AnimationSystem.ts` is a separate **procedural tween system** for
decorative objects (position, rotation, scale, material). Supports easing
functions: `linear`, `easeInOutCubic`, `easeOutElastic`, `easeInOutQuad`.
Not used for character skeletal animation.

---

## Collision Pipeline

### Architecture

```
                        getGroundHeightOptimized(x, z)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
             HeightmapCollider  HeightmapCollider  Raycast against
             (grid-01, O(1))   (island, O(1))     landMeshes[]
                    │               │               │
                    └───────┬───────┘               │
                            ▼                       ▼
                     max(heightmap results, raycast result)
                                    │
                                    ▼
                            ground height Y
                                    │
                         PlayerController.update()
                            capsule collision
```

### HeightmapCollider

Bakes ground heights from any `Object3D` at load time for O(1) runtime queries.

**File:** `src/systems/HeightmapCollider.ts`

**Baking process** (`fromObject(object, resolution, id, padding)`):

1. Compute world-space bounding box with optional padding (default 0.5)
2. Build grid preserving aspect ratio (longest axis = `resolution` cells, default 64)
3. Collect all child `THREE.Mesh` objects
4. For each grid cell, raycast straight down from `bbox.max.y + 100`
5. Take the highest upward-facing intersection (face normal Y > 0.3)
6. Store heights in `Float32Array` (row-major), `-Infinity` for misses

**Runtime query** (`getHeight(x, z)`):

- Returns `null` if `(x, z)` is outside bounds
- Bilinear interpolation across the 4 surrounding grid corners
- Nearest-neighbour fallback when a corner has `-Infinity`
- O(1) time complexity — no raycasting at runtime

**Rebake support:** When a model's transform changes (scale, position, rotation),
call `collisionSystem.rebakeHeightmap('id')` or `rebakeAllHeightmaps()`.
The collider re-samples from the stored source `Object3D` reference.

### CollisionSystem

**File:** `src/systems/CollisionSystem.ts`

| Property | Default | Purpose |
|----------|---------|---------|
| `groundHeightOffset` | `0` | Additive offset to all ground queries |
| `cacheTimeout` | `500` ms | Ground height cache TTL |
| `maxRaycastDistance` | `200` | Max ray length |
| `positionThreshold` | `0.1` | Min movement to invalidate cache |

**Ground height query** (`getGroundHeightOptimized(x, z)`):

1. **Heightmap pass (O(1)):** Iterates all registered `HeightmapCollider`s,
   calls `hm.getHeight(x, z)`, takes the maximum height found.
2. **Raycast pass:** For each registered `landMesh` whose bounding box contains
   `(x, z)`, casts a ray straight down, filters to upward-facing normals only
   (`worldNormal.y > 0.5`), takes the highest hit.
3. **Result:** Returns `max(heightmap, raycast)`, or `-2.0` (ocean level) if no land.

**Collision volumes:** `box`, `sphere`, `capsule` — each registered with
position, rotation, and dimensions.

**Player collision:** Capsule-based. The `PlayerController` checks ground
contact via `getGroundHeightOptimized()` and wall collisions via 5-direction
raycasts from capsule centre.

### Heightmap API (CollisionSystem)

```ts
// Register a baked heightmap
collisionSystem.registerHeightmap(heightmap: HeightmapCollider)

// Re-bake after model transform changes
collisionSystem.rebakeHeightmap('grid-01')    // single
collisionSystem.rebakeAllHeightmaps()          // all

// Console command
rebakeCollision()          // re-bake all
rebakeCollision('grid-01') // re-bake specific
```

---

## Shader Pipeline (GLSL)

All shading uses raw GLSL via `THREE.ShaderMaterial`. Shader source files are
imported as ES modules via `vite-plugin-glsl` and cached in the `SHADERS`
registry (`src/shaderImports.ts`).

### Shader Inventory

| Shader | Vertex | Fragment | Used By |
|--------|--------|----------|---------|
| **Land** | `land-vertex.glsl` | `land-fragment.glsl` | Procedural terrain plane |
| **Ocean** | `ocean-vertex.glsl` | `ocean-fragment.glsl` | Multi-LOD ocean surface |
| **Character** | `default-character-vertex.glsl` | `default-character-fragment.glsl` | Player & NPC meshes |
| **Lighting** | `default-light-vertex.glsl` | `default-light-fragment.glsl` | Default lit objects |
| **Crystal** | `crystal-vertex.glsl` | `crystal-fragment.glsl` | Animated cylinders |
| **Hologram** | `hologram-vertex.glsl` | `hologram-fragment.glsl` | Additive-blend icosahedra |
| **Noise** | `noise-vertex.glsl` | `noise-fragment.glsl` | Noise-deformed boxes |
| **Pulse** | `pulse-vertex.glsl` | `pulse-fragment.glsl` | Electric pulsing cones |
| **Spiral** | `spiral-vertex.glsl` | `spiral-fragment.glsl` | Twisting spheres |
| **Retro Post** | `retro-postprocess-vertex.glsl` | `retro-postprocess-fragment.glsl` | Full-screen post-process |
| **Title Screen** | `titlescreen-vertex.glsl` | `titlescreen-fragment.glsl` | Title screen effect |
| **Generic** | `vertex.glsl` | `fragment.glsl` | Generic shader plane |

### Common Lighting Chunks

`src/shaders/common/lighting-vertex.glsl` and `lighting-fragment.glsl` are
`#include`d into the land shaders (replaced at import time via string
substitution in `shaderImports.ts`).

**Lighting fragment uniforms:** `uSunDirection`, `uSunColor`, `uSunIntensity`,
`uSpotlightPosition`, `uSpotlightDirection`, `uSpotlightColor`,
`uSpotlightIntensity`, `uSpotlightAngle`, `uSpotlightPenumbra`,
`uSpotlightDistance`

Supports PCF shadow sampling, configurable toon shading levels
(`TOON_LEVELS`, `TOON_ENABLED`, `RIM_STRENGTH_MULTIPLIER`).

### Land Shader

Procedural noise-based terrain with slope-dependent material blending
(grass, rock, sand).

**Uniforms:** `uTime`, `uElevation`, `uRoughness`, `uScale`, `uLandColor`,
`uRockColor`, `uSandColor`, `uMoisture`, `uIslandRadius`, `uCoastSmoothness`,
`uSeaLevel`

**Varyings:** `vPosition`, `vNormal`, `vUv`, `vElevation`, `vSlope`,
`vWorldPosition`

### Ocean Shader

Animated water with Simplex noise waves, Fresnel reflections, caustics,
depth-based colour mixing.

**Vertex uniforms:** `uTime`, `uAmplitude`, `uWindDirection`, `uWindStrength`,
`uWaveLength`, `uWaveSpeed`, `aRandom`

**Fragment uniforms:** `uTime`, `uWaterColor`, `uDeepWaterColor`, `uFoamColor`,
`uTransparency`, `uReflectionStrength`, `uSunDirection`, `uSunColor`,
`uSunIntensity`

### Character Shader (Cel-Shading)

Wind Waker–style cel-shaded rendering with a 2-light model.

**Lighting model:**
- 1–2 dominant directional lights (pushed via JS uniforms)
- Banded cel-shaded diffuse (half-Lambert → stepped by `uBands`)
- Hard specular highlight
- Fresnel rim/back light for silhouette definition
- Dark Fresnel outline edge

**Fragment uniforms:**

| Uniform | Default | Description |
|---------|---------|-------------|
| `uModelColor` | per-mesh | Base colour (from GLB, lerped 45% to white) |
| `uLightDir` | `(0.5, 0.8, 0.3)` | Primary light direction |
| `uLightColor` | `(1, 1, 0.95)` | Primary light colour |
| `uLightIntensity` | `1.0` | Primary light multiplier |
| `uLight2Dir` | `(-0.4, 0.3, -0.6)` | Secondary light direction |
| `uLight2Color` | `(0.6, 0.7, 1.0)` | Secondary light colour |
| `uLight2Intensity` | `0.0` | Off by default |
| `uAmbient` | `0.55` | Ambient brightness |
| `uBrightBoost` | `0.18` | Additive emissive lift |
| `uBands` | `3.0` | Number of toon shading bands |
| `uRimColor` | `(1, 1, 1)` | Rim light colour |
| `uRimStrength` | `0.45` | Rim intensity |
| `uRimPower` | `2.5` | Rim exponent |
| `uSpecStrength` | `0.15` | Specular intensity |
| `uSpecPower` | `32.0` | Specular exponent |
| `uOutlineWidth` | `0.38` | Outline thickness |
| `uOutlineColor` | `(0.08, 0.06, 0.12)` | Outline colour |

### Retro Post-Processing

Full-screen post-process with pixelation, Bayer 4×4 dithering, colour
posterization, and depth/normal-based edge detection.

**Uniforms:** `tDiffuse`, `tDepth`, `tNormal`, `uResolution`, `uTime`,
`uPixelSize`, `uColorLevels`, `uDitherAmount`, `uContrast`, `uSaturation`,
`uEdgeThickness`, `uEdgeIntensity`, `uEdgeColor`, `uDepthEdgeThreshold`,
`uNormalEdgeThreshold`

---

## TSL / Three Shading Language

**TSL is not currently used.** All shading is raw GLSL via `THREE.ShaderMaterial`.

The codebase has a commented-out TSL import in `main.ts` and a `'tsl'` object
type in `ObjectManager`, but no actual `NodeMaterial`, `MeshPhysicalNodeMaterial`,
or `ShaderNodeObject` usage exists.

TSL is the planned migration path for WebGPU compatibility. When adopted, the
existing GLSL shaders will be ported to TSL node graphs using Three.js's
`Fn()`, `uniform()`, `attribute()` APIs, enabling the same shader code to run
on both WebGL and WebGPU backends.

---

## Console Commands

Type `help()` in the browser console to see the full list. Key commands:

### General

| Command | Description |
|---------|-------------|
| `help()` | List all commands |
| `listObjects()` | List all managed objects |
| `showSystemStatus()` | Complete system overview |
| `clearLocalStorage()` | Clear persistent state |

### Player

| Command | Description |
|---------|-------------|
| `setPlayerPosition(x, y, z)` | Teleport player |
| `getPlayerStatus()` | Current position & state |
| `togglePlayerDebug()` | Show/hide collision wireframe |
| `setMeshGroundOffset(n)` | Runtime ground offset adjustment |
| `checkPlayerSpeeds()` | Report walk/run speed values |
| `diagnosePlayerIssues()` | Automated player diagnostics |

### Collision

| Command | Description |
|---------|-------------|
| `testCollisionAtPosition(x, y, z)` | Test collision at point |
| `testCollisionAtPlayer()` | Test at current player position |
| `testGroundDetection()` | Ground ray diagnostics |
| `testLandCollision()` | Land mesh collision info |
| `refreshCollisionSystem()` | Rebuild collision data |
| `rebakeCollision()` | Re-bake all heightmaps |
| `rebakeCollision('id')` | Re-bake specific heightmap |
| `showLandMeshes()` | Debug land mesh info |
| `showLandBounds()` | Log land bounding boxes |

### Camera & Debug

| Command | Description |
|---------|-------------|
| `debugCameraPlayerPosition()` | Camera/player position dump |
| `movePlayerToSafePosition()` | Move to known safe coords |
| `enableCollisionLogging()` | Enable collision debug logs |
| `disableCollisionLogging()` | Disable collision debug logs |
| `enableAllLogging()` | Turn on all log modules |
| `disableAllLogging()` | Turn off all log modules |

---

## Debug System

### Debug GUI (lil-gui)

Enable with `#debug` in URL or **Ctrl/Cmd + D**. Panels include:

- **Player:** walkSpeed (0.5–10), runSpeed (1–20), jumpForce, gravity, meshGroundOffset
- **Camera:** mode, distance, FOV
- **Environment:** sky, lighting, time of day
- **Ocean:** wave amplitude, wind direction/strength, water colours, shadows
- **Land:** terrain params, volcanic island, shadow receiving
- **Performance:** FPS, draw calls, memory, collision timing
- **Shaders:** per-shader uniform tweaking

### Logging System

Centralized logging with module-based filtering:

Modules: `SYSTEM`, `PLAYER`, `CAMERA`, `COLLISION`, `ANIMATION`, `INPUT`,
`SHADER`, `OBJECT`, `PERFORMANCE`

Levels: `ERROR`, `WARN`, `INFO`, `DEBUG`

### Performance Monitoring

- Frame rate tracking
- Collision check timing
- Render timing
- Memory usage monitoring
- Available via `P` key or console

---

## Build & Config

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `three` | `^0.176.0` | 3D engine |
| `@types/three` | `^0.176.0` | TypeScript defs |
| `typescript` | `^5.7.3` | Type checking |
| `vite` | `^6.1.0` | Dev server & bundler |
| `vite-plugin-glsl` | `^1.3.0` | GLSL ES module imports |
| `vite-plugin-top-level-await` | `^1.4.4` | Top-level await support |
| `dat.gui` | `^0.7.9` | Debug GUI (legacy dep) |
| `gh-pages` | `^6.3.0` | GitHub Pages deploy |

### Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `vite` | Dev server with HMR |
| `build` | `tsc && vite build` | Type-check + production build |
| `preview` | `vite preview` | Preview production build |
| `deploy` | `gh-pages -d ./dist` | Deploy to GitHub Pages |

### TypeScript Config

- **Target:** ES2020, **Module:** ESNext, **Resolution:** Bundler
- **Strict:** true, **noEmit:** true (Vite handles bundling)

### Vite Config

- **Plugins:** `topLevelAwait()`, `glsl()` (includes `*.glsl`, `*.wgsl`, `*.vert`, `*.frag`)
- **Base:** `./` (relative paths for deployment)

---

## Blender Scripts

Located in `scripts/`. Run inside Blender's scripting workspace.

### `rename_rigify_to_ual.py`

Renames Rigify `DEF-` deformation bones to UAL/UE-style naming convention.

| Rigify (before) | UAL (after) |
|---|---|
| `DEF-spine` | `pelvis` |
| `DEF-spine.001` | `spine_01` |
| `DEF-upper_arm.L` | `upperarm_l` |
| `DEF-forearm.L.001` | `lowerarm_twist_01_l` |
| … | … |

**Usage:** Select armature → run script → re-export as GLB. Eliminates
runtime bone remapping.

### `rerig_to_ual_skeleton.py` (recommended)

Completely replaces the Rigify armature with the UAL skeleton from
`UAL1_Standard.glb`:

1. Imports the UAL skeleton from the GLB
2. Aligns & scales the UAL skeleton to match the character
3. Transfers vertex weights from Rigify bones to UAL bones
4. Parents the mesh to the UAL armature
5. Deletes the old Rigify armature

**Config variables:** `UAL_GLB_PATH` (path to `UAL1_Standard.glb`),
`BONES_ALREADY_RENAMED` (set `True` if rename script was already run).

### Diagnostic Utilities

Run in browser console to compare model and animation bone names:

```ts
import { extractBoneNamesFromModel, extractBoneNamesFromClip } from './systems/CharacterAnimationSystem'
console.log('Model bones:', extractBoneNamesFromModel(playerModel))
console.log('Clip bones:', extractBoneNamesFromClip(someClip))
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/main.ts` | Entry point, game loop, system wiring |
| `src/systems/PlayerController.ts` | Player movement, capsule collision, mesh positioning |
| `src/systems/CollisionSystem.ts` | Ground queries, collision volumes, heightmap integration |
| `src/systems/HeightmapCollider.ts` | Baked heightmap grid, bilinear interpolation, rebake |
| `src/systems/ObjectLoader.ts` | GLB loading, shader assignment, model positioning |
| `src/systems/LevelBuilder.ts` | JSON-driven level loading |
| `src/systems/CharacterAnimationSystem.ts` | Skeletal animation, mixer management, crossfade |
| `src/systems/AnimationStateMachine.ts` | Priority-based FSM for animation transitions |
| `src/systems/AnimationBrowser.ts` | In-game animation clip browser overlay |
| `src/systems/AnimationSystem.ts` | Procedural tween animations for objects |
| `src/systems/CameraManager.ts` | System / shoulder / third-person / free camera |
| `src/systems/InputSystem.ts` | Keyboard, mouse, touch, gamepad input |
| `src/systems/ConsoleCommands.ts` | Browser console command registry |
| `src/systems/DebugGUIManager.ts` | Debug GUI panel setup |
| `src/systems/ParameterManager.ts` | Parameter definitions with min/max/default |
| `src/systems/RetroPostProcessingSystem.ts` | Full-screen retro post-process pass |
| `src/systems/ObjectManager.ts` | Object lifecycle, state persistence |
| `src/systems/GridSystem.ts` | Grid overlay system |
| `src/systems/HUDSystem.ts` | Heads-up display |
| `src/systems/PauseManager.ts` | Pause/resume logic |
| `src/systems/Logger.ts` | Centralized logging with module filtering |
| `src/systems/PerformanceMonitor.ts` | FPS, timing, memory tracking |
| `src/shaderImports.ts` | GLSL file registry, `#include` resolution |
| `config/animation-sets.json` | Animation clip definitions |
| `config/levels/test-level.json` | Test level descriptor |