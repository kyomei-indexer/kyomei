import type { BlockRange, BlockWithLogs } from "../../domain/entities/Block.ts";
import type { LogFilter, Log } from "../../domain/entities/Log.ts";
import type {
  IBlockSource,
  SourceType,
} from "../../application/ports/IBlockSource.ts";
import type { ILogger } from "../../application/ports/ILogger.ts";

/**
 * HyperSync network endpoints
 */
const HYPERSYNC_ENDPOINTS: Record<number, string> = {
  1: "https://eth.hypersync.xyz",
  10: "https://optimism.hypersync.xyz",
  137: "https://polygon.hypersync.xyz",
  42161: "https://arbitrum.hypersync.xyz",
  8453: "https://base.hypersync.xyz",
  43114: "https://avalanche.hypersync.xyz",
  56: "https://bsc.hypersync.xyz",
  100: "https://gnosis.hypersync.xyz",
  250: "https://fantom.hypersync.xyz",
  324: "https://zksync.hypersync.xyz",
  59144: "https://linea.hypersync.xyz",
  534352: "https://scroll.hypersync.xyz",
  5000: "https://mantle.hypersync.xyz",
  81457: "https://blast.hypersync.xyz",
  7777777: "https://zora.hypersync.xyz",
  34443: "https://mode.hypersync.xyz",
};

/**
 * HyperSync block source options
 */
export interface HyperSyncBlockSourceOptions {
  chainId: number;
  url?: string;
  /** API token for HyperSync (optional for public endpoints) */
  apiToken?: string;
  logger?: ILogger;
  batchSize?: number;
}

// Types from @envio-dev/hypersync-client
interface HyperSyncClientConfig {
  url: string;
  apiToken: string;
}

interface HyperSyncQuery {
  fromBlock: number;
  toBlock?: number;
  logs?: Array<{
    address?: string[];
    topics?: Array<Array<string> | null>;
  }>;
  fieldSelection?: {
    block?: string[];
    log?: string[];
  };
}

interface HyperSyncBlock {
  number?: number;
  hash?: string;
  parentHash?: string;
  timestamp?: number;
  gasLimit?: bigint;
  gasUsed?: bigint;
  baseFeePerGas?: bigint;
  miner?: string;
  extraData?: string;
}

interface HyperSyncLog {
  blockNumber?: number;
  blockHash?: string;
  transactionHash?: string;
  transactionIndex?: number;
  logIndex?: number;
  address?: string;
  topics: Array<string | undefined | null>;
  data?: string;
  removed?: boolean;
}

interface HyperSyncQueryResponse {
  nextBlock: number;
  archiveHeight?: number;
  data: {
    blocks: HyperSyncBlock[];
    logs: HyperSyncLog[];
  };
}

interface HyperSyncClient {
  get(query: HyperSyncQuery): Promise<HyperSyncQueryResponse>;
  getHeight(): Promise<number>;
}

/**
 * HyperSync-based block source implementation
 * Provides high-performance historical data fetching from Envio's HyperSync
 */
export class HyperSyncBlockSource implements IBlockSource {
  readonly sourceType: SourceType = "hypersync";
  readonly providesValidatedData = true;
  readonly chainId: number;

  private readonly url: string;
  private readonly apiToken: string;
  private readonly logger?: ILogger;
  private readonly batchSize: number;
  private client: HyperSyncClient | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: HyperSyncBlockSourceOptions) {
    this.chainId = options.chainId;
    this.url =
      options.url ??
      HYPERSYNC_ENDPOINTS[options.chainId] ??
      `https://eth.hypersync.xyz`; // Fallback to Ethereum
    this.apiToken = options.apiToken ?? "";
    this.logger = options.logger?.child({ module: "HyperSyncBlockSource" });
    this.batchSize = options.batchSize ?? 10000;

    if (!HYPERSYNC_ENDPOINTS[options.chainId] && !options.url) {
      this.logger?.warn(
        `No default HyperSync endpoint for chain ${options.chainId}, using Ethereum endpoint`
      );
    }
  }

  /**
   * Initialize the HyperSync client
   */
  private async initialize(): Promise<void> {
    if (this.client) return;

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      try {
        // Dynamic import to handle optional dependency
        const { HypersyncClient } = await import("@envio-dev/hypersync-client");
        const config: HyperSyncClientConfig = { url: this.url, apiToken: this.apiToken };
        this.client = new HypersyncClient(config) as unknown as HyperSyncClient;
        this.logger?.debug(`HyperSync client initialized for chain ${this.chainId}`);
      } catch (error) {
        this.logger?.error("Failed to initialize HyperSync client", {
          error: error as Error,
        });
        throw new Error(
          `HyperSync client initialization failed: ${(error as Error).message}`
        );
      }
    })();

    await this.initPromise;
  }

  /**
   * Get blocks with logs in a range
   */
  async *getBlocks(
    range: BlockRange,
    filter?: LogFilter
  ): AsyncGenerator<BlockWithLogs, void, unknown> {
    await this.initialize();

    if (!this.client) {
      throw new Error("HyperSync client not initialized");
    }

    let currentBlock = Number(range.from);
    const toBlock = Number(range.to);

    this.logger?.debug(`Fetching blocks ${range.from} to ${range.to} via HyperSync`);

    while (currentBlock <= toBlock) {
      const batchEnd = Math.min(currentBlock + this.batchSize - 1, toBlock);

      try {
        // Build query
        const query = this.buildQuery(currentBlock, batchEnd, filter);

        // Execute query
        const response = await this.client.get(query);

        // Process response
        const blocks = this.processResponse(response);

        for (const block of blocks) {
          yield block;
        }

        currentBlock = response.nextBlock;

        this.logger?.trace(`Fetched blocks up to ${batchEnd}`, {
          nextBlock: currentBlock,
          archiveHeight: response.archiveHeight,
        });
      } catch (error) {
        this.logger?.error(`HyperSync query failed for blocks ${currentBlock}-${batchEnd}`, {
          error: error as Error,
        });
        throw error;
      }
    }
  }

  /**
   * Get the latest block number
   */
  async getLatestBlockNumber(): Promise<bigint> {
    await this.initialize();

    if (!this.client) {
      throw new Error("HyperSync client not initialized");
    }

    const height = await this.client.getHeight();
    return BigInt(height);
  }

  /**
   * HyperSync provides finalized data, so this returns the same as latest
   */
  async getFinalizedBlockNumber(): Promise<bigint> {
    return this.getLatestBlockNumber();
  }

  /**
   * Get blocks by specific block numbers
   */
  async getBlocksByNumbers(blockNumbers: bigint[]): Promise<BlockWithLogs[]> {
    if (blockNumbers.length === 0) return [];

    await this.initialize();

    if (!this.client) {
      throw new Error("HyperSync client not initialized");
    }

    const results: BlockWithLogs[] = [];

    // Group consecutive blocks for efficient querying
    const ranges = this.groupConsecutiveBlocks(blockNumbers);

    for (const range of ranges) {
      const query = this.buildQuery(range.from, range.to);
      const response = await this.client.get(query);
      const blocks = this.processResponse(response);
      results.push(...blocks);
    }

    return results;
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.initialize();
      const height = await this.client?.getHeight();
      return height !== undefined && height > 0;
    } catch {
      return false;
    }
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    this.client = null;
    this.initPromise = null;
  }

  /**
   * Build HyperSync query
   */
  private buildQuery(
    fromBlock: number,
    toBlock: number,
    filter?: LogFilter
  ): HyperSyncQuery {
    const query: HyperSyncQuery = {
      fromBlock,
      toBlock: toBlock + 1, // HyperSync uses exclusive toBlock
      fieldSelection: {
        block: [
          "Number",
          "Hash",
          "ParentHash",
          "Timestamp",
          "GasLimit",
          "GasUsed",
          "BaseFeePerGas",
          "Miner",
          "ExtraData",
        ],
        log: [
          "BlockNumber",
          "BlockHash",
          "TransactionHash",
          "TransactionIndex",
          "LogIndex",
          "Address",
          "Topic0",
          "Topic1",
          "Topic2",
          "Topic3",
          "Data",
          "Removed",
        ],
      },
    };

    // Add log filters
    if (filter) {
      const logFilter: { address?: string[]; topics?: Array<Array<string> | null> } = {};

      if (filter.address) {
        logFilter.address = Array.isArray(filter.address)
          ? filter.address
          : [filter.address];
      }

      if (filter.topics && filter.topics.length > 0) {
        logFilter.topics = filter.topics.map((topic) => {
          if (topic === null) return null;
          return Array.isArray(topic) ? topic : [topic];
        });
      }

      if (Object.keys(logFilter).length > 0) {
        query.logs = [logFilter];
      }
    }

    return query;
  }

  /**
   * Process HyperSync response into BlockWithLogs
   */
  private processResponse(response: HyperSyncQueryResponse): BlockWithLogs[] {
    const blocksMap = new Map<number, {
      block: BlockWithLogs["block"];
      logs: Log[];
    }>();

    // Process blocks
    for (const block of response.data.blocks) {
      if (block.number === undefined) continue;

      blocksMap.set(block.number, {
        block: {
          number: BigInt(block.number),
          hash: (block.hash ?? "0x") as `0x${string}`,
          parentHash: (block.parentHash ?? "0x") as `0x${string}`,
          timestamp: BigInt(block.timestamp ?? 0),
          gasLimit: block.gasLimit ?? 0n,
          gasUsed: block.gasUsed ?? 0n,
          baseFeePerGas: block.baseFeePerGas ?? null,
          miner: (block.miner ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
          extraData: (block.extraData ?? "0x") as `0x${string}`,
          transactionCount: 0,
        },
        logs: [],
      });
    }

    // Process logs
    for (const log of response.data.logs) {
      if (log.blockNumber === undefined) continue;

      let blockWithLogs = blocksMap.get(log.blockNumber);

      // Create minimal block if not exists
      if (!blockWithLogs) {
        blockWithLogs = {
          block: {
            number: BigInt(log.blockNumber),
            hash: (log.blockHash ?? "0x") as `0x${string}`,
            parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
            timestamp: 0n,
            gasLimit: 0n,
            gasUsed: 0n,
            baseFeePerGas: null,
            miner: "0x0000000000000000000000000000000000000000" as `0x${string}`,
            extraData: "0x" as `0x${string}`,
            transactionCount: 0,
          },
          logs: [],
        };
        blocksMap.set(log.blockNumber, blockWithLogs);
      }

      // Convert log
      const convertedLog: Log = {
        blockNumber: BigInt(log.blockNumber),
        blockHash: (log.blockHash ?? "0x") as `0x${string}`,
        blockTimestamp: blockWithLogs.block.timestamp,
        transactionHash: (log.transactionHash ?? "0x") as `0x${string}`,
        transactionIndex: log.transactionIndex ?? 0,
        logIndex: log.logIndex ?? 0,
        address: (log.address ?? "0x") as `0x${string}`,
        topic0: (log.topics[0] ?? null) as `0x${string}` | null,
        topic1: (log.topics[1] ?? null) as `0x${string}` | null,
        topic2: (log.topics[2] ?? null) as `0x${string}` | null,
        topic3: (log.topics[3] ?? null) as `0x${string}` | null,
        data: (log.data ?? "0x") as `0x${string}`,
        removed: log.removed ?? false,
      };

      blockWithLogs.logs.push(convertedLog);
    }

    // Sort blocks by number and logs by index
    const sortedBlocks = Array.from(blocksMap.values())
      .sort((a, b) => Number(a.block.number - b.block.number))
      .map(({ block, logs }) => {
        // Sort logs by transaction index and log index
        const sortedLogs = [...logs].sort((a, b) => {
          if (a.transactionIndex !== b.transactionIndex) {
            return a.transactionIndex - b.transactionIndex;
          }
          return a.logIndex - b.logIndex;
        });

        return { block, logs: sortedLogs };
      });

    return sortedBlocks;
  }

  /**
   * Group consecutive block numbers into ranges
   */
  private groupConsecutiveBlocks(
    blockNumbers: bigint[]
  ): Array<{ from: number; to: number }> {
    if (blockNumbers.length === 0) return [];

    const sorted = [...blockNumbers].sort((a, b) => Number(a - b));
    const ranges: Array<{ from: number; to: number }> = [];

    let rangeStart = Number(sorted[0]);
    let rangeEnd = rangeStart;

    for (let i = 1; i < sorted.length; i++) {
      const current = Number(sorted[i]);
      if (current === rangeEnd + 1) {
        rangeEnd = current;
      } else {
        ranges.push({ from: rangeStart, to: rangeEnd });
        rangeStart = current;
        rangeEnd = current;
      }
    }

    ranges.push({ from: rangeStart, to: rangeEnd });
    return ranges;
  }
}
