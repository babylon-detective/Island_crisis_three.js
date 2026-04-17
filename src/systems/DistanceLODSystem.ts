import * as THREE from 'three'
import { SHADERS } from '../shaderImports'

// ============================================================================
// Distance LOD System — manages distance-based rendering for the toon/retro
// aesthetic: full shader → silhouette shader → dithered fade-out → hidden.
//
// Designed for both level meshes and NPC meshes.
// ============================================================================

export enum DistanceTier {
  FULL = 0,        // Full shader, full shadow, full detail
  SILHOUETTE = 1,  // Cheap flat-colour + outline shader, no shadow cast
  DISSOLVE = 2,    // Silhouette + Bayer dither dissolve
  HIDDEN = 3,      // Invisible (beyond render distance)
}

export interface DistanceThresholds {
  silhouette: number   // distance to swap to silhouette shader
  dissolve: number     // distance to start dithered fade-out
  hidden: number       // distance to hide entirely
}

const DEFAULT_NPC_THRESHOLDS: DistanceThresholds = {
  silhouette: 50,
  dissolve: 70,
  hidden: 90,
}

const DEFAULT_LEVEL_THRESHOLDS: DistanceThresholds = {
  silhouette: 80,
  dissolve: 120,
  hidden: 160,
}

/** Stored per managed object so we can swap materials back. */
interface ManagedEntry {
  object: THREE.Object3D
  originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>
  silhouetteMaterials: Map<THREE.Mesh, THREE.ShaderMaterial>
  thresholds: DistanceThresholds
  currentTier: DistanceTier
  isSkinned: boolean
}

// Shared silhouette shader source (loaded once)
const silhouetteVert = SHADERS['src/shaders/silhouette-vertex.glsl']
const silhouetteFrag = SHADERS['src/shaders/silhouette-fragment.glsl']

// Reusable vectors
const _camPos = new THREE.Vector3()
const _objPos = new THREE.Vector3()

/** Known colour uniforms on level ShaderMaterials. */
const COLOR_UNIFORM_NAMES = [
  'uModelColor', 'uLandColor', 'uConcreteColor', 'uConcreteDarkColor',
  'uSandColor', 'uWoodColor', 'uBaseColor', 'uColor',
]

export class DistanceLODSystem {
  private entries: ManagedEntry[] = []
  private enabled = true
  /** Counts frames since first update — skip LOD changes during warmup. */
  private frameCount = 0
  private static readonly WARMUP_FRAMES = 10
  private loggedFirstUpdate = false

  // ---- Registration --------------------------------------------------------

  /** Register an NPC group for distance LOD management. */
  registerNPC(model: THREE.Group, thresholds?: Partial<DistanceThresholds>): void {
    this.register(model, { ...DEFAULT_NPC_THRESHOLDS, ...thresholds }, true)
  }

  /** Register a level/environment mesh for distance LOD. */
  registerLevelMesh(mesh: THREE.Object3D, thresholds?: Partial<DistanceThresholds>): void {
    this.register(mesh, { ...DEFAULT_LEVEL_THRESHOLDS, ...thresholds }, false)
  }

  private register(
    object: THREE.Object3D,
    thresholds: DistanceThresholds,
    isSkinned: boolean,
  ): void {
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
    const silhouetteMaterials = new Map<THREE.Mesh, THREE.ShaderMaterial>()

    object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return

      // Preserve the original material reference (could be single or array)
      const mat = child.material
      originalMaterials.set(child, mat)

      // Derive silhouette colour from the original material's dominant colour
      const singleMat = Array.isArray(mat) ? mat[0] : mat
      const silColor = this.extractColor(singleMat)

      const silMat = new THREE.ShaderMaterial({
        uniforms: {
          uSilhouetteColor: { value: silColor },
          uOutlineColor:    { value: new THREE.Color(0.08, 0.06, 0.12) },
          uOutlineWidth:    { value: 0.4 },
          uDitherFade:      { value: 0.0 },
          uAmbientBoost:    { value: 0.05 },
        },
        vertexShader: silhouetteVert,
        fragmentShader: silhouetteFrag,
        side: singleMat.side ?? THREE.FrontSide,
      })

      silhouetteMaterials.set(child, silMat)
    })

    this.entries.push({
      object,
      originalMaterials,
      silhouetteMaterials,
      thresholds,
      currentTier: DistanceTier.FULL,
      isSkinned,
    })
  }

  /** Remove a registered object (e.g. despawned NPC). Restores original mats. */
  unregister(object: THREE.Object3D): void {
    const idx = this.entries.findIndex(e => e.object === object)
    if (idx === -1) return
    const entry = this.entries[idx]
    // Restore originals
    for (const [mesh, mat] of entry.originalMaterials) {
      mesh.material = mat
    }
    // Dispose silhouette materials
    for (const [, mat] of entry.silhouetteMaterials) {
      mat.dispose()
    }
    entry.object.visible = true
    this.entries.splice(idx, 1)
  }

  // ---- Per-frame update ----------------------------------------------------

  setEnabled(v: boolean): void { this.enabled = v }

  update(camera: THREE.Camera): void {
    if (!this.enabled) return

    this.frameCount++

    // Warmup: don't change any tiers for the first N frames while the scene
    // settles (camera finds its position, world matrices update, etc.)
    if (this.frameCount <= DistanceLODSystem.WARMUP_FRAMES) return

    camera.getWorldPosition(_camPos)

    // One-time diagnostic log so we can see what distances the system computes
    const doLog = !this.loggedFirstUpdate
    if (doLog) {
      this.loggedFirstUpdate = true
      console.log(`[DistanceLOD] First update — camera at (${_camPos.x.toFixed(1)}, ${_camPos.y.toFixed(1)}, ${_camPos.z.toFixed(1)}), entries: ${this.entries.length}`)
    }

    for (const entry of this.entries) {
      entry.object.getWorldPosition(_objPos)
      const dist = _camPos.distanceTo(_objPos)

      // Safety: never degrade objects that are clearly close to the camera
      const tier = dist < 10 ? DistanceTier.FULL : this.computeTier(dist, entry.thresholds)

      if (doLog) {
        const label = entry.object.name || (entry.isSkinned ? 'NPC' : 'level')
        console.log(`  [${label}] dist=${dist.toFixed(1)} tier=${DistanceTier[tier]} pos=(${_objPos.x.toFixed(1)},${_objPos.y.toFixed(1)},${_objPos.z.toFixed(1)})`)
      }

      if (tier === entry.currentTier) {
        // Update dissolve uniform even if tier hasn't changed
        if (tier === DistanceTier.DISSOLVE) {
          this.updateDissolve(entry, dist)
        }
        continue
      }

      this.applyTier(entry, tier, dist)
      entry.currentTier = tier
    }
  }

  // ---- Tier logic ----------------------------------------------------------

  private computeTier(dist: number, t: DistanceThresholds): DistanceTier {
    if (dist >= t.hidden)     return DistanceTier.HIDDEN
    if (dist >= t.dissolve)   return DistanceTier.DISSOLVE
    if (dist >= t.silhouette) return DistanceTier.SILHOUETTE
    return DistanceTier.FULL
  }

  private applyTier(entry: ManagedEntry, tier: DistanceTier, dist: number): void {
    switch (tier) {
      case DistanceTier.FULL:
        entry.object.visible = true
        for (const [mesh, mat] of entry.originalMaterials) {
          mesh.material = mat
          mesh.castShadow = true
        }
        break

      case DistanceTier.SILHOUETTE:
        entry.object.visible = true
        for (const [mesh, silMat] of entry.silhouetteMaterials) {
          silMat.uniforms.uDitherFade.value = 0.0
          mesh.material = silMat
          mesh.castShadow = false  // save shadow pass cost
        }
        break

      case DistanceTier.DISSOLVE:
        entry.object.visible = true
        for (const [mesh, silMat] of entry.silhouetteMaterials) {
          mesh.material = silMat
          mesh.castShadow = false
        }
        this.updateDissolve(entry, dist)
        break

      case DistanceTier.HIDDEN:
        entry.object.visible = false
        break
    }
  }

  private updateDissolve(entry: ManagedEntry, dist: number): void {
    const t = entry.thresholds
    const fade = Math.min(1.0, (dist - t.dissolve) / Math.max(1, t.hidden - t.dissolve))
    for (const [, silMat] of entry.silhouetteMaterials) {
      silMat.uniforms.uDitherFade.value = fade
    }
  }

  // ---- Helpers -------------------------------------------------------------

  private extractColor(mat: THREE.Material): THREE.Color {
    // Check all known colour uniform names on ShaderMaterials
    if (mat instanceof THREE.ShaderMaterial) {
      for (const name of COLOR_UNIFORM_NAMES) {
        const u = mat.uniforms[name]
        if (u && u.value instanceof THREE.Color) {
          return u.value.clone()
        }
      }
    }
    if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhongMaterial) {
      return mat.color.clone()
    }
    return new THREE.Color(0.5, 0.5, 0.5)
  }

  /** Current distance tier for a registered object. */
  getTier(object: THREE.Object3D): DistanceTier | null {
    const e = this.entries.find(e => e.object === object)
    return e ? e.currentTier : null
  }

  /** How many objects at each tier (for debug HUD). */
  getStats(): Record<string, number> {
    const counts = { full: 0, silhouette: 0, dissolve: 0, hidden: 0 }
    for (const e of this.entries) {
      switch (e.currentTier) {
        case DistanceTier.FULL:       counts.full++; break
        case DistanceTier.SILHOUETTE: counts.silhouette++; break
        case DistanceTier.DISSOLVE:   counts.dissolve++; break
        case DistanceTier.HIDDEN:     counts.hidden++; break
      }
    }
    return counts
  }

  /** Update thresholds at runtime (e.g. tied to quality tier). */
  setNPCThresholds(t: Partial<DistanceThresholds>): void {
    for (const e of this.entries) {
      if (e.isSkinned) Object.assign(e.thresholds, t)
    }
  }

  setLevelThresholds(t: Partial<DistanceThresholds>): void {
    for (const e of this.entries) {
      if (!e.isSkinned) Object.assign(e.thresholds, t)
    }
  }

  dispose(): void {
    for (const entry of this.entries) {
      for (const [mesh, mat] of entry.originalMaterials) {
        mesh.material = mat
      }
      for (const [, mat] of entry.silhouetteMaterials) {
        mat.dispose()
      }
      entry.object.visible = true
    }
    this.entries.length = 0
  }
}
