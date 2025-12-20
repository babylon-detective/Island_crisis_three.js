// ============================================================================
// PARAMETER GUI INTEGRATION SYSTEM
// ============================================================================

import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import * as THREE from 'three'
import { ParameterManager, ParameterCategory, ParameterDefinition } from './ParameterManager'
import { logger, LogModule } from './Logger'

export interface ParameterGUIConfig {
  container: HTMLElement
  position?: { top: string; right: string }
  width?: number
  autoSave?: boolean
}

export class ParameterGUI {
  private gui: GUI | null = null
  private parameterManager: ParameterManager
  private config: ParameterGUIConfig
  private parameterControllers: Map<string, any> = new Map()
  private categoryFolders: Map<ParameterCategory, GUI> = new Map()

  constructor(parameterManager: ParameterManager, config: ParameterGUIConfig) {
    this.parameterManager = parameterManager
    this.config = {
      position: { top: '0px', right: '0px' },
      width: 300,
      autoSave: true,
      ...config
    }
  }

  // ============================================================================
  // GUI INITIALIZATION
  // ============================================================================

  /**
   * Initialize the parameter GUI
   */
  public initialize(): void {
    this.createGUI()
    this.setupCategoryFolders()
    this.populateParameters()
    this.setupGlobalControls()
    
    logger.info(LogModule.SYSTEM, 'Parameter GUI initialized')
  }

  /**
   * Create the main GUI container
   */
  private createGUI(): void {
    this.gui = new GUI({ width: this.config.width })
    this.gui.domElement.style.position = 'fixed'
    this.gui.domElement.style.top = this.config.position!.top
    this.gui.domElement.style.right = this.config.position!.right
    this.gui.domElement.style.zIndex = '1000'
    
    this.config.container.appendChild(this.gui.domElement)
  }

  /**
   * Setup category folders
   */
  private setupCategoryFolders(): void {
    if (!this.gui) return

    const categories: Array<{ category: ParameterCategory; name: string; icon: string }> = [
      { category: 'sky', name: 'Sky', icon: '☀️' },
      { category: 'lighting', name: 'Lighting', icon: '💡' },
      { category: 'camera', name: 'Camera', icon: '📷' },
      { category: 'player', name: 'Player', icon: '🎮' },
      { category: 'system', name: 'System', icon: '⚙️' }
    ]

    categories.forEach(({ category, name, icon }) => {
      const folder = this.gui!.addFolder(`${icon} ${name}`)
      this.categoryFolders.set(category, folder)
      folder.open()
    })
  }

  /**
   * Populate all parameters in their respective folders
   */
  private populateParameters(): void {
    const categories: ParameterCategory[] = ['sky', 'lighting', 'camera', 'player', 'system']

    categories.forEach(category => {
      const folder = this.categoryFolders.get(category)
      if (!folder) return

      const parameters = this.parameterManager.getCategoryParameters(category)
      parameters.forEach(parameter => {
        this.createParameterController(folder, parameter)
      })
    })
  }

  /**
   * Create a controller for a specific parameter
   */
  private createParameterController(folder: GUI, parameter: ParameterDefinition): void {
    const controllerKey = `${parameter.category}.${parameter.id}`
    
    switch (parameter.type) {
      case 'number':
        this.createNumberController(folder, parameter, controllerKey)
        break
      case 'color':
        this.createColorController(folder, parameter, controllerKey)
        break
      case 'boolean':
        this.createBooleanController(folder, parameter, controllerKey)
        break
      case 'string':
        this.createStringController(folder, parameter, controllerKey)
        break
      case 'vector3':
        this.createVector3Controller(folder, parameter, controllerKey)
        break
    }
  }

  /**
   * Create a number controller
   */
  private createNumberController(folder: GUI, parameter: ParameterDefinition, controllerKey: string): void {
    const currentValue = this.parameterManager.getParameter(parameter.category, parameter.id)
    
    if (parameter.min !== undefined && parameter.max !== undefined) {
      const controller = folder.add(
        { [parameter.id]: currentValue },
        parameter.id,
        parameter.min,
        parameter.max,
        parameter.step || 0.01
      )
      .name(this.formatParameterName(parameter))
      .onChange((value: number) => {
        this.parameterManager.setParameter(parameter.category, parameter.id, value, 'gui_adjustment')
        this.updateParameterValue(controllerKey, value)
      })

      this.parameterControllers.set(controllerKey, controller)
    } else {
      const controller = folder.add(
        { [parameter.id]: currentValue },
        parameter.id
      )
      .name(this.formatParameterName(parameter))
      .onChange((value: number) => {
        this.parameterManager.setParameter(parameter.category, parameter.id, value, 'gui_adjustment')
        this.updateParameterValue(controllerKey, value)
      })

      this.parameterControllers.set(controllerKey, controller)
    }
  }

  /**
   * Create a color controller
   */
  private createColorController(folder: GUI, parameter: ParameterDefinition, controllerKey: string): void {
    const currentValue = this.parameterManager.getParameter(parameter.category, parameter.id)
    
    const controller = folder.addColor(
      { [parameter.id]: currentValue },
      parameter.id
    )
    .name(this.formatParameterName(parameter))
    .onChange((value: string) => {
      this.parameterManager.setParameter(parameter.category, parameter.id, value, 'gui_adjustment')
      this.updateParameterValue(controllerKey, value)
    })

    this.parameterControllers.set(controllerKey, controller)
  }

  /**
   * Create a boolean controller
   */
  private createBooleanController(folder: GUI, parameter: ParameterDefinition, controllerKey: string): void {
    const currentValue = this.parameterManager.getParameter(parameter.category, parameter.id)
    
    const controller = folder.add(
      { [parameter.id]: currentValue },
      parameter.id
    )
    .name(this.formatParameterName(parameter))
    .onChange((value: boolean) => {
      this.parameterManager.setParameter(parameter.category, parameter.id, value, 'gui_adjustment')
      this.updateParameterValue(controllerKey, value)
    })

    this.parameterControllers.set(controllerKey, controller)
  }

  /**
   * Create a string controller
   */
  private createStringController(folder: GUI, parameter: ParameterDefinition, controllerKey: string): void {
    const currentValue = this.parameterManager.getParameter(parameter.category, parameter.id)
    
    const controller = folder.add(
      { [parameter.id]: currentValue },
      parameter.id
    )
    .name(this.formatParameterName(parameter))
    .onChange((value: string) => {
      this.parameterManager.setParameter(parameter.category, parameter.id, value, 'gui_adjustment')
      this.updateParameterValue(controllerKey, value)
    })

    this.parameterControllers.set(controllerKey, controller)
  }

  /**
   * Create a Vector3 controller
   */
  private createVector3Controller(folder: GUI, parameter: ParameterDefinition, controllerKey: string): void {
    const currentValue = this.parameterManager.getParameter(parameter.category, parameter.id)
    const vector = currentValue instanceof THREE.Vector3 ? currentValue : new THREE.Vector3()
    
    const vectorFolder = folder.addFolder(parameter.id)
    
    const xController = vectorFolder.add(vector, 'x', -50, 50, 0.1)
      .name('X')
      .onChange(() => {
        this.parameterManager.setParameter(parameter.category, parameter.id, vector.clone(), 'gui_adjustment')
      })

    const yController = vectorFolder.add(vector, 'y', -50, 50, 0.1)
      .name('Y')
      .onChange(() => {
        this.parameterManager.setParameter(parameter.category, parameter.id, vector.clone(), 'gui_adjustment')
      })

    const zController = vectorFolder.add(vector, 'z', -50, 50, 0.1)
      .name('Z')
      .onChange(() => {
        this.parameterManager.setParameter(parameter.category, parameter.id, vector.clone(), 'gui_adjustment')
      })

    this.parameterControllers.set(`${controllerKey}.x`, xController)
    this.parameterControllers.set(`${controllerKey}.y`, yController)
    this.parameterControllers.set(`${controllerKey}.z`, zController)
  }

  /**
   * Setup global controls for parameter management
   */
  private setupGlobalControls(): void {
    if (!this.gui) return

    const globalFolder = this.gui.addFolder('🔧 Parameter Management')
    
    // Save current state
    globalFolder.add({
      'Save Current State': () => {
        const name = prompt('Enter state name:')
        if (name) {
          this.parameterManager.saveState(name)
          logger.info(LogModule.SYSTEM, `Parameters saved as state: ${name}`)
        }
      }
    }, 'Save Current State')

    // Load state
    const savedStates = this.parameterManager.getSavedStateNames()
    if (savedStates.length > 0) {
      const stateFolder = globalFolder.addFolder('Load Saved States')
      savedStates.forEach(stateName => {
        stateFolder.add({
          [stateName]: () => {
            this.parameterManager.loadState(stateName)
            this.refreshAllParameters()
            logger.info(LogModule.SYSTEM, `Parameters loaded from state: ${stateName}`)
          }
        }, stateName)
      })
    }

    // Reset controls
    const resetFolder = globalFolder.addFolder('Reset Controls')
    resetFolder.add({
      'Reset All to Defaults': () => {
        if (confirm('Are you sure you want to reset all parameters to defaults?')) {
          this.parameterManager.resetAllToDefaults()
          this.refreshAllParameters()
          logger.info(LogModule.SYSTEM, 'All parameters reset to defaults')
        }
      }
    }, 'Reset All to Defaults')

    // Category reset controls
    const categories: Array<{ category: ParameterCategory; name: string }> = [
      { category: 'sky', name: 'Sky' },
      { category: 'lighting', name: 'Lighting' },
      { category: 'camera', name: 'Camera' },
      { category: 'player', name: 'Player' },
      { category: 'system', name: 'System' }
    ]

    categories.forEach(({ category, name }) => {
      resetFolder.add({
        [`Reset ${name}`]: () => {
          if (confirm(`Are you sure you want to reset ${name} parameters to defaults?`)) {
            this.parameterManager.resetCategory(category)
            this.refreshCategoryParameters(category)
            logger.info(LogModule.SYSTEM, `${name} parameters reset to defaults`)
          }
        }
      }, `Reset ${name}`)
    })

    // Export/Import controls
    const exportFolder = globalFolder.addFolder('Export/Import')
    exportFolder.add({
      'Export Parameters': () => {
        const json = this.parameterManager.exportParameters()
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'garden-parameters.json'
        a.click()
        URL.revokeObjectURL(url)
        logger.info(LogModule.SYSTEM, 'Parameters exported')
      }
    }, 'Export Parameters')

    exportFolder.add({
      'Import Parameters': () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json'
        input.onchange = (event) => {
          const file = (event.target as HTMLInputElement).files?.[0]
          if (file) {
            const reader = new FileReader()
            reader.onload = (e) => {
              const json = e.target?.result as string
              if (this.parameterManager.importParameters(json)) {
                this.refreshAllParameters()
                logger.info(LogModule.SYSTEM, 'Parameters imported successfully')
              }
            }
            reader.readAsText(file)
          }
        }
        input.click()
      }
    }, 'Import Parameters')

    globalFolder.open()
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Format parameter name for display
   */
  private formatParameterName(parameter: ParameterDefinition): string {
    let name = parameter.description || parameter.id
    if (parameter.unit) {
      name += ` (${parameter.unit})`
    }
    return name
  }

  /**
   * Update parameter value in GUI
   */
  private updateParameterValue(controllerKey: string, value: any): void {
    const controller = this.parameterControllers.get(controllerKey)
    if (controller) {
      // Update the controller value without triggering onChange
      controller.setValue(value)
    }
  }

  /**
   * Refresh all parameters in GUI
   */
  public refreshAllParameters(): void {
    const categories: ParameterCategory[] = ['sky', 'lighting', 'camera', 'player', 'system']
    categories.forEach(category => {
      this.refreshCategoryParameters(category)
    })
  }

  /**
   * Refresh parameters for a specific category
   */
  public refreshCategoryParameters(category: ParameterCategory): void {
    const parameters = this.parameterManager.getCategoryParameters(category)
    parameters.forEach(parameter => {
      const controllerKey = `${parameter.category}.${parameter.id}`
      const currentValue = this.parameterManager.getParameter(parameter.category, parameter.id)
      this.updateParameterValue(controllerKey, currentValue)
    })
  }

  /**
   * Show the GUI
   */
  public show(): void {
    if (this.gui) {
      this.gui.domElement.style.display = 'block'
    }
  }

  /**
   * Hide the GUI
   */
  public hide(): void {
    if (this.gui) {
      this.gui.domElement.style.display = 'none'
    }
  }

  /**
   * Dispose of the GUI
   */
  public dispose(): void {
    if (this.gui) {
      this.gui.destroy()
      this.gui = null
    }
    this.parameterControllers.clear()
    this.categoryFolders.clear()
  }
} 