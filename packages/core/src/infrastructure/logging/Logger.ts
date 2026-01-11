import type { LogLevel } from '@kyomei/config';
import type { ILogger, LogContext, ProgressInfo, PhaseProgress } from '../../application/ports/ILogger.ts';
import { LOG_LEVEL_VALUES } from '../../application/ports/ILogger.ts';

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

/**
 * Tracked progress state per chain
 */
interface ChainProgressState {
  sync?: PhaseProgress & { startTime: number };
  process?: PhaseProgress & { startTime: number };
}

/**
 * Log level to color mapping
 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  error: COLORS.red,
  warn: COLORS.yellow,
  info: COLORS.green,
  debug: COLORS.cyan,
  trace: COLORS.gray,
};

/**
 * Log level to prefix mapping
 */
const LEVEL_PREFIX: Record<LogLevel, string> = {
  error: 'ERR',
  warn: 'WRN',
  info: 'INF',
  debug: 'DBG',
  trace: 'TRC',
};

/**
 * Logger implementation with multi-level support
 */
export class Logger implements ILogger {
  readonly level: LogLevel;
  private readonly timestamps: boolean;
  private readonly json: boolean;
  private readonly showProgress: boolean;
  private readonly context: LogContext;
  private progressLine: string | null = null;
  private lastProgressUpdate: number = 0;
  private readonly progressThrottleMs = 250;
  
  // Track progress per chain for combined display
  private chainProgress: Map<string, ChainProgressState> = new Map();

  constructor(config: {
    level: LogLevel;
    timestamps?: boolean;
    json?: boolean;
    progress?: boolean;
    context?: LogContext;
  }) {
    this.level = config.level;
    this.timestamps = config.timestamps ?? true;
    this.json = config.json ?? false;
    this.showProgress = config.progress ?? true;
    this.context = config.context ?? {};
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  trace(message: string, context?: LogContext): void {
    this.log('trace', message, context);
  }

  progress(info: ProgressInfo): void {
    if (!this.showProgress) return;

    const now = Date.now();
    
    // Update chain progress state
    let state = this.chainProgress.get(info.chain);
    if (!state) {
      state = {};
      this.chainProgress.set(info.chain, state);
    }

    // For processing phase, prioritize event counts over block counts
    const isProcessing = info.phase === 'processing';
    const current = isProcessing && info.eventsProcessed !== undefined
      ? info.eventsProcessed
      : info.blocksSynced;
    const total = isProcessing && info.totalEvents !== undefined
      ? info.totalEvents
      : info.totalBlocks;
    const rate = isProcessing && info.eventsPerSecond !== undefined
      ? info.eventsPerSecond
      : info.blocksPerSecond;

    const phaseData: PhaseProgress & { startTime: number } = {
      current,
      total,
      percentage: Math.min(100, Math.max(0, info.percentage)),
      rate,
      startTime: state[info.phase === 'syncing' ? 'sync' : 'process']?.startTime ?? now,
    };

    if (info.phase === 'syncing') {
      // Syncer historical sync
      state.sync = phaseData;
    } else if (info.phase === 'processing') {
      // Processor processing historical events
      state.process = phaseData;
    } else if (info.phase === 'live') {
      // Live phase - could be from syncer (sync complete) or processor (processing complete)
      // If we have workers > 1, it's from syncer (completed)
      // If rate is from events/sec, it's from processor
      if (info.workers && info.workers > 0) {
        // Syncer went live - clear sync progress
        state.sync = undefined;
      } else {
        // Processor went live
        state.process = phaseData;
      }
    }

    // Throttle display updates
    if (now - this.lastProgressUpdate < this.progressThrottleMs) return;
    this.lastProgressUpdate = now;

    // Build combined progress display
    this.displayCombinedProgress();
  }

  /**
   * Display combined progress for all chains
   */
  private displayCombinedProgress(): void {
    const parts: string[] = [];

    for (const [chain, state] of this.chainProgress) {
      const chainParts: string[] = [];
      chainParts.push(`${COLORS.bold}${chain}${COLORS.reset}`);

      // Sync progress
      if (state.sync && state.sync.percentage < 100) {
        const syncPct = state.sync.percentage.toFixed(1);
        const syncBar = this.miniBar(state.sync.percentage);
        chainParts.push(`${COLORS.cyan}sync${COLORS.reset}:${syncBar}${syncPct}%`);
      }

      // Process progress
      if (state.process) {
        const procPct = state.process.percentage.toFixed(1);
        const procBar = this.miniBar(state.process.percentage);
        const phase = state.process.percentage >= 100 ? 'live' : 'proc';
        const color = phase === 'live' ? COLORS.green : COLORS.yellow;
        chainParts.push(`${color}${phase}${COLORS.reset}:${procBar}${procPct}%`);
      }

      // Rate (use sync rate if syncing, otherwise process rate)
      const rate = state.sync?.rate ?? state.process?.rate;
      if (rate && rate > 0) {
        chainParts.push(`${COLORS.dim}${this.formatRate(rate)}${COLORS.reset}`);
      }

      // ETA calculation
      const eta = this.calculateEta(state);
      if (eta) {
        chainParts.push(`${COLORS.dim}ETA ${eta}${COLORS.reset}`);
      }

      parts.push(chainParts.join(' '));
    }

    if (parts.length === 0) return;

    this.progressLine = parts.join(' | ');

    // Clear line and write progress
    if (process.stdout.isTTY) {
      process.stdout.write(`\r\x1b[K${this.progressLine}`);
    }
  }

  /**
   * Get plain text progress line (for non-TTY output)
   */
  getProgressText(): string | null {
    if (!this.progressLine) return null;
    // Strip ANSI codes for plain text
    return this.progressLine.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * Create a mini progress bar (5 chars)
   */
  private miniBar(percentage: number): string {
    const width = 5;
    const filled = Math.round((percentage / 100) * width);
    return `${COLORS.dim}[${COLORS.reset}${'█'.repeat(filled)}${'░'.repeat(width - filled)}${COLORS.dim}]${COLORS.reset}`;
  }

  /**
   * Format rate compactly
   */
  private formatRate(rate: number): string {
    if (rate >= 1000) {
      return `${(rate / 1000).toFixed(1)}k/s`;
    }
    return `${rate.toFixed(0)}/s`;
  }

  /**
   * Calculate ETA from current state
   */
  private calculateEta(state: ChainProgressState): string | null {
    // Prioritize sync ETA if still syncing
    if (state.sync && state.sync.percentage < 100 && state.sync.rate && state.sync.rate > 0) {
      const remaining = state.sync.total - state.sync.current;
      const seconds = remaining / state.sync.rate;
      return this.formatEtaCompact(seconds);
    }

    // Otherwise use process ETA
    if (state.process && state.process.percentage < 100 && state.process.rate && state.process.rate > 0) {
      const remaining = state.process.total - state.process.current;
      const seconds = remaining / state.process.rate;
      return this.formatEtaCompact(seconds);
    }

    return null;
  }

  /**
   * Format ETA in compact form (e.g., "5m32s", "2h15m")
   */
  private formatEtaCompact(seconds: number): string {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m${secs}s`;
    }
    return `${secs}s`;
  }

  clearProgress(): void {
    if (this.progressLine && process.stdout.isTTY) {
      process.stdout.write('\r\x1b[K');
    }
    this.progressLine = null;
  }

  child(context: LogContext): ILogger {
    return new Logger({
      level: this.level,
      timestamps: this.timestamps,
      json: this.json,
      progress: this.showProgress,
      context: { ...this.context, ...context },
    });
  }

  startTimer(label: string): () => void {
    const start = performance.now();
    this.debug(`Timer started: ${label}`);

    return () => {
      const duration = performance.now() - start;
      this.debug(`Timer ended: ${label}`, { duration: `${duration.toFixed(2)}ms` });
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_VALUES[level] <= LOG_LEVEL_VALUES[this.level];
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.isLevelEnabled(level)) return;

    // Clear progress line before logging
    this.clearProgress();

    const mergedContext = { ...this.context, ...context };

    if (this.json) {
      this.logJson(level, message, mergedContext);
    } else {
      this.logPretty(level, message, mergedContext);
    }
  }

  private logJson(level: LogLevel, message: string, context: LogContext): void {
    const entry: Record<string, unknown> = {
      level,
      message,
      ...context,
    };

    if (this.timestamps) {
      entry.timestamp = new Date().toISOString();
    }

    // Handle error objects
    if (context.error instanceof Error) {
      entry.error = {
        name: context.error.name,
        message: context.error.message,
        stack: context.error.stack,
      };
    }

    // Handle BigInt serialization
    const serialized = JSON.stringify(entry, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );

    console.log(serialized);
  }

  private logPretty(level: LogLevel, message: string, context: LogContext): void {
    const color = LEVEL_COLORS[level];
    const prefix = LEVEL_PREFIX[level];

    let output = '';

    // Timestamp
    if (this.timestamps) {
      const time = new Date().toISOString().replace('T', ' ').slice(0, -1);
      output += `${COLORS.dim}${time}${COLORS.reset} `;
    }

    // Level
    output += `${color}${COLORS.bold}${prefix}${COLORS.reset} `;

    // Module/Chain prefix
    if (context.module) {
      output += `${COLORS.magenta}[${context.module}]${COLORS.reset} `;
    }
    if (context.chain) {
      output += `${COLORS.blue}[${context.chain}]${COLORS.reset} `;
    }

    // Message
    output += message;

    // Context fields
    const contextFields = Object.entries(context).filter(
      ([key]) => !['module', 'chain', 'error'].includes(key)
    );

    if (contextFields.length > 0) {
      const formatted = contextFields
        .map(([key, value]) => {
          const v = typeof value === 'bigint' ? value.toString() : value;
          return `${COLORS.dim}${key}=${COLORS.reset}${v}`;
        })
        .join(' ');
      output += ` ${formatted}`;
    }

    console.log(output);

    // Error stack trace
    if (context.error instanceof Error && level === 'error') {
      console.log(`${COLORS.dim}${context.error.stack}${COLORS.reset}`);
    }
  }
}

/**
 * Create a logger from verbosity level
 */
export function createLogger(config: {
  level?: LogLevel;
  verbosity?: number;
  timestamps?: boolean;
  json?: boolean;
  progress?: boolean;
}): ILogger {
  let level = config.level ?? 'info';

  // Convert verbosity to level if provided
  if (config.verbosity !== undefined) {
    const v = config.verbosity;
    if (v <= 1) level = 'error';
    else if (v === 2) level = 'warn';
    else if (v === 3) level = 'info';
    else if (v === 4) level = 'debug';
    else level = 'trace';
  }

  return new Logger({
    level,
    timestamps: config.timestamps,
    json: config.json,
    progress: config.progress,
  });
}
