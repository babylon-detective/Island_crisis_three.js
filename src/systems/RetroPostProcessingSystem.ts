import * as THREE from 'three'
import { logger, LogModule } from './Logger'

/**
 * Retro Post-Processing System
 * Applies Sega Saturn-style aesthetic: pixelation, color quantization, dithering, flat shading
 */
export class RetroPostProcessingSystem {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.Camera
  private composer: any // EffectComposer
  private renderTarget: THREE.WebGLRenderTarget
  private depthRenderTarget: THREE.WebGLRenderTarget
  private normalRenderTarget: THREE.WebGLRenderTarget
  private retroPass: THREE.ShaderMaterial
  private retroQuad: THREE.Mesh
  private retroScene: THREE.Scene
  
  // Configuration
  private config = {
    enabled: true,
    pixelSize: 2.0,        // Lower = more pixelated (1.0 = very pixelated, 4.0 = less)
    colorLevels: 8.0,      // Number of color quantization levels (4-16 typical)
    ditherAmount: 0.3,     // Dithering intensity (0.0-1.0)
    contrast: 1.2,         // Contrast boost
    saturation: 1.1,       // Saturation boost
    resolutionScale: 0.75, // Downsample resolution (0.5 = half res, 1.0 = full)
    // Edge detection settings
    edgeThickness: 1.5,         // Edge thickness multiplier
    edgeIntensity: 0.8,         // Edge opacity (0.0-1.0)
    edgeColor: new THREE.Color(0x000000), // Edge color (default black)
    depthEdgeThreshold: 0.01,   // Depth edge sensitivity (0.0 = off)
    normalEdgeThreshold: 0.3    // Normal edge sensitivity (0.0 = off)
  }
  
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    
    // Create render target with downsampled resolution
    const width = Math.floor(window.innerWidth * this.config.resolutionScale)
    const height = Math.floor(window.innerHeight * this.config.resolutionScale)
    
    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,  // Pixelated look
      magFilter: THREE.NearestFilter,  // Pixelated look
      format: THREE.RGBAFormat
    })
    
    // Create depth render target for edge detection
    this.depthRenderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType
    })
    
    // Create normal render target for edge detection
    this.normalRenderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType
    })
    
    // Create retro post-processing shader
    this.retroPass = this.createRetroShader()
    
    // Create fullscreen quad for post-processing
    const quadGeometry = new THREE.PlaneGeometry(2, 2)
    this.retroQuad = new THREE.Mesh(quadGeometry, this.retroPass)
    this.retroScene = new THREE.Scene()
    this.retroScene.add(this.retroQuad)
    
    logger.info(LogModule.SYSTEM, 'Retro Post-Processing System initialized (Sega Saturn style)')
  }
  
  /**
   * Create the retro post-processing shader
   */
  private createRetroShader(): THREE.ShaderMaterial {
    // Load shaders
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `
    
    const fragmentShader = `
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uPixelSize;
      uniform float uColorLevels;
      uniform float uDitherAmount;
      uniform float uContrast;
      uniform float uSaturation;
      
      varying vec2 vUv;
      
      // Dithering pattern (Bayer 4x4)
      float ditherPattern(vec2 coord) {
        int x = int(mod(coord.x, 4.0));
        int y = int(mod(coord.y, 4.0));
        
        // Bayer 4x4 matrix
        float bayer[16];
        bayer[0] = 0.0 / 16.0;  bayer[1] = 8.0 / 16.0;  bayer[2] = 2.0 / 16.0;  bayer[3] = 10.0 / 16.0;
        bayer[4] = 12.0 / 16.0; bayer[5] = 4.0 / 16.0;  bayer[6] = 14.0 / 16.0; bayer[7] = 6.0 / 16.0;
        bayer[8] = 3.0 / 16.0;  bayer[9] = 11.0 / 16.0; bayer[10] = 1.0 / 16.0; bayer[11] = 9.0 / 16.0;
        bayer[12] = 15.0 / 16.0; bayer[13] = 7.0 / 16.0; bayer[14] = 13.0 / 16.0; bayer[15] = 5.0 / 16.0;
        
        return bayer[y * 4 + x];
      }
      
      // Quantize/posterize color
      vec3 quantizeColor(vec3 color, float levels) {
        return floor(color * levels) / levels;
      }
      
      // Pixelate coordinates
      vec2 pixelate(vec2 uv, vec2 resolution, float pixelSize) {
        vec2 pixelScale = resolution / pixelSize;
        return floor(uv * pixelScale) / pixelScale;
      }
      
      void main() {
        // Pixelate the UV coordinates
        vec2 pixelatedUv = pixelate(vUv, uResolution, uPixelSize);
        
        // Sample the texture
        vec4 color = texture2D(tDiffuse, pixelatedUv);
        
        // Apply contrast
        color.rgb = (color.rgb - 0.5) * uContrast + 0.5;
        
        // Apply saturation
        float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        color.rgb = mix(vec3(gray), color.rgb, uSaturation);
        
        // Quantize/posterize colors
        color.rgb = quantizeColor(color.rgb, uColorLevels);
        
        // Apply dithering
        vec2 ditherCoord = gl_FragCoord.xy;
        float dither = ditherPattern(ditherCoord) - 0.5;
        color.rgb += dither * uDitherAmount / uColorLevels;
        
        // Clamp to valid range
        color.rgb = clamp(color.rgb, 0.0, 1.0);
        
        gl_FragColor = color;
      }
    `
    
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        tNormal: { value: null },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uTime: { value: 0 },
        uPixelSize: { value: this.config.pixelSize },
        uColorLevels: { value: this.config.colorLevels },
        uDitherAmount: { value: this.config.ditherAmount },
        uContrast: { value: this.config.contrast },
        uSaturation: { value: this.config.saturation },
        uEdgeThickness: { value: this.config.edgeThickness },
        uEdgeIntensity: { value: this.config.edgeIntensity },
        uEdgeColor: { value: this.config.edgeColor },
        uDepthEdgeThreshold: { value: this.config.depthEdgeThreshold },
        uNormalEdgeThreshold: { value: this.config.normalEdgeThreshold }
      },
      vertexShader,
      fragmentShader
    })
  }
  
  /**
   * Render with retro post-processing
   * @param camera Optional camera override (for player camera switching)
   */
  public render(camera?: THREE.Camera): void {
    const currentCamera = camera || this.camera
    
    if (!this.config.enabled) {
      // Render normally without post-processing
      this.renderer.render(this.scene, currentCamera)
      return
    }
    
    // Update uniforms
    this.retroPass.uniforms.uTime.value = performance.now() * 0.001
    this.retroPass.uniforms.uResolution.value.set(
      this.renderTarget.width,
      this.renderTarget.height
    )
    this.retroPass.uniforms.uPixelSize.value = this.config.pixelSize
    this.retroPass.uniforms.uColorLevels.value = this.config.colorLevels
    this.retroPass.uniforms.uDitherAmount.value = this.config.ditherAmount
    this.retroPass.uniforms.uContrast.value = this.config.contrast
    this.retroPass.uniforms.uSaturation.value = this.config.saturation
    this.retroPass.uniforms.uEdgeThickness.value = this.config.edgeThickness
    this.retroPass.uniforms.uEdgeIntensity.value = this.config.edgeIntensity
    this.retroPass.uniforms.uEdgeColor.value.copy(this.config.edgeColor)
    this.retroPass.uniforms.uDepthEdgeThreshold.value = this.config.depthEdgeThreshold
    this.retroPass.uniforms.uNormalEdgeThreshold.value = this.config.normalEdgeThreshold
    
    const oldRenderTarget = this.renderer.getRenderTarget()
    
    // Render scene to render target (downsampled)
    this.renderer.setRenderTarget(this.renderTarget)
    this.renderer.render(this.scene, currentCamera)
    
    // Render depth buffer
    this.renderDepth(currentCamera)
    
    // Render normal buffer
    this.renderNormals(currentCamera)
    
    // Set the render target textures for post-processing
    this.retroPass.uniforms.tDiffuse.value = this.renderTarget.texture
    this.retroPass.uniforms.tDepth.value = this.depthRenderTarget.texture
    this.retroPass.uniforms.tNormal.value = this.normalRenderTarget.texture
    
    // Create orthographic camera for fullscreen quad
    const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    
    // Render post-processed quad to screen
    this.renderer.setRenderTarget(null)
    this.renderer.render(this.retroScene, orthoCamera)
    
    // Restore previous render target
    this.renderer.setRenderTarget(oldRenderTarget)
  }
  
  /**
   * Render depth buffer for edge detection
   */
  private renderDepth(camera: THREE.Camera): void {
    // Store original materials
    const originalMaterials = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>()
    
    this.scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        const mesh = object as THREE.Mesh
        originalMaterials.set(mesh, mesh.material)
        // Use MeshDepthMaterial to render depth
        mesh.material = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking
        })
      }
    })
    
    this.renderer.setRenderTarget(this.depthRenderTarget)
    this.renderer.render(this.scene, camera)
    
    // Restore original materials
    originalMaterials.forEach((material, mesh) => {
      (mesh as THREE.Mesh).material = material
    })
  }
  
  /**
   * Render normal buffer for edge detection
   */
  private renderNormals(camera: THREE.Camera): void {
    // Store original materials
    const originalMaterials = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>()
    
    this.scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        const mesh = object as THREE.Mesh
        originalMaterials.set(mesh, mesh.material)
        // Use MeshNormalMaterial to render normals
        mesh.material = new THREE.MeshNormalMaterial()
      }
    })
    
    this.renderer.setRenderTarget(this.normalRenderTarget)
    this.renderer.render(this.scene, camera)
    
    // Restore original materials
    originalMaterials.forEach((material, mesh) => {
      (mesh as THREE.Mesh).material = material
    })
  }
  
  /**
   * Handle window resize
   */
  public handleResize(): void {
    const width = Math.floor(window.innerWidth * this.config.resolutionScale)
    const height = Math.floor(window.innerHeight * this.config.resolutionScale)
    
    this.renderTarget.setSize(width, height)
    this.depthRenderTarget.setSize(width, height)
    this.normalRenderTarget.setSize(width, height)
    this.retroPass.uniforms.uResolution.value.set(width, height)
  }
  
  /**
   * Enable/disable retro effects
   */
  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled
    logger.info(LogModule.SYSTEM, `Retro post-processing ${enabled ? 'enabled' : 'disabled'}`)
  }
  
  /**
   * Set pixel size (lower = more pixelated)
   */
  public setPixelSize(size: number): void {
    this.config.pixelSize = Math.max(1.0, size)
  }
  
  /**
   * Set color quantization levels
   */
  public setColorLevels(levels: number): void {
    this.config.colorLevels = Math.max(2, Math.floor(levels))
  }
  
  /**
   * Set dithering amount
   */
  public setDitherAmount(amount: number): void {
    this.config.ditherAmount = Math.max(0, Math.min(1, amount))
  }
  
  /**
   * Set resolution scale (lower = more pixelated)
   */
  public setResolutionScale(scale: number): void {
    this.config.resolutionScale = Math.max(0.25, Math.min(1.0, scale))
    this.handleResize()
  }
  
  /**
   * Set edge detection parameters
   */
  public setEdgeThickness(thickness: number): void {
    this.config.edgeThickness = Math.max(0, thickness)
  }
  
  public setEdgeIntensity(intensity: number): void {
    this.config.edgeIntensity = Math.max(0, Math.min(1, intensity))
  }
  
  public setEdgeColor(color: THREE.Color): void {
    this.config.edgeColor.copy(color)
  }
  
  public setDepthEdgeThreshold(threshold: number): void {
    this.config.depthEdgeThreshold = Math.max(0, threshold)
  }
  
  public setNormalEdgeThreshold(threshold: number): void {
    this.config.normalEdgeThreshold = Math.max(0, threshold)
  }
  
  /**
   * Get current configuration
   */
  public getConfig() {
    return { ...this.config }
  }
  
  /**
   * Dispose resources
   */
  public dispose(): void {
    this.renderTarget.dispose()
    this.depthRenderTarget.dispose()
    this.normalRenderTarget.dispose()
    this.retroPass.dispose()
    this.retroQuad.geometry.dispose()
  }
}

