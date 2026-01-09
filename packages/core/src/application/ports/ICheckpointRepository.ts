/**
 * Sync status for workers
 */
export type SyncStatus = 'historical' | 'live';

/**
 * Sync worker record
 * Unified record for tracking sync progress (replaces SyncCheckpoint and WorkerCheckpoint)
 */
export interface SyncWorker {
  chainId: number;
  /** Worker ID (0 for live worker, 1+ for historical workers) */
  workerId: number;
  /** Start block of this worker's assigned range */
  rangeStart: bigint;
  /** End block of this worker's assigned range (null for live sync) */
  rangeEnd: bigint | null;
  /** Current progress block (last synced block) */
  currentBlock: bigint;
  /** Sync status: 'historical' (fixed range) or 'live' (following chain head) */
  status: SyncStatus;
  /** When this worker was created */
  createdAt: Date;
  /** When this worker was last updated */
  updatedAt: Date;
}

/**
 * Repository for managing sync workers
 */
export interface ISyncWorkerRepository {
  /**
   * Get all workers for a chain
   */
  getWorkers(chainId: number): Promise<SyncWorker[]>;

  /**
   * Get a specific worker
   */
  getWorker(chainId: number, workerId: number): Promise<SyncWorker | null>;

  /**
   * Get the live worker for a chain (worker_id = 0, status = 'live')
   */
  getLiveWorker(chainId: number): Promise<SyncWorker | null>;

  /**
   * Get all historical workers for a chain
   */
  getHistoricalWorkers(chainId: number): Promise<SyncWorker[]>;

  /**
   * Create or update a worker
   */
  setWorker(worker: SyncWorker): Promise<void>;

  /**
   * Delete a specific worker
   */
  deleteWorker(chainId: number, workerId: number): Promise<void>;

  /**
   * Delete all workers for a chain
   */
  deleteAllWorkers(chainId: number): Promise<void>;
}

/**
 * Process status for workers
 */
export type ProcessStatus = 'processing' | 'live';

/**
 * Process worker record
 * Tracks handler execution progress per chain
 */
export interface ProcessWorker {
  chainId: number;
  /** Start block of the processing range */
  rangeStart: bigint;
  /** End block of the processing range (null when live) */
  rangeEnd: bigint | null;
  /** Current progress block (last processed block) */
  currentBlock: bigint;
  /** Total events processed */
  eventsProcessed: bigint;
  /** Process status: 'processing' (catching up) or 'live' (following sync) */
  status: ProcessStatus;
  /** When this worker was created */
  createdAt: Date;
  /** When this worker was last updated */
  updatedAt: Date;
}

/**
 * Repository for managing process workers
 */
export interface IProcessWorkerRepository {
  /**
   * Get the process worker for a chain
   */
  getWorker(chainId: number): Promise<ProcessWorker | null>;

  /**
   * Create or update a process worker
   */
  setWorker(worker: ProcessWorker): Promise<void>;

  /**
   * Delete a process worker
   */
  deleteWorker(chainId: number): Promise<void>;
}

/**
 * Process checkpoint record
 * Tracks the progress of handler execution per chain
 */
export interface ProcessCheckpoint {
  chainId: number;
  /** Last processed block number */
  blockNumber: bigint;
  /** Handler name (for per-handler tracking) */
  handlerName?: string;
  /** Timestamp when checkpoint was updated */
  updatedAt: Date;
}

/**
 * Repository for managing process checkpoints
 */
export interface IProcessCheckpointRepository {
  /**
   * Get checkpoint for a chain and optional handler
   */
  get(chainId: number, handlerName?: string): Promise<ProcessCheckpoint | null>;

  /**
   * Update checkpoint
   */
  set(checkpoint: ProcessCheckpoint): Promise<void>;

  /**
   * Delete checkpoint
   */
  delete(chainId: number, handlerName?: string): Promise<void>;

  /**
   * Get all checkpoints for a chain
   */
  getAllForChain(chainId: number): Promise<ProcessCheckpoint[]>;

  /**
   * Get all checkpoints
   */
  getAll(): Promise<ProcessCheckpoint[]>;

  /**
   * Get the minimum processed block across all handlers for a chain
   */
  getMinBlock(chainId: number): Promise<bigint | null>;
}

// Legacy types for backwards compatibility during migration
// These will be removed in a future version

/**
 * @deprecated Use SyncWorker instead
 */
export interface SyncCheckpoint {
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  updatedAt: Date;
}

/**
 * @deprecated Use SyncWorker instead
 */
export interface WorkerCheckpoint {
  chainId: number;
  workerId: number;
  rangeStart: bigint;
  rangeEnd: bigint;
  currentBlock: bigint;
  isComplete: boolean;
  updatedAt: Date;
}

/**
 * @deprecated Use ISyncWorkerRepository instead
 */
export interface ISyncCheckpointRepository {
  get(chainId: number): Promise<SyncCheckpoint | null>;
  set(checkpoint: SyncCheckpoint): Promise<void>;
  delete(chainId: number): Promise<void>;
  getAll(): Promise<SyncCheckpoint[]>;
  getWorkerCheckpoints(chainId: number): Promise<WorkerCheckpoint[]>;
  setWorkerCheckpoint(checkpoint: WorkerCheckpoint): Promise<void>;
  deleteWorkerCheckpoints(chainId: number): Promise<void>;
}
