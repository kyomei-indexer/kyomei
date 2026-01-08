import type { BlockRange, BlockWithLogs } from '../../domain/entities/Block.js';
import { splitBlockRange } from '../../domain/entities/Block.js';
import type { LogFilter } from '../../domain/entities/Log.js';
import type { IBlockSource, BlockHandler, Unsubscribe, SourceType } from '../../application/ports/IBlockSource.js';
import type { IRpcClient } from '../../application/ports/IRpcClient.js';
import type { ILogger } from '../../application/ports/ILogger.js';
import { RpcClient } from './RpcClient.js';

/**
 * RPC-based block source implementation
 */
export class RpcBlockSource implements IBlockSource {
  readonly sourceType: SourceType = 'rpc';
  readonly providesValidatedData = false;
  readonly chainId: number;

  private readonly client: IRpcClient;
  private readonly logger?: ILogger;
  private readonly maxBlockRange: number;
  private readonly pollingInterval: number;
  private subscriptions: Set<BlockHandler> = new Set();
  private pollTimer: NodeJS.Timeout | null = null;
  private lastKnownBlock: bigint = 0n;

  constructor(params: {
    chainId: number;
    url: string;
    maxBlockRange?: number;
    pollingInterval?: number;
    logger?: ILogger;
    client?: IRpcClient;
  }) {
    this.chainId = params.chainId;
    this.client = params.client ?? new RpcClient({ chainId: params.chainId, url: params.url });
    this.maxBlockRange = params.maxBlockRange ?? 1000;
    this.pollingInterval = params.pollingInterval ?? 2000;
    this.logger = params.logger;
  }

  async *getBlocks(range: BlockRange, filter?: LogFilter): AsyncGenerator<BlockWithLogs, void, unknown> {
    // Split into manageable chunks
    const chunks = splitBlockRange(range, BigInt(this.maxBlockRange));

    for (const chunk of chunks) {
      this.logger?.trace(`Fetching blocks ${chunk.from}-${chunk.to}`, {
        module: 'RpcBlockSource',
        chain: String(this.chainId),
      });

      // Get logs for the chunk
      const logs = await this.client.getLogs({
        fromBlock: chunk.from,
        toBlock: chunk.to,
        ...filter,
      });

      // Group logs by block
      const logsByBlock = new Map<bigint, typeof logs>();
      for (const log of logs) {
        const existing = logsByBlock.get(log.blockNumber) ?? [];
        existing.push(log);
        logsByBlock.set(log.blockNumber, existing);
      }

      // Yield blocks with logs
      for (let blockNumber = chunk.from; blockNumber <= chunk.to; blockNumber++) {
        const blockLogs = logsByBlock.get(blockNumber) ?? [];

        // Only fetch full block data if there are logs or if we need block info
        let block = null;
        if (blockLogs.length > 0) {
          block = await this.client.getBlock(blockNumber);
        }

        // If we have logs but couldn't get block, create minimal block from log data
        if (blockLogs.length > 0 && !block && blockLogs[0]) {
          const firstLog = blockLogs[0];
          yield {
            block: {
              number: blockNumber,
              hash: firstLog.blockHash,
              parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
              timestamp: firstLog.blockTimestamp,
              gasLimit: 0n,
              gasUsed: 0n,
              baseFeePerGas: null,
              miner: '0x0000000000000000000000000000000000000000' as `0x${string}`,
              extraData: '0x' as `0x${string}`,
              transactionCount: 0,
            },
            logs: blockLogs,
          };
        } else if (block) {
          yield {
            block,
            logs: blockLogs,
          };
        }
        // Skip blocks with no logs and no block data needed
      }
    }
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async getFinalizedBlockNumber(): Promise<bigint> {
    return this.client.getFinalizedBlockNumber();
  }

  onBlock(handler: BlockHandler): Unsubscribe {
    this.subscriptions.add(handler);

    // Start polling if not already
    if (!this.pollTimer) {
      this.startPolling();
    }

    return () => {
      this.subscriptions.delete(handler);
      if (this.subscriptions.size === 0) {
        this.stopPolling();
      }
    };
  }

  async getBlocksByNumbers(blockNumbers: bigint[]): Promise<BlockWithLogs[]> {
    const results: BlockWithLogs[] = [];

    for (const blockNumber of blockNumbers) {
      const block = await this.client.getBlock(blockNumber);
      if (block) {
        const logs = await this.client.getLogs({
          fromBlock: blockNumber,
          toBlock: blockNumber,
        });
        results.push({ block, logs });
      }
    }

    return results;
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }

  async close(): Promise<void> {
    this.stopPolling();
    this.subscriptions.clear();
  }

  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      try {
        const latestBlock = await this.client.getBlockNumber();

        if (latestBlock > this.lastKnownBlock) {
          // Fetch new blocks
          for (let blockNumber = this.lastKnownBlock + 1n; blockNumber <= latestBlock; blockNumber++) {
            const block = await this.client.getBlock(blockNumber);
            if (!block) continue;

            const logs = await this.client.getLogs({
              fromBlock: blockNumber,
              toBlock: blockNumber,
            });

            const blockWithLogs: BlockWithLogs = { block, logs };

            // Notify all subscribers
            for (const handler of this.subscriptions) {
              try {
                await handler(blockWithLogs);
              } catch (error) {
                this.logger?.error('Block handler error', {
                  module: 'RpcBlockSource',
                  error: error as Error,
                });
              }
            }
          }

          this.lastKnownBlock = latestBlock;
        }
      } catch (error) {
        this.logger?.error('Polling error', {
          module: 'RpcBlockSource',
          error: error as Error,
        });
      }
    }, this.pollingInterval);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
