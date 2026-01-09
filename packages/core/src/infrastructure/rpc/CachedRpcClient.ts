import { createHash } from 'node:crypto';
import type { Block } from '../../domain/entities/Block.ts';
import type { Log, LogFilter } from '../../domain/entities/Log.ts';
import type { Transaction, TransactionReceipt } from '../../domain/entities/Transaction.ts';
import type {
  ICachedRpcClient,
  IRpcClient,
  ReadContractParams,
  RpcCallParams,
} from '../../application/ports/IRpcClient.ts';
import type { IRpcCacheRepository } from '../../application/ports/IRpcCacheRepository.ts';
import type { ILogger } from '../../application/ports/ILogger.ts';

/**
 * Cached RPC client implementation
 * Stores RPC responses in the database for deterministic replay
 */
export class CachedRpcClient implements ICachedRpcClient {
  readonly chainId: number;
  readonly url: string;

  private readonly client: IRpcClient;
  private readonly cacheRepo: IRpcCacheRepository;
  private readonly logger?: ILogger;
  private currentBlockNumber: bigint = 0n;
  private stats = { hits: 0, misses: 0, stored: 0 };

  constructor(params: {
    client: IRpcClient;
    cacheRepo: IRpcCacheRepository;
    logger?: ILogger;
  }) {
    this.chainId = params.client.chainId;
    this.url = params.client.url;
    this.client = params.client;
    this.cacheRepo = params.cacheRepo;
    this.logger = params.logger;
  }

  setBlockContext(blockNumber: bigint): void {
    this.currentBlockNumber = blockNumber;
  }

  getCacheStats(): { hits: number; misses: number; stored: number } {
    return { ...this.stats };
  }

  async clearCache(): Promise<void> {
    await this.cacheRepo.clear(this.chainId);
    this.stats = { hits: 0, misses: 0, stored: 0 };
  }

  async getBlockNumber(): Promise<bigint> {
    // Don't cache block number - it changes
    return this.client.getBlockNumber();
  }

  async getFinalizedBlockNumber(): Promise<bigint> {
    // Don't cache finalized block - it changes
    return this.client.getFinalizedBlockNumber();
  }

  async getBlock(blockNumber: bigint): Promise<Block | null> {
    return this.withCache('eth_getBlockByNumber', [blockNumber.toString()], () =>
      this.client.getBlock(blockNumber)
    );
  }

  async getBlockByHash(hash: `0x${string}`): Promise<Block | null> {
    return this.withCache('eth_getBlockByHash', [hash], () =>
      this.client.getBlockByHash(hash)
    );
  }

  async getLogs(filter: LogFilter): Promise<Log[]> {
    // Cache logs for specific block ranges
    return this.withCache(
      'eth_getLogs',
      [filter.fromBlock.toString(), filter.toBlock.toString(), filter.address, filter.topics],
      () => this.client.getLogs(filter)
    );
  }

  async getTransaction(hash: `0x${string}`): Promise<Transaction | null> {
    return this.withCache('eth_getTransactionByHash', [hash], () =>
      this.client.getTransaction(hash)
    );
  }

  async getTransactionReceipt(hash: `0x${string}`): Promise<TransactionReceipt | null> {
    return this.withCache('eth_getTransactionReceipt', [hash], () =>
      this.client.getTransactionReceipt(hash)
    );
  }

  async getBalance(address: `0x${string}`, blockNumber?: bigint): Promise<bigint> {
    const block = blockNumber ?? this.currentBlockNumber;
    return this.withCache('eth_getBalance', [address, block.toString()], () =>
      this.client.getBalance(address, block)
    );
  }

  async readContract<TResult = unknown>(params: ReadContractParams): Promise<TResult> {
    const block = params.blockNumber ?? this.currentBlockNumber;
    return this.withCache(
      'eth_call',
      [params.address, params.functionName, params.args, block.toString()],
      () => this.client.readContract({ ...params, blockNumber: block })
    );
  }

  async call(params: RpcCallParams): Promise<`0x${string}`> {
    const block = typeof params.blockNumber === 'bigint'
      ? params.blockNumber
      : this.currentBlockNumber;

    return this.withCache(
      'eth_call',
      [params.to, params.data, block.toString()],
      () => this.client.call({ ...params, blockNumber: block })
    );
  }

  async batch<T extends readonly unknown[]>(
    calls: { method: string; params: unknown[] }[]
  ): Promise<T> {
    // For batch calls, try cache for each, fall back to batch for misses
    const results: unknown[] = [];
    const uncachedCalls: { index: number; call: { method: string; params: unknown[] } }[] = [];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const requestHash = this.generateRequestHash(call.method, call.params);
      const cached = await this.cacheRepo.get({
        chainId: this.chainId,
        blockNumber: this.currentBlockNumber,
        method: call.method,
        requestHash,
      });

      if (cached) {
        results[i] = JSON.parse(cached);
        this.stats.hits++;
      } else {
        uncachedCalls.push({ index: i, call });
      }
    }

    // Execute uncached calls in batch
    if (uncachedCalls.length > 0) {
      const batchResults = await this.client.batch(uncachedCalls.map((c) => c.call));

      for (let i = 0; i < uncachedCalls.length; i++) {
        const { index, call } = uncachedCalls[i];
        const result = batchResults[i];
        results[index] = result;
        this.stats.misses++;

        // Cache the result
        await this.storeInCache(call.method, call.params, result);
      }
    }

    return results as unknown as T;
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }

  /**
   * Execute with caching
   */
  private async withCache<T>(
    method: string,
    params: unknown[],
    execute: () => Promise<T>
  ): Promise<T> {
    const requestHash = this.generateRequestHash(method, params);

    // Try cache first
    const cached = await this.cacheRepo.get({
      chainId: this.chainId,
      blockNumber: this.currentBlockNumber,
      method,
      requestHash,
    });

    if (cached) {
      this.stats.hits++;
      this.logger?.trace(`Cache hit: ${method}`, {
        module: 'CachedRpcClient',
        chain: String(this.chainId),
      });
      return this.deserialize<T>(cached);
    }

    // Cache miss - execute and store
    this.stats.misses++;
    const result = await execute();
    await this.storeInCache(method, params, result);

    return result;
  }

  /**
   * Store result in cache
   */
  private async storeInCache(method: string, params: unknown[], result: unknown): Promise<void> {
    const requestHash = this.generateRequestHash(method, params);

    await this.cacheRepo.set({
      chainId: this.chainId,
      blockNumber: this.currentBlockNumber,
      method,
      params: this.serialize(params),
      response: this.serialize(result),
      requestHash,
      createdAt: new Date(),
    });

    this.stats.stored++;
    this.logger?.trace(`Cached: ${method}`, {
      module: 'CachedRpcClient',
      chain: String(this.chainId),
    });
  }

  /**
   * Generate request hash for cache lookup
   */
  private generateRequestHash(method: string, params: unknown[]): string {
    const data = JSON.stringify({ method, params }, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Serialize value for storage
   */
  private serialize(value: unknown): string {
    return JSON.stringify(value, (_, v) =>
      typeof v === 'bigint' ? `__bigint__${v.toString()}` : v
    );
  }

  /**
   * Deserialize value from storage
   */
  private deserialize<T>(json: string): T {
    return JSON.parse(json, (_, v) => {
      if (typeof v === 'string' && v.startsWith('__bigint__')) {
        return BigInt(v.slice(10));
      }
      return v;
    });
  }
}
