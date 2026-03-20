# Scaling Architecture — Performance-Aware Growth Guide

How to grow Island Crisis (shaders, meshes, animations, NPCs, levels) while
staying within a **60 FPS budget** on mid-range hardware.  
Companion to [`INSTRUCTIONS.md`](../INSTRUCTIONS.md) which covers current
pipelines.

---

## Table of Contents

1. [Frame Budget Anatomy](#1-frame-budget-anatomy)
2. [Shader & Material Strategy](#2-shader--material-strategy)
3. [Mesh & Geometry Management](#3-mesh--geometry-management)
4. [Skeletal Animation Scaling](#4-skeletal-animation-scaling)
5. [NPC Instantiation & Crowd Growth](#5-npc-instantiation--crowd-growth)
6. [Collision & Physics Scaling](#6-collision--physics-scaling)
7. [Occlusion & Visibility Culling](#7-occlusion--visibility-culling)
8. [Lighting & Shadow Strategy](#8-lighting--shadow-strategy)
9. [Level Design & Streaming](#9-level-design--streaming)
10. [Post-Processing Pipeline](#10-post-processing-pipeline)
11. [Adaptive Quality System](#11-adaptive-quality-system)
12. [TSL Migration Path](#12-tsl-migration-path)
13. [Profiling Checklist](#13-profiling-checklist)

---

## 1. Frame Budget Anatomy

At 60 FPS each frame has **16.6 ms**. Current breakdown (10 NPCs, 3 land meshes,
retro post-processing on, `high` tier):

| Phase | Current | Budget | Notes |
|-------|---------|--------|-------|
| **JS game logic** | 2–4 ms | ≤ 5 ms | AI, physics, input, HUD |
| **Animation mixers** | 1–2 ms | ≤ 3 ms | 11 mixers × 65 bones |
| **Collision queries** | 0.5–1 ms | ≤ 2 ms | Heightmap O(1) + raycast fallback |
| **Shader uniforms** | 0.3 ms | ≤ 1 ms | Per-material uniform uploads |
| **GPU render** | 4–7 ms | ≤ 8 ms | Scene pass + post-FX pass |
| **Overhead** | 0.5 ms | — | GC, browser compositor, vsync |
| **Total** | ~10–14 ms | **≤ 16.6 ms** | |

**Rule of thumb:** every new system you add should justify its millisecond cost.
Profile before and after with `performance.now()` or the built-in
`PerformanceMonitor`.

---

## 2. Shader & Material Strategy

### 2.1 Material Instance Budgets

Current: **13 shader materials, 6 standard materials** (~19 draw calls ignoring
instancing). Three.js batches by material identity — different uniform values
break batches.

| Scale | Materials | Draw Calls | Action |
|-------|-----------|------------|--------|
| Current (10 NPC) | ~19 | ~25 | Fine |
| 30 NPC | ~40+ | ~50+ | Share materials, use uniforms for variation |
| 100+ objects | 60+ | 80+ | Introduce instancing or batching |

**Guidelines:**

- **Share materials.** NPCs that differ only in colour should share one
  `ShaderMaterial` and vary via a per-instance uniform or vertex attribute
  (`instanceColor`). Avoid creating a new material per NPC.
- **Use `THREE.InstancedMesh`** for repeated static objects (trees, rocks,
  crates). A single draw call can render hundreds of instances.
- **Minimise shader variants.** Every `#ifdef` permutation creates a new GPU
  program. Group features behind quality tiers rather than per-object flags.
- **Limit texture binds.** Combine small textures into atlases. Each texture
  switch is a state change.

### 2.2 Shader Complexity Guidelines

| Shader Tier | Fragment Cost | Use For |
|-------------|--------------|---------|
| **Cheap** (< 20 instructions) | Flat colour, unlit, vertex colour | Far LOD, UI elements, debris |
| **Medium** (20–80 instructions) | 1–2 lights, 1 texture sample, simple noise | Most game objects, NPCs |
| **Expensive** (80–200 instructions) | Multi-light, caustics, SSS, fog | Ocean, land (close LOD only) |
| **Very Expensive** (200+) | Multi-pass, screen-space effects | Post-processing only |

**Current shaders by cost:**

| Shader | Approx Instructions | Notes |
|--------|-------------------|-------|
| `retro-postprocess` | ~150 | Full-screen; cost scales with resolution |
| `ocean-fragment` | ~120 | Caustics, Fresnel, specular, foam, fog |
| `land-fragment` | ~100 | Noise, slope blend, toon lighting, shadows |
| `default-character` | ~60 | 2-light toon, rim, specular, outline |
| `default-light` | ~40 | 1–2 lights, toon steps |
| `crystal/hologram/pulse/spiral` | ~30 | Animated effects |

**When adding new shaders:**
1. Keep fragment shaders under 80 instructions for non-hero objects.
2. Move expensive math (noise, trig) to the vertex shader when possible — it
   runs per-vertex not per-pixel.
3. Use `step()` and `smoothstep()` instead of branching (`if/else`).
4. Unroll small loops (≤ 4 iterations) to avoid gradient warnings and branch
   penalties.
5. Pre-compute constants on the CPU and pass as uniforms.

### 2.3 TSL-Ready Patterns

Even though current shaders are GLSL, structure them for future TSL migration:

```
src/shaders/
  common/
    lighting-fragment.glsl     ← shared lighting chunk
    lighting-vertex.glsl
    noise.glsl                 ← shared noise functions
  land-*.glsl
  ocean-*.glsl
  ...
```

- Keep shader logic in **small composable chunks** (`#include`-able).
- Avoid global side-effects in shader files.
- Document each uniform's expected range and unit.
- When TSL is adopted, each chunk maps to a `Fn()` node.

---

## 3. Mesh & Geometry Management

### 3.1 Polygon Budgets

| Category | Current Polycount | Target Max | Approach |
|----------|------------------|------------|----------|
| Player character | ~2,000 tris | 5,000 | Single model, LOD optional |
| NPC (each) | ~2,000 tris | 3,000 | Shared geometry via clone |
| Land (main terrain) | ~10,000 tris | 20,000 | Procedural; segment count tied to quality tier |
| Ocean (close LOD) | 128×128 = 16k | 32k | LOD system already in place (3 levels) |
| Background island | ~8,000 tris | 15,000 | Static; candidate for LOD |
| Scene props (each) | 200–1,000 | 2,000 | Use `InstancedMesh` for repeated items |
| **Scene total** | ~100k tris | **250k tris** | Comfortable for mid-range GPUs |

### 3.2 LOD System Pattern

The ocean already has a 3-tier LOD system. Apply the same pattern to other
large meshes as the world grows:

```typescript
interface LODConfig {
  mesh: THREE.Mesh | THREE.InstancedMesh
  distances: number[]        // Camera distance thresholds
  geometries: THREE.BufferGeometry[]  // One per LOD level
}

// In the animate loop:
function updateLODs(camera: THREE.Camera, lods: LODConfig[]) {
  const camPos = camera.getWorldPosition(_vec3)
  for (const lod of lods) {
    const dist = camPos.distanceTo(lod.mesh.getWorldPosition(_vec3b))
    let level = lod.distances.length  // lowest detail
    for (let i = 0; i < lod.distances.length; i++) {
      if (dist < lod.distances[i]) { level = i; break }
    }
    if (lod.mesh.geometry !== lod.geometries[level]) {
      lod.mesh.geometry = lod.geometries[level]
    }
  }
}
```

Alternatively, use Three.js's built-in `THREE.LOD` object which handles
distance-based child switching automatically.

### 3.3 Geometry Sharing & Instancing

**Current problem:** each NPC clones the full character geometry + skeleton.
At 10 NPCs this is manageable but at 50+ it becomes expensive.

**Instancing strategy for static props:**

```typescript
// Instead of 100 separate tree meshes:
const treeGeometry = loadedTreeMesh.geometry
const treeMaterial = sharedTreeMaterial
const trees = new THREE.InstancedMesh(treeGeometry, treeMaterial, 100)

// Set per-instance transforms
const matrix = new THREE.Matrix4()
for (let i = 0; i < positions.length; i++) {
  matrix.setPosition(positions[i])
  trees.setMatrixAt(i, matrix)
}
trees.instanceMatrix.needsUpdate = true
scene.add(trees)
// Result: 100 trees in 1 draw call
```

**For skinned NPCs** (cannot use `InstancedMesh` directly due to unique
skeletons), see [Section 5](#5-npc-instantiation--crowd-growth).

### 3.4 Memory Management

- **Dispose unused geometries.** When swapping LODs or unloading areas, call
  `geometry.dispose()` and `material.dispose()` to free GPU memory.
- **Use `BufferGeometry` exclusively.** Legacy `Geometry` is removed in
  Three.js r125+.
- **Merge static geometry** where materials match using
  `BufferGeometryUtils.mergeGeometries()` to reduce draw calls.

---

## 4. Skeletal Animation Scaling

### 4.1 Current Cost Model

Each animated character has:
- 1 `THREE.AnimationMixer` (CPU-side keyframe interpolation)
- 65 bones × 1 `Matrix4` each = 65 × 64 bytes = **4.16 KB** bone texture per
  character per frame
- GPU skinning in vertex shader (4-weight blend per vertex)

| NPC Count | Mixers | Bone Texture Uploads/Frame | CPU Time |
|-----------|--------|---------------------------|----------|
| 10 | 11 (+ player) | 11 × 4.16 KB = 45 KB | ~1.5 ms |
| 30 | 31 | 31 × 4.16 KB = 129 KB | ~4 ms |
| 50 | 51 | 51 × 4.16 KB = 212 KB | ~7 ms ⚠️ |
| 100 | 101 | 101 × 4.16 KB = 420 KB | ~14 ms ❌ |

**Bottleneck:** `AnimationMixer.update()` is CPU-bound. At 50+ NPCs with full
skeletal animation, mixer updates alone consume the entire frame budget.

### 4.2 Animation LOD — Distance-Based Quality

Reduce animation fidelity for distant characters:

```typescript
enum AnimLOD { FULL, REDUCED, MINIMAL, FROZEN }

function getAnimLOD(distToCamera: number): AnimLOD {
  if (distToCamera < 20) return AnimLOD.FULL       // 60 Hz updates, full bones
  if (distToCamera < 40) return AnimLOD.REDUCED     // 30 Hz updates, full bones
  if (distToCamera < 80) return AnimLOD.MINIMAL     // 15 Hz updates, upper body only
  return AnimLOD.FROZEN                              // Static pose, no mixer update
}
```

**Implementation approach:**

| LOD Level | Mixer Update Rate | Bone Subset | Crossfade | Savings |
|-----------|-------------------|-------------|-----------|---------|
| `FULL` | Every frame | All 65 | Yes | Baseline |
| `REDUCED` | Every 2nd frame | All 65 | Yes | 50% CPU |
| `MINIMAL` | Every 4th frame | Upper body (32) | No | 75% CPU |
| `FROZEN` | Never | None | No | 100% CPU |

```typescript
// Throttled mixer update
npc.animFrameSkip = (npc.animFrameSkip || 0) + 1
if (npc.animFrameSkip >= lodSkipCount) {
  npc.animFrameSkip = 0
  npc.mixer.update(deltaTime * lodSkipCount)  // Catch up on skipped time
}
```

### 4.3 Animation Clip Sharing

All NPCs already share the same animation pack (`quaternius-universal`). The
`CharacterAnimationSystem` caches loaded clips in the `AnimationClipRegistry`.
This is correct — **never duplicate clip data per NPC**.

When adding new character types (animals, enemies), register new animation sets
in `config/animation-sets.json` and share them across all instances of that
type.

### 4.4 Bone Count Reduction for Simple NPCs

Not all NPCs need 65 bones. Background crowd characters that never speak or
use hand gestures could use a simplified skeleton:

| Skeleton Tier | Bones | Use Case |
|---------------|-------|----------|
| Full (UAL) | 65 | Player, story NPCs, boss enemies |
| Medium | 32 | Combat NPCs, nearby crowd |
| Simple | 16 | Distant crowd, ambient wildlife |

Export simpler skeletons from Blender (delete finger bones, merge spine chain)
and register them as separate animation sets.

---

## 5. NPC Instantiation & Crowd Growth

### 5.1 Current Spawning Pattern

```
NPCSystem.spawnCrowd(count, radius)
  └─ for each NPC:
       ├─ SkeletonUtils.clone(templateModel)   ← full deep clone
       ├─ Apply colour tint via shader uniform
       ├─ Register with CharacterAnimationSystem (new mixer)
       ├─ Register with CollisionSystem
       └─ Add to scene
```

**Cost per NPC:** ~2,000 tris geometry + 65-bone skeleton + 1 mixer + 1 AI
state + 1 collision query/frame.

### 5.2 NPC Population Tiers

| Tier | Count | Strategy | Frame Cost |
|------|-------|----------|------------|
| **Current** | 10 | Full clones, full animation | ~2 ms |
| **Medium** | 20–30 | Animation LOD, throttled AI | ~4 ms |
| **Large** | 50–80 | + Occlusion cull, frozen distant | ~5 ms |
| **Massive** | 100+ | + Impostor billboards, pooling | ~6 ms |

### 5.3 Growth Strategies

#### A. Object Pooling

Don't create/destroy NPCs at runtime. Pre-allocate a pool and activate/
deactivate as needed:

```typescript
class NPCPool {
  private pool: NPC[] = []
  private active: Set<NPC> = new Set()

  constructor(private maxSize: number) {
    // Pre-allocate all NPCs at load time
    for (let i = 0; i < maxSize; i++) {
      const npc = this.createNPC()
      npc.mesh.visible = false
      this.pool.push(npc)
    }
  }

  acquire(): NPC | null {
    const npc = this.pool.find(n => !this.active.has(n))
    if (!npc) return null
    npc.mesh.visible = true
    this.active.add(npc)
    return npc
  }

  release(npc: NPC): void {
    npc.mesh.visible = false
    npc.mixer.stopAllAction()
    this.active.delete(npc)
  }
}
```

#### B. Impostor Billboards (100+ NPCs)

For very distant NPCs, replace the 3D mesh with a camera-facing textured quad
rendered from a pre-captured sprite sheet:

1. At load time, render each NPC pose to an offscreen `RenderTarget` (e.g.,
   8 angles × 4 animations = 32 sprites per character type).
2. Store sprites in a texture atlas.
3. Beyond a distance threshold (e.g., 60 units), swap the `SkinnedMesh` for
   an `InstancedMesh` of quads using the sprite atlas.
4. Update sprite frame based on AI state (idle/walk) at low frequency (4 Hz).

**Savings:** eliminates skeleton, mixer, per-vertex skinning for distant NPCs.

#### C. AI Throttling

Already partially implemented (3-second think interval). Scale further:

| Distance | AI Update Rate | Behaviour Complexity |
|----------|---------------|---------------------|
| < 20 | Every frame | Full (wander, follow, flee, socialize) |
| 20–40 | Every 3rd frame | Simplified (wander only) |
| 40–80 | Every 10th frame | Minimal (drift toward waypoint) |
| > 80 | Never | Frozen at last position |

### 5.4 NPC Material Sharing

Currently, NPCs using the same character shader should share a **single
`ShaderMaterial`** with per-NPC colour passed as a uniform or attribute:

```typescript
// BAD: one material per NPC
npc.material = new THREE.ShaderMaterial({ uniforms: { uModelColor: { value: color } } })

// GOOD: shared material, per-mesh uniform override
const sharedNPCMaterial = new THREE.ShaderMaterial({ ... })
// Use onBeforeRender to set per-NPC uniforms
npc.mesh.onBeforeRender = (renderer, scene, camera) => {
  sharedNPCMaterial.uniforms.uModelColor.value = npc.color
}
npc.mesh.material = sharedNPCMaterial
```

Or use `THREE.UniformsGroup` / instanced attributes for the colour.

---

## 6. Collision & Physics Scaling

### 6.1 Current Architecture

```
getGroundHeightOptimized(x, z)
  1. Check groundHeightCache (Map, 500ms TTL)
  2. Query HeightmapColliders (O(1) bilinear lookup)
  3. Raycast against landMeshes[] (O(n) per mesh)
  4. Return max(all results)
```

**Queries per frame:** 1 (player) + N (NPCs) = **11 currently**.

### 6.2 Scaling Projections

| NPC Count | Queries/Frame | With Cache Hits | Without Cache |
|-----------|--------------|----------------|---------------|
| 10 | 11 | ~3 actual raycasts | 11 raycasts |
| 30 | 31 | ~8 raycasts | 31 raycasts |
| 100 | 101 | ~20 raycasts | 101 raycasts ❌ |

### 6.3 Scaling Strategies

#### A. Heightmap-First Architecture

The `HeightmapCollider` is already O(1). Ensure **every walkable surface** has
a baked heightmap. Raycasting should be a last resort, not the common path.

```
Priority: HeightmapCollider (O(1)) → Cache hit → Raycast (O(n))
```

**When adding new terrain:** always bake a heightmap at load time:
```typescript
const hm = HeightmapCollider.fromObject(newTerrainMesh, 64, 'terrain-id')
collisionSystem.registerHeightmap(hm)
```

#### B. Spatial Partitioning for Raycasts

If the world grows beyond 4–5 land meshes, add a spatial index to skip
meshes that can't possibly contain point (x, z):

```typescript
// Simple grid-based spatial hash
class SpatialHash {
  private cellSize: number
  private cells: Map<string, THREE.Mesh[]> = new Map()

  insert(mesh: THREE.Mesh): void {
    const bbox = new THREE.Box3().setFromObject(mesh)
    // Insert mesh into all cells its bbox overlaps
  }

  query(x: number, z: number): THREE.Mesh[] {
    const key = `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`
    return this.cells.get(key) || []
  }
}
```

This reduces raycast targets from **all meshes** to **only meshes in the same
cell** as the query point.

#### C. Collision LOD

Not all NPCs need precise ground height every frame:

| Distance | Update Rate | Method |
|----------|------------|--------|
| Player | Every frame | Full heightmap + raycast |
| NPC < 20 | Every frame | Heightmap only (skip raycast) |
| NPC 20–40 | Every 2nd frame | Cached heightmap |
| NPC > 40 | Every 4th frame | Last known height |

#### D. Batched Collision Queries

Instead of querying ground height individually per NPC, batch all NPC
positions into a single pass:

```typescript
// Single traversal of heightmaps for all queries
function batchGroundHeight(positions: Vector3[]): number[] {
  const results: number[] = []
  for (const pos of positions) {
    // Heightmap query is O(1), batching eliminates per-call overhead
    results.push(queryHeightmaps(pos.x, pos.z))
  }
  return results
}
```

---

## 7. Occlusion & Visibility Culling

This is the **highest-impact optimisation** for scaling beyond the current
small island. Three.js performs frustum culling by default but has no built-in
occlusion culling.

### 7.1 Frustum Culling (Already Active)

Three.js automatically skips rendering objects whose bounding sphere is
outside the camera frustum. Ensure every mesh has a correct bounding sphere:

```typescript
mesh.geometry.computeBoundingSphere()
```

**Verify it's working:** set `renderer.info.render.calls` as a HUD stat. The
draw call count should drop when looking away from objects.

### 7.2 Manual Visibility Zones

For a structured island world, define **visibility zones** — named regions
where only specific objects are rendered:

```typescript
interface VisibilityZone {
  id: string
  bounds: THREE.Box3
  visibleObjects: Set<string>   // Object IDs that should be visible
  alwaysVisible: boolean        // true for sky, ocean, main terrain
}

// In the animate loop:
const playerZone = zones.find(z => z.bounds.containsPoint(playerPos))
for (const obj of scene.children) {
  if (obj.userData.alwaysVisible) continue
  obj.visible = playerZone.visibleObjects.has(obj.userData.id)
}
```

**Use cases:**
- Indoor areas: hide all outdoor objects and vice versa
- Distant islands: hide interior objects until the player is nearby
- Caves or dungeons: only render the current room + adjacent rooms

### 7.3 Distance-Based Visibility

Simple but effective — hide objects beyond a threshold:

```typescript
const MAX_RENDER_DISTANCE = 100  // Match fog far distance

function updateVisibility(camera: THREE.Camera) {
  const camPos = camera.getWorldPosition(_vec3)

  for (const obj of managedObjects) {
    if (obj.userData.alwaysVisible) continue
    const dist = camPos.distanceTo(obj.position)
    obj.visible = dist < MAX_RENDER_DISTANCE
  }
}
```

Tie `MAX_RENDER_DISTANCE` to the quality tier's `fogFar` value so objects
disappear at the fog boundary (no visible pop-in).

### 7.4 GPU Occlusion Queries (Advanced)

For complex scenes with large occluders (buildings, cliffs), use WebGL 2
occlusion queries:

```typescript
// Simplified concept — Three.js doesn't expose this natively
// Would require custom renderer plugin or post-r176 extension
const query = gl.createQuery()
gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, query)
// Render cheap bounding box of occluded object
gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE)
// Next frame: check if any pixels passed
const visible = gl.getQueryParameter(query, gl.QUERY_RESULT)
```

**Recommendation:** defer GPU occlusion queries until the scene has 200+
objects and manual zones are insufficient. The overhead of the queries
themselves can exceed the savings in small scenes.

### 7.5 Animation & Bone Culling

**Critical for scaling:** don't update animation mixers or upload bone
textures for invisible characters.

```typescript
// In the animate loop — before updating animations:
for (const npc of npcs) {
  const visible = npc.mesh.visible && isInFrustum(npc.mesh, camera)
  if (!visible) {
    // Skip mixer update entirely — no CPU cost
    continue
  }
  npc.mixer.update(deltaTime)
}
```

This is the single most impactful change for NPC scaling. A character that's
off-screen costs **zero** animation CPU time if the mixer isn't updated.

### 7.6 Shadow Culling

Shadow map rendering is a second full scene traversal from the light's
perspective. Objects far from the player or outside the shadow camera frustum
should be excluded:

```typescript
function updateShadowCulling(light: THREE.DirectionalLight, playerPos: THREE.Vector3) {
  for (const obj of scene.children) {
    if (!obj.castShadow) continue
    const dist = playerPos.distanceTo(obj.position)
    // Only cast shadows for nearby objects
    obj.castShadow = dist < 50
  }
}
```

---

## 8. Lighting & Shadow Strategy

### 8.1 Current Lights

| Light | Type | Shadows | Cost |
|-------|------|---------|------|
| Ambient | `AmbientLight` | No | Negligible |
| Key (sun) | `DirectionalLight` | Yes (2048²) | High |
| Player spotlight | `SpotLight` | Yes (1024²) | Medium |

**Shadow maps are the #1 GPU cost** in the current pipeline. Each shadow-
casting light requires a full scene render from its perspective.

### 8.2 Scaling Guidelines

| Scale | Lights | Shadow Lights | Shadow Resolution |
|-------|--------|---------------|-------------------|
| Current | 3 | 2 | 1024–2048 |
| Medium | 5 | 2 | 1024–2048 |
| Large | 8 | 2–3 | 512–1024 |
| Cannot Afford | 10+ | 4+ | 2048+ |

**Rules:**
- **Max 2 shadow-casting lights** at any time. Use `light.castShadow = false`
  for fill/ambient/rim lights.
- **Shadow cascade** for the directional light: tighten `shadow.camera.left/
  right/top/bottom` to cover only the area around the player (currently done
  by CameraManager spotlight updates).
- **Static shadow maps** for lights that don't move: render once, reuse until
  the light or object moves. Set `renderer.shadowMap.autoUpdate = false` and
  call `renderer.shadowMap.needsUpdate = true` manually when needed.
- **Shadow map size tied to quality tier** (already implemented in
  `AdaptiveQualitySystem`).

### 8.3 Light Uniform Caching

Character lighting uniforms (`uLightDir`, `uLightColor`, etc.) are updated by
`updateCharacterLighting()`. This already caches scene lights and player shader
materials (refreshed every 60 frames). When adding new lights:

- Add them to the cached light array (already updated every 60 frames).
- Don't traverse the scene to find lights — use the cache.
- If lights change infrequently (e.g., time-of-day), update character lighting
  uniforms only when the light actually changes, not on a timer.

---

## 9. Level Design & Streaming

### 9.1 Current Level Structure

One monolithic level: 3 land meshes + 2 background models + ocean + 10 NPCs.
Everything loaded at startup.

### 9.2 Chunk-Based World Architecture

As the world grows beyond a single island, split into loadable chunks:

```
world/
  chunk_0_0/        ← Origin island (always loaded)
    terrain.glb
    props.json      ← InstancedMesh definitions
    npcs.json       ← NPC spawn configs
    heightmap.bin   ← Pre-baked collision heightmap
  chunk_1_0/        ← Eastern island
    terrain.glb
    props.json
    npcs.json
    heightmap.bin
  chunk_0_1/        ← Northern island
    ...
```

```typescript
interface WorldChunk {
  id: string
  gridX: number
  gridZ: number
  bounds: THREE.Box3
  loaded: boolean
  objects: THREE.Object3D[]
  heightmap: HeightmapCollider | null
  npcs: NPC[]
}

class WorldStreamer {
  private chunks: Map<string, WorldChunk> = new Map()
  private loadRadius = 2   // Load adjacent chunks
  private unloadRadius = 3  // Unload distant chunks

  update(playerPos: THREE.Vector3): void {
    const px = Math.floor(playerPos.x / CHUNK_SIZE)
    const pz = Math.floor(playerPos.z / CHUNK_SIZE)

    for (const [id, chunk] of this.chunks) {
      const dist = Math.max(Math.abs(chunk.gridX - px), Math.abs(chunk.gridZ - pz))
      if (dist <= this.loadRadius && !chunk.loaded) {
        this.loadChunk(chunk)
      } else if (dist > this.unloadRadius && chunk.loaded) {
        this.unloadChunk(chunk)
      }
    }
  }
}
```

### 9.3 Asset Loading Strategy

- **Lazy load:** Don't load all GLBs at startup. Load chunk assets when the
  player approaches.
- **Pre-bake heightmaps** as binary files (`.bin`) to avoid runtime baking cost
  on chunk load.
- **Show loading state:** Use a fade-to-fog transition when streaming chunks.
- **Cache loaded assets:** Keep GLB geometry/textures in a `ResourceCache` so
  re-entering a chunk doesn't re-parse the GLB.

### 9.4 Level Descriptor Enhancement

Extend the existing `LevelDescriptor` JSON format to support streaming:

```jsonc
{
  "id": "island-crisis",
  "chunks": [
    {
      "id": "chunk_0_0",
      "terrain": "models/environments/grid_01.glb",
      "heightmap": "collision/chunk_0_0.bin",
      "props": [
        { "model": "tree_01.glb", "instances": [[10,0,5], [15,0,-3], ...] },
        { "model": "rock_02.glb", "instances": [[20,0,10]] }
      ],
      "npcs": [
        { "type": "villager", "spawnRadius": 15, "count": 5 },
        { "type": "guard", "position": [10, 0, 10] }
      ],
      "bounds": { "min": [-50, -10, -50], "max": [50, 50, 50] }
    }
  ]
}
```

---

## 10. Post-Processing Pipeline

### 10.1 Current Cost

The retro post-processing system renders the scene **twice** per frame:

1. **Scene → RenderTarget** (full scene render at `resolutionScale`)
2. **RenderTarget → Screen** (full-screen quad with retro shader)

At `resolutionScale = 0.75` on a 1080p display, the render target is 810p.
The scene pass still evaluates every shader at full geometric complexity.

### 10.2 Scaling the Pipeline

| Add-on | Extra Passes | Cost | When to Add |
|--------|-------------|------|-------------|
| Screen-space outline | 0 (built into retro shader) | ~0.5 ms | Already included |
| Bloom | +1 pass (downsample + blur) | ~1 ms | Avoid; use emissive uniforms |
| SSAO | +1 pass (depth-based) | ~2 ms | Only at ultra tier |
| Motion blur | +1 pass | ~1 ms | Only at ultra tier |
| Depth of field | +1 pass | ~1.5 ms | Cutscenes only, disable in gameplay |

**Rules:**
- **Never exceed 3 total render passes** during gameplay (scene + post-FX + 1
  extra maximum).
- **Tie extra passes to quality tiers.** Only enable SSAO/bloom on `ultra`.
- **Reduce `resolutionScale` aggressively** on lower tiers (0.5 on `low`
  is already configured).
- **Consider single-pass alternatives.** The retro shader's edge detection
  already uses depth/normal — piggyback additional effects into this same pass
  rather than adding new passes.

### 10.3 Adding New Post-FX to the Retro Shader

To add a new effect (e.g., vignette, chromatic aberration) without adding a
render pass, add it directly to `retro-postprocess-fragment.glsl`:

```glsl
// In retro-postprocess-fragment.glsl, after existing effects:
// --- Vignette ---
float vignette = smoothstep(0.8, 0.3, length(vUv - 0.5));
color.rgb *= mix(1.0, vignette, uVignetteStrength);
```

This costs a few extra fragment shader instructions but **zero** extra render
passes.

---

## 11. Adaptive Quality System

### 11.1 Current Tier Controls

| Setting | Low | Medium | High | Ultra |
|---------|-----|--------|------|-------|
| `pixelRatio` | 0.5 | 0.75 | 1.0 | min(dpr, 2) |
| `shadowMapSize` | 512 | 512 | 1024 | 2048 |
| `resolutionScale` | 0.5 | 0.625 | 0.75 | 1.0 |
| `fogFar` | 80 | 150 | 200 | 300 |
| `shadowsCast` | No | Yes | Yes | Yes |
| `oceanSegments` | 32 | 64 | 128 | 128 |
| `postProcessing` | Yes | Yes | Yes | Yes |

### 11.2 Expanding Tier Controls

As new systems are added, register them with the adaptive quality system:

```typescript
// In PerformanceMonitor.ts — extend QualitySettings:
interface QualitySettings {
  // Existing...
  pixelRatio: number
  shadowMapSize: number
  // New entries:
  npcAnimLOD: AnimLOD          // Animation quality for NPCs
  maxVisibleNPCs: number       // Hard cap on rendered NPCs
  maxRenderDistance: number     // Object visibility distance
  terrainLOD: number           // Terrain subdivision level
  enableSSAO: boolean          // Screen-space ambient occlusion
  enableBloom: boolean         // Bloom post-FX
}
```

| Setting | Low | Medium | High | Ultra |
|---------|-----|--------|------|-------|
| `npcAnimLOD` | FROZEN | MINIMAL | REDUCED | FULL |
| `maxVisibleNPCs` | 5 | 15 | 30 | 50 |
| `maxRenderDistance` | 60 | 100 | 150 | 250 |
| `terrainLOD` | 0 (lowest) | 1 | 2 | 3 (highest) |
| `enableSSAO` | false | false | false | true |

### 11.3 Tier Oscillation Prevention

Already implemented: hysteresis bands (different up/down thresholds), 5-second
cooldown between tier changes, sample window of 90 frames. If adding new
costly features:

- **Test each feature in isolation** to measure its FPS impact.
- **Add 5 FPS buffer** between the feature's cost and the downgrade threshold.
- **Never enable two expensive features at the same tier boundary** — stagger
  them (e.g., SSAO at ultra only, increased NPCs at high+).

---

## 12. TSL Migration Path

### 12.1 Current Status

All shading is raw GLSL via `THREE.ShaderMaterial`. TSL is planned for WebGPU
compatibility but not yet adopted.

### 12.2 Migration Strategy

A gradual per-shader migration rather than a big-bang rewrite:

```
Phase 1: Simplest shaders (crystal, hologram, pulse, spiral)
  └─ Learn the TSL API with low-risk shaders
  └─ Verify WebGL backend produces identical output to GLSL

Phase 2: Character shader
  └─ Cel-shading, skinning, rim light
  └─ Must handle USE_SKINNING / boneTexture

Phase 3: Land & ocean shaders
  └─ Complex noise, high instruction count
  └─ Profile TSL vs GLSL performance on both backends

Phase 4: Post-processing
  └─ Requires custom render pass integration with TSL
  └─ Likely the most complex migration
```

### 12.3 Dual-Backend Structure

```typescript
// Shader factory pattern for dual-backend support
function createLandMaterial(backend: 'webgl' | 'webgpu'): THREE.Material {
  if (backend === 'webgpu') {
    // TSL node-based material
    return new THREE.MeshPhysicalNodeMaterial({
      colorNode: landColorNode,
      normalNode: landNormalNode,
      // ...
    })
  } else {
    // GLSL ShaderMaterial (current)
    return new THREE.ShaderMaterial({
      vertexShader: SHADERS.landVertex,
      fragmentShader: SHADERS.landFragment,
      uniforms: landUniforms,
    })
  }
}
```

### 12.4 TSL Performance Notes

- TSL compiles to WGSL (WebGPU) or GLSL (WebGL fallback) at runtime.
- Node graph overhead is at material creation time, not per-frame.
- `Fn()` nodes can be composed like shader chunks — maps 1:1 to the current
  `#include` pattern in `shaderImports.ts`.
- `uniform()` API replaces manual `uniforms` object.

---

## 13. Profiling Checklist

Before and after adding any major feature, verify performance with this
checklist.

### Quick Check (In-Game)

```
1. Press P to print performance stats
2. Check: FPS ≥ 60, Frame Time ≤ 16ms, Render Time ≤ 8ms
3. Open console: showSystemStatus()
4. Check draw calls: renderer.info.render.calls
5. Check memory: renderer.info.memory
```

### Deep Profile

```
1. Chrome DevTools → Performance tab → Record 10 seconds of gameplay
2. Look for:
   - Long tasks (> 16ms yellow bars)
   - Frequent minor GC (jagged sawtooth in JS heap)
   - Layout/style recalc spikes (HUD DOM updates)
3. Check the "Bottom-Up" tab:
   - AnimationMixer.update — should be < 3ms total
   - Raycaster.intersectObject — should be < 1ms total
   - WebGLRenderer.render — should be < 8ms
4. Check GPU: chrome://gpu or DevTools → Rendering → FPS meter
```

### Automated Performance Gate

Add to CI or pre-commit:

```typescript
// test-performance.ts — run headless with puppeteer
const metrics = await page.evaluate(() => window.performanceMonitor.getMetrics())
assert(metrics.fps >= 55, `FPS too low: ${metrics.fps}`)
assert(metrics.frameTime <= 20, `Frame time too high: ${metrics.frameTime}ms`)
assert(metrics.renderTime <= 10, `Render time too high: ${metrics.renderTime}ms`)
```

### Per-Feature Budget Template

Before implementing a new feature, fill out:

```
Feature: ____________________
Expected CPU cost: ____ ms/frame
Expected GPU cost: ____ ms/frame
Expected draw calls added: ____
Expected memory: ____ MB
Quality tier gating: low / medium / high / ultra / always
Scalable: yes (describe LOD) / no
Occlusion-aware: yes / no
```

---

## Summary: Growth Decision Tree

```
Adding a new feature?
│
├─ Is it a new mesh/model?
│   ├─ Static & repeated? → Use InstancedMesh
│   ├─ Unique large mesh? → Add LOD levels, bake heightmap
│   └─ Skinned character? → Share skeleton, use animation LOD
│
├─ Is it a new shader?
│   ├─ < 80 instructions? → Ship it
│   ├─ > 80 instructions? → Gate behind high/ultra tier
│   └─ Needs render pass? → Consider piggybacking on retro shader
│
├─ Is it more NPCs?
│   ├─ < 30 total? → Animation LOD + AI throttling
│   ├─ 30–80? → + Occlusion culling + bone culling
│   └─ 100+? → + Object pooling + impostor billboards
│
├─ Is it a new level area?
│   ├─ Small (fits in 1 chunk)? → Add to current scene
│   └─ Large / separate island? → Implement chunk streaming
│
└─ Is it a post-processing effect?
    ├─ Cheap (< 10 instructions)? → Add to retro fragment shader
    └─ Expensive (needs render pass)? → Ultra tier only, max 3 passes total
```
