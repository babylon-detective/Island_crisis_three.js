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
  },
  onRevealGameplay: () => {
    import('./main').then(({ setGameplayInputEnabled }) => {
      setGameplayInputEnabled(true)
    })
  },
})

/**
 * Preload assets and initialize the main game.
 * Runs while the title screen is still visible — loading text updates
 * give feedback to the player.
 */
async function startGame(): Promise<void> {
  console.log('🎮 Starting game initialization...')
  
  try {
    // Phase 1 — dynamic-import the main module (parses code, sets up singletons)
    titleScreen.updateLoadingText('Loading game assets...')
    const { initializeGame, setGameplayInputEnabled } = await import('./main')
    setGameplayInputEnabled(false)
    
    // Phase 2 — initialise all systems & load world content.
    // Pass a progress callback so the title screen shows real status.
    titleScreen.updateLoadingText('Building world...')
    await initializeGame(isNewGame, (text: string) => {
      titleScreen.updateLoadingText(text)
    })
    
    // Done — title screen will now fade out (handled by TitleScreen.handleStart)
    titleScreen.updateLoadingText('Ready!')
    console.log('🎮 Game loaded successfully!')
    
  } catch (error) {
    console.error('❌ Failed to load game:', error)
    titleScreen.updateLoadingText('Error loading game. Please refresh.')
  }
}

