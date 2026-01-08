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
  // Chain types
  ChainConfig,
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
} from './types.js';

// Helper functions
export { factory, isFactoryConfig } from './types.js';

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
} from './schema.js';
export type { KyomeiConfigInput, KyomeiConfigOutput } from './schema.js';

// Loader exports
export { loadConfig, defineConfig, defineConfigWithEnv } from './loader.js';

// Default exports
export {
  DEFAULT_DATABASE_CONFIG,
  DEFAULT_LOGGING_CONFIG,
  DEFAULT_SOURCE_CONFIGS,
  DEFAULT_BACKUP_CONFIG,
  DEFAULT_API_CONFIG,
  DEFAULT_BLOCK_RANGES,
  COMMON_CHAINS,
} from './defaults.js';
