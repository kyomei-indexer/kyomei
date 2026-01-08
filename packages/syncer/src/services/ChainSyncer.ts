import type {
  IBlockSource,
  IEventRepository,
  ISyncCheckpointRepository,
  ILogger,
  BlockWithLogs,
  Log,
} from '@kyomei/core';
import type { ChainConfig, ContractConfig } from '@kyomei/config';

/**
 * Chain syncer options
 */
export interface ChainSyncerOptions {
  chainId: number;
  chainName: string;
  chainConfig: ChainConfig;
  contracts: Array<ContractConfig & { name: string }>;
  blockSource: IBlockSource;
  eventRepository: IEventRepository;
  checkpointRepository: ISyncCheckpointRepository;
  logger: ILogger;
  batchSize?: number;
  onProgress?: (info: SyncProgress) => void;
}

/**
 * Sync progress information
 */
export interface SyncProgress {
  chainId: number;
  chainName: string;
  currentBlock: bigint;
  targetBlock: bigint;
  startBlock: bigint;
  phase: 'historical' | 'catchup' | 'live';
  blocksPerSecond: number;
  eventsStored: number;
}

/**
 * Chain syncer service
 * Handles block-by-block synchronization for a single chain
 */
export class ChainSyncer {
  private readonly chainId: number;
  private readonly chainName: string;
  private readonly chainConfig: ChainConfig;
  private readonly contracts: Array<ContractConfig & { name: string }>;
  private readonly blockSource: IBlockSource;
  private readonly eventRepo: IEventRepository;
  private readonly checkpointRepo: ISyncCheckpointRepository;
  private readonly logger: ILogger;
  private readonly batchSize: number;
  private readonly onProgress?: (info: SyncProgress) => void;

  private isRunning = false;
  private abortController: AbortController | null = null;
  private startTime: number = 0;
  private blocksProcessed = 0;
  private eventsStored = 0;

  constructor(options: ChainSyncerOptions) {
    this.chainId = options.chainId;
    this.chainName = options.chainName;
    this.chainConfig = options.chainConfig;
    this.contracts = options.contracts;
    this.blockSource = options.blockSource;
    this.eventRepo = options.eventRepository;
    this.checkpointRepo = options.checkpointRepository;
    this.logger = options.logger.child({ chain: options.chainName });
    this.batchSize = options.batchSize ?? 100;
    this.onProgress = options.onProgress;
  }

  /**
   * Start syncing
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Syncer already running');
      return;
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.startTime = Date.now();
    this.blocksProcessed = 0;
    this.eventsStored = 0;

    this.logger.info('Starting chain syncer');

    try {
      // Get start block from checkpoint or config
      const startBlock = await this.getStartBlock();
      const targetBlock = await this.getTargetBlock();

      this.logger.info(`Syncing from block ${startBlock} to ${targetBlock}`, {
        startBlock: startBlock.toString(),
        targetBlock: targetBlock.toString(),
      });

      // Historical sync
      if (startBlock < targetBlock) {
        await this.syncRange(startBlock, targetBlock);
      }

      // Live sync
      if (this.blockSource.providesValidatedData || this.hasRealtimeSupport()) {
        await this.startLiveSync();
      } else {
        // Poll-based live sync for RPC sources
        await this.startPollingSync();
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.logger.error('Syncer error', { error: error as Error });
        throw error;
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Stop syncing
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info('Stopping chain syncer');
    this.abortController?.abort();
    this.isRunning = false;
  }

  /**
   * Get current sync status
   */
  getStatus(): {
    isRunning: boolean;
    blocksProcessed: number;
    eventsStored: number;
    blocksPerSecond: number;
  } {
    const elapsed = (Date.now() - this.startTime) / 1000;
    return {
      isRunning: this.isRunning,
      blocksProcessed: this.blocksProcessed,
      eventsStored: this.eventsStored,
      blocksPerSecond: elapsed > 0 ? this.blocksProcessed / elapsed : 0,
    };
  }

  /**
   * Sync a range of blocks
   */
  private async syncRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
    const totalBlocks = toBlock - fromBlock + 1n;
    let currentBlock = fromBlock;

    this.logger.info(`Starting historical sync: ${totalBlocks} blocks`);

    // Build log filter for contracts
    const addresses = this.getContractAddresses();
    const filter = addresses.length > 0 ? { address: addresses as `0x${string}`[], fromBlock, toBlock } : undefined;

    // Stream blocks with logs
    for await (const blockWithLogs of this.blockSource.getBlocks({ from: fromBlock, to: toBlock }, filter)) {
      if (this.abortController?.signal.aborted) break;

      await this.processBlock(blockWithLogs);
      currentBlock = blockWithLogs.block.number;
      this.blocksProcessed++;

      // Update checkpoint periodically
      if (this.blocksProcessed % this.batchSize === 0) {
        await this.updateCheckpoint(currentBlock, blockWithLogs.block.hash);
        this.emitProgress(currentBlock, toBlock, fromBlock, 'historical');
      }
    }

    // Final checkpoint update
    if (currentBlock > fromBlock) {
      const checkpoint = await this.checkpointRepo.get(this.chainId);
      if (!checkpoint || checkpoint.blockNumber < currentBlock) {
        await this.updateCheckpoint(currentBlock, '0x' as `0x${string}`);
      }
    }

    this.logger.info('Historical sync complete', {
      blocks: this.blocksProcessed.toString(),
      events: this.eventsStored.toString(),
    });
  }

  /**
   * Start live sync using block subscriptions
   */
  private async startLiveSync(): Promise<void> {
    if (!this.blockSource.onBlock) {
      this.logger.warn('Block source does not support subscriptions');
      return;
    }

    this.logger.info('Starting live sync with subscriptions');

    const unsubscribe = this.blockSource.onBlock(async (blockWithLogs) => {
      if (this.abortController?.signal.aborted) {
        unsubscribe();
        return;
      }

      await this.processBlock(blockWithLogs);
      this.blocksProcessed++;
      await this.updateCheckpoint(blockWithLogs.block.number, blockWithLogs.block.hash);
      this.emitProgress(blockWithLogs.block.number, blockWithLogs.block.number, blockWithLogs.block.number, 'live');
    });

    // Wait until stopped
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.abortController?.signal.aborted) {
          unsubscribe();
          resolve();
        } else {
          setTimeout(check, 1000);
        }
      };
      check();
    });
  }

  /**
   * Start polling-based live sync for RPC sources
   */
  private async startPollingSync(): Promise<void> {
    const pollingInterval = this.chainConfig.pollingInterval ?? 2000;
    const finalityBlocks = this.getFinalityBlocks();

    this.logger.info('Starting live sync with polling', {
      interval: `${pollingInterval}ms`,
      finality: finalityBlocks.toString(),
    });

    while (!this.abortController?.signal.aborted) {
      try {
        const checkpoint = await this.checkpointRepo.get(this.chainId);
        const lastBlock = checkpoint?.blockNumber ?? 0n;

        // Get latest safe block
        let targetBlock: bigint;
        if (this.blockSource.getFinalizedBlockNumber && this.chainConfig.source.type !== 'hypersync') {
          targetBlock = await this.blockSource.getFinalizedBlockNumber();
        } else {
          const latest = await this.blockSource.getLatestBlockNumber();
          targetBlock = latest - BigInt(finalityBlocks);
        }

        if (targetBlock > lastBlock) {
          await this.syncRange(lastBlock + 1n, targetBlock);
          this.emitProgress(targetBlock, targetBlock, lastBlock, 'live');
        }
      } catch (error) {
        this.logger.error('Polling error', { error: error as Error });
      }

      // Wait for next poll
      await this.sleep(pollingInterval);
    }
  }

  /**
   * Process a single block with logs
   */
  private async processBlock(blockWithLogs: BlockWithLogs): Promise<void> {
    const { block, logs } = blockWithLogs;

    if (logs.length === 0) return;

    // Filter logs for our contracts
    const relevantLogs = this.filterRelevantLogs(logs);

    if (relevantLogs.length === 0) return;

    // Convert to records and insert
    const records = relevantLogs.map((log) =>
      this.eventRepo.logToRecord(log as Log, this.chainId)
    );

    await this.eventRepo.insertBatch(records);
    this.eventsStored += records.length;

    this.logger.debug(`Processed block ${block.number}`, {
      block: block.number,
      events: records.length,
    });
  }

  /**
   * Filter logs for relevant contracts
   */
  private filterRelevantLogs(logs: readonly Log[]): Log[] {
    const addresses = new Set(this.getContractAddresses().map((a) => a.toLowerCase()));

    if (addresses.size === 0) {
      // No address filter - return all logs
      return logs as Log[];
    }

    return logs.filter((log) => addresses.has(log.address.toLowerCase())) as Log[];
  }

  /**
   * Get contract addresses from config
   */
  private getContractAddresses(): string[] {
    const addresses: string[] = [];

    for (const contract of this.contracts) {
      if (typeof contract.address === 'string') {
        addresses.push(contract.address);
      } else if (Array.isArray(contract.address)) {
        addresses.push(...contract.address);
      }
      // Factory addresses are handled separately
    }

    return addresses;
  }

  /**
   * Get the block to start syncing from
   */
  private async getStartBlock(): Promise<bigint> {
    // Check checkpoint first
    const checkpoint = await this.checkpointRepo.get(this.chainId);
    if (checkpoint) {
      return checkpoint.blockNumber + 1n;
    }

    // Use earliest contract start block
    const startBlocks = this.contracts.map((c) => BigInt(c.startBlock));
    return startBlocks.length > 0 ? BigInt(Math.min(...startBlocks.map(Number))) : 0n;
  }

  /**
   * Get the target block to sync to
   */
  private async getTargetBlock(): Promise<bigint> {
    // Check for end blocks in contracts
    const endBlocks = this.contracts
      .filter((c) => c.endBlock !== undefined)
      .map((c) => BigInt(c.endBlock!));

    if (endBlocks.length > 0) {
      return BigInt(Math.max(...endBlocks.map(Number)));
    }

    // Use latest finalized block for RPC sources
    const finalityBlocks = this.getFinalityBlocks();

    if (finalityBlocks > 0 && this.blockSource.getFinalizedBlockNumber) {
      return this.blockSource.getFinalizedBlockNumber();
    }

    const latest = await this.blockSource.getLatestBlockNumber();
    return latest - BigInt(finalityBlocks);
  }

  /**
   * Get finality blocks for the chain
   */
  private getFinalityBlocks(): number {
    if (this.blockSource.providesValidatedData) {
      return 0;
    }

    if (this.chainConfig.finalityBlocks !== undefined) {
      return this.chainConfig.finalityBlocks;
    }

    const source = this.chainConfig.source;
    if ((source.type === 'rpc' || source.type === 'erpc') && source.finality !== 'finalized') {
      return source.finality;
    }

    return 0;
  }

  /**
   * Check if source supports real-time updates
   */
  private hasRealtimeSupport(): boolean {
    return this.blockSource.onBlock !== undefined;
  }

  /**
   * Update sync checkpoint
   */
  private async updateCheckpoint(blockNumber: bigint, blockHash: string): Promise<void> {
    await this.checkpointRepo.set({
      chainId: this.chainId,
      blockNumber,
      blockHash,
      updatedAt: new Date(),
    });
  }

  /**
   * Emit progress update
   */
  private emitProgress(
    currentBlock: bigint,
    targetBlock: bigint,
    startBlock: bigint,
    phase: 'historical' | 'catchup' | 'live'
  ): void {
    if (!this.onProgress) return;

    const elapsed = (Date.now() - this.startTime) / 1000;
    const blocksPerSecond = elapsed > 0 ? this.blocksProcessed / elapsed : 0;

    this.onProgress({
      chainId: this.chainId,
      chainName: this.chainName,
      currentBlock,
      targetBlock,
      startBlock,
      phase,
      blocksPerSecond,
      eventsStored: this.eventsStored,
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
