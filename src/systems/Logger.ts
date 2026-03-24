/**
 * Centralized Logging System
 * 
 * Provides a unified logging interface with:
 * - Log levels (ERROR, WARN, INFO, DEBUG)
 * - Module-based filtering
 * - Performance optimizations
 * - Development/production modes
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

export enum LogModule {
  SYSTEM = 'SYSTEM',
  INPUT = 'INPUT',
  PLAYER = 'PLAYER',
  CAMERA = 'CAMERA',
  COLLISION = 'COLLISION',
  OBJECTS = 'OBJECTS',
  ANIMATION = 'ANIMATION',
  RENDERING = 'RENDERING',
  PERFORMANCE = 'PERFORMANCE'
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private enabledModules: Set<LogModule> = new Set();
  private silentMode: boolean = false;
  private developmentMode: boolean = false;

  constructor() {
    // Enable all modules by default
    Object.values(LogModule).forEach(module => {
      this.enabledModules.add(module);
    });
  }

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Enable logging for specific modules
   */
  enableModule(module: LogModule): void {
    this.enabledModules.add(module);
  }

  /**
   * Disable logging for specific modules
   */
  disableModule(module: LogModule): void {
    this.enabledModules.delete(module);
  }

  /**
   * Enable all modules
   */
  enableAllModules(): void {
    Object.values(LogModule).forEach(module => {
      this.enabledModules.add(module);
    });
  }

  /**
   * Disable all modules
   */
  disableAllModules(): void {
    this.enabledModules.clear();
  }

  /**
   * Enable silent mode (no console output)
   */
  setSilentMode(): void {
    this.silentMode = true;
  }

  /**
   * Disable silent mode
   */
  setVerboseMode(): void {
    this.silentMode = false;
  }

  /**
   * Enable development mode (all logs, debug level)
   */
  setDevelopmentMode(): void {
    this.developmentMode = true;
    this.level = LogLevel.DEBUG;
    this.enabledModules.clear();
    Object.values(LogModule).forEach(module => {
      this.enabledModules.add(module);
    });
    this.silentMode = false;
  }

  /**
   * Enable production mode (errors and warnings only)
   */
  setProductionMode(): void {
    this.developmentMode = false;
    this.level = LogLevel.WARN;
    this.enabledModules.clear();
    this.silentMode = false;
  }

  /**
   * Check if logging should occur for given level and module
   */
  private shouldLog(level: LogLevel, module: LogModule): boolean {
    if (this.silentMode) return false;
    if (level > this.level) return false;
    if (!this.enabledModules.has(module)) return false;
    return true;
  }

  /**
   * Format log message with module prefix
   */
  private formatMessage(level: string, module: LogModule, message: string): string {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    return `[${timestamp}] [${level.toUpperCase()}] [${module.toUpperCase()}] ${message}`;
  }

  /**
   * Log error message
   */
  error(module: LogModule, message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR, module)) {
      console.error(this.formatMessage('ERROR', module, message), ...args);
    }
  }

  /**
   * Log warning message
   */
  warn(module: LogModule, message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN, module)) {
      console.warn(this.formatMessage('WARN', module, message), ...args);
    }
  }

  /**
   * Log info message
   */
  info(module: LogModule, message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO, module)) {
      console.info(this.formatMessage('INFO', module, message), ...args);
    }
  }

  /**
   * Log debug message
   */
  debug(module: LogModule, message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG, module)) {
      console.debug(this.formatMessage('DEBUG', module, message), ...args);
    }
  }

  /**
   * Log performance measurement
   */
  performance(module: LogModule, operation: string, duration: number): void {
    if (this.shouldLog(LogLevel.DEBUG, module)) {
      console.debug(this.formatMessage('PERF', module, `${operation}: ${duration.toFixed(2)}ms`));
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): {
    level: LogLevel;
    enabledModules: LogModule[];
    silentMode: boolean;
    developmentMode: boolean;
  } {
    return {
      level: this.level,
      enabledModules: Array.from(this.enabledModules),
      silentMode: this.silentMode,
      developmentMode: this.developmentMode
    };
  }
}

// Export singleton instance
export const logger = new Logger();

// Convenience functions for quick access
export const logError = (module: LogModule, message: string, ...args: any[]) => 
  logger.error(module, message, ...args);

export const logWarn = (module: LogModule, message: string, ...args: any[]) => 
  logger.warn(module, message, ...args);

export const logInfo = (module: LogModule, message: string, ...args: any[]) => 
  logger.info(module, message, ...args);

export const logDebug = (module: LogModule, message: string, ...args: any[]) => 
  logger.debug(module, message, ...args);

export const logPerformance = (module: LogModule, operation: string, duration: number) => 
  logger.performance(module, operation, duration); 