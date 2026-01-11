import type { KyomeiConfig } from "@kyomei/config";
import type { Database } from "@kyomei/database";
import {
  EventRepository,
  SyncWorkerRepository,
  ProcessWorkerRepository,
  FactoryRepository,
  RpcCacheRepository,
} from "@kyomei/database";
import type { ILogger, IBlockSource, IRpcClient } from "@kyomei/core";
import {
  RpcClient,
  RpcBlockSource,
  ErpcBlockSource,
  HyperSyncBlockSource,
  CachedRpcClient,
} from "@kyomei/core";
import { ChainSyncer, ViewCreator } from "@kyomei/syncer";
import { HandlerExecutor, type HandlerRegistration } from "@kyomei/processor";
import { CronScheduler } from "@kyomei/cron";
import { EventNotifier, EventListener } from "@kyomei/events";
import type postgres from "postgres";

/**
 * Service runner options
 */
export interface ServiceRunnerOptions {
  config: KyomeiConfig;
  db: Database;
  client: postgres.Sql;
  logger: ILogger;
  services: {
    syncer: boolean;
    processor: boolean;
    api: boolean;
    crons: boolean;
  };
  /** Handler registrations from Kyomei instance */
  handlerRegistrations?: HandlerRegistration[];
}

/**
 * Service runner - orchestrates all indexer services
 */
export class ServiceRunner {
  private readonly config: KyomeiConfig;
  private readonly db: Database;
  private readonly client: postgres.Sql;
  private readonly logger: ILogger;
  private readonly services: ServiceRunnerOptions["services"];
  private readonly handlerRegistrations: HandlerRegistration[];

  // Repositories
  private readonly eventRepo: EventRepository;
  private readonly syncWorkerRepo: SyncWorkerRepository;
  private readonly processWorkerRepo: ProcessWorkerRepository;
  private readonly factoryRepo: FactoryRepository;
  private readonly rpcCacheRepo: RpcCacheRepository;

  // Event-driven communication
  private readonly eventNotifier: EventNotifier;
  private readonly eventListener: EventListener;

  // Services
  private syncers: Map<string, ChainSyncer> = new Map();
  private processors: Map<string, HandlerExecutor> = new Map();
  private cronScheduler?: CronScheduler;
  private viewCreator: ViewCreator;

  // Clients
  private blockSources: Map<string, IBlockSource> = new Map();
  private rpcClients: Map<string, IRpcClient> = new Map();

  private isRunning = false;

  constructor(options: ServiceRunnerOptions) {
    this.config = options.config;
    this.db = options.db;
    this.client = options.client;
    this.logger = options.logger;
    this.services = options.services;
    this.handlerRegistrations = options.handlerRegistrations ?? [];

    // Initialize repositories
    this.eventRepo = new EventRepository(this.db);
    this.syncWorkerRepo = new SyncWorkerRepository(this.db);
    this.processWorkerRepo = new ProcessWorkerRepository(this.db);
    this.factoryRepo = new FactoryRepository(this.db);
    this.rpcCacheRepo = new RpcCacheRepository(this.db);

    // Initialize event-driven communication
    this.eventNotifier = new EventNotifier(this.client);
    this.eventListener = new EventListener(this.client);

    // Initialize view creator
    this.viewCreator = new ViewCreator({
      db: this.db,
      syncSchema: this.config.database.syncSchema ?? "kyomei_sync",
      appSchema: this.config.database.appSchema ?? "kyomei_app",
      logger: this.logger,
    });
  }

  /**
   * Start all configured services
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    this.logger.info("Starting service runner...");

    // Initialize block sources and RPC clients
    await this.initializeClients();

    // Start syncer
    if (this.services.syncer) {
      await this.startSyncers();
    }

    // Start processor
    if (this.services.processor) {
      await this.startProcessors();
    }

    // Start crons
    if (this.services.crons && this.config.crons) {
      await this.startCrons();
    }

    // Start API
    if (this.services.api) {
      await this.startApi();
    }

    this.logger.info("All services started");
  }

  /**
   * Stop all services
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info("Stopping all services...");

    // Stop processors
    for (const [name, processor] of this.processors) {
      await processor.stop();
      this.logger.debug(`Stopped processor: ${name}`);
    }

    // Stop syncers
    for (const [name, syncer] of this.syncers) {
      await syncer.stop();
      this.logger.debug(`Stopped syncer: ${name}`);
    }

    // Stop cron scheduler
    if (this.cronScheduler) {
      await this.cronScheduler.stop();
    }

    // Close block sources
    for (const [name, source] of this.blockSources) {
      await source.close();
      this.logger.debug(`Closed block source: ${name}`);
    }

    this.isRunning = false;
    this.logger.info("All services stopped");
  }

  /**
   * Initialize block sources and RPC clients for all chains
   */
  private async initializeClients(): Promise<void> {
    for (const [chainName, chainConfig] of Object.entries(this.config.chains)) {
      const { source } = chainConfig;

      // Create RPC client
      let rpcUrl: string;
      if (source.type === "rpc") {
        rpcUrl = source.url;
      } else if (source.type === "erpc") {
        rpcUrl = source.url;
      } else {
        // For HyperSync and streams, we still need an RPC for contract reads
        rpcUrl = ""; // Would need to be configured separately
      }

      if (rpcUrl) {
        const rpcClient = new RpcClient({
          chainId: chainConfig.id,
          url: rpcUrl,
        });
        this.rpcClients.set(chainName, rpcClient);
      }

      // Create block source
      let blockSource: IBlockSource;
      switch (source.type) {
        case "rpc":
          blockSource = new RpcBlockSource({
            chainId: chainConfig.id,
            url: source.url,
            pollingInterval: chainConfig.pollingInterval,
            logger: this.logger,
          });
          break;
        case "erpc":
          blockSource = new ErpcBlockSource({
            chainId: chainConfig.id,
            url: source.url,
            projectId: source.projectId,
            pollingInterval: chainConfig.pollingInterval,
            logger: this.logger,
          });
          break;
        case "hypersync":
          blockSource = new HyperSyncBlockSource({
            chainId: chainConfig.id,
            url: source.url,
            apiToken: source.apiToken,
            logger: this.logger,
          });
          // HyperSync doesn't provide RPC, so we need a fallback RPC for contract reads
          if (source.fallbackRpc) {
            const rpcClient = new RpcClient({
              chainId: chainConfig.id,
              url: source.fallbackRpc,
            });
            this.rpcClients.set(chainName, rpcClient);
          }
          break;
        // Stream would be implemented here
        default:
          this.logger.warn(`Unsupported source type: ${source.type}`, {
            chain: chainName,
          });
          continue;
      }

      this.blockSources.set(chainName, blockSource);
      this.logger.debug(`Initialized block source for ${chainName}`);
    }
  }

  /**
   * Start syncers for all chains
   */
  private async startSyncers(): Promise<void> {
    for (const [chainName, chainConfig] of Object.entries(this.config.chains)) {
      const blockSource = this.blockSources.get(chainName);
      if (!blockSource) continue;

      // Get contracts for this chain
      const contracts = Object.entries(this.config.contracts)
        .filter(([, c]) => c.chain === chainName)
        .map(([name, c]) => ({ name, ...c }));

      if (contracts.length === 0) {
        this.logger.debug(
          `No contracts for chain ${chainName}, skipping syncer`
        );
        continue;
      }

      // Create syncer (factory watcher is integrated inside ChainSyncer)
      const syncer = new ChainSyncer({
        chainId: chainConfig.id,
        chainName,
        chainConfig,
        contracts,
        blockSource,
        eventRepository: this.eventRepo,
        workerRepository: this.syncWorkerRepo,
        factoryRepository: this.factoryRepo,
        eventNotifier: this.eventNotifier,
        logger: this.logger,
        onProgress: (progress) => {
          this.logger.progress({
            chain: progress.chainName,
            blocksSynced: progress.blocksSynced,
            totalBlocks: progress.totalBlocks,
            percentage: progress.percentage,
            phase: progress.phase === "historical" ? "syncing" : "live",
            blocksPerSecond: progress.blocksPerSecond,
            workers: progress.workers,
            estimatedTimeRemaining: progress.estimatedTimeRemaining,
          });
        },
      });

      this.syncers.set(chainName, syncer);

      // Start syncer (non-blocking)
      syncer.start().catch((error) => {
        this.logger.error(`Syncer error for ${chainName}`, {
          error: error as Error,
        });
      });

      this.logger.info(`Started syncer for ${chainName}`);
    }

    // Create views after syncers initialize
    for (const [chainName, chainConfig] of Object.entries(this.config.chains)) {
      const contracts = Object.entries(this.config.contracts)
        .filter(([, c]) => c.chain === chainName)
        .map(([name, c]) => ({ name, ...c }));

      await this.viewCreator.createViewsForContracts(contracts, chainConfig.id);
    }
  }

  /**
   * Start processors for all chains
   */
  private async startProcessors(): Promise<void> {
    for (const [chainName, chainConfig] of Object.entries(this.config.chains)) {
      // Get contracts for this chain
      const contracts = Object.entries(this.config.contracts)
        .filter(([, c]) => c.chain === chainName)
        .map(([name, c]) => ({ name, ...c }));

      if (contracts.length === 0) continue;

      // Create cached RPC client if RPC is available
      const rpcClient = this.rpcClients.get(chainName);
      let cachedRpc: CachedRpcClient | null = null;

      if (rpcClient) {
        cachedRpc = new CachedRpcClient({
          client: rpcClient,
          cacheRepo: this.rpcCacheRepo,
          logger: this.logger,
        });
      } else {
        this.logger.warn(
          `No RPC client for ${chainName} - context.rpc calls in handlers will fail. ` +
            `Add fallbackRpc to HyperSync config if handlers need RPC access.`
        );
      }

      // Create processor
      const processor = new HandlerExecutor({
        chainId: chainConfig.id,
        chainName,
        contracts,
        db: this.db,
        appSchema: this.config.database.appSchema ?? "kyomei_app",
        eventRepository: this.eventRepo,
        workerRepository: this.processWorkerRepo,
        syncWorkerRepository: this.syncWorkerRepo,
        rpcClient: cachedRpc ?? undefined,
        eventListener: this.eventListener,
        logger: this.logger,
        onProgress: (progress) => {
          this.logger.progress({
            chain: progress.chainName,
            blocksSynced: progress.blocksProcessed,
            totalBlocks: progress.totalBlocks,
            eventsProcessed: progress.eventsProcessed,
            percentage: progress.percentage,
            phase: progress.status === "processing" ? "processing" : "live",
            eventsPerSecond: progress.eventsPerSecond,
            workers: 1,
            estimatedTimeRemaining: undefined,
          });
        },
      });

      // Register handlers for this chain's contracts
      const contractNames = contracts.map((c) => c.name);
      const chainHandlers = this.handlerRegistrations.filter((h) =>
        contractNames.includes(h.contractName)
      );

      if (chainHandlers.length === 0) {
        this.logger.warn(`No handlers registered for chain ${chainName}`);
      } else {
        processor.registerHandlers(chainHandlers);
        this.logger.info(
          `Registered ${chainHandlers.length} handlers for ${chainName}`
        );
      }

      this.processors.set(chainName, processor);

      // Start processor (non-blocking)
      processor.start().catch((error) => {
        this.logger.error(`Processor error for ${chainName}`, {
          error: error as Error,
        });
      });

      this.logger.info(`Started processor for ${chainName}`);
    }
  }

  /**
   * Start cron scheduler
   */
  private async startCrons(): Promise<void> {
    if (!this.config.crons || this.config.crons.length === 0) return;

    // Build chain ID map
    const chainIds = new Map<string, number>();
    for (const [name, config] of Object.entries(this.config.chains)) {
      chainIds.set(name, config.id);
    }

    this.cronScheduler = new CronScheduler({
      db: this.db,
      rpcClients: this.rpcClients,
      chainIds,
      logger: this.logger,
      cronsSchema: this.config.database.cronsSchema ?? "kyomei_crons",
      appSchema: this.config.database.appSchema ?? "kyomei_app",
    });

    // Register crons (handlers would be loaded from config.handler paths)
    // This is a placeholder - actual implementation would dynamically import handlers
    for (const cronConfig of this.config.crons) {
      // await this.cronScheduler.register(cronConfig, handler);
      this.logger.debug(`Registered cron: ${cronConfig.name}`);
    }

    await this.cronScheduler.start();
    this.logger.info("Cron scheduler started");
  }

  /**
   * Start API server
   */
  private async startApi(): Promise<void> {
    const { ApiServer } = await import("@kyomei/api");

    const apiServer = new ApiServer({
      db: this.db,
      appSchema: this.config.database.appSchema ?? "kyomei_app",
      logger: this.logger,
      host: this.config.api?.host ?? "0.0.0.0",
      port: this.config.api?.port ?? 42069,
      graphqlPath: this.config.api?.graphql?.path ?? "/graphql",
    });

    await apiServer.start();
  }

  /**
   * Get status of all services
   */
  getStatus(): {
    isRunning: boolean;
    syncers: Map<string, ReturnType<ChainSyncer["getStatus"]>>;
    blockSources: string[];
    rpcClients: string[];
  } {
    const syncerStatus = new Map<
      string,
      ReturnType<ChainSyncer["getStatus"]>
    >();
    for (const [name, syncer] of this.syncers) {
      syncerStatus.set(name, syncer.getStatus());
    }

    return {
      isRunning: this.isRunning,
      syncers: syncerStatus,
      blockSources: Array.from(this.blockSources.keys()),
      rpcClients: Array.from(this.rpcClients.keys()),
    };
  }
}
