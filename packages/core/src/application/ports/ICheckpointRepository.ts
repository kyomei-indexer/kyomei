/**
 * Sync checkpoint record
 * Tracks the progress of raw event ingestion per chain
 */
export interface SyncCheckpoint {
  chainId: number;
  /** Last fully synced block number */
  blockNumber: bigint;
  /** Block hash at checkpoint (for reorg detection) */
  blockHash: string;
  /** Timestamp when checkpoint was updated */
  updatedAt: Date;
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
 * Repository for managing sync checkpoints
 */
export interface ISyncCheckpointRepository {
  /**
   * Get checkpoint for a chain
   */
  get(chainId: number): Promise<SyncCheckpoint | null>;

  /**
   * Update checkpoint
   */
  set(checkpoint: SyncCheckpoint): Promise<void>;

  /**
   * Delete checkpoint (for reset)
   */
  delete(chainId: number): Promise<void>;

  /**
   * Get all checkpoints
   */
  getAll(): Promise<SyncCheckpoint[]>;
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
