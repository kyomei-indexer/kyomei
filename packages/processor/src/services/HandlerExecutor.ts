import type {
  ILogger,
  IProcessCheckpointRepository,
  ICachedRpcClient,
  IEventRepository,
  RawEventRecord,
} from '@kyomei/core';
import { EventDecoder } from '@kyomei/core';
import type {
  EventHandler,
  HandlerContext,
  DbContext,
  RpcContext,
  ContractConfig,
} from '@kyomei/config';
import type { Database } from '@kyomei/database';
import { sql } from 'drizzle-orm';

/**
 * Handler registration
 */
export interface HandlerRegistration {
  contractName: string;
  eventName: string;
  handler: EventHandler;
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
  rpcClient: ICachedRpcClient;
  logger: ILogger;
  batchSize?: number;
}

/**
 * Handler executor service
 * Executes user-defined handlers for events
 */
export class HandlerExecutor {
  private readonly chainId: number;
  private readonly contracts: Array<ContractConfig & { name: string }>;
  private readonly db: Database;
  private readonly appSchema: string;
  private readonly eventRepo: IEventRepository;
  private readonly checkpointRepo: IProcessCheckpointRepository;
  private readonly rpcClient: ICachedRpcClient;
  private readonly logger: ILogger;
  private readonly batchSize: number;
  private readonly eventDecoder = new EventDecoder();
  private readonly handlers: Map<string, EventHandler> = new Map();

  constructor(options: HandlerExecutorOptions) {
    this.chainId = options.chainId;
    this.contracts = options.contracts;
    this.db = options.db;
    this.appSchema = options.appSchema;
    this.eventRepo = options.eventRepository;
    this.checkpointRepo = options.checkpointRepository;
    this.rpcClient = options.rpcClient;
    this.logger = options.logger.child({ module: 'HandlerExecutor', chain: options.chainName });
    this.batchSize = options.batchSize ?? 100;

    // Register contract ABIs
    for (const contract of this.contracts) {
      this.eventDecoder.registerContract(contract.name, contract.abi);
    }
  }

  /**
   * Register a handler for an event
   */
  registerHandler(contractName: string, eventName: string, handler: EventHandler): void {
    const key = `${contractName}:${eventName}`;
    this.handlers.set(key, handler);
    this.logger.debug(`Registered handler: ${key}`);
  }

  /**
   * Register multiple handlers
   */
  registerHandlers(registrations: HandlerRegistration[]): void {
    for (const reg of registrations) {
      this.registerHandler(reg.contractName, reg.eventName, reg.handler);
    }
  }

  /**
   * Process events from checkpoint to target block
   */
  async process(targetBlock: bigint): Promise<number> {
    const checkpoint = await this.checkpointRepo.get(this.chainId);
    const startBlock = checkpoint?.blockNumber ?? 0n;

    if (startBlock >= targetBlock) {
      return 0;
    }

    this.logger.info(`Processing events from block ${startBlock} to ${targetBlock}`);

    let processed = 0;
    let currentBlock = startBlock;

    while (currentBlock < targetBlock) {
      const batchEnd = currentBlock + BigInt(this.batchSize);
      const endBlock = batchEnd > targetBlock ? targetBlock : batchEnd;

      const events = await this.eventRepo.query({
        chainId: this.chainId,
        blockRange: { from: currentBlock + 1n, to: endBlock },
        order: 'asc',
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
    const handler = this.handlers.get(handlerKey);

    if (!handler) return 0;

    // Set block context for RPC caching
    this.rpcClient.setBlockContext(event.blockNumber);

    // Build handler context
    const context = this.buildContext(event, decoded);

    try {
      await handler(context);
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
   */
  private decodeEvent(event: RawEventRecord): {
    contractName: string;
    eventName: string;
    args: Record<string, unknown>;
  } | null {
    // Try each contract
    for (const contract of this.contracts) {
      const log = {
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
   * Build handler context
   */
  private buildContext(
    event: RawEventRecord,
    decoded: { contractName: string; eventName: string; args: Record<string, unknown> }
  ): HandlerContext {
    return {
      event: decoded.args,
      block: {
        number: event.blockNumber,
        hash: event.blockHash as `0x${string}`,
        timestamp: event.blockTimestamp,
      },
      transaction: {
        hash: event.txHash as `0x${string}`,
        from: '0x0000000000000000000000000000000000000000' as `0x${string}`, // Would need to fetch
        to: null,
        index: event.txIndex,
      },
      log: {
        index: event.logIndex,
        address: event.address as `0x${string}`,
      },
      db: this.buildDbContext(),
      rpc: this.buildRpcContext(),
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
          const values = records.map((r) =>
            `(${columns.map((c) => this.escapeValue((r as any)[c])).join(', ')})`
          ).join(', ');

          await this.db.execute(sql.raw(`
            INSERT INTO ${this.appSchema}.${table} (${columns.join(', ')})
            VALUES ${values}
            ON CONFLICT DO NOTHING
          `));
        },
      }),
      update: (table: string) => ({
        set: (data: object) => ({
          where: async (condition: object) => {
            const setClause = Object.entries(data)
              .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
              .join(', ');
            const whereClause = Object.entries(condition)
              .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
              .join(' AND ');

            await this.db.execute(sql.raw(`
              UPDATE ${this.appSchema}.${table}
              SET ${setClause}
              WHERE ${whereClause}
            `));
          },
        }),
      }),
      delete: (table: string) => ({
        where: async (condition: object) => {
          const whereClause = Object.entries(condition)
            .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
            .join(' AND ');

          await this.db.execute(sql.raw(`
            DELETE FROM ${this.appSchema}.${table}
            WHERE ${whereClause}
          `));
        },
      }),
      find: <T>(table: string) => ({
        where: async (condition: object): Promise<T | null> => {
          const whereClause = Object.entries(condition)
            .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
            .join(' AND ');

          const result = await this.db.execute(sql.raw(`
            SELECT * FROM ${this.appSchema}.${table}
            WHERE ${whereClause}
            LIMIT 1
          `));

          return (result as unknown[])[0] as T ?? null;
        },
        many: async (condition?: object): Promise<T[]> => {
          let query = `SELECT * FROM ${this.appSchema}.${table}`;

          if (condition && Object.keys(condition).length > 0) {
            const whereClause = Object.entries(condition)
              .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
              .join(' AND ');
            query += ` WHERE ${whereClause}`;
          }

          const result = await this.db.execute(sql.raw(query));
          return result as T[];
        },
      }),
      get: async <T>(table: string, id: string | number): Promise<T | null> => {
        const result = await this.db.execute(sql.raw(`
          SELECT * FROM ${this.appSchema}.${table}
          WHERE id = ${this.escapeValue(id)}
          LIMIT 1
        `));

        return (result as unknown[])[0] as T ?? null;
      },
    };
  }

  /**
   * Build RPC context for handlers
   */
  private buildRpcContext(): RpcContext {
    return {
      readContract: async (params) => {
        return this.rpcClient.readContract(params);
      },
      getBalance: async (address) => {
        return this.rpcClient.getBalance(address);
      },
      getBlock: async (blockNumber) => {
        const block = await this.rpcClient.getBlock(blockNumber ?? 0n);
        if (!block) throw new Error('Block not found');
        return {
          number: block.number,
          hash: block.hash,
          timestamp: block.timestamp,
          gasUsed: block.gasUsed,
          gasLimit: block.gasLimit,
        };
      },
      getTransactionReceipt: async (hash) => {
        const receipt = await this.rpcClient.getTransactionReceipt(hash);
        if (!receipt) throw new Error('Receipt not found');
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
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
}
