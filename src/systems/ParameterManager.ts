// ============================================================================
// MODULAR PARAMETER MANAGEMENT SYSTEM
// ============================================================================

import * as THREE from 'three'
import { logger, LogModule } from './Logger'

// Parameter categories for modular management
export type ParameterCategory = 'ocean' | 'land' | 'sky' | 'lighting' | 'camera' | 'player' | 'system'

// Parameter definition interface
export interface ParameterDefinition {
  id: string
  category: ParameterCategory
  type: 'number' | 'color' | 'vector3' | 'boolean' | 'string'
  min?: number
  max?: number
  step?: number
  defaultValue: any
  currentValue: any
  description?: string
  unit?: string
}

// Parameter set for each category
export interface ParameterSet {
  id: string
  name: string
  description: string
  parameters: ParameterDefinition[]
  version: string
  lastModified: number
}

// Complete parameter configuration
export interface ParameterConfiguration {
  id: string
  version: string
  lastModified: number
  categories: Record<ParameterCategory, ParameterSet>
}

// Default parameter sets - modular and immutable
export const DEFAULT_PARAMETER_SETS: Record<ParameterCategory, ParameterSet> = {
  ocean: {
    id: 'ocean-default',
    name: 'Ocean Default',
    description: 'Default ocean parameters for realistic water simulation',
    version: '1.0.0',
    lastModified: Date.now(),
    parameters: [
      { id: 'amplitude', category: 'ocean', type: 'number', min: 0, max: 2, step: 0.01, defaultValue: 0.5, currentValue: 0.5, description: 'Wave amplitude', unit: 'units' },
      { id: 'windDirectionX', category: 'ocean', type: 'number', min: -1, max: 1, step: 0.1, defaultValue: 1, currentValue: 1, description: 'Wind direction X' },
      { id: 'windDirectionZ', category: 'ocean', type: 'number', min: -1, max: 1, step: 0.1, defaultValue: 0.5, currentValue: 0.5, description: 'Wind direction Z' },
      { id: 'windStrength', category: 'ocean', type: 'number', min: 0, max: 3, step: 0.1, defaultValue: 1.0, currentValue: 1.0, description: 'Wind strength', unit: 'units' },
      { id: 'waveLength', category: 'ocean', type: 'number', min: 0.5, max: 5, step: 0.1, defaultValue: 2.0, currentValue: 2.0, description: 'Wave length', unit: 'units' },
      { id: 'waveSpeed', category: 'ocean', type: 'number', min: 0.1, max: 3, step: 0.1, defaultValue: 1.0, currentValue: 1.0, description: 'Wave speed', unit: 'units/s' },
      { id: 'waterColor', category: 'ocean', type: 'color', defaultValue: '#006994', currentValue: '#006994', description: 'Shallow water color' },
      { id: 'deepWaterColor', category: 'ocean', type: 'color', defaultValue: '#003366', currentValue: '#003366', description: 'Deep water color' },
      { id: 'foamColor', category: 'ocean', type: 'color', defaultValue: '#ffffff', currentValue: '#ffffff', description: 'Foam color' },
      { id: 'transparency', category: 'ocean', type: 'number', min: 0, max: 1, step: 0.01, defaultValue: 0.8, currentValue: 0.8, description: 'Water transparency' },
      { id: 'reflectionStrength', category: 'ocean', type: 'number', min: 0, max: 1, step: 0.01, defaultValue: 0.6, currentValue: 0.6, description: 'Reflection strength' }
    ]
  },

  land: {
    id: 'land-default',
    name: 'Land Default',
    description: 'Default land parameters for terrain generation',
    version: '1.0.0',
    lastModified: Date.now(),
    parameters: [
      { id: 'elevation', category: 'land', type: 'number', min: 0, max: 20, step: 0.1, defaultValue: 8.0, currentValue: 8.0, description: 'Terrain elevation', unit: 'units' },
      { id: 'roughness', category: 'land', type: 'number', min: 0, max: 3, step: 0.1, defaultValue: 1.2, currentValue: 1.2, description: 'Terrain roughness' },
      { id: 'scale', category: 'land', type: 'number', min: 0.1, max: 8, step: 0.1, defaultValue: 0.8, currentValue: 0.8, description: 'Terrain scale' },
      { id: 'landColor', category: 'land', type: 'color', defaultValue: '#4a7c59', currentValue: '#4a7c59', description: 'Land color' },
      { id: 'rockColor', category: 'land', type: 'color', defaultValue: '#8b7355', currentValue: '#8b7355', description: 'Rock color' },
      { id: 'sandColor', category: 'land', type: 'color', defaultValue: '#c2b280', currentValue: '#c2b280', description: 'Sand color' },
      { id: 'moisture', category: 'land', type: 'number', min: 0, max: 1, step: 0.01, defaultValue: 0.3, currentValue: 0.3, description: 'Moisture level' },
      { id: 'islandRadius', category: 'land', type: 'number', min: 5, max: 150, step: 1, defaultValue: 35.0, currentValue: 35.0, description: 'Island radius', unit: 'units' },
      { id: 'coastSmoothness', category: 'land', type: 'number', min: 1, max: 30, step: 0.5, defaultValue: 8.0, currentValue: 8.0, description: 'Coast smoothness' },
      { id: 'seaLevel', category: 'land', type: 'number', min: -15, max: 2, step: 0.1, defaultValue: -4.0, currentValue: -4.0, description: 'Sea level', unit: 'units' }
    ]
  },

  sky: {
    id: 'sky-default',
    name: 'Sky Default',
    description: 'Default sky parameters for atmospheric simulation',
    version: '1.0.0',
    lastModified: Date.now(),
    parameters: [
      { id: 'turbidity', category: 'sky', type: 'number', min: 0, max: 20, step: 0.1, defaultValue: 10, currentValue: 10, description: 'Atmospheric turbidity' },
      { id: 'rayleigh', category: 'sky', type: 'number', min: 0, max: 4, step: 0.001, defaultValue: 3, currentValue: 3, description: 'Rayleigh scattering' },
      { id: 'mieCoefficient', category: 'sky', type: 'number', min: 0, max: 0.1, step: 0.001, defaultValue: 0.005, currentValue: 0.005, description: 'Mie coefficient' },
      { id: 'mieDirectionalG', category: 'sky', type: 'number', min: 0, max: 1, step: 0.001, defaultValue: 0.7, currentValue: 0.7, description: 'Mie directional G' },
      { id: 'elevation', category: 'sky', type: 'number', min: -90, max: 90, step: 1, defaultValue: 2, currentValue: 2, description: 'Sun elevation', unit: 'degrees' },
      { id: 'azimuth', category: 'sky', type: 'number', min: -180, max: 180, step: 1, defaultValue: 180, currentValue: 180, description: 'Sun azimuth', unit: 'degrees' },
      { id: 'exposure', category: 'sky', type: 'number', min: 0, max: 1, step: 0.001, defaultValue: 0.5, currentValue: 0.5, description: 'Sky exposure' }
    ]
  },

  lighting: {
    id: 'lighting-default',
    name: 'Lighting Default',
    description: 'Default lighting parameters for scene illumination',
    version: '1.0.0',
    lastModified: Date.now(),
    parameters: [
      { id: 'shadowMapSize', category: 'lighting', type: 'number', min: 1024, max: 8192, step: 1024, defaultValue: 4096, currentValue: 4096, description: 'Shadow map size', unit: 'pixels' },
      { id: 'shadowRadius', category: 'lighting', type: 'number', min: 0, max: 20, step: 1, defaultValue: 10, currentValue: 10, description: 'Shadow radius', unit: 'units' },
      { id: 'shadowBlur', category: 'lighting', type: 'number', min: 0, max: 50, step: 1, defaultValue: 25, currentValue: 25, description: 'Shadow blur', unit: 'pixels' },
      { id: 'sunIntensity', category: 'lighting', type: 'number', min: 0, max: 3, step: 0.1, defaultValue: 1.2, currentValue: 1.2, description: 'Sun intensity' },
      { id: 'ambientIntensity', category: 'lighting', type: 'number', min: 0, max: 1, step: 0.01, defaultValue: 0.3, currentValue: 0.3, description: 'Ambient intensity' },
      { id: 'shadowBias', category: 'lighting', type: 'number', min: -0.01, max: 0.01, step: 0.0001, defaultValue: -0.0001, currentValue: -0.0001, description: 'Shadow bias' }
    ]
  },

  camera: {
    id: 'camera-default',
    name: 'Camera Default',
    description: 'Default camera parameters for scene viewing',
    version: '1.0.0',
    lastModified: Date.now(),
    parameters: [
      { id: 'positionX', category: 'camera', type: 'number', min: -50, max: 50, step: 0.1, defaultValue: 0, currentValue: 0, description: 'Camera X position', unit: 'units' },
      { id: 'positionY', category: 'camera', type: 'number', min: -50, max: 50, step: 0.1, defaultValue: 5, currentValue: 5, description: 'Camera Y position', unit: 'units' },
      { id: 'positionZ', category: 'camera', type: 'number', min: -50, max: 50, step: 0.1, defaultValue: 5, currentValue: 5, description: 'Camera Z position', unit: 'units' },
      { id: 'fov', category: 'camera', type: 'number', min: 10, max: 150, step: 1, defaultValue: 75, currentValue: 75, description: 'Field of view', unit: 'degrees' },
      { id: 'zoom', category: 'camera', type: 'number', min: 0.1, max: 10, step: 0.1, defaultValue: 3, currentValue: 3, description: 'Camera zoom' },
      
      // Shoulder View
      { id: 'shoulderOffsetX', category: 'camera', type: 'number', min: -10, max: 10, step: 0.1, defaultValue: 1.2, currentValue: 1.2, description: 'Shoulder: Offset X' },
      { id: 'shoulderOffsetY', category: 'camera', type: 'number', min: -10, max: 10, step: 0.1, defaultValue: 1.8, currentValue: 1.8, description: 'Shoulder: Offset Y' },
      { id: 'shoulderOffsetZ', category: 'camera', type: 'number', min: -10, max: 10, step: 0.1, defaultValue: -3, currentValue: -3, description: 'Shoulder: Offset Z' },
      { id: 'shoulderFOV', category: 'camera', type: 'number', min: 10, max: 150, step: 1, defaultValue: 75, currentValue: 75, description: 'Shoulder: FOV', unit: 'degrees' },
      
      // Overhead View
      { id: 'overheadOffsetX', category: 'camera', type: 'number', min: -20, max: 20, step: 0.1, defaultValue: 0, currentValue: 0, description: 'Overhead: Offset X' },
      { id: 'overheadOffsetY', category: 'camera', type: 'number', min: 5, max: 100, step: 0.5, defaultValue: 50, currentValue: 50, description: 'Overhead: Offset Y' },
      { id: 'overheadOffsetZ', category: 'camera', type: 'number', min: -20, max: 20, step: 0.1, defaultValue: 0, currentValue: 0, description: 'Overhead: Offset Z' },
      { id: 'overheadFrustumSize', category: 'camera', type: 'number', min: 10, max: 200, step: 1, defaultValue: 50, currentValue: 50, description: 'Overhead: Frustum Size' }
    ]
  },

  player: {
    id: 'player-default',
    name: 'Player Default',
    description: 'Default player parameters for movement and physics',
    version: '1.0.0',
    lastModified: Date.now(),
    parameters: [
      { id: 'walkSpeed', category: 'player', type: 'number', min: 1, max: 500, step: 0.5, defaultValue: 250.0, currentValue: 250.0, description: 'Walk speed', unit: 'units/s' },
      { id: 'runSpeed', category: 'player', type: 'number', min: 5, max: 800, step: 0.5, defaultValue: 400.0, currentValue: 400.0, description: 'Run speed', unit: 'units/s' },
      { id: 'jumpForce', category: 'player', type: 'number', min: 5, max: 30, step: 0.5, defaultValue: 15.0, currentValue: 15.0, description: 'Jump force', unit: 'units/s' },
      { id: 'gravity', category: 'player', type: 'number', min: 10, max: 50, step: 1, defaultValue: 25.0, currentValue: 25.0, description: 'Gravity strength', unit: 'units/s²' },
      { id: 'radius', category: 'player', type: 'number', min: 0.1, max: 2, step: 0.1, defaultValue: 0.5, currentValue: 0.5, description: 'Player radius', unit: 'units' },
      { id: 'height', category: 'player', type: 'number', min: 1, max: 3, step: 0.1, defaultValue: 1.8, currentValue: 1.8, description: 'Player height', unit: 'units' },
      { id: 'friction', category: 'player', type: 'number', min: 0.1, max: 1, step: 0.05, defaultValue: 0.8, currentValue: 0.8, description: 'Ground friction' },
      { id: 'airResistance', category: 'player', type: 'number', min: 0.5, max: 1, step: 0.01, defaultValue: 0.95, currentValue: 0.95, description: 'Air resistance' }
    ]
  },

  system: {
    id: 'system-default',
    name: 'System Default',
    description: 'Default system parameters for application behavior',
    version: '1.0.0',
    lastModified: Date.now(),
    parameters: [
      { id: 'debugMode', category: 'system', type: 'boolean', defaultValue: false, currentValue: false, description: 'Debug mode enabled' },
      { id: 'performanceMonitoring', category: 'system', type: 'boolean', defaultValue: true, currentValue: true, description: 'Performance monitoring enabled' },
      { id: 'autoSave', category: 'system', type: 'boolean', defaultValue: true, currentValue: true, description: 'Auto-save parameters' },
      { id: 'saveInterval', category: 'system', type: 'number', min: 1000, max: 60000, step: 1000, defaultValue: 5000, currentValue: 5000, description: 'Auto-save interval', unit: 'ms' }
    ]
  }
} as const

// Storage keys
const STORAGE_KEYS = {
  CURRENT_PARAMETERS: 'garden-parameters-current',
  PARAMETER_HISTORY: 'garden-parameters-history',
  SAVED_STATES: 'garden-parameters-saved-states'
} as const

export class ParameterManager {
  private currentParameters: ParameterConfiguration
  private parameterHistory: Array<{ timestamp: number; action: string; parameters: Partial<ParameterConfiguration> }> = []
  private savedStates: Map<string, ParameterConfiguration> = new Map()
  private autoSaveInterval: number | null = null
  private maxHistorySize = 50
  private parameterChangeCallbacks: Map<string, Array<(category: ParameterCategory, parameterId: string, value: any) => void>> = new Map()

  constructor() {
    // Initialize with defaults
    this.currentParameters = this.createDefaultConfiguration()
    
    // Load saved parameters
    this.loadCurrentParameters()
    this.loadParameterHistory()
    this.loadSavedStates()
    
    // Setup auto-save if enabled
    this.setupAutoSave()
    
    logger.info(LogModule.SYSTEM, 'ParameterManager initialized with modular parameter system')
  }

  // ============================================================================
  // CORE PARAMETER METHODS
  // ============================================================================

  /**
   * Get current parameter value
   */
  public getParameter(category: ParameterCategory, parameterId: string): any {
    const categorySet = this.currentParameters.categories[category]
    if (!categorySet) {
      logger.warn(LogModule.SYSTEM, `Category ${category} not found`)
      return null
    }

    const parameter = categorySet.parameters.find(p => p.id === parameterId)
    if (!parameter) {
      logger.warn(LogModule.SYSTEM, `Parameter ${parameterId} not found in category ${category}`)
      return null
    }

    return parameter.currentValue
  }

  /**
   * Set parameter value (persists through debug mode toggle)
   */
  public setParameter(category: ParameterCategory, parameterId: string, value: any, action: string = 'manual_set'): void {
    const categorySet = this.currentParameters.categories[category]
    if (!categorySet) {
      logger.warn(LogModule.SYSTEM, `Category ${category} not found`)
      return
    }

    const parameter = categorySet.parameters.find(p => p.id === parameterId)
    if (!parameter) {
      logger.warn(LogModule.SYSTEM, `Parameter ${parameterId} not found in category ${category}`)
      return
    }

    // Validate value based on type
    if (!this.validateParameterValue(parameter, value)) {
      logger.warn(LogModule.SYSTEM, `Invalid value ${value} for parameter ${parameterId}`)
      return
    }

    // Update parameter
    parameter.currentValue = value
    this.currentParameters.lastModified = Date.now()

    // Add to history
    const historyEntry: Partial<ParameterConfiguration> = {
      categories: {} as Record<ParameterCategory, ParameterSet>
    }
    historyEntry.categories![category] = {
      id: `${category}-history`,
      name: `${category} History`,
      description: `History entry for ${category}`,
      version: '1.0.0',
      lastModified: Date.now(),
      parameters: [{ 
        id: parameterId, 
        category: category,
        type: 'number',
        defaultValue: 0,
        currentValue: value 
      }]
    }
    this.addToHistory(action, historyEntry)

    // Save to storage
    this.saveCurrentParameters()

    // Trigger parameter change callbacks
    this.triggerParameterChangeCallbacks(category, parameterId, value)

    logger.debug(LogModule.SYSTEM, `Parameter updated: ${category}.${parameterId} = ${value}`)
  }

  /**
   * Get all parameters for a category
   */
  public getCategoryParameters(category: ParameterCategory): ParameterDefinition[] {
    const categorySet = this.currentParameters.categories[category]
    return categorySet ? [...categorySet.parameters] : []
  }

  /**
   * Get all current parameters
   */
  public getAllParameters(): ParameterConfiguration {
    return JSON.parse(JSON.stringify(this.currentParameters)) // Deep copy
  }

  /**
   * Register a callback for parameter changes
   */
  public onParameterChange(category: ParameterCategory, parameterId: string, callback: (category: ParameterCategory, parameterId: string, value: any) => void): void {
    const key = `${category}.${parameterId}`
    if (!this.parameterChangeCallbacks.has(key)) {
      this.parameterChangeCallbacks.set(key, [])
    }
    this.parameterChangeCallbacks.get(key)!.push(callback)
  }

  /**
   * Register a callback for all parameter changes in a category
   */
  public onCategoryChange(category: ParameterCategory, callback: (category: ParameterCategory, parameterId: string, value: any) => void): void {
    const key = `${category}.*`
    if (!this.parameterChangeCallbacks.has(key)) {
      this.parameterChangeCallbacks.set(key, [])
    }
    this.parameterChangeCallbacks.get(key)!.push(callback)
  }

  /**
   * Trigger parameter change callbacks
   */
  private triggerParameterChangeCallbacks(category: ParameterCategory, parameterId: string, value: any): void {
    // Trigger specific parameter callbacks
    const specificKey = `${category}.${parameterId}`
    const specificCallbacks = this.parameterChangeCallbacks.get(specificKey)
    if (specificCallbacks) {
      specificCallbacks.forEach(callback => callback(category, parameterId, value))
    }

    // Trigger category callbacks
    const categoryKey = `${category}.*`
    const categoryCallbacks = this.parameterChangeCallbacks.get(categoryKey)
    if (categoryCallbacks) {
      categoryCallbacks.forEach(callback => callback(category, parameterId, value))
    }
  }

  /**
   * Reset category to defaults
   */
  public resetCategory(category: ParameterCategory): void {
    const defaultSet = DEFAULT_PARAMETER_SETS[category]
    if (!defaultSet) {
      logger.warn(LogModule.SYSTEM, `Default set not found for category ${category}`)
      return
    }

    // Reset all parameters in category to defaults
    defaultSet.parameters.forEach(param => {
      this.setParameter(category, param.id, param.defaultValue, 'reset_to_default')
    })

    logger.info(LogModule.SYSTEM, `Category ${category} reset to defaults`)
  }

  /**
   * Reset all parameters to defaults
   */
  public resetAllToDefaults(): void {
    this.currentParameters = this.createDefaultConfiguration()
    this.saveCurrentParameters()
    this.addToHistory('reset_all_to_defaults', this.currentParameters)
    
    logger.info(LogModule.SYSTEM, 'All parameters reset to defaults')
  }

  // ============================================================================
  // SAVED STATES MANAGEMENT
  // ============================================================================

  /**
   * Save current parameters as a named state
   */
  public saveState(name: string): void {
    const state: ParameterConfiguration = {
      ...this.currentParameters,
      id: name,
      lastModified: Date.now()
    }

    this.savedStates.set(name, state)
    this.saveSavedStates()

    logger.info(LogModule.SYSTEM, `Parameters saved as state: ${name}`)
  }

  /**
   * Load a saved state
   */
  public loadState(name: string): boolean {
    const state = this.savedStates.get(name)
    if (!state) {
      logger.warn(LogModule.SYSTEM, `Saved state ${name} not found`)
      return false
    }

    this.currentParameters = { ...state, lastModified: Date.now() }
    this.saveCurrentParameters()
    this.addToHistory('load_state', { 
      categories: this.currentParameters.categories 
    })

    logger.info(LogModule.SYSTEM, `Parameters loaded from state: ${name}`)
    return true
  }

  /**
   * Get all saved state names
   */
  public getSavedStateNames(): string[] {
    return Array.from(this.savedStates.keys())
  }

  /**
   * Delete a saved state
   */
  public deleteState(name: string): boolean {
    const deleted = this.savedStates.delete(name)
    if (deleted) {
      this.saveSavedStates()
      logger.info(LogModule.SYSTEM, `Saved state deleted: ${name}`)
    }
    return deleted
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Check if parameters have been modified from defaults
   */
  public hasModifications(): boolean {
    for (const category of Object.keys(DEFAULT_PARAMETER_SETS) as ParameterCategory[]) {
      const defaultSet = DEFAULT_PARAMETER_SETS[category]
      const currentSet = this.currentParameters.categories[category]

      for (const defaultParam of defaultSet.parameters) {
        const currentParam = currentSet.parameters.find(p => p.id === defaultParam.id)
        if (currentParam && currentParam.currentValue !== defaultParam.defaultValue) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Get modified parameters
   */
  public getModifiedParameters(): Array<{ category: ParameterCategory; parameterId: string; defaultValue: any; currentValue: any }> {
    const modified: Array<{ category: ParameterCategory; parameterId: string; defaultValue: any; currentValue: any }> = []

    for (const category of Object.keys(DEFAULT_PARAMETER_SETS) as ParameterCategory[]) {
      const defaultSet = DEFAULT_PARAMETER_SETS[category]
      const currentSet = this.currentParameters.categories[category]

      for (const defaultParam of defaultSet.parameters) {
        const currentParam = currentSet.parameters.find(p => p.id === defaultParam.id)
        if (currentParam && currentParam.currentValue !== defaultParam.defaultValue) {
          modified.push({
            category,
            parameterId: defaultParam.id,
            defaultValue: defaultParam.defaultValue,
            currentValue: currentParam.currentValue
          })
        }
      }
    }

    return modified
  }

  /**
   * Export parameters as JSON
   */
  public exportParameters(): string {
    return JSON.stringify(this.currentParameters, null, 2)
  }

  /**
   * Import parameters from JSON
   */
  public importParameters(jsonString: string): boolean {
    try {
      const imported = JSON.parse(jsonString) as ParameterConfiguration
      
      // Validate structure
      if (!this.validateConfiguration(imported)) {
        logger.error(LogModule.SYSTEM, 'Invalid parameter configuration structure')
        return false
      }

      this.currentParameters = imported
      this.saveCurrentParameters()
      this.addToHistory('import', imported)

      logger.info(LogModule.SYSTEM, 'Parameters imported successfully')
      return true
    } catch (error) {
      logger.error(LogModule.SYSTEM, 'Failed to import parameters:', error)
      return false
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private createDefaultConfiguration(): ParameterConfiguration {
    return {
      id: 'current',
      version: '1.0.0',
      lastModified: Date.now(),
      categories: JSON.parse(JSON.stringify(DEFAULT_PARAMETER_SETS)) // Deep copy
    }
  }

  private validateParameterValue(parameter: ParameterDefinition, value: any): boolean {
    switch (parameter.type) {
      case 'number':
        if (typeof value !== 'number') return false
        if (parameter.min !== undefined && value < parameter.min) return false
        if (parameter.max !== undefined && value > parameter.max) return false
        return true
      case 'color':
        return typeof value === 'string' && /^#[0-9A-F]{6}$/i.test(value)
      case 'vector3':
        return value instanceof THREE.Vector3
      case 'boolean':
        return typeof value === 'boolean'
      case 'string':
        return typeof value === 'string'
      default:
        return false
    }
  }

  private validateConfiguration(config: any): config is ParameterConfiguration {
    return config && 
           typeof config.id === 'string' &&
           typeof config.version === 'string' &&
           typeof config.lastModified === 'number' &&
           config.categories &&
           typeof config.categories === 'object'
  }

  private addToHistory(action: string, parameters: Partial<ParameterConfiguration>): void {
    this.parameterHistory.push({
      timestamp: Date.now(),
      action,
      parameters
    })

    // Limit history size
    if (this.parameterHistory.length > this.maxHistorySize) {
      this.parameterHistory.shift()
    }

    this.saveParameterHistory()
  }

  private setupAutoSave(): void {
    const autoSaveEnabled = this.getParameter('system', 'autoSave')
    const saveInterval = this.getParameter('system', 'saveInterval')

    if (autoSaveEnabled && saveInterval > 0) {
      this.autoSaveInterval = window.setInterval(() => {
        this.saveCurrentParameters()
      }, saveInterval)
    }
  }

  // ============================================================================
  // PERSISTENCE METHODS
  // ============================================================================

  private saveCurrentParameters(): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CURRENT_PARAMETERS, JSON.stringify(this.currentParameters))
    } catch (error) {
      logger.error(LogModule.SYSTEM, 'Failed to save current parameters:', error)
    }
  }

  private loadCurrentParameters(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_PARAMETERS)
      if (saved) {
        const loaded = JSON.parse(saved) as ParameterConfiguration
        if (this.validateConfiguration(loaded)) {
          this.currentParameters = loaded
          logger.info(LogModule.SYSTEM, 'Current parameters loaded from storage')
        }
      }
    } catch (error) {
      logger.error(LogModule.SYSTEM, 'Failed to load current parameters:', error)
    }
  }

  private saveParameterHistory(): void {
    try {
      localStorage.setItem(STORAGE_KEYS.PARAMETER_HISTORY, JSON.stringify(this.parameterHistory))
    } catch (error) {
      logger.error(LogModule.SYSTEM, 'Failed to save parameter history:', error)
    }
  }

  private loadParameterHistory(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PARAMETER_HISTORY)
      if (saved) {
        this.parameterHistory = JSON.parse(saved)
      }
    } catch (error) {
      logger.error(LogModule.SYSTEM, 'Failed to load parameter history:', error)
    }
  }

  private saveSavedStates(): void {
    try {
      const states = Object.fromEntries(this.savedStates)
      localStorage.setItem(STORAGE_KEYS.SAVED_STATES, JSON.stringify(states))
    } catch (error) {
      logger.error(LogModule.SYSTEM, 'Failed to save states:', error)
    }
  }

  private loadSavedStates(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SAVED_STATES)
      if (saved) {
        const states = JSON.parse(saved)
        this.savedStates = new Map(Object.entries(states))
      }
    } catch (error) {
      logger.error(LogModule.SYSTEM, 'Failed to load saved states:', error)
    }
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  public dispose(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval)
      this.autoSaveInterval = null
    }
  }
} 