import type { Log } from '../../domain/entities/Log.ts';
import type { BlockRange } from '../../domain/entities/Block.ts';

/**
 * Raw event record for storage
 */
export interface RawEventRecord {
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  blockTimestamp: bigint;
  txIndex: number;
  logIndex: number;
  txHash: string;
  address: string;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
  data: string;
}

/**
 * Event query options
 */
export interface EventQueryOptions {
  /** Chain ID */
  chainId: number;
  /** Contract addresses to filter */
  addresses?: string[];
  /** Event signatures (topic0) to filter */
  eventSignatures?: string[];
  /** Block range */
  blockRange?: BlockRange;
  /** Order by block (default: asc) */
  order?: 'asc' | 'desc';
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Repository interface for raw event storage
 */
export interface IEventRepository {
  /**
   * Insert raw events in batch
   */
  insertBatch(events: RawEventRecord[]): Promise<void>;

  /**
   * Query events with filters
   */
  query(options: EventQueryOptions): Promise<RawEventRecord[]>;

  /**
   * Get events for a specific block
   */
  getByBlock(chainId: number, blockNumber: bigint): Promise<RawEventRecord[]>;

  /**
   * Get event count for chain
   */
  count(chainId: number, blockRange?: BlockRange): Promise<number>;

  /**
   * Delete events in a block range (for reorg handling)
   */
  deleteRange(chainId: number, fromBlock: bigint, toBlock?: bigint): Promise<number>;

  /**
   * Check if events exist for a block
   */
  hasBlock(chainId: number, blockNumber: bigint): Promise<boolean>;

  /**
   * Get the latest stored block number
   */
  getLatestBlock(chainId: number): Promise<bigint | null>;

  /**
   * Get the earliest stored block number
   */
  getEarliestBlock(chainId: number): Promise<bigint | null>;

  /**
   * Get block numbers with gaps (missing blocks)
   */
  getGaps(chainId: number, fromBlock: bigint, toBlock: bigint): Promise<BlockRange[]>;

  /**
   * Convert Log to RawEventRecord
   */
  logToRecord(log: Log, chainId: number): RawEventRecord;
}
