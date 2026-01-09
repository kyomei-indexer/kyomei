import type { BlockRange, BlockWithLogs } from '../../domain/entities/Block.ts';
import type { LogFilter } from '../../domain/entities/Log.ts';
import type { IBlockSource, BlockHandler, Unsubscribe, SourceType } from '../../application/ports/IBlockSource.ts';
import type { ILogger } from '../../application/ports/ILogger.ts';
import { RpcBlockSource } from './RpcBlockSource.ts';

/**
 * eRPC-based block source implementation
 *
 * eRPC provides:
 * - Automatic failover between multiple upstream RPCs
 * - Request caching with reorg awareness
 * - Rate limiting and circuit breakers
 * - Metrics and observability
 *
 * This implementation wraps RpcBlockSource but:
 * - Points to eRPC proxy URL
 * - Uses larger block ranges (eRPC handles caching)
 * - Can leverage eRPC's finality awareness
 *
 * @see https://github.com/erpc/erpc
 */
export class ErpcBlockSource implements IBlockSource {
  readonly sourceType: SourceType = 'erpc';
  readonly providesValidatedData = false;
  readonly chainId: number;

  private readonly innerSource: RpcBlockSource;
  private readonly logger?: ILogger;

  constructor(params: {
    chainId: number;
    /** eRPC proxy URL (e.g., http://localhost:4000) */
    url: string;
    /** eRPC project ID (optional) */
    projectId?: string;
    /** Maximum block range per request (default: 2000, higher for eRPC) */
    maxBlockRange?: number;
    /** Polling interval in milliseconds */
    pollingInterval?: number;
    logger?: ILogger;
  }) {
    this.chainId = params.chainId;
    this.logger = params.logger;

    // Build eRPC URL with chain routing
    // eRPC routes requests based on chain ID in the path: /main/evm/{chainId}
    const erpcUrl = this.buildErpcUrl(params.url, params.chainId, params.projectId);

    this.logger?.debug(`Initializing eRPC source for chain ${params.chainId}`, {
      module: 'ErpcBlockSource',
      url: erpcUrl,
    });

    // Use RpcBlockSource with eRPC as the RPC endpoint
    // eRPC handles caching, failover, and rate limiting
    this.innerSource = new RpcBlockSource({
      chainId: params.chainId,
      url: erpcUrl,
      // eRPC can handle larger ranges due to caching
      maxBlockRange: params.maxBlockRange ?? 2000,
      pollingInterval: params.pollingInterval ?? 2000,
      logger: params.logger,
    });
  }

  async *getBlocks(range: BlockRange, filter?: LogFilter): AsyncGenerator<BlockWithLogs, void, unknown> {
    this.logger?.trace(`eRPC fetching blocks ${range.from}-${range.to}`, {
      module: 'ErpcBlockSource',
      chain: String(this.chainId),
    });

    yield* this.innerSource.getBlocks(range, filter);
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.innerSource.getLatestBlockNumber();
  }

  async getFinalizedBlockNumber(): Promise<bigint> {
    // eRPC can return finalized blocks through standard RPC
    // It handles finality tracking internally
    return this.innerSource.getFinalizedBlockNumber!();
  }

  onBlock(handler: BlockHandler): Unsubscribe {
    return this.innerSource.onBlock(handler);
  }

  async getBlocksByNumbers(blockNumbers: bigint[]): Promise<BlockWithLogs[]> {
    return this.innerSource.getBlocksByNumbers!(blockNumbers);
  }

  async isHealthy(): Promise<boolean> {
    return this.innerSource.isHealthy();
  }

  async close(): Promise<void> {
    return this.innerSource.close();
  }

  /**
   * Build eRPC URL with chain routing
   *
   * eRPC URL format: {base_url}/{project_id}/evm/{chain_id}
   * Example: http://localhost:4000/main/evm/1
   */
  private buildErpcUrl(baseUrl: string, chainId: number, projectId?: string): string {
    // Remove trailing slash
    const cleanUrl = baseUrl.replace(/\/$/, '');

    // Default project is 'main' in eRPC
    const project = projectId ?? 'main';

    return `${cleanUrl}/${project}/evm/${chainId}`;
  }

  /**
   * Get cache statistics from eRPC (if available)
   */
  async getCacheStats(): Promise<{ hits: number; misses: number } | null> {
    // eRPC exposes metrics on a separate port (default: 4001)
    // This would need to query the metrics endpoint
    // For now, return null as this requires metrics integration
    return null;
  }
}
