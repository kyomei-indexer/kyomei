import type { BackupConfig, ChainConfig, DatabaseConfig, LoggingConfig, SourceConfig, SyncConfig } from './types.ts';

// ============================================================================
// Default Database Configuration
// ============================================================================

export const DEFAULT_DATABASE_CONFIG: Required<DatabaseConfig> = {
  connectionString: 'postgresql://kyomei:kyomei@localhost:5432/kyomei',
  syncSchema: 'kyomei_sync',
  appSchema: 'kyomei_app',
  cronsSchema: 'kyomei_crons',
  poolSize: 10,
  schemaVersion: 'v1',
};

// ============================================================================
// Default Logging Configuration
// ============================================================================

export const DEFAULT_LOGGING_CONFIG: Required<LoggingConfig> = {
  level: 'info',
  timestamps: true,
  json: false,
  progress: true,
};

// ============================================================================
// Default Source Configurations by Type
// ============================================================================

export const DEFAULT_SOURCE_CONFIGS: Record<SourceConfig['type'], Partial<SourceConfig>> = {
  rpc: {
    type: 'rpc',
    finality: 'finalized',
  },
  erpc: {
    type: 'erpc',
    finality: 'finalized',
  },
  hypersync: {
    type: 'hypersync',
  },
  stream: {
    type: 'stream',
    provider: 'quicknode',
  },
};

// ============================================================================
// Common Chain Configurations
// ============================================================================

/**
 * Pre-configured chain definitions for common networks
 */
export const COMMON_CHAINS: Record<string, Omit<ChainConfig, 'source'> & { hypersyncUrl?: string }> = {
  ethereum: {
    id: 1,
    finalityBlocks: 64,
    pollingInterval: 12000,
    hypersyncUrl: 'https://eth.hypersync.xyz',
  },
  optimism: {
    id: 10,
    finalityBlocks: 0,
    pollingInterval: 2000,
    hypersyncUrl: 'https://optimism.hypersync.xyz',
  },
  arbitrum: {
    id: 42161,
    finalityBlocks: 0,
    pollingInterval: 250,
    hypersyncUrl: 'https://arbitrum.hypersync.xyz',
  },
  base: {
    id: 8453,
    finalityBlocks: 0,
    pollingInterval: 2000,
    hypersyncUrl: 'https://base.hypersync.xyz',
  },
  polygon: {
    id: 137,
    finalityBlocks: 128,
    pollingInterval: 2000,
    hypersyncUrl: 'https://polygon.hypersync.xyz',
  },
  avalanche: {
    id: 43114,
    finalityBlocks: 0,
    pollingInterval: 2000,
    hypersyncUrl: 'https://avalanche.hypersync.xyz',
  },
  bsc: {
    id: 56,
    finalityBlocks: 15,
    pollingInterval: 3000,
    hypersyncUrl: 'https://bsc.hypersync.xyz',
  },
  gnosis: {
    id: 100,
    finalityBlocks: 100,
    pollingInterval: 5000,
    hypersyncUrl: 'https://gnosis.hypersync.xyz',
  },
  sepolia: {
    id: 11155111,
    finalityBlocks: 64,
    pollingInterval: 12000,
    hypersyncUrl: 'https://sepolia.hypersync.xyz',
  },
};

// ============================================================================
// Default Backup Configuration
// ============================================================================

export const DEFAULT_BACKUP_CONFIG: Partial<BackupConfig> = {
  schemas: ['kyomei_sync', 'kyomei_app', 'kyomei_crons'],
  compressionLevel: 6,
  schedule: {
    enabled: false,
    cron: '0 0 * * *', // Daily at midnight
    retentionDays: 30,
  },
};

// ============================================================================
// Default API Configuration
// ============================================================================

export const DEFAULT_API_CONFIG = {
  port: 42069,
  host: '0.0.0.0',
  graphql: {
    enabled: true,
    path: '/graphql',
  },
};

// ============================================================================
// Block Range Defaults
// ============================================================================

export const DEFAULT_BLOCK_RANGES: Record<SourceConfig['type'], number> = {
  rpc: 1000,
  erpc: 2000, // eRPC can handle larger ranges with caching
  hypersync: 10000, // HyperSync is optimized for large ranges
  stream: 1, // Streams process block-by-block
};

// ============================================================================
// Default Sync Configuration
// ============================================================================

/**
 * Default configuration for parallel historical sync
 */
export const DEFAULT_SYNC_CONFIG: Required<SyncConfig> = {
  parallelWorkers: 1, // Single worker by default for simplicity
  blockRangePerRequest: 1000, // Overridden per-source in ChainSyncer
  blocksPerWorker: 100000, // 100k blocks per worker chunk
  eventBatchSize: 1000, // Events to batch before DB insert
};

/**
 * Recommended sync configs per source type for optimal performance
 */
export const RECOMMENDED_SYNC_CONFIGS: Record<SourceConfig['type'], Partial<SyncConfig>> = {
  rpc: {
    parallelWorkers: 2,
    blockRangePerRequest: 1000,
    blocksPerWorker: 50000,
  },
  erpc: {
    parallelWorkers: 4,
    blockRangePerRequest: 2000,
    blocksPerWorker: 100000,
  },
  hypersync: {
    parallelWorkers: 8,
    blockRangePerRequest: 10000,
    blocksPerWorker: 500000,
  },
  stream: {
    parallelWorkers: 1,
    blockRangePerRequest: 1,
    blocksPerWorker: 1,
  },
};
