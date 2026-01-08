import type { Abi } from 'viem';
import type { Block } from '../../domain/entities/Block.js';
import type { Log, LogFilter } from '../../domain/entities/Log.js';
import type { Transaction, TransactionReceipt } from '../../domain/entities/Transaction.js';

/**
 * RPC call parameters
 */
export interface RpcCallParams {
  /** Contract address */
  to: `0x${string}`;
  /** Encoded call data */
  data: `0x${string}`;
  /** Block number or tag */
  blockNumber?: bigint | 'latest' | 'finalized' | 'safe';
}

/**
 * Contract read parameters
 */
export interface ReadContractParams {
  /** Contract address */
  address: `0x${string}`;
  /** Contract ABI */
  abi: Abi;
  /** Function name to call */
  functionName: string;
  /** Function arguments */
  args?: unknown[];
  /** Block number to read at */
  blockNumber?: bigint;
}

/**
 * Low-level RPC client interface
 */
export interface IRpcClient {
  /**
   * Chain ID
   */
  readonly chainId: number;

  /**
   * RPC endpoint URL
   */
  readonly url: string;

  /**
   * Get current block number
   */
  getBlockNumber(): Promise<bigint>;

  /**
   * Get finalized block number (PoS chains)
   */
  getFinalizedBlockNumber(): Promise<bigint>;

  /**
   * Get block by number
   */
  getBlock(blockNumber: bigint): Promise<Block | null>;

  /**
   * Get block by hash
   */
  getBlockByHash(hash: `0x${string}`): Promise<Block | null>;

  /**
   * Get logs matching filter
   */
  getLogs(filter: LogFilter): Promise<Log[]>;

  /**
   * Get transaction by hash
   */
  getTransaction(hash: `0x${string}`): Promise<Transaction | null>;

  /**
   * Get transaction receipt
   */
  getTransactionReceipt(hash: `0x${string}`): Promise<TransactionReceipt | null>;

  /**
   * Get account balance
   */
  getBalance(address: `0x${string}`, blockNumber?: bigint): Promise<bigint>;

  /**
   * Read contract state
   */
  readContract<TResult = unknown>(params: ReadContractParams): Promise<TResult>;

  /**
   * Raw eth_call
   */
  call(params: RpcCallParams): Promise<`0x${string}`>;

  /**
   * Batch multiple RPC calls
   */
  batch<T extends readonly unknown[]>(
    calls: {
      method: string;
      params: unknown[];
    }[]
  ): Promise<T>;

  /**
   * Health check
   */
  isHealthy(): Promise<boolean>;
}

/**
 * Cached RPC client that stores responses in the database
 * Used by handlers to ensure deterministic replay
 */
export interface ICachedRpcClient extends IRpcClient {
  /**
   * Current block context for caching
   */
  setBlockContext(blockNumber: bigint): void;

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    hits: number;
    misses: number;
    stored: number;
  };

  /**
   * Clear cache (for testing)
   */
  clearCache(): Promise<void>;
}

/**
 * RPC client factory
 */
export interface IRpcClientFactory {
  /**
   * Create an RPC client
   */
  create(params: { chainId: number; url: string }): IRpcClient;

  /**
   * Create a cached RPC client
   */
  createCached(params: { chainId: number; url: string; cacheRepository: unknown }): ICachedRpcClient;
}
