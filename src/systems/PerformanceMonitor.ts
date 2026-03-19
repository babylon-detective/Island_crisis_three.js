import { logger, LogModule } from './Logger'

export interface PerformanceMetrics {
  fps: number
  frameTime: number
  collisionChecks: number
  collisionTime: number
  renderTime: number
  memoryUsage?: number
  timestamp: number
}

export class PerformanceMonitor {
  private frameCount: number = 0
  private lastTime: number = 0
  private fpsHistory: number[] = []
  private frameTimeHistory: number[] = []
  private collisionChecks: number = 0
  private collisionTime: number = 0
  private renderTime: number = 0
  private isEnabled: boolean = false
  private logInterval: number = 5000 // Log every 5 seconds
  private lastLogTime: number = 0

  constructor() {
    this.lastTime = performance.now()
  }

  /**
   * Enable performance monitoring
   */
  public enable(): void {
    this.isEnabled = true
    logger.info(LogModule.PERFORMANCE, 'Performance monitoring enabled')
  }

  /**
   * Disable performance monitoring
   */
  public disable(): void {
    this.isEnabled = false
    logger.info(LogModule.PERFORMANCE, 'Performance monitoring disabled')
  }

  /**
   * Start frame timing
   */
  public startFrame(): void {
    if (!this.isEnabled) return
    
    this.lastTime = performance.now()
  }

  /**
   * End frame timing and calculate metrics
   */
  public endFrame(): void {
    if (!this.isEnabled) return

    const currentTime = performance.now()
    const frameTime = currentTime - this.lastTime
    const fps = 1000 / frameTime

    this.frameCount++
    this.fpsHistory.push(fps)
    this.frameTimeHistory.push(frameTime)

    // Keep only last 60 frames for averaging
    if (this.fpsHistory.length > 60) {
      this.fpsHistory.shift()
      this.frameTimeHistory.shift()
    }

    // Log performance metrics periodically
    if (currentTime - this.lastLogTime > this.logInterval) {
      this.logPerformanceMetrics()
      this.lastLogTime = currentTime
    }
  }

  /**
   * Start collision timing
   */
  public startCollisionCheck(): void {
    if (!this.isEnabled) return
    this.collisionChecks++
    this.collisionTime = performance.now()
  }

  /**
   * End collision timing
   */
  public endCollisionCheck(): void {
    if (!this.isEnabled) return
    this.collisionTime = performance.now() - this.collisionTime
  }

  /**
   * Start render timing
   */
  public startRender(): void {
    if (!this.isEnabled) return
    this.renderTime = performance.now()
  }

  /**
   * End render timing
   */
  public endRender(): void {
    if (!this.isEnabled) return
    this.renderTime = performance.now() - this.renderTime
  }

  /**
   * Get current performance metrics
   */
  public getMetrics(): PerformanceMetrics {
    const avgFps = this.fpsHistory.length > 0 
      ? this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length 
      : 0
    
    const avgFrameTime = this.frameTimeHistory.length > 0
      ? this.frameTimeHistory.reduce((a, b) => a + b, 0) / this.frameTimeHistory.length
      : 0

    return {
      fps: Math.round(avgFps),
      frameTime: Math.round(avgFrameTime * 100) / 100,
      collisionChecks: this.collisionChecks,
      collisionTime: Math.round(this.collisionTime * 100) / 100,
      renderTime: Math.round(this.renderTime * 100) / 100,
      memoryUsage: this.getMemoryUsage(),
      timestamp: performance.now()
    }
  }

  /**
   * Log performance metrics
   */
  private logPerformanceMetrics(): void {
    const metrics = this.getMetrics()
    
    logger.info(LogModule.PERFORMANCE, `Performance Metrics:
      FPS: ${metrics.fps}
      Frame Time: ${metrics.frameTime}ms
      Collision Checks: ${metrics.collisionChecks}
      Collision Time: ${metrics.collisionTime}ms
      Render Time: ${metrics.renderTime}ms
      Memory: ${metrics.memoryUsage ? `${Math.round(metrics.memoryUsage / 1024 / 1024 * 100) / 100}MB` : 'N/A'}
    `)

    // Reset collision check counter
    this.collisionChecks = 0
  }

  /**
   * Get memory usage if available
   */
  private getMemoryUsage(): number | undefined {
    if ('memory' in performance) {
      return (performance as any).memory.usedJSHeapSize
    }
    return undefined
  }

  /**
   * Check if performance is acceptable
   */
  public isPerformanceAcceptable(): boolean {
    const metrics = this.getMetrics()
    return metrics.fps >= 30 && metrics.frameTime < 33
  }

  /**
   * Get performance warnings
   */
  public getPerformanceWarnings(): string[] {
    const warnings: string[] = []
    const metrics = this.getMetrics()

    if (metrics.fps < 30) {
      warnings.push(`Low FPS: ${metrics.fps} (target: 30+)`)
    }

    if (metrics.frameTime > 33) {
      warnings.push(`High frame time: ${metrics.frameTime}ms (target: <33ms)`)
    }

    if (metrics.collisionTime > 5) {
      warnings.push(`Slow collision detection: ${metrics.collisionTime}ms`)
    }

    if (metrics.renderTime > 16) {
      warnings.push(`Slow rendering: ${metrics.renderTime}ms`)
    }

    return warnings
  }

  /**
   * Reset all metrics
   */
  public reset(): void {
    this.frameCount = 0
    this.fpsHistory = []
    this.frameTimeHistory = []
    this.collisionChecks = 0
    this.collisionTime = 0
    this.renderTime = 0
    this.lastLogTime = 0
    logger.info(LogModule.PERFORMANCE, 'Performance metrics reset')
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor()

// ============================================================================
// ADAPTIVE QUALITY SYSTEM
// ============================================================================

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra'

export interface QualitySettings {
  pixelRatio: number
  shadowMapSize: number
  shadowMapType: number // THREE.BasicShadowMap = 0, THREE.PCFSoftShadowMap = 2
  resolutionScale: number
  fogFar: number
  shadowsCast: boolean
  oceanSegments: number      // vertex resolution for close-up ocean LOD
  postProcessingEnabled: boolean
}

export interface QualityTelemetry {
  currentTier: QualityTier
  avgFps: number
  minFps: number
  maxFps: number
  lockedTier: QualityTier | null
}

const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = {
  low: {
    pixelRatio: 0.5,
    shadowMapSize: 512,
    shadowMapType: 0, // BasicShadowMap
    resolutionScale: 0.5,
    fogFar: 80,
    shadowsCast: false,
    oceanSegments: 32,
    postProcessingEnabled: true,
  },
  medium: {
    pixelRatio: 0.75,
    shadowMapSize: 512,
    shadowMapType: 0,
    resolutionScale: 0.625,
    fogFar: 150,
    shadowsCast: true,
    oceanSegments: 64,
    postProcessingEnabled: true,
  },
  high: {
    pixelRatio: 1.0,
    shadowMapSize: 1024,
    shadowMapType: 0,
    resolutionScale: 0.75,
    fogFar: 200,
    shadowsCast: true,
    oceanSegments: 128,
    postProcessingEnabled: true,
  },
  ultra: {
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    shadowMapSize: 2048,
    shadowMapType: 2, // PCFSoftShadowMap
    resolutionScale: 1.0,
    fogFar: 300,
    shadowsCast: true,
    oceanSegments: 128,
    postProcessingEnabled: true,
  },
}

const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high', 'ultra']

// Thresholds: avgFPS below this → should be at most this tier
const DOWNGRADE_THRESHOLDS: { below: number; maxTier: QualityTier }[] = [
  { below: 20, maxTier: 'low' },
  { below: 35, maxTier: 'medium' },
  { below: 50, maxTier: 'high' },
]

const UPGRADE_THRESHOLDS: { above: number; minTier: QualityTier }[] = [
  { above: 58, minTier: 'ultra' },
  { above: 48, minTier: 'high' },
  { above: 32, minTier: 'medium' },
]

const DOWNGRADE_HOLD_MS = 1200   // React faster to drops
const UPGRADE_HOLD_MS = 4000     // Be patient about upgrades
const EMERGENCY_DOWNGRADE_MS = 400 // Immediate drop when critically low
const FPS_SAMPLE_WINDOW = 60 // ~1s at 60fps

export class AdaptiveQualitySystem {
  private currentTier: QualityTier = 'high'
  private lockedTier: QualityTier | null = null
  private fpsSamples: number[] = []
  private minFps = Infinity
  private maxFps = 0
  private pendingTier: QualityTier | null = null
  private pendingTierSince = 0
  private onQualityChange: ((tier: QualityTier, settings: QualitySettings) => void) | null = null
  private batterySaver = false
  private maxTierOverride: QualityTier | null = null

  public setCallback(cb: (tier: QualityTier, settings: QualitySettings) => void): void {
    this.onQualityChange = cb
  }

  /** Call once after init to listen for battery changes on supported devices */
  public initBatteryMonitor(): void {
    if (!('getBattery' in navigator)) return
    ;(navigator as any).getBattery().then((battery: any) => {
      const check = () => {
        const isLow = battery.level <= 0.15 && !battery.charging
        if (isLow !== this.batterySaver) {
          this.batterySaver = isLow
          if (isLow) {
            // Cap quality to medium when battery is critically low
            this.maxTierOverride = 'medium'
            const currentIdx = TIER_ORDER.indexOf(this.currentTier)
            const capIdx = TIER_ORDER.indexOf('medium')
            if (currentIdx > capIdx) {
              this.applyTier('medium')
            }
            logger.info(LogModule.PERFORMANCE, 'Battery saver ON — quality capped to medium')
          } else {
            this.maxTierOverride = null
            logger.info(LogModule.PERFORMANCE, 'Battery saver OFF — adaptive mode restored')
          }
        }
      }
      battery.addEventListener('levelchange', check)
      battery.addEventListener('chargingchange', check)
      check() // initial
    }).catch(() => { /* Battery API not available */ })
  }

  public update(fps: number): void {
    if (this.lockedTier) return

    // Clamp to reasonable range to avoid outliers from tab-switch spikes
    const clampedFps = Math.max(0, Math.min(fps, 300))

    this.fpsSamples.push(clampedFps)
    if (this.fpsSamples.length > FPS_SAMPLE_WINDOW) {
      this.fpsSamples.shift()
    }

    // Track min/max
    if (clampedFps > 0) {
      if (clampedFps < this.minFps) this.minFps = clampedFps
      if (clampedFps > this.maxFps) this.maxFps = clampedFps
    }

    // Need at least half a window of samples before making decisions
    if (this.fpsSamples.length < FPS_SAMPLE_WINDOW / 2) return

    const avgFps = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length
    const desiredTier = this.computeDesiredTier(avgFps)

    if (desiredTier === this.currentTier) {
      // Reset pending transition
      this.pendingTier = null
      this.pendingTierSince = 0
      return
    }

    const now = performance.now()
    const isUpgrade = TIER_ORDER.indexOf(desiredTier) > TIER_ORDER.indexOf(this.currentTier)
    const holdMs = isUpgrade ? UPGRADE_HOLD_MS : DOWNGRADE_HOLD_MS

    if (this.pendingTier !== desiredTier) {
      // Start new pending transition
      this.pendingTier = desiredTier
      this.pendingTierSince = now
      return
    }

    // Same pending tier — check if held long enough
    // Emergency: if FPS is critically low (<15), use a much shorter hold time
    const effectiveHold = (!isUpgrade && avgFps < 15) ? EMERGENCY_DOWNGRADE_MS : holdMs
    if (now - this.pendingTierSince >= effectiveHold) {
      this.applyTier(desiredTier)
      this.pendingTier = null
      this.pendingTierSince = 0
    }
  }

  private computeDesiredTier(avgFps: number): QualityTier {
    const currentIdx = TIER_ORDER.indexOf(this.currentTier)
    let desired = this.currentTier

    // Check if we need to downgrade
    for (const { below, maxTier } of DOWNGRADE_THRESHOLDS) {
      if (avgFps < below) {
        const maxIdx = TIER_ORDER.indexOf(maxTier)
        if (currentIdx > maxIdx) { desired = maxTier; break }
      }
    }

    // Check if we can upgrade (only if not downgrading)
    if (desired === this.currentTier) {
      for (const { above, minTier } of UPGRADE_THRESHOLDS) {
        if (avgFps >= above) {
          const minIdx = TIER_ORDER.indexOf(minTier)
          if (currentIdx < minIdx) desired = minTier
          break
        }
      }
    }

    // Enforce battery / external cap
    if (this.maxTierOverride) {
      const capIdx = TIER_ORDER.indexOf(this.maxTierOverride)
      const desiredIdx = TIER_ORDER.indexOf(desired)
      if (desiredIdx > capIdx) desired = this.maxTierOverride
    }

    return desired
  }

  private applyTier(tier: QualityTier): void {
    const prev = this.currentTier
    this.currentTier = tier
    const settings = { ...QUALITY_PRESETS[tier] }
    // For ultra, recalculate pixelRatio at apply-time
    if (tier === 'ultra') {
      settings.pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    }
    logger.info(LogModule.PERFORMANCE, `Quality tier changed: ${prev} → ${tier}`)
    if (this.onQualityChange) {
      this.onQualityChange(tier, settings)
    }
  }

  public lockTier(tier: QualityTier | null): void {
    this.lockedTier = tier
    if (tier) {
      this.applyTier(tier)
      logger.info(LogModule.PERFORMANCE, `Quality tier locked to: ${tier}`)
    } else {
      logger.info(LogModule.PERFORMANCE, 'Quality tier unlocked — adaptive mode')
    }
  }

  public getCurrentTier(): QualityTier {
    return this.currentTier
  }

  public getSettings(tier?: QualityTier): QualitySettings {
    return { ...QUALITY_PRESETS[tier ?? this.currentTier] }
  }

  public getTelemetry(): QualityTelemetry {
    const avgFps = this.fpsSamples.length > 0
      ? this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length
      : 0
    return {
      currentTier: this.currentTier,
      avgFps: Math.round(avgFps),
      minFps: this.minFps === Infinity ? 0 : Math.round(this.minFps),
      maxFps: Math.round(this.maxFps),
      lockedTier: this.lockedTier,
    }
  }

  public resetTelemetry(): void {
    this.minFps = Infinity
    this.maxFps = 0
    this.fpsSamples = []
    this.pendingTier = null
    this.pendingTierSince = 0
  }
}

export const adaptiveQuality = new AdaptiveQualitySystem()