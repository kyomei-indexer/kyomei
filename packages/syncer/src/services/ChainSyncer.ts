import type {
  IBlockSource,
  IEventRepository,
  ISyncWorkerRepository,
  IFactoryRepository,
  ILogger,
  BlockWithLogs,
  Log,
  SyncWorker,
  RawEventRecord,
} from "@kyomei/core";
import type { ChainConfig, ContractConfig, SyncConfig } from "@kyomei/config";
import type { EventNotifier } from "@kyomei/events";
import { FactoryWatcher } from "./FactoryWatcher.ts";

/**
 * Default sync configuration values
 */
const DEFAULT_SYNC_CONFIG: Required<SyncConfig> = {
  parallelWorkers: 4,           // Increased from 1 to 4 for 4x faster historical sync
  blockRangePerRequest: 1000,   // Keep for RPC sources
  blocksPerWorker: 250000,      // Increased from 100k to 250k for larger chunks per worker
  eventBatchSize: 10000,        // Increased from 1k to 10k for 10x larger batches
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
  workerRepository: ISyncWorkerRepository;
  factoryRepository: IFactoryRepository;
  logger: ILogger;
  eventNotifier?: EventNotifier;
  batchSize?: number;
  onProgress?: (info: SyncProgress) => void;
}

/**
 * Sync progress information
 */
export interface SyncProgress {
  chainId: number;
  chainName: string;
  /** Total blocks synced across all workers */
  blocksSynced: number;
  /** Total blocks that need to be synced */
  totalBlocks: number;
  /** Percentage complete (0-100) */
  percentage: number;
  phase: "historical" | "catchup" | "live";
  /** Blocks per second */
  blocksPerSecond: number;
  /** Number of active workers */
  workers: number;
  /** Events stored */
  eventsStored: number;
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;
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
  private readonly workerRepo: ISyncWorkerRepository;
  private readonly logger: ILogger;
  private readonly eventNotifier?: EventNotifier;
  private readonly batchSize: number;
  private readonly onProgress?: (info: SyncProgress) => void;
  private readonly syncConfig: Required<SyncConfig>;
  private readonly factoryWatcher: FactoryWatcher;

  private isRunning = false;
  private abortController: AbortController | null = null;
  private startTime: number = 0;
  private blocksProcessed = 0;
  private eventsStored = 0;
  private blocksThisSession = 0;
  private workerStates: Map<number, WorkerState> = new Map();

  // Event buffering for cross-block batching (performance optimization)
  private eventBuffer: RawEventRecord[] = [];
  private readonly eventBufferSize = 10000;

  // Overall sync range for progress calculation
  private syncStartBlock: bigint = 0n;
  private syncTargetBlock: bigint = 0n;
  private lastProgressUpdate: number = 0;
  private readonly progressThrottleMs = 500;

  constructor(options: ChainSyncerOptions) {
    this.chainId = options.chainId;
    this.chainName = options.chainName;
    this.chainConfig = options.chainConfig;
    this.contracts = options.contracts;
    this.blockSource = options.blockSource;
    this.eventRepo = options.eventRepository;
    this.workerRepo = options.workerRepository;
    this.logger = options.logger.child({ chain: options.chainName });
    this.eventNotifier = options.eventNotifier;
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

    // Initialize factory watcher for discovering child contracts
    this.factoryWatcher = new FactoryWatcher({
      chainId: options.chainId,
      chainName: options.chainName,
      contracts: options.contracts,
      blockSource: options.blockSource,
      factoryRepository: options.factoryRepository,
      logger: options.logger,
    });

    this.logger.debug("Sync configuration", {
      parallelWorkers: this.syncConfig.parallelWorkers,
      blockRangePerRequest: this.syncConfig.blockRangePerRequest,
      blocksPerWorker: this.syncConfig.blocksPerWorker,
      hasFactories: this.factoryWatcher.hasFactories(),
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
    this.blocksThisSession = 0;
    this.workerStates.clear();

    this.logger.info("Starting chain syncer");

    try {
      // Get current workers state
      const workers = await this.workerRepo.getWorkers(this.chainId);
      const historicalWorkers = workers.filter(
        (w) => w.status === "historical"
      );
      const liveWorker = workers.find((w) => w.status === "live");

      // Check for configuration changes that require a reset
      const configChanged = await this.checkConfigurationChanged(
        historicalWorkers
      );

      if (configChanged) {
        this.logger.warn(
          "⚠️  Critical configuration changed - resetting sync state and starting fresh"
        );
        this.logger.warn(
          "This includes changes to: parallelWorkers, blocksPerWorker, contract startBlock, or contract addresses"
        );
        await this.resetSyncState();
        // Clear cached workers after reset
        historicalWorkers.length = 0;
      }

      if (historicalWorkers.length > 0) {
        // Resume historical sync from existing workers
        this.logger.info(
          `Resuming historical sync with ${historicalWorkers.length} workers`
        );
        await this.resumeHistoricalSync(historicalWorkers);
      } else if (liveWorker && !configChanged) {
        // Already in live sync mode, just continue
        this.logger.info(
          `Resuming live sync from block ${liveWorker.currentBlock}`
        );
      } else {
        // No workers - start fresh historical sync
        const startBlock = await this.getStartBlock();
        const targetBlock = await this.getTargetBlock();
        const totalBlocks = targetBlock - startBlock;

        if (startBlock < targetBlock) {
          this.logger.info(
            `Syncing from block ${startBlock} to ${targetBlock}`,
            {
              startBlock: startBlock.toString(),
              targetBlock: targetBlock.toString(),
              totalBlocks: totalBlocks.toString(),
            }
          );

          // Sync events and discover factories in parallel (single pass)
          const useParallel =
            this.syncConfig.parallelWorkers > 1 &&
            totalBlocks > BigInt(this.syncConfig.blocksPerWorker);

          if (useParallel) {
            this.logger.info(
              `Starting parallel sync with ${this.syncConfig.parallelWorkers} workers`
            );
            await this.startHistoricalSync(startBlock, targetBlock);
          } else {
            await this.syncRange(startBlock, targetBlock);
          }
        }
      }

      // Live sync - use subscriptions if available, otherwise poll
      if (this.hasRealtimeSupport()) {
        await this.startLiveSync();
      } else {
        // Poll-based live sync for RPC sources and HyperSync
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
   * Check if critical configuration has changed since last sync
   * Critical changes include: parallelWorkers, blocksPerWorker, contract startBlock, addresses
   */
  private async checkConfigurationChanged(
    historicalWorkers: SyncWorker[]
  ): Promise<boolean> {
    // If no historical workers, check live worker against contract startBlock
    if (historicalWorkers.length === 0) {
      const liveWorker = await this.workerRepo.getLiveWorker(this.chainId);
      if (!liveWorker) {
        return false; // Fresh start, no change detection needed
      }

      // Check if configured startBlock is after the live worker's block (user moved startBlock forward)
      const configuredStartBlock = this.getConfiguredStartBlock();
      if (configuredStartBlock > liveWorker.currentBlock) {
        this.logger.warn(
          `Contract startBlock (${configuredStartBlock}) is after checkpoint (${liveWorker.currentBlock})`
        );
        return true;
      }

      return false;
    }

    // Check if number of workers changed
    if (historicalWorkers.length !== this.syncConfig.parallelWorkers) {
      this.logger.warn(
        `Worker count changed: was ${historicalWorkers.length}, now ${this.syncConfig.parallelWorkers}`
      );
      return true;
    }

    // Check if start block changed
    const existingRangeStart = historicalWorkers.reduce(
      (min, w) => (w.rangeStart < min ? w.rangeStart : min),
      historicalWorkers[0].rangeStart
    );

    // Calculate what the ranges would be with current config
    const configuredStartBlock = this.getConfiguredStartBlock();

    // If the configured start block is different from what was stored
    if (configuredStartBlock !== existingRangeStart) {
      this.logger.warn(
        `Start block changed: was ${existingRangeStart}, now ${configuredStartBlock}`
      );
      return true;
    }

    return false;
  }

  /**
   * Get the configured start block from contracts
   */
  private getConfiguredStartBlock(): bigint {
    const startBlocks = this.contracts.map((c) => BigInt(c.startBlock));
    return startBlocks.length > 0
      ? BigInt(Math.min(...startBlocks.map(Number)))
      : 0n;
  }

  /**
   * Reset all sync state for this chain
   */
  private async resetSyncState(): Promise<void> {
    this.logger.info("Resetting sync state for chain", {
      chainId: this.chainId,
    });

    // Delete all workers (both historical and live)
    await this.workerRepo.deleteAllWorkers(this.chainId);

    this.logger.info(
      "Sync state reset complete - starting fresh from configured startBlock"
    );
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
   * Resume historical sync from saved workers
   */
  private async resumeHistoricalSync(workers: SyncWorker[]): Promise<void> {
    // Find the overall range from workers
    const minStart = workers.reduce(
      (min, w) => (w.rangeStart < min ? w.rangeStart : min),
      workers[0].rangeStart
    );
    const maxEnd = workers.reduce(
      (max, w) => (w.rangeEnd !== null && w.rangeEnd > max ? w.rangeEnd : max),
      workers[0].rangeEnd ?? 0n
    );

    this.syncStartBlock = minStart;
    this.syncTargetBlock = maxEnd;

    // Initialize worker states from saved workers
    // blocksProcessed = blocks already synced before this session
    for (const worker of workers) {
      // Calculate blocks already processed (currentBlock is the last processed block)
      // If currentBlock < rangeStart, nothing processed yet (currentBlock was set to rangeStart - 1)
      const blocksAlreadyProcessed =
        worker.currentBlock >= worker.rangeStart
          ? Number(worker.currentBlock - worker.rangeStart + 1n)
          : 0;

      this.workerStates.set(worker.workerId, {
        workerId: worker.workerId,
        currentBlock: worker.currentBlock,
        targetBlock: worker.rangeEnd ?? worker.currentBlock,
        blocksProcessed: blocksAlreadyProcessed,
        eventsStored: 0,
        isComplete: false,
      });
    }

    // Build chunks for workers - resume from next block after last processed
    const chunks: WorkerChunk[] = workers
      .map((w) => ({
        workerId: w.workerId,
        // Resume from next block after last processed
        fromBlock:
          w.currentBlock >= w.rangeStart ? w.currentBlock + 1n : w.rangeStart,
        toBlock: w.rangeEnd ?? w.currentBlock,
      }))
      .filter((c) => c.fromBlock <= c.toBlock); // Skip if already complete

    if (chunks.length === 0) {
      this.logger.info("All workers already completed their ranges");
      // Transition to live sync
      await this.transitionToLiveSync(maxEnd);
      return;
    }

    // Calculate and log resume status
    let totalBlocks = 0n;
    let alreadyProcessed = 0n;
    for (const worker of workers) {
      const workerBlocks =
        (worker.rangeEnd ?? worker.currentBlock) - worker.rangeStart + 1n;
      const workerProcessed =
        worker.currentBlock >= worker.rangeStart
          ? worker.currentBlock - worker.rangeStart + 1n
          : 0n;

      totalBlocks += workerBlocks;
      alreadyProcessed += workerProcessed;

      this.logger.debug(`Worker ${worker.workerId} status`, {
        rangeStart: worker.rangeStart.toString(),
        rangeEnd: worker.rangeEnd?.toString() ?? "null",
        currentBlock: worker.currentBlock.toString(),
        workerBlocks: workerBlocks.toString(),
        workerProcessed: workerProcessed.toString(),
      });
    }
    const resumePercent =
      totalBlocks > 0n ? Number((alreadyProcessed * 100n) / totalBlocks) : 0;

    this.logger.info(
      `Resuming historical sync at ${resumePercent.toFixed(
        1
      )}% (${alreadyProcessed}/${totalBlocks} blocks)`,
      {
        activeWorkers: chunks.length,
        totalWorkers: workers.length,
        syncStartBlock: this.syncStartBlock.toString(),
        syncTargetBlock: this.syncTargetBlock.toString(),
      }
    );

    // Start workers
    const workerPromises = chunks.map((chunk) =>
      this.runWorker(chunk).catch((error) => {
        const state = this.workerStates.get(chunk.workerId);
        if (state) {
          state.error = error as Error;
          state.isComplete = true;
        }
        this.logger.error(`Worker ${chunk.workerId} failed`, {
          error: error as Error,
        });
      })
    );

    await Promise.all(workerPromises);
    await this.finalizeHistoricalSync();
  }

  /**
   * Start historical sync with parallel workers
   */
  private async startHistoricalSync(
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<void> {
    // Store overall range for progress calculation
    this.syncStartBlock = fromBlock;
    this.syncTargetBlock = toBlock;

    const chunks = this.createWorkerChunks(
      fromBlock,
      toBlock,
      this.syncConfig.parallelWorkers
    );

    this.logger.info(`Starting historical sync with ${chunks.length} workers`, {
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      totalBlocks: (toBlock - fromBlock + 1n).toString(),
    });

    const now = new Date();

    // Initialize worker states and save initial workers
    for (const chunk of chunks) {
      this.workerStates.set(chunk.workerId, {
        workerId: chunk.workerId,
        currentBlock: chunk.fromBlock,
        targetBlock: chunk.toBlock,
        blocksProcessed: 0,
        eventsStored: 0,
        isComplete: false,
      });

      // Save initial worker for resume capability
      await this.workerRepo.setWorker({
        chainId: this.chainId,
        workerId: chunk.workerId,
        rangeStart: chunk.fromBlock,
        rangeEnd: chunk.toBlock,
        currentBlock: chunk.fromBlock - 1n, // Haven't processed any blocks yet
        status: "historical",
        createdAt: now,
        updatedAt: now,
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
    await this.finalizeHistoricalSync();
  }

  /**
   * Finalize historical sync - check errors and transition to live
   */
  private async finalizeHistoricalSync(): Promise<void> {
    // Check for any worker errors
    const errors = Array.from(this.workerStates.values()).filter(
      (s) => s.error
    );
    if (errors.length > 0) {
      throw new Error(
        `${errors.length} workers failed during historical sync: ${errors
          .map((e) => e.error?.message)
          .join(", ")}`
      );
    }

    // Check if sync was aborted - don't clean up workers if so
    const wasAborted = this.abortController?.signal.aborted ?? false;

    // Aggregate final stats
    let totalBlocksProcessed = 0;
    let totalEventsStored = 0;
    let allWorkersComplete = true;

    for (const state of this.workerStates.values()) {
      totalBlocksProcessed += state.blocksProcessed;
      totalEventsStored += state.eventsStored;
      if (!state.isComplete) {
        allWorkersComplete = false;
      }
    }

    this.blocksProcessed = totalBlocksProcessed;
    this.eventsStored = totalEventsStored;

    // Only transition to live if all workers completed successfully (not aborted)
    if (allWorkersComplete && !wasAborted) {
      await this.transitionToLiveSync(this.syncTargetBlock);

      this.logger.info("Historical sync complete", {
        workers: this.workerStates.size,
        blocks: totalBlocksProcessed,
        events: totalEventsStored,
      });
    } else {
      this.logger.info(
        "Historical sync stopped - workers preserved for resume",
        {
          workers: this.workerStates.size,
          blocks: totalBlocksProcessed,
          events: totalEventsStored,
          wasAborted,
          allWorkersComplete,
        }
      );
    }
  }

  /**
   * Transition from historical sync to live sync
   * Deletes all historical workers and creates a single live worker
   */
  private async transitionToLiveSync(lastBlock: bigint): Promise<void> {
    // Delete all historical workers
    await this.workerRepo.deleteAllWorkers(this.chainId);

    // Create live worker (worker_id = 0)
    const now = new Date();
    await this.workerRepo.setWorker({
      chainId: this.chainId,
      workerId: 0,
      rangeStart: lastBlock,
      rangeEnd: null, // null for live sync
      currentBlock: lastBlock,
      status: "live",
      createdAt: now,
      updatedAt: now,
    });

    this.logger.info("Transitioned to live sync", {
      lastHistoricalBlock: lastBlock.toString(),
    });
  }

  /**
   * Run a single worker for a chunk of blocks
   */
  private async runWorker(chunk: WorkerChunk): Promise<void> {
    const state = this.workerStates.get(chunk.workerId)!;

    // Get the worker from database (may be resuming)
    const existingWorker = await this.workerRepo.getWorker(
      this.chainId,
      chunk.workerId
    );

    if (!existingWorker) {
      this.logger.warn(
        `No existing worker found for ${chunk.workerId}, using chunk values`
      );
    }

    const rangeStart = existingWorker?.rangeStart ?? chunk.fromBlock;
    const rangeEnd = existingWorker?.rangeEnd ?? chunk.toBlock;

    this.logger.debug(`Worker ${chunk.workerId} starting`, {
      fromBlock: chunk.fromBlock.toString(),
      toBlock: chunk.toBlock.toString(),
      rangeStart: rangeStart.toString(),
      rangeEnd: rangeEnd?.toString() ?? "null",
      existingWorker: existingWorker
        ? {
            currentBlock: existingWorker.currentBlock.toString(),
            status: existingWorker.status,
          }
        : "none",
    });

    // Build log filter for contracts (includes factory children)
    const addresses = await this.getContractAddresses();
    const addressSet = new Set(addresses.map(a => a.toLowerCase()));
    const filter =
      addresses.length > 0
        ? {
            address: addresses as `0x${string}`[],
            fromBlock: chunk.fromBlock,
            toBlock: chunk.toBlock,
          }
        : undefined;

    // Track if worker was aborted
    let wasAborted = false;

    // Stream blocks with logs
    for await (const blockWithLogs of this.blockSource.getBlocks(
      { from: chunk.fromBlock, to: chunk.toBlock },
      filter
    )) {
      if (this.abortController?.signal.aborted) {
        wasAborted = true;
        // Save worker with current progress before stopping
        await this.saveWorkerProgress(
          chunk.workerId,
          rangeStart,
          rangeEnd,
          state.currentBlock
        );
        this.logger.debug(`Worker ${chunk.workerId} aborted`, {
          savedBlock: state.currentBlock.toString(),
          blocksProcessed: state.blocksProcessed,
        });
        break;
      }

      await this.processBlockForWorker(blockWithLogs, state, addressSet);
      state.currentBlock = blockWithLogs.block.number;
      state.blocksProcessed++;
      this.blocksThisSession++;

      // Save worker progress periodically (per worker, not global)
      if (state.blocksProcessed % this.batchSize === 0) {
        // Flush buffer before saving checkpoint
        await this.flushEventBuffer(state);

        await this.saveWorkerProgress(
          chunk.workerId,
          rangeStart,
          rangeEnd,
          state.currentBlock
        );
      }

      // Emit aggregated progress periodically (throttled)
      this.emitAggregatedProgress();
    }

    // Only mark as complete if we weren't aborted
    if (!wasAborted) {
      // Flush any remaining events in buffer
      await this.flushEventBuffer(state);

      state.isComplete = true;

      // Worker completed - delete it (completed workers are removed)
      await this.workerRepo.deleteWorker(this.chainId, chunk.workerId);

      this.logger.debug(`Worker ${chunk.workerId} complete`, {
        blocks: state.blocksProcessed,
        events: state.eventsStored,
      });
    }
  }

  /**
   * Save worker progress for resume capability
   */
  private async saveWorkerProgress(
    workerId: number,
    rangeStart: bigint,
    rangeEnd: bigint | null,
    currentBlock: bigint
  ): Promise<void> {
    this.logger.trace(`Saving progress for worker ${workerId}`, {
      rangeStart: rangeStart.toString(),
      rangeEnd: rangeEnd?.toString() ?? "null",
      currentBlock: currentBlock.toString(),
    });

    const now = new Date();
    await this.workerRepo.setWorker({
      chainId: this.chainId,
      workerId,
      rangeStart,
      rangeEnd,
      currentBlock,
      status: "historical",
      createdAt: now, // Will be ignored on update
      updatedAt: now,
    });
  }

  /**
   * Process a block for a specific worker
   */
  private async processBlockForWorker(
    blockWithLogs: BlockWithLogs,
    state: WorkerState,
    knownAddresses: Set<string>
  ): Promise<void> {
    const { block, logs } = blockWithLogs;

    if (logs.length === 0) return;

    // Discover any new factory children in this block
    if (this.factoryWatcher.hasFactories()) {
      for (const log of logs) {
        const discovered = await this.factoryWatcher.processLog(log);
        // If we discovered a new child, add it to known addresses for this block
        if (discovered) {
          const childAddresses = await this.factoryWatcher.getAllChildAddresses();
          for (const addresses of childAddresses.values()) {
            for (const addr of addresses) {
              knownAddresses.add(addr.toLowerCase());
            }
          }
        }
      }
    }

    // Filter logs for our contracts
    const relevantLogs = this.filterRelevantLogs(logs, knownAddresses);

    if (relevantLogs.length === 0) return;

    // Convert to records and add to buffer (cross-block batching)
    const records = relevantLogs.map((log) =>
      this.eventRepo.logToRecord(log as Log, this.chainId)
    );

    this.eventBuffer.push(...records);

    // Flush buffer if it reaches the threshold
    if (this.eventBuffer.length >= this.eventBufferSize) {
      await this.flushEventBuffer(state);
    }

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
   * Flush event buffer to database (cross-block batching optimization)
   */
  private async flushEventBuffer(state: WorkerState): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    await this.eventRepo.insertBatch(this.eventBuffer);
    state.eventsStored += this.eventBuffer.length;

    this.logger.trace(
      `Flushed event buffer: ${this.eventBuffer.length} events`,
      {
        worker: state.workerId,
        events: this.eventBuffer.length,
      }
    );

    this.eventBuffer = [];

    // Notify processor that new events are available
    if (this.eventNotifier) {
      await this.eventNotifier.notify('sync_events', {
        type: 'block_range_synced',
        chainId: this.chainId,
        blockNumber: state.currentBlock,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Emit aggregated progress from all workers (throttled)
   */
  private emitAggregatedProgress(): void {
    if (!this.onProgress) return;

    // Throttle progress updates
    const now = Date.now();
    if (now - this.lastProgressUpdate < this.progressThrottleMs) return;
    this.lastProgressUpdate = now;

    const elapsed = (now - this.startTime) / 1000;

    // Aggregate progress from all workers
    let totalBlocksProcessed = 0;
    let totalEventsStored = 0;
    let activeWorkers = 0;

    for (const workerState of this.workerStates.values()) {
      totalBlocksProcessed += workerState.blocksProcessed;
      totalEventsStored += workerState.eventsStored;
      if (!workerState.isComplete) {
        activeWorkers++;
      }
    }

    // Calculate total blocks to sync
    const totalBlocks = Number(this.syncTargetBlock - this.syncStartBlock + 1n);

    // Calculate percentage
    const percentage =
      totalBlocks > 0
        ? Math.min(100, (totalBlocksProcessed / totalBlocks) * 100)
        : 0;

    // Calculate speed based on blocks processed in this session
    const blocksPerSecond = elapsed > 0 ? this.blocksThisSession / elapsed : 0;

    // Calculate ETA based on remaining blocks and current speed
    const blocksRemaining = totalBlocks - totalBlocksProcessed;
    const estimatedTimeRemaining =
      blocksPerSecond > 0 ? blocksRemaining / blocksPerSecond : undefined;

    this.onProgress({
      chainId: this.chainId,
      chainName: this.chainName,
      blocksSynced: totalBlocksProcessed,
      totalBlocks,
      percentage,
      phase: "historical",
      blocksPerSecond,
      workers: activeWorkers,
      eventsStored: totalEventsStored,
      estimatedTimeRemaining,
    });
  }

  /**
   * Sync a range of blocks (single-threaded)
   */
  private async syncRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
    // Set sync range for progress calculation
    this.syncStartBlock = fromBlock;
    this.syncTargetBlock = toBlock;

    const totalBlocks = toBlock - fromBlock + 1n;
    let currentBlock = fromBlock;

    this.logger.info(`Starting historical sync: ${totalBlocks} blocks`);

    // Create single historical worker (worker_id = 1)
    const now = new Date();
    await this.workerRepo.setWorker({
      chainId: this.chainId,
      workerId: 1,
      rangeStart: fromBlock,
      rangeEnd: toBlock,
      currentBlock: fromBlock - 1n, // Haven't processed any blocks yet
      status: "historical",
      createdAt: now,
      updatedAt: now,
    });

    // Build log filter for contracts (includes factory children)
    const addresses = await this.getContractAddresses();
    const addressSet = new Set(addresses.map(a => a.toLowerCase()));
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

      await this.processBlock(blockWithLogs, addressSet);
      currentBlock = blockWithLogs.block.number;
      this.blocksProcessed++;
      this.blocksThisSession++;

      // Update worker progress periodically
      if (this.blocksThisSession % this.batchSize === 0) {
        await this.saveWorkerProgress(1, fromBlock, toBlock, currentBlock);
        this.emitProgress(currentBlock, toBlock, fromBlock, "historical");
      }
    }

    // Final update - delete historical worker and transition to live sync
    if (currentBlock > fromBlock) {
      await this.workerRepo.deleteWorker(this.chainId, 1);
      await this.transitionToLiveSync(currentBlock);
    }

    this.logger.info("Historical sync complete", {
      blocks: this.blocksProcessed,
      events: this.eventsStored,
    });
  }

  /**
   * Start live sync using block subscriptions
   */
  private async startLiveSync(): Promise<void> {
    if (!this.blockSource.onBlock) {
      // Fallback to polling if subscriptions not available
      this.logger.debug(
        "Block source does not support subscriptions, falling back to polling"
      );
      await this.startPollingSync();
      return;
    }

    this.logger.info("Starting live sync with subscriptions");

    const unsubscribe = this.blockSource.onBlock(async (blockWithLogs) => {
      if (this.abortController?.signal.aborted) {
        unsubscribe();
        return;
      }

      // Get addresses dynamically in live mode (may have new children)
      const addresses = await this.getContractAddresses();
      const addressSet = new Set(addresses.map(a => a.toLowerCase()));

      // Discover any new children in this block
      if (this.factoryWatcher.hasFactories()) {
        for (const log of blockWithLogs.logs) {
          await this.factoryWatcher.processLog(log);
        }
      }

      await this.processBlock(blockWithLogs, addressSet);
      this.blocksProcessed++;
      await this.updateLiveWorker(blockWithLogs.block.number);
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
        const liveWorker = await this.workerRepo.getLiveWorker(this.chainId);
        const lastBlock = liveWorker?.currentBlock ?? 0n;

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
          await this.syncLiveRange(lastBlock + 1n, targetBlock);
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
   * Sync a range of blocks in live mode (updates live worker)
   */
  private async syncLiveRange(
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<void> {
    const addresses = await this.getContractAddresses();
    const addressSet = new Set(addresses.map(a => a.toLowerCase()));
    const filter =
      addresses.length > 0
        ? { address: addresses as `0x${string}`[], fromBlock, toBlock }
        : undefined;

    let currentBlock = fromBlock;
    for await (const blockWithLogs of this.blockSource.getBlocks(
      { from: fromBlock, to: toBlock },
      filter
    )) {
      if (this.abortController?.signal.aborted) break;

      // Discover any new children in this block
      if (this.factoryWatcher.hasFactories()) {
        for (const log of blockWithLogs.logs) {
          await this.factoryWatcher.processLog(log);
        }
      }

      await this.processBlock(blockWithLogs, addressSet);
      currentBlock = blockWithLogs.block.number;
      this.blocksProcessed++;

      // Update live worker periodically
      if (this.blocksProcessed % this.batchSize === 0) {
        await this.updateLiveWorker(currentBlock);
      }
    }

    // Final update
    if (currentBlock >= fromBlock) {
      await this.updateLiveWorker(currentBlock);
    }
  }

  /**
   * Update the live worker's current block
   */
  private async updateLiveWorker(currentBlock: bigint): Promise<void> {
    const liveWorker = await this.workerRepo.getLiveWorker(this.chainId);

    if (liveWorker) {
      await this.workerRepo.setWorker({
        ...liveWorker,
        currentBlock,
        updatedAt: new Date(),
      });
    } else {
      // Create live worker if it doesn't exist
      const now = new Date();
      await this.workerRepo.setWorker({
        chainId: this.chainId,
        workerId: 0,
        rangeStart: currentBlock,
        rangeEnd: null,
        currentBlock,
        status: "live",
        createdAt: now,
        updatedAt: now,
      });
    }

    // Notify processor that live block has been synced
    if (this.eventNotifier) {
      await this.eventNotifier.notify('sync_events', {
        type: 'live_block_synced',
        chainId: this.chainId,
        blockNumber: currentBlock,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Process a single block with logs
   */
  private async processBlock(
    blockWithLogs: BlockWithLogs,
    knownAddresses: Set<string>
  ): Promise<void> {
    const { block, logs } = blockWithLogs;

    if (logs.length === 0) return;

    // Discover any new factory children in this block
    if (this.factoryWatcher.hasFactories()) {
      for (const log of logs) {
        const discovered = await this.factoryWatcher.processLog(log);
        // If we discovered a new child, add it to known addresses for this block
        if (discovered) {
          const childAddresses = await this.factoryWatcher.getAllChildAddresses();
          for (const addresses of childAddresses.values()) {
            for (const addr of addresses) {
              knownAddresses.add(addr.toLowerCase());
            }
          }
        }
      }
    }

    // Filter logs for our contracts
    const relevantLogs = this.filterRelevantLogs(logs, knownAddresses);

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
   * Note: Uses cached static addresses only (child addresses handled in filter)
   */
  private filterRelevantLogs(logs: readonly Log[], knownAddresses: Set<string>): Log[] {
    if (knownAddresses.size === 0) {
      // No address filter - return all logs
      return logs as Log[];
    }

    return logs.filter((log) =>
      knownAddresses.has(log.address.toLowerCase())
    ) as Log[];
  }

  /**
   * Get contract addresses from config (static addresses only)
   */
  private getStaticContractAddresses(): string[] {
    const addresses: string[] = [];

    for (const contract of this.contracts) {
      if (typeof contract.address === "string") {
        addresses.push(contract.address);
      } else if (Array.isArray(contract.address)) {
        addresses.push(...contract.address);
      }
      // Factory child addresses are fetched dynamically
    }

    return addresses;
  }

  /**
   * Get all contract addresses including factory children
   */
  private async getContractAddresses(): Promise<string[]> {
    const staticAddresses = this.getStaticContractAddresses();
    
    // Add factory addresses (the factory contracts themselves)
    const factoryAddresses = this.factoryWatcher.getFactoryAddresses();
    
    // Get all known child addresses from factories
    const childAddressesMap = await this.factoryWatcher.getAllChildAddresses();
    const childAddresses: string[] = [];
    for (const addresses of childAddressesMap.values()) {
      childAddresses.push(...addresses);
    }
    
    // Combine all addresses
    const allAddresses = [
      ...staticAddresses,
      ...factoryAddresses,
      ...childAddresses,
    ];
    
    // Remove duplicates
    return [...new Set(allAddresses.map(a => a.toLowerCase()))];
  }

  /**
   * Get the block to start syncing from
   */
  private async getStartBlock(): Promise<bigint> {
    // Check for existing live worker (already completed historical sync)
    const liveWorker = await this.workerRepo.getLiveWorker(this.chainId);
    if (liveWorker) {
      return liveWorker.currentBlock + 1n;
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
   * Emit progress update (throttled)
   */
  private emitProgress(
    currentBlock: bigint,
    targetBlock: bigint,
    startBlock: bigint,
    phase: "historical" | "catchup" | "live"
  ): void {
    if (!this.onProgress) return;

    // Throttle progress updates
    const now = Date.now();
    if (now - this.lastProgressUpdate < this.progressThrottleMs) return;
    this.lastProgressUpdate = now;

    const elapsed = (now - this.startTime) / 1000;
    const blocksPerSecond = elapsed > 0 ? this.blocksThisSession / elapsed : 0;

    // Calculate totals
    const totalBlocks = Number(targetBlock - startBlock + 1n);
    const blocksSynced = Number(currentBlock - startBlock + 1n);
    const percentage =
      totalBlocks > 0 ? Math.min(100, (blocksSynced / totalBlocks) * 100) : 0;

    // Calculate ETA
    const blocksRemaining = totalBlocks - blocksSynced;
    const estimatedTimeRemaining =
      blocksPerSecond > 0 ? blocksRemaining / blocksPerSecond : undefined;

    this.onProgress({
      chainId: this.chainId,
      chainName: this.chainName,
      blocksSynced,
      totalBlocks,
      percentage,
      phase,
      blocksPerSecond,
      workers: 1, // Single-threaded
      eventsStored: this.eventsStored,
      estimatedTimeRemaining,
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
