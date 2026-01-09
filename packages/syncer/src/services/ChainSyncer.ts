import type {
  IBlockSource,
  IEventRepository,
  ISyncCheckpointRepository,
  ILogger,
  BlockWithLogs,
  Log,
} from "@kyomei/core";
import type { ChainConfig, ContractConfig, SyncConfig } from "@kyomei/config";

/**
 * Default sync configuration values
 */
const DEFAULT_SYNC_CONFIG: Required<SyncConfig> = {
  parallelWorkers: 1,
  blockRangePerRequest: 1000,
  blocksPerWorker: 100000,
  eventBatchSize: 1000,
};

/**
 * Source-specific default block ranges
 */
const SOURCE_DEFAULT_BLOCK_RANGES: Record<string, number> = {
  rpc: 1000,
  erpc: 2000,
  hypersync: 10000,
  stream: 1000,
};

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
  phase: "historical" | "catchup" | "live";
  blocksPerSecond: number;
  eventsStored: number;
  /** Current worker index (for parallel sync) */
  workerId?: number;
  /** Total number of parallel workers */
  totalWorkers?: number;
}

/**
 * Worker chunk definition for parallel sync
 */
interface WorkerChunk {
  workerId: number;
  fromBlock: bigint;
  toBlock: bigint;
}

/**
 * Worker state for tracking progress
 */
interface WorkerState {
  workerId: number;
  currentBlock: bigint;
  targetBlock: bigint;
  blocksProcessed: number;
  eventsStored: number;
  isComplete: boolean;
  error?: Error;
}

/**
 * Chain syncer service
 * Handles block-by-block synchronization for a single chain
 * Supports parallel historical sync with configurable block ranges
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
  private readonly syncConfig: Required<SyncConfig>;

  private isRunning = false;
  private abortController: AbortController | null = null;
  private startTime: number = 0;
  private blocksProcessed = 0;
  private eventsStored = 0;
  private workerStates: Map<number, WorkerState> = new Map();

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

    // Merge sync config with defaults
    const sourceType = options.chainConfig.source.type;
    const defaultBlockRange =
      SOURCE_DEFAULT_BLOCK_RANGES[sourceType] ??
      DEFAULT_SYNC_CONFIG.blockRangePerRequest;

    this.syncConfig = {
      parallelWorkers:
        options.chainConfig.sync?.parallelWorkers ??
        DEFAULT_SYNC_CONFIG.parallelWorkers,
      blockRangePerRequest:
        options.chainConfig.sync?.blockRangePerRequest ?? defaultBlockRange,
      blocksPerWorker:
        options.chainConfig.sync?.blocksPerWorker ??
        DEFAULT_SYNC_CONFIG.blocksPerWorker,
      eventBatchSize:
        options.chainConfig.sync?.eventBatchSize ??
        DEFAULT_SYNC_CONFIG.eventBatchSize,
    };

    this.logger.debug("Sync configuration", {
      parallelWorkers: this.syncConfig.parallelWorkers,
      blockRangePerRequest: this.syncConfig.blockRangePerRequest,
      blocksPerWorker: this.syncConfig.blocksPerWorker,
    });
  }

  /**
   * Start syncing
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Syncer already running");
      return;
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.startTime = Date.now();
    this.blocksProcessed = 0;
    this.eventsStored = 0;
    this.workerStates.clear();

    this.logger.info("Starting chain syncer");

    try {
      // Get start block from checkpoint or config
      const startBlock = await this.getStartBlock();
      const targetBlock = await this.getTargetBlock();
      const totalBlocks = targetBlock - startBlock;

      this.logger.info(`Syncing from block ${startBlock} to ${targetBlock}`, {
        startBlock: startBlock.toString(),
        targetBlock: targetBlock.toString(),
        totalBlocks: totalBlocks.toString(),
        parallelWorkers: this.syncConfig.parallelWorkers,
        blockRangePerRequest: this.syncConfig.blockRangePerRequest,
      });

      // Historical sync with parallel workers if configured
      if (startBlock < targetBlock) {
        const useParallel =
          this.syncConfig.parallelWorkers > 1 &&
          totalBlocks > BigInt(this.syncConfig.blocksPerWorker);

        if (useParallel) {
          this.logger.info(
            `Using parallel sync with ${this.syncConfig.parallelWorkers} workers`
          );
          await this.syncRangeParallel(startBlock, targetBlock);
        } else {
          await this.syncRange(startBlock, targetBlock, 0);
        }
      }

      // Live sync
      if (this.blockSource.providesValidatedData || this.hasRealtimeSupport()) {
        await this.startLiveSync();
      } else {
        // Poll-based live sync for RPC sources
        await this.startPollingSync();
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        this.logger.error("Syncer error", { error: error as Error });
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

    this.logger.info("Stopping chain syncer");
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
   * Split block range into chunks for parallel workers
   */
  private createWorkerChunks(
    fromBlock: bigint,
    toBlock: bigint,
    numWorkers: number
  ): WorkerChunk[] {
    const totalBlocks = toBlock - fromBlock + 1n;
    const blocksPerWorker = totalBlocks / BigInt(numWorkers);
    const chunks: WorkerChunk[] = [];

    let currentStart = fromBlock;
    for (let i = 0; i < numWorkers; i++) {
      const isLastWorker = i === numWorkers - 1;
      const chunkEnd = isLastWorker
        ? toBlock
        : currentStart + blocksPerWorker - 1n;

      chunks.push({
        workerId: i,
        fromBlock: currentStart,
        toBlock: chunkEnd,
      });

      currentStart = chunkEnd + 1n;
    }

    return chunks;
  }

  /**
   * Sync a range of blocks using parallel workers
   */
  private async syncRangeParallel(
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<void> {
    const chunks = this.createWorkerChunks(
      fromBlock,
      toBlock,
      this.syncConfig.parallelWorkers
    );

    this.logger.info(`Starting parallel historical sync`, {
      workers: chunks.length,
      totalBlocks: (toBlock - fromBlock + 1n).toString(),
      chunks: chunks.map((c) => ({
        worker: c.workerId,
        from: c.fromBlock.toString(),
        to: c.toBlock.toString(),
        blocks: (c.toBlock - c.fromBlock + 1n).toString(),
      })),
    });

    // Initialize worker states
    for (const chunk of chunks) {
      this.workerStates.set(chunk.workerId, {
        workerId: chunk.workerId,
        currentBlock: chunk.fromBlock,
        targetBlock: chunk.toBlock,
        blocksProcessed: 0,
        eventsStored: 0,
        isComplete: false,
      });
    }

    // Start all workers in parallel
    const workerPromises = chunks.map((chunk) =>
      this.runWorker(chunk).catch((error) => {
        const state = this.workerStates.get(chunk.workerId);
        if (state) {
          state.error = error as Error;
          state.isComplete = true;
        }
        this.logger.error(`Worker ${chunk.workerId} failed`, {
          error: error as Error,
          fromBlock: chunk.fromBlock.toString(),
          toBlock: chunk.toBlock.toString(),
        });
      })
    );

    // Wait for all workers to complete
    await Promise.all(workerPromises);

    // Check for any worker errors
    const errors = Array.from(this.workerStates.values()).filter(
      (s) => s.error
    );
    if (errors.length > 0) {
      throw new Error(
        `${errors.length} workers failed during parallel sync: ${errors
          .map((e) => e.error?.message)
          .join(", ")}`
      );
    }

    // Aggregate final stats
    let totalBlocksProcessed = 0;
    let totalEventsStored = 0;
    for (const state of this.workerStates.values()) {
      totalBlocksProcessed += state.blocksProcessed;
      totalEventsStored += state.eventsStored;
    }

    this.blocksProcessed = totalBlocksProcessed;
    this.eventsStored = totalEventsStored;

    // Update checkpoint to the highest completed block
    await this.updateCheckpoint(toBlock, "0x" as `0x${string}`);

    this.logger.info("Parallel historical sync complete", {
      workers: chunks.length,
      blocks: totalBlocksProcessed.toString(),
      events: totalEventsStored.toString(),
    });
  }

  /**
   * Run a single worker for a chunk of blocks
   */
  private async runWorker(chunk: WorkerChunk): Promise<void> {
    const workerLogger = this.logger.child({
      worker: chunk.workerId,
      totalWorkers: this.syncConfig.parallelWorkers,
    });
    const state = this.workerStates.get(chunk.workerId)!;

    workerLogger.info(
      `Worker ${chunk.workerId} starting: blocks ${chunk.fromBlock} to ${chunk.toBlock}`
    );

    // Build log filter for contracts
    const addresses = this.getContractAddresses();
    const filter =
      addresses.length > 0
        ? {
            address: addresses as `0x${string}`[],
            fromBlock: chunk.fromBlock,
            toBlock: chunk.toBlock,
          }
        : undefined;

    // Stream blocks with logs
    for await (const blockWithLogs of this.blockSource.getBlocks(
      { from: chunk.fromBlock, to: chunk.toBlock },
      filter
    )) {
      if (this.abortController?.signal.aborted) break;

      await this.processBlockForWorker(blockWithLogs, state);
      state.currentBlock = blockWithLogs.block.number;
      state.blocksProcessed++;

      // Emit progress periodically
      if (state.blocksProcessed % this.batchSize === 0) {
        this.emitWorkerProgress(state, chunk);
      }
    }

    state.isComplete = true;
    workerLogger.info(`Worker ${chunk.workerId} complete`, {
      blocks: state.blocksProcessed.toString(),
      events: state.eventsStored.toString(),
    });
  }

  /**
   * Process a block for a specific worker
   */
  private async processBlockForWorker(
    blockWithLogs: BlockWithLogs,
    state: WorkerState
  ): Promise<void> {
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
    state.eventsStored += records.length;

    this.logger.trace(
      `Worker ${state.workerId} processed block ${block.number}`,
      {
        worker: state.workerId,
        block: block.number,
        events: records.length,
      }
    );
  }

  /**
   * Emit progress for a specific worker
   */
  private emitWorkerProgress(state: WorkerState, chunk: WorkerChunk): void {
    if (!this.onProgress) return;

    const elapsed = (Date.now() - this.startTime) / 1000;

    // Aggregate progress from all workers
    let totalBlocksProcessed = 0;
    let totalEventsStored = 0;
    let minCurrentBlock = state.currentBlock;

    for (const workerState of this.workerStates.values()) {
      totalBlocksProcessed += workerState.blocksProcessed;
      totalEventsStored += workerState.eventsStored;
      if (workerState.currentBlock < minCurrentBlock) {
        minCurrentBlock = workerState.currentBlock;
      }
    }

    const blocksPerSecond = elapsed > 0 ? totalBlocksProcessed / elapsed : 0;

    this.onProgress({
      chainId: this.chainId,
      chainName: this.chainName,
      currentBlock: minCurrentBlock,
      targetBlock: chunk.toBlock,
      startBlock: chunk.fromBlock,
      phase: "historical",
      blocksPerSecond,
      eventsStored: totalEventsStored,
      workerId: state.workerId,
      totalWorkers: this.syncConfig.parallelWorkers,
    });
  }

  /**
   * Sync a range of blocks (single-threaded)
   */
  private async syncRange(
    fromBlock: bigint,
    toBlock: bigint,
    workerId: number = 0
  ): Promise<void> {
    const totalBlocks = toBlock - fromBlock + 1n;
    let currentBlock = fromBlock;

    this.logger.info(`Starting historical sync: ${totalBlocks} blocks`);

    // Build log filter for contracts
    const addresses = this.getContractAddresses();
    const filter =
      addresses.length > 0
        ? { address: addresses as `0x${string}`[], fromBlock, toBlock }
        : undefined;

    // Stream blocks with logs
    for await (const blockWithLogs of this.blockSource.getBlocks(
      { from: fromBlock, to: toBlock },
      filter
    )) {
      if (this.abortController?.signal.aborted) break;

      await this.processBlock(blockWithLogs);
      currentBlock = blockWithLogs.block.number;
      this.blocksProcessed++;

      // Update checkpoint periodically
      if (this.blocksProcessed % this.batchSize === 0) {
        await this.updateCheckpoint(currentBlock, blockWithLogs.block.hash);
        this.emitProgress(
          currentBlock,
          toBlock,
          fromBlock,
          "historical",
          workerId
        );
      }
    }

    // Final checkpoint update
    if (currentBlock > fromBlock) {
      const checkpoint = await this.checkpointRepo.get(this.chainId);
      if (!checkpoint || checkpoint.blockNumber < currentBlock) {
        await this.updateCheckpoint(currentBlock, "0x" as `0x${string}`);
      }
    }

    this.logger.info("Historical sync complete", {
      blocks: this.blocksProcessed.toString(),
      events: this.eventsStored.toString(),
    });
  }

  /**
   * Start live sync using block subscriptions
   */
  private async startLiveSync(): Promise<void> {
    if (!this.blockSource.onBlock) {
      this.logger.warn("Block source does not support subscriptions");
      return;
    }

    this.logger.info("Starting live sync with subscriptions");

    const unsubscribe = this.blockSource.onBlock(async (blockWithLogs) => {
      if (this.abortController?.signal.aborted) {
        unsubscribe();
        return;
      }

      await this.processBlock(blockWithLogs);
      this.blocksProcessed++;
      await this.updateCheckpoint(
        blockWithLogs.block.number,
        blockWithLogs.block.hash
      );
      this.emitProgress(
        blockWithLogs.block.number,
        blockWithLogs.block.number,
        blockWithLogs.block.number,
        "live"
      );
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

    this.logger.info("Starting live sync with polling", {
      interval: `${pollingInterval}ms`,
      finality: finalityBlocks.toString(),
    });

    while (!this.abortController?.signal.aborted) {
      try {
        const checkpoint = await this.checkpointRepo.get(this.chainId);
        const lastBlock = checkpoint?.blockNumber ?? 0n;

        // Get latest safe block
        let targetBlock: bigint;
        if (
          this.blockSource.getFinalizedBlockNumber &&
          this.chainConfig.source.type !== "hypersync"
        ) {
          targetBlock = await this.blockSource.getFinalizedBlockNumber();
        } else {
          const latest = await this.blockSource.getLatestBlockNumber();
          targetBlock = latest - BigInt(finalityBlocks);
        }

        if (targetBlock > lastBlock) {
          await this.syncRange(lastBlock + 1n, targetBlock);
          this.emitProgress(targetBlock, targetBlock, lastBlock, "live");
        }
      } catch (error) {
        this.logger.error("Polling error", { error: error as Error });
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
    const addresses = new Set(
      this.getContractAddresses().map((a) => a.toLowerCase())
    );

    if (addresses.size === 0) {
      // No address filter - return all logs
      return logs as Log[];
    }

    return logs.filter((log) =>
      addresses.has(log.address.toLowerCase())
    ) as Log[];
  }

  /**
   * Get contract addresses from config
   */
  private getContractAddresses(): string[] {
    const addresses: string[] = [];

    for (const contract of this.contracts) {
      if (typeof contract.address === "string") {
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
    return startBlocks.length > 0
      ? BigInt(Math.min(...startBlocks.map(Number)))
      : 0n;
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
    if (
      (source.type === "rpc" || source.type === "erpc") &&
      source.finality !== "finalized"
    ) {
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
  private async updateCheckpoint(
    blockNumber: bigint,
    blockHash: string
  ): Promise<void> {
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
    phase: "historical" | "catchup" | "live",
    workerId: number = 0
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
      workerId,
      totalWorkers: this.syncConfig.parallelWorkers,
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
