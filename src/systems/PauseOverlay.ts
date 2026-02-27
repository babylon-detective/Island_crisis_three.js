/**
 * PauseOverlay - DOM-based pause menu overlay with keyboard and gamepad support
 */

export interface PauseOption {
  label: string;
  action: () => void;
}

export type HideCallback = () => void;

export class PauseOverlay {
  private container: HTMLDivElement | null = null;
  private options: PauseOption[] = [];
  private selectedIndex: number = 0;
  private pollInterval: number | null = null;
  private lastNavTime: number = 0;
  private readonly NAV_COOLDOWN = 150; // ms between navigation inputs
  private onHideCallback: HideCallback | null = null;
  private startButtonReleased: boolean = false; // Guard: Start must be released before overlay acts on it

  constructor() {
    this.options = [
      {
        label: 'RESUME',
        action: () => this.hide()
      },
      {
        label: 'HUB',
        action: () => {
          window.location.href = 'https://www.dreamdealer.dev';
        }
      }
    ];
  }

  /**
   * Set callback to be called when overlay is hidden
   */
  onHide(callback: HideCallback): void {
    this.onHideCallback = callback;
  }

  show(): void {
    if (this.container) return; // Already showing

    this.selectedIndex = 0;
    this.startButtonReleased = false; // Start is still held, wait for release
    this.createOverlay();
    this.startInputPolling();
    
    console.log('🎮 Pause overlay shown');
  }

  hide(): void {
    this.stopInputPolling();
    
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    
    // Call the hide callback
    if (this.onHideCallback) {
      this.onHideCallback();
    }
    
    console.log('🎮 Pause overlay hidden');
  }

  isVisible(): boolean {
    return this.container !== null;
  }

  private createOverlay(): void {
    this.container = document.createElement('div');
    this.container.id = 'pause-overlay';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.75);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      font-family: 'Press Start 2P', 'Courier New', monospace;
    `;

    // Title
    const title = document.createElement('div');
    title.textContent = 'PAUSED';
    title.style.cssText = `
      color: #fff;
      font-size: 48px;
      text-shadow: 4px 4px 0 #000;
      margin-bottom: 48px;
      letter-spacing: 8px;
    `;
    this.container.appendChild(title);

    // Options container
    const optionsContainer = document.createElement('div');
    optionsContainer.id = 'pause-options';
    optionsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 16px;
    `;
    this.container.appendChild(optionsContainer);

    // Render options
    this.renderOptions(optionsContainer);

    // Controls hint
    const hint = document.createElement('div');
    hint.textContent = 'W/S or ↑/↓ to select • Enter to confirm • Enter/Start to resume';
    hint.style.cssText = `
      color: #888;
      font-size: 12px;
      margin-top: 48px;
      text-align: center;
    `;
    this.container.appendChild(hint);

    document.body.appendChild(this.container);
  }

  private renderOptions(container: HTMLDivElement): void {
    container.innerHTML = '';

    this.options.forEach((option, index) => {
      const optionEl = document.createElement('div');
      optionEl.className = 'pause-option';
      
      const isSelected = index === this.selectedIndex;
      optionEl.style.cssText = `
        color: ${isSelected ? '#ffcc00' : '#fff'};
        font-size: 24px;
        padding: 12px 32px;
        text-shadow: ${isSelected ? '2px 2px 0 #000' : 'none'};
        background: ${isSelected ? 'rgba(255, 204, 0, 0.2)' : 'transparent'};
        border: ${isSelected ? '2px solid #ffcc00' : '2px solid transparent'};
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.1s ease;
        text-align: center;
        min-width: 200px;
      `;
      optionEl.textContent = `${isSelected ? '▶ ' : '  '}${option.label}`;
      
      // Mouse hover
      optionEl.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.renderOptions(container);
      });
      
      // Mouse click
      optionEl.addEventListener('click', () => {
        this.selectedIndex = index;
        this.selectCurrentOption();
      });

      // Touch tap (mobile) — use touchend for reliable tap-to-select behavior
      optionEl.addEventListener('touchstart', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectedIndex = index;
        this.renderOptions(container);
      }, { passive: false });

      optionEl.addEventListener('touchend', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectedIndex = index;
        this.selectCurrentOption();
      }, { passive: false });

      optionEl.addEventListener('touchcancel', (event) => {
        event.preventDefault();
        event.stopPropagation();
      }, { passive: false });

      container.appendChild(optionEl);
    });
  }

  private selectCurrentOption(): void {
    const option = this.options[this.selectedIndex];
    if (option) {
      console.log(`🎮 Pause option selected: ${option.label}`);
      option.action();
    }
  }

  private startInputPolling(): void {
    // Keyboard events
    document.addEventListener('keydown', this.handleKeyDown);

    // Gamepad polling
    this.pollInterval = window.setInterval(() => {
      this.pollGamepad();
    }, 50);
  }

  private stopInputPolling(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
    
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.container) return;

    // Stop propagation so main.ts keyboard handlers don't also fire
    event.stopPropagation();

    const optionsContainer = this.container.querySelector('#pause-options') as HTMLDivElement;
    if (!optionsContainer) return;

    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex = (this.selectedIndex - 1 + this.options.length) % this.options.length;
        this.renderOptions(optionsContainer);
        break;

      case 'KeyS':
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % this.options.length;
        this.renderOptions(optionsContainer);
        break;

      case 'Enter':
      case 'NumpadEnter':
        event.preventDefault();
        this.selectCurrentOption();
        break;

      case 'Escape':
        event.preventDefault();
        this.hide();
        break;
    }
  };

  private pollGamepad(): void {
    const gamepads = navigator.getGamepads();
    
    for (const gamepad of gamepads) {
      if (!gamepad) continue;

      const now = performance.now();
      if (now - this.lastNavTime < this.NAV_COOLDOWN) continue;

      const optionsContainer = this.container?.querySelector('#pause-options') as HTMLDivElement;
      if (!optionsContainer) continue;

      // D-pad up (button 12) or left stick up
      if (gamepad.buttons[12]?.pressed || gamepad.axes[1] < -0.5) {
        this.selectedIndex = (this.selectedIndex - 1 + this.options.length) % this.options.length;
        this.renderOptions(optionsContainer);
        this.lastNavTime = now;
      }

      // D-pad down (button 13) or left stick down
      if (gamepad.buttons[13]?.pressed || gamepad.axes[1] > 0.5) {
        this.selectedIndex = (this.selectedIndex + 1) % this.options.length;
        this.renderOptions(optionsContainer);
        this.lastNavTime = now;
      }

      // Track Start button release so we don't immediately act on the press that opened the overlay
      if (!gamepad.buttons[9]?.pressed) {
        this.startButtonReleased = true;
      }

      // A button (button 0) - confirm selection
      if (gamepad.buttons[0]?.pressed) {
        this.selectCurrentOption();
        this.lastNavTime = now;
      }

      // Start button (button 9) - resume, but only after it was released first
      if (gamepad.buttons[9]?.pressed && this.startButtonReleased) {
        this.hide();
        this.lastNavTime = now;
      }

      // B button (button 1) - resume/back
      if (gamepad.buttons[1]?.pressed) {
        this.hide();
        this.lastNavTime = now;
      }
    }
  }

  dispose(): void {
    this.hide();
  }
}
