// Block source ports
export type { IBlockSource, IBlockSourceFactory, SourceType, BlockHandler, Unsubscribe } from './IBlockSource.ts';

// RPC client ports
export type {
  IRpcClient,
  ICachedRpcClient,
  IRpcClientFactory,
  RpcCallParams,
  ReadContractParams,
} from './IRpcClient.ts';

// Logger ports
export type {
  ILogger,
  ILoggerFactory,
  LogContext,
  ProgressInfo,
  PhaseProgress,
  CombinedProgress,
} from './ILogger.ts';
export { LOG_LEVEL_VALUES, verbosityToLogLevel } from './ILogger.ts';

// Event repository ports
export type {
  IEventRepository,
  RawEventRecord,
  EventQueryOptions,
} from './IEventRepository.ts';

// Checkpoint repository ports
export type {
  // Sync worker types
  SyncStatus,
  SyncWorker,
  ISyncWorkerRepository,
  // Process worker types
  ProcessStatus,
  ProcessWorker,
  IProcessWorkerRepository,
  // Process checkpoints
  IProcessCheckpointRepository,
  ProcessCheckpoint,
  // Legacy types (deprecated)
  ISyncCheckpointRepository,
  SyncCheckpoint,
  WorkerCheckpoint,
} from './ICheckpointRepository.ts';

// RPC cache repository ports
export type {
  IRpcCacheRepository,
  RpcCacheRecord,
} from './IRpcCacheRepository.ts';

// Factory repository ports
export type {
  IFactoryRepository,
  FactoryChildRecord,
  FactoryChildQueryOptions,
} from './IFactoryRepository.ts';
