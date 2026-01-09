import type { Abi, AbiEvent } from 'viem';

// ============================================================================
// Source Configuration Types
// ============================================================================

/**
 * Standard JSON-RPC source configuration
 */
export interface RpcSourceConfig {
  type: 'rpc';
  url: string;
  /** Number of confirmations or 'finalized' for proof-of-stake */
  finality: number | 'finalized';
}

/**
 * eRPC proxy source configuration
 * @see https://github.com/erpc/erpc
 */
export interface ErpcSourceConfig {
  type: 'erpc';
  url: string;
  /** Number of confirmations or 'finalized' for proof-of-stake */
  finality: number | 'finalized';
  /** Optional project ID if eRPC has multiple projects */
  projectId?: string;
}

/**
 * HyperSync source configuration for fast historical sync
 * @see https://docs.envio.dev/docs/hypersync
 */
export interface HyperSyncSourceConfig {
  type: 'hypersync';
  /** HyperSync endpoint URL (optional, defaults based on chainId) */
  url?: string;
  /** Fallback RPC URL for contract reads (HyperSync only provides logs/blocks) */
  fallbackRpc?: string;
}

/**
 * QuickNode Streams webhook source
 * @see https://www.quicknode.com/streams
 */
export interface StreamSourceConfig {
  type: 'stream';
  provider: 'quicknode';
  webhookPath: string;
  secret: string;
}

/**
 * Discriminated union of all source types
 */
export type SourceConfig =
  | RpcSourceConfig
  | ErpcSourceConfig
  | HyperSyncSourceConfig
  | StreamSourceConfig;

// ============================================================================
// Address Configuration Types
// ============================================================================

/**
 * Factory contract configuration for dynamic address discovery
 */
export interface FactoryConfig {
  type: 'factory';
  /** Factory contract address */
  address: `0x${string}`;
  /** ABI event that creates child contracts */
  event: AbiEvent;
  /** Parameter name containing the child address */
  parameter: string;
}

/**
 * Address configuration - static or factory pattern
 */
export type AddressConfig =
  | `0x${string}` // Single static address
  | `0x${string}`[] // Multiple static addresses
  | FactoryConfig; // Dynamic via factory

/**
 * Helper function to create a factory configuration
 */
export function factory(config: {
  address: `0x${string}`;
  event: AbiEvent;
  parameter: string;
}): FactoryConfig {
  return { type: 'factory', ...config };
}

/**
 * Type guard to check if address config is a factory
 */
export function isFactoryConfig(config: AddressConfig): config is FactoryConfig {
  return typeof config === 'object' && !Array.isArray(config) && config.type === 'factory';
}

// ============================================================================
// Contract Configuration
// ============================================================================

/**
 * Event handler mapping
 * Maps event names to handler functions or module paths
 */
export type EventHandlerMapping = Record<string, EventHandler | string>;

/**
 * Contract configuration for indexing
 */
export interface ContractConfig {
  name: string;
  /** Contract ABI */
  abi: Abi;
  /** Reference to chain name in chains config */
  chain: string;
  /** Contract address(es) or factory pattern */
  address: AddressConfig;
  /** Block number to start indexing from */
  startBlock: number;
  /** Optional end block for historical ranges */
  endBlock?: number;
  /** Maximum block range per request (default: 1000) */
  maxBlockRange?: number;
  /**
   * Event handlers for this contract
   * Can be inline functions or paths to handler modules
   *
   * @example
   * // Inline handler
   * handlers: {
   *   Transfer: async ({ event, db }) => { ... }
   * }
   *
   * @example
   * // Module path (resolved relative to config file)
   * handlers: {
   *   Transfer: './handlers/token.js#handleTransfer'
   * }
   */
  handlers?: EventHandlerMapping;
}

// ============================================================================
// Sync Configuration
// ============================================================================

/**
 * Parallel sync configuration for historical data
 */
export interface SyncConfig {
  /**
   * Number of parallel workers for historical sync
   * Each worker processes a distinct chunk of blocks
   * @default 1
   */
  parallelWorkers?: number;
  /**
   * Number of blocks to request per RPC/HyperSync call
   * - RPC default: 1000
   * - HyperSync default: 10000
   */
  blockRangePerRequest?: number;
  /**
   * Total blocks assigned to each worker before completion
   * Used to divide historical range among parallel workers
   * @default 100000
   */
  blocksPerWorker?: number;
  /**
   * Batch size for storing events to database
   * @default 1000
   */
  eventBatchSize?: number;
}

// ============================================================================
// Chain Configuration
// ============================================================================

/**
 * Chain configuration
 */
export interface ChainConfig {
  /** EVM chain ID */
  id: number;
  /** Data source configuration */
  source: SourceConfig;
  /** Override global finality blocks for RPC sources */
  finalityBlocks?: number;
  /** Polling interval in milliseconds (default: 2000) */
  pollingInterval?: number;
  /** Sync configuration for parallel historical indexing */
  sync?: SyncConfig;
}

// ============================================================================
// Cron Configuration
// ============================================================================

/**
 * Block-based cron trigger
 */
export interface BlockCronTrigger {
  type: 'block';
  /** Execute every N blocks */
  interval: number;
  /** Optional offset from start */
  offset?: number;
}

/**
 * Time-based cron trigger using cron expression
 */
export interface TimeCronTrigger {
  type: 'time';
  /** Standard cron expression (e.g., "0 * * * *" for hourly) */
  cron: string;
  /** Timezone (default: UTC) */
  timezone?: string;
}

/**
 * Discriminated union of cron trigger types
 */
export type CronTrigger = BlockCronTrigger | TimeCronTrigger;

/**
 * Schema configuration for cron data storage
 */
export interface CronSchemaConfig {
  /** Store in chain-specific schema or dedicated crons schema */
  type: 'chain' | 'dedicated';
  /** Chain name (required if type is 'chain') */
  chain?: string;
}

/**
 * Cron job configuration
 */
export interface CronConfig {
  /** Unique cron job name */
  name: string;
  /** Chain to query data from */
  chain: string;
  /** Trigger configuration */
  trigger: CronTrigger;
  /** Handler module path */
  handler: string;
  /** Schema configuration for data storage */
  schema?: CronSchemaConfig;
  /** Whether cron is enabled (default: true) */
  enabled?: boolean;
}

// ============================================================================
// Backup Configuration
// ============================================================================

/**
 * S3-compatible storage configuration
 */
export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Use path-style URLs (for LocalStack compatibility) */
  forcePathStyle?: boolean;
}

/**
 * Backup schedule configuration
 */
export interface BackupScheduleConfig {
  /** Enable automatic backups */
  enabled: boolean;
  /** Cron expression for backup schedule */
  cron: string;
  /** Retention period in days (default: 30) */
  retentionDays?: number;
}

/**
 * Backup configuration
 */
export interface BackupConfig {
  /** S3-compatible storage configuration */
  storage: S3Config;
  /** Schemas to backup */
  schemas: string[];
  /** Automatic backup schedule */
  schedule?: BackupScheduleConfig;
  /** Compression level (1-9, default: 6) */
  compressionLevel?: number;
}

// ============================================================================
// Database Configuration
// ============================================================================

/**
 * Database configuration
 */
export interface DatabaseConfig {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Schema for raw synced data (default: 'kyomei_sync') */
  syncSchema?: string;
  /** Schema for application data (default: 'kyomei_app') */
  appSchema?: string;
  /** Schema for cron job data (default: 'kyomei_crons') */
  cronsSchema?: string;
  /** Maximum connections in pool (default: 10) */
  poolSize?: number;
  /**
   * Schema version for migrations
   * Appended to schema names: kyomei_app_v1, kyomei_crons_v1, etc.
   * Required for production deployments
   */
  schemaVersion: string;
}

// ============================================================================
// Logging Configuration
// ============================================================================

/**
 * Log levels from least to most verbose
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /** Minimum log level */
  level: LogLevel;
  /** Show timestamps (default: true) */
  timestamps?: boolean;
  /** JSON format for structured logging */
  json?: boolean;
  /** Show progress indicators */
  progress?: boolean;
}

// ============================================================================
// Main Kyomei Configuration
// ============================================================================

/**
 * Complete Kyomei indexer configuration
 */
export interface KyomeiConfig {
  /** Database configuration */
  database: DatabaseConfig;
  /** Chain configurations keyed by name */
  chains: Record<string, ChainConfig>;
  /** Contract configurations keyed by name */
  contracts: Record<string, Omit<ContractConfig, 'name'>>;
  /** Cron job configurations */
  crons?: CronConfig[];
  /** Backup configuration */
  backup?: BackupConfig;
  /** Logging configuration */
  logging?: LoggingConfig;
  /** API server configuration */
  api?: {
    port?: number;
    host?: string;
    graphql?: {
      enabled?: boolean;
      path?: string;
    };
  };
}

// ============================================================================
// Handler Types (Ponder-compatible)
// ============================================================================

/**
 * Event context provided to handlers
 */
export interface EventContext<TEvent = unknown> {
  /** Decoded event data */
  event: TEvent;
  /** Block information */
  block: {
    number: bigint;
    hash: `0x${string}`;
    timestamp: bigint;
  };
  /** Transaction information */
  transaction: {
    hash: `0x${string}`;
    from: `0x${string}`;
    to: `0x${string}` | null;
    index: number;
  };
  /** Log information */
  log: {
    index: number;
    address: `0x${string}`;
  };
}

/**
 * Query condition type
 */
export type QueryCondition = Record<string, unknown>;

/**
 * Database context for handlers
 * Provides type-safe database operations
 */
export interface DbContext {
  /** Insert a record */
  insert: <T extends Record<string, unknown>>(table: string) => {
    values: (data: T | T[]) => Promise<void>;
  };
  /** Update records */
  update: <T extends Record<string, unknown>>(table: string) => {
    set: (data: T) => {
      where: (condition: QueryCondition) => Promise<void>;
    };
  };
  /** Delete records */
  delete: (table: string) => {
    where: (condition: QueryCondition) => Promise<void>;
  };
  /** Find a single record */
  find: <T extends Record<string, unknown>>(table: string) => {
    where: (condition: QueryCondition) => Promise<T | null>;
    many: (condition?: QueryCondition) => Promise<T[]>;
  };
  /** Get by ID */
  get: <T extends Record<string, unknown>>(
    table: string,
    id: string | number
  ) => Promise<T | null>;
}

/**
 * Cached RPC client context for handlers
 */
export interface RpcContext {
  /** Read contract at current block */
  readContract: <TResult = unknown>(params: {
    address: `0x${string}`;
    abi: Abi;
    functionName: string;
    args?: unknown[];
  }) => Promise<TResult>;
  /** Get balance at current block */
  getBalance: (address: `0x${string}`) => Promise<bigint>;
  /** Get block by number */
  getBlock: (blockNumber?: bigint) => Promise<{
    number: bigint;
    hash: `0x${string}`;
    timestamp: bigint;
    gasUsed: bigint;
    gasLimit: bigint;
  }>;
  /** Get transaction receipt */
  getTransactionReceipt: (hash: `0x${string}`) => Promise<{
    status: 'success' | 'reverted';
    gasUsed: bigint;
    logs: Array<{
      address: `0x${string}`;
      topics: `0x${string}`[];
      data: `0x${string}`;
    }>;
  }>;
}

/**
 * Full handler context
 */
export interface HandlerContext<TEvent = unknown> extends EventContext<TEvent> {
  /** Database operations */
  db: DbContext;
  /** Cached RPC client */
  rpc: RpcContext;
}

/**
 * Event handler function type
 */
export type EventHandler<TEvent = unknown> = (
  context: HandlerContext<TEvent>
) => Promise<void> | void;

/**
 * Cron handler context
 */
export interface CronHandlerContext {
  /** Database operations (scoped to appropriate schema) */
  db: DbContext;
  /** RPC client for the associated chain */
  rpc: RpcContext;
  /** Current block number */
  blockNumber: bigint;
  /** Execution timestamp */
  timestamp: Date;
  /** Cron job name */
  cronName: string;
  /** Chain ID for the associated chain */
  chainId: number;
}

/**
 * Cron handler function type
 */
export type CronHandler = (context: CronHandlerContext) => Promise<void> | void;

// ============================================================================
// Schema Types
// ============================================================================

/**
 * Application schema definition with typed tables
 */
export interface AppSchemaDefinition<TTables extends Record<string, unknown>> {
  schemaName: string;
  tables: TTables;
}

/**
 * Block information type
 */
export interface BlockInfo {
  number: bigint;
  hash: `0x${string}`;
  timestamp: bigint;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas?: bigint;
}
