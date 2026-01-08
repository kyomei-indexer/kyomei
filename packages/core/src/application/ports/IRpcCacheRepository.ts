/**
 * RPC cache record for storing responses
 */
export interface RpcCacheRecord {
  /** Chain ID */
  chainId: number;
  /** Block number the call was made for */
  blockNumber: bigint;
  /** RPC method (e.g., 'eth_call', 'eth_getBalance') */
  method: string;
  /** JSON-serialized parameters */
  params: string;
  /** JSON-serialized response */
  response: string;
  /** Hash of method + params for quick lookup */
  requestHash: string;
  /** When the cache entry was created */
  createdAt: Date;
}

/**
 * Repository for caching RPC responses
 * Used to ensure deterministic replay of handlers
 */
export interface IRpcCacheRepository {
  /**
   * Get cached response
   */
  get(params: {
    chainId: number;
    blockNumber: bigint;
    method: string;
    requestHash: string;
  }): Promise<string | null>;

  /**
   * Store response in cache
   */
  set(record: RpcCacheRecord): Promise<void>;

  /**
   * Store multiple responses in batch
   */
  setBatch(records: RpcCacheRecord[]): Promise<void>;

  /**
   * Delete cache entries for a block range (for reorg handling)
   */
  deleteRange(chainId: number, fromBlock: bigint, toBlock?: bigint): Promise<number>;

  /**
   * Get cache statistics
   */
  getStats(chainId: number): Promise<{
    totalEntries: number;
    earliestBlock: bigint | null;
    latestBlock: bigint | null;
    sizeBytes: number;
  }>;

  /**
   * Clear all cache entries for a chain
   */
  clear(chainId: number): Promise<void>;

  /**
   * Generate request hash from method and params
   */
  generateRequestHash(method: string, params: unknown[]): string;
}
