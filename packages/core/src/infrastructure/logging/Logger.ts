import type { LogLevel } from '@kyomei/config';
import type { ILogger, LogContext, ProgressInfo } from '../../application/ports/ILogger.ts';
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
  private readonly progressThrottleMs = 100;

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

    // Throttle progress updates
    const now = Date.now();
    if (now - this.lastProgressUpdate < this.progressThrottleMs) return;
    this.lastProgressUpdate = now;

    const percent = this.calculateProgress(info);
    const blocksRemaining = info.targetBlock - info.currentBlock;
    const eta = this.formatEta(info.estimatedTimeRemaining);
    const bps = info.blocksPerSecond ? `${info.blocksPerSecond.toFixed(1)} bps` : '';

    // Build progress bar
    const barWidth = 30;
    const filled = Math.round((percent / 100) * barWidth);
    const empty = barWidth - filled;
    const bar = `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;

    const phaseColor = info.phase === 'live' ? COLORS.green : COLORS.cyan;
    const phaseLabel = info.phase.toUpperCase().padEnd(10);

    this.progressLine = `${phaseColor}${phaseLabel}${COLORS.reset} ${COLORS.bold}${info.chain}${COLORS.reset} ${bar} ${percent.toFixed(1)}% | Block ${info.currentBlock}/${info.targetBlock} | ${blocksRemaining} remaining | ${bps} | ETA: ${eta}`;

    // Clear line and write progress
    if (process.stdout.isTTY) {
      process.stdout.write(`\r\x1b[K${this.progressLine}`);
    }
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

  private calculateProgress(info: ProgressInfo): number {
    const total = info.targetBlock - info.startBlock;
    if (total <= 0n) return 100;

    const processed = info.currentBlock - info.startBlock;
    return Number((processed * 100n) / total);
  }

  private formatEta(seconds?: number): string {
    if (!seconds || seconds <= 0) return '--:--:--';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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
