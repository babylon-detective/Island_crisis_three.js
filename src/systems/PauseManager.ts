/**
 * PauseManager - Simple state management for game pause functionality
 */

export type PauseCallback = () => void;

export class PauseManager {
  private paused: boolean = false;
  private pauseCallbacks: PauseCallback[] = [];
  private resumeCallbacks: PauseCallback[] = [];

  getPaused(): boolean {
    return this.paused;
  }

  setPaused(value: boolean): void {
    const wasChanged = this.paused !== value;
    this.paused = value;
    
    if (wasChanged) {
      if (value) {
        this.pauseCallbacks.forEach(cb => cb());
      } else {
        this.resumeCallbacks.forEach(cb => cb());
      }
    }
  }

  toggle(): boolean {
    this.setPaused(!this.paused);
    return this.paused;
  }

  onPause(callback: PauseCallback): () => void {
    this.pauseCallbacks.push(callback);
    // Return unsubscribe function
    return () => {
      const index = this.pauseCallbacks.indexOf(callback);
      if (index > -1) {
        this.pauseCallbacks.splice(index, 1);
      }
    };
  }

  onResume(callback: PauseCallback): () => void {
    this.resumeCallbacks.push(callback);
    // Return unsubscribe function
    return () => {
      const index = this.resumeCallbacks.indexOf(callback);
      if (index > -1) {
        this.resumeCallbacks.splice(index, 1);
      }
    };
  }

  dispose(): void {
    this.pauseCallbacks = [];
    this.resumeCallbacks = [];
    this.paused = false;
  }
}
