// ============================================================================
// PARAMETER INTEGRATION SYSTEM
// ============================================================================

import * as THREE from 'three'
import { ParameterManager, ParameterCategory } from './ParameterManager'
import { logger, LogModule } from './Logger'

export interface SystemIntegration {
  oceanSystem?: any
  landSystem?: any
  skySystem?: any
  lightingSystem?: any
  cameraManager?: any
  playerController?: any
}

export class ParameterIntegration {
  private parameterManager: ParameterManager
  private systems: SystemIntegration

  constructor(parameterManager: ParameterManager, systems: SystemIntegration) {
    this.parameterManager = parameterManager
    this.systems = systems
    this.setupParameterCallbacks()
    logger.info(LogModule.SYSTEM, 'ParameterIntegration initialized')
  }

  // ============================================================================
  // PARAMETER CALLBACK SETUP
  // ============================================================================

  private setupParameterCallbacks(): void {
    // Ocean parameters
    this.parameterManager.onCategoryChange('ocean', (category, parameterId, value) => {
      this.updateOceanParameter(parameterId, value)
    })

    // Land parameters
    this.parameterManager.onCategoryChange('land', (category, parameterId, value) => {
      this.updateLandParameter(parameterId, value)
    })

    // Sky parameters
    this.parameterManager.onCategoryChange('sky', (category, parameterId, value) => {
      this.updateSkyParameter(parameterId, value)
    })

    // Lighting parameters
    this.parameterManager.onCategoryChange('lighting', (category, parameterId, value) => {
      this.updateLightingParameter(parameterId, value)
    })

    // Camera parameters
    this.parameterManager.onCategoryChange('camera', (category, parameterId, value) => {
      this.updateCameraParameter(parameterId, value)
    })

    // Player parameters
    this.parameterManager.onCategoryChange('player', (category, parameterId, value) => {
      this.updatePlayerParameter(parameterId, value)
    })
  }

  // ============================================================================
  // SYSTEM UPDATE METHODS
  // ============================================================================

  private updateOceanParameter(parameterId: string, value: any): void {
    if (!this.systems.oceanSystem) {
      logger.warn(LogModule.SYSTEM, 'Ocean system not available for parameter update')
      return
    }

    try {
      switch (parameterId) {
        case 'amplitude':
          this.systems.oceanSystem.setWaveAmplitude(value)
          break
        case 'windDirectionX':
        case 'windDirectionZ':
          const x = this.parameterManager.getParameter('ocean', 'windDirectionX')
          const z = this.parameterManager.getParameter('ocean', 'windDirectionZ')
          this.systems.oceanSystem.setWindDirection(x, z)
          break
        case 'windStrength':
          this.systems.oceanSystem.setWindStrength(value)
          break
        case 'waveLength':
          // Update wave length if method exists
          if (this.systems.oceanSystem.setWaveLength) {
            this.systems.oceanSystem.setWaveLength(value)
          }
          break
        case 'waveSpeed':
          // Update wave speed if method exists
          if (this.systems.oceanSystem.setWaveSpeed) {
            this.systems.oceanSystem.setWaveSpeed(value)
          }
          break
        case 'waterColor':
        case 'deepWaterColor':
          const shallowColor = new THREE.Color(this.parameterManager.getParameter('ocean', 'waterColor'))
          const deepColor = new THREE.Color(this.parameterManager.getParameter('ocean', 'deepWaterColor'))
          this.systems.oceanSystem.setWaterColors(shallowColor, deepColor)
          break
        case 'transparency':
          // Update transparency if method exists
          if (this.systems.oceanSystem.setTransparency) {
            this.systems.oceanSystem.setTransparency(value)
          }
          break
        case 'reflectionStrength':
          // Update reflection strength if method exists
          if (this.systems.oceanSystem.setReflectionStrength) {
            this.systems.oceanSystem.setReflectionStrength(value)
          }
          break
        default:
          logger.debug(LogModule.SYSTEM, `Ocean parameter ${parameterId} not handled`)
      }
    } catch (error) {
      logger.error(LogModule.SYSTEM, `Error updating ocean parameter ${parameterId}:`, error)
    }
  }

  private updateLandParameter(parameterId: string, value: any): void {
    if (!this.systems.landSystem) {
      logger.warn(LogModule.SYSTEM, 'Land system not available for parameter update')
      return
    }

    try {
      switch (parameterId) {
        case 'elevation':
          this.systems.landSystem.setElevation(value)
          break
        case 'roughness':
          this.systems.landSystem.setRoughness(value)
          break
        case 'scale':
          this.systems.landSystem.setScale(value)
          break
        case 'landColor':
        case 'rockColor':
        case 'sandColor':
          const landColor = new THREE.Color(this.parameterManager.getParameter('land', 'landColor'))
          const rockColor = new THREE.Color(this.parameterManager.getParameter('land', 'rockColor'))
          const sandColor = new THREE.Color(this.parameterManager.getParameter('land', 'sandColor'))
          this.systems.landSystem.setLandColor(landColor)
          this.systems.landSystem.setRockColor(rockColor)
          this.systems.landSystem.setSandColor(sandColor)
          break
        case 'moisture':
          this.systems.landSystem.setMoisture(value)
          break
        case 'islandRadius':
          this.systems.landSystem.setIslandRadius(value)
          break
        case 'coastSmoothness':
          this.systems.landSystem.setCoastSmoothness(value)
          break
        case 'seaLevel':
          this.systems.landSystem.setSeaLevel(value)
          break
        default:
          logger.debug(LogModule.SYSTEM, `Land parameter ${parameterId} not handled`)
      }
      
      // Log parameter change for debugging
      logger.debug(LogModule.SYSTEM, `Land parameter updated: ${parameterId} = ${value}`)
      
    } catch (error) {
      logger.error(LogModule.SYSTEM, `Error updating land parameter ${parameterId}:`, error)
    }
  }

  private updateSkyParameter(parameterId: string, value: any): void {
    if (!this.systems.skySystem) {
      logger.warn(LogModule.SYSTEM, 'Sky system not available for parameter update')
      return
    }

    try {
      switch (parameterId) {
        case 'turbidity':
          this.systems.skySystem.turbidity = value
          break
        case 'rayleigh':
          this.systems.skySystem.rayleigh = value
          break
        case 'mieCoefficient':
          this.systems.skySystem.mieCoefficient = value
          break
        case 'mieDirectionalG':
          this.systems.skySystem.mieDirectionalG = value
          break
        case 'elevation':
          this.systems.skySystem.elevation = value
          break
        case 'azimuth':
          this.systems.skySystem.azimuth = value
          break
        case 'exposure':
          this.systems.skySystem.exposure = value
          break
        default:
          logger.debug(LogModule.SYSTEM, `Sky parameter ${parameterId} not handled`)
      }
    } catch (error) {
      logger.error(LogModule.SYSTEM, `Error updating sky parameter ${parameterId}:`, error)
    }
  }

  private updateLightingParameter(parameterId: string, value: any): void {
    if (!this.systems.lightingSystem) {
      // Lighting system is optional, silently skip if not available
      return
    }

    try {
      switch (parameterId) {
        case 'shadowMapSize':
          // Update shadow map size if method exists
          if (this.systems.lightingSystem.setShadowMapSize) {
            this.systems.lightingSystem.setShadowMapSize(value)
          }
          break
        case 'shadowRadius':
          // Update shadow radius if method exists
          if (this.systems.lightingSystem.setShadowRadius) {
            this.systems.lightingSystem.setShadowRadius(value)
          }
          break
        case 'shadowBlur':
          // Update shadow blur if method exists
          if (this.systems.lightingSystem.setShadowBlur) {
            this.systems.lightingSystem.setShadowBlur(value)
          }
          break
        case 'sunIntensity':
          // Update sun intensity if method exists
          if (this.systems.lightingSystem.setSunIntensity) {
            this.systems.lightingSystem.setSunIntensity(value)
          }
          break
        case 'ambientIntensity':
          // Update ambient intensity if method exists
          if (this.systems.lightingSystem.setAmbientIntensity) {
            this.systems.lightingSystem.setAmbientIntensity(value)
          }
          break
        case 'shadowBias':
          // Update shadow bias if method exists
          if (this.systems.lightingSystem.setShadowBias) {
            this.systems.lightingSystem.setShadowBias(value)
          }
          break
        default:
          logger.debug(LogModule.SYSTEM, `Lighting parameter ${parameterId} not handled`)
      }
    } catch (error) {
      logger.error(LogModule.SYSTEM, `Error updating lighting parameter ${parameterId}:`, error)
    }
  }

  private updateCameraParameter(parameterId: string, value: any): void {
    if (!this.systems.cameraManager) {
      logger.warn(LogModule.SYSTEM, 'Camera manager not available for parameter update')
      return
    }

    try {
      switch (parameterId) {
        case 'positionX':
        case 'positionY':
        case 'positionZ':
          const x = this.parameterManager.getParameter('camera', 'positionX')
          const y = this.parameterManager.getParameter('camera', 'positionY')
          const z = this.parameterManager.getParameter('camera', 'positionZ')
          const camera = this.systems.cameraManager.getCamera()
          if (camera) {
            camera.position.set(x, y, z)
          }
          break
        case 'fov':
          const camera2 = this.systems.cameraManager.getCamera()
          if (camera2 && 'fov' in camera2) {
            camera2.fov = value
            camera2.updateProjectionMatrix()
          }
          break
        case 'zoom':
          // Orthographic camera no longer used - skip this parameter
          // const orthoCamera = this.systems.cameraManager.getOrthographicCamera()
          // if (orthoCamera) {
          //   orthoCamera.zoom = value
          //   orthoCamera.updateProjectionMatrix()
          // }
          break
        
        // Shoulder view parameters
        case 'shoulderOffsetX':
        case 'shoulderOffsetY':
        case 'shoulderOffsetZ':
        case 'shoulderFOV':
          this.updateViewParameters('shoulder')
          break
        
        // Overhead view parameters
        case 'overheadOffsetX':
        case 'overheadOffsetY':
        case 'overheadOffsetZ':
        case 'overheadFrustumSize':
          this.updateViewParameters('overhead')
          break
        
        default:
          logger.debug(LogModule.SYSTEM, `Camera parameter ${parameterId} not handled`)
      }
    } catch (error) {
      logger.error(LogModule.SYSTEM, `Error updating camera parameter ${parameterId}:`, error)
    }
  }

  /**
   * Update a specific camera view configuration
   */
  private updateViewParameters(view: 'shoulder' | 'overhead'): void {
    if (!this.systems.cameraManager) return

    const prefix = view
    const offsetX = this.parameterManager.getParameter('camera', `${prefix}OffsetX`)
    const offsetY = this.parameterManager.getParameter('camera', `${prefix}OffsetY`)
    const offsetZ = this.parameterManager.getParameter('camera', `${prefix}OffsetZ`)
    
    const offset: any = {
      position: new THREE.Vector3(offsetX, offsetY, offsetZ)
    }

    if (view === 'shoulder') {
      const fov = this.parameterManager.getParameter('camera', `${prefix}FOV`)
      offset.fov = fov
    } else if (view === 'overhead') {
      const frustumSize = this.parameterManager.getParameter('camera', 'overheadFrustumSize')
      // Store frustum size for orthographic camera update
      if (this.systems.cameraManager.updateOrthographicFrustum) {
        this.systems.cameraManager.updateOrthographicFrustum(frustumSize)
      }
    }

    // updateViewOffset method no longer exists - skip this call
    // this.systems.cameraManager.updateViewOffset(view, offset)
  }

  private updatePlayerParameter(parameterId: string, value: any): void {
    if (!this.systems.playerController) {
      logger.warn(LogModule.SYSTEM, 'Player controller not available for parameter update')
      return
    }

    try {
      switch (parameterId) {
        case 'walkSpeed':
        case 'runSpeed':
        case 'jumpForce':
        case 'gravity':
        case 'radius':
        case 'height':
        case 'friction':
        case 'airResistance':
          const config: any = {}
          config[parameterId] = value
          this.systems.playerController.updateConfig(config)
          break
        default:
          logger.debug(LogModule.SYSTEM, `Player parameter ${parameterId} not handled`)
      }
    } catch (error) {
      logger.error(LogModule.SYSTEM, `Error updating player parameter ${parameterId}:`, error)
    }
  }

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  /**
   * Update systems with current parameter values
   */
  public updateAllSystems(): void {
    const categories: ParameterCategory[] = ['ocean', 'land', 'sky', 'lighting', 'camera', 'player']
    
    categories.forEach(category => {
      const parameters = this.parameterManager.getCategoryParameters(category)
      parameters.forEach(parameter => {
        this.updateParameter(category, parameter.id, parameter.currentValue)
      })
    })
  }

  /**
   * Update a specific parameter
   */
  public updateParameter(category: ParameterCategory, parameterId: string, value: any): void {
    switch (category) {
      case 'ocean':
        this.updateOceanParameter(parameterId, value)
        break
      case 'land':
        this.updateLandParameter(parameterId, value)
        break
      case 'sky':
        this.updateSkyParameter(parameterId, value)
        break
      case 'lighting':
        this.updateLightingParameter(parameterId, value)
        break
      case 'camera':
        this.updateCameraParameter(parameterId, value)
        break
      case 'player':
        this.updatePlayerParameter(parameterId, value)
        break
      default:
        logger.warn(LogModule.SYSTEM, `Unknown parameter category: ${category}`)
    }
  }

  /**
   * Dispose of the integration
   */
  public dispose(): void {
    // Clear any references
    this.systems = {} as SystemIntegration
    logger.info(LogModule.SYSTEM, 'ParameterIntegration disposed')
  }
} 