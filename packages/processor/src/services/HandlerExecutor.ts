import type {
  ILogger,
  IProcessCheckpointRepository,
  IProcessWorkerRepository,
  ISyncWorkerRepository,
  ICachedRpcClient,
  IEventRepository,
  RawEventRecord,
  ProcessWorker,
} from "@kyomei/core";
import { EventDecoder } from "@kyomei/core";
import type { ContractConfig } from "@kyomei/config";
import type { Database } from "@kyomei/database";
import { sql } from "drizzle-orm";

// Import handler types from Kyomei.ts
import type {
  HandlerRegistration,
  EventHandler,
  EventData,
  HandlerContext as Context,
  DbContext,
  RpcContext,
} from "../Kyomei.ts";
export type { HandlerRegistration };

/**
 * Process progress information
 */
export interface ProcessProgress {
  chainId: number;
  chainName: string;
  /** Total events processed */
  eventsProcessed: number;
  /** Current block being processed */
  currentBlock: bigint;
  /** Target block to process up to */
  targetBlock: bigint;
  /** Blocks processed */
  blocksProcessed: number;
  /** Total blocks to process */
  totalBlocks: number;
  /** Percentage complete (0-100) */
  percentage: number;
  /** Events per second */
  eventsPerSecond: number;
  /** Processing status */
  status: "processing" | "live";
}

/**
 * Handler executor options
 */
export interface HandlerExecutorOptions {
  chainId: number;
  chainName: string;
  contracts: Array<ContractConfig & { name: string }>;
  db: Database;
  appSchema: string;
  eventRepository: IEventRepository;
  checkpointRepository: IProcessCheckpointRepository;
  workerRepository: IProcessWorkerRepository;
  syncWorkerRepository: ISyncWorkerRepository;
  /** RPC client for contract reads (optional - handlers using context.rpc will fail if not provided) */
  rpcClient?: ICachedRpcClient;
  logger: ILogger;
  batchSize?: number;
  onProgress?: (info: ProcessProgress) => void;
}

/**
 * Handler executor service
 * Executes user-defined handlers for events with continuous processing loop
 */
export class HandlerExecutor {
  private readonly chainId: number;
  private readonly chainName: string;
  private readonly contracts: Array<ContractConfig & { name: string }>;
  private readonly db: Database;
  private readonly appSchema: string;
  private readonly eventRepo: IEventRepository;
  private readonly checkpointRepo: IProcessCheckpointRepository;
  private readonly workerRepo: IProcessWorkerRepository;
  private readonly syncWorkerRepo: ISyncWorkerRepository;
  private readonly rpcClient?: ICachedRpcClient;
  private readonly logger: ILogger;
  private readonly batchSize: number;
  private readonly eventDecoder = new EventDecoder();
  private readonly handlers: Map<
    string,
    { handler: EventHandler; mode: "sequential" | "parallel" }
  > = new Map();
  private readonly onProgress?: (info: ProcessProgress) => void;

  // Parallel processing configuration
  // With 100 concurrent RPC calls and ~4 calls per event, aim for ~50 concurrent handlers
  // to maximize throughput while leaving some headroom
  private readonly parallelConcurrency = 50;

  private isRunning = false;
  private abortController: AbortController | null = null;
  private startTime: number = 0;
  private eventsProcessed = 0;
  private eventsThisSession = 0;
  private lastProgressUpdate: number = 0;
  private readonly progressThrottleMs = 500;

  // Topic0 to contract name lookup for fast event matching
  private readonly topic0ToContract: Map<string, string> = new Map();

  constructor(options: HandlerExecutorOptions) {
    this.chainId = options.chainId;
    this.chainName = options.chainName;
    this.contracts = options.contracts;
    this.db = options.db;
    this.appSchema = options.appSchema;
    this.eventRepo = options.eventRepository;
    this.checkpointRepo = options.checkpointRepository;
    this.workerRepo = options.workerRepository;
    this.syncWorkerRepo = options.syncWorkerRepository;
    this.rpcClient = options.rpcClient;
    this.logger = options.logger.child({
      module: "HandlerExecutor",
      chain: options.chainName,
    });
    // Batch size in number of events (not blocks!)
    // Moderate size for good throughput while saving progress regularly
    this.batchSize = options.batchSize ?? 1000;
    this.onProgress = options.onProgress;

    // Register contract ABIs and build topic0 lookup
    for (const contract of this.contracts) {
      this.eventDecoder.registerContract(contract.name, contract.abi);

      // Build topic0 -> contract lookup for fast matching
      for (const item of contract.abi) {
        if (item.type === "event" && item.name) {
          const signature = this.eventDecoder.getEventSignatureByName(
            contract.name,
            item.name
          );
          if (signature) {
            this.topic0ToContract.set(signature, contract.name);
          }
        }
      }
    }
  }

  /**
   * Register a handler for an event
   */
  registerHandler(
    contractName: string,
    eventName: string,
    handler: EventHandler,
    mode: "sequential" | "parallel" = "sequential"
  ): void {
    const key = `${contractName}:${eventName}`;
    this.handlers.set(key, { handler, mode });
    this.logger.debug(`Registered handler: ${key} (${mode})`);
  }

  /**
   * Register multiple handlers
   */
  registerHandlers(registrations: HandlerRegistration[]): void {
    for (const reg of registrations) {
      this.registerHandler(
        reg.contractName,
        reg.eventName,
        reg.handler,
        reg.mode
      );
    }
  }

  /**
   * Start continuous processing
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Processor already running");
      return;
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.startTime = Date.now();
    this.eventsProcessed = 0;
    this.eventsThisSession = 0;

    this.logger.info("Starting handler executor");

    try {
      // Wait for sync to have data before processing
      await this.waitForSyncData();

      // Main processing loop
      await this.processLoop();
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        this.logger.error("Processor error", { error: error as Error });
        throw error;
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Stop processing
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info("Stopping handler executor");
    this.abortController?.abort();
    this.isRunning = false;
  }

  /**
   * Get current status
   */
  getStatus(): {
    isRunning: boolean;
    eventsProcessed: number;
  } {
    return {
      isRunning: this.isRunning,
      eventsProcessed: this.eventsProcessed,
    };
  }

  /**
   * Wait until sync has some data to process
   */
  private async waitForSyncData(): Promise<void> {
    const pollInterval = 1000;

    while (!this.abortController?.signal.aborted) {
      const syncWorker = await this.syncWorkerRepo.getLiveWorker(this.chainId);
      const historicalWorkers = await this.syncWorkerRepo.getHistoricalWorkers(
        this.chainId
      );

      // If there's a live worker or historical workers with progress, we can start
      if (syncWorker || historicalWorkers.length > 0) {
        this.logger.info("Sync data available, starting processing");
        return;
      }

      this.logger.debug("Waiting for sync data...");
      await this.sleep(pollInterval);
    }
  }

  /**
   * Main processing loop
   */
  private async processLoop(): Promise<void> {
    const pollInterval = 1000;

    while (!this.abortController?.signal.aborted) {
      try {
        // Get sync status to determine target block
        const syncWorker = await this.syncWorkerRepo.getLiveWorker(
          this.chainId
        );
        const historicalWorkers =
          await this.syncWorkerRepo.getHistoricalWorkers(this.chainId);

        // Determine the target block (minimum synced block across all workers)
        let targetBlock = 0n;
        if (syncWorker) {
          targetBlock = syncWorker.currentBlock;
        } else if (historicalWorkers.length > 0) {
          // Use minimum current block from all historical workers
          targetBlock = historicalWorkers.reduce(
            (min, w) => (w.currentBlock < min ? w.currentBlock : min),
            historicalWorkers[0].currentBlock
          );
        }

        if (targetBlock === 0n) {
          await this.sleep(pollInterval);
          continue;
        }

        // Get or create process worker
        let processWorker = await this.workerRepo.getWorker(this.chainId);
        if (!processWorker) {
          // Get start block from contracts config
          const startBlock = this.getConfiguredStartBlock();
          const now = new Date();
          processWorker = {
            chainId: this.chainId,
            rangeStart: startBlock,
            rangeEnd: targetBlock,
            currentBlock: startBlock - 1n,
            eventsProcessed: 0n,
            status: "processing",
            createdAt: now,
            updatedAt: now,
          };
          await this.workerRepo.setWorker(processWorker);
        }

        // Update target block
        const isLive = syncWorker !== null && historicalWorkers.length === 0;
        const currentBlock = processWorker.currentBlock;

        if (currentBlock >= targetBlock) {
          // Caught up - transition to live if sync is live
          if (isLive && processWorker.status !== "live") {
            await this.transitionToLive(processWorker, targetBlock);
          }
          // In live mode, just poll for new blocks
          await this.sleep(pollInterval);
          continue;
        }

        // Process batches up to target
        await this.processBatches(
          processWorker,
          currentBlock + 1n,
          targetBlock,
          isLive
        );
      } catch (error) {
        if (this.abortController?.signal.aborted) break;
        this.logger.error("Processing error", { error: error as Error });
        await this.sleep(pollInterval);
      }
    }
  }

  /**
   * Process events in batches (event-based, not block-based)
   */
  private async processBatches(
    worker: ProcessWorker,
    fromBlock: bigint,
    toBlock: bigint,
    syncIsLive: boolean
  ): Promise<void> {
    let lastProcessedBlock = fromBlock - 1n;

    // Get event signatures we have handlers for (filter upfront)
    const handlerSignatures = this.getHandlerSignatures();

    // Check if all handlers are parallel (allows full batch parallelization)
    const allParallel = this.areAllHandlersParallel();

    while (!this.abortController?.signal.aborted) {
      // Query batch of events (by event count, not block count)
      const events = await this.eventRepo.query({
        chainId: this.chainId,
        blockRange: { from: lastProcessedBlock + 1n, to: toBlock },
        eventSignatures:
          handlerSignatures.length > 0 ? handlerSignatures : undefined,
        order: "asc",
        limit: this.batchSize,
      });

      if (events.length === 0) {
        // No more events - we've caught up to toBlock
        lastProcessedBlock = toBlock;
        break;
      }

      // Process events based on handler mode
      let processedCount = 0;

      if (allParallel) {
        // All handlers are parallel - process entire batch concurrently
        const result = await this.processEventsParallel(events);
        processedCount = result.count;
        // Use the last event's block since parallel processing may complete out of order
        lastProcessedBlock = events[events.length - 1].blockNumber;
      } else {
        // Mixed or sequential handlers - process in order
        for (const event of events) {
          if (this.abortController?.signal.aborted) break;

          const count = await this.processEventWithMode(event);
          processedCount += count;
          lastProcessedBlock = event.blockNumber;
        }
      }

      this.eventsProcessed += processedCount;
      this.eventsThisSession += processedCount;

      // Update worker progress after each batch
      await this.updateWorkerProgress(worker, lastProcessedBlock, syncIsLive);

      // Emit progress
      this.emitProgress(worker, lastProcessedBlock, toBlock, syncIsLive);

      // If we got fewer events than batch size, we've reached the end
      if (events.length < this.batchSize) {
        lastProcessedBlock = toBlock;
        break;
      }
    }

    // Final progress update
    if (lastProcessedBlock >= toBlock) {
      await this.updateWorkerProgress(worker, toBlock, syncIsLive);
      this.emitProgress(worker, toBlock, toBlock, syncIsLive);
    }
  }

  /**
   * Check if all registered handlers are parallel mode
   */
  private areAllHandlersParallel(): boolean {
    for (const { mode } of this.handlers.values()) {
      if (mode === "sequential") return false;
    }
    return this.handlers.size > 0;
  }

  /**
   * Process events in parallel with streaming concurrency pool
   * Keeps N tasks running at all times instead of waiting for batches
   * Returns: { count, lastBlock } for progress tracking
   */
  private async processEventsParallel(
    events: RawEventRecord[]
  ): Promise<{ count: number; lastBlock: bigint }> {
    let processedCount = 0;
    let lastBlock = 0n;
    let nextIndex = 0;
    const inFlight = new Set<Promise<void>>();

    const processNext = async (): Promise<void> => {
      if (this.abortController?.signal.aborted) return;
      if (nextIndex >= events.length) return;

      const event = events[nextIndex++];
      const count = await this.processEvent(event);
      processedCount += count;
      // Track the highest block processed
      if (event.blockNumber > lastBlock) {
        lastBlock = event.blockNumber;
      }
    };

    // Start initial batch of concurrent tasks
    while (
      nextIndex < events.length &&
      inFlight.size < this.parallelConcurrency
    ) {
      const promise = processNext().then(() => {
        inFlight.delete(promise);
      });
      inFlight.add(promise);
    }

    // Process remaining events as slots become available
    while (inFlight.size > 0) {
      if (this.abortController?.signal.aborted) break;

      // Wait for any task to complete
      await Promise.race(inFlight);

      // Start new tasks to fill available slots
      while (
        nextIndex < events.length &&
        inFlight.size < this.parallelConcurrency
      ) {
        const promise = processNext().then(() => {
          inFlight.delete(promise);
        });
        inFlight.add(promise);
      }
    }

    return { count: processedCount, lastBlock };
  }

  /**
   * Process a single event respecting its handler's mode
   */
  private async processEventWithMode(event: RawEventRecord): Promise<number> {
    const decoded = this.decodeEvent(event);
    if (!decoded) return 0;

    const handlerKey = `${decoded.contractName}:${decoded.eventName}`;
    const handlerConfig = this.handlers.get(handlerKey);

    if (!handlerConfig) return 0;

    // For now, all individual events are processed the same way
    // The parallel optimization happens at the batch level
    return this.processEvent(event);
  }

  /**
   * Get event signatures for all registered handlers
   */
  private getHandlerSignatures(): `0x${string}`[] {
    const signatures: `0x${string}`[] = [];
    for (const key of this.handlers.keys()) {
      const [contractName, eventName] = key.split(":");
      const sig = this.eventDecoder.getEventSignatureByName(
        contractName,
        eventName
      );
      if (sig) signatures.push(sig);
    }
    return signatures;
  }

  /**
   * Update worker progress in database
   */
  private async updateWorkerProgress(
    worker: ProcessWorker,
    currentBlock: bigint,
    syncIsLive: boolean
  ): Promise<void> {
    await this.workerRepo.setWorker({
      ...worker,
      currentBlock,
      eventsProcessed: BigInt(this.eventsProcessed),
      status:
        syncIsLive && currentBlock >= (worker.rangeEnd ?? 0n)
          ? "live"
          : "processing",
      updatedAt: new Date(),
    });
  }

  /**
   * Transition to live processing
   */
  private async transitionToLive(
    worker: ProcessWorker,
    currentBlock: bigint
  ): Promise<void> {
    await this.workerRepo.setWorker({
      ...worker,
      rangeEnd: null,
      currentBlock,
      status: "live",
      updatedAt: new Date(),
    });

    this.logger.info("Transitioned to live processing", {
      currentBlock: currentBlock.toString(),
      eventsProcessed: this.eventsProcessed,
    });
  }

  /**
   * Emit progress update (throttled)
   */
  private emitProgress(
    worker: ProcessWorker,
    currentBlock: bigint,
    targetBlock: bigint,
    syncIsLive: boolean
  ): void {
    if (!this.onProgress) return;

    // Throttle progress updates
    const now = Date.now();
    if (now - this.lastProgressUpdate < this.progressThrottleMs) return;
    this.lastProgressUpdate = now;

    const rangeStart = worker.rangeStart;
    const totalBlocks = Number(targetBlock - rangeStart + 1n);
    const blocksProcessed = Number(currentBlock - rangeStart + 1n);
    const percentage =
      totalBlocks > 0
        ? Math.min(100, (blocksProcessed / totalBlocks) * 100)
        : 0;

    // Calculate speed
    const elapsed = (now - this.startTime) / 1000;
    const eventsPerSecond = elapsed > 0 ? this.eventsThisSession / elapsed : 0;

    const isLive = syncIsLive && currentBlock >= targetBlock;

    this.onProgress({
      chainId: this.chainId,
      chainName: this.chainName,
      eventsProcessed: this.eventsProcessed,
      currentBlock,
      targetBlock,
      blocksProcessed,
      totalBlocks,
      percentage,
      eventsPerSecond,
      status: isLive ? "live" : "processing",
    });
  }

  /**
   * Get configured start block from contracts
   */
  private getConfiguredStartBlock(): bigint {
    const startBlocks = this.contracts.map((c) => BigInt(c.startBlock));
    return startBlocks.length > 0
      ? BigInt(Math.min(...startBlocks.map(Number)))
      : 0n;
  }

  /**
   * Process events from checkpoint to target block (legacy method for backwards compatibility)
   */
  async process(targetBlock: bigint): Promise<number> {
    const checkpoint = await this.checkpointRepo.get(this.chainId);
    const startBlock = checkpoint?.blockNumber ?? 0n;

    if (startBlock >= targetBlock) {
      return 0;
    }

    this.logger.info(
      `Processing events from block ${startBlock} to ${targetBlock}`
    );

    let processed = 0;
    let currentBlock = startBlock;

    while (currentBlock < targetBlock) {
      const batchEnd = currentBlock + BigInt(this.batchSize);
      const endBlock = batchEnd > targetBlock ? targetBlock : batchEnd;

      const events = await this.eventRepo.query({
        chainId: this.chainId,
        blockRange: { from: currentBlock + 1n, to: endBlock },
        order: "asc",
      });

      for (const event of events) {
        const count = await this.processEvent(event);
        processed += count;
      }

      // Update checkpoint
      await this.checkpointRepo.set({
        chainId: this.chainId,
        blockNumber: endBlock,
        updatedAt: new Date(),
      });

      currentBlock = endBlock;
    }

    this.logger.info(`Processed ${processed} events`);
    return processed;
  }

  /**
   * Process a single event
   */
  private async processEvent(event: RawEventRecord): Promise<number> {
    // Find matching handler
    const decoded = this.decodeEvent(event);
    if (!decoded) return 0;

    const handlerKey = `${decoded.contractName}:${decoded.eventName}`;
    const handlerConfig = this.handlers.get(handlerKey);

    if (!handlerConfig) return 0;

    // Set block context for RPC caching
    if (this.rpcClient) {
      this.rpcClient.setBlockContext(event.blockNumber);
    }

    // Build handler params
    const params = this.buildHandlerParams(event, decoded);

    try {
      await handlerConfig.handler(params);
      this.logger.trace(`Handled ${handlerKey}`, {
        block: event.blockNumber,
        txHash: event.txHash,
      });
      return 1;
    } catch (error) {
      this.logger.error(`Handler error: ${handlerKey}`, {
        error: error as Error,
        block: event.blockNumber,
      });
      throw error;
    }
  }

  /**
   * Decode an event using registered ABIs
   * Optimized: uses topic0 lookup to find the right contract directly
   */
  private decodeEvent(event: RawEventRecord): {
    contractName: string;
    eventName: string;
    args: Record<string, unknown>;
  } | null {
    // Fast path: use topic0 lookup
    if (event.topic0) {
      const contractName = this.topic0ToContract.get(event.topic0);
      if (contractName) {
        const log = this.buildLog(event);
        const decoded = this.eventDecoder.decodeWithContract(log, contractName);
        if (decoded) {
          return {
            contractName,
            eventName: decoded.eventName,
            args: decoded.args,
          };
        }
      }
    }

    // Slow fallback: try each contract (for events without topic0 match)
    const log = this.buildLog(event);
    for (const contract of this.contracts) {
      const decoded = this.eventDecoder.decodeWithContract(log, contract.name);
      if (decoded) {
        return {
          contractName: contract.name,
          eventName: decoded.eventName,
          args: decoded.args,
        };
      }
    }

    return null;
  }

  /**
   * Build log object from event record
   */
  private buildLog(event: RawEventRecord) {
    return {
      blockNumber: event.blockNumber,
      blockHash: event.blockHash as `0x${string}`,
      blockTimestamp: event.blockTimestamp,
      transactionHash: event.txHash as `0x${string}`,
      transactionIndex: event.txIndex,
      logIndex: event.logIndex,
      address: event.address as `0x${string}`,
      topic0: event.topic0 as `0x${string}` | null,
      topic1: event.topic1 as `0x${string}` | null,
      topic2: event.topic2 as `0x${string}` | null,
      topic3: event.topic3 as `0x${string}` | null,
      data: event.data as `0x${string}`,
      removed: false,
    };
  }

  /**
   * Build handler params for the new Kyomei.on() API
   */
  private buildHandlerParams(
    event: RawEventRecord,
    decoded: {
      contractName: string;
      eventName: string;
      args: Record<string, unknown>;
    }
  ): { event: EventData; context: Context } {
    return {
      event: {
        args: decoded.args,
        block: {
          number: event.blockNumber,
          hash: event.blockHash as `0x${string}`,
          timestamp: event.blockTimestamp,
        },
        transaction: {
          hash: event.txHash as `0x${string}`,
          from: "0x0000000000000000000000000000000000000000" as `0x${string}`, // Would need to fetch
          to: null,
          index: event.txIndex,
        },
        log: {
          index: event.logIndex,
          address: event.address as `0x${string}`,
        },
      },
      context: {
        db: this.buildDbContext(),
        rpc: this.buildRpcContext(),
      },
    };
  }

  /**
   * Build database context for handlers
   */
  private buildDbContext(): DbContext {
    return {
      insert: (table: string) => ({
        values: async (data: object | object[]) => {
          const records = Array.isArray(data) ? data : [data];
          const columns = Object.keys(records[0]);
          const values = records
            .map(
              (r) =>
                `(${columns
                  .map((c) => this.escapeValue((r as any)[c]))
                  .join(", ")})`
            )
            .join(", ");

          await this.db.execute(
            sql.raw(`
            INSERT INTO ${this.appSchema}.${table} (${columns.join(", ")})
            VALUES ${values}
            ON CONFLICT DO NOTHING
          `)
          );
        },
      }),
      update: (table: string) => ({
        set: (data: object) => ({
          where: async (condition: object) => {
            const setClause = Object.entries(data)
              .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
              .join(", ");
            const whereClause = Object.entries(condition)
              .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
              .join(" AND ");

            await this.db.execute(
              sql.raw(`
              UPDATE ${this.appSchema}.${table}
              SET ${setClause}
              WHERE ${whereClause}
            `)
            );
          },
        }),
      }),
      delete: (table: string) => ({
        where: async (condition: object) => {
          const whereClause = Object.entries(condition)
            .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
            .join(" AND ");

          await this.db.execute(
            sql.raw(`
            DELETE FROM ${this.appSchema}.${table}
            WHERE ${whereClause}
          `)
          );
        },
      }),
      find: <T>(table: string) => ({
        where: async (condition: object): Promise<T | null> => {
          const whereClause = Object.entries(condition)
            .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
            .join(" AND ");

          const result = await this.db.execute(
            sql.raw(`
            SELECT * FROM ${this.appSchema}.${table}
            WHERE ${whereClause}
            LIMIT 1
          `)
          );

          return ((result as unknown[])[0] as T) ?? null;
        },
        many: async (condition?: object): Promise<T[]> => {
          let query = `SELECT * FROM ${this.appSchema}.${table}`;

          if (condition && Object.keys(condition).length > 0) {
            const whereClause = Object.entries(condition)
              .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
              .join(" AND ");
            query += ` WHERE ${whereClause}`;
          }

          const result = await this.db.execute(sql.raw(query));
          return result as T[];
        },
      }),
      get: async <T>(table: string, id: string | number): Promise<T | null> => {
        const result = await this.db.execute(
          sql.raw(`
          SELECT * FROM ${this.appSchema}.${table}
          WHERE id = ${this.escapeValue(id)}
          LIMIT 1
        `)
        );

        return ((result as unknown[])[0] as T) ?? null;
      },
    };
  }

  /**
   * Build RPC context for handlers
   */
  private buildRpcContext(): RpcContext {
    const requireRpc = () => {
      if (!this.rpcClient) {
        throw new Error(
          "RPC client not available. Add fallbackRpc to your HyperSync config " +
            "to use context.rpc methods in handlers."
        );
      }
      return this.rpcClient;
    };

    return {
      readContract: async (params) => {
        return requireRpc().readContract(params);
      },
      getBalance: async (address) => {
        return requireRpc().getBalance(address);
      },
      getBlock: async (blockNumber) => {
        const block = await requireRpc().getBlock(blockNumber ?? 0n);
        if (!block) throw new Error("Block not found");
        return {
          number: block.number,
          hash: block.hash,
          timestamp: block.timestamp,
          gasUsed: block.gasUsed,
          gasLimit: block.gasLimit,
        };
      },
      getTransactionReceipt: async (hash) => {
        const receipt = await requireRpc().getTransactionReceipt(hash);
        if (!receipt) throw new Error("Receipt not found");
        return {
          status: receipt.status,
          gasUsed: receipt.gasUsed,
          logs: [], // Would need to convert
        };
      },
    };
  }

  /**
   * Escape a value for SQL
   */
  private escapeValue(value: unknown): string {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number") return String(value);
    if (typeof value === "bigint") return String(value);
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
