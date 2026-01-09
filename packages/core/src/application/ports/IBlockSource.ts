import type { BlockRange, BlockWithLogs } from '../../domain/entities/Block.ts';
import type { LogFilter } from '../../domain/entities/Log.ts';

/**
 * Source type identifier
 */
export type SourceType = 'rpc' | 'erpc' | 'hypersync' | 'stream';

/**
 * Block handler callback for real-time sources
 */
export type BlockHandler = (block: BlockWithLogs) => Promise<void> | void;

/**
 * Unsubscribe function for real-time subscriptions
 */
export type Unsubscribe = () => void;

/**
 * Block source interface for fetching blockchain data
 * All data sources must implement this interface
 */
export interface IBlockSource {
  /**
   * Source type identifier
   */
  readonly sourceType: SourceType;

  /**
   * Whether this source provides pre-validated/finalized data
   * - true: Data is already validated (HyperSync, QuickNode Streams)
   * - false: Data may be subject to reorgs (RPC, eRPC)
   */
  readonly providesValidatedData: boolean;

  /**
   * Chain ID this source is connected to
   */
  readonly chainId: number;

  /**
   * Fetch blocks with logs in a range
   * Returns an async generator for efficient streaming
   */
  getBlocks(range: BlockRange, filter?: LogFilter): AsyncGenerator<BlockWithLogs, void, unknown>;

  /**
   * Get the latest block number
   */
  getLatestBlockNumber(): Promise<bigint>;

  /**
   * Get the finalized/safe block number
   * Only available for RPC/eRPC sources
   */
  getFinalizedBlockNumber?(): Promise<bigint>;

  /**
   * Subscribe to new blocks (real-time sources)
   * Only available for certain source types
   */
  onBlock?(handler: BlockHandler): Unsubscribe;

  /**
   * Get blocks by specific block numbers
   */
  getBlocksByNumbers?(blockNumbers: bigint[]): Promise<BlockWithLogs[]>;

  /**
   * Health check
   */
  isHealthy(): Promise<boolean>;

  /**
   * Close connection and cleanup
   */
  close(): Promise<void>;
}

/**
 * Factory interface for creating block sources
 */
export interface IBlockSourceFactory {
  /**
   * Create a block source from configuration
   */
  create(config: {
    type: SourceType;
    chainId: number;
    url: string;
    options?: Record<string, unknown>;
  }): IBlockSource;
}
