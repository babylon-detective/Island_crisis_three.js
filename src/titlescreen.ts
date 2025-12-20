/**
 * Title Screen Entry Point
 * 
 * This file initializes the title screen and handles the transition to the main game.
 * It runs before main.ts and manages the preloading process.
 */

import './style.css'
import './titlescreen.css'
import { TitleScreen } from './systems/TitleScreen'

// Flag to track if this is a new game or continue
let isNewGame = true

// Initialize title screen
const titleScreen = new TitleScreen({
  onStart: async () => {
    isNewGame = true
    await startGame()
  },
  onContinue: async () => {
    isNewGame = false
    await startGame()
  }
})

/**
 * Preload assets and initialize the main game
 */
async function startGame(): Promise<void> {
  console.log('🎮 Starting game initialization...')
  
  try {
    // Update loading text
    titleScreen.updateLoadingText('Loading game assets...')
    
    // Preload phase 1: Critical assets
    await preloadCriticalAssets()
    titleScreen.updateLoadingText('Initializing systems...')
    
    // Preload phase 2: Game systems
    await preloadGameSystems()
    titleScreen.updateLoadingText('Building world...')
    
    // Preload phase 3: World content
    await preloadWorldContent()
    titleScreen.updateLoadingText('Ready!')
    
    // Small delay before launching
    await delay(500)
    
    // Import and initialize main game
    const { initializeGame } = await import('./main')
    
    // Hide loading text
    titleScreen.hideLoadingText()
    
    // Initialize game with the appropriate mode
    await initializeGame(isNewGame)
    
    console.log('🎮 Game loaded successfully!')
    
  } catch (error) {
    console.error('❌ Failed to load game:', error)
    titleScreen.updateLoadingText('Error loading game. Please refresh.')
  }
}

/**
 * Preload critical assets (shaders, essential textures)
 */
async function preloadCriticalAssets(): Promise<void> {
  // Simulate asset loading - replace with actual asset loading
  await delay(300)
  console.log('✅ Critical assets loaded')
}

/**
 * Preload game systems (physics, collision, etc.)
 */
async function preloadGameSystems(): Promise<void> {
  // Simulate system initialization - replace with actual system loading
  await delay(300)
  console.log('✅ Game systems loaded')
}

/**
 * Preload world content (models, terrain, etc.)
 */
async function preloadWorldContent(): Promise<void> {
  // Simulate content loading - replace with actual content loading
  await delay(300)
  console.log('✅ World content loaded')
}

/**
 * Utility delay function
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
