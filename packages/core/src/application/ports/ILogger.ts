import type { LogLevel } from '@kyomei/config';

/**
 * Log message context
 */
export interface LogContext {
  /** Module or component name */
  module?: string;
  /** Chain name or ID */
  chain?: string;
  /** Block number */
  block?: bigint | number;
  /** Transaction hash */
  txHash?: string;
  /** Contract address */
  contract?: string;
  /** Event name */
  event?: string;
  /** Error object */
  error?: Error;
  /** Additional metadata */
  [key: string]: unknown;
}

/**
 * Progress information for a single phase
 */
export interface PhaseProgress {
  /** Current progress count */
  current: number;
  /** Total expected count */
  total: number;
  /** Percentage complete (0-100) */
  percentage: number;
  /** Items per second */
  rate?: number;
}

/**
 * Progress information for indexing
 */
export interface ProgressInfo {
  /** Chain name */
  chain: string;
  /** Blocks synced */
  blocksSynced: number;
  /** Total blocks to sync */
  totalBlocks: number;
  /** Percentage complete (0-100) */
  percentage: number;
  /** Phase (syncing, processing, etc.) */
  phase: 'syncing' | 'processing' | 'live';
  /** Blocks per second */
  blocksPerSecond?: number;
  /** Number of workers */
  workers?: number;
  /** Estimated time remaining (seconds) */
  estimatedTimeRemaining?: number;
}

/**
 * Combined progress for all phases
 */
export interface CombinedProgress {
  chain: string;
  sync?: PhaseProgress;
  process?: PhaseProgress;
  status: 'syncing' | 'processing' | 'live';
  eta?: number;
}

/**
 * Logger interface with multi-level logging support
 */
export interface ILogger {
  /**
   * Current log level
   */
  readonly level: LogLevel;

  /**
   * Log an error message (level 1: -v)
   */
  error(message: string, context?: LogContext): void;

  /**
   * Log a warning message (level 2: -vv)
   */
  warn(message: string, context?: LogContext): void;

  /**
   * Log an info message (level 3: -vvv)
   */
  info(message: string, context?: LogContext): void;

  /**
   * Log a debug message (level 4: -vvvv)
   */
  debug(message: string, context?: LogContext): void;

  /**
   * Log a trace message (level 5: -vvvvv)
   */
  trace(message: string, context?: LogContext): void;

  /**
   * Update progress display
   */
  progress(info: ProgressInfo): void;

  /**
   * Clear progress display
   */
  clearProgress(): void;

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): ILogger;

  /**
   * Start a timed operation
   */
  startTimer(label: string): () => void;

  /**
   * Check if a log level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean;
}

/**
 * Logger factory interface
 */
export interface ILoggerFactory {
  /**
   * Create a logger with the given configuration
   */
  create(config: {
    level: LogLevel;
    timestamps?: boolean;
    json?: boolean;
    progress?: boolean;
  }): ILogger;
}

/**
 * Log level numeric values (for comparison)
 */
export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/**
 * Parse verbosity flags to log level
 * @param verbosity Number of -v flags (e.g., 3 for -vvv)
 */
export function verbosityToLogLevel(verbosity: number): LogLevel {
  switch (verbosity) {
    case 0:
    case 1:
      return 'error';
    case 2:
      return 'warn';
    case 3:
      return 'info';
    case 4:
      return 'debug';
    default:
      return 'trace';
  }
}
