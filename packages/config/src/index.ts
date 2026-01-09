// Types
export type {
  // Source types
  SourceConfig,
  RpcSourceConfig,
  ErpcSourceConfig,
  HyperSyncSourceConfig,
  StreamSourceConfig,
  // Address types
  AddressConfig,
  FactoryConfig,
  // Contract types
  ContractConfig,
  EventHandlerMapping,
  // Chain types
  ChainConfig,
  // Sync types
  SyncConfig,
  // Cron types
  CronConfig,
  CronTrigger,
  BlockCronTrigger,
  TimeCronTrigger,
  CronSchemaConfig,
  // Backup types
  BackupConfig,
  BackupScheduleConfig,
  S3Config,
  // Database types
  DatabaseConfig,
  // Logging types
  LoggingConfig,
  LogLevel,
  // Main config
  KyomeiConfig,
  // Handler types
  EventContext,
  DbContext,
  RpcContext,
  HandlerContext,
  EventHandler,
  CronHandler,
  CronHandlerContext,
} from './types.ts';

// Helper functions
export { factory, isFactoryConfig } from './types.ts';

// Schema exports
export {
  kyomeiConfigSchema,
  sourceConfigSchema,
  addressConfigSchema,
  chainConfigSchema,
  contractConfigSchema,
  cronConfigSchema,
  backupConfigSchema,
  databaseConfigSchema,
  loggingConfigSchema,
  apiConfigSchema,
  syncConfigSchema,
} from './schema.ts';
export type { KyomeiConfigInput, KyomeiConfigOutput } from './schema.ts';

// Loader exports
export { loadConfig, defineConfig, defineConfigWithEnv } from './loader.ts';

// Default exports
export {
  DEFAULT_DATABASE_CONFIG,
  DEFAULT_LOGGING_CONFIG,
  DEFAULT_SOURCE_CONFIGS,
  DEFAULT_BACKUP_CONFIG,
  DEFAULT_API_CONFIG,
  DEFAULT_BLOCK_RANGES,
  DEFAULT_SYNC_CONFIG,
  RECOMMENDED_SYNC_CONFIGS,
  COMMON_CHAINS,
} from './defaults.ts';
